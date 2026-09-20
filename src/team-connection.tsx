import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {Eye,EyeOff} from 'lucide-react';
import {beforeLogoutEvent} from './auth';
import {leaveTeamEvent} from './team-api';
import { workspaceStorage } from './workspace-storage';
import { localTeamUrl, teamRequest, TeamError, type TeamProject, type TeamSession } from './team-api';

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
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [requiresAdmin, setRequiresAdmin] = useState(false);
  const [connectionRequest, setConnectionRequest] = useState(0);
  const [error, setError] = useState(initial.error);
  const sessionRef = useRef(session); sessionRef.current = session;
  const savedRef = useRef(saved), requestVersion = useRef(0), directoryPending = useRef(false), connectVersion = useRef(0);
  const remember = useCallback((next: SavedTeamConnection) => {
    if (JSON.stringify(savedRef.current) === JSON.stringify(next) && !directoryPending.current) { setError(''); return; }
    savedRef.current = next; setSaved(next);
    try { workspaceStorage.setItem(CONNECTION_KEY, JSON.stringify(next)); directoryPending.current = false; setError(''); }
    catch (reason) { directoryPending.current = true; setError('连接目录未能保存在本机：' + String(reason)); }
  }, []);
  const refreshProjects = useCallback(async () => {
    const current = sessionRef.current; if (!current || current.invalid) return;
    const version = ++requestVersion.current;
    let result: { projects: TeamProject[]; user?: TeamSession['user'] };
    try { result = await teamRequest(current.url, '/projects', current.token); }
    catch (reason) {
      if (reason instanceof TeamError && reason.status === 401 && current === sessionRef.current) {
        const invalid = { ...current, invalid: true }; sessionRef.current = invalid; setSession(invalid); setError(reason.message);
      }
      else if (current === sessionRef.current && version === requestVersion.current) setError('无法刷新团队项目，请检查服务器连接后重试。');
      throw reason;
    }
    if (current !== sessionRef.current || version !== requestVersion.current) return;
    remember({ url: current.url, serverId: current.serverId, username: current.user.username, projects: result.projects });
    if (result.user && result.user.serverRole !== current.user.serverRole) {
      const next = { ...current, user: result.user }; sessionRef.current = next; setSession(next);
    }
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
    const attempt=++connectVersion.current;
    const check=()=>{if(attempt!==connectVersion.current)throw new Error('登录已取消，请重新连接。');};
    const address = localTeamUrl(url);
    check();
    const health = await teamRequest<{ service: string; apiVersion: number }>(address, '/health');
    check();
    if (health.service !== 'gamecreator-collaboration' || health.apiVersion < 2 || !health.apiVersion) throw new Error('请先重启本机协作服务，以启用完整故事字段和导入功能。');
    const result = await teamRequest<Omit<TeamSession, 'url'>>(address, '/login', '', 'POST', { username, password });
    try {
      check();
      if (requiresAdmin && ((result.apiVersion ?? 0) < 3 || result.user.serverRole !== 'admin')) throw new Error('此操作需要使用服务器管理员账号，并将服务升级到最新版本。');
      const { projects } = await teamRequest<{ projects: TeamProject[] }>(address, '/projects', result.token);
      check();
      const selected = target ? projects.find(item => teamProjectKey(result.serverId, item.id) === target) : projects.length===1?projects[0]:undefined;
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
    ++connectVersion.current;setOpen(false);setTarget(null);setRequiresAdmin(false);
    const previous = sessionRef.current;
    if (previous) void teamRequest(previous.url, '/logout', previous.token, 'POST').catch(() => {});
    ++requestVersion.current; sessionRef.current = null; setSession(null);
  };
  return { saved, session, open, error, requiresAdmin, connectionRequest, addProject, refreshProjects, connect, disconnect, close: () => setOpen(false),
    resume: () => setOpen(true),
    show: (projectKey: string | null = null, admin = false) => { setTarget(projectKey); setRequiresAdmin(admin); setConnectionRequest(value => value + 1); setOpen(true); } };
}

export function TeamLoginForm({connection,onConnected,onManageServer,addressRequest,onCancel,onBusyChange,startup=false}:{
  connection:ReturnType<typeof useTeamConnection>;onConnected:(id:string|null)=>void;onManageServer?:()=>void;addressRequest?:{url:string}|null;onCancel?:()=>void;onBusyChange?:(busy:boolean)=>void;startup?:boolean;
}){
  const query=new URLSearchParams(location.search).get('team')||'';
  const [url,setUrl]=useState(connection.saved?.url||'http://127.0.0.1:4747'),[username,setUsername]=useState(connection.saved?.username||query),[password,setPassword]=useState('');
  const [visible,setVisible]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const operating=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{if(addressRequest)setUrl(addressRequest.url);},[addressRequest]);
  useEffect(()=>{if(!startup){setError('');setPassword('');setVisible(false);setUrl(connection.saved?.url||'http://127.0.0.1:4747');setUsername(connection.requiresAdmin?'admin':connection.saved?.username||query);}},[connection.connectionRequest]);
  useEffect(()=>{
    const guard=(e:Event)=>{if(operating.current)e.preventDefault();};
    const close=(e:BeforeUnloadEvent)=>{if(operating.current){e.preventDefault();e.returnValue='';}};
    window.addEventListener(beforeLogoutEvent,guard);window.addEventListener(leaveTeamEvent,guard);window.addEventListener('beforeunload',close);
    return()=>{window.removeEventListener(beforeLogoutEvent,guard);window.removeEventListener(leaveTeamEvent,guard);window.removeEventListener('beforeunload',close);};
  },[]);
  const submit=async(e:FormEvent)=>{
    e.preventDefault();if(operating.current)return;operating.current=true;setBusy(true);onBusyChange?.(true);setError('');
    try{const id=await connection.connect(url,username,password);if(alive.current){setPassword('');setVisible(false);onConnected(id);}}
    catch(reason){if(alive.current)setError(reason instanceof TeamError&&reason.status===0?'无法连接协作服务器，请确认服务已启动且地址正确。':reason instanceof TeamError&&reason.status===401?'团队账号或密码错误，请使用服务器上该账号的密码。':(reason as Error).message);}
    finally{operating.current=false;onBusyChange?.(false);if(alive.current)setBusy(false);}
  };
  return <form className="team-login-form" aria-label="团队账号登录" onSubmit={submit}>
    <label>服务器地址<input aria-label="协作服务地址" value={url} onChange={e=>setUrl(e.target.value)} disabled={busy} required autoComplete="url" spellCheck={false}/></label>
    <label>团队账号<input aria-label="团队账号" value={username} onChange={e=>setUsername(e.target.value)} disabled={busy} required maxLength={80} autoComplete="username" placeholder="例如 alice"/></label>
    <label htmlFor={startup?'entry-team-password':'dialog-team-password'}>团队密码</label><div className="team-password-field"><input id={startup?'entry-team-password':'dialog-team-password'} aria-label="团队密码" type={visible?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} disabled={busy} required maxLength={256} autoComplete="current-password"/><button type="button" disabled={busy} aria-label={visible?'隐藏团队密码':'显示团队密码'} aria-pressed={visible} onClick={()=>setVisible(v=>!v)}>{visible?<EyeOff size={17}/>:<Eye size={17}/>}</button></div>
    <small>{connection.requiresAdmin?'请使用服务器管理员账号，登录后继续管理操作。':'账号由服务器管理员创建；重置密码后请使用新密码。'}</small>
    {(error||connection.error)&&<p className="team-message" role="alert">{error||connection.error}</p>}
    <div className="team-dialog-actions">{onCancel&&<button type="button" disabled={busy} onClick={onCancel}>取消</button>}<button className="primary auth-submit" disabled={busy}>{busy?'正在连接…':startup?'登录团队协作':'连接并进入项目'}</button></div>
    {onManageServer&&<button className="team-host-link" type="button" disabled={busy} onClick={onManageServer}>管理本机服务器</button>}
  </form>;
}

export function TeamConnectionDialog({connection,onConnected,onManageServer,addressRequest,onDismiss}:{connection:ReturnType<typeof useTeamConnection>;onConnected:(id:string|null)=>void;onManageServer?:()=>void;addressRequest?:{url:string}|null;onDismiss?:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),[busy,setBusy]=useState(false);
  const close=()=>{connection.close();onDismiss?.();};
  useEffect(()=>{if(connection.open)dialog.current?.showModal();else dialog.current?.close();},[connection.open]);
  return <dialog className="team-dialog" ref={dialog} aria-labelledby="team-connect-title" onCancel={e=>{e.preventDefault();if(!busy)close();}}>
    <h2 id="team-connect-title">连接团队服务器</h2><p>使用团队账号登录，再选择可访问的协作项目。</p>
    <TeamLoginForm connection={connection} onConnected={onConnected} onManageServer={onManageServer} addressRequest={addressRequest} onCancel={close} onBusyChange={setBusy}/>
  </dialog>;
}
