import {useEffect,useState} from 'react';
import {ArrowRight,FolderOpen,Users,Server} from 'lucide-react';
import {TeamLoginForm,type useTeamConnection} from './team-connection';
import {workspaceStorage} from './workspace-storage';
import {roleLabels,type TeamSession,type TeamProject} from './team-api';
import './auth.css';

type EntryMode='local'|'team';
const key='gamecreator.entry-preferences.v1';
export function WorkspaceEntry({connection,onLocal,onConnected,onManageServer,addressRequest}:{connection:ReturnType<typeof useTeamConnection>;onLocal:()=>void;onConnected:(id:string|null)=>void;onManageServer?:()=>void;addressRequest?:{url:string}|null}){
  const [mode,setMode]=useState<EntryMode>(()=>{
    if(new URLSearchParams(location.search).has('team'))return 'team';
    try{return JSON.parse(workspaceStorage.getItem(key)??'null')?.mode==='team'?'team':'local';}catch{return 'local';}
  });
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  useEffect(()=>{document.title='GameCreator · 选择工作区';},[]);
  useEffect(()=>{if(addressRequest)setMode('team');},[addressRequest]);
  const choose=(next:EntryMode)=>{
    if(busy)return;setMode(next);
    try{workspaceStorage.setItem(key,JSON.stringify({schema:1,mode:next}));setNotice('');}catch{setNotice('入口偏好未能保存，本次仍可正常使用。');}
  };
  return <main className="auth-page workspace-entry" aria-label="工作区入口"><section className="entry-card">
    <header className="entry-heading"><div className="auth-logo">✦</div><div><span className="section-kicker">GAMECREATOR</span><h1>开始创作</h1><p>选择本地项目，或加入团队协作。</p></div></header>
    <div className="entry-tabs" role="tablist" aria-label="工作区入口类型">
      <button role="tab" id="entry-local-tab" aria-controls="entry-local-panel" aria-selected={mode==='local'} disabled={busy} onClick={()=>choose('local')}><FolderOpen size={18}/>本地工作区</button>
      <button role="tab" id="entry-team-tab" aria-controls="entry-team-panel" aria-selected={mode==='team'} disabled={busy} onClick={()=>choose('team')}><Users size={18}/>团队协作</button>
    </div>
    <div id="entry-local-panel" role="tabpanel" aria-labelledby="entry-local-tab" hidden={mode!=='local'} className="entry-local"><span className="entry-symbol"><FolderOpen size={32}/></span><h2>在这台电脑上创作</h2><p>直接打开、新建或导入本地项目。<br/>无需账号，也无需连接协作服务器。</p><button className="primary auth-submit" disabled={busy} onClick={()=>{choose('local');onLocal();}}>进入本地工作区<ArrowRight size={17}/></button></div>
    <div id="entry-team-panel" role="tabpanel" aria-labelledby="entry-team-tab" hidden={mode!=='team'}><h2>登录团队协作</h2><p className="entry-description">使用协作服务器上的账号和密码，登录后选择项目。</p><TeamLoginForm connection={connection} startup addressRequest={addressRequest} onBusyChange={setBusy} onConnected={id=>{try{workspaceStorage.setItem(key,JSON.stringify({schema:1,mode:'team'}));}catch{/* A remembered entry is optional. */}onConnected(id);}}/></div>
    <footer className="entry-footer"><span>本地内容与团队项目各自保存</span>{onManageServer&&<button disabled={busy} onClick={onManageServer}><Server size={15}/>管理本机服务器</button>}</footer>
    {notice&&<p role="status" className="auth-hint">{notice}</p>}
  </section></main>;
}

export function TeamProjectSelection({session,projects,error,onSelect,onRefresh,onConnect,onCreate,onManageUsers}:{session:TeamSession;projects:TeamProject[];error:string;onSelect:(id:string)=>void;onRefresh:()=>void;onConnect:()=>void;onCreate?:()=>void;onManageUsers?:()=>void}){
  return <main className="team-project-selection" aria-label="选择协作项目"><header><div><span className="section-kicker">TEAM WORKSPACE</span><h1>{session.invalid?'团队登录已失效':projects.length?'选择协作项目':'尚未加入协作项目'}</h1></div><button onClick={onConnect}>{session.invalid?'重新登录团队':'切换团队账号'}</button></header>
    <p>{session.user.username} · {session.url}</p>
    {error&&<p className="team-message" role="alert">{error}</p>}
    {session.invalid?<p>请使用当前密码重新登录。未提交的草稿保留在本机。</p>:<>
      {!projects.length&&<p>已成功登录。请联系项目管理员将你加入项目。{onCreate?'你也可以创建新的协作项目。':''}</p>}
      <div className="entry-project-grid">{projects.map(p=><button key={p.id} onClick={()=>onSelect(p.id)} aria-label={'进入协作项目：'+p.name}><FolderOpen size={23}/><strong>{p.name}</strong><small>{roleLabels[p.role]}</small><ArrowRight size={17}/></button>)}</div>
    </>}
    <div className="team-actions"><button onClick={onRefresh}>刷新项目列表</button>{onCreate&&<button className="primary" onClick={onCreate}>新建协作项目</button>}{onManageUsers&&<button onClick={onManageUsers}>用户与权限</button>}</div>
  </main>;
}
