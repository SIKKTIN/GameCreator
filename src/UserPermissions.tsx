import { useCallback, useEffect, useRef, useState } from 'react';
import { beforeLogoutEvent } from './auth';
import { canLeaveTeam, leaveTeamEvent, teamRequest, TeamError, type TeamProject, type TeamSession } from './team-api';
import { TeamProjectDialog } from './TeamProjectDialog';
import { DeleteTeamProjectDialog } from './DeleteTeamProjectDialog';
import './user-permissions.css';

type Account = { id:string; username:string; serverRole:'admin'|'member'; enabled:boolean; revision:number };
type Audit = { id:number;actor:string;action:string;target:string;createdAt:string;details:{projectName?:string} };
type Action = { kind:'create' } | { kind:'edit'|'password'; account:Account };
type ManagedProject = { id:string;name:string;role:TeamProject['role']|null;memberCount?:number;storyCount?:number };
export function UserPermissions({ session,onConnect,onBack,onChanged }: { session:TeamSession|null;onConnect:()=>void;onBack:()=>void;onChanged:()=>void }) {
  return <main className="user-permissions-page" aria-label="用户与权限">
    <header><div><div className="crumb">管理 <span>/</span> 协作服务器</div><h1>用户与权限</h1></div><button onClick={()=>{if(canLeaveTeam())onBack();}}>返回工作区</button></header>
    <p>服务器管理员管理账号及协作项目；项目管理员配置各自项目的成员及模块权限。</p>
    {!session||session.invalid||session.user.serverRole!=='admin'?<section className="overview-panel"><h2>连接服务器管理员</h2>
      <p>{session?.invalid?'团队登录已失效，请重新连接。':session?`当前团队账号 ${session.user.username} 没有服务器管理员权限。`:'连接协作服务器后管理用户和权限。'}</p>
      <button onClick={onConnect}>连接服务器管理员</button></section>
      :(session.apiVersion??0)<6?<p className="team-message" role="alert">请先升级并重启协作服务器，再重新连接，以启用用户与模块权限管理。<button onClick={onConnect}>重新连接</button></p>
      :<UserPermissionsContent key={session.token} session={session} onConnect={onConnect} onChanged={onChanged}/>}
  </main>;
}
function UserPermissionsContent({session,onConnect,onChanged}:{session:TeamSession;onConnect:()=>void;onChanged:()=>void}) {
  const [accounts,setAccounts]=useState<Account[]>([]),[projects,setProjects]=useState<ManagedProject[]>([]),[audit,setAudit]=useState<Audit[]>([]);
  const [error,setError]=useState(''),[denied,setDenied]=useState(false),[loaded,setLoaded]=useState(false),[notice,setNotice]=useState('');
  const [action,setAction]=useState<Action|null>(null),[project,setProject]=useState<TeamProject|null>(null);
  const [deleting,setDeleting]=useState<ManagedProject|null>(null);
  const deletionEnabled=(session.apiVersion??0)>=8;
  const alive=useRef(true),sequence=useRef(0);
  const refresh=useCallback(async()=>{
    const read=++sequence.current;
    try{
      const [users,directory,events]=await Promise.all([
        teamRequest<{accounts:Account[]}>(session.url,'/admin/users',session.token),
        teamRequest<{projects:ManagedProject[]}>(session.url,deletionEnabled?'/admin/projects':'/projects',session.token),
        teamRequest<{audit:Audit[]}>(session.url,'/admin/audit',session.token),
      ]);
      if(!alive.current||read!==sequence.current)return;
      setAccounts(users.accounts);setProjects(directory.projects.filter(item=>deletionEnabled||item.role==='admin'));setAudit(events.audit);setLoaded(true);setDenied(false);setError('');
      setProject(current=>current&&directory.projects.some(item=>item.id===current.id&&item.role==='admin')?current:null);
    }catch(reason){if(alive.current&&read===sequence.current){setError((reason as Error).message);if(reason instanceof TeamError&&[401,403].includes(reason.status)){setDenied(true);setAction(null);setProject(null);setDeleting(null);}}}
  },[session.url,session.token,deletionEnabled]);
  useEffect(()=>{alive.current=true;let active=true,timer:number;const poll=async()=>{await refresh();if(active)timer=window.setTimeout(poll,3000);};void poll();return()=>{alive.current=false;active=false;window.clearTimeout(timer);++sequence.current;};},[refresh]);
  const changed=()=>{void refresh();onChanged();};
  return <>
    <div className="user-manager-context"><span>服务器：{session.url} · {session.user.username}</span><button onClick={()=>void refresh()}>刷新用户与权限</button></div>
    {error&&<p className="team-message" role="alert">{error}{denied&&<button onClick={onConnect}>重新连接管理员</button>}</p>}
    {notice&&<p role="status" className="user-manager-notice">{notice}</p>}
    {!loaded&&!error&&<p>正在读取用户与权限…</p>}
    {!denied&&loaded&&<>
      <section className="overview-panel" aria-label="协作账号管理"><div className="user-manager-heading"><h2>协作账号</h2><button onClick={()=>{if(canLeaveTeam())setAction({kind:'create'});}}>创建协作账号</button></div>
        <p>停用账号会中断其团队访问，历史内容保留；重置密码后需重新登录。账号与本机登录账号分别管理。</p>
        <div className="user-account-table"><table><thead><tr><th>账号</th><th>服务器角色</th><th>状态</th><th>操作</th></tr></thead><tbody>{accounts.map(account=><tr key={account.id}>
          <td>{account.username}{account.id===session.user.id&&<small>当前账号</small>}</td><td>{account.serverRole==='admin'?'服务器管理员':'普通成员'}</td><td>{account.enabled?'已启用':'已停用'}</td>
          <td><div className="team-actions"><button aria-label={'管理账号：'+account.username} onClick={()=>{if(canLeaveTeam())setAction({kind:'edit',account});}}>管理账号</button>
            <button aria-label={'重置密码：'+account.username} onClick={()=>{if(canLeaveTeam())setAction({kind:'password',account});}}>重置密码</button></div></td>
        </tr>)}</tbody></table></div>
      </section>
      <section className="overview-panel" aria-label="项目权限管理"><h2>{deletionEnabled?'协作项目管理':'我管理的协作项目'}</h2><p>编辑者默认概览只读，故事、玩法核心和玩法设计可编辑。项目管理员配置成员权限；服务器管理员可删除此服务器的协作项目。</p>
        {!deletionEnabled&&<p>删除项目需要升级服务器后重新连接。</p>}
        {!projects.length?<p>当前没有可管理的协作项目。</p>:<ul className="user-manager-projects">{projects.map(item=><li key={item.id} data-project-id={item.id}><div><strong>{item.name}</strong><small className="user-project-id">{item.id}</small>{item.memberCount!==undefined&&<small>{item.memberCount} 位成员 · {item.storyCount} 篇故事</small>}</div>
          <div className="team-actions">{item.role==='admin'&&<button aria-label={'配置项目权限：'+item.name} onClick={()=>{if(canLeaveTeam())setProject({...item,role:'admin'});}}>配置成员与权限</button>}
          {deletionEnabled&&<button className="delete-project-button" aria-label={'删除协作项目：'+item.name} onClick={()=>{if(canLeaveTeam())setDeleting(item);}}>删除项目</button>}</div></li>)}</ul>}
      </section>
      <section className="overview-panel"><h2>最近管理操作</h2>{audit.length?<ol className="user-manager-audit">{audit.map(item=><li key={item.id}><strong>{item.action} · {item.details.projectName??item.target}</strong><span>{item.actor} · {new Date(item.createdAt).toLocaleString('zh-CN')}</span></li>)}</ol>:<p>暂无管理操作记录</p>}</section>
    </>}
    {action&&!denied&&<AccountDialog session={session} action={action} onClose={()=>setAction(null)} onSaved={()=>{setNotice(action.kind==='create'?'账号已创建，请在项目中添加成员并配置权限。':action.kind==='password'?'密码已重置，该账号需要重新登录。':'账号配置已保存。');setAction(null);changed();}}/>}
    {project&&!denied&&<TeamProjectDialog session={session} project={project} onClose={()=>setProject(null)} onSaved={changed}/>}
    {deleting&&!denied&&<DeleteTeamProjectDialog session={session} project={deleting} onClose={()=>setDeleting(null)} onDeleted={()=>{setNotice(`协作项目「${deleting.name}」已删除，原本地项目和本机草稿保留。`);setDeleting(null);changed();}}/>}
  </>;
}
function AccountDialog({session,action,onClose,onSaved}:{session:TeamSession;action:Action;onClose:()=>void;onSaved:()=>void}) {
  const original=action.kind==='create'?null:action.account;
  const dialog=useRef<HTMLDialogElement>(null),operating=useRef(false),alive=useRef(true);
  const [base,setBase]=useState(original),[username,setUsername]=useState(original?.username??''),[password,setPassword]=useState('');
  const [serverRole,setServerRole]=useState<'admin'|'member'>(original?.serverRole??'member'),[enabled,setEnabled]=useState(original?.enabled??true);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false);
  const title=action.kind==='create'?'创建协作账号':action.kind==='password'?'重置协作密码':'管理协作账号';
  useEffect(()=>{alive.current=true;dialog.current?.showModal();return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    const guard=(event:Event)=>{if(operating.current)event.preventDefault();},unload=(event:BeforeUnloadEvent)=>{if(operating.current){event.preventDefault();event.returnValue='';}};
    window.addEventListener(beforeLogoutEvent,guard);window.addEventListener(leaveTeamEvent,guard);window.addEventListener('beforeunload',unload);
    return()=>{window.removeEventListener(beforeLogoutEvent,guard);window.removeEventListener(leaveTeamEvent,guard);window.removeEventListener('beforeunload',unload);};
  },[]);
  const reload=async()=>{
    if(!base||operating.current)return;operating.current=true;setBusy(true);
    try{const result=await teamRequest<{accounts:Account[]}>(session.url,'/admin/users',session.token),next=result.accounts.find(item=>item.id===base.id);
      if(!next)throw new Error('账号不存在');if(alive.current){setBase(next);setServerRole(next.serverRole);setEnabled(next.enabled);setConflict(false);setError('');}}
    catch(reason){if(alive.current)setError((reason as Error).message);}finally{operating.current=false;if(alive.current)setBusy(false);}
  };
  const save=async()=>{
    if(operating.current||conflict)return;operating.current=true;setBusy(true);setError('');
    try{
      if(action.kind==='create')await teamRequest(session.url,'/admin/users',session.token,'POST',{username,password,serverRole});
      else if(base)await teamRequest(session.url,`/admin/users/${encodeURIComponent(base.id)}${action.kind==='password'?'/password':''}`,session.token,action.kind==='password'?'POST':'PUT',
        action.kind==='password'?{revision:base.revision,password}:{revision:base.revision,enabled,serverRole});
      if(alive.current){setPassword('');onSaved();}
    }catch(reason){if(alive.current){setError(reason instanceof TeamError&&reason.status===0?'操作结果尚未确认，请关闭窗口并刷新列表核对后再试。':(reason as Error).message);if(reason instanceof TeamError&&reason.status===409&&base)setConflict(true);}}
    finally{operating.current=false;if(alive.current)setBusy(false);}
  };
  return <dialog className="team-dialog team-project-dialog user-account-dialog" ref={dialog} aria-label={title} onCancel={event=>{event.preventDefault();if(!operating.current)onClose();}}>
    <form onSubmit={event=>{event.preventDefault();void save();}}><h2>{title}</h2>
      <fieldset disabled={busy||conflict}>
        {action.kind==='create'?<label>新账号<input aria-label="新账号" required minLength={3} maxLength={40} pattern="[a-zA-Z0-9][a-zA-Z0-9_.\-]{2,39}" autoComplete="off" value={username} onChange={event=>setUsername(event.target.value)}/><small>3–40 位英文字母、数字、点、下划线或短横线</small></label>:<p>账号：<strong>{username}</strong></p>}
        {action.kind!=='edit'&&<label>{action.kind==='create'?'初始密码':'新密码'}<input aria-label={action.kind==='create'?'初始密码':'新密码'} type="password" required minLength={8} maxLength={256} autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)}/><small>8–256 个字符</small></label>}
        {action.kind!=='password'&&<label>服务器角色<select aria-label="服务器角色" value={serverRole} onChange={event=>setServerRole(event.target.value as 'admin'|'member')}><option value="member">普通成员</option><option value="admin">服务器管理员</option></select></label>}
        {action.kind==='edit'&&<label>账号状态<select aria-label="账号状态" value={enabled?'enabled':'disabled'} onChange={event=>setEnabled(event.target.value==='enabled')}><option value="enabled">启用</option><option value="disabled">停用</option></select></label>}
      </fieldset>
      {action.kind==='password'&&<p>保存后，此账号的现有登录会话失效，已保存内容和本机草稿保留。</p>}
      {action.kind==='edit'&&!enabled&&<p>停用后，此账号将无法连接服务器，已有会话也会失效。请先为它管理的项目保留其他有效管理员。</p>}
      {error&&<p className="team-message" role="alert">{error}</p>}{conflict&&<button type="button" disabled={busy} onClick={()=>void reload()}>重新读取账号</button>}
      <div className="team-dialog-actions"><button type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy||conflict}>{busy?'正在保存…':action.kind==='create'?'创建账号':action.kind==='password'?'确认重置密码':'保存账号配置'}</button></div>
    </form>
  </dialog>;
}
