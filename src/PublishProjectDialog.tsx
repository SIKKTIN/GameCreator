import {SchedulePublicationPreview,ScheduleSupplementDialog} from './ScheduleSupplementDialog';
import {GameplayPublicationPreview,GameplaySupplementDialog} from './GameplaySupplementDialog';
import { CorePublicationPreview, CoreSupplementDialog } from './CoreSupplementDialog';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { beforeLogoutEvent } from './auth';
import type { SavedProject } from './project-catalog';
import { localSourceIdentity } from './story-import';
import { assertPublicationCurrent, publicationBody, publicationLimits, readPublicationPreview, type PublicationPreview, type PublicationSource } from './team-publish';
import { leaveTeamEvent, TeamError, teamRequest, type TeamProject, type TeamPublication, type DeletedPublication, type TeamRole, type TeamSession } from './team-api';
import { TeamMemberFields } from './TeamProjectDialog';
import { OverviewPublicationPreview, OverviewSupplementDialog } from './OverviewSupplementDialog';
import { workspaceStorage } from './workspace-storage';
import './team-publish.css';

export function PublishProjectDialog({ session, project, onClose, onPublished }: {
  session: TeamSession; project: SavedProject; onClose: () => void; onPublished: (project: TeamProject) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), operating = useRef(false), alive = useRef(true), reads = useRef(0);
  const initialized = useRef(false), errorNotice = useRef<HTMLParagraphElement>(null);
  const [source, setSource] = useState<PublicationSource | null>(null), [preview, setPreview] = useState<PublicationPreview | null>(null);
  const [deletedPublication,setDeletedPublication] = useState<DeletedPublication|null>(null),[confirmRepublish,setConfirmRepublish] = useState(false);
  const [published, setPublished] = useState<TeamPublication | null>(null), [name, setName] = useState('');
  const [accounts, setAccounts] = useState<{ userId: string; username: string }[]>([]), [roles, setRoles] = useState<Record<string, TeamRole | 'none'>>({});
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [supplement,setSupplement] = useState(false), [coreSupplement,setCoreSupplement] = useState(false), [gameplaySupplement,setGameplaySupplement] = useState(false);
  const [scheduleSupplement,setScheduleSupplement] = useState(false);
  const lookup = useCallback((origin: PublicationSource) => teamRequest<{ publication: TeamPublication | null; deletedPublication?: DeletedPublication | null }>(session.url, '/publications/lookup', session.token, 'POST', origin), [session]);
  const load = useCallback(async () => {
    const read = ++reads.current; setLoading(true); setError(''); setPreview(null); setPublished(null);setDeletedPublication(null);setConfirmRepublish(false);
    try {
      if ((session.apiVersion ?? 0) < 10) throw new Error('请先重启并升级协作服务器，再重新连接，以启用项目排期和完整项目发布。');
      const origin = { sourceInstanceId: localSourceIdentity(workspaceStorage), sourceProjectId: project.id };
      const result = await lookup(origin);
      if (!alive.current || read !== reads.current) return;
      setSource(origin);setDeletedPublication(result.deletedPublication??null);
      if (result.publication) { setPublished(result.publication); return; }
      const { accounts: available } = await teamRequest<{ accounts: { userId: string; username: string }[] }>(session.url, '/accounts', session.token);
      if (!alive.current || read !== reads.current) return;
      const snapshot = readPublicationPreview(workspaceStorage, project);
      setPreview(snapshot); setAccounts(available);
      if (!initialized.current) setName(snapshot.name);
      setRoles(previous => Object.fromEntries(available.map(account => [account.userId, account.userId === session.user.id ? 'admin' : previous[account.userId] ?? 'none'])));
      initialized.current = true;
    } catch (reason) { if (alive.current && read === reads.current) setError(reason instanceof TeamError && reason.status === 0 ? '无法连接服务器，尚未确认发布状态。请恢复连接后重新读取预览。' : (reason as Error).message); }
    finally { if (alive.current && read === reads.current) setLoading(false); }
  }, [session, project, lookup]);
  useEffect(() => { alive.current = true; dialog.current?.showModal(); void load(); return () => { alive.current = false; ++reads.current; }; }, [load]);
  useEffect(() => { if (error) errorNotice.current?.scrollIntoView({ block: 'nearest' }); }, [error]);
  useEffect(() => {
    const guard = (event: Event) => { if (operating.current) event.preventDefault(); };
    const unload = (event: BeforeUnloadEvent) => { if (operating.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener(beforeLogoutEvent, guard); window.addEventListener(leaveTeamEvent, guard); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener(beforeLogoutEvent, guard); window.removeEventListener(leaveTeamEvent, guard); window.removeEventListener('beforeunload', unload); };
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (operating.current || loading || !source) return;
    if (published) { onPublished(published.project); return; }
    if (!preview || (deletedPublication && !confirmRepublish)) return;
    operating.current = true; setBusy(true); setError('');
    try {
      // Check durable server state first, including after an uncertain timeout.
      const existing = await lookup(source);
      if (!alive.current) return;
      if (existing.publication) { onPublished(existing.publication.project); return; }
      if ((existing.deletedPublication?.projectId??null) !== (deletedPublication?.projectId??null)) throw new Error('协作副本的删除状态已变化，请重新读取预览后确认发布。');
      assertPublicationCurrent(workspaceStorage, project, preview);
      const members = accounts.filter(account => roles[account.userId] && roles[account.userId] !== 'none')
        .map(account => ({ userId: account.userId, role: roles[account.userId] as TeamRole }));
      const body = publicationBody(preview, source, name, members);
      const result = await teamRequest<TeamPublication>(session.url, '/publications', session.token, 'POST', {...body,...(deletedPublication ? {replacesProjectId:deletedPublication.projectId} : {})});
      if (alive.current) onPublished(result.project);
    } catch (reason) {
      if (alive.current) setError(reason instanceof TeamError && reason.status === 0
        ? '发布结果尚未确认，请恢复连接后重试或重新读取预览。已成功发布的项目会直接复用。' : (reason as Error).message);
    } finally { operating.current = false; if (alive.current) setBusy(false); }
  };
  return <>{scheduleSupplement&&source&&published&&<ScheduleSupplementDialog session={session} project={project} source={source} target={published.project} onClose={()=>setScheduleSupplement(false)} onDone={onPublished}/>}{gameplaySupplement&&source&&published&&<GameplaySupplementDialog session={session} project={project} source={source} target={published.project} onClose={()=>setGameplaySupplement(false)} onDone={onPublished}/>}{coreSupplement&&source&&published&&<CoreSupplementDialog session={session} project={project} source={source} target={published.project} onClose={()=>setCoreSupplement(false)} onDone={onPublished}/>}{supplement&&source&&published&&<OverviewSupplementDialog session={session} project={project} source={source} target={published.project} onClose={()=>setSupplement(false)} onDone={onPublished}/>}
    <dialog ref={dialog} className="team-dialog team-project-dialog team-publish-dialog" aria-label="发布为协作项目"
    onCancel={event => { event.preventDefault(); if (!operating.current) onClose(); }}>
    <form onSubmit={event => void submit(event)}>
      <div className="team-publish-content">
      <h2>发布为协作项目</h2>
      <p className="team-project-server">目标服务器：{session.url} · {session.user.username}</p>
      {loading && <p role="status">正在检查发布记录并读取本地内容…</p>}
      {published && <div className="team-publication-result" role="status"><strong>此本地项目已发布</strong>
        <p>{published.project.name} · 首次发布 {published.storyCount} 篇故事文档</p><small>{new Date(published.publishedAt).toLocaleString('zh-CN')}</small>
        <p>可以进入已有协作项目。团队成员后续的修改会保留，本地内容不会覆盖它们。</p>
        {published.scheduleInitialized===false&&published.project.role==='admin'&&<button type="button" onClick={()=>setScheduleSupplement(true)}>补充项目排期</button>}
        {published.gameplayInitialized===false&&published.project.role==='admin'&&<button type="button" onClick={()=>setGameplaySupplement(true)}>补充玩法设计</button>}
        {published.coreInitialized===false&&published.project.role==='admin'&&<button type="button" onClick={()=>setCoreSupplement(true)}>补充玩法核心</button>}
        {published.overviewInitialized===false&&published.project.role==='admin'&&<button type="button" onClick={()=>setSupplement(true)}>补充项目概览</button>}</div>}
      {!loading && preview && <>
        {deletedPublication&&<div className="team-message"><p>原协作项目「{deletedPublication.name}」已删除。重新发布会从当前本地内容建立一个新的协作项目，不会恢复已删除的团队修改。</p><label className="republish-confirmation"><input type="checkbox" checked={confirmRepublish} disabled={busy} onChange={event=>setConfirmRepublish(event.target.checked)}/>我确认重新发布为新的协作项目</label></div>}
        <div className="team-publication-scope"><strong>来源本地项目：{preview.name}</strong>
          <p>发布全部 {preview.stories.length} 篇故事文档，保留正文、分类、状态、摘要、标签、大纲及关联设定。</p>
          <p>同时发布项目基本信息和 {preview.overview.milestones.length} 个里程碑。</p>
          <small>协作项目开放项目概览、项目排期、玩法核心、玩法设计和故事文档。配置和美术等内容留在本地；原本地项目保留，与协作副本独立编辑。</small></div>
        <fieldset disabled={busy}>
          <label>协作项目名称<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
          <SchedulePublicationPreview schedule={preview.schedule}/><GameplayPublicationPreview gameplay={preview.gameplay}/><CorePublicationPreview core={preview.core}/><OverviewPublicationPreview overview={{...preview.overview,info:{...preview.overview.info,name}}}/>
          <details className="team-publication-preview"><summary>查看将发布的故事文档（{preview.stories.length}）</summary>
            <div>{preview.stories.map(story => <details key={story.id}><summary>{story.title} · {story.category} · {story.status}</summary>
              <p>{story.summary}</p><pre>{story.content}</pre><p>标签：{story.tags.join('、') || '无'}</p><p>大纲：{story.outlines.join(' / ') || '无'}</p>
              <p>角色：{story.relations.characters.join('、') || '无'}；地点：{story.relations.locations.join('、') || '无'}；系统：{story.relations.systems.join('、') || '无'}</p>
            </details>)}{!preview.stories.length && <p>这个本地项目没有故事文档，将发布为空白协作项目。</p>}</div>
          </details>
          <TeamMemberFields accounts={accounts} roles={roles} currentUserId={session.user.id} onChange={(userId, role) => setRoles(previous => ({ ...previous, [userId]: role }))} />
        </fieldset>
        <small>项目管理员可编辑并管理成员；编辑者默认概览和排期只读、故事、玩法核心和玩法设计可编辑，发布后可在成员管理中单独授权；只读成员只能查看。单次最多 {publicationLimits.maxStories} 篇故事、200 个里程碑、2000 个制作任务，提交内容不超过 10 MiB。</small>
      </>}
      {error && <p ref={errorNotice} className="team-message" role="alert">{error}</p>}
      {error && <button type="button" disabled={busy || loading} onClick={() => void load()}>重新读取预览</button>}
      </div>
      <div className="team-dialog-actions"><button type="button" disabled={busy} onClick={onClose}>取消</button>
        <button className="primary" disabled={busy || loading || (!published && (!preview || !name.trim() || (!!deletedPublication && !confirmRepublish)))}>
          {busy ? '正在发布…' : published ? '进入已发布项目' : '发布并进入协作项目'}</button></div>
    </form>
  </dialog></>;
}
