import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { beforeLogoutEvent } from './auth';
import { leaveTeamEvent, teamRequest, TeamError, type TeamMember, type TeamProject, type TeamRole, type TeamSession } from './team-api';
import './team-project.css';

export function TeamMemberFields({ accounts, roles, currentUserId, onChange }: {
  accounts: { userId: string; username: string }[]; roles: Record<string, TeamRole | 'none'>; currentUserId: string;
  onChange: (userId: string, role: TeamRole | 'none') => void;
}) {
  return <div className="team-project-members"><strong>项目成员与权限</strong>
    {accounts.map(account => <label key={account.userId}><span>{account.username}{account.userId === currentUserId && <small>当前管理账号</small>}</span>
      <select aria-label={account.username + ' 权限'} value={roles[account.userId] ?? 'none'} disabled={account.userId === currentUserId}
        onChange={event => onChange(account.userId, event.target.value as TeamRole | 'none')}>
        <option value="none">不加入此项目</option><option value="admin">管理员</option><option value="editor">编辑者</option><option value="viewer">只读成员</option>
      </select></label>)}
  </div>;
}

export function TeamProjectDialog({ session, project, onClose, onCreated, onSaved }: {
  session: TeamSession; project?: TeamProject; onClose: () => void;
  onCreated?: (project: TeamProject) => void; onSaved?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), operating = useRef(false);
  const [name, setName] = useState(''), [accounts, setAccounts] = useState<{ userId: string; username: string }[]>([]);
  const [roles, setRoles] = useState<Record<string, TeamRole | 'none'>>({}), [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false);
  const retry = useRef<{ signature: string; id: string } | null>(null), alive = useRef(true), reads = useRef(0);
  const route = project ? `/projects/${encodeURIComponent(project.id)}/members` : '/projects';
  const load = useCallback(async () => {
    const read = ++reads.current; setLoaded(false); setError('');
    try {
      if ((session.apiVersion ?? 0) < 3) throw new Error('请先重启并升级协作服务器，以使用项目与成员管理。');
      const [users, current] = await Promise.all([
        teamRequest<{ accounts: { userId: string; username: string }[] }>(session.url, '/accounts', session.token),
        project ? teamRequest<{ members: TeamMember[]; revision: number }>(session.url, `/projects/${encodeURIComponent(project.id)}/members`, session.token) : null,
      ]);
      if (!alive.current || reads.current !== read) return;
      setAccounts(users.accounts); setRevision(current?.revision ?? 0);
      setRoles(Object.fromEntries(users.accounts.map(account => [account.userId, current?.members.find(member => member.userId === account.userId)?.role ??
        (account.userId === session.user.id ? 'admin' : 'none')])));
      setLoaded(true); setConflict(false);
    } catch (reason) { if (alive.current && reads.current === read) setError((reason as Error).message); }
  }, [session, project?.id]);
  useEffect(() => { alive.current = true; dialog.current?.showModal(); void load(); return () => { alive.current = false; ++reads.current; }; }, [load]);
  useEffect(() => {
    const guard = (event: Event) => { if (operating.current) event.preventDefault(); };
    const unload = (event: BeforeUnloadEvent) => { if (operating.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener(beforeLogoutEvent, guard); window.addEventListener(leaveTeamEvent, guard); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener(beforeLogoutEvent, guard); window.removeEventListener(leaveTeamEvent, guard); window.removeEventListener('beforeunload', unload); };
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (operating.current || !loaded || conflict) return;
    operating.current = true; setBusy(true); setError('');
    const members = accounts.filter(account => roles[account.userId] !== 'none').map(account => ({ userId: account.userId, role: roles[account.userId] }));
    try {
      if (project) {
        await teamRequest(session.url, route, session.token, 'PUT', { members, revision });
        onSaved?.(); onClose();
      } else {
        const fields = { name: name.trim(), members }, signature = JSON.stringify(fields);
        if (retry.current?.signature !== signature) retry.current = { signature, id: crypto.randomUUID() };
        const { project: created } = await teamRequest<{ project: TeamProject }>(session.url, route, session.token, 'POST', { ...fields, requestId: retry.current.id });
        onCreated?.(created);
      }
    } catch (reason) {
      if (alive.current) { setError((reason as Error).message); if (project && reason instanceof TeamError && reason.status === 409) setConflict(true); }
    } finally { operating.current = false; if (alive.current) setBusy(false); }
  };
  return <dialog className="team-dialog team-project-dialog" ref={dialog} aria-label={project ? '成员管理' : '新建协作项目'}
    onCancel={event => { event.preventDefault(); if (!operating.current) onClose(); }}>
    <form onSubmit={event => void submit(event)}>
      <h2>{project ? '成员管理' : '新建协作项目'}</h2>
      <p>{project ? project.name : '在当前服务器创建一个空白项目。多个协作项目共用同一台服务器。'}</p>
      <p className="team-project-server">{session.url} · 当前账号：{session.user.username}</p>
      <fieldset disabled={busy || !loaded}>
        {!project && <label>协作项目名称<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} autoFocus /></label>}
        <TeamMemberFields accounts={accounts} roles={roles} currentUserId={session.user.id} onChange={(userId, role) => setRoles(previous => ({ ...previous, [userId]: role }))} />
      </fieldset>
      <small>管理员可编辑共享内容及管理成员；编辑者可编辑共享内容；只读成员只能查看。当前管理账号保留管理员权限。</small>
      {!loaded && !error && <p role="status">正在读取成员…</p>}
      {error && <p className="team-message" role="alert">{error}</p>}
      {(!loaded || conflict) && error && <button type="button" disabled={busy} onClick={() => void load()}>重新读取成员</button>}
      <div className="team-dialog-actions"><button type="button" disabled={busy} onClick={onClose}>取消</button>
        <button className="primary" disabled={busy || !loaded || conflict || (!project && !name.trim())}>{busy ? '正在保存…' : project ? '保存成员配置' : '创建并进入协作项目'}</button></div>
    </form>
  </dialog>;
}
