import type { DatasetDef } from './data-model.ts';
import type { VersionStore } from './enum-versions.ts';
import { readVersions } from './enum-storage.ts';
import { datasetDefinitions, initialData, emptyProjectData } from './project-defaults.ts';
import { emptyGameplay, validateGameplay, type GameplayStore } from './gameplay.ts';
import { emptyFunctionalSystems, validateFunctionalSystems, type FunctionalStore } from './functional-systems.ts';
import type { SavedProject } from './project-catalog.ts';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type RawEntry = { key: string; value: string | null };
type Mutation = { key: string; before: string | null; after: string };
type PendingMigration = { schema: 1; state: 'pending'; removed: string[]; entries: Mutation[]; guards: RawEntry[] };
type CompletedMigration = { schema: 1; state: 'done'; removed: string[] };
const workspaceKey = (id: string, suffix: string) => 'gamecreator.workspace.v1:' + id + ':' + suffix;
export const defaultTableMigrationKey = (id: string) => workspaceKey(id, 'default-table-migration');
const enumKey = (id: string) => 'gamecreator.enum-versions.v1:' + id;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = (detail: string): never => { throw new Error('清理旧版空表失败：' + detail); };
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (record(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function validateDefinitions(value: unknown): DatasetDef[] {
  if (!Array.isArray(value)) return fail('配置表目录格式异常，现有数据未清理');
  const seen = new Set<string>();
  for (const definition of value) {
    if (!record(definition) || typeof definition.key !== 'string' || !definition.key || seen.has(definition.key) ||
        ['__proto__', 'constructor', 'prototype'].includes(definition.key) || typeof definition.label !== 'string' ||
        typeof definition.badge !== 'string' || !Array.isArray(definition.columns)) return fail('配置表目录格式异常');
    seen.add(definition.key);
    // Reuse the draft validator to check every column and optional binding.
    const data = { columns: { [definition.key]: definition.columns }, datasets: { [definition.key]: [] } };
    readVersions({ getItem: () => JSON.stringify({ schema: 1, revision: 0, activeId: null, candidateId: null, snapshots: [], reviews: {}, releases: [], data }), setItem() {} }, '', emptyProjectData);
  }
  return value as DatasetDef[];
}
function referencedTables(value: unknown, targets: Set<string>) {
  if (Array.isArray(value)) { for (const item of value) referencedTables(item, targets); return; }
  if (!record(value)) return;
  if (value.kind === 'dataset' && typeof value.targetId === 'string') targets.add(value.targetId);
  for (const [key, item] of Object.entries(value)) {
    if (['table', 'datasetKey', 'reference'].includes(key) && typeof item === 'string') targets.add(item);
    else referencedTables(item, targets);
  }
}

/** Remove only unchanged, unreferenced empty tables left by the old starter template. */
export function planUnusedDefaultTables(store: VersionStore, definitions: DatasetDef[], gameplay: GameplayStore, functional: FunctionalStore) {
  readVersions({ getItem: () => JSON.stringify(store), setItem() {} }, '', emptyProjectData);
  validateDefinitions(definitions); validateGameplay(gameplay); validateFunctionalSystems(functional);
  const removable = new Set<string>();
  for (const legacy of datasetDefinitions) {
    const definition = definitions.find(item => item.key === legacy.key);
    if (definition && store.data.datasets[legacy.key]?.length === 0 &&
        canonical(definition) === canonical(legacy) && canonical(store.data.columns[legacy.key]) === canonical(legacy.columns)) removable.add(legacy.key);
  }
  const references = new Set<string>();
  referencedTables(gameplay, references); referencedTables(functional, references);
  referencedTables(store.releases, references); referencedTables(store.reviews, references);
  for (const key of references) removable.delete(key);
  // A retained table may itself point at a removable table. Iterate to a fixed point.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, columns] of Object.entries(store.data.columns)) {
      if (removable.has(key)) continue;
      const targets = new Set<string>(); referencedTables(columns, targets);
      for (const target of targets) if (removable.delete(target)) changed = true;
    }
    for (const definition of definitions) {
      if (removable.has(definition.key)) continue;
      const targets = new Set<string>(); referencedTables(definition.columns, targets);
      for (const target of targets) if (removable.delete(target)) changed = true;
    }
  }
  const removed = datasetDefinitions.filter(item => removable.has(item.key)).map(item => item.key);
  if (!removed.length) return { store, definitions, removed };
  const next = structuredClone(store);
  for (const key of removed) { delete next.data.columns[key]; delete next.data.datasets[key]; }
  next.revision += 1;
  return { store: next, definitions: definitions.filter(item => !removable.has(item.key)), removed };
}
function readInputs(project: SavedProject, entries: RawEntry[]) {
  const raw = (key: string) => entries.find(entry => entry.key === key)?.value ?? null;
  const versionRaw = raw(enumKey(project.id));
  const store = readVersions({ getItem: () => versionRaw, setItem() {} }, '', project.initialContent === 'legacy' ? initialData : emptyProjectData);
  const definitionsRaw = raw(workspaceKey(project.id, 'definitions'));
  // Old archives sometimes omitted the directory; only reconstruct tables that actually exist.
  const fallback = Object.entries(store.data.columns).map(([key, columns]) => {
    const legacy = datasetDefinitions.find(item => item.key === key);
    return legacy ? structuredClone(legacy) : { key, label: key, badge: '0', columns: structuredClone(columns) };
  });
  const definitions = definitionsRaw === null ? fallback : validateDefinitions(JSON.parse(definitionsRaw));
  const gameplayRaw = raw(workspaceKey(project.id, 'gameplay'));
  const functionalRaw = raw(workspaceKey(project.id, 'functional-systems'));
  return { store, definitions, gameplay: gameplayRaw === null ? emptyGameplay() : validateGameplay(JSON.parse(gameplayRaw)),
    functional: functionalRaw === null ? emptyFunctionalSystems() : validateFunctionalSystems(JSON.parse(functionalRaw)) };
}
function makePending(project: SavedProject, originals: RawEntry[]): PendingMigration {
  const { store, definitions, gameplay, functional } = readInputs(project, originals);
  const plan = planUnusedDefaultTables(store, definitions, gameplay, functional);
  const mutations: Mutation[] = plan.removed.length ? [
    { key: enumKey(project.id), before: originals.find(entry => entry.key === enumKey(project.id))!.value, after: JSON.stringify(plan.store) },
    { key: workspaceKey(project.id, 'definitions'), before: originals.find(entry => entry.key === workspaceKey(project.id, 'definitions'))!.value, after: JSON.stringify(plan.definitions) },
  ] : [];
  return { schema: 1, state: 'pending', removed: plan.removed, entries: mutations,
    guards: originals.filter(entry => !mutations.some(mutation => mutation.key === entry.key)) };
}
function parseMarker(raw: string, project: SavedProject): PendingMigration | CompletedMigration {
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.schema !== 1 || !['pending', 'done'].includes(value.state as string) || !Array.isArray(value.removed) ||
      value.removed.some(key => typeof key !== 'string' || !datasetDefinitions.some(item => item.key === key)) || new Set(value.removed).size !== value.removed.length) return fail('清理记录格式异常');
  if (value.state === 'done') return value as CompletedMigration;
  if (!Array.isArray(value.entries) || !Array.isArray(value.guards)) return fail('未完成的清理记录不完整');
  const originals: RawEntry[] = [];
  for (const entry of value.entries) {
    if (!record(entry) || typeof entry.key !== 'string' || (entry.before !== null && typeof entry.before !== 'string') || typeof entry.after !== 'string') return fail('清理计划格式异常');
    originals.push({ key: entry.key, value: entry.before });
  }
  for (const entry of value.guards) {
    if (!record(entry) || typeof entry.key !== 'string' || (entry.value !== null && typeof entry.value !== 'string')) return fail('清理基准格式异常');
    originals.push({ key: entry.key, value: entry.value });
  }
  const expectedKeys = sourceKeys(project.id);
  if (originals.length !== expectedKeys.length || expectedKeys.some(key => originals.filter(entry => entry.key === key).length !== 1)) return fail('清理记录的项目范围异常');
  // Recompute the saved operation so malformed recovery data can never become arbitrary writes.
  const expected = makePending(project, expectedKeys.map(key => originals.find(entry => entry.key === key)!));
  if (canonical(value) !== canonical(expected)) return fail('清理记录与原始存档不一致');
  return value as PendingMigration;
}
const sourceKeys = (id: string) => [enumKey(id), workspaceKey(id, 'definitions'), workspaceKey(id, 'gameplay'), workspaceKey(id, 'functional-systems')];

/** A project-scoped write-ahead record makes partial writes retryable without guessing or overwriting edits. */
export function migrateUnusedDefaultTables(storage: StorageLike, project: SavedProject): { removed: string[] } {
  const markerKey = defaultTableMigrationKey(project.id);
  let markerRaw = storage.getItem(markerKey);
  let marker = markerRaw === null ? null : parseMarker(markerRaw, project);
  if (marker?.state === 'done') return { removed: marker.removed };
  if (!marker) {
    const originals = sourceKeys(project.id).map(key => ({ key, value: storage.getItem(key) }));
    marker = makePending(project, originals);
    if (storage.getItem(markerKey) !== null || originals.some(entry => storage.getItem(entry.key) !== entry.value)) return fail('项目已被其他窗口修改，请重试');
    if (!marker.removed.length) {
      storage.setItem(markerKey, JSON.stringify({ schema: 1, state: 'done', removed: [] } satisfies CompletedMigration));
      return { removed: [] };
    }
    markerRaw = JSON.stringify(marker);
    storage.setItem(markerKey, markerRaw);
  }
  const pending = marker;
  const verify = () => {
    if (storage.getItem(markerKey) !== markerRaw || pending.guards.some(entry => storage.getItem(entry.key) !== entry.value) ||
        pending.entries.some(entry => { const current = storage.getItem(entry.key); return current !== entry.before && current !== entry.after; })) {
      return fail('上次清理后项目有新修改，已停止恢复，避免覆盖现有数据');
    }
  };
  verify();
  for (const entry of pending.entries) {
    verify();
    if (storage.getItem(entry.key) !== entry.after) storage.setItem(entry.key, entry.after);
  }
  verify();
  storage.setItem(markerKey, JSON.stringify({ schema: 1, state: 'done', removed: pending.removed } satisfies CompletedMigration));
  return { removed: pending.removed };
}
