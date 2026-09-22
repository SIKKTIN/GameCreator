import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Check, Circle, ArrowRight, RotateCcw, ExternalLink, AlertTriangle, GitBranch, Minus, Plus } from 'lucide-react';
import { productionKinds, productionStatuses, type ProductionTask, type ProjectScheduleStore, type ScheduleIssue } from './project-schedule';
import { scheduleProgressLayout, progressGeometry as geometry, type ProgressEdge } from './schedule-progress';
import './schedule-progress.css';

const colors: Record<ProductionTask['kind'], string> = { 设计: '#b799ed', 程序: '#82b9ee', 美术: '#e7a0cb', 关卡: '#e6c27c', 测试: '#82cdb6', 其他: '#b1acbf' };
function edgePath({ from, to, cyclic }: ProgressEdge) {
  const x = from.x + geometry.width, y = from.y + geometry.height / 2, tx = to.x, ty = to.y + geometry.height / 2;
  if (cyclic) return `M ${x} ${y} C ${x + 40} ${y}, ${x + 40} ${to.y - 15}, ${to.x + geometry.width / 2} ${to.y - 15} L ${to.x + geometry.width / 2} ${to.y}`;
  const bend = Math.max(26, (tx - x) * .5);
  return `M ${x} ${y} C ${x + bend} ${y}, ${tx - bend} ${ty}, ${tx} ${ty}`;
}
type Props = { store: ProjectScheduleStore; tasks: ProductionTask[]; issues: ScheduleIssue[]; disabled: boolean; saveLabel: string; onOpen: (id: string) => void; onStatus: (task: ProductionTask, status: ProductionTask['status']) => void };

export function ScheduleProgress({ store, tasks, issues, disabled, saveLabel, onOpen, onStatus }: Props) {
  const [role, setRole] = useState('all'), [selectedId, setSelectedId] = useState('');
  const [zoom, setZoom] = useState(1);
  const marker = useId().replace(/:/g, ''), scroll = useRef<HTMLDivElement>(null);
  const matching = useMemo(() => new Set(tasks.filter(t => role === 'all' || t.kind === role).map(t => t.id)), [tasks, role]);
  const layout = useMemo(() => scheduleProgressLayout(store.tasks, matching, role === 'all' ? undefined : new Set([role as ProductionTask['kind']])), [store.tasks, matching, role]);
  const selected = store.tasks.find(t => t.id === selectedId), related = new Set(selected ? [selected.id, ...selected.dependencyIds, ...store.tasks.filter(t => t.dependencyIds.includes(selected.id)).map(t => t.id)] : []);
  useEffect(() => { if (role !== 'all' && !store.tasks.some(t => t.kind === role)) setRole('all'); }, [role, store.tasks]);
  useEffect(() => { if (selectedId && !matching.has(selectedId)) setSelectedId(''); }, [selectedId, matching]);
  const totals = store.tasks.filter(t => role === 'all' || t.kind === role), completed = totals.filter(t => t.status === '已完成').length;
  const select = (id: string) => { setSelectedId(id); };
  const focusNode = (id: string) => { setSelectedId(id); scroll.current?.querySelector<HTMLElement>(`[data-progress-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' }); };
  return <section className="sp-view" aria-label="按岗位查看任务进度">
    <div className="sp-heading"><div><span className="sch-kicker">TEAM PROGRESS</span><h3>每个岗位，都有清晰的推进线路。</h3><p>按前置依赖从左向右推进，同列任务可并行。点击节点查看交接关系，勾选圆钮标记完成。</p></div><label>岗位线路<select aria-label="任务进度岗位筛选" value={role} onChange={e => setRole(e.target.value)}><option value="all">全部岗位</option>{productionKinds.filter(k => store.tasks.some(t => t.kind === k)).map(k => <option key={k}>{k}</option>)}</select></label></div>
    <div className="sp-overview"><div><strong>{totals.length ? Math.round(completed / totals.length * 100) : 0}%</strong><span>{role === 'all' ? '全部岗位' : role} · 已完成 {completed}/{totals.length}</span></div><progress aria-label="岗位任务完成率" max={Math.max(totals.length, 1)} value={completed}/><span>当前显示 {matching.size} 项</span></div>
    <div className="sp-legend"><span><i className="sp-dot"/>待开始</span><span><i className="sp-dot active"/>进行中</span><span><i className="sp-dot review"/>待验收</span><span><i className="sp-dot done"/>已完成</span><span><i className="sp-dot blocked"/>受阻</span><span>依赖 <ArrowRight size={14}/></span><div className="sp-map-tools"><button aria-label="缩小任务线路" disabled={zoom <= .4} onClick={() => setZoom(v => Math.max(.4, Math.round((v - .1) * 100) / 100))}><Minus size={14}/></button><output aria-label="任务线路缩放比例">{Math.round(zoom * 100)}%</output><button aria-label="放大任务线路" disabled={zoom >= 1.25} onClick={() => setZoom(v => Math.min(1.25, Math.round((v + .1) * 100) / 100))}><Plus size={14}/></button><button onClick={() => { if (scroll.current) setZoom(Math.max(.4, Math.min(1, Math.floor(scroll.current.clientWidth / layout.width * 100) / 100))); }}>适应宽度</button><button onClick={() => setZoom(1)}>原始大小</button></div></div>
    {!matching.size ? <div className="sch-no-results">当前筛选下没有制作任务。调整岗位、搜索或状态筛选后查看。</div> : <div ref={scroll} className="sp-scroll" tabIndex={0} aria-label="任务进度线路画布，可横向滚动">
      <div className="sp-canvas" style={{ width: layout.width, height: layout.height, zoom }}>
        <div className="sp-axis" style={{ width: layout.width }}><span className="sp-axis-label">岗位 / 完成情况</span>{Array.from({ length: layout.columns }, (_, index) => <span key={index} style={{ left: geometry.left + 28 + index * geometry.column, width: geometry.width }}>{index === 0 ? '起步任务' : `推进阶段 ${index + 1}`}</span>)}</div>
        {layout.lanes.map(lane => <div className="sp-lane" key={lane.kind} style={{ top: lane.y, height: lane.height, width: layout.width, '--lane-color': colors[lane.kind] } as CSSProperties}><div className="sp-lane-label"><div><i/>{lane.kind}</div><strong>{lane.completed}<small> / {lane.total}</small></strong><progress aria-label={lane.kind + '完成率'} max={lane.total} value={lane.completed}/><small>显示 {lane.visible} 项</small></div>{!lane.visible && <p className="sp-lane-empty">此岗位没有匹配当前筛选的任务</p>}</div>)}
        <svg className="sp-edges" width={layout.width} height={layout.height} aria-hidden="true"><defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs>{layout.edges.map(edge => {
          const highlighted = !selected || edge.from.task.id === selected.id || edge.to.task.id === selected.id;
          return <path key={edge.from.task.id + '/' + edge.to.task.id} className={'sp-edge' + (highlighted ? ' highlighted' : '') + (edge.cyclic ? ' cyclic' : '')} d={edgePath(edge)} stroke={edge.cyclic ? '#ea9caa' : edge.from.task.status === '已完成' ? '#82cdb6' : colors[edge.from.task.kind]} markerEnd={`url(#${marker})`}/>;
        })}</svg>
        {layout.nodes.map(node => {
          const task = node.task, waiting = task.dependencyIds.filter(id => store.tasks.find(t => t.id === id)?.status !== '已完成').length, done = task.status === '已完成';
          const warnings = issues.filter(i => i.taskId === task.id), isSelected = selected?.id === task.id;
          return <article key={task.id} data-progress-id={task.id} className={'sp-node status-' + task.status + (isSelected ? ' selected' : '') + (selected && !related.has(task.id) ? ' dimmed' : '')} style={{ left: node.x, top: node.y, width: geometry.width, height: geometry.height, '--lane-color': colors[task.kind] } as CSSProperties} aria-label={'任务节点：' + task.title}>
            <div className="sp-node-top"><span className={'sch-status sch-status-' + task.status}>{task.status}</span><button className="sp-complete" aria-label={(done ? '重新打开任务：' : '标记任务完成：') + task.title} aria-pressed={done} title={done ? '重新打开，恢复进行中' : '标记完成'} disabled={disabled} onClick={() => { select(task.id); onStatus(task, done ? '进行中' : '已完成'); }}>{done ? <Check size={17}/> : <Circle size={17}/>}</button></div>
            <button className="sp-node-main" aria-label={'查看任务进度：' + task.title} aria-pressed={isSelected} onClick={() => select(task.id)}><strong title={task.title}>{task.title || '未命名任务'}</strong><span>{task.owner || '未分配负责人'} · {task.end ? '计划完成 ' + task.end : '待安排日期'}</span></button>
            <div className="sp-node-bottom"><span title={store.milestones.find(m => m.id === task.milestoneId)?.title}>{store.milestones.find(m => m.id === task.milestoneId)?.title || '未分组'}</span>{!!warnings.length && <button aria-label={'查看进度提醒：' + task.title} title={warnings.map(i => i.message).join('\n')} onClick={() => onOpen(task.id)}><AlertTriangle size={13}/></button>}</div>
            <small className={'sp-dependency' + (node.cyclic ? ' invalid' : '')}>{node.cyclic ? '循环依赖 · 需要调整' : waiting ? `等待 ${waiting} 项前置` : task.dependencyIds.length ? '前置已完成' : '无前置任务'}</small>
          </article>;
        })}
      </div>
    </div>}
    {selected && <div className="sp-inspector" role="region" aria-label="选中任务进度"><div className="sp-inspector-heading"><div><span>{selected.kind} · {selected.owner || '未分配负责人'}</span><h4>{selected.title}</h4></div><div className="sch-actions"><label>制作状态<select aria-label="选中任务制作状态" value={selected.status} disabled={disabled} onChange={e => onStatus(selected, e.target.value as ProductionTask['status'])}>{productionStatuses.map(s => <option key={s}>{s}</option>)}</select></label><button onClick={() => onOpen(selected.id)}><ExternalLink size={14}/>编辑任务详情</button><button aria-label="清除进度节点选择" onClick={() => setSelectedId('')}><RotateCcw size={14}/>查看全部线路</button></div></div>
      <div className="sp-relations">{([['前置交接', selected.dependencyIds], ['后续任务', store.tasks.filter(t => t.dependencyIds.includes(selected.id)).map(t => t.id)]] as const).map(([label, ids]) => <div key={label}><strong><GitBranch size={14}/>{label}</strong>{!ids.length && <span>暂无</span>}{ids.map(id => { const task = store.tasks.find(t => t.id === id); return task ? <button key={id} onClick={() => matching.has(id) ? focusNode(id) : onOpen(id)}>{task.kind} · {task.title}<small>{task.status}{!matching.has(id) ? ' · 筛选外' : ''}</small></button> : <span key={id} className="sp-missing">前置任务已失效</span>; })}</div>)}</div>
      {selected.status === '已完成' && !selected.result.trim() && <p className="sch-muted">已标记完成。可在任务详情中补充验收结果。</p>}
    </div>}
    <div className="sp-footer"><span>完成率按任务数量统计；筛选不改变岗位总完成率。</span><span role="status">{saveLabel}</span></div>
  </section>;
}
