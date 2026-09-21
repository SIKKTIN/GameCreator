import { useEffect, useRef, useState } from 'react';
import { beforeLogoutEvent } from './auth';
import type { SavedProject } from './project-catalog';
import type { StoryDoc } from './story-model';
import { localSourceIdentity, readLocalStories } from './story-import';
import { workspaceStorage } from './workspace-storage';
import { canLeaveTeam, leaveTeamEvent, teamRequest, type TeamSession, type TeamStory } from './team-api';

export function StoryImportDialog({ projects, session, projectId, onImported }: {
  projects: SavedProject[]; session: TeamSession; projectId: string; onImported: (stories: TeamStory[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), inFlight = useRef(false);
  const [sourceId, setSourceId] = useState(''), [stories, setStories] = useState<StoryDoc[]>([]), [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState('');
  useEffect(() => {
    const guard = (event: Event) => { if (inFlight.current) event.preventDefault(); };
    const close = (event: BeforeUnloadEvent) => { if (inFlight.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener(leaveTeamEvent, guard); window.addEventListener(beforeLogoutEvent, guard); window.addEventListener('beforeunload', close);
    return () => { window.removeEventListener(leaveTeamEvent, guard); window.removeEventListener(beforeLogoutEvent, guard); window.removeEventListener('beforeunload', close); };
  }, []);
  const load = (id: string) => {
    setSourceId(id); setError(''); setResult('');
    try {
      const project = projects.find(item => item.id === id);
      if (!project) throw new Error('请选择本地项目');
      const documents = readLocalStories(workspaceStorage, project);
      setStories(documents); setSelected(new Set(documents.slice(0, 50).map(item => item.id)));
    } catch (reason) { setStories([]); setSelected(new Set()); setError((reason as Error).message); }
  };
  const show = () => { if (!canLeaveTeam()) return; load(projects[0]?.id || ''); dialog.current?.showModal(); };
  const copy = async () => {
    if (inFlight.current || !selected.size) return;
    inFlight.current = true; setBusy(true); setError(''); setResult('');
    try {
      if((session.apiVersion??0)<11&&stories.filter(s=>selected.has(s.id)).some(s=>s.archived||s.format==='markdown'||s.references?.length))throw new Error('请升级并重新连接协作服务器，以完整导入文档格式、归档和引用。');
      const response = await teamRequest<{ imported: TeamStory[]; skipped: number }>(session.url, `/projects/${projectId}/stories/import`, session.token, 'POST', {
        sourceInstanceId: localSourceIdentity(workspaceStorage), sourceProjectId: sourceId, stories: stories.filter(item => selected.has(item.id)),
      });
      onImported(response.imported);
      setResult(`已复制 ${response.imported.length} 篇；跳过 ${response.skipped} 篇已导入文档。原本地故事没有修改。`);
    } catch (reason) { setError((reason as Error).message); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <>
    <button className="team-import-button" onClick={show}>从本地导入故事</button>
    <dialog ref={dialog} className="team-dialog team-import-dialog" aria-labelledby="story-import-title" onCancel={event => { if (busy) event.preventDefault(); }}>
      <h2 id="story-import-title">复制本地故事到团队项目</h2><p>只复制选中的故事，保留标签、大纲和关联设定。原本地项目保持不变。重复导入会跳过已有副本。</p>
      <label>来源本地项目<select aria-label="来源本地项目" value={sourceId} disabled={busy} onChange={event => load(event.target.value)}>
        {projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <p>已选择 {selected.size} / {stories.length} 篇，每次最多 50 篇。</p>
      <div className="story-import-list">{stories.map(story => <div key={story.id} className="story-import-row">
        <label><input type="checkbox" aria-label={'导入故事：' + story.title} checked={selected.has(story.id)} disabled={busy || (!selected.has(story.id) && selected.size >= 50)}
          onChange={event => { setResult(''); setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(story.id); else next.delete(story.id); return next; }); }} />
          <span><strong>{story.title}</strong><small>{story.category} · {story.status} · {story.content.length} 字 · {story.tags.length} 个标签</small></span></label>
        <details><summary>预览内容</summary><p>{story.summary}</p><pre>{story.content}</pre><p>标签：{story.tags.join('、') || '无'}</p><p>大纲：{story.outlines.join(' / ') || '无'}</p>
          <p>角色：{story.relations.characters.join('、') || '无'}；地点：{story.relations.locations.join('、') || '无'}；系统：{story.relations.systems.join('、') || '无'}</p></details>
      </div>)}</div>
      {!stories.length && !error && <p>这个本地项目还没有故事文档。</p>}
      {error && <p className="team-message" role="alert">{error}</p>}{result && <p className="team-save-state" role="status">{result}</p>}
      <div className="team-dialog-actions"><button disabled={busy} onClick={() => dialog.current?.close()}>{result ? '完成' : '取消'}</button>
        <button className="primary" disabled={busy || !selected.size || !!result} onClick={() => void copy()}>{busy ? '正在复制…' : `复制 ${selected.size} 篇到团队`}</button></div>
    </dialog>
  </>;
}
