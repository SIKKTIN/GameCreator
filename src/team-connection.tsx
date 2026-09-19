import { useEffect, useRef, useState, type FormEvent } from 'react';
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
  const [error, setError] = useState(initial.error);
  const sessionRef = useRef(session); sessionRef.current = session;
  const connect = async (url: string, username: string, password: string) => {
    const address = localTeamUrl(url);
    const health = await teamRequest<{ service: string; apiVersion: number }>(address, '/health');
    if (health.service !== 'gamecreator-collaboration' || health.apiVersion < 2 || !health.apiVersion) throw new Error('请先重启本机协作服务，以启用完整故事字段和导入功能。');
    const result = await teamRequest<Omit<TeamSession, 'url'>>(address, '/login', '', 'POST', { username, password });
    try {
      const { projects } = await teamRequest<{ projects: TeamProject[] }>(address, '/projects', result.token);
      if (!projects.length) throw new Error('当前账号尚未加入任何团队项目');
      const selected = target ? projects.find(item => teamProjectKey(result.serverId, item.id) === target) : projects[0];
      if (!selected) throw new Error('这个账号无法访问所选项目，请确认服务器和项目成员身份。');
      const next = { url: address, serverId: result.serverId, username: result.user.username, projects };
      workspaceStorage.setItem(CONNECTION_KEY, JSON.stringify(next));
      const previous = sessionRef.current;
      setSaved(next); setSession({ ...result, url: address }); setError(''); setOpen(false); setTarget(null);
      if (previous) void teamRequest(previous.url, '/logout', previous.token, 'POST').catch(() => {});
      return selected.id;
    } catch (reason) { void teamRequest(address, '/logout', result.token, 'POST').catch(() => {}); throw reason; }
  };
  const disconnect = () => {
    const previous = sessionRef.current;
    if (previous) void teamRequest(previous.url, '/logout', previous.token, 'POST').catch(() => {});
    setSession(null);
  };
  return { saved, session, open, error, connect, disconnect, close: () => setOpen(false),
    resume: () => setOpen(true),
    show: (projectKey: string | null = null) => { setTarget(projectKey); setOpen(true); } };
}

export function TeamConnectionDialog({ connection, onConnected, onManageServer, addressRequest }: {
  connection: ReturnType<typeof useTeamConnection>; onConnected: (projectId: string) => void; onManageServer?: () => void; addressRequest?: { url: string } | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const query = new URLSearchParams(location.search).get('team') || '';
  const [url, setUrl] = useState(connection.saved?.url || 'http://127.0.0.1:4747');
  const [username, setUsername] = useState(connection.saved?.username || (['admin','alice','bob','viewer'].includes(query) ? query : 'alice'));
  const [password, setPassword] = useState(username + '123');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (addressRequest) setUrl(addressRequest.url); }, [addressRequest]);
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
  return <dialog className="team-dialog" ref={dialog} aria-labelledby="team-connect-title" onCancel={event => { if (busy) event.preventDefault(); else connection.close(); }}>
    <form onSubmit={submit}><h2 id="team-connect-title">连接团队服务器</h2><p>连接后，团队项目会出现在左上角项目列表中。</p>
      <label>协作服务地址<input aria-label="协作服务地址" value={url} onChange={event => setUrl(event.target.value)} disabled={busy} required /></label>
      {onManageServer && <button type="button" disabled={busy} onClick={onManageServer}>前往服务器管理</button>}
      <label>模拟成员<select aria-label="模拟成员" value={username} disabled={busy} onChange={event => { setUsername(event.target.value); setPassword(event.target.value + '123'); }}>
        <option value="alice">Alice · 编辑者</option><option value="bob">Bob · 编辑者</option><option value="admin">Admin · 管理员</option><option value="viewer">Viewer · 只读成员</option>
      </select></label>
      <label>团队密码<input aria-label="团队密码" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>
      <small>本机验证账号密码已预填。共享数据保存在团队服务器。</small>
      {(error || connection.error) && <p className="team-message" role="alert">{error || connection.error}</p>}
      <div className="team-dialog-actions"><button type="button" disabled={busy} onClick={connection.close}>取消</button><button className="primary" disabled={busy}>{busy ? '正在连接…' : '连接并进入项目'}</button></div>
    </form>
  </dialog>;
}
