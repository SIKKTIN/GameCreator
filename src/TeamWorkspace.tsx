import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Cloud, CloudOff, History, RefreshCw } from 'lucide-react';
import { beforeLogoutEvent } from './auth';
import { StoryDocuments } from './StoryDocuments';
import { StoryImportDialog } from './StoryImportDialog';
import { TeamProjectDialog } from './TeamProjectDialog';
import { TeamOverview } from './TeamOverview';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import type { ServerModuleNavigation } from './ServerManager';
import { workspaceStorage } from './workspace-storage';
import type { SavedProject } from './project-catalog';
import { canLeaveTeam, canEditModule, leaveTeamEvent, roleLabels, sameFields, storyFields, teamStoryDocument, TeamError, teamRequest,
  type TeamCapabilities, type TeamProject, type TeamRole, type TeamSession, type TeamStory, type TeamStoryFields } from './team-api';
import './team.css';

const displayTime = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
type Draft = { base: TeamStory; fields: TeamStoryFields };

export function TeamProjectWorkspace({ project, session, picker, localProjects, onConnection, onDisconnect, localAdmin, serverPage, onManageServer, onLeaveServer, adminPageName, onManageUsers }: {
  project: TeamProject; session: TeamSession; picker: ReactNode; localProjects: SavedProject[]; onConnection: () => void; onDisconnect: () => void;
  localAdmin: boolean;
} & ServerModuleNavigation) {
  const [stories, setStories] = useState<TeamStory[]>([]), [selectedId, setSelectedId] = useState('');
  const [members, setMembers] = useState<{ username: string; role: TeamRole }[]>([]);
  const [syncError, setSyncError] = useState(''), [loaded, setLoaded] = useState(false), [role, setRole] = useState(project.role);
  const [accessDenied, setAccessDenied] = useState(false), [manageMembers, setManageMembers] = useState(false);
  const [capabilities,setCapabilities] = useState<TeamCapabilities>();
  const accessBlocked = accessDenied || !!session.invalid;
  const writableStories = !accessBlocked && loaded && canEditModule(session,role,capabilities,'stories');
  const [active,setActive] = useState('故事文档');
  const overviewEnabled = (session.apiVersion ?? 0) >= 5;
  const [createBusy, setCreateBusy] = useState(false), [createError, setCreateError] = useState(''), [refresh, setRefresh] = useState(0);
  const alive = useRef(true), creating = useRef(false);
  const route = `/projects/${encodeURIComponent(project.id)}/stories`;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    document.title = `GameCreator · ${project.name} · ${session.user.username}`;
    const guard = (event: Event) => { if (creating.current) event.preventDefault(); };
    window.addEventListener(leaveTeamEvent, guard); window.addEventListener(beforeLogoutEvent, guard);
    return () => { window.removeEventListener(leaveTeamEvent, guard); window.removeEventListener(beforeLogoutEvent, guard); };
  }, [project.name, session.user.username]);
  useEffect(() => {
    let active = true, timer: number;
    const poll = async () => {
      try {
        const result = await teamRequest<{ stories: TeamStory[]; role: TeamRole; capabilities?: TeamCapabilities }>(session.url, route, session.token);
        if (!active) return;
        setStories(previous => result.stories.map(story => {
          const existing = previous.find(item => item.id === story.id);
          return existing && existing.revision > story.revision ? existing : story;
        }).concat(previous.filter(item => !result.stories.some(story => story.id === item.id))));
        setSelectedId(current => current || result.stories[0]?.id || ''); setSyncError(''); setAccessDenied(false); setLoaded(true); setRole(result.role);setCapabilities(result.capabilities);
      } catch (reason) { if (active) { setSyncError((reason as Error).message); if (reason instanceof TeamError && [401,403].includes(reason.status)) { setAccessDenied(true); setManageMembers(false);setCapabilities(undefined); } } }
      finally { if (active) timer = window.setTimeout(poll, 2000); }
    };
    void poll(); return () => { active = false; window.clearTimeout(timer); };
  }, [session, route, refresh]);
  useEffect(() => {
    let active = true, timer: number;
    const poll = async () => {
      try {
        const result = await teamRequest<{ members: { username: string; role: TeamRole }[] }>(session.url, `/projects/${project.id}/members`, session.token);
        if (active) setMembers(result.members);
      } catch { if (active) setMembers([]); }
      if (active) timer = window.setTimeout(poll, 3000);
    };
    void poll(); return () => { active = false; window.clearTimeout(timer); };
  }, [session, project.id, refresh]);
  const receive = (story: TeamStory) => setStories(previous => {
    const existing = previous.find(item => item.id === story.id);
    if (existing && existing.revision > story.revision) return previous;
    return existing ? previous.map(item => item.id === story.id ? story : item) : [story, ...previous];
  });
  const create = async () => {
    if (creating.current || !writableStories || !canLeaveTeam()) return;
    creating.current = true; setCreateBusy(true); setCreateError('');
    try {
      const result = await teamRequest<{ story: TeamStory }>(session.url, route, session.token, 'POST', {
        title: '新的故事文档', category: '世界观', status: '草稿', summary: '', content: '', tags: [], outlines: [], relations: { characters: [], locations: [], systems: [] },
      });
      if (alive.current) { receive(result.story); setSelectedId(result.story.id); }
    } catch (reason) { if (alive.current) setCreateError((reason as Error).message); }
    finally { creating.current = false; if (alive.current) setCreateBusy(false); }
  };
  const selected = stories.find(item => item.id === selectedId);
  return <div className="app team-project">
    {manageMembers && !accessBlocked && role === 'admin' && <TeamProjectDialog session={session} project={project} onClose={() => setManageMembers(false)} onSaved={() => setRefresh(value => value + 1)} />}
    <WorkspaceSidebar picker={picker} team teamOverview={overviewEnabled} admin={localAdmin} active={serverPage ? adminPageName??'服务器管理' : active} onManageServer={onManageServer} onManageUsers={onManageUsers}
      onNavigate={name=>{if(canLeaveTeam()){onLeaveServer();setActive(name);}}} footer={<>
      <div className="user"><div className="avatar">{session.user.username[0].toUpperCase()}</div><span>{session.user.username}<small>团队成员 · {roleLabels[role]}</small></span></div>
      <details className="team-members"><summary>项目成员 · {members.length}</summary>{members.map(item => <p key={item.username}>{item.username}<small>{roleLabels[item.role]}</small></p>)}</details>
    </>} />
    {serverPage}
    <main hidden={!!serverPage}><header><div><div className="crumb">{project.name} <span>/</span> 团队项目</div><h1>{active}</h1></div>
      <div className="team-actions">{!accessBlocked && role === 'admin' && <button onClick={() => { if (canLeaveTeam()) setManageMembers(true); }}>成员管理</button>}<button onClick={onConnection}>连接设置</button><button onClick={onDisconnect}>断开团队连接</button></div></header>
      <div className="team-project-info"><span>团队项目 · {session.url}</span><span>当前成员：{session.user.username} · {roleLabels[role]}</span><span>已共享：{overviewEnabled?'项目概览、故事文档':'故事文档'}</span></div>
      <div className={'team-sync ' + (syncError ? 'offline' : '')} role="status">{syncError ? <CloudOff size={16} /> : <Cloud size={16} />}
        <span>{syncError || (loaded ? '已连接 · 每 2 秒检查团队更新' : '正在读取团队故事…')}</span>
        <button aria-label="立即刷新团队内容" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15} /></button></div>
      {accessBlocked && <p className="team-message" role="alert">{session.invalid?'团队登录已失效，请重新连接。本机未提交草稿仍保留。':'你已无权访问这个项目。本机未提交草稿仍保留，请选择其他项目或联系项目管理员。'}</p>}
      {overviewEnabled&&<div hidden={accessBlocked||active!=='项目概览'}><TeamOverview blocked={accessBlocked} session={session} projectId={project.id} members={members} onMembers={()=>setManageMembers(true)} onDenied={()=>setAccessDenied(true)}/></div>}
      <div hidden={active!=='故事文档'}>
      {writableStories && <div className="team-import-toolbar"><StoryImportDialog projects={localProjects} session={session} projectId={project.id} onImported={imported => {
        imported.forEach(receive); if (imported.length) setSelectedId(imported[0].id);
      }} /></div>}
      {createError && <p className="team-message" role="alert">{createError}</p>}
      <div hidden={accessBlocked}>
      {selected ? <TeamStoryEditor key={selected.id} story={selected} documents={stories} session={session} role={writableStories ? role : 'viewer'} onSaved={receive} busy={createBusy}
        onSelect={id => { if (canLeaveTeam()) setSelectedId(id); }} onCreate={() => void create()} />
        : loaded ? <StoryDocuments documents={[]} activeStoryId="" setActiveStoryId={() => {}} updateStory={() => {}} addStoryDoc={() => void create()} readOnly={!writableStories} busy={createBusy} />
          : <p className="team-empty">等待团队内容…</p>}
      </div>
      </div>
    </main>
  </div>;
}

function TeamStoryEditor({ story, documents, session, role, onSaved, onSelect, onCreate, busy }: {
  story: TeamStory; documents: TeamStory[]; session: TeamSession; role: TeamRole; onSaved: (story: TeamStory) => void;
  onSelect: (id: string) => void; onCreate: () => void; busy: boolean;
}) {
  const key = `gamecreator.team-draft.v1:${session.serverId}:${session.user.id}:${story.projectId}:${story.id}`;
  const [initial] = useState(() => {
    try {
      const raw = workspaceStorage.getItem(key), value: Draft | null = raw ? JSON.parse(raw) : null;
      if (value && (!value.base || value.base.id !== story.id || !Number.isSafeInteger(value.base.revision) || !value.fields ||
        !['title', 'category', 'summary', 'content'].every(field => typeof value.fields[field as keyof TeamStoryFields] === 'string'))) throw new Error('本机草稿格式异常');
      const base = value ? { ...story, ...value.base } : story;
      const fields = value ? { ...storyFields(base), ...value.fields } : storyFields(story);
      for (const frame of [storyFields(base), fields]) {
        if (!['title','category','summary','content','status'].every(field => typeof frame[field as keyof TeamStoryFields] === 'string') ||
          !frame.relations || ![frame.tags, frame.outlines, frame.relations.characters, frame.relations.locations, frame.relations.systems]
            .every(list => Array.isArray(list) && list.every(item => typeof item === 'string'))) throw new Error('本机草稿字段无效');
      }
      return { draft: { base, fields }, restored: !!value, error: '' };
    } catch (error) { return { draft: { base: story, fields: storyFields(story) }, restored: false, error: '草稿读取失败：' + String(error) }; }
  });
  const [draft, setDraft] = useState<Draft>(initial.draft), [diskError, setDiskError] = useState(initial.error);
  const [saveError, setSaveError] = useState(''), [saving, setSaving] = useState(false), [message, setMessage] = useState(initial.restored ? '已恢复本机未提交草稿' : '');
  const [history, setHistory] = useState<TeamStory[] | null>(null), [historyError, setHistoryError] = useState('');
  const [historyBusy, setHistoryBusy] = useState(false), [conflict, setConflict] = useState<TeamStory | null>(null);
  const current = useRef(draft), mounted = useRef(true), savingRef = useRef(false);
  const dirty = !sameFields(draft.fields, storyFields(draft.base));
  const readOnly = role === 'viewer';
  const route = `/projects/${story.projectId}/stories/${story.id}`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const persist = (next: Draft) => {
    try {
      if (initial.error) throw new Error(initial.error);
      workspaceStorage.setItem(key, JSON.stringify(sameFields(next.fields, storyFields(next.base)) ? null : next));
      setDiskError(''); return true;
    } catch (error) { setDiskError('草稿尚未写入本机，请保持窗口打开：' + String(error)); return false; }
  };
  const change = (next: Draft) => { current.current = next; setDraft(next); persist(next); };
  useEffect(() => {
    const frame = current.current;
    if (story.revision <= frame.base.revision) return;
    if (sameFields(frame.fields, storyFields(frame.base)) && !savingRef.current) {
      const next = { base: story, fields: storyFields(story) };
      current.current = next; setDraft(next); setConflict(null); setMessage('已更新为团队最新版本');
    } else setConflict(story);
  }, [story]);
  useEffect(() => {
    // A corrupt archive blocks editing, but there is no new draft to lose by leaving it.
    const mustStay = (!!diskError && !initial.error) || saving;
    const guard = (event: Event) => { if (mustStay) event.preventDefault(); };
    const close = (event: BeforeUnloadEvent) => { if (mustStay) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener(leaveTeamEvent, guard); window.addEventListener(beforeLogoutEvent, guard); window.addEventListener('beforeunload', close);
    return () => { window.removeEventListener(leaveTeamEvent, guard); window.removeEventListener(beforeLogoutEvent, guard); window.removeEventListener('beforeunload', close); };
  }, [diskError, saving, initial.error]);
  const save = async () => {
    if (savingRef.current || readOnly || conflict || initial.error) return;
    savingRef.current = true; setSaving(true); setSaveError(''); setMessage('');
    const submitted = current.current;
    try {
      const result = await teamRequest<{ story: TeamStory }>(session.url, route, session.token, 'PUT', { ...submitted.fields, revision: submitted.base.revision });
      if (!mounted.current) return;
      change({ base: result.story, fields: storyFields(result.story) });
      setConflict(null); onSaved(result.story); setMessage('已保存到团队'); setHistory(null);
    } catch (error) {
      if (!mounted.current) return;
      const reason = error as TeamError; setSaveError(reason.message);
      if (reason.status === 409 && reason.current) { setConflict(reason.current); onSaved(reason.current); }
    } finally { savingRef.current = false; if (mounted.current) setSaving(false); }
  };
  const showHistory = async () => {
    setHistoryBusy(true); setHistoryError('');
    try {
      const result = await teamRequest<{ history: TeamStory[] }>(session.url, route + '/history', session.token);
      if (mounted.current) setHistory(result.history);
    } catch (error) { if (mounted.current) setHistoryError((error as Error).message); }
    finally { if (mounted.current) setHistoryBusy(false); }
  };
  return <div className="shared-story-editor">
    <div className="team-editor-heading"><p>版本 <b data-testid="team-revision">{draft.base.revision}</b> · {draft.base.updatedBy} · {displayTime(draft.base.updatedAt)}</p>
      <div className="team-actions"><button onClick={showHistory} disabled={historyBusy}><History size={16} />修改历史</button>
        {!readOnly && <button className="team-primary" onClick={save} disabled={!dirty || saving || busy || !!conflict || !!initial.error || !draft.fields.title.trim() || !draft.fields.category.trim()}><Check size={17} />{saving ? '正在提交…' : '保存到团队'}</button>}</div>
    </div>
    <div className={'team-save-state' + (dirty ? ' pending' : '')} role="status">{readOnly ? '当前账号只有查看权限' : diskError ? '本机草稿保存失败' : saving ? '等待服务端确认…' : dirty ? '草稿已保存在本机 · 尚未提交到团队' : '当前内容已保存到团队'}{message && <span> · {message}</span>}</div>
    {readOnly&&dirty&&<p className="team-overview-notice">编辑区保留了你的本机未提交草稿，尚未写入团队；恢复编辑权限后可以继续处理。</p>}
    {diskError && <div className="team-message" role="alert">{diskError}<button onClick={() => persist(current.current)}>重试保存草稿</button></div>}
    {saveError && <div className="team-message" role="alert">{saveError}</div>}
    {conflict && <section className="team-conflict" aria-label="文档冲突" role="alert"><h2>这篇文档有新的团队版本</h2>
      <p>{conflict.updatedBy} 已保存版本 {conflict.revision}。你的草稿仍在编辑区，请对照右侧最新内容，包括状态、标签、大纲及关联设定，修改后确认合并。</p>
      <div className="team-actions"><button disabled={readOnly || saving || !!initial.error} onClick={() => { change({ ...current.current, base: conflict }); setConflict(null); setSaveError(''); setMessage('已确认合并，请点击“保存到团队”提交'); }}>已合并，准备提交</button>
        <button disabled={saving || !!initial.error} onClick={() => { change({ base: conflict, fields: storyFields(conflict) }); setConflict(null); setSaveError(''); setMessage('已采用团队最新版本'); }}>采用最新版本并丢弃草稿</button></div>
    </section>}
    <StoryDocuments documents={documents.map(item => item.id === story.id ? { ...draft.fields, id: item.id, updated: `${draft.base.updatedBy} · 版本 ${draft.base.revision}` } : teamStoryDocument(item))}
      activeStoryId={story.id} setActiveStoryId={onSelect} addStoryDoc={onCreate} readOnly={readOnly || !!initial.error} busy={saving || busy}
      updateStory={(_id, changes) => { setMessage(''); setSaveError(''); change({ ...current.current, fields: storyFields({ ...current.current.base, ...current.current.fields, ...changes }) }); }}
      contextHeader={conflict && <section className="context-card team-latest" aria-label="团队最新版本"><h3>团队版本 {conflict.revision}</h3><StorySnapshot story={conflict} /></section>} />
    {historyError && <p className="team-message" role="alert">{historyError}</p>}
    {history && <section className="team-history" aria-label="文档修改历史"><div><h2>最近的修改记录</h2><button onClick={() => setHistory(null)}>收起历史</button></div>
      {history.map(item => <details key={item.revision}><summary>版本 {item.revision} · {item.updatedBy} · {displayTime(item.updatedAt)}</summary><StorySnapshot story={item} /></details>)}</section>}
  </div>;
}

function StorySnapshot({ story }: { story: TeamStory }) {
  return <div className="story-snapshot"><strong>{story.title}</strong><p>{story.category} · {story.status}</p><p>{story.summary || '无摘要'}</p><pre>{story.content}</pre>
    <p>标签：{story.tags.join('、') || '无'}</p><p>大纲：{story.outlines.join(' / ') || '无'}</p>
    <p>角色：{story.relations.characters.join('、') || '无'}</p><p>地点：{story.relations.locations.join('、') || '无'}</p><p>系统：{story.relations.systems.join('、') || '无'}</p></div>;
}
