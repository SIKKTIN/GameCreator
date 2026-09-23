import type { ReactNode } from 'react';
import { Search, CalendarDays, Map, Layers, Gamepad2, ListTree, Palette, BookOpen, Database, Tag, Settings2, GitBranch, BarChart3, Server, Workflow, Users, PanelsTopLeft, FileCode2, Wrench, BookOpenCheck } from 'lucide-react';

export const workspaceNavigation = [
  ['全局搜索', Search],
  ['项目概览', Layers], ['项目规范', BookOpenCheck], ['项目排期', CalendarDays], ['人员分配', Users], ['玩法核心', Workflow], ['玩法设计', Gamepad2], ['原型设计', PanelsTopLeft], ['地图设计', Map], ['任务与流程', GitBranch], ['数值分析', BarChart3], ['功能系统', ListTree], ['开发工具', Wrench], ['素材资产', Palette], ['故事文档', BookOpen], ['故事编排', BookOpen],
  ['程序框架', FileCode2], ['数据配置', Database], ['数据同步', Workflow], ['枚举定义', Tag], ['枚举管理', Tag], ['引擎设置', Settings2],
] as const;

export function WorkspaceSidebar({ picker, active, onNavigate, team = false, empty = false, teamOverview = false, teamCore = false, teamGameplay = false, teamSchedule = false, onManageServer, onManageUsers, storyEnabled = false, mapEnabled = false, footer }: {
  mapEnabled?: boolean; storyEnabled?: boolean; picker: ReactNode; active: string; onNavigate: (name: string) => void; team?: boolean; empty?: boolean; teamOverview?: boolean; teamCore?: boolean; teamGameplay?: boolean; teamSchedule?: boolean; onManageServer?: () => void; onManageUsers?: () => void; footer: ReactNode;
}) {
  const items = workspaceNavigation.filter(([name]) => (name !== '地图设计' || mapEnabled && !team && !empty) && (name !== '故事编排' || storyEnabled && !team && !empty));
  const unavailable = (name:string) => empty || (team && name !== '全局搜索' && name !== '故事文档' && !(teamOverview && name === '项目概览') && !(teamCore && name === '玩法核心') && !(teamSchedule && name === '项目排期') && !(teamGameplay && name === '玩法设计'));
  return <aside id="workspace-navigation" className="workspace-sidebar" aria-label="主导航栏">
    <div className="brand"><div className="logo">✦</div><div><b>GameCreator</b><small>CONTENT STUDIO</small></div></div>
    {picker}
    <nav aria-label="工作区模块">{items.map(([name, Icon]) => <button key={name} className={active === name ? 'active' : ''}
      disabled={unavailable(name)} title={unavailable(name) ? (empty ? '请先创建或选择项目' : '此模块尚未接入团队共享') : undefined} onClick={() => onNavigate(name)}>
      <Icon size={17} />{name}{!empty && unavailable(name) && <small className="module-unavailable">未接入</small>}
    </button>)}</nav>
    <div className="side-bottom">{(onManageServer || onManageUsers) && <nav className="workspace-admin-nav" aria-label="管理模块">
      <span>管理</span>{onManageServer&&<button type="button" className={active === '服务器管理' ? 'active' : ''} aria-current={active === '服务器管理' ? 'page' : undefined} onClick={onManageServer}><Server size={17} />本机服务器</button>}
      {onManageUsers&&<button type="button" className={active==='用户与权限'?'active':''} aria-current={active==='用户与权限'?'page':undefined} onClick={onManageUsers}><Users size={17}/>用户与权限</button>}
    </nav>}{footer}</div>
  </aside>;
}
