import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { preparePrototypeProject, validatePrototypeExample, writePrototypeProject } from '../src/prototype-import.ts';
import { prototypeExamples } from '../src/prototype-examples.ts';
import { PROJECT_CATALOG_KEY, defaultCatalog, readProjectCatalog } from '../src/project-catalog.ts';
import { readVersions } from '../src/enum-storage.ts';
import { readGameplay } from '../src/gameplay.ts';
import { readFunctionalSystems } from '../src/functional-systems.ts';
import { readArtAssets } from '../src/art-assets.ts';

const require = createRequire(import.meta.url);
const { createWorkspaceStorage } = require('../desktop/test-workspaces.cjs');
const config = { engine: 'oasis-lua', projectPath: 'E:/Existing/Game', enumPath: 'Private/Enums', dataPath: 'Private/Data', outputFormat: 'lua', autoSync: true, backupBeforeSync: true };
const catalog = defaultCatalog(config, '现有项目');
const workspaceKey = (id, section) => 'gamecreator.workspace.v1:' + id + ':' + section;
const enumKey = id => 'gamecreator.enum-versions.v1:' + id;
const fixtures = new Map(await Promise.all(prototypeExamples.map(async summary => [summary.id,
  JSON.parse(await fs.readFile(new URL('../examples/prototypes/' + summary.id + '.json', import.meta.url), 'utf8'))])));
const fixture = id => structuredClone(fixtures.get(id ?? 'hollow-knight'));
function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  const writes = [];
  return { values, writes, getItem: key => values.get(key) ?? null,
    setItem(key, value) { writes.push(key); values.set(key, value); } };
}
function originals() {
  return { [PROJECT_CATALOG_KEY]: JSON.stringify(catalog),
    [workspaceKey(catalog.activeId, 'project')]: '{"name":"现有项目","description":"用户修改"}',
    [workspaceKey(catalog.activeId, 'art-assets')]: '{"userFile":"idle.png","version":1}',
    [enumKey(catalog.activeId)]: '{"revision":9,"history":"用户审核记录"}',
    'gamecreator.team-connection.v1': '{"selectedTeam":"existing-team"}',
    'gamecreator.test-session.v1': '{"active":"existing-test"}' };
}
function assertUntouched(storage, previous) { for (const [key, value] of Object.entries(previous)) assert.equal(storage.getItem(key), value, key); }

for (const summary of prototypeExamples) {
  test(summary.id + ': complete editable archives preserve all design/reference maps and match the example card', () => {
    const example = fixture(summary.id);
    const expectedTables = { 'hollow-knight': 8, 'stardew-valley': 9, 'plants-vs-zombies': 4, 'disco-elysium': 15, 'vampire-survivors': 16 };
    assert.equal(example.definitions.length, expectedTables[summary.id]);
    assert.ok(['items', 'characters', 'skills', 'economy', 'shop'].every(key => !Object.hasOwn(example.data.datasets, key)));
    assert.deepEqual(Object.keys(example.data.datasets).sort(), example.definitions.map(definition => definition.key).sort());
    assert.deepEqual(Object.keys(example.data.columns).sort(), example.definitions.map(definition => definition.key).sort());
    const baseline = structuredClone(example);
    const originalCatalog = structuredClone(catalog);
    assert.equal(validatePrototypeExample(example), example);
    assert.equal(summary.name, example.name);
    assert.equal(summary.description, example.description);
    assert.deepEqual(summary.counts, {
      gameplay: example.gameplay.designs.length, systems: example.functionalSystems.systems.length,
      requirements: example.artAssets.requirements.length, assets: example.artAssets.assets.length,
      tables: Object.values(example.data.datasets).filter(rows => rows.length > 0).length,
      records: Object.values(example.data.datasets).reduce((sum, rows) => sum + rows.length, 0), stories: example.stories.length,
    });
    const prepared = preparePrototypeProject(catalog, example, '  可编辑副本  ');
    assert.deepEqual(catalog, originalCatalog);
    assert.deepEqual(example, baseline);
    assert.equal(prepared.project.name, '可编辑副本');
    assert.equal(prepared.project.initialContent, 'empty');
    assert.equal(prepared.catalog.activeId, prepared.project.id);
    assert.equal(prepared.catalog.mode, 'project');
    assert.match(prepared.project.id, /^project-[0-9a-f-]{36}$/);
    assert.equal(prepared.project.config.projectPath, '');
    assert.equal(prepared.project.config.autoSync, false);
    assert.equal(prepared.project.config.enumPath, 'Script/Const');
    assert.equal(prepared.project.config.dataPath, 'Script/Config');
    const prior = originals();
    const storage = memoryStorage(prior);
    writePrototypeProject(storage, prepared);
    assertUntouched(storage, prior);
    assert.equal(storage.writes.length, 15);
    assert.ok(!storage.writes.includes(PROJECT_CATALOG_KEY));
    const id = prepared.project.id;
    assert.deepEqual(readGameplay(storage, workspaceKey(id, 'gameplay')).store, example.gameplay);
    assert.deepEqual(readFunctionalSystems(storage, workspaceKey(id, 'functional-systems')).store, example.functionalSystems);
    assert.deepEqual(readArtAssets(storage, workspaceKey(id, 'art-assets')).store, example.artAssets);
    assert.deepEqual(JSON.parse(storage.getItem(workspaceKey(id, 'definitions'))), example.definitions);
    assert.deepEqual(JSON.parse(storage.getItem(workspaceKey(id, 'stories'))), example.stories);
    assert.deepEqual(JSON.parse(storage.getItem(workspaceKey(id, 'milestones'))), []);
    assert.deepEqual(JSON.parse(storage.getItem(workspaceKey(id, 'project'))), {
      name: '可编辑副本', description: example.description, genre: '未指定', platform: '未指定', version: 'v0.1.0', status: '原型设计',
    });
    const versions = readVersions(storage, enumKey(id), example.data);
    assert.deepEqual(versions.data, example.data);
    assert.equal(versions.revision, 0);
    assert.equal(versions.activeId, null);
    assert.equal(versions.candidateId, null);
    assert.deepEqual(versions.snapshots, []);
    assert.deepEqual(JSON.parse(storage.getItem(workspaceKey(prepared.project.id, 'gameplay-core'))), example.gameplayCore);
    assert.deepEqual(versions.releases, []);
    assert.deepEqual(versions.reviews, {});
    example.gameplay.designs[0].title = '修改载入源不应改变已序列化副本';
    assert.deepEqual(JSON.parse(storage.getItem(workspaceKey(id, 'gameplay'))), baseline.gameplay);
  });
}

test('repeat imports keep stable module IDs in separate namespaces and edits remain independent after disk restart', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gamecreator-prototype-import-'));
  t.after(async () => {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith('gamecreator-prototype-import-'));
    await fs.rm(target, { recursive: true, force: true });
  });
  const example = fixture('stardew-valley');
  const storage = createWorkspaceStorage(directory);
  const prior = originals();
  for (const [key, value] of Object.entries(prior)) storage.setItem(key, value);
  const first = preparePrototypeProject(catalog, example, '同名原型');
  writePrototypeProject(storage, first);
  storage.setItem(PROJECT_CATALOG_KEY, JSON.stringify(first.catalog));
  const second = preparePrototypeProject(first.catalog, example, '同名原型');
  writePrototypeProject(storage, second);
  storage.setItem(PROJECT_CATALOG_KEY, JSON.stringify(second.catalog));
  assert.notEqual(first.project.id, second.project.id);
  assert.ok(first.entries.every(entry => !second.entries.some(other => other.key === entry.key)));
  const firstGameplayKey = workspaceKey(first.project.id, 'gameplay');
  const edited = JSON.parse(storage.getItem(firstGameplayKey));
  edited.designs[0].title = '独立修改';
  storage.setItem(firstGameplayKey, JSON.stringify(edited));
  const reopened = createWorkspaceStorage(directory);
  assert.deepEqual(readProjectCatalog(reopened, config, 'ignored'), second.catalog);
  assert.equal(JSON.parse(reopened.getItem(firstGameplayKey)).designs[0].title, '独立修改');
  assert.deepEqual(JSON.parse(reopened.getItem(workspaceKey(second.project.id, 'gameplay'))), example.gameplay);
  assert.deepEqual(JSON.parse(reopened.getItem(workspaceKey(second.project.id, 'art-assets'))), example.artAssets);
  for (const [key, value] of Object.entries(prior)) if (key !== PROJECT_CATALOG_KEY) assert.equal(reopened.getItem(key), value);
});

test('every partial archive failure leaves the old project/catalog untouched and allows a fresh-identity retry', () => {
  for (let failAt = 0; failAt < 13; failAt++) {
    const prior = originals();
    const storage = memoryStorage(prior);
    const prepared = preparePrototypeProject(catalog, fixture(), '失败导入');
    let attempts = 0;
    const failingStorage = { getItem: storage.getItem, setItem(key, value) {
      if (attempts++ === failAt) throw new Error('disk write failed');
      storage.setItem(key, value);
    } };
    assert.throws(() => {
      writePrototypeProject(failingStorage, prepared);
      storage.setItem(PROJECT_CATALOG_KEY, JSON.stringify(prepared.catalog));
    }, /disk write failed/);
    assertUntouched(storage, prior);
    assert.equal(storage.writes.length, failAt);
    assert.ok(storage.writes.every(key => prepared.entries.some(entry => entry.key === key)));
    const retry = preparePrototypeProject(catalog, fixture(), '重新创建');
    assert.notEqual(retry.project.id, prepared.project.id);
    writePrototypeProject(storage, retry);
    storage.setItem(PROJECT_CATALOG_KEY, JSON.stringify(retry.catalog));
    assert.equal(JSON.parse(storage.getItem(PROJECT_CATALOG_KEY)).projects.length, 2);
    assert.equal(JSON.parse(storage.getItem(PROJECT_CATALOG_KEY)).activeId, retry.project.id);
  }
});

test('catalog publication failure leaves complete but unreachable new archives and preserves the previous project selection', () => {
  const prior = originals();
  const storage = memoryStorage(prior);
  const prepared = preparePrototypeProject(catalog, fixture(), '不可发布副本');
  const failingStorage = { getItem: storage.getItem, setItem(key, value) {
    if (key === PROJECT_CATALOG_KEY) throw new Error('catalog write failed');
    storage.setItem(key, value);
  } };
  assert.throws(() => {
    writePrototypeProject(failingStorage, prepared);
    failingStorage.setItem(PROJECT_CATALOG_KEY, JSON.stringify(prepared.catalog));
  }, /catalog write failed/);
  assertUntouched(storage, prior);
  assert.equal(storage.writes.length, 15);
});

test('collision preflight checks all archive keys before writing any, including a collision at the last key', () => {
  const prepared = preparePrototypeProject(catalog, fixture(), '碰撞检查');
  for (const entry of prepared.entries) {
    const storage = memoryStorage({ [entry.key]: 'existing user content' });
    assert.throws(() => writePrototypeProject(storage, prepared), /已有数据/);
    assert.deepEqual(storage.writes, []);
    assert.equal(storage.getItem(entry.key), 'existing user content');
  }
  const storage = memoryStorage();
  writePrototypeProject(storage, prepared);
  assert.throws(() => writePrototypeProject(storage, prepared), /已有数据/);
  assert.equal(storage.writes.length, 15);
});

test('write guard rejects keys outside the fresh project and preflight read failures write nothing', () => {
  const prepared = preparePrototypeProject(catalog, fixture(), '范围检查');
  const tampered = structuredClone(prepared);
  tampered.entries[0].key = workspaceKey(catalog.activeId, 'gameplay');
  const storage = memoryStorage(originals());
  assert.throws(() => writePrototypeProject(storage, tampered), /范围无效/);
  assert.deepEqual(storage.writes, []);
  assert.throws(() => writePrototypeProject({ getItem(key) {
    if (key === prepared.entries.at(-1).key) throw new Error('read failed');
    return null;
  }, setItem: storage.setItem }, prepared), /read failed/);
  assert.deepEqual(storage.writes, []);
});

test('malformed or nonportable snapshots and broken references fail before preparation can produce writes', () => {
  const mutations = [
    ['unexpected engine configuration', x => { x.config = config; }],
    ['unsupported schema', x => { x.schema = 2; }],
    ['missing module', x => { delete x.artAssets; }],
    ['missing table definition', x => { x.definitions = x.definitions.filter(d => d.key !== 'hk_params'); }],
    ['mismatched column maps', x => { delete x.data.columns.hk_params; }],
    ['mismatched field definition', x => { x.definitions.find(definition => definition.key === 'hk_params').columns[0].label = 'changed'; }],
    ['non-string cell', x => { x.data.datasets.hk_params[0].value = 5; }],
    ['extra cell', x => { x.data.datasets.hk_params[0].unknown = 'extra'; }],
    ['duplicate record', x => { x.data.datasets.hk_params.push(x.data.datasets.hk_params[0]); }],
    ['external engine enum', x => { x.definitions.find(definition => definition.key === 'hk_params').columns[0].enumId = 'private#Type'; x.data.columns.hk_params[0].enumId = 'private#Type'; }],
    ['missing reference table', x => { delete x.data.datasets.hk_rooms; delete x.data.columns.hk_rooms; x.definitions = x.definitions.filter(definition => definition.key !== 'hk_rooms'); }],
    ['dangling record reference', x => { x.data.datasets.hk_points[0].room = 'missing-room'; }],
    ['missing story link', x => { x.gameplay.designs[0].links.push({ kind: 'story', targetId: 'missing-story' }); }],
    ['missing capability', x => { x.functionalSystems.usages[0].capabilityId = 'missing-capability'; }],
    ['missing art source', x => { x.artAssets.requirements[0].sources[0].targetId = 'missing-design'; }],
    ['fabricated test', x => { x.gameplay.designs[0].checks[0].result = '通过'; }],
    ['fabricated completion', x => { x.functionalSystems.capabilities[0].status = '已完成'; }],
    ['local art owner', x => { x.artAssets.requirements[0].owner = 'someone'; }],
    ['local delivery file', x => { x.artAssets.assets[0].versions.push({ id: 'version', name: 'v1', notes: '', placeholder: true,
      review: '待审核', feedback: '', createdAt: new Date().toISOString(), files: [{ id: 'file', name: 'idle.png', size: 1, mime: 'image/png', storagePath: 'local-file.png' }] }); }],
    ['invalid story relations', x => { x.stories[0].relations = null; }],
  ];
  for (const [label, mutate] of mutations) {
    const example = fixture();
    mutate(example);
    assert.throws(() => preparePrototypeProject(catalog, example, '无法导入'), Error, label);
  }
  for (const name of ['', '   ', 'x'.repeat(101), null]) assert.throws(() => preparePrototypeProject(catalog, fixture(), name), /项目名称/);
  for (const input of [null, [], '', 1]) assert.throws(() => validatePrototypeExample(input), /原型示例无效/);
});
