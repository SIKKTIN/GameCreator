import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ChevronDown, ChevronRight, Flag, Link2 } from 'lucide-react';
import { moveProductionTask, scheduleDay, shiftScheduleDate, type ProductionTask, type ProjectScheduleStore } from './project-schedule';

type Props = { store: ProjectScheduleStore; tasks: ProductionTask[]; groupBy: string; start: string; days: number; today: string; disabled: boolean; onOpen: (id: string) => void; onMilestone: (id: string) => void; onMove: (task: ProductionTask, original: ProductionTask) => void };
const dayWidth = 34;
export function ScheduleTimeline({ store, tasks, groupBy, start, days, today, disabled, onOpen, onMilestone, onMove }: Props) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const groups = new Map<string, { name: string; milestoneId?: string; tasks: ProductionTask[] }>();
  if (groupBy === 'milestone') for (const m of store.milestones) groups.set(m.id, { name: m.title || '未命名里程碑', milestoneId: m.id, tasks: [] });
  for (const task of tasks) {
    const key = groupBy === 'milestone' ? task.milestoneId : groupBy === 'kind' ? task.kind : task.owner.trim();
    if (!groups.has(key)) groups.set(key, { name: groupBy === 'milestone' ? '未分组' : key || '未分配', tasks: [] });
    groups.get(key)!.tasks.push(task);
  }
  const dates = Array.from({ length: days }, (_, i) => shiftScheduleDate(start, i)), width = days * dayWidth, todayX = (scheduleDay(today) - scheduleDay(start)) * dayWidth;
  const toggle = (key: string) => setCollapsed(s => s.includes(key) ? s.filter(k => k !== key) : [...s, key]);
  return <div className="sch-timeline-scroll" aria-label="制作排期时间轴"><div className="sch-timeline" style={{ width: 240 + width, '--day-width': dayWidth + 'px' } as React.CSSProperties}>
    <div className="sch-time-row sch-time-header"><div className="sch-time-name">制作任务 / 负责人</div><div className="sch-time-dates">{dates.map(date => <div key={date} className={(date === today ? 'is-today ' : '') + ([0, 6].includes(new Date(date + 'T00:00:00Z').getUTCDay()) ? 'is-weekend' : '')}><small>{date.slice(8) === '01' || date === start ? date.slice(5, 7) + '月' : ''}</small><span>{Number(date.slice(8))}</span></div>)}</div></div>
    {[...groups].map(([key, group]) => { const m = store.milestones.find(m => m.id === group.milestoneId), x = m?.due ? (scheduleDay(m.due) - scheduleDay(start)) * dayWidth : -1; return <div key={key}>
      <div className="sch-time-row sch-time-group"><button className="sch-time-name" aria-label={(collapsed.includes(key) ? '展开排期分组：' : '收起排期分组：') + group.name} aria-expanded={!collapsed.includes(key)} onClick={() => toggle(key)}>{collapsed.includes(key) ? <ChevronRight size={15}/> : <ChevronDown size={15}/>}<strong>{group.name}</strong><small>{group.tasks.length}</small></button><div className="sch-time-lane">{m && x >= 0 && x < width && <button className="sch-milestone-pin" style={{ left: x }} title={m.title + ' · ' + m.due} aria-label={'打开时间轴里程碑：' + m.title} onClick={() => onMilestone(m.id)}><Flag size={17}/></button>}</div></div>
      {!collapsed.includes(key) && group.tasks.map(task => <div className="sch-time-row" key={task.id}><button className="sch-time-name sch-task-name" onClick={() => onOpen(task.id)} title={task.title}><span><strong>{task.title || '未命名任务'}</strong><small>{task.owner || '未分配'} · {task.kind}</small></span>{task.dependencyIds.length > 0 && <Link2 size={13}/>}</button><div className="sch-time-lane">{todayX >= 0 && todayX < width && <span className="sch-today-line" style={{ left: todayX }}/>}<TaskBar task={task} start={start} width={width} disabled={disabled} onOpen={() => onOpen(task.id)} onMove={onMove}/></div></div>)}
    </div>; })}
    {!groups.size && <p className="sch-timeline-empty">没有匹配的制作任务。</p>}
  </div></div>;
}
function TaskBar({ task, start, width, disabled, onOpen, onMove }: { task: ProductionTask; start: string; width: number; disabled: boolean; onOpen: () => void; onMove: Props['onMove'] }) {
  const [preview, setPreview] = useState<ProductionTask | null>(null), drag = useRef<{ x: number; mode: 'move' | 'start' | 'end'; original: ProductionTask; next: ProductionTask; moved: boolean } | null>(null), suppressClick = useRef(false);
  useEffect(() => { const escape = (e: KeyboardEvent) => { if (e.key === 'Escape' && drag.current) { drag.current = null; setPreview(null); suppressClick.current = true; } }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape); }, []);
  const shown = preview || task, left = shown.start ? (scheduleDay(shown.start) - scheduleDay(start)) * dayWidth : 0, length = shown.start && shown.end ? (scheduleDay(shown.end) - scheduleDay(shown.start) + 1) * dayWidth : 0;
  if (!task.start || !task.end) return <button className="sch-unscheduled" onClick={onOpen}>待排期 · 填写起止日期</button>;
  if (!preview && (left >= width || left + length <= 0)) return <button className="sch-unscheduled" onClick={onOpen}>{task.start} → {task.end} · 不在当前时段</button>;
  const pointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault(); const mode = (e.target as HTMLElement).closest<HTMLElement>('[data-resize]')?.dataset.resize as 'start' | 'end' | undefined;
    drag.current = { x: e.clientX, mode: mode || 'move', original: structuredClone(task), next: task, moved: false }; suppressClick.current = false; e.currentTarget.setPointerCapture(e.pointerId);
  };
  const finish = (e: PointerEvent<HTMLDivElement>, cancel = false) => {
    const current = drag.current; if (!current) return; drag.current = null; setPreview(null); suppressClick.current = current.moved || cancel;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!cancel && current.moved) onMove(current.next, current.original);
  };
  const keyboard = (e: React.KeyboardEvent, mode: 'move' | 'start' | 'end') => { if (disabled || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); onMove(moveProductionTask(task, e.key === 'ArrowRight' ? 1 : -1, mode), task); };
  return <div className={'sch-bar sch-status-' + task.status + (preview ? ' dragging' : '')} role="button" tabIndex={0} aria-label={'排期条：' + task.title} title={shown.start + ' → ' + shown.end + ' · ' + task.status + '；拖动移动，边缘调整日期；方向键移动一天'} style={{ left: Math.max(0, left) + 2, width: Math.max(20, Math.min(width, left + length) - Math.max(0, left) - 4) }}
    onPointerDown={pointerDown} onPointerMove={e => { const current = drag.current; if (!current) return; const delta = Math.round((e.clientX - current.x) / dayWidth); if (Math.abs(e.clientX - current.x) > 4) current.moved = true; current.next = moveProductionTask(current.original, delta, current.mode); setPreview(current.next); }} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)} onLostPointerCapture={e => { if (drag.current) finish(e, true); }}
    onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onOpen(); }} onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } else keyboard(e, 'move'); }}>
    {left >= 0 && <button disabled={disabled} className="sch-resize start" data-resize="start" aria-label={'调整开始日期：' + task.title} onClick={e => e.stopPropagation()} onKeyDown={e => keyboard(e, 'start')}/>}
    <span>{shown.title}</span>{task.dependencyIds.length > 0 && <Link2 size={12}/>}
    {left + length <= width && <button disabled={disabled} className="sch-resize end" data-resize="end" aria-label={'调整结束日期：' + task.title} onClick={e => e.stopPropagation()} onKeyDown={e => keyboard(e, 'end')}/>}
  </div>;
}
