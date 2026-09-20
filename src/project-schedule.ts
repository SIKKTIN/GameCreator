import type { GameplayDesign } from './gameplay.ts';
import type { FunctionalStore } from './functional-systems.ts';
import type { ArtStore } from './art-assets.ts';
import type { MapDesignStore } from './map-design.ts';
import type { PrototypeDesignStore } from './prototype-design.ts';

export const productionKinds = ['设计', '程序', '美术', '关卡', '测试', '其他'] as const;
export const productionStatuses = ['待开始', '进行中', '待验收', '已完成', '受阻'] as const;
export const productionPriorities = ['低', '普通', '高', '紧急'] as const;
export const scheduleReferenceLabels = { gameplay: '玩法文档', capability: '程序功能', requirement: '素材需求', asset: '素材资产', map: '地图', prototype: '原型场景' };
export type ScheduleReference = { kind: keyof typeof scheduleReferenceLabels; targetId: string };
export type ProductionTask = {
  id: string; title: string; description: string; kind: typeof productionKinds[number]; owner: string;
  status: typeof productionStatuses[number]; priority: typeof productionPriorities[number];
  start: string; end: string; actualStart: string; actualEnd: string; milestoneId: string;
  acceptance: string; result: string; dependencyIds: string[]; references: ScheduleReference[];
};
export type ProductionMilestone = { id: string; title: string; owner: string; due: string; description: string; acceptance: string; review: string; status: '计划中' | '进行中' | '已验收' };
export type ProjectScheduleStore = { schema: 1; tasks: ProductionTask[]; milestones: ProductionMilestone[] };
export type ScheduleSources = Record<ScheduleReference['kind'], { id: string; name: string; status?: string; unavailable?: boolean }[]>;
export type ScheduleIssue = { taskId?: string; milestoneId?: string; kind: 'blocked' | 'conflict' | 'overdue' | 'reference' | 'review'; message: string };
export const emptyProjectSchedule = (): ProjectScheduleStore => ({ schema: 1, tasks: [], milestones: [] });
export function createProductionTask(title: string): ProductionTask {
  if (!title.trim()) throw new Error('请填写制作任务名称');
  return { id: crypto.randomUUID(), title: title.trim(), description: '', kind: '程序', owner: '', status: '待开始', priority: '普通', start: '', end: '', actualStart: '', actualEnd: '', milestoneId: '', acceptance: '', result: '', dependencyIds: [], references: [] };
}
export function createProductionMilestone(title: string): ProductionMilestone {
  if (!title.trim()) throw new Error('请填写里程碑名称');
  return { id: crypto.randomUUID(), title: title.trim(), owner: '', due: '', description: '', acceptance: '', review: '', status: '计划中' };
}
export function isScheduleDate(date: string): boolean {
  const n = Date.parse(date + 'T00:00:00Z');
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === date;
}
export const scheduleDay = (date: string) => Math.floor(Date.parse(date + 'T00:00:00Z') / 86400000);
export function shiftScheduleDate(date: string, days: number): string {
  if (!isScheduleDate(date) || !Number.isSafeInteger(days)) throw new Error('排期日期无效');
  const next = new Date((scheduleDay(date) + days) * 86400000).toISOString().slice(0, 10);
  if (!isScheduleDate(next)) throw new Error('日期超出可用范围');
  return next;
}
export const scheduleToday = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };

// Self-contained validator is also generated into the desktop folder boundary.
// Unresolved dependencies remain editable drafts; invalid dates cannot enter storage.
export function validateProjectSchedule(value: unknown): ProjectScheduleStore {
  const fail = (): never => { throw new Error('项目排期存档格式异常，已停止写入'); };
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const fields = (v: Record<string, unknown>, keys: string[]) => keys.every(k => typeof v[k] === 'string');
  const date = (v: unknown) => { if (v === '') return true; if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false; const n = Date.parse(v + 'T00:00:00Z'); return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === v; };
  const unique = new Set<string>();
  const id = (v: unknown) => { if (typeof v !== 'string' || !v.trim() || unique.has(v)) return false; unique.add(v); return true; };
  if (!record(value) || value.schema !== 1 || !Array.isArray(value.tasks) || !Array.isArray(value.milestones)) return fail();
  for (const m of value.milestones) if (!record(m) || !id(m.id) || !fields(m, ['title', 'owner', 'due', 'description', 'acceptance', 'review']) || !date(m.due) || !['计划中', '进行中', '已验收'].includes(m.status as string)) return fail();
  for (const t of value.tasks) {
    if (!record(t) || !id(t.id) || !fields(t, ['title', 'description', 'owner', 'start', 'end', 'actualStart', 'actualEnd', 'milestoneId', 'acceptance', 'result']) ||
      !['设计', '程序', '美术', '关卡', '测试', '其他'].includes(t.kind as string) || !['待开始', '进行中', '待验收', '已完成', '受阻'].includes(t.status as string) || !['低', '普通', '高', '紧急'].includes(t.priority as string) ||
      !['start', 'end', 'actualStart', 'actualEnd'].every(k => date(t[k])) || (t.start && t.end && (t.end as string) < (t.start as string)) || (t.actualStart && t.actualEnd && (t.actualEnd as string) < (t.actualStart as string)) ||
      !Array.isArray(t.dependencyIds) || t.dependencyIds.some(v => typeof v !== 'string' || !v.trim()) || new Set(t.dependencyIds).size !== t.dependencyIds.length || !Array.isArray(t.references)) return fail();
    const refs = new Set<string>();
    for (const r of t.references) {
      if (!record(r) || !['gameplay', 'capability', 'requirement', 'asset', 'map', 'prototype'].includes(r.kind as string) || typeof r.targetId !== 'string' || !r.targetId.trim()) return fail();
      const key = JSON.stringify([r.kind, r.targetId]); if (refs.has(key)) return fail(); refs.add(key);
    }
  }
  return value as ProjectScheduleStore;
}
export function scheduleFromMilestones(value: unknown): ProjectScheduleStore {
  if (!Array.isArray(value) || value.some(m => !m || ['title', 'owner', 'due'].some(k => typeof m[k] !== 'string') || !['done', 'active', 'planned'].includes(m.status))) throw new Error('原项目里程碑存档异常，未迁移排期');
  return validateProjectSchedule({ schema: 1, tasks: [], milestones: value.map((m, i) => {
    const due = m.due.replace(/\//g, '-');
    return { id: 'legacy-milestone-' + (i + 1), title: m.title, owner: m.owner, due: isScheduleDate(due) ? due : '', description: m.due && !isScheduleDate(due) ? '原计划日期：' + m.due : '', acceptance: '', review: '', status: m.status === 'done' ? '已验收' : m.status === 'active' ? '进行中' : '计划中' };
  }) });
}
export function readProjectSchedule(storage: Pick<Storage, 'getItem'>, key: string, legacyKey: string, defaults: unknown[] = []) {
  const raw = storage.getItem(key);
  if (raw !== null) return { raw, legacyRaw: null, store: validateProjectSchedule(JSON.parse(raw)) };
  const legacyRaw = storage.getItem(legacyKey);
  return { raw, legacyRaw, store: scheduleFromMilestones(legacyRaw === null ? defaults : JSON.parse(legacyRaw)) };
}
export function writeProjectSchedule(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, expected: string | null, store: ProjectScheduleStore, legacy?: { key: string; expected: string | null }): string {
  const raw = storage.getItem(key);
  if (raw !== null) validateProjectSchedule(JSON.parse(raw));
  if (raw !== expected || raw === null && legacy && storage.getItem(legacy.key) !== legacy.expected) throw new Error('其他窗口已更新排期或里程碑，草稿已保留，请重新读取后处理');
  const next = JSON.stringify(validateProjectSchedule(store)); storage.setItem(key, next); return next;
}
export function moveProductionTask(task: ProductionTask, days: number, mode: 'move' | 'start' | 'end' = 'move'): ProductionTask {
  if (!task.start || !task.end) throw new Error('请先填写任务的起止日期');
  const start = mode === 'end' ? task.start : shiftScheduleDate(task.start, days), end = mode === 'start' ? task.end : shiftScheduleDate(task.end, days);
  if (start > end) return task;
  return { ...task, start, end };
}
export function removeProductionTask(store: ProjectScheduleStore, id: string): ProjectScheduleStore {
  return { ...store, tasks: store.tasks.filter(t => t.id !== id).map(t => ({ ...t, dependencyIds: t.dependencyIds.filter(d => d !== id) })) };
}
export function removeProductionMilestone(store: ProjectScheduleStore, id: string): ProjectScheduleStore {
  return { ...store, milestones: store.milestones.filter(m => m.id !== id), tasks: store.tasks.map(t => t.milestoneId === id ? { ...t, milestoneId: '' } : t) };
}
export function buildScheduleSources(designs: GameplayDesign[], functional: FunctionalStore, art: ArtStore, maps: MapDesignStore, prototype: PrototypeDesignStore): ScheduleSources {
  return {
    gameplay: designs.map(d => ({ id: d.id, name: d.title, status: '设计：' + d.status, unavailable: d.archived })),
    capability: functional.capabilities.map(c => ({ id: c.id, name: c.name, status: '实现：' + c.status, unavailable: c.archived || !!functional.systems.find(s => s.id === c.systemId)?.archived })),
    requirement: art.requirements.map(r => ({ id: r.id, name: r.name, status: '需求：' + r.status, unavailable: r.archived })),
    asset: art.assets.map(a => ({ id: a.id, name: a.name, status: a.adoptedVersionId ? '已有采用版本' : '未采用版本', unavailable: a.archived })),
    map: maps.maps.map(m => ({ id: m.id, name: m.name, unavailable: !maps.enabled })),
    prototype: prototype.scenes.map(s => ({ id: s.id, name: s.name })),
  };
}
export function scheduleReference(ref: ScheduleReference, sources: ScheduleSources) {
  const item = sources[ref.kind].find(s => s.id === ref.targetId);
  return { label: item?.name || '来源已删除：' + ref.targetId, available: !!item && !item.unavailable, status: item?.unavailable ? item.status || '来源已归档或模块已关闭' : item?.status || '' };
}
export function projectScheduleIssues(store: ProjectScheduleStore, today = scheduleToday(), sources?: ScheduleSources): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [], byId = new Map(store.tasks.map(t => [t.id, t]));
  const reaches = (from: string, target: string) => { const seen = new Set<string>(), pending = [from]; while (pending.length) { const id = pending.pop()!; if (id === target) return true; if (seen.has(id)) continue; seen.add(id); pending.push(...(byId.get(id)?.dependencyIds || [])); } return false; };
  for (const t of store.tasks) {
    const add = (kind: ScheduleIssue['kind'], message: string) => issues.push({ taskId: t.id, kind, message });
    if (!t.title.trim()) add('review', '制作任务尚未命名');
    if (t.status !== '已完成' && t.end && t.end < today) add('overdue', '已超过计划完成日期');
    if (t.status === '受阻') add('blocked', '任务标记为受阻');
    if (t.status === '已完成' && !t.result.trim()) add('review', '已标记完成，尚未填写验收结果');
    if (t.milestoneId && !store.milestones.some(m => m.id === t.milestoneId)) add('reference', '所属里程碑已失效');
    if (t.dependencyIds.some(id => reaches(id, t.id))) add('conflict', '前置任务存在循环依赖');
    for (const id of t.dependencyIds) {
      const d = byId.get(id);
      if (!d) { add('reference', '前置任务已失效：' + id); continue; }
      if (d.status !== '已完成') add('blocked', '前置未完成：' + d.title);
      if (t.start && d.end && t.start <= d.end) add('conflict', '计划重叠：应在「' + d.title + '」完成后的日期开始');
    }
    if (sources) for (const ref of t.references) { const r = scheduleReference(ref, sources); if (!r.available) add('reference', r.label + (r.status ? ' · ' + r.status : '')); }
  }
  for (const m of store.milestones) {
    const linked = store.tasks.filter(t => t.milestoneId === m.id);
    const add = (kind: ScheduleIssue['kind'], message: string) => issues.push({ milestoneId: m.id, kind, message });
    if (!m.title.trim()) add('review', '里程碑尚未命名');
    if (m.due && m.due < today && m.status !== '已验收') add('overdue', '里程碑已超过目标日期');
    if (m.due && linked.some(t => t.end && t.end > m.due)) add('conflict', '包含晚于目标日期完成的任务');
    if (!m.acceptance.trim()) add('review', '请填写明确的验收条件');
    if (m.status === '已验收' && (linked.some(t => t.status !== '已完成') || !m.review.trim())) add('review', '验收记录待补充，或仍有未完成的制作任务');
  }
  return issues;
}
export function projectScheduleMarkdown(store: ProjectScheduleStore, sources?: ScheduleSources): string {
  const lines = ['## 项目排期', '', '> 制作计划与人工验收记录；设计、程序、美术和试玩状态分别维护。前置任务按完成后的下一日开始计算，拖动不自动改动其他任务。', ''];
  for (const m of store.milestones) lines.push('### 里程碑：' + m.title, '- 目标：' + (m.due || '未排期') + '；负责人：' + (m.owner || '未分配') + '；' + m.status, m.description, '- 验收条件：' + (m.acceptance || '待填写'), '- 验收记录：' + (m.review || '未填写'), '');
  for (const t of store.tasks) {
    lines.push('### 制作任务：' + t.title, '- ID：' + t.id, '- ' + t.kind + '；' + t.priority + '；' + t.status + '；负责人：' + (t.owner || '未分配'), '- 里程碑：' + (store.milestones.find(m => m.id === t.milestoneId)?.title || '未分组'), '- 计划：' + (t.start || '未定') + ' → ' + (t.end || '未定'), '- 实际：' + (t.actualStart || '未记录') + ' → ' + (t.actualEnd || '未记录'), t.description, '- 验收条件：' + (t.acceptance || '待填写'), '- 验收结果：' + (t.result || '未填写'), '- 前置任务：' + (t.dependencyIds.map(id => (store.tasks.find(d => d.id === id)?.title || '已失效') + ' [' + id + ']').join('、') || '无'));
    for (const r of t.references) lines.push('- 来源：' + scheduleReferenceLabels[r.kind] + ' / ' + (sources ? scheduleReference(r, sources).label : r.targetId) + ' [' + r.targetId + ']');
    lines.push('');
  }
  const issues = projectScheduleIssues(store, scheduleToday(), sources);
  if (issues.length) lines.push('### 排期待处理', ...issues.map(i => '- ' + (store.tasks.find(t => t.id === i.taskId)?.title || store.milestones.find(m => m.id === i.milestoneId)?.title || '') + '：' + i.message));
  return lines.join('\n');
}
