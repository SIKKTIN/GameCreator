import type { ReactNode } from 'react';
import { Layers, Gamepad2, ListTree, Palette, BookOpen, Database, Tag, Settings2, GitBranch, BarChart3 } from 'lucide-react';

export const workspaceNavigation = [
  ['项目概览', Layers], ['玩法设计', Gamepad2], ['功能系统', ListTree], ['美术资产', Palette], ['故事文档', BookOpen],
  ['数据配置', Database], ['枚举定义', Tag], ['枚举管理', Tag], ['引擎设置', Settings2], ['任务与流程', GitBranch], ['数值分析', BarChart3],
] as const;

export function WorkspaceSidebar({ picker, active, onNavigate, team = false, admin = true, footer }: {
  picker: ReactNode; active: string; onNavigate: (name: string) => void; team?: boolean; admin?: boolean; footer: ReactNode;
}) {
  const items = admin || team ? workspaceNavigation : workspaceNavigation.filter(([name]) => !['枚举管理', '引擎设置'].includes(name));
  return <aside className="workspace-sidebar">
    <div className="brand"><div className="logo">✦</div><div><b>GameCreator</b><small>CONTENT STUDIO</small></div></div>
    {picker}
    <nav aria-label="工作区模块">{items.map(([name, Icon]) => <button key={name} className={active === name ? 'active' : ''}
      disabled={team && name !== '故事文档'} title={team && name !== '故事文档' ? '此模块尚未接入团队共享' : undefined} onClick={() => onNavigate(name)}>
      <Icon size={17} />{name}{team && name !== '故事文档' && <small className="module-unavailable">未接入</small>}
    </button>)}</nav>
    <div className="side-bottom">{footer}</div>
  </aside>;
}
