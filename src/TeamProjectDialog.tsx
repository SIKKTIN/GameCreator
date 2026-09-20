import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { beforeLogoutEvent } from './auth';
import { defaultPermissions, effectivePermissions, leaveTeamEvent, teamRequest, TeamError, type ModulePermissions, type TeamMember, type TeamProject, type TeamRole, type TeamSession } from './team-api';
import './team-project.css';

export function TeamMemberFields({ accounts, roles, currentUserId, onChange, permissions, onPermissionChange, coreEnabled = true, gameplayEnabled = false, scheduleEnabled = false }: {
  accounts: { userId: string; username: string; enabled?: boolean }[]; roles: Record<string, TeamRole | 'none'>; currentUserId: string;
  onChange: (userId: string, role: TeamRole | 'none') => void;
  scheduleEnabled?: boolean; coreEnabled?: boolean; gameplayEnabled?: boolean; permissions?: Record<string,ModulePermissions>; onPermissionChange?: (userId:string,module:keyof ModulePermissions,value:ModulePermissions['overview'])=>void;
}) {
  return <div className="team-project-members"><strong>项目成员与权限</strong>
    {accounts.map(account => <div className="team-member-config" key={account.userId}><label><span>{account.username}{account.enabled===false&&<small>账号已停用</small>}{account.userId === currentUserId && <small>当前管理账号</small>}</span>
      <select aria-label={account.username + ' 权限'} value={roles[account.userId] ?? 'none'} disabled={account.userId === currentUserId}
        onChange={event => onChange(account.userId, event.target.value as TeamRole | 'none')}>
        <option value="none">不加入此项目</option><option value="admin">管理员</option><option value="editor">编辑者</option><option value="viewer">只读成员</option>
      </select></label>{permissions&&roles[account.userId]&&roles[account.userId]!=='none'&&<div className="team-module-permissions">
        {(['overview','schedule','stories','core','gameplay'] as const).filter(module => (module !== 'schedule' || scheduleEnabled) && (module !== 'core' || coreEnabled) && (module !== 'gameplay' || gameplayEnabled)).map(module=>{
          const role=roles[account.userId] as TeamRole, overrides=permissions[account.userId]??defaultPermissions(),effective=effectivePermissions(role,overrides)[module];
          const label=module==='schedule'?'项目排期':module==='overview'?'项目概览':module==='core'?'玩法核心':module==='gameplay'?'玩法设计':'故事文档';
          return <label key={module}><span>{label}<small>生效：{effective==='edit'?'可编辑':'只读'}</small></span>
            <select aria-label={`${account.username} ${label}权限`} disabled={role!=='editor'} value={role==='editor'?overrides[module]:'inherit'} onChange={event=>onPermissionChange?.(account.userId,module,event.target.value as ModulePermissions['overview'])}>
              <option value="inherit">角色默认（{effectivePermissions(role)[module]==='edit'?'可编辑':'只读'}）</option><option value="view">只读</option><option value="edit">可编辑</option>
            </select></label>;
        })}</div>}</div>)}
  </div>;
}

export function TeamProjectDialog({ session, project, onClose, onCreated, onSaved }: {
  session: TeamSession; project?: TeamProject; onClose: () => void;
  onCreated?: (project: TeamProject) => void; onSaved?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), operating = useRef(false);
  const [name, setName] = useState(''), [accounts, setAccounts] = useState<{ userId: string; username: string; enabled?: boolean }[]>([]);
  const [permissions,setPermissions] = useState<Record<string,ModulePermissions>>({});
  const [roles, setRoles] = useState<Record<string, TeamRole | 'none'>>({}), [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false);
  const retry = useRef<{ signature: string; id: string } | null>(null), alive = useRef(true), reads = useRef(0);
  const route = project ? `/projects/${encodeURIComponent(project.id)}/members` : '/projects';
  const load = useCallback(async () => {
    const read = ++reads.current; setLoaded(false); setError('');
    try {
      if ((session.apiVersion ?? 0) < 3) throw new Error('请先重启并升级协作服务器，以使用项目与成员管理。');
      const [users, current] = await Promise.all([
        teamRequest<{ accounts: { userId: string; username: string; enabled?: boolean }[] }>(session.url, '/accounts', session.token),
        project ? teamRequest<{ members: TeamMember[]; revision: number }>(session.url, `/projects/${encodeURIComponent(project.id)}/members`, session.token) : null,
      ]);
      if (!alive.current || reads.current !== read) return;
      setAccounts(users.accounts); setRevision(current?.revision ?? 0);
      setRoles(Object.fromEntries(users.accounts.map(account => [account.userId, current?.members.find(member => member.userId === account.userId)?.role ??
        (account.userId === session.user.id ? 'admin' : 'none')])));
      setPermissions(Object.fromEntries(users.accounts.map(account=>[account.userId,{...defaultPermissions(),...current?.members.find(member=>member.userId===account.userId)?.permissions}])));
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
    const members = accounts.filter(account => roles[account.userId] !== 'none').map(account => ({ userId: account.userId, role: roles[account.userId],
      ...((session.apiVersion??0)>=6?{permissions:roles[account.userId]==='editor'?permissions[account.userId]??defaultPermissions():defaultPermissions()}:{}), }));
    if ((session.apiVersion ?? 0) < 10) members.forEach(member => { if (member.permissions) delete (member.permissions as Partial<ModulePermissions>).schedule; });
    if ((session.apiVersion ?? 0) < 9) members.forEach(member => { if (member.permissions) delete (member.permissions as Partial<ModulePermissions>).gameplay; });
    if ((session.apiVersion ?? 0) < 7) members.forEach(member => { if (member.permissions) delete (member.permissions as Partial<ModulePermissions>).core; });
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
  return <dialog className="team-dialog team-project-dialog team-members-dialog" ref={dialog} aria-label={project ? '成员管理' : '新建协作项目'}
    onCancel={event => { event.preventDefault(); if (!operating.current) onClose(); }}>
    <form onSubmit={event => void submit(event)}>
      <div className="team-member-dialog-content">
      <h2>{project ? '成员管理' : '新建协作项目'}</h2>
      <p>{project ? project.name : '在当前服务器创建一个空白项目。多个协作项目共用同一台服务器。'}</p>
      <p className="team-project-server">{session.url} · 当前账号：{session.user.username}</p>
      <fieldset disabled={busy || !loaded}>
        {!project && <label>协作项目名称<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} autoFocus /></label>}
        <TeamMemberFields scheduleEnabled={(session.apiVersion ?? 0) >= 10} gameplayEnabled={(session.apiVersion ?? 0) >= 9} coreEnabled={(session.apiVersion ?? 0) >= 7} accounts={accounts} roles={roles} currentUserId={session.user.id} permissions={(session.apiVersion??0)>=6?permissions:undefined}
          onChange={(userId, role) => {setRoles(previous => ({ ...previous, [userId]: role }));setPermissions(previous=>({...previous,[userId]:defaultPermissions()}));}}
          onPermissionChange={(userId,module,value)=>setPermissions(previous=>({...previous,[userId]:{...(previous[userId]??defaultPermissions()),[module]:value}}))}/>
      </fieldset>
      <small>项目管理员可编辑并管理成员；编辑者默认只能查看概览和排期、编辑故事、玩法核心与玩法设计，可单独调整模块权限；只读成员只能查看。当前管理账号保留管理员权限。</small>
      {(session.apiVersion??0)<6&&<p className="team-message">模块权限需要升级服务器后重新连接。</p>}
      {!loaded && !error && <p role="status">正在读取成员…</p>}
      {error && <p className="team-message" role="alert">{error}</p>}
      {(!loaded || conflict) && error && <button type="button" disabled={busy} onClick={() => void load()}>重新读取成员</button>}
      </div>
      <div className="team-dialog-actions"><button type="button" disabled={busy} onClick={onClose}>取消</button>
        <button className="primary" disabled={busy || !loaded || conflict || (!project && !name.trim())}>{busy ? '正在保存…' : project ? '保存成员配置' : '创建并进入协作项目'}</button></div>
    </form>
  </dialog>;
}
