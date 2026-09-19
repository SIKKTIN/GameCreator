import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { workspaceStorage } from './workspace-storage';
import { localTeamUrl, teamRequest, type TeamProject, type TeamSession } from './team-api';

const CONNECTION_KEY = 'gamecreator.team-connection.v1';
export type SavedTeamConnection = { url: string; serverId: string; username: string; projects: TeamProject[] };
export const teamProjectKey = (serverId: string, projectId: string) => `team:${encodeURIComponent(serverId)}:${encodeURIComponent(projectId)}`;

export function useTeamConnection() {
  const [initial] = useState(() => {
    try {
      const raw = workspaceStorage.getItem(CONNECTION_KEY);
      const saved: SavedTeamConnection | null = raw ? JSON.parse(raw) : null;
      if (saved && (localTeamUrl(saved.url) !== saved.url || typeof saved.serverId !== 'string' || typeof saved.username !== 'string' || !Array.isArray(saved.projects) ||
        saved.projects.some(item => !item || typeof item.id !== 'string' || typeof item.name !== 'string' || !['admin', 'editor', 'viewer'].includes(item.role)))) throw new Error('连接记录格式无效');
      return { saved, error: '' };
    } catch (error) { return { saved: null, error: '团队连接记录读取失败，可重新连接：' + String(error) }; }
  });
  const [saved, setSaved] = useState(initial.saved), [session, setSession] = useState<TeamSession | null>(null);
  const [open, setOpen] = useState(() => new URLSearchParams(location.search).has('team'));
  const [target, setTarget] = useState<string | null>(null);
  const [requiresAdmin, setRequiresAdmin] = useState(false);
  const [connectionRequest, setConnectionRequest] = useState(0);
  const [error, setError] = useState(initial.error);
  const sessionRef = useRef(session); sessionRef.current = session;
  const savedRef = useRef(saved), requestVersion = useRef(0), directoryPending = useRef(false);
  const remember = useCallback((next: SavedTeamConnection) => {
    if (JSON.stringify(savedRef.current) === JSON.stringify(next) && !directoryPending.current) return;
    savedRef.current = next; setSaved(next);
    try { workspaceStorage.setItem(CONNECTION_KEY, JSON.stringify(next)); directoryPending.current = false; setError(''); }
    catch (reason) { directoryPending.current = true; setError('连接目录未能保存在本机：' + String(reason)); }
  }, []);
  const refreshProjects = useCallback(async () => {
    const current = sessionRef.current; if (!current) return;
    const version = ++requestVersion.current;
    const { projects } = await teamRequest<{ projects: TeamProject[] }>(current.url, '/projects', current.token);
    if (current !== sessionRef.current || version !== requestVersion.current) return;
    remember({ url: current.url, serverId: current.serverId, username: current.user.username, projects });
  }, [remember]);
  useEffect(() => {
    if (!session) return;
    let active = true, timer: number;
    const poll = async () => {
      try { await refreshProjects(); } catch { /* The active project displays connection failures; keep the last directory offline. */ }
      if (active) timer = window.setTimeout(poll, 3000);
    };
    void poll(); return () => { active = false; window.clearTimeout(timer); };
  }, [session, refreshProjects]);
  const addProject = (project: TeamProject) => {
    const current = sessionRef.current; if (!current) return;
    ++requestVersion.current;
    remember({ url: current.url, serverId: current.serverId, username: current.user.username,
      projects: [...(savedRef.current?.projects ?? []).filter(item => item.id !== project.id), project] });
  };
  const connect = async (url: string, username: string, password: string) => {
    const address = localTeamUrl(url);
    const health = await teamRequest<{ service: string; apiVersion: number }>(address, '/health');
    if (health.service !== 'gamecreator-collaboration' || health.apiVersion < 2 || !health.apiVersion) throw new Error('请先重启本机协作服务，以启用完整故事字段和导入功能。');
    const result = await teamRequest<Omit<TeamSession, 'url'>>(address, '/login', '', 'POST', { username, password });
    try {
      if (requiresAdmin && ((result.apiVersion ?? 0) < 3 || result.user.serverRole !== 'admin')) throw new Error('新建协作项目需要使用服务器管理员账号，并将服务升级到最新版本。');
      const { projects } = await teamRequest<{ projects: TeamProject[] }>(address, '/projects', result.token);
      const selected = target ? projects.find(item => teamProjectKey(result.serverId, item.id) === target) : projects[0];
      if (target && !selected) throw new Error('这个账号无法访问所选项目，请确认服务器和项目成员身份。');
      const next = { url: address, serverId: result.serverId, username: result.user.username, projects };
      workspaceStorage.setItem(CONNECTION_KEY, JSON.stringify(next));
      const previous = sessionRef.current;
      ++requestVersion.current; savedRef.current = next;
      sessionRef.current = { ...result, url: address };
      setSaved(next); setSession(sessionRef.current); setError(''); setOpen(false); setTarget(null);
      if (previous) void teamRequest(previous.url, '/logout', previous.token, 'POST').catch(() => {});
      return selected?.id ?? null;
    } catch (reason) { void teamRequest(address, '/logout', result.token, 'POST').catch(() => {}); throw reason; }
  };
  const disconnect = () => {
    const previous = sessionRef.current;
    if (previous) void teamRequest(previous.url, '/logout', previous.token, 'POST').catch(() => {});
    ++requestVersion.current; sessionRef.current = null; setSession(null);
  };
  return { saved, session, open, error, requiresAdmin, connectionRequest, addProject, refreshProjects, connect, disconnect, close: () => setOpen(false),
    resume: () => setOpen(true),
    show: (projectKey: string | null = null, admin = false) => { setTarget(projectKey); setRequiresAdmin(admin); setConnectionRequest(value => value + 1); setOpen(true); } };
}

export function TeamConnectionDialog({ connection, onConnected, onManageServer, addressRequest, onDismiss }: {
  connection: ReturnType<typeof useTeamConnection>; onConnected: (projectId: string | null) => void; onManageServer?: () => void; addressRequest?: { url: string } | null; onDismiss?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const query = new URLSearchParams(location.search).get('team') || '';
  const [url, setUrl] = useState(connection.saved?.url || 'http://127.0.0.1:4747');
  const [username, setUsername] = useState(connection.saved?.username || (['admin','alice','bob','viewer'].includes(query) ? query : 'alice'));
  const [password, setPassword] = useState(username + '123');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (addressRequest) setUrl(addressRequest.url); }, [addressRequest]);
  useEffect(() => { if (connection.requiresAdmin) { setUsername('admin'); setPassword('admin123'); } }, [connection.requiresAdmin, connection.connectionRequest]);
  const close = () => { connection.close(); onDismiss?.(); };
  useEffect(() => {
    if (connection.open) { setError(''); dialog.current?.showModal(); }
    else dialog.current?.close();
  }, [connection.open]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try { const projectId = await connection.connect(url, username, password); onConnected(projectId); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };
  return <dialog className="team-dialog" ref={dialog} aria-labelledby="team-connect-title" onCancel={event => { if (busy) event.preventDefault(); else close(); }}>
    <form onSubmit={submit}><h2 id="team-connect-title">连接团队服务器</h2><p>连接后，团队项目会出现在左上角项目列表中。</p>
      <label>协作服务地址<input aria-label="协作服务地址" value={url} onChange={event => setUrl(event.target.value)} disabled={busy} required /></label>
      {onManageServer && <button type="button" disabled={busy} onClick={onManageServer}>前往服务器管理</button>}
      <label>模拟成员<select aria-label="模拟成员" value={username} disabled={busy} onChange={event => { setUsername(event.target.value); setPassword(event.target.value + '123'); }}>
        <option value="alice">Alice</option><option value="bob">Bob</option><option value="admin">Admin · 服务器管理员</option><option value="viewer">Viewer</option>
      </select></label>
      <label>团队密码<input aria-label="团队密码" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>
      <small>{connection.requiresAdmin ? '请使用服务器管理员账号连接，随后创建协作项目。' : '本机验证账号密码已预填。共享数据保存在团队服务器。'}</small>
      {(error || connection.error) && <p className="team-message" role="alert">{error || connection.error}</p>}
      <div className="team-dialog-actions"><button type="button" disabled={busy} onClick={close}>取消</button><button className="primary" disabled={busy}>{busy ? '正在连接…' : '连接并进入项目'}</button></div>
    </form>
  </dialog>;
}
