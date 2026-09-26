import type { ReactNode } from 'react';
import { Search, CalendarDays, Map, Layers, Gamepad2, ListTree, Palette, BookOpen, Database, Tag, Settings2, GitBranch, BarChart3, Server, Workflow, Users, PanelsTopLeft, FileCode2, Wrench, BookOpenCheck, ChevronDown, Rocket, FolderSync, type LucideIcon } from 'lucide-react';
import './workspace-sidebar.css';
import { useWorkspaceNavigationGroups } from './useWorkspaceNavigation';

type NavigationItem = readonly [string, LucideIcon];
type NavigationGroup = { id: string; label: string; icon: LucideIcon; children: readonly NavigationItem[] };

const workspaceNavigation: readonly NavigationItem[] = [['全局搜索', Search], ['项目概览', Layers]];
const navigationGroups: NavigationGroup[] = [
  { id: 'project-guide', label: '项目指南', icon: BookOpen, children: [['项目规范', BookOpenCheck], ['使用说明', BookOpen]] },
  { id: 'project-management', label: '项目管理', icon: Users, children: [['项目启动', Rocket], ['工程连接', Settings2], ['人员分配', Users], ['项目排期', CalendarDays], ['任务清单', ListTree]] },
  { id: 'gameplay', label: '玩法与关卡', icon: Gamepad2, children: [['玩法核心', Workflow], ['玩法设计', Gamepad2], ['原型设计', PanelsTopLeft], ['地图设计', Map], ['任务与流程', GitBranch], ['数值分析', BarChart3]] },
  { id: 'development', label: '系统与开发', icon: Wrench, children: [['功能系统', ListTree], ['程序框架', FileCode2], ['开发工具', Wrench]] },
  { id: 'content', label: '内容制作', icon: Palette, children: [['素材资产', Palette], ['故事文档', BookOpen], ['故事编排', BookOpen]] },
  { id: 'data-engine', label: '数据与同步', icon: Database, children: [['数据配置', Database], ['枚举定义', Tag], ['枚举管理', Tag], ['数据同步', Workflow], ['工程同步', FolderSync]] },
];

export function WorkspaceSidebar({ picker, active, onNavigate, team = false, empty = false, teamOverview = false, teamCore = false, teamGameplay = false, teamSchedule = false, onManageServer, onManageUsers, storyEnabled = false, mapEnabled = false, footer }: {
  mapEnabled?: boolean; storyEnabled?: boolean; picker: ReactNode; active: string; onNavigate: (name: string) => void; team?: boolean; empty?: boolean; teamOverview?: boolean; teamCore?: boolean; teamGameplay?: boolean; teamSchedule?: boolean; onManageServer?: () => void; onManageUsers?: () => void; footer: ReactNode;
}) {
  const activeGroup = navigationGroups.find(group => group.children.some(([name]) => name === active))?.id;
  const { collapsed, toggle, saveError } = useWorkspaceNavigationGroups(active, activeGroup);
  const visible = ([name]: NavigationItem) => (name !== '地图设计' || mapEnabled && !team && !empty) && (name !== '故事编排' || storyEnabled && !team && !empty);
  const unavailable = (name:string) => empty || (team && name !== '全局搜索' && name !== '故事文档' && !(teamOverview && name === '项目概览') && !(teamCore && name === '玩法核心') && !(teamSchedule && name === '项目排期') && !(teamGameplay && name === '玩法设计'));
  const moduleButton = (name: string, Icon: LucideIcon) => <button key={name} type="button" className={active === name ? 'active' : ''}
    aria-current={active === name ? 'page' : undefined} disabled={unavailable(name)}
    title={unavailable(name) ? (empty ? '请先创建或选择项目' : '此模块尚未接入团队共享') : undefined} onClick={() => onNavigate(name)}>
    <Icon size={17} />{name === '任务与流程' ? '游戏任务与流程' : name}{!empty && unavailable(name) && <small className="module-unavailable">未接入</small>}
  </button>;
  return <aside id="workspace-navigation" className="workspace-sidebar" aria-label="主导航栏">
    <div className="brand"><div className="logo">✦</div><div><b>GameCreator</b><small>CONTENT STUDIO</small></div></div>
    {picker}
    <nav aria-label="工作区模块">
      {workspaceNavigation.map(([name, Icon]) => moduleButton(name, Icon))}
      {navigationGroups.map(({ id, label, icon: Icon, children }) => <div key={id} className="workspace-nav-group">
        <button type="button" className={`workspace-nav-group-toggle${activeGroup === id ? ' contains-current' : ''}`}
          aria-expanded={!collapsed.includes(id)} aria-controls={`${id}-submenu`} onClick={() => toggle(id)}>
          <Icon size={17} />{label}<ChevronDown size={15} className="workspace-nav-chevron" />
        </button>
        <div id={`${id}-submenu`} role="group" aria-label={`${label}子菜单`} className="workspace-nav-submenu" hidden={collapsed.includes(id)}>
          {children.filter(visible).map(([name, Icon]) => moduleButton(name, Icon))}
        </div>
      </div>)}
    </nav>
    {saveError && <p className="workspace-nav-save-error" role="status">菜单展开状态暂未保存，当前仍可使用。</p>}
    <div className="side-bottom">{(onManageServer || onManageUsers) && <nav className="workspace-admin-nav" aria-label="管理模块">
      <span>管理</span>{onManageServer&&<button type="button" className={active === '服务器管理' ? 'active' : ''} aria-current={active === '服务器管理' ? 'page' : undefined} onClick={onManageServer}><Server size={17} />本机服务器</button>}
      {onManageUsers&&<button type="button" className={active==='用户与权限'?'active':''} aria-current={active==='用户与权限'?'page':undefined} onClick={onManageUsers}><Users size={17}/>用户与权限</button>}
    </nav>}{footer}</div>
  </aside>;
}
