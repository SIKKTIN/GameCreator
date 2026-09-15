import type { EnumGroup, EnumScan } from './engine';
import { enumId, formatLuaValue, validateRow, type ProjectData, type DatasetKey } from './data-model.ts';

export type ChangeKind = 'add-group' | 'remove-group' | 'add-member' | 'remove-member' | 'value' | 'comment' | 'group-info' | 'order';
export type Change = {
  id: string; groupId: string; name: string; kind: ChangeKind; risk: 'low' | 'high';
  member?: string; before?: string | number; after?: string | number;
};
export type Snapshot = {
  id: string; createdAt: string; checksum: string; kind: 'source' | 'release'; scan: EnumScan;
};
export type Migration = { mode: 'replace' | 'retain'; target?: string };
export type Review = {
  baseId: string | null; status: 'draft' | 'approved' | 'rejected' | 'archived';
  selected: string[]; acknowledged: string[]; migrations: Record<string, Migration>;
  reviewer: string; note: string;
};
export type CellPatch = { table: DatasetKey; rowId: string; field: string; before: string; after: string };
export type Release = {
  id: string; fromId: string | null; toId: string; sourceId?: string; createdAt: string;
  reviewer: string; note: string; accepted: Change[]; patches: CellPatch[]; kind: 'publish' | 'rollback';
};
export type VersionStore = {
  schema: 1; revision: number; activeId: string | null; candidateId: string | null;
  snapshots: Snapshot[]; reviews: Record<string, Review>; releases: Release[]; data: ProjectData;
};
export const changeLabels: Record<ChangeKind, string> = {
  'add-group': '新增枚举组', 'remove-group': '删除枚举组', 'add-member': '新增成员',
  'remove-member': '删除成员', value: '修改值 / 类型', comment: '修改成员注释',
  'group-info': '修改定义说明', order: '调整排序',
};
const copy = <T,>(value: T): T => structuredClone(value);

export function emptyStore(data: ProjectData): VersionStore {
  return { schema: 1, revision: 0, activeId: null, candidateId: null, snapshots: [], reviews: {}, releases: [], data: copy(data) };
}
export function snapshotById(store: VersionStore, id: string | null) {
  return store.snapshots.find((snapshot) => snapshot.id === id);
}
export async function checksum(scan: EnumScan) {
  const bytes = new TextEncoder().encode(JSON.stringify(scan));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function makeSnapshot(scan: EnumScan, kind: Snapshot['kind']): Promise<Snapshot> {
  const frozen = copy(scan);
  return { id: (kind === 'source' ? 'S-' : 'V-') + crypto.randomUUID(), createdAt: new Date().toISOString(), checksum: await checksum(frozen), kind, scan: frozen };
}
export function prepareScan(scan: EnumScan): EnumScan {
  const ids = new Set<string>();
  return {
    ...copy(scan),
    groups: scan.groups.map((group) => {
      if (ids.has(enumId(group))) throw new Error('枚举定义重复：' + group.name);
      ids.add(enumId(group));
      const order = scan.orderTables.find((table) => table.source === group.source && table.name === group.name + '_ORDER');
      const positions = new Map(order?.keys.map((key, i) => [key, i]) ?? []);
      return { ...copy(group), members: [...group.members].map(copy).sort((a, b) =>
        (positions.get(a.key) ?? positions.size) - (positions.get(b.key) ?? positions.size)) };
    }),
  };
}
export function diffEnums(stable: EnumScan | null, candidate: EnumScan): Change[] {
  const changes: Change[] = [];
  const oldGroups = new Map((stable?.groups ?? []).map((group) => [enumId(group), group]));
  const newGroups = new Map(candidate.groups.map((group) => [enumId(group), group]));
  const add = (group: EnumGroup, kind: ChangeKind, risk: Change['risk'], member?: string, before?: string | number, after?: string | number) => {
    changes.push({ id: JSON.stringify([enumId(group), kind, member ?? '']), groupId: enumId(group), name: group.name, kind, risk, member, before, after });
  };
  for (const [id, group] of newGroups) {
    const old = oldGroups.get(id);
    if (!old) { add(group, 'add-group', 'low'); continue; }
    if (old.comment !== group.comment || old.name !== group.name) add(group, 'group-info', 'low', undefined, old.comment, group.comment);
    const oldMembers = new Map(old.members.map((member) => [member.key, member]));
    const newMembers = new Map(group.members.map((member) => [member.key, member]));
    for (const member of group.members) {
      const previous = oldMembers.get(member.key);
      if (!previous) add(group, 'add-member', 'low', member.key, undefined, member.value);
      else {
        if (previous.value !== member.value) add(group, 'value', 'high', member.key, previous.value, member.value);
        if (previous.comment !== member.comment) add(group, 'comment', 'low', member.key, previous.comment, member.comment);
      }
    }
    for (const member of old.members) if (!newMembers.has(member.key)) add(group, 'remove-member', 'high', member.key, member.value);
    const a = old.members.filter((member) => newMembers.has(member.key)).map((member) => member.key);
    const b = group.members.filter((member) => oldMembers.has(member.key)).map((member) => member.key);
    if (JSON.stringify(a) !== JSON.stringify(b)) add(group, 'order', 'low', undefined, a.join(' → '), b.join(' → '));
  }
  for (const [id, group] of oldGroups) if (!newGroups.has(id)) add(group, 'remove-group', 'high');
  return changes;
}
export function startReview(baseId: string | null, changes: Change[]): Review {
  return {
    baseId, status: 'draft', selected: changes.filter((change) => change.risk === 'low').map((change) => change.id),
    acknowledged: [], migrations: {}, reviewer: '本地用户', note: '',
  };
}
export function stageSnapshot(store: VersionStore, source: Snapshot): VersionStore {
  const stable = snapshotById(store, store.activeId)?.scan ?? null;
  const previous = store.candidateId ? store.reviews[store.candidateId] : null;
  const reviews = { ...store.reviews };
  if (previous && store.candidateId) reviews[store.candidateId] = { ...previous, status: 'archived' };
  reviews[source.id] = startReview(store.activeId, diffEnums(stable, source.scan));
  return { ...store, candidateId: source.id, snapshots: [...store.snapshots, source], reviews };
}
export function impacts(change: Change, data: ProjectData) {
  return Object.entries(data.columns).flatMap(([table, columns]) => columns
    .filter((column) => column.enumId === change.groupId)
    .map((column) => ({
      table: table as DatasetKey, field: column.key, label: column.label,
      records: data.datasets[table as DatasetKey].filter((row) => !change.member || row[column.key] === change.member).map((row) => row.id),
    })));
}
export function applyChanges(stable: EnumScan | null, source: EnumScan, changes: Change[], selected: string[]): EnumScan {
  const groups = new Map((stable?.groups ?? []).map((group) => [enumId(group), copy(group)]));
  const incoming = new Map(source.groups.map((group) => [enumId(group), group]));
  for (const change of changes.filter((item) => selected.includes(item.id))) {
    const next = incoming.get(change.groupId);
    if (change.kind === 'add-group' && next) { groups.set(change.groupId, copy(next)); continue; }
    if (change.kind === 'remove-group') { groups.delete(change.groupId); continue; }
    const group = groups.get(change.groupId);
    if (!group) continue;
    const member = next?.members.find((item) => item.key === change.member);
    switch (change.kind) {
      case 'add-member': if (member) group.members.push(copy(member)); break;
      case 'remove-member': group.members = group.members.filter((item) => item.key !== change.member); break;
      case 'value': case 'comment':
        group.members = group.members.map((item) => item.key === change.member && member ?
          { ...item, [change.kind === 'value' ? 'value' : 'comment']: change.kind === 'value' ? member.value : member.comment, line: member.line } : item);
        break;
      case 'group-info': if (next) { group.comment = next.comment; group.name = next.name; group.line = next.line; } break;
      case 'order': {
        const order = new Map(next?.members.map((item, i) => [item.key, i]));
        group.members.sort((a, b) => (order.get(a.key) ?? order.size) - (order.get(b.key) ?? order.size));
        break;
      }
    }
    group.valueType = typeof group.members[0]?.value;
  }
  const result = [...groups.values()];
  const files = [...new Set(result.map((group) => group.source))];
  return {
    ...copy(source), groups: result, files, orderTables: [], dynamic: [],
    counts: { files: files.length, groups: result.length, members: result.reduce((count, group) => count + group.members.length, 0) },
  };
}
export function exportIssues(data: ProjectData, stable: EnumScan | null) {
  const issues: string[] = [];
  if (!stable) return ['尚未发布稳定枚举版本'];
  for (const [table, columns] of Object.entries(data.columns)) {
    for (const column of columns) if (column.enumId && !stable.groups.some((group) => enumId(group) === column.enumId)) {
      issues.push(table + '.' + column.key + '：绑定的枚举不存在');
    }
    for (const row of data.datasets[table as DatasetKey]) {
      for (const issue of validateRow(row, columns, data, { scan: stable, ready: true })) {
        issues.push(table + ' / ' + row.id + ' / ' + issue.column.key + '：' + issue.message);
      }
    }
  }
  return issues;
}
export function planRelease(store: VersionStore) {
  const source = snapshotById(store, store.candidateId);
  const review = source ? store.reviews[source.id] : null;
  const stable = snapshotById(store, store.activeId)?.scan ?? null;
  if (!source || !review) return { errors: ['没有待审核候选版本'], changes: [] as Change[], scan: stable, data: store.data, patches: [] as CellPatch[], warnings: [] as string[] };
  const changes = diffEnums(stable, source.scan);
  const selected = changes.filter((change) => review.selected.includes(change.id));
  const scan = applyChanges(stable, source.scan, changes, review.selected);
  const data = copy(store.data);
  const errors: string[] = [];
  const patches: CellPatch[] = [];
  if (review.status !== 'draft') errors.push('该候选版本已经结束审核');
  if (review.baseId !== store.activeId) errors.push('稳定版本已变化，请重新扫描后审核');
  if (!selected.length) errors.push('请至少选择一项变更');
  if (!review.reviewer.trim()) errors.push('请填写审核人');
  if (selected.some((change) => change.risk === 'high') && !review.note.trim()) errors.push('高风险变更需要审核说明');
  for (const change of selected) {
    if (change.risk === 'high' && !review.acknowledged.includes(change.id)) errors.push(change.name + '：请确认高风险变更');
    const affected = impacts(change, data);
    if (change.kind === 'remove-group' && affected.length) errors.push(change.name + ' 仍被字段绑定，请先重新绑定字段或取消删除');
    if (change.kind !== 'remove-member' || !affected.some((item) => item.records.length)) continue;
    const migration = review.migrations[change.id];
    if (!migration) { errors.push(change.name + '.' + change.member + '：请选择替换或保留待修复'); continue; }
    if (migration.mode === 'retain') continue;
    const group = scan.groups.find((item) => enumId(item) === change.groupId);
    if (!migration.target || !group?.members.some((member) => member.key === migration.target)) {
      errors.push(change.name + '：替换目标不在本次发布版本中'); continue;
    }
    for (const field of affected) for (const row of data.datasets[field.table]) {
      if (row[field.field] !== change.member) continue;
      patches.push({ table: field.table, rowId: row.id, field: field.field, before: row[field.field], after: migration.target });
      row[field.field] = migration.target;
    }
  }
  for (const group of scan.groups) {
    const values = new Set<string>();
    const keys = new Set<string>();
    if (!group.members.length) errors.push(group.name + ' 不能为空枚举，请保留成员或删除整组');
    for (const member of group.members) {
      if (keys.has(member.key)) errors.push(group.name + ' 成员名重复：' + member.key);
      keys.add(member.key);
      if (typeof member.value !== group.valueType) errors.push(group.name + ' 存在混合值类型，请统一选择相关改值');
      if (typeof member.value === 'number' && !Number.isFinite(member.value)) errors.push(group.name + ' 包含无效数字');
      const value = typeof member.value + ':' + member.value;
      if (values.has(value)) errors.push(group.name + ' 存在重复值：' + formatLuaValue(member.value));
      values.add(value);
    }
  }
  return { errors: [...new Set(errors)], changes: selected, scan, data, patches, warnings: exportIssues(data, scan) };
}
export function getExportSnapshot(store: VersionStore) {
  const active = snapshotById(store, store.activeId);
  const issues = exportIssues(store.data, active?.scan ?? null);
  if (!active || issues.length) throw new Error(issues.join('；'));
  return copy({ versionId: active.id, checksum: active.checksum, scan: active.scan, data: store.data });
}
export function replaceProjectData(store: VersionStore, expected: ProjectData, next: ProjectData): VersionStore {
  if (JSON.stringify(store.data) !== JSON.stringify(expected)) {
    throw new Error('数据已被发布迁移或其他操作修改，请检查最新记录后重新编辑');
  }
  return { ...store, data: copy(next) };
}
export async function publishRelease(store: VersionStore): Promise<VersionStore> {
  const plan = planRelease(store);
  if (plan.errors.length || !plan.scan || !store.candidateId) throw new Error(plan.errors.join('；'));
  const snapshot = await makeSnapshot(plan.scan, 'release');
  const review = store.reviews[store.candidateId];
  const release: Release = {
    id: crypto.randomUUID(), fromId: store.activeId, toId: snapshot.id, sourceId: store.candidateId,
    createdAt: snapshot.createdAt, reviewer: review.reviewer, note: review.note,
    accepted: copy(plan.changes), patches: plan.patches, kind: 'publish',
  };
  return {
    ...store, activeId: snapshot.id, candidateId: null, data: plan.data,
    snapshots: [...store.snapshots, snapshot], releases: [...store.releases, release],
    reviews: { ...store.reviews, [store.candidateId]: { ...review, status: 'approved' } },
  };
}
export function rollbackPlan(store: VersionStore) {
  const last = store.releases[store.releases.length - 1];
  const target = last?.fromId ? snapshotById(store, last.fromId) : undefined;
  const errors: string[] = [];
  const data = copy(store.data);
  const patches: CellPatch[] = [];
  if (!last || !target || last.toId !== store.activeId) errors.push('没有可回退的上一稳定版本');
  if (last && target) {
    const currentScan = snapshotById(store, store.activeId)?.scan;
    for (const patch of [...last.patches].reverse()) {
      const row = data.datasets[patch.table].find((item) => item.id === patch.rowId);
      // Never overwrite edits made after publication.
      if (!row || row[patch.field] !== patch.after) {
        errors.push(patch.table + '/' + patch.rowId + '/' + patch.field + ' 已在发布后修改，无法自动回退'); continue;
      }
      row[patch.field] = patch.before;
      patches.push({ ...patch, before: patch.after, after: patch.before });
    }
    for (const [table, columns] of Object.entries(data.columns)) for (const column of columns.filter((field) => field.enumId)) {
      const group = target.scan.groups.find((item) => enumId(item) === column.enumId);
      const currentGroup = currentScan?.groups.find((item) => enumId(item) === column.enumId);
      if (!group && currentGroup) errors.push(table + '.' + column.key + ' 绑定了目标版本中不存在的枚举');
      else if (group) for (const row of data.datasets[table as DatasetKey]) {
        if (row[column.key] && !group.members.some((member) => member.key === row[column.key]) &&
          currentGroup?.members.some((member) => member.key === row[column.key])) {
          errors.push(table + '/' + row.id + '/' + column.key + ' 的成员不在回退版本中');
        }
      }
    }
  }
  return { target, data, patches, errors: [...new Set(errors)] };
}
export function rollback(store: VersionStore): VersionStore {
  const plan = rollbackPlan(store);
  if (plan.errors.length || !plan.target) throw new Error(plan.errors.join('；'));
  return {
    ...store, activeId: plan.target.id, data: plan.data,
    releases: [...store.releases, {
      id: crypto.randomUUID(), fromId: store.activeId, toId: plan.target.id, createdAt: new Date().toISOString(),
      reviewer: '本地用户', note: '回退上一稳定版本', accepted: [], patches: plan.patches, kind: 'rollback',
    }],
  };
}
