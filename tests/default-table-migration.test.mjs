import test from 'node:test';
import assert from 'node:assert/strict';
import { datasetDefinitions, initialData } from '../src/project-defaults.ts';
import { emptyStore } from '../src/enum-versions.ts';
import { readVersions } from '../src/enum-storage.ts';
import { emptyGameplay, createGameplay } from '../src/gameplay.ts';
import { emptyFunctionalSystems, createCapability, createFunctionalSystem } from '../src/functional-systems.ts';
import { defaultTableMigrationKey, migrateUnusedDefaultTables, planUnusedDefaultTables } from '../src/default-table-migration.ts';

const project = { id: 'project-migration-test', name: '旧项目', initialContent: 'empty', config: {} };
const key = suffix => 'gamecreator.workspace.v1:' + project.id + ':' + suffix;
const versionKey = 'gamecreator.enum-versions.v1:' + project.id;
const defaults = () => structuredClone(datasetDefinitions);
const data = () => ({ columns: Object.fromEntries(defaults().map(def => [def.key, def.columns])), datasets: Object.fromEntries(defaults().map(def => [def.key, []])) });
const bundle = () => ({ store: emptyStore(data()), definitions: defaults(), gameplay: emptyGameplay(), functional: emptyFunctionalSystems() });
const plan = value => planUnusedDefaultTables(value.store, value.definitions, value.gameplay, value.functional);
const allKeys = datasetDefinitions.map(def => def.key);
function memory(value = bundle()) {
  const values = new Map([[versionKey, JSON.stringify(value.store)], [key('definitions'), JSON.stringify(value.definitions)],
    [key('gameplay'), JSON.stringify(value.gameplay)], [key('functional-systems'), JSON.stringify(value.functional)]]);
  const writes = [];
  return { values, writes, getItem: key => values.get(key) ?? null, setItem(key, value) { writes.push(key); values.set(key, value); } };
}
function read(store) { return readVersions({ getItem: () => JSON.stringify(store), setItem() {} }, '', { datasets: {}, columns: {} }); }

test('unchanged empty defaults are removed as a group, with custom tables and source objects intact', () => {
  const value = bundle();
  value.store.revision = 7;
  value.store.data.columns.custom = [{ key: 'id', label: 'ID' }];
  value.store.data.datasets.custom = [{ id: 'custom' }];
  value.definitions.push({ key: 'custom', label: '自建', badge: '1', columns: value.store.data.columns.custom });
  const before = structuredClone(value), result = plan(value);
  assert.deepEqual(result.removed, allKeys);
  assert.deepEqual(Object.keys(result.store.data.datasets), ['custom']);
  assert.equal(result.store.revision, 8);
  assert.deepEqual(result.definitions.map(def => def.key), ['custom']);
  assert.deepEqual(value, before);
});

test('records, renamed tables, changed columns and retained-table references protect user work', () => {
  for (const mutate of [
    value => value.store.data.datasets.items.push({ id: 'owned-item' }),
    value => { value.definitions[0].label = '我的物品'; },
    value => { value.store.data.columns.items[0].label = '自定义 ID'; },
    value => { value.definitions[0].columns[0].label = '自定义 ID'; },
    value => { value.definitions.find(def => def.key === 'shop').label = '商店'; },
    value => {
      value.store.data.columns.custom = [{ key: 'id', label: 'ID' }, { key: 'target', label: '关联', type: 'reference', reference: 'shop' }];
      value.store.data.datasets.custom = [];
    },
  ]) {
    const value = bundle(); mutate(value);
    assert.ok(!plan(value).removed.includes('items'));
  }
});

test('gameplay links, archived capabilities, historical patches and review bindings prevent deletion', () => {
  for (const mutate of [
    value => { const design = createGameplay('测试'); design.links.push({ kind: 'dataset', targetId: 'items' }); value.gameplay.designs.push(design); },
    value => { const system = createFunctionalSystem('测试'); const capability = createCapability(system.id, '功能'); capability.archived = true; capability.configRefs.push({ id: 'ref', datasetKey: 'items', rowId: '', columnKey: '', note: '' }); value.functional.systems.push(system); value.functional.capabilities.push(capability); },
    value => value.store.releases.push({ patches: [{ table: 'items', rowId: 'deleted', field: 'name', before: 'a', after: 'b' }], accepted: [] }),
    value => { value.store.reviews.old = { selected: [], acknowledged: [], migrations: {}, reviewer: '', note: '', binding: { table: 'items' } }; },
  ]) {
    const value = bundle(); mutate(value);
    assert.ok(!plan(value).removed.includes('items'));
  }
});

test('version archives accept arbitrary dynamic tables and no tables, but reject malformed maps/rows/columns', () => {
  const empty = emptyStore({ datasets: {}, columns: {} });
  assert.deepEqual(read(empty), empty);
  const dynamic = emptyStore({ datasets: { user_table: [{ id: '1', name: '玩家' }] }, columns: { user_table: [{ key: 'id', label: 'ID' }, { key: 'name', label: '名称' }] } });
  assert.deepEqual(read(dynamic), dynamic);
  for (const mutate of [
    value => { value.data.columns = []; },
    value => { value.data.datasets.extra = []; },
    value => { value.data.datasets.user_table = {}; },
    value => { value.data.columns.user_table.push({ key: 'name', label: '重复字段' }); },
    value => { value.data.columns.user_table[0].reference = 4; },
    value => { value.data.datasets.user_table[0].name = 9; },
    value => { value.revision = -1; },
  ]) {
    const corrupted = structuredClone(dynamic); mutate(corrupted); assert.throws(() => read(corrupted));
  }
});

test('completed marker makes migration one-time even when users later create matching empty tables', () => {
  const storage = memory();
  assert.deepEqual(migrateUnusedDefaultTables(storage, project).removed, allKeys);
  assert.deepEqual(JSON.parse(storage.getItem(versionKey)).data, { columns: {}, datasets: {} });
  assert.deepEqual(JSON.parse(storage.getItem(defaultTableMigrationKey(project.id))), { schema: 1, state: 'done', removed: allKeys });
  const userStore = emptyStore(data()); userStore.revision = 9;
  storage.values.set(versionKey, JSON.stringify(userStore)); storage.values.set(key('definitions'), JSON.stringify(defaults()));
  const writes = storage.writes.length;
  migrateUnusedDefaultTables(storage, project);
  assert.equal(storage.writes.length, writes);
  assert.deepEqual(JSON.parse(storage.getItem(versionKey)), userStore);
});

test('partial failure resumes from saved originals without repeat revisions or losing archive content', () => {
  const storage = memory();
  const setItem = storage.setItem.bind(storage); let fail = true;
  storage.setItem = (target, value) => { if (fail && target === key('definitions')) throw new Error('磁盘写入失败'); setItem(target, value); };
  assert.throws(() => migrateUnusedDefaultTables(storage, project), /磁盘写入失败/);
  const pending = JSON.parse(storage.getItem(defaultTableMigrationKey(project.id)));
  assert.equal(pending.state, 'pending');
  assert.equal(JSON.parse(storage.getItem(versionKey)).revision, 1);
  fail = false;
  migrateUnusedDefaultTables(storage, project);
  assert.equal(JSON.parse(storage.getItem(versionKey)).revision, 1);
  assert.deepEqual(JSON.parse(storage.getItem(key('definitions'))), []);
  assert.equal(JSON.parse(storage.getItem(defaultTableMigrationKey(project.id))).state, 'done');
});

test('recovery refuses intervening edits and corrupt inputs before any further writes', () => {
  const storage = memory(); const setItem = storage.setItem.bind(storage);
  storage.setItem = (target, value) => { if (target === key('definitions')) throw new Error('失败'); setItem(target, value); };
  assert.throws(() => migrateUnusedDefaultTables(storage, project));
  const changed = emptyStore(data()); changed.data.datasets.items.push({ id: 'user-work' });
  storage.values.set(versionKey, JSON.stringify(changed)); storage.setItem = setItem;
  const writes = storage.writes.length;
  assert.throws(() => migrateUnusedDefaultTables(storage, project), /有新修改/);
  assert.equal(storage.writes.length, writes);
  assert.deepEqual(JSON.parse(storage.getItem(versionKey)), changed);
  for (const target of [versionKey, key('definitions'), key('gameplay'), key('functional-systems')]) {
    const corrupt = memory(); corrupt.values.set(target, '{bad JSON');
    assert.throws(() => migrateUnusedDefaultTables(corrupt, project)); assert.equal(corrupt.writes.length, 0);
  }
});

test('missing archives keep new projects empty and preserve populated legacy starter projects', () => {
  const empty = memory(); empty.values.clear();
  assert.deepEqual(migrateUnusedDefaultTables(empty, project), { removed: [] });
  assert.equal(empty.getItem(versionKey), null);
  const legacy = memory(); legacy.values.clear();
  assert.deepEqual(migrateUnusedDefaultTables(legacy, { ...project, initialContent: 'legacy' }), { removed: [] });
  assert.equal(legacy.getItem(versionKey), null);
  assert.equal(Object.values(initialData.datasets).flat().length, 16);
  const missingDirectory = memory(); missingDirectory.values.delete(key('definitions'));
  assert.deepEqual(migrateUnusedDefaultTables(missingDirectory, project).removed, allKeys);
  assert.deepEqual(JSON.parse(missingDirectory.getItem(key('definitions'))), []);
});

test('recovery marker cannot target another project or rewrite a planned archive arbitrarily', () => {
  for (const modify of [
    pending => { pending.entries[0].key = 'gamecreator.enum-versions.v1:another-project'; },
    pending => { pending.entries[0].after = JSON.stringify(emptyStore(data())); },
  ]) {
    const storage = memory(); const originalSet = storage.setItem.bind(storage);
    storage.setItem = (target, value) => { if (target === versionKey) throw new Error('失败'); originalSet(target, value); };
    assert.throws(() => migrateUnusedDefaultTables(storage, project));
    const pending = JSON.parse(storage.getItem(defaultTableMigrationKey(project.id))); modify(pending);
    storage.values.set(defaultTableMigrationKey(project.id), JSON.stringify(pending)); storage.setItem = originalSet;
    const writes = storage.writes.length;
    assert.throws(() => migrateUnusedDefaultTables(storage, project));
    assert.equal(storage.writes.length, writes);
  }
});
