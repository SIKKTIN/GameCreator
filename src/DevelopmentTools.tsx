import { useEffect, useRef, useState } from 'react';
import { Wrench, Plus, Copy, Archive, Trash2, ExternalLink, Search, CalendarDays } from 'lucide-react';
import { useLeaveSearch, useSearchRequest } from './GlobalSearch';
import { createDevelopmentTool, createToolTask, developmentToolKinds, developmentToolStatuses, developmentToolPriorities, developmentToolTasks, removeDevelopmentTool, type DevelopmentTool } from './development-tools';
import type { DevelopmentToolsController } from './useDevelopmentTools';
import type { ProjectScheduleController } from './useProjectSchedule';
import type { FunctionalStore } from './functional-systems';
import './development-tools.css';

type Props = { controller: DevelopmentToolsController; schedule: ProjectScheduleController; functional: FunctionalStore; referencesBlocked: boolean; requested?: { id: string }; onOpenTask: (id: string) => void; onOpenCapability: (id: string) => void; onSupplement?: () => Promise<string> };
export function DevelopmentTools({ controller: c, schedule, functional, referencesBlocked, requested, onOpenTask, onOpenCapability, onSupplement }: Props) {
  const [id, setId] = useState(c.store.tools.find(t => !t.archived)?.id || '');
  const [query, setQuery] = useState(''), [kind, setKind] = useState('all'), [status, setStatus] = useState('all'), [range, setRange] = useState('active'), [tab, setTab] = useState('requirements');
  const [creating, setCreating] = useState(false), [name, setName] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), menuRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<Element, string>());
  const openMenu = (toolId: string, button: HTMLElement, x: number, y: number) => {
    scrollPositions.current.clear();
    for (let e: Element | null = button; e; e = e.parentElement) scrollPositions.current.set(e, e.scrollLeft + ':' + e.scrollTop);
    setMenu({ id: toolId, x: Math.max(8, Math.min(x, window.innerWidth - 215)), y: Math.max(8, Math.min(y, window.innerHeight - 120)) });
  };
  const leaveSearch = useLeaveSearch('开发工具');
  const search = useSearchRequest('开发工具', target => c.store.tools.some(t => t.id === target.id));
  useEffect(() => { const target = search || requested; if (target) { setId(target.id); setQuery(''); setKind('all'); setStatus('all'); setRange('all'); setTab('requirements'); } }, [search, requested]);
  useEffect(() => { if (creating) dialog.current?.showModal(); }, [creating]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    const scrolled = (e: Event) => {
      const element = e.target === document ? document.scrollingElement : e.target;
      // Ignore queued notifications from scrolling the card into view before opening its menu.
      if (element instanceof Element && !menuRef.current?.contains(element) && scrollPositions.current.get(element) !== element.scrollLeft + ':' + element.scrollTop) setMenu(null);
    };
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    window.addEventListener('pointerdown', close); window.addEventListener('keydown', key); window.addEventListener('scroll', scrolled, true);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', key); window.removeEventListener('scroll', scrolled, true); };
  }, [menu]);
  const tools = c.store.tools, selected = tools.find(t => t.id === id), linked = selected ? developmentToolTasks(schedule.store, selected.id) : [];
  const filtered = tools.filter(t => (range === 'all' || t.archived === (range === 'archived')) && (kind === 'all' || t.kind === kind) && (status === 'all' || t.status === status) && [t.name, t.purpose, t.audience, t.owner].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  const patch = (values: Partial<DevelopmentTool>) => { if (selected) c.update(s => ({ ...s, tools: s.tools.map(t => t.id === selected.id ? { ...t, ...values } : t) })); };
  const select = (next: string) => { leaveSearch(); setId(next); setMessage(''); };
  const archive = (target: DevelopmentTool) => { c.update(s => ({ ...s, tools: s.tools.map(t => t.id === target.id ? { ...t, archived: !t.archived } : t) })); setMenu(null); };
  const remove = (target: DevelopmentTool) => {
    setMenu(null); if (c.pending || referencesBlocked || schedule.blocked || schedule.pending) { setMessage('请先处理关联模块的保存状态，再删除工具。'); return; }
    try { removeDevelopmentTool(c.store, target.id, schedule.store); } catch (error) { setMessage(String(error)); return; }
    if (window.confirm('删除开发工具「' + target.name + '」？此操作不能撤销。') && c.update(s => removeDevelopmentTool(s, target.id, schedule.store))) { if (id === target.id) setId(''); setMessage('工具已删除'); }
  };
  const backup = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(c.store, null, 2)], { type: 'application/json' })), link = document.createElement('a'); link.href = url; link.download = 'development-tools-draft.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const addTool = () => {
    if (c.blocked || c.pending || tools.length >= 2000 || !name.trim()) return;
    const tool = createDevelopmentTool(name);
    c.update(s => ({ ...s, tools: [...s.tools, tool] }));
    // A failed disk write still creates a recoverable draft; never submit the same creation twice.
    leaveSearch(); setId(tool.id); setRange('active'); setStatus('all'); setKind('all'); setQuery(''); setTab('requirements'); setCreating(false);
  };
  const addTask = () => {
    if (!selected) return;
    const task = createToolTask(selected);
    if (schedule.update(s => ({ ...s, tasks: [...s.tasks, task] }))) onOpenTask(task.id);
    else setMessage('制作任务草稿已保留，请到项目排期检查保存状态。');
  };
  return <section className="dt-page" aria-label="开发工具工作区">
    <div className="dt-heading"><div><span>DEVELOPMENT TOOLS</span><h2>让制作工具，也有明确的交付计划。</h2><p>规划资源制作、编辑与调试工具，记录需求、验收和使用方式，关联项目排期。</p></div><button className="primary" disabled={c.blocked || c.pending || busy || tools.length >= 2000} onClick={() => { setName(''); setCreating(true); }}><Plus size={17}/>新建开发工具</button></div>
    {c.error && <div className="dt-notice" role="alert"><p>{c.error}</p><button onClick={backup}>导出工具草稿</button>{c.pending && <button onClick={c.retry}>重试保存开发工具</button>}<button onClick={() => { if (!c.pending || window.confirm('重新读取会放弃未保存的工具草稿，请先导出备份。')) c.reload(); }}>重新读取开发工具</button></div>}
    {message && <p className="dt-notice" role="status">{message}</p>}
    {onSupplement && <div className="dt-supplement"><div><strong>植物大战僵尸 · 制作工具计划</strong><p>补充缺少的工具、制作任务和工具里程碑。保留已有内容；补充任务的日期留待安排。</p></div><button disabled={busy || c.blocked || c.pending || schedule.blocked || schedule.pending || referencesBlocked} onClick={async () => { setBusy(true); try { setMessage(await onSupplement()); } catch (error) { setMessage(String(error)); } finally { setBusy(false); } }}>{busy ? '正在补充…' : '补充工具与排期'}</button></div>}
    <div className="dt-summary"><span><strong>{tools.filter(t => !t.archived).length}</strong> 使用中条目</span><span><strong>{tools.filter(t => !t.archived && t.status === '可使用').length}</strong> 可使用工具</span><span><strong>{schedule.store.tasks.filter(t => t.references.some(r => r.kind === 'tool')).length}</strong> 关联制作任务</span></div>
    <div className="dt-layout"><aside className="dt-catalog"><label className="dt-search"><Search size={16}/><input aria-label="搜索开发工具" placeholder="搜索工具、用途或负责人…" value={query} onChange={e => { leaveSearch(); setQuery(e.target.value); }}/></label>
      <label>工具分类<select aria-label="开发工具分类筛选" value={kind} onChange={e => { leaveSearch(); setKind(e.target.value); }}><option value="all">全部分类</option>{developmentToolKinds.map(k => <option key={k}>{k}</option>)}</select></label>
      <div className="dt-filters"><select aria-label="开发工具状态筛选" value={status} onChange={e => { leaveSearch(); setStatus(e.target.value); }}><option value="all">全部状态</option>{developmentToolStatuses.map(s => <option key={s}>{s}</option>)}</select><select aria-label="开发工具显示范围" value={range} onChange={e => { leaveSearch(); setRange(e.target.value); }}><option value="active">使用中</option><option value="archived">已归档</option><option value="all">全部条目</option></select></div>
      <div className="dt-cards">{filtered.map(t => <button key={t.id} className={'dt-card' + (t.id === id ? ' selected' : '')} aria-label={'选择开发工具：' + t.name} aria-pressed={t.id === id} onClick={() => select(t.id)} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); openMenu(t.id, e.currentTarget, e.clientX, e.clientY); }} onKeyDown={e => { if (e.key === 'ContextMenu' || e.shiftKey && e.key === 'F10') { e.preventDefault(); const box = e.currentTarget.getBoundingClientRect(); openMenu(t.id, e.currentTarget, box.left + 12, box.top + 24); } }}><span>{t.kind}<i>{t.archived ? '已归档' : t.status}</i></span><strong>{t.name || '未命名工具'}</strong><p>{t.purpose || '填写工具的目标与用途'}</p><small>{t.owner || '未分配'} · {t.priority}优先级 · {developmentToolTasks(schedule.store, t.id).length} 项排期</small></button>)}{!filtered.length && <p className="dt-muted">没有匹配的工具。</p>}</div>
    </aside><div className="dt-content">{selected ? <>
      <div className="dt-title"><div><span>{selected.kind} / {selected.archived ? '已归档' : selected.status}</span><h2>{selected.name || '未命名工具'}</h2><p>使用人员：{selected.audience || '待填写'}</p></div><div className="dt-actions"><button disabled={c.blocked} onClick={() => { const copy = { ...structuredClone(selected), id: crypto.randomUUID(), name: (selected.name + ' · 副本').slice(0, 200), status: '待开发' as const, delivery: '', archived: false }; if (c.update(s => ({ ...s, tools: [...s.tools, copy] }))) { setId(copy.id); setRange('all'); } }}><Copy size={15}/>复制</button><button disabled={c.blocked} onClick={() => archive(selected)}><Archive size={15}/>{selected.archived ? '恢复' : '归档'}</button><button disabled={c.blocked || c.pending || referencesBlocked || schedule.blocked || schedule.pending} onClick={() => remove(selected)}><Trash2 size={15}/>删除</button></div></div>
      <div className="dt-tabs" role="tablist" aria-label="开发工具详情分页">{[['requirements', '工具需求'], ['delivery', '交付与验收'], ['schedule', '开发排期']].map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{label}</button>)}</div>
      {tab === 'requirements' && <fieldset disabled={c.blocked || busy} className="dt-form"><label>工具名称<input aria-label="工具名称" maxLength={200} value={selected.name} onChange={e => patch({ name: e.target.value })}/></label><div className="dt-grid"><label>分类<select aria-label="工具分类" value={selected.kind} onChange={e => patch({ kind: e.target.value as DevelopmentTool['kind'] })}>{developmentToolKinds.map(k => <option key={k}>{k}</option>)}</select></label><label>工具状态<select aria-label="工具状态" value={selected.status} onChange={e => patch({ status: e.target.value as DevelopmentTool['status'] })}>{developmentToolStatuses.map(s => <option key={s}>{s}</option>)}</select></label><label>优先级<select aria-label="工具优先级" value={selected.priority} onChange={e => patch({ priority: e.target.value as DevelopmentTool['priority'] })}>{developmentToolPriorities.map(s => <option key={s}>{s}</option>)}</select></label><label>负责人<input aria-label="工具负责人" maxLength={200} value={selected.owner} onChange={e => patch({ owner: e.target.value })}/></label></div>
        {([['audience', '使用人员'], ['purpose', '用途与目标'], ['scope', '功能范围'], ['environment', '运行环境与兼容性'], ['inputs', '输入内容'], ['outputs', '输出内容']] as const).map(([key, label]) => <label key={key}>{label}<textarea aria-label={label} maxLength={30000} rows={key === 'scope' ? 7 : 3} value={selected[key]} onChange={e => patch({ [key]: e.target.value })}/></label>)}
        <div className="dt-links"><h3>关联程序功能</h3><select aria-label="添加关联程序功能" value="" disabled={referencesBlocked} onChange={e => { if (e.target.value) patch({ capabilityIds: [...selected.capabilityIds, e.target.value] }); }}><option value="">选择相关功能…</option>{functional.capabilities.filter(c => !c.archived && !selected.capabilityIds.includes(c.id) && !functional.systems.find(s => s.id === c.systemId)?.archived).map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select>{selected.capabilityIds.map(ref => { const cap = functional.capabilities.find(c => c.id === ref); return <div className="dt-link" key={ref}><button disabled={!cap || referencesBlocked} onClick={() => onOpenCapability(ref)}><ExternalLink size={14}/>{cap?.name || '来源已删除：' + ref}</button><button aria-label={'移除工具功能关联：' + (cap?.name || ref)} onClick={() => patch({ capabilityIds: selected.capabilityIds.filter(id => id !== ref) })}>移除</button></div>; })}</div>
      </fieldset>}
      {tab === 'delivery' && <fieldset disabled={c.blocked || busy} className="dt-form">{([['acceptance', '验收标准'], ['delivery', '交付位置与版本'], ['usage', '使用说明']] as const).map(([key, label]) => <label key={key}>{label}<textarea aria-label={label} maxLength={30000} rows={key === 'acceptance' ? 8 : 5} value={selected[key]} onChange={e => patch({ [key]: e.target.value })}/></label>)}<p className="dt-muted">交付位置可填写仓库路径、场景入口或文档地址。验收通过后，手动将工具状态设置为“可使用”。</p></fieldset>}
      {tab === 'schedule' && <div className="dt-plan"><div className="dt-plan-heading"><div><h3>制作任务 · {linked.filter(t => t.status === '已完成').length}/{linked.length} 已完成</h3><p>与项目排期共用任务，按岗位跟踪开发与验收。工具状态单独维护。</p></div><button disabled={c.blocked || c.pending || selected.archived || schedule.blocked || schedule.pending} onClick={addTask}><Plus size={16}/>添加制作任务</button></div>{linked.map(t => <button className="dt-task" key={t.id} onClick={() => onOpenTask(t.id)}><CalendarDays size={18}/><div><strong>{t.title}</strong><span>{t.kind} · {t.owner || '未分配'} · {t.start || '待排期'} → {t.end || '待排期'}</span></div><span>{t.status}</span><ExternalLink size={15}/></button>)}{!linked.length && <div className="dt-empty"><CalendarDays size={30}/><h3>将工具开发纳入项目计划</h3><p>添加程序实现任务，再在项目排期中安排日期、依赖、美术验证与测试验收。</p></div>}</div>}
    </> : <div className="dt-empty"><Wrench size={42}/><h2>选择或新建开发工具</h2><p>记录制作人员需要的工具，让需求、实现与验收有据可查。</p></div>}</div></div>
    {menu && tools.find(t => t.id === menu.id) && <div ref={menuRef} className="dt-menu" role="menu" aria-label="开发工具操作" style={{ left: menu.x, top: menu.y }}><button role="menuitem" disabled={c.blocked} onClick={() => archive(tools.find(t => t.id === menu.id)!)}>{tools.find(t => t.id === menu.id)!.archived ? '恢复工具' : '归档工具'}</button><button role="menuitem" disabled={c.blocked || c.pending || referencesBlocked || schedule.blocked || schedule.pending} onClick={() => remove(tools.find(t => t.id === menu.id)!)}>删除工具</button></div>}
    {creating && <dialog ref={dialog} className="dt-dialog" aria-label="新建开发工具" onCancel={() => setCreating(false)}><form onSubmit={e => { e.preventDefault(); addTool(); }}><h2>新建开发工具</h2><label>工具名称<input autoFocus required maxLength={200} value={name} onChange={e => setName(e.target.value)} placeholder="例如：骨骼动画预览工具"/></label><div className="dt-actions"><button type="button" onClick={() => setCreating(false)}>取消</button><button className="primary" disabled={!name.trim() || c.blocked} type="submit">创建工具</button></div></form></dialog>}
  </section>;
}
