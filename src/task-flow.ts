export const taskKinds = ['主线', '支线', '委托', '探索', '关卡', '挑战'] as const;
export const taskScopes = ['单次', '每局', '每日', '跨局'] as const;
export const referenceKinds = ['gameplay', 'capability', 'story', 'asset', 'table'] as const;
export const referenceLabels = { gameplay: '玩法', capability: '程序功能', story: '故事', asset: '美术资产', table: '配置表' };
export type TaskReference = { kind: typeof referenceKinds[number]; targetId: string; recordId: string };
export type TaskObjective = { id: string; title: string; condition: string; target: number };
export type TaskStage = { id: string; title: string; kind: 'objective' | 'success' | 'failure'; description: string; mode: 'all' | 'any'; objectives: TaskObjective[]; result: string };
export type TaskTransition = { id: string; fromId: string; toId: string; label: string; condition: string };
export type TaskDefinition = {
  id: string; title: string; kind: typeof taskKinds[number]; scope: typeof taskScopes[number]; summary: string;
  archived: boolean; status: '草稿' | '已确认'; prerequisiteIds: string[]; prerequisiteMode: 'all' | 'any'; availability: string;
  startId: string; stages: TaskStage[]; transitions: TaskTransition[]; references: TaskReference[];
};
export type TaskFlowStore = { schema: 1; tasks: TaskDefinition[] };
type Named = { id: string; title?: string; name?: string; archived?: boolean };
export type TaskSources = { designs: Named[]; capabilities: Named[]; stories: Named[]; assets: Named[]; definitions: { key: string; label: string }[]; data: { datasets: Record<string, { id: string; [key: string]: string }[]> } };
export type TaskIssue = { taskId: string; stageId?: string; message: string };
export const emptyTaskFlows = (): TaskFlowStore => ({ schema: 1, tasks: [] });
export function createTask(title: string): TaskDefinition {
  if (!title.trim()) throw new Error('请填写任务名称');
  return { id: crypto.randomUUID(), title: title.trim(), kind: '主线', scope: '单次', summary: '', archived: false, status: '草稿', prerequisiteIds: [], prerequisiteMode: 'all', availability: '', startId: '', stages: [], transitions: [], references: [] };
}
export function createTaskStage(kind: TaskStage['kind'] = 'objective'): TaskStage {
  return { id: crypto.randomUUID(), title: kind === 'objective' ? '新阶段' : kind === 'success' ? '完成任务' : '任务失败', kind, description: '', mode: 'all', objectives: [], result: '' };
}

/** Validate storage shape; incomplete and stale references remain editable design drafts. */
export function validateTaskFlows(value: unknown): TaskFlowStore {
  const invalid = (): never => { throw new Error('任务与流程存档格式异常，已停止写入'); };
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const fields = (v: Record<string, unknown>, keys: string[]) => keys.every(k => typeof v[k] === 'string');
  const ids = new Set<string>();
  const id = (v: unknown) => { if (typeof v !== 'string' || !v.trim() || ids.has(v)) return false; ids.add(v); return true; };
  const mode = (v: unknown) => v === 'all' || v === 'any';
  if (!record(value) || value.schema !== 1 || !Array.isArray(value.tasks)) return invalid();
  for (const task of value.tasks) {
    if (!record(task) || !id(task.id) || !fields(task, ['title', 'summary', 'availability', 'startId']) || typeof task.archived !== 'boolean' ||
      !taskKinds.includes(task.kind as TaskDefinition['kind']) || !taskScopes.includes(task.scope as TaskDefinition['scope']) || !['草稿', '已确认'].includes(task.status as string) ||
      !mode(task.prerequisiteMode) || !Array.isArray(task.prerequisiteIds) || !task.prerequisiteIds.every(v => typeof v === 'string' && !!v.trim()) || new Set(task.prerequisiteIds).size !== task.prerequisiteIds.length ||
      !Array.isArray(task.stages) || !Array.isArray(task.transitions) || !Array.isArray(task.references)) return invalid();
    for (const stage of task.stages) {
      if (!record(stage) || !id(stage.id) || !fields(stage, ['title', 'description', 'result']) || !['objective', 'success', 'failure'].includes(stage.kind as string) || !mode(stage.mode) || !Array.isArray(stage.objectives)) return invalid();
      for (const objective of stage.objectives) if (!record(objective) || !id(objective.id) || !fields(objective, ['title', 'condition']) || !Number.isSafeInteger(objective.target) || (objective.target as number) < 1) return invalid();
    }
    for (const edge of task.transitions) if (!record(edge) || !id(edge.id) || !fields(edge, ['fromId', 'toId', 'label', 'condition'])) return invalid();
    const refs = new Set<string>();
    for (const ref of task.references) {
      if (!record(ref) || !referenceKinds.includes(ref.kind as TaskReference['kind']) || !fields(ref, ['targetId', 'recordId']) || !(ref.targetId as string).trim() || ref.kind !== 'table' && ref.recordId !== '') return invalid();
      const key = JSON.stringify([ref.kind, ref.targetId, ref.recordId]);
      if (refs.has(key)) return invalid(); refs.add(key);
    }
  }
  return value as TaskFlowStore;
}
export function taskReferenceLabel(ref: TaskReference, sources: TaskSources): { label: string; available: boolean } {
  if (ref.kind === 'table') {
    const table = sources.definitions.find(d => d.key === ref.targetId), rows = sources.data.datasets[ref.targetId];
    const row = Array.isArray(rows) ? rows.find(r => r.id === ref.recordId) : undefined;
    return { label: (table?.label ?? '配置表已失效') + (ref.recordId ? ' / ' + (row?.name || row?.title || row?.id || '记录已失效：' + ref.recordId) : ''), available: !!table && (!ref.recordId || !!row) };
  }
  const list = ref.kind === 'gameplay' ? sources.designs : ref.kind === 'capability' ? sources.capabilities : ref.kind === 'story' ? sources.stories : sources.assets;
  const item = list.find(i => i.id === ref.targetId);
  return { label: item ? (item.title || item.name || '未命名内容') + (item.archived ? '（已归档）' : '') : '引用已失效：' + ref.targetId, available: !!item && !item.archived };
}
export function taskFlowIssues(store: TaskFlowStore, sources?: TaskSources): TaskIssue[] {
  const issues: TaskIssue[] = [], byId = new Map(store.tasks.map(t => [t.id, t]));
  // A fixed point also handles ANY prerequisites: a cycle with an external alternative can unlock.
  const unlockable = new Set<string>();
  let changed = true;
  while (changed) { changed = false; for (const task of store.tasks.filter(t => !t.archived)) {
    if (!unlockable.has(task.id) && (!task.prerequisiteIds.length || (task.prerequisiteMode === 'all' ? task.prerequisiteIds.every(id => unlockable.has(id)) : task.prerequisiteIds.some(id => unlockable.has(id))))) { unlockable.add(task.id); changed = true; }
  } }
  for (const task of store.tasks) {
    const add = (message: string, stageId?: string) => issues.push({ taskId: task.id, stageId, message });
    if (!task.title.trim()) add('任务尚未命名');
    for (const id of task.prerequisiteIds) {
      if (id === task.id) add('不能以前置条件依赖自身');
      else if (!byId.has(id)) add('前置任务已失效：' + id);
      else if (byId.get(id)!.archived) add('前置任务已归档：' + byId.get(id)!.title);
    }
    if (!task.archived && task.prerequisiteIds.length && !unlockable.has(task.id)) add('前置关系无法解锁，请检查循环或失效的前置任务');
    const stages = new Map(task.stages.map(s => [s.id, s]));
    if (!stages.has(task.startId)) add('请选择有效的起始阶段');
    const validEdges = task.transitions.filter(e => stages.has(e.fromId) && stages.has(e.toId));
    for (const edge of task.transitions) if (!stages.has(edge.fromId) || !stages.has(edge.toId)) add('分支端点已失效：' + (edge.label || edge.id));
    const traverse = (seeds: string[], backwards = false) => {
      const seen = new Set<string>(), pending = [...seeds];
      while (pending.length) { const id = pending.pop()!; if (seen.has(id)) continue; seen.add(id);
        pending.push(...validEdges.filter(e => stages.get(e.fromId)?.kind === 'objective' && (backwards ? e.toId === id : e.fromId === id)).map(e => backwards ? e.fromId : e.toId)); }
      return seen;
    };
    const reachable = traverse(stages.has(task.startId) ? [task.startId] : []), canFinish = traverse(task.stages.filter(s => s.kind !== 'objective').map(s => s.id), true);
    for (const stage of task.stages) {
      const name = stage.title || '未命名阶段';
      if (!stage.title.trim()) add('阶段尚未命名', stage.id);
      if (!reachable.has(stage.id)) add('起点无法到达：' + name, stage.id);
      if (stage.kind === 'objective') {
        if (!canFinish.has(stage.id)) add('无法到达完成或失败结果：' + name, stage.id);
        if (!stage.objectives.length) add('尚未填写阶段目标：' + name, stage.id);
      } else {
        if (!stage.result.trim()) add('尚未填写完成结果：' + name, stage.id);
        if (stage.objectives.length) add('结果阶段不应包含目标：' + name, stage.id);
        if (task.transitions.some(e => e.fromId === stage.id)) add('结果阶段不应继续流转：' + name, stage.id);
      }
      for (const objective of stage.objectives) if (!objective.title.trim() || !objective.condition.trim()) add('目标名称或达成条件待补充：' + (objective.title || name), stage.id);
      const exits = task.transitions.filter(e => e.fromId === stage.id);
      if (exits.length > 1 && exits.some(e => !e.condition.trim())) add('多条分支需明确各自条件：' + name, stage.id);
    }
    if (sources) for (const ref of task.references) { const resolved = taskReferenceLabel(ref, sources); if (!resolved.available) add(resolved.label); }
  }
  return issues;
}
export function copyTask(task: TaskDefinition): TaskDefinition {
  const next = structuredClone(task), ids = new Map(task.stages.map(s => [s.id, crypto.randomUUID()]));
  next.id = crypto.randomUUID(); next.title += '（副本）'; next.archived = false; next.status = '草稿'; next.startId = ids.get(next.startId) ?? next.startId;
  next.stages = next.stages.map(s => ({ ...s, id: ids.get(s.id)!, objectives: s.objectives.map(o => ({ ...o, id: crypto.randomUUID() })) }));
  next.transitions = next.transitions.map(e => ({ ...e, id: crypto.randomUUID(), fromId: ids.get(e.fromId) ?? e.fromId, toId: ids.get(e.toId) ?? e.toId }));
  return next;
}
export function removeTaskStage(task: TaskDefinition, id: string): TaskDefinition {
  if (task.startId === id || task.transitions.some(e => e.fromId === id || e.toId === id)) throw new Error('请先调整起始阶段和相关分支，再删除阶段');
  return { ...task, stages: task.stages.filter(s => s.id !== id) };
}
export function taskStageReady(stage: TaskStage, counts: Record<string, number>): boolean {
  if (stage.kind !== 'objective' || !stage.objectives.length) return false;
  const done = (o: TaskObjective) => Number.isFinite(counts[o.id]) && counts[o.id] >= o.target;
  return stage.mode === 'all' ? stage.objectives.every(done) : stage.objectives.some(done);
}
export type TaskPreview = { stageId: string; counts: Record<string, number>; history: { stageId: string; counts: Record<string, number>; edgeId: string }[] };
export function startTaskPreview(task: TaskDefinition): TaskPreview {
  if (!task.stages.some(s => s.id === task.startId)) throw new Error('请先设置有效的起始阶段');
  return { stageId: task.startId, counts: {}, history: [] };
}
export function advanceTaskPreview(task: TaskDefinition, preview: TaskPreview, edgeId: string, assumedCondition: boolean): TaskPreview {
  const stage = task.stages.find(s => s.id === preview.stageId), edge = task.transitions.find(e => e.id === edgeId && e.fromId === preview.stageId);
  if (!stage || !taskStageReady(stage, preview.counts)) throw new Error('请先满足当前阶段目标');
  if (!edge || !task.stages.some(s => s.id === edge.toId)) throw new Error('分支目标已失效');
  if (edge.condition.trim() && !assumedCondition) throw new Error('请确认本次预览假定分支条件满足');
  return { stageId: edge.toId, counts: {}, history: [...preview.history, { stageId: preview.stageId, counts: { ...preview.counts }, edgeId }] };
}
export function readTaskFlows(storage: Pick<Storage, 'getItem'>, key: string) {
  const raw = storage.getItem(key); return { raw, store: raw === null ? emptyTaskFlows() : validateTaskFlows(JSON.parse(raw)) };
}
export function writeTaskFlows(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, expected: string | null, store: TaskFlowStore): string {
  const raw = storage.getItem(key); if (raw !== null) validateTaskFlows(JSON.parse(raw));
  if (raw !== expected) throw new Error('其他窗口已更新任务与流程，当前草稿已保留，请先处理版本冲突');
  const next = JSON.stringify(validateTaskFlows(store)); storage.setItem(key, next); return next;
}
export function taskFlowsMarkdown(store: TaskFlowStore, sources: TaskSources): string {
  const lines = ['## 任务与流程', '', '> 设计定义；手动预览的计数与路径不作为玩家进度保存。条件和结果由游戏实现解释。', ''];
  for (const task of store.tasks) {
    const name = (id: string) => task.stages.find(s => s.id === id)?.title || '已失效：' + id;
    lines.push('### ' + task.title + (task.archived ? '（已归档）' : ''), '', `- ID：${task.id}；${task.kind}；${task.scope}；${task.status}`, task.summary,
      '- 开放条件：' + (task.availability || '无额外条件'), '- 前置任务（' + (task.prerequisiteMode === 'all' ? '全部' : '任一') + '）：' + (task.prerequisiteIds.map(id => (store.tasks.find(t => t.id === id)?.title || '已失效') + ' [' + id + ']').join('、') || '无'), '- 起始阶段：' + name(task.startId));
    for (const stage of task.stages) {
      lines.push('', '#### ' + stage.title + ' [' + stage.id + ']', '- 类型：' + ({ objective: '目标阶段', success: '成功结果', failure: '失败结果' }[stage.kind]), stage.description, '- 目标满足方式：' + (stage.mode === 'all' ? '全部' : '任一'));
      for (const o of stage.objectives) lines.push(`- ${o.title}；目标数量：${o.target}；达成条件：${o.condition}`);
      if (stage.result) lines.push('- 完成结果：' + stage.result);
    }
    for (const e of task.transitions) lines.push(`- 分支：${name(e.fromId)} → ${name(e.toId)}；${e.label || '继续'}；条件：${e.condition || '目标达成后'}`);
    for (const ref of task.references) lines.push('- ' + referenceLabels[ref.kind] + '：' + taskReferenceLabel(ref, sources).label + ` [${ref.targetId}${ref.recordId ? '/' + ref.recordId : ''}]`);
    lines.push('');
  }
  const issues = taskFlowIssues(store, sources);
  if (issues.length) lines.push('### 待完善内容', ...issues.map(i => '- ' + (store.tasks.find(t => t.id === i.taskId)?.title || i.taskId) + '：' + i.message));
  return lines.join('\n');
}
