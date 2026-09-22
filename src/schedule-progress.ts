import { productionKinds, type ProductionTask, type ProjectScheduleStore } from './project-schedule.ts';

export const progressGeometry = { left: 176, top: 48, width: 238, height: 176, column: 300, row: 196 };
export type ProgressNode = { task: ProductionTask; column: number; x: number; y: number; cyclic: boolean };
export type ProgressLane = { kind: ProductionTask['kind']; y: number; height: number; total: number; completed: number; visible: number };
export type ProgressEdge = { from: ProgressNode; to: ProgressNode; cyclic: boolean };

/** Condense cycles before ranking, so even an unfinished/cyclic draft has a finite, stable layout. */
export function scheduleProgressLayout(tasks: ProductionTask[], visibleIds = new Set(tasks.map(t => t.id)), kinds: ReadonlySet<ProductionTask['kind']> = new Set(productionKinds)) {
  const byId = new Map(tasks.map(t => [t.id, t])), outgoing = new Map(tasks.map(t => [t.id, [] as string[]]));
  for (const task of tasks) for (const id of task.dependencyIds) outgoing.get(id)?.push(task.id);
  const seen = new Set<string>(), finished: string[] = [];
  for (const task of tasks) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    const stack: { id: string; next: number }[] = [{ id: task.id, next: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1], children = outgoing.get(frame.id)!;
      if (frame.next === children.length) { finished.push(frame.id); stack.pop(); continue; }
      const id = children[frame.next++];
      if (!seen.has(id)) { seen.add(id); stack.push({ id, next: 0 }); }
    }
  }
  const component = new Map<string, number>(), members: string[][] = [];
  for (const id of finished.reverse()) {
    if (component.has(id)) continue;
    const index = members.length, group: string[] = [], pending = [id]; members.push(group); component.set(id, index);
    while (pending.length) {
      const current = pending.pop()!; group.push(current);
      for (const dependency of byId.get(current)!.dependencyIds) if (byId.has(dependency) && !component.has(dependency)) { component.set(dependency, index); pending.push(dependency); }
    }
  }
  const downstream = members.map(() => new Set<number>()), degree = members.map(() => 0), rank = members.map(() => 0);
  for (const task of tasks) for (const id of task.dependencyIds) {
    const from = component.get(id), to = component.get(task.id)!;
    if (from !== undefined && from !== to && !downstream[from].has(to)) { downstream[from].add(to); degree[to]++; }
  }
  const queue = degree.flatMap((n, i) => n === 0 ? [i] : []);
  for (let i = 0; i < queue.length; i++) for (const next of downstream[queue[i]]) {
    rank[next] = Math.max(rank[next], rank[queue[i]] + 1);
    if (--degree[next] === 0) queue.push(next);
  }
  const cyclic = new Set(members.flatMap(group => group.length > 1 || byId.get(group[0])!.dependencyIds.includes(group[0]) ? group : []));
  const lanes: ProgressLane[] = [], nodes: ProgressNode[] = [];
  let y = progressGeometry.top;
  for (const kind of productionKinds) {
    if (!kinds.has(kind)) continue;
    const all = tasks.filter(t => t.kind === kind);
    if (!all.length) continue;
    const visible = all.filter(t => visibleIds.has(t.id)).sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999') || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    const slots = new Map<number, number>();
    for (const task of visible) {
      const column = rank[component.get(task.id)!], row = slots.get(column) || 0; slots.set(column, row + 1);
      nodes.push({ task, column, cyclic: cyclic.has(task.id), x: progressGeometry.left + 28 + column * progressGeometry.column, y: y + 30 + row * progressGeometry.row });
    }
    const height = Math.max(1, ...slots.values()) * progressGeometry.row + 52;
    lanes.push({ kind, y, height, total: all.length, completed: all.filter(t => t.status === '已完成').length, visible: visible.length }); y += height;
  }
  const positions = new Map(nodes.map(n => [n.task.id, n]));
  const edges = nodes.flatMap(to => to.task.dependencyIds.flatMap(id => {
    const from = positions.get(id); return from ? [{ from, to, cyclic: cyclic.has(id) && component.get(id) === component.get(to.task.id) }] : [];
  }));
  const columns = Math.max(1, ...nodes.map(n => n.column + 1));
  return { lanes, nodes, edges, columns, width: progressGeometry.left + columns * progressGeometry.column + 12, height: y + 8 };
}

export function setProgressTaskStatus(store: ProjectScheduleStore, id: string, expected: ProductionTask['status'], status: ProductionTask['status']): ProjectScheduleStore {
  const task = store.tasks.find(t => t.id === id);
  if (!task) throw new Error('制作任务已被删除，请重新选择');
  if (task.status !== expected) throw new Error('任务状态已变化，请查看最新状态后重试');
  // Status is a manual production record: never infer dates, acceptance, dependent tasks or milestones.
  return { ...store, tasks: store.tasks.map(t => t.id === id ? { ...t, status } : t) };
}
