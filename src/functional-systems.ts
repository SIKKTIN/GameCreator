import type { DatasetDef, ProjectData } from './data-model';
import type { GameplayDesign } from './gameplay';

export const capabilityStatuses = ['待开发', '开发中', '待验收', '已完成'] as const;
export const dependencyKinds = { call: '调用功能', data: '读取数据', event: '订阅事件' } as const;
export type CapabilityStatus = typeof capabilityStatuses[number];
export type ConfigReference = { id: string; datasetKey: string; rowId: string; columnKey: string; note: string };
export type FunctionalSystem = { id: string; name: string; purpose: string; boundary: string; archived: boolean; createdAt: string; updatedAt: string };
export type Capability = {
  id: string; systemId: string; name: string; purpose: string; input: string; conditions: string; process: string; output: string;
  failure: string; state: string; acceptance: string; status: CapabilityStatus; archived: boolean; configRefs: ConfigReference[]; createdAt: string; updatedAt: string;
};
export type FunctionalDependency = { id: string; fromId: string; toId: string; kind: keyof typeof dependencyKinds; note: string };
export type FunctionalUsage = { id: string; gameplayId: string; capabilityId: string; note: string; sourceKind: 'design' | 'rule' | 'state' | 'event'; sourceId: string };
export type FunctionalStore = { schema: 1; systems: FunctionalSystem[]; capabilities: Capability[]; dependencies: FunctionalDependency[]; usages: FunctionalUsage[] };
export type FunctionalSources = { designs: GameplayDesign[]; data: ProjectData; definitions: DatasetDef[] };

export const emptyFunctionalSystems = (): FunctionalStore => ({ schema: 1, systems: [], capabilities: [], dependencies: [], usages: [] });
export function createFunctionalSystem(name: string): FunctionalSystem {
  if (!name.trim()) throw new Error('请输入系统名称');
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), name: name.trim(), purpose: '', boundary: '', archived: false, createdAt: now, updatedAt: now };
}
export function createCapability(systemId: string, name: string): Capability {
  if (!systemId.trim()) throw new Error('请选择所属系统');
  if (!name.trim()) throw new Error('请输入功能名称');
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), systemId, name: name.trim(), purpose: '', input: '', conditions: '', process: '', output: '', failure: '', state: '', acceptance: '', status: '待开发', archived: false, configRefs: [], createdAt: now, updatedAt: now };
}

// Validate the archive shape, not referential integrity: stale references must remain repairable.
export function validateFunctionalSystems(value: unknown): FunctionalStore {
  const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
  const strings = (x: Record<string, unknown>, keys: string[]) => keys.every(k => typeof x[k] === 'string');
  const dated = (x: Record<string, unknown>) => strings(x, ['createdAt', 'updatedAt']) && Number.isFinite(Date.parse(x.createdAt as string)) && Number.isFinite(Date.parse(x.updatedAt as string));
  const list = (xs: unknown, check: (x: Record<string, unknown>) => boolean): boolean => {
    if (!Array.isArray(xs)) return false;
    const ids = new Set<string>();
    return xs.every(x => {
      if (!record(x) || typeof x.id !== 'string' || !x.id.trim() || ids.has(x.id) || !check(x)) return false;
      ids.add(x.id); return true;
    });
  };
  if (!record(value) || value.schema !== 1 ||
      !list(value.systems, s => strings(s, ['name', 'purpose', 'boundary']) && typeof s.archived === 'boolean' && dated(s)) ||
      !list(value.capabilities, c => strings(c, ['systemId', 'name', 'purpose', 'input', 'conditions', 'process', 'output', 'failure', 'state', 'acceptance']) &&
        capabilityStatuses.includes(c.status as CapabilityStatus) && typeof c.archived === 'boolean' && dated(c) &&
        list(c.configRefs, r => strings(r, ['datasetKey', 'rowId', 'columnKey', 'note']))) ||
      !list(value.dependencies, d => strings(d, ['fromId', 'toId', 'note']) && Object.prototype.hasOwnProperty.call(dependencyKinds, d.kind as string)) ||
      !list(value.usages, u => strings(u, ['gameplayId', 'capabilityId', 'sourceId', 'note']) && ['design', 'rule', 'state', 'event'].includes(u.sourceKind as string) && (u.sourceKind !== 'design' || u.sourceId === ''))) {
    throw new Error('功能系统存档格式异常，已停止写入');
  }
  return value as FunctionalStore;
}
export function readFunctionalSystems(storage: Pick<Storage, 'getItem'>, key: string) {
  const raw = storage.getItem(key);
  return { raw, store: raw === null ? emptyFunctionalSystems() : validateFunctionalSystems(JSON.parse(raw)) };
}

const capabilityLabel = (id: string, store: FunctionalStore) => {
  const capability = store.capabilities.find(c => c.id === id);
  if (!capability) return '功能已失效（' + (id || '尚未选择') + '）';
  const system = store.systems.find(s => s.id === capability.systemId);
  return (system?.name || '所属系统已失效') + ' / ' + (capability.name || '未命名功能') + (capability.archived ? '（功能已归档）' : system?.archived ? '（系统已归档）' : '');
};
const isArchived = (id: string, store: FunctionalStore) => {
  const capability = store.capabilities.find(c => c.id === id);
  return !!(capability?.archived || store.systems.find(s => s.id === capability?.systemId)?.archived);
};
function validateMutation(previous: FunctionalStore, next: FunctionalStore) {
  const content = <T extends { archived: boolean; updatedAt: string }>(item: T) => {
    const { archived: _archived, updatedAt: _updated, ...rest } = item; return JSON.stringify(rest);
  };
  for (const system of previous.systems) {
    const changed = next.systems.find(s => s.id === system.id);
    if (system.archived && changed && content(changed) !== content(system)) throw new Error('系统已归档，请先恢复后再修改：' + system.name);
    if (!changed && next.capabilities.some(c => c.systemId === system.id)) throw new Error('系统仍包含功能，请先移动或删除这些功能');
  }
  for (const capability of previous.capabilities) {
    const changed = next.capabilities.find(c => c.id === capability.id);
    if (isArchived(capability.id, previous) && changed && content(changed) !== content(capability)) throw new Error('功能或所属系统已归档，请先恢复后再修改：' + capability.name);
    if (!changed && (next.dependencies.some(d => d.toId === capability.id) || next.usages.some(u => u.capabilityId === capability.id))) throw new Error('功能仍被依赖或玩法引用，请先解除或替换关系');
  }
  for (const capability of next.capabilities) {
    const old = previous.capabilities.find(c => c.id === capability.id);
    if ((!old || old.systemId !== capability.systemId) && next.systems.find(s => s.id === capability.systemId)?.archived) throw new Error('不能向已归档系统添加功能');
  }
  for (const dependency of next.dependencies) {
    const old = previous.dependencies.find(d => d.id === dependency.id);
    if ((!old || old.fromId !== dependency.fromId || old.toId !== dependency.toId || old.kind !== dependency.kind) && (isArchived(dependency.fromId, next) || isArchived(dependency.toId, next))) throw new Error('不能为已归档功能或系统建立新的依赖，请先恢复');
  }
  for (const usage of next.usages) {
    const old = previous.usages.find(u => u.id === usage.id);
    if ((!old || old.capabilityId !== usage.capabilityId || old.gameplayId !== usage.gameplayId || old.sourceKind !== usage.sourceKind || old.sourceId !== usage.sourceId) && isArchived(usage.capabilityId, next)) throw new Error('不能新增对已归档功能或系统的玩法引用，请先恢复');
  }
}
export function writeFunctionalSystems(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, expected: string | null, store: FunctionalStore): string {
  const current = storage.getItem(key);
  const previous = current === null ? emptyFunctionalSystems() : validateFunctionalSystems(JSON.parse(current));
  if (current !== expected) throw new Error('其他窗口已更新功能系统，当前草稿已保留，请先处理版本冲突');
  const next = validateFunctionalSystems(store); validateMutation(previous, next);
  const raw = JSON.stringify(next); storage.setItem(key, raw); return raw;
}
export function removeFunctionalSystem(store: FunctionalStore, id: string): FunctionalStore {
  if (store.capabilities.some(c => c.systemId === id)) throw new Error('系统仍包含功能，请先移动或删除这些功能');
  return { ...store, systems: store.systems.filter(s => s.id !== id) };
}
export function removeCapability(store: FunctionalStore, id: string): FunctionalStore {
  if (store.dependencies.some(d => d.toId === id) || store.usages.some(u => u.capabilityId === id)) throw new Error('功能仍被依赖或玩法引用，请先解除或替换关系');
  return { ...store, capabilities: store.capabilities.filter(c => c.id !== id), dependencies: store.dependencies.filter(d => d.fromId !== id) };
}

function configParts(ref: ConfigReference, sources: FunctionalSources) {
  const table = sources.definitions.find(d => d.key === ref.datasetKey);
  const rawRows = sources.data.datasets[ref.datasetKey], rawColumns = sources.data.columns[ref.datasetKey];
  const rows = Array.isArray(rawRows) ? rawRows : undefined, columns = Array.isArray(rawColumns) ? rawColumns : undefined;
  const row = ref.rowId ? rows?.find(r => r.id === ref.rowId) : undefined;
  const column = ref.columnKey ? columns?.find(c => c.key === ref.columnKey) : undefined;
  const issues: string[] = [];
  if (!table || !rows || !columns) issues.push('配置表已失效（' + (ref.datasetKey || '尚未选择') + '）');
  if (rows && ref.rowId && !row) issues.push('配置记录已失效（' + ref.rowId + '）');
  if (columns && ref.columnKey && !column) issues.push('配置字段已失效（' + ref.columnKey + '）');
  if (row && column && !Object.prototype.hasOwnProperty.call(row, column.key)) issues.push('配置值缺失（' + ref.rowId + '.' + ref.columnKey + '）');
  return { table, rows, columns, row, column, issues };
}
export function configReferenceText(ref: ConfigReference, sources: FunctionalSources): string {
  const { table, rows, columns, row, column, issues } = configParts(ref, sources);
  const path = [table?.label || ref.datasetKey || '未选择配置表', ref.rowId, column?.label || ref.columnKey].filter(Boolean).join(' / ');
  if (issues.length) return path + '：' + issues.join('；') + (ref.note ? ' — ' + ref.note : '');
  const value = row && column ? row[column.key] : row ? columns!.map(c => c.label + '=' + (Object.prototype.hasOwnProperty.call(row, c.key) ? row[c.key] : '值缺失')).join('；') : column ? rows!.map(r => r.id + '=' + (Object.prototype.hasOwnProperty.call(r, column.key) ? r[column.key] : '值缺失')).join('；') : rows!.length + ' 条记录；字段：' + columns!.map(c => c.label).join('、');
  return path + '：' + (value || '（空）') + (ref.note ? ' — ' + ref.note : '');
}
function usageParts(usage: FunctionalUsage, sources: FunctionalSources) {
  const design = sources.designs.find(d => d.id === usage.gameplayId);
  const source = !design || usage.sourceKind === 'design' ? undefined : usage.sourceKind === 'rule' ? design.conditionRules.find(r => r.id === usage.sourceId) : usage.sourceKind === 'state' ? design.stateFlow.states.find(s => s.id === usage.sourceId) : design.timeline.events.find(e => e.id === usage.sourceId);
  const kind = { design: '玩法说明', rule: '条件规则', state: '状态', event: '时间事件' }[usage.sourceKind];
  const issues: string[] = [];
  if (!design) issues.push('玩法已失效（' + (usage.gameplayId || '尚未选择') + '）');
  else {
    if (design.archived) issues.push('来源玩法已归档：' + design.title);
    if (usage.sourceKind !== 'design' && !source) issues.push(kind + '来源已失效（' + (usage.sourceId || '尚未选择') + '）');
  }
  return { design, source, kind, issues };
}
export function usageSourceText(usage: FunctionalUsage, sources: FunctionalSources): string {
  const { design, source, kind } = usageParts(usage, sources);
  const name = design?.title || '玩法已失效（' + (usage.gameplayId || '尚未选择') + '）';
  const origin = usage.sourceKind === 'design' ? kind : kind + '：' + (source ? source.name || '未命名来源' : '来源已失效（' + (usage.sourceId || '尚未选择') + '）');
  return name + ' / ' + origin + (design?.archived ? '（玩法已归档）' : '');
}

export function functionalIssues(store: FunctionalStore, sources: FunctionalSources): string[] {
  const issues: string[] = [];
  for (const system of store.systems) if (!system.name.trim()) issues.push('有系统尚未命名');
  for (const capability of store.capabilities) {
    if (!capability.name.trim()) issues.push('有功能尚未命名');
    if (!store.systems.some(s => s.id === capability.systemId)) issues.push('功能所属系统已失效：' + (capability.name || capability.id));
    const seen = new Set<string>();
    for (const ref of capability.configRefs) {
      const key = JSON.stringify([ref.datasetKey, ref.rowId, ref.columnKey]);
      if (seen.has(key)) issues.push('重复配置引用：' + capabilityLabel(capability.id, store) + ' / ' + configReferenceText(ref, sources));
      seen.add(key);
      issues.push(...configParts(ref, sources).issues.map(i => capabilityLabel(capability.id, store) + '：' + i));
    }
  }
  const dependencies = new Set<string>();
  for (const d of store.dependencies) {
    const key = JSON.stringify([d.fromId, d.toId, d.kind]);
    if (dependencies.has(key)) issues.push('重复依赖：' + capabilityLabel(d.fromId, store) + ' → ' + dependencyKinds[d.kind] + ' → ' + capabilityLabel(d.toId, store));
    dependencies.add(key);
    if (d.fromId === d.toId) issues.push('功能不能依赖自身：' + capabilityLabel(d.fromId, store));
    for (const id of [d.fromId, d.toId]) {
      if (!store.capabilities.some(c => c.id === id)) issues.push('依赖功能已失效：' + (id || '尚未选择'));
      else if (isArchived(id, store)) issues.push('依赖包含已归档功能或系统：' + capabilityLabel(id, store));
    }
  }
  // Only calls imply an execution stack. Event feedback and data sharing are not call cycles.
  const finished = new Set<string>(), visiting = new Set<string>(), path: string[] = [];
  const visit = (id: string) => {
    if (finished.has(id)) return;
    if (visiting.has(id)) {
      issues.push('调用依赖存在循环：' + [...path.slice(path.indexOf(id)), id].map(p => capabilityLabel(p, store)).join(' → ')); return;
    }
    visiting.add(id); path.push(id);
    for (const edge of store.dependencies.filter(d => d.kind === 'call' && d.fromId === id && d.toId !== id)) if (store.capabilities.some(c => c.id === edge.toId)) visit(edge.toId);
    path.pop(); visiting.delete(id); finished.add(id);
  };
  store.capabilities.forEach(c => visit(c.id));
  const usages = new Set<string>();
  for (const usage of store.usages) {
    const key = JSON.stringify([usage.gameplayId, usage.capabilityId, usage.sourceKind, usage.sourceId]);
    if (usages.has(key)) issues.push('重复玩法引用：' + usageSourceText(usage, sources) + ' → ' + capabilityLabel(usage.capabilityId, store));
    usages.add(key);
    if (!store.capabilities.some(c => c.id === usage.capabilityId)) issues.push('玩法引用的功能已失效：' + usageSourceText(usage, sources) + ' → ' + (usage.capabilityId || '尚未选择'));
    else if (isArchived(usage.capabilityId, store)) issues.push('玩法引用了已归档功能或系统：' + capabilityLabel(usage.capabilityId, store));
    issues.push(...usageParts(usage, sources).issues);
  }
  return [...new Set(issues)];
}

const text = (value: string) => value.trim() || '待补充';
function sourceDetails(usage: FunctionalUsage, sources: FunctionalSources): string {
  const design = sources.designs.find(d => d.id === usage.gameplayId);
  if (!design) return '';
  if (usage.sourceKind === 'design') return design.summary;
  if (usage.sourceKind === 'rule') {
    const rule = design.conditionRules.find(r => r.id === usage.sourceId);
    return rule ? `触发：${text(rule.trigger)}；条件：${rule.mode === 'all' ? '全部满足' : '任一满足'} ${rule.conditions.map(c => [c.subject, c.operator, c.value].filter(Boolean).join(' ')).join('；') || (rule.mode === 'all' ? '无附加条件' : '缺少条件，无法判断任一满足')}；执行：${rule.actions.map(a => a.text).join('；') || '待补充'}；否则：${rule.otherwise.map(a => a.text).join('；') || '无动作'}` : '';
  }
  if (usage.sourceKind === 'state') return design.stateFlow.states.find(s => s.id === usage.sourceId)?.description || '';
  const event = design.timeline.events.find(e => e.id === usage.sourceId);
  const track = design.timeline.tracks.find(t => t.id === event?.trackId);
  return event ? `轨道：${track?.name || '已失效'}；开始 ${event.start} 秒，持续 ${event.duration} 秒，重复 ${event.repeat} 次，间隔 ${event.interval} 秒；条件：${event.condition || '无附加条件'}；${event.notes}` : '';
}
export function gameplayFunctionalMarkdown(gameplayId: string, store: FunctionalStore, sources: FunctionalSources): string {
  const usages = store.usages.filter(u => u.gameplayId === gameplayId);
  const lines = ['#### 实现功能', ''];
  if (!usages.length) lines.push('暂无关联功能。');
  for (const usage of usages) lines.push(`- ${capabilityLabel(usage.capabilityId, store)} [功能 ID：${usage.capabilityId || '未选择'}]；来源：${usageSourceText(usage, sources)}；使用方式：${text(usage.note)}`);
  return lines.join('\n') + '\n';
}
export function functionalSystemsMarkdown(store: FunctionalStore, sources: FunctionalSources, renderReferences?: (capability: Capability) => string): string {
  const lines = ['## 功能系统', '', '> 功能定义按所属系统集中维护。实现状态独立于玩法验证状态；关联配置展示导出时的当前值。', ''];
  if (!store.systems.length && !store.capabilities.length) lines.push('暂无功能系统。', '');
  const renderCapability = (capability: Capability) => {
    lines.push('#### ' + text(capability.name), '', '- 功能 ID：' + capability.id, '- 所属系统：' + (store.systems.find(s => s.id === capability.systemId)?.name || '已失效（' + capability.systemId + '）'), '- 实现状态：' + capability.status + (isArchived(capability.id, store) ? '（已归档，只读）' : ''), '- 最后编辑：' + capability.updatedAt, '');
    for (const [label, value] of [['用途', capability.purpose], ['触发与输入', capability.input], ['执行条件', capability.conditions], ['处理流程', capability.process], ['结果与输出', capability.output], ['打断与失败处理', capability.failure], ['关键状态', capability.state], ['验收标准', capability.acceptance]]) lines.push('##### ' + label, '', text(value), '');
    if (renderReferences) lines.push(renderReferences(capability), '');
    lines.push('##### 当前配置引用', '');
    if (!capability.configRefs.length) lines.push('暂无配置引用。');
    for (const ref of capability.configRefs) lines.push('- ' + configReferenceText(ref, sources));
    lines.push('', '##### 依赖谁', '');
    const outgoing = store.dependencies.filter(d => d.fromId === capability.id);
    if (!outgoing.length) lines.push('暂无直接依赖。');
    for (const edge of outgoing) lines.push(`- ${dependencyKinds[edge.kind]}：${capabilityLabel(edge.toId, store)} [功能 ID：${edge.toId}]；用途：${text(edge.note)}`);
    lines.push('', '##### 谁使用它', '');
    const incoming = store.dependencies.filter(d => d.toId === capability.id);
    if (!incoming.length) lines.push('暂无功能使用者。');
    for (const edge of incoming) lines.push(`- ${capabilityLabel(edge.fromId, store)} [功能 ID：${edge.fromId}] → ${dependencyKinds[edge.kind]}；用途：${text(edge.note)}`);
    lines.push('', '##### 关联玩法与需求来源', '');
    const usages = store.usages.filter(u => u.capabilityId === capability.id);
    if (!usages.length) lines.push('暂无关联玩法。');
    for (const usage of usages) {
      lines.push(`- ${usageSourceText(usage, sources)} [玩法 ID：${usage.gameplayId}]；使用方式：${text(usage.note)}`);
      const detail = sourceDetails(usage, sources); if (detail) lines.push('  需求内容：' + detail);
    }
    lines.push('');
  };
  for (const system of store.systems) {
    lines.push('### ' + text(system.name) + (system.archived ? '（已归档）' : ''), '', '- 系统 ID：' + system.id, '', '职责：' + text(system.purpose), '', '边界：' + text(system.boundary), '');
    const capabilities = store.capabilities.filter(c => c.systemId === system.id);
    if (!capabilities.length) lines.push('暂无功能。', '');
    capabilities.forEach(renderCapability);
  }
  const orphans = store.capabilities.filter(c => !store.systems.some(s => s.id === c.systemId));
  if (orphans.length) { lines.push('### 所属系统已失效的功能', ''); orphans.forEach(renderCapability); }
  const lostEdges = store.dependencies.filter(d => !store.capabilities.some(c => c.id === d.fromId || c.id === d.toId));
  if (lostEdges.length) lines.push('### 两端功能已失效的依赖', '', ...lostEdges.map(d => '- ' + capabilityLabel(d.fromId, store) + ' → ' + dependencyKinds[d.kind] + ' → ' + capabilityLabel(d.toId, store) + '；用途：' + text(d.note)), '');
  const unresolved = store.usages.filter(u => !store.capabilities.some(c => c.id === u.capabilityId));
  if (unresolved.length) lines.push('### 功能已失效的玩法引用', '', ...unresolved.map(u => '- ' + usageSourceText(u, sources) + ' → ' + capabilityLabel(u.capabilityId, store) + '；' + text(u.note)), '');
  const issues = functionalIssues(store, sources);
  if (issues.length) lines.push('### 引用与依赖检查', '', ...issues.map(issue => '- ' + issue), '');
  return lines.join('\n');
}
