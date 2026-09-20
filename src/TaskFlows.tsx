import { useEffect, useId, useRef, useState } from 'react';
import { Plus, GitBranch, Target, Copy, Archive, Play, RotateCcw } from 'lucide-react';
import { advanceTaskPreview, copyTask, createTask, createTaskStage, referenceKinds, referenceLabels, removeTaskStage, startTaskPreview, taskFlowIssues, taskKinds, taskReferenceLabel, taskScopes, taskStageReady, type TaskDefinition, type TaskPreview, type TaskReference, type TaskSources, type TaskStage } from './task-flow';
import type { TaskFlowsController } from './useTaskFlows';
import './task-flow.css';

const stageLabels = { objective: '目标阶段', success: '成功结果', failure: '失败结果' };
const display = (name: string) => name.trim() || '未命名';
type Props = { requestedTask?: { id: string }; storyLinks?: { id: string; title: string; taskIds: string[] }[]; onOpenStory?: (id: string) => void; controller: TaskFlowsController; sources: TaskSources; onOpenReference: (ref: TaskReference) => void };

export function TaskFlows({ controller, sources, onOpenReference, requestedTask, storyLinks = [], onOpenStory }: Props) {
  const { store, update, blocked } = controller;
  const [selected, setSelected] = useState(''), [query, setQuery] = useState(''), [range, setRange] = useState('active');
  const [tab, setTab] = useState('details'), [stageId, setStageId] = useState(''), [newName, setNewName] = useState(''), [error, setError] = useState('');
  useEffect(() => { if(requestedTask) { setSelected(requestedTask.id); setQuery(''); setRange('all'); setTab('details'); setError(''); } }, [requestedTask]);
  const dialog = useRef<HTMLDialogElement>(null);
  const task = store.tasks.find(t => t.id === selected), disabled = blocked || !!task?.archived;
  const stage = task?.stages.find(s => s.id === stageId) ?? task?.stages[0];
  const issues = taskFlowIssues(store, sources), taskIssues = issues.filter(i => i.taskId === selected);
  const choose = (id: string) => { setSelected(id); setStageId(''); setError(''); };
  const change = (operation: (task: TaskDefinition) => TaskDefinition) => {
    if (!task || disabled) return;
    try { const next = operation(structuredClone(task)); update(s => ({ ...s, tasks: s.tasks.map(t => t.id === task.id ? next : t) })); setError(''); }
    catch (e) { setError(String(e)); }
  };
  const patch = (fields: Partial<TaskDefinition>) => change(t => ({ ...t, ...fields }));
  const changeStage = (fields: Partial<TaskStage>) => change(t => ({ ...t, stages: t.stages.map(s => s.id === stage?.id ? { ...s, ...fields } : s) }));
  const addStage = (kind: TaskStage['kind']) => { const s = createTaskStage(kind); change(t => ({ ...t, startId: t.startId || s.id, stages: [...t.stages, s] })); setStageId(s.id); };
  const backup = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'task-flows-draft.json'; a.click(); URL.revokeObjectURL(url); };
  return <div className="gp-workspace tf-workspace">
    <aside className="gp-library" aria-label="任务目录">
      <div className="gp-library-heading"><div><span className="gp-kicker">PLAYER PROGRESSION</span><h2>任务与流程 <small>{store.tasks.filter(t => !t.archived).length}</small></h2></div><Target size={22} /></div>
      <p className="gp-muted">组织玩家目标、分支与解锁，让内容逐步展开。</p>
      <button className="primary tf-create" disabled={blocked} onClick={() => { setNewName(''); dialog.current?.showModal(); }}><Plus size={15} />新建任务</button>
      <label className="gp-search"><input aria-label="搜索任务" placeholder="搜索任务或说明…" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <label className="gp-field">目录范围<select aria-label="任务目录范围" value={range} onChange={e => setRange(e.target.value)}><option value="active">使用中</option><option value="archived">已归档</option><option value="all">全部</option></select></label>
      <div className="gp-list">{store.tasks.filter(t => (range === 'all' || t.archived === (range === 'archived')) && (t.title + t.summary).toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(t => <button className={'gp-list-card' + (selected === t.id ? ' selected' : '')} key={t.id} aria-label={'选择任务：' + display(t.title)} onClick={() => choose(t.id)}>
        <span className="gp-badge">{t.kind} · {t.scope}</span><strong>{display(t.title)}</strong><p>{t.summary || '填写目标与推进过程'}</p><small>{t.stages.length} 个阶段 · {t.archived ? '已归档' : t.status}{issues.some(i => i.taskId === t.id) ? ' · 待完善' : ''}</small>
      </button>)}</div>
      {!store.tasks.length && <p className="gp-muted">从一个委托、探索目标或挑战开始。</p>}
    </aside>
    <section className="gp-detail">
      {(controller.pending || controller.blocked) && <div className="tf-notice"><p>可先导出当前草稿，再重新读取磁盘存档。</p><div className="gp-actions"><button className="gp-secondary" onClick={backup}>导出任务草稿</button><button className="gp-secondary" onClick={() => { if (!controller.pending || window.confirm('重新读取会丢弃当前未保存的任务草稿。请先导出备份。继续？')) controller.reload(); }}>重新读取任务存档</button></div></div>}
      {!task ? <div className="tf-empty"><GitBranch size={40} /><h2>把目标连接成玩家的旅程</h2><p>选择任务，或创建第一个目标。简单任务也可以只有一个目标阶段和一个完成结果。</p><div className="tf-steps"><span>目标与条件</span><span>阶段与分支</span><span>结果与解锁</span></div></div> : <>
        <div className="gp-editor-heading"><div><span className="gp-kicker">{task.kind} / {task.scope}</span><h2>{display(task.title)}</h2><p className="gp-muted">设计状态：{task.status}{task.archived ? ' · 已归档，只读' : ''}</p></div><div className="gp-actions">
          <button className="gp-secondary" disabled={blocked} onClick={() => { const next = copyTask(task); update(s => ({ ...s, tasks: [...s.tasks, next] })); setRange('active'); setQuery(''); choose(next.id); }}><Copy size={14} />复制任务</button>
          <button className="gp-secondary" disabled={blocked} onClick={() => { update(s => ({ ...s, tasks: s.tasks.map(t => t.id === task.id ? { ...t, archived: !t.archived } : t) })); setRange(task.archived ? 'active' : 'archived'); }}><Archive size={14} />{task.archived ? '恢复任务' : '归档任务'}</button>
        </div></div>
        {storyLinks.some(s=>s.taskIds.includes(task.id)) && <div className="ns-card"><h3>关联故事编排</h3><div className="gp-actions">{storyLinks.filter(s=>s.taskIds.includes(task.id)).map(s=><button className="gp-secondary" key={s.id} onClick={()=>onOpenStory?.(s.id)}>{s.title}</button>)}</div></div>}
        <div className="tf-tabs" aria-label="任务编辑视图">{[['details', '任务设置'], ['stages', '阶段与分支'], ['preview', '流程与预览']].map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
        {error && <p role="alert" className="field-error">{error}</p>}
        {taskIssues.length > 0 && <details className="tf-issues"><summary>设计检查 · {taskIssues.length} 项待完善</summary><ul>{taskIssues.map((i, n) => <li key={n}>{i.stageId ? <button onClick={() => { setStageId(i.stageId!); setTab('stages'); }}>{i.message}</button> : i.message}</li>)}</ul></details>}
        {tab === 'details' && <fieldset className="tf-fields" disabled={disabled}>
          <div className="tf-card"><h3>任务定义</h3><label className="gp-field">任务名称<input aria-label="任务名称" value={task.title} onChange={e => patch({ title: e.target.value })} /></label>
            <div className="tf-grid"><label className="gp-field">任务类型<select aria-label="任务类型" value={task.kind} onChange={e => patch({ kind: e.target.value as TaskDefinition['kind'] })}>{taskKinds.map(k => <option key={k}>{k}</option>)}</select></label>
              <label className="gp-field">进度范围<select aria-label="进度范围" value={task.scope} onChange={e => patch({ scope: e.target.value as TaskDefinition['scope'] })}>{taskScopes.map(k => <option key={k}>{k}</option>)}</select></label>
              <label className="gp-field">设计状态<select aria-label="设计状态" value={task.status} onChange={e => patch({ status: e.target.value as TaskDefinition['status'] })}><option>草稿</option><option>已确认</option></select></label></div>
            <label className="gp-field">任务说明<textarea aria-label="任务说明" rows={3} value={task.summary} onChange={e => patch({ summary: e.target.value })} placeholder="玩家要完成什么，以及为什么要做" /></label>
            <p className="gp-muted">进度范围说明游戏中何时保留或重置进度。具体计时、重置与奖励由关联玩法和程序功能定义。</p>
          </div>
          <div className="tf-card"><h3>开放与后续解锁</h3><label className="gp-field">额外开放条件<textarea aria-label="额外开放条件" rows={2} value={task.availability} onChange={e => patch({ availability: e.target.value })} placeholder="例如：第三天后，且已获得矿洞钥匙" /></label>
            <label className="gp-field">前置任务满足方式<select aria-label="前置任务满足方式" value={task.prerequisiteMode} onChange={e => patch({ prerequisiteMode: e.target.value as 'all' | 'any' })}><option value="all">全部成功完成</option><option value="any">任一成功完成</option></select></label>
            {task.prerequisiteIds.map(id => <div className="tf-reference" key={id}><span>{store.tasks.find(t => t.id === id)?.title || '前置任务已失效：' + id}</span><button className="gp-secondary" aria-label={'移除前置：' + id} onClick={() => patch({ prerequisiteIds: task.prerequisiteIds.filter(p => p !== id) })}>移除</button></div>)}
            <label className="gp-field">添加前置任务<select aria-label="添加前置任务" value="" onChange={e => { if (e.target.value) patch({ prerequisiteIds: [...task.prerequisiteIds, e.target.value] }); }}><option value="">选择任务…</option>{store.tasks.filter(t => t.id !== task.id && !t.archived && !task.prerequisiteIds.includes(t.id)).map(t => <option key={t.id} value={t.id}>{display(t.title)}</option>)}</select></label>
            <p className="gp-muted">成功完成后可推进以下任务的前置条件：</p><div className="gp-actions">{store.tasks.filter(t => t.prerequisiteIds.includes(task.id)).map(t => <button type="button" className="gp-secondary" key={t.id} onClick={() => { choose(t.id); setRange('all'); setQuery(''); }}>{display(t.title)}{t.archived ? '（已归档）' : ''}</button>)}</div>
          </div>
          <TaskReferences task={task} sources={sources} onChange={references => patch({ references })} onOpen={onOpenReference} />
        </fieldset>}
        {tab === 'stages' && <fieldset className="tf-fields" disabled={disabled}>
          <div className="tf-card"><div className="gp-card-heading"><h3>阶段目录</h3><div className="gp-actions"><button className="gp-secondary" onClick={() => addStage('objective')}>添加目标阶段</button><button className="gp-secondary" onClick={() => addStage('success')}>添加成功结果</button><button className="gp-secondary" onClick={() => addStage('failure')}>添加失败结果</button></div></div>
            <label className="gp-field">起始阶段<select aria-label="起始阶段" value={task.startId} onChange={e => patch({ startId: e.target.value })}><option value="">未设置</option>{task.startId && !task.stages.some(s => s.id === task.startId) && <option value={task.startId}>起点已失效</option>}{task.stages.map(s => <option key={s.id} value={s.id}>{display(s.title)}</option>)}</select></label>
            <div className="tf-stage-list">{task.stages.map(s => <button className={s.id === stage?.id ? 'selected' : ''} key={s.id} onClick={() => setStageId(s.id)} aria-label={'编辑阶段：' + display(s.title)}><span>{stageLabels[s.kind]}</span><strong>{display(s.title)}</strong>{s.id === task.startId && <small>起点</small>}</button>)}</div>
          </div>
          {stage && <div className="tf-card"><div className="gp-card-heading"><h3>{stageLabels[stage.kind]}</h3><button className="gp-secondary" onClick={() => change(t => removeTaskStage(t, stage.id))}>删除阶段</button></div>
            <label className="gp-field">阶段名称<input aria-label="阶段名称" value={stage.title} onChange={e => changeStage({ title: e.target.value })} /></label><label className="gp-field">阶段说明<textarea aria-label="阶段说明" rows={2} value={stage.description} onChange={e => changeStage({ description: e.target.value })} /></label>
            {stage.kind === 'objective' ? <>
              <label className="gp-field">阶段目标满足方式<select aria-label="阶段目标满足方式" value={stage.mode} onChange={e => changeStage({ mode: e.target.value as 'all' | 'any' })}><option value="all">全部目标</option><option value="any">任一目标</option></select></label>
              {stage.objectives.map((o, i) => <div className="tf-objective" key={o.id}><div className="tf-grid"><label className="gp-field">目标名称 {i + 1}<input aria-label={"目标名称 " + (i + 1)} value={o.title} onChange={e => changeStage({ objectives: stage.objectives.map(v => v.id === o.id ? { ...v, title: e.target.value } : v) })} /></label><label className="gp-field">目标数量 {i + 1}<input aria-label={"目标数量 " + (i + 1)} type="number" min={1} step={1} value={o.target} onChange={e => { const target = Number(e.target.value); if (Number.isSafeInteger(target) && target > 0) changeStage({ objectives: stage.objectives.map(v => v.id === o.id ? { ...v, target } : v) }); }} /></label></div>
                <label className="gp-field">达成条件 {i + 1}<textarea aria-label={"达成条件 " + (i + 1)} rows={2} value={o.condition} onChange={e => changeStage({ objectives: stage.objectives.map(v => v.id === o.id ? { ...v, condition: e.target.value } : v) })} placeholder="触发事件、计数口径和需要满足的条件" /></label><button className="gp-secondary" onClick={() => changeStage({ objectives: stage.objectives.filter(v => v.id !== o.id) })}>删除目标 {i + 1}</button></div>)}
              <button className="gp-secondary" onClick={() => changeStage({ objectives: [...stage.objectives, { id: crypto.randomUUID(), title: '', condition: '', target: 1 }] })}>添加目标</button>
              <h3>离开此阶段的分支</h3><p className="gp-muted">阶段目标达成后选择分支。失败路径可使用“挑战结束”等中立目标，再按结果分流。</p>
              {task.transitions.filter(e => e.fromId === stage.id).map((edge, i) => <div className="tf-objective" key={edge.id}><div className="tf-grid"><label className="gp-field">分支名称 {i + 1}<input aria-label={"分支名称 " + (i + 1)} value={edge.label} onChange={e => patch({ transitions: task.transitions.map(v => v.id === edge.id ? { ...v, label: e.target.value } : v) })} /></label><label className="gp-field">目标阶段 {i + 1}<select aria-label={"目标阶段 " + (i + 1)} value={edge.toId} onChange={e => patch({ transitions: task.transitions.map(v => v.id === edge.id ? { ...v, toId: e.target.value } : v) })}><option value="">请选择</option>{edge.toId && !task.stages.some(s => s.id === edge.toId) && <option value={edge.toId}>目标已失效</option>}{task.stages.map(s => <option key={s.id} value={s.id}>{display(s.title)}</option>)}</select></label></div><label className="gp-field">分支条件 {i + 1}<textarea aria-label={"分支条件 " + (i + 1)} rows={2} value={edge.condition} onChange={e => patch({ transitions: task.transitions.map(v => v.id === edge.id ? { ...v, condition: e.target.value } : v) })} /></label><button className="gp-secondary" onClick={() => patch({ transitions: task.transitions.filter(v => v.id !== edge.id) })}>删除分支 {i + 1}</button></div>)}
              <button className="gp-secondary" onClick={() => patch({ transitions: [...task.transitions, { id: crypto.randomUUID(), fromId: stage.id, toId: '', label: '继续', condition: '' }] })}>添加分支</button>
            </> : <label className="gp-field">完成结果<textarea aria-label="完成结果" rows={4} value={stage.result} onChange={e => changeStage({ result: e.target.value })} placeholder="奖励、设置的标志、解锁内容或失败后的处理" /></label>}
          </div>}
        </fieldset>}
        {tab === 'preview' && <><TaskGraph task={task} onSelect={id => { setStageId(id); setTab('stages'); }} /><TaskPathPreview key={task.id} task={task} tasks={store.tasks} /></>}
      </>}
    </section>
    <dialog ref={dialog} className="gp-dialog" aria-label="新建任务"><form onSubmit={e => { e.preventDefault(); if (!newName.trim() || blocked) return; const next = createTask(newName); update(s => ({ ...s, tasks: [...s.tasks, next] })); choose(next.id); setRange('active'); setQuery(''); setTab('details'); dialog.current?.close(); }}><h2>新建任务</h2><p className="gp-muted">只需名称，目标和分支可以逐步补充。</p><label className="gp-field">新任务名称<input aria-label="新任务名称" autoFocus value={newName} maxLength={150} onChange={e => setNewName(e.target.value)} /></label><div className="gp-actions"><button type="button" className="gp-secondary" onClick={() => dialog.current?.close()}>取消</button><button className="primary" disabled={blocked || !newName.trim()}>创建任务</button></div></form></dialog>
  </div>;
}

function TaskReferences({ task, sources, onChange, onOpen }: { task: TaskDefinition; sources: TaskSources; onChange: (refs: TaskReference[]) => void; onOpen: (ref: TaskReference) => void }) {
  const [kind, setKind] = useState<TaskReference['kind']>('gameplay'), [targetId, setTarget] = useState(''), [recordId, setRecord] = useState('');
  const options = kind === 'table' ? sources.definitions.map(t => ({ id: t.key, title: t.label })) : (kind === 'gameplay' ? sources.designs : kind === 'capability' ? sources.capabilities : kind === 'story' ? sources.stories : sources.assets).filter(t => !t.archived).map(t => ({ id: t.id, title: t.title || t.name || '未命名' }));
  const valid = options.some(t => t.id === targetId) && (kind !== 'table' || !recordId || sources.data.datasets[targetId]?.some(r => r.id === recordId));
  return <div className="tf-card"><h3>关联内容</h3><p className="gp-muted">引用现有设计与配置；名称变化会随来源更新。</p>{task.references.map((ref, i) => { const info = taskReferenceLabel(ref, sources); return <div className="tf-reference" key={JSON.stringify(ref)}><button className="tf-link" disabled={!info.available} onClick={() => onOpen(ref)}>{referenceLabels[ref.kind]} · {info.label}</button><button className="gp-secondary" aria-label={'解除引用：' + info.label} onClick={() => onChange(task.references.filter((_, n) => n !== i))}>解除</button></div>; })}
    <div className="tf-grid"><label className="gp-field">引用类型<select aria-label="引用类型" value={kind} onChange={e => { setKind(e.target.value as TaskReference['kind']); setTarget(''); setRecord(''); }}>{referenceKinds.map(k => <option key={k} value={k}>{referenceLabels[k]}</option>)}</select></label><label className="gp-field">引用内容<select aria-label="引用内容" value={targetId} onChange={e => { setTarget(e.target.value); setRecord(''); }}><option value="">选择内容…</option>{options.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
      {kind === 'table' && <label className="gp-field">配置记录<select aria-label="配置记录" value={recordId} onChange={e => setRecord(e.target.value)}><option value="">整张配置表</option>{(sources.data.datasets[targetId] || []).map(r => <option key={r.id} value={r.id}>{r.name || r.title || r.id}</option>)}</select></label>}</div>
    <button className="gp-secondary" disabled={!valid || task.references.some(r => r.kind === kind && r.targetId === targetId && r.recordId === recordId)} onClick={() => { onChange([...task.references, { kind, targetId, recordId }]); setTarget(''); setRecord(''); }}>添加引用</button>
  </div>;
}

function TaskGraph({ task, onSelect }: { task: TaskDefinition; onSelect: (id: string) => void }) {
  const marker = useId().replace(/:/g, '');
  const levels = new Map<string, number>(), queue = task.stages.some(s => s.id === task.startId) ? [task.startId] : [];
  if (queue.length) levels.set(task.startId, 0);
  for (let i = 0; i < queue.length; i++) for (const edge of task.transitions.filter(e => e.fromId === queue[i])) if (!levels.has(edge.toId) && task.stages.some(s => s.id === edge.toId)) { levels.set(edge.toId, levels.get(queue[i])! + 1); queue.push(edge.toId); }
  const last = Math.max(0, ...levels.values()) + 1, rows = new Map<number, number>();
  const positions = new Map(task.stages.map(s => { const col = levels.get(s.id) ?? last, row = rows.get(col) ?? 0; rows.set(col, row + 1); return [s.id, { x: 30 + col * 250, y: 35 + row * 150 }]; }));
  const width = Math.max(640, ...[...positions.values()].map(p => p.x + 230)), baseHeight = Math.max(190, ...[...positions.values()].map(p => p.y + 105));
  const loops = task.transitions.filter(e => (positions.get(e.toId)?.x ?? 0) <= (positions.get(e.fromId)?.x ?? 0));
  return <div className="tf-card"><h3>阶段流程图</h3><p className="gp-muted">点击节点编辑。成功结果与失败结果分别显示；阶段顺序由分支决定。</p><div className="tf-graph-scroll"><svg width={width} height={baseHeight + loops.length * 35} role="group" aria-label="任务阶段流程图"><defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#a997d7" /></marker></defs>
    {task.transitions.map((e) => { const a = positions.get(e.fromId), b = positions.get(e.toId); if (!a || !b) return null; const ax = a.x + 184, ay = a.y + 35, by = b.y + 35, rail = baseHeight + loops.indexOf(e) * 35; const backward = b.x <= a.x;
      return <g key={e.id}><path d={backward ? `M${ax},${ay} H${ax + 22} V${rail} H${b.x + 92} V${b.y + 72}` : `M${ax},${ay} C${ax + 35},${ay} ${b.x - 35},${by} ${b.x - 3},${by}`} fill="none" stroke="#a997d7" strokeWidth={1.5} markerEnd={'url(#' + marker + ')'} /><title>{e.label || '继续'}{e.condition ? '：' + e.condition : ''}</title></g>; })}
    {task.stages.map(s => { const p = positions.get(s.id)!; return <g key={s.id} transform={`translate(${p.x} ${p.y})`} tabIndex={0} role="button" aria-label={'查看阶段：' + display(s.title)} onClick={() => onSelect(s.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(s.id); } }} className={'tf-graph-node ' + s.kind}><rect width="184" height="70" rx="10" /><text x="14" y="24" className="tf-node-kind">{s.id === task.startId ? '起点 · ' : ''}{stageLabels[s.kind]}</text><text x="14" y="48">{display(s.title).slice(0, 12)}{s.title.length > 12 ? '…' : ''}</text><title>{s.title}</title></g>; })}
    </svg></div><div className="tf-flow-legend">{task.transitions.map(e => <p key={e.id}><b>{task.stages.find(s => s.id === e.fromId)?.title || '失效起点'} → {task.stages.find(s => s.id === e.toId)?.title || '未选终点'}</b> · {e.label || '继续'}{e.condition && ' · ' + e.condition}</p>)}</div></div>;
}

function TaskPathPreview({ task, tasks }: { task: TaskDefinition; tasks: TaskDefinition[] }) {
  const [preview, setPreview] = useState<TaskPreview | null>(null), [assumed, setAssumed] = useState<string[]>([]), [open, setOpen] = useState(false), [error, setError] = useState('');
  const fingerprint = JSON.stringify(task);
  useEffect(() => { setPreview(null); setAssumed([]); setOpen(false); setError(''); }, [fingerprint]);
  const stage = task.stages.find(s => s.id === preview?.stageId);
  const hasPrerequisites = task.prerequisiteIds.length > 0 || !!task.availability.trim();
  const act = (fn: () => TaskPreview) => { try { setPreview(fn()); setAssumed([]); setError(''); } catch (e) { setError(String(e)); } };
  return <div className="tf-card tf-preview"><div className="gp-card-heading"><h3><Play size={16} />手动路径预览</h3><button className="gp-secondary" onClick={() => { setPreview(null); setAssumed([]); setOpen(false); }}><RotateCcw size={14} />重置预览</button></div>
    <p className="gp-muted">手动输入模拟进度并假定条件满足。预览不会执行游戏逻辑或发放奖励，关闭或修改设计后重置。</p>
    {!preview ? <>{hasPrerequisites && <div className="tf-notice"><p>{task.availability || '前置任务成功完成'}</p><p>前置（{task.prerequisiteMode === 'all' ? '全部' : '任一'}）：{task.prerequisiteIds.map(id => tasks.find(t => t.id === id)?.title || '已失效').join('、') || '无'}</p><label><input type="checkbox" checked={open} onChange={e => setOpen(e.target.checked)} /> 假定开放条件已满足</label></div>}<button className="gp-secondary" disabled={hasPrerequisites && !open} onClick={() => act(() => startTaskPreview(task))}>开始预览</button></> : stage && <>
      <p className="tf-path">{[...preview.history.map(h => tasks.find(t => t.id === task.id)?.stages.find(s => s.id === h.stageId)?.title || '未命名'), stage.title].join(' → ')}</p><h4>{stage.title} <span className="gp-badge">{stageLabels[stage.kind]}</span></h4><p>{stage.description}</p>
      {stage.kind === 'objective' ? <><p className="gp-muted">{stage.mode === 'all' ? '全部目标达成后可继续' : '任一目标达成后可继续'}</p>{stage.objectives.map(o => <label className="tf-preview-objective" key={o.id}><span><strong>{o.title || '未命名目标'}</strong><small>{o.condition || '达成条件待补充'}</small></span><input aria-label={'模拟进度：' + o.title} type="number" min={0} max={o.target} step={1} value={preview.counts[o.id] ?? 0} onChange={e => { const count = Number(e.target.value); if (Number.isSafeInteger(count) && count >= 0 && count <= o.target) setPreview({ ...preview, counts: { ...preview.counts, [o.id]: count } }); }} /><span>/ {o.target}</span></label>)}
        {!stage.objectives.length && <p role="status">此阶段还没有目标，请先补充设计。</p>}
        {task.transitions.filter(e => e.fromId === stage.id).map(edge => <div className="tf-preview-edge" key={edge.id}>{edge.condition && <label><input type="checkbox" checked={assumed.includes(edge.id)} onChange={e => setAssumed(e.target.checked ? [...assumed, edge.id] : assumed.filter(id => id !== edge.id))} /> 假定条件满足：{edge.condition}</label>}<button className="gp-secondary" disabled={!taskStageReady(stage, preview.counts) || !!edge.condition.trim() && !assumed.includes(edge.id) || !task.stages.some(s => s.id === edge.toId)} onClick={() => act(() => advanceTaskPreview(task, preview, edge.id, assumed.includes(edge.id)))}>{edge.label || '继续'} → {task.stages.find(s => s.id === edge.toId)?.title || '目标未设置'}</button></div>)}</> : <div className={'tf-result ' + stage.kind}><strong>{stage.kind === 'success' ? '模拟成功结果' : '模拟失败结果'}</strong><p>{stage.result || '完成结果待补充'}</p>{stage.kind === 'success' && <p>后续目标：{tasks.filter(t => !t.archived && t.prerequisiteIds.includes(task.id)).map(t => t.title).join('、') || '无'}。仍需检查各自的其他开放条件。</p>}</div>}
      <button className="gp-secondary" disabled={!preview.history.length} onClick={() => { const prev = preview.history[preview.history.length - 1]!; setPreview({ stageId: prev.stageId, counts: prev.counts, history: preview.history.slice(0, -1) }); setAssumed([]); }}>返回上一步</button>
    </>}{error && <p className="field-error" role="alert">{error}</p>}
  </div>;
}
