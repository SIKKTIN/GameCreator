import { useEffect, useRef, useState } from 'react';
import { beforeLogoutEvent } from './auth';
import { GameplayCore } from './GameplayCore';
import { validateGameplayCore } from './gameplay-core';
import { applyCoreChanges, coreChanges, coreDiff, emptyCoreSnapshot, reconcileCore, validateCoreDraft, validateCoreLayout, withCoreLayout, type CoreDraft, type CoreLayout, type CoreSnapshot } from './team-core-model';
import { canEditModule, leaveTeamEvent, teamRequest, TeamError, type TeamCapabilities, type TeamRole, type TeamSession } from './team-api';
import { workspaceStorage } from './workspace-storage';
import type { GameplayCoreController } from './useGameplayCore';

type Response = CoreSnapshot & { role: TeamRole; capabilities: TeamCapabilities };
export function TeamGameplayCore({ session, projectId, blocked, onDenied }: { session: TeamSession; projectId: string; blocked: boolean; onDenied: () => void }) {
  const key = `gamecreator.team-draft.v1:${session.serverId}:${session.user.id}:${projectId}:gameplay-core`;
  const layoutKey = `gamecreator.team-core-layout.v1:${session.serverId}:${session.user.id}:${projectId}`;
  const [initial] = useState(() => {
    try {
      const raw = workspaceStorage.getItem(key), value = raw ? JSON.parse(raw) as CoreDraft | null : null;
      if (value) validateCoreDraft(value);
      return { draft: value ?? { base: emptyCoreSnapshot(), store: emptyCoreSnapshot().store }, restored: !!value, error: '' };
    } catch (error) { return { draft: { base: emptyCoreSnapshot(), store: emptyCoreSnapshot().store }, restored: false, error: '玩法核心草稿读取失败，已停止写入：' + String(error) }; }
  });
  const [initialLayout] = useState(() => {
    try { const raw = workspaceStorage.getItem(layoutKey); return { value: raw ? validateCoreLayout(JSON.parse(raw)) : {} as CoreLayout, error: '' }; }
    catch (error) { return { value: {} as CoreLayout, error: String(error) }; }
  });
  const [draft,setDraft] = useState(initial.draft), current = useRef(draft);
  const [layout,setLayout] = useState(initialLayout.value), positions = useRef(layout);
  const [loaded,setLoaded] = useState(false), [saving,setSaving] = useState(false), [response,setResponse] = useState<Response>();
  const [error,setError] = useState(''), [syncError,setSyncError] = useState(''), [diskError,setDiskError] = useState(initial.error), [layoutError,setLayoutError] = useState(initialLayout.error);
  const [conflict,setConflict] = useState<{ remote: CoreSnapshot; ids: string[] } | null>(null);
  const [graphId,setGraphId] = useState(draft.store.rootId);
  const alive = useRef(true), savingRef = useRef(false), generation = useRef(0), request = useRef<{ signature: string; id: string } | null>(null);
  const route = `/projects/${encodeURIComponent(projectId)}/core`;
  const dirty = coreChanges(draft.base,draft.store).length > 0;
  const readOnly = blocked || !loaded || !response || !canEditModule(session,response.role,response.capabilities,'core');
  const persist = (next: CoreDraft) => {
    if (initial.error) return false;
    try { const raw = JSON.stringify(coreChanges(next.base,next.store).length ? next : null); if (workspaceStorage.getItem(key) !== raw) workspaceStorage.setItem(key,raw); setDiskError(''); return true; }
    catch (error) { setDiskError('草稿尚未写入本机，请保持窗口打开：' + String(error)); return false; }
  };
  const change = (next: CoreDraft) => { current.current = next; setDraft(next); persist(next); };
  const receive = (remote: Response) => {
    setResponse(remote); setLoaded(true);
    if (initial.error) return;
    const result = reconcileCore(current.current,remote);
    if (result.conflicts.length) setConflict({ remote, ids: result.conflicts });
    else { change(result.draft); setConflict(null); if (!coreChanges(result.draft.base,result.draft.store).length) setError(''); }
  };
  useEffect(() => {
    alive.current = true; let active = true, timer: number;
    const poll = async () => {
      const started = generation.current;
      try {
        if (!savingRef.current) {
          const value = await teamRequest<Response>(session.url,route,session.token);
          if (active && started === generation.current && !savingRef.current) { receive(value); setSyncError(''); }
        }
      } catch (reason) {
        if (active) { setSyncError((reason as Error).message); if (reason instanceof TeamError && [401,403].includes(reason.status)) { setResponse(undefined); onDenied(); } }
      } finally { if (active) timer = window.setTimeout(poll,2000); }
    };
    void poll(); return () => { active = false; alive.current = false; window.clearTimeout(timer); };
  }, [session,projectId]);
  useEffect(() => {
    const mustStay = saving || (!!diskError && !initial.error) || (!!layoutError && !initialLayout.error);
    const guard = (e: Event) => { if (mustStay) e.preventDefault(); };
    const unload = (e: BeforeUnloadEvent) => { if (mustStay) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener(leaveTeamEvent,guard); window.addEventListener(beforeLogoutEvent,guard); window.addEventListener('beforeunload',unload);
    return () => { window.removeEventListener(leaveTeamEvent,guard); window.removeEventListener(beforeLogoutEvent,guard); window.removeEventListener('beforeunload',unload); };
  }, [saving,diskError,layoutError]);
  const save = async () => {
    if (readOnly || savingRef.current || conflict || initial.error || !dirty) return;
    savingRef.current = true; ++generation.current; setSaving(true); setError('');
    const frame = current.current, fields = { rootId: frame.store.rootId, changes: coreChanges(frame.base,withCoreLayout(frame.store,positions.current)) }, signature = JSON.stringify(fields);
    if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    try {
      const value = await teamRequest<Response>(session.url,route,session.token,'PUT',{...fields,requestId:request.current.id});
      if (alive.current) { change({base:value,store:value.store}); setResponse(value); setConflict(null); }
    } catch (reason) {
      if (alive.current) {
        setError((reason as Error).message);
        if (reason instanceof TeamError) {
          if (reason.status === 409 && reason.currentRecord) receive(reason.currentRecord as Response);
          if ([401,403].includes(reason.status)) setResponse(undefined);
        }
      }
    } finally { savingRef.current = false; ++generation.current; if (alive.current) setSaving(false); }
  };
  const move = (id: string, x: number, y: number) => {
    if (initialLayout.error) return;
    const next = { ...positions.current, [id]: {x,y} }; positions.current = next; setLayout(next);
    try { workspaceStorage.setItem(layoutKey,JSON.stringify(next)); setLayoutError(''); }
    catch (error) { setLayoutError('个人布局保存失败：' + String(error)); }
  };
  const controller: GameplayCoreController = {
    store: withCoreLayout(draft.store,layout), pending: dirty, blocked: readOnly || saving || !!initial.error,
    error: '', retry: () => persist(current.current), reload: () => false,
    update: operation => {
      if (readOnly || savingRef.current || initial.error) return false;
      try {
        const next = validateGameplayCore(operation(structuredClone(withCoreLayout(current.current.store,positions.current))));
        change({ ...current.current, store: next }); setError(''); return true;
      } catch (reason) { setError((reason as Error).message); return false; }
    },
  };
  const exportDraft = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...current.current, store:withCoreLayout(current.current.store,positions.current) },null,2)],{type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'gameplay-core-team-draft.json'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url),1000);
  };
  const stamp = draft.base.stamps[graphId];
  return <section className="team-core" aria-label="团队玩法核心">
    <div className="team-editor-heading"><p>当前流程版本 <b data-testid="core-revision">{draft.base.versions[graphId] ?? 0}</b>{stamp && ` · ${stamp.updatedBy} · ${new Date(stamp.updatedAt).toLocaleString('zh-CN')}`}</p>
      <div className="team-actions">{dirty && <button onClick={exportDraft}>导出玩法核心草稿</button>}<button disabled={!dirty || readOnly || saving || !!conflict || !!initial.error} className="team-primary" onClick={() => void save()}>{saving ? '正在提交…' : '保存玩法核心到团队'}</button></div></div>
    <div className={'team-core-status' + (dirty ? ' pending' : '')} role="status" data-testid="core-save-state">{!loaded ? '正在读取玩法核心…' : readOnly ? '玩法核心只读' : dirty ? '玩法核心草稿已保存在本机 · 尚未提交到团队' : '玩法核心已与团队同步'} · 拖动只调整个人布局</div>
    {readOnly && dirty && <p>当前显示你的未提交草稿，恢复编辑权限后可以继续处理。</p>}
    {(error || diskError || layoutError || syncError) && <div className="team-message" role="alert">{error || diskError || layoutError || syncError}{diskError && !initial.error && <button onClick={() => persist(current.current)}>重试保存草稿</button>}{layoutError && !initialLayout.error && <button onClick={() => { const entry = Object.entries(positions.current)[0]; if (entry) move(entry[0],entry[1].x,entry[1].y); }}>重试保存个人布局</button>}</div>}
    {conflict && <section className="team-conflict" aria-label="玩法核心冲突"><h2>相关流程已有团队修改</h2><p>你的草稿已保留。对照下面的差异，调整编辑区内容后准备提交；结构已被删除时，可导出草稿再采用团队版本。</p>
      {conflict.ids.map(id => <details key={id} open><summary>{draft.base.store.graphs.find(g => g.id === id)?.title || conflict.remote.store.graphs.find(g => g.id === id)?.title || id} · 团队版本 {conflict.remote.versions[id] ?? 0}</summary>
        <div className="team-core-diff"><div><strong>我的修改</strong>{coreDiff(draft.base.store.graphs.find(g => g.id === id),draft.store.graphs.find(g => g.id === id)).map((s,i) => <p key={i}>{s}</p>)}</div>
          <div><strong>团队修改</strong>{coreDiff(draft.base.store.graphs.find(g => g.id === id),conflict.remote.store.graphs.find(g => g.id === id)).map((s,i) => <p key={i}>{s}</p>)}</div></div></details>)}
      <div className="team-actions"><button disabled={readOnly || saving} onClick={() => {
        try { const store = applyCoreChanges(conflict.remote.store,coreChanges(current.current.base,current.current.store)); change({base:conflict.remote,store}); setConflict(null); setError(''); }
        catch { setError('团队模块结构已变化，无法安全套用草稿。请先导出草稿，再采用团队版本重新调整。'); }
      }}>已对照合并，准备提交</button><button disabled={saving || !!initial.error} onClick={() => {
        if (window.confirm('确定丢弃本机玩法核心草稿，采用团队最新内容？个人布局会保留。')) { change({base:conflict.remote,store:conflict.remote.store}); setConflict(null); setError(''); }
      }}>采用团队版本并丢弃玩法草稿</button></div></section>}
    {(loaded || initial.restored) && <GameplayCore controller={controller} designs={draft.base.references} onOpenGameplay={() => {}} team
      onMoveNode={initialLayout.error ? undefined : move} onGraphChange={setGraphId} statusLabel={dirty ? '草稿待提交' : readOnly ? '内容只读 · 布局可调整' : '内容已同步 · 布局仅本机'}/>} 
  </section>;
}
