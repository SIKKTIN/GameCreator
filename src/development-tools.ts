export * from '../shared/development-tools.mjs';
import { emptyDevelopmentTools, validateDevelopmentTools, type DevelopmentToolsStore, type DevelopmentTool } from '../shared/development-tools.mjs';
import { createProductionTask, validateProjectSchedule, type ProjectScheduleStore } from './project-schedule.ts';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export function readDevelopmentTools(storage: Pick<Storage, 'getItem'>, key: string) {
  const raw = storage.getItem(key);
  return { raw, store: raw === null ? emptyDevelopmentTools() : validateDevelopmentTools(JSON.parse(raw)) };
}
export function writeDevelopmentTools(storage: StorageLike, key: string, expected: string | null, store: DevelopmentToolsStore) {
  const next = JSON.stringify(validateDevelopmentTools(store));
  if (storage.getItem(key) !== expected) throw new Error('其他窗口已更新开发工具，请先导出草稿，再重新读取');
  storage.setItem(key, next);
  return next;
}
export function developmentToolTasks(schedule: ProjectScheduleStore, id: string) {
  return schedule.tasks.filter(t => t.references.some(r => r.kind === 'tool' && r.targetId === id));
}
export function createToolTask(tool: DevelopmentTool) {
  const task = createProductionTask('开发：' + tool.name);
  return { ...task, owner: tool.owner, description: tool.purpose + '\n' + tool.scope, acceptance: tool.acceptance, priority: tool.priority, references: [{ kind: 'tool' as const, targetId: tool.id }] };
}
export function removeDevelopmentTool(store: DevelopmentToolsStore, id: string, schedule: ProjectScheduleStore) {
  if (developmentToolTasks(schedule, id).length) throw new Error('工具仍有关联排期，请先移除任务中的来源关联，或改为归档');
  return { ...store, tools: store.tools.filter(t => t.id !== id) };
}

/** Existing projects keep all edits. Missing template work is added without imposing dates. */
export function supplementDevelopmentPlan(store: DevelopmentToolsStore, schedule: ProjectScheduleStore, template: { tools: DevelopmentToolsStore; schedule: ProjectScheduleStore }, capabilityIds: Set<string>) {
  const addedTools = template.tools.tools.filter(t => !store.tools.some(old => old.id === t.id)).map(t => ({ ...structuredClone(t), capabilityIds: t.capabilityIds.filter(id => capabilityIds.has(id)) }));
  const addedTasks = template.schedule.tasks.filter(t => !schedule.tasks.some(old => old.id === t.id)).map(t => ({ ...structuredClone(t), start: '', end: '' }));
  const addedMilestones = template.schedule.milestones.filter(m => !schedule.milestones.some(old => old.id === m.id)).map(m => ({ ...structuredClone(m), due: '', description: '补充的制作工具验收阶段；按当前项目进展安排日期与负责人。' }));
  const allIds = new Set([...schedule.tasks, ...addedTasks].map(t => t.id));
  addedTasks.forEach(t => { t.dependencyIds = t.dependencyIds.filter(id => allIds.has(id)); });
  return { tools: validateDevelopmentTools({ ...store, tools: [...store.tools, ...addedTools] }), schedule: validateProjectSchedule({ ...schedule, tasks: [...schedule.tasks, ...addedTasks], milestones: [...schedule.milestones, ...addedMilestones] }), counts: { tools: addedTools.length, tasks: addedTasks.length, milestones: addedMilestones.length } };
}
