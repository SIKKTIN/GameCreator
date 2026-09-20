import type {ReactNode} from 'react';
import {PanelLeftClose,PanelLeftOpen} from 'lucide-react';
import {useWorkspaceNavigation} from './useWorkspaceNavigation';
import type {TeamSession} from './team-api';
import './auth.css';

export const beforeLogoutEvent='gamecreator:before-logout';

export function WorkspaceShell({children,session,teamWorkspace,onHome,onDisconnect,onProjects}:{children:ReactNode;session:TeamSession|null;teamWorkspace:boolean;onHome:()=>void;onDisconnect:()=>void;onProjects:()=>void}){
  const navigation=useWorkspaceNavigation();
  return <div className={`authenticated-shell${navigation.visible?'':' navigation-hidden'}`}>
    <div className="auth-toolbar">
      <button className="auth-navigation-toggle" type="button" onClick={navigation.toggle} aria-label={navigation.visible?'隐藏主导航栏':'显示主导航栏'} title={navigation.visible?'隐藏主导航栏':'显示主导航栏'} aria-expanded={navigation.visible} aria-controls="workspace-navigation">{navigation.visible?<PanelLeftClose size={18}/>:<PanelLeftOpen size={18}/>}</button>
      {navigation.saveError&&<span className="auth-preference-status" role="status">导航状态仅在本次会话生效，未能保存偏好</span>}
      <span>{teamWorkspace&&session?<>团队账号：<b>{session.user.username}</b><em>{session.invalid?'登录已失效':session.user.serverRole==='admin'?'服务器管理员':'团队成员'}</em></>:<b>本地工作区</b>}</span>
      {session&&<><button className="auth-logout" onClick={onProjects}>团队项目</button><button className="auth-logout" onClick={onDisconnect}>退出团队账号</button></>}
      <button className="auth-logout" onClick={onHome}>返回启动页</button>
    </div>{children}
  </div>;
}
