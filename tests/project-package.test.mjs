import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { captureProjectPackage, validateProjectPackage, prepareProjectPackageImport, writeProjectPackageImport } from '../src/project-package.ts';
import { preparePrototypeProject, writePrototypeProject } from '../src/prototype-import.ts';
import { PROJECT_CATALOG_KEY, defaultCatalog, addSavedProject } from '../src/project-catalog.ts';
import { initialData, initialMilestones, initialProject, datasetDefinitions, emptyProjectData } from '../src/project-defaults.ts';
import { initialStoryDocs } from '../src/story-model.ts';
import { makeSnapshot, prepareScan, stageSnapshot, decideChanges, diffEnums, syncApprovedChanges } from '../src/enum-versions.ts';

const config = { engine: 'oasis-lua', projectPath: 'E:/Private/Game', enumPath: 'Game/Enums', dataPath: 'Game/Data', outputFormat: 'json', autoSync: true, backupBeforeSync: true };
const catalog = defaultCatalog(config, '原始项目');
const key = (id, section) => section === 'enum-versions' ? 'gamecreator.enum-versions.v1:' + id : 'gamecreator.workspace.v1:' + id + ':' + section;
function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries)), writes = [], reads = [];
  return { values, writes, reads, getItem(key) { reads.push(key); return values.get(key) ?? null; },
    setItem(key, value) { writes.push(key); values.set(key, value); } };
}
const example = JSON.parse(await fs.readFile(new URL('../examples/prototypes/stardew-valley.json', import.meta.url), 'utf8'));
function projectStorage() {
  const prepared = preparePrototypeProject(catalog, example, '用户已修改的农场');
  prepared.project.config = structuredClone(config);
  const storage = memoryStorage({ [PROJECT_CATALOG_KEY]: JSON.stringify(prepared.catalog) });
  writePrototypeProject(storage, { ...prepared, project: { ...prepared.project, config: { ...config, projectPath: '' } } });
  storage.writes.length = 0;
  return { storage, project: prepared.project, catalog: prepared.catalog };
}
function updateArchive(storage, project, section, edit) {
  const raw = JSON.parse(storage.getItem(key(project.id, section)));
  edit(raw); storage.setItem(key(project.id, section), JSON.stringify(raw));
}
async function completedProject() {
  const source = projectStorage();
  updateArchive(source.storage, source.project, 'gameplay', store => {
    store.designs[0].status = '已验证';
    store.designs[0].prototype[0].done = true;
    store.designs[0].checks[0].result = '通过';
    store.designs[0].checks[0].actual = '实际体验和设计一致';
    store.designs[1].archived = true;
  });
  updateArchive(source.storage, source.project, 'functional-systems', store => { store.capabilities[0].status = '已完成'; });
  updateArchive(source.storage, source.project, 'art-assets', store => {
    const asset = store.assets[0];
    asset.versions = [{ id: 'reviewed-version', name: '正式立绘', notes: '修正轮廓', placeholder: false, review: '已通过', feedback: '通过评审',
      createdAt: '2026-09-19T03:00:00.000Z', files: [{ id: 'f3f5d2c4-1234-4acd-9561-72fe23952bad', name: 'idle.png', size: 28180,
        mime: 'image/png', storagePath: 'f3f5d2c4-1234-4acd-9561-72fe23952bad.png' }] }];
    asset.adoptedVersionId = 'reviewed-version';
    store.requirements[0].owner = '原画组'; store.requirements[0].dueDate = '2026-10-10';
  });
  let versions = JSON.parse(source.storage.getItem(key(source.project.id, 'enum-versions')));
  const scan = prepareScan({ projectPath: config.projectPath, enumPath: config.enumPath, files: ['Game/Enums/Season.lua'],
    groups: [{ name: 'Season.Type', source: 'Game/Enums/Season.lua', line: 1, valueType: 'string', comment: '季节',
      members: [{ key: 'SPRING', value: 'spring', line: 2, comment: '春季' }] }], orderTables: [], dynamic: [],
    counts: { files: 1, groups: 1, members: 1 } });
  versions = stageSnapshot(versions, await makeSnapshot(scan, 'source'));
  versions = decideChanges(versions, diffEnums(null, scan).map(change => change.id), true, '审核员');
  versions = await syncApprovedChanges(versions);
  const updatedScan = structuredClone(scan);
  updatedScan.groups[0].members.push({ key: 'SUMMER', value: 'summer', line: 3, comment: '夏季' }); updatedScan.counts.members = 2;
  versions = stageSnapshot(versions, await makeSnapshot(updatedScan, 'source'));
  versions.revision = 12;
  source.storage.setItem(key(source.project.id, 'enum-versions'), JSON.stringify(versions));
  source.storage.setItem(key(source.project.id, 'data-view'), JSON.stringify({ version: 1, activeDataset: 'farm_core', directoryWidth: 240,
    directoryCollapsed: true, emptyExpanded: false, tables: { farm_core: { query: '精力', filter: 'warning', selectedId: 'energy', detailOpen: true, scrollTop: 90, scrollLeft: 25 } } }));
  return source;
}

test('capture materializes legacy defaults with no writes and includes catalog + all raw sections for concurrent-change checks', () => {
  const storage = memoryStorage({ [PROJECT_CATALOG_KEY]: JSON.stringify(catalog) });
  const snapshot = captureProjectPackage(storage, catalog.projects[0]);
  assert.deepEqual(snapshot.document.archives.definitions, datasetDefinitions);
  assert.deepEqual(snapshot.document.archives['enum-versions'].data, initialData);
  assert.deepEqual(snapshot.document.archives.stories, initialStoryDocs);
  assert.deepEqual(snapshot.document.archives.milestones, initialMilestones);
  assert.deepEqual(snapshot.document.archives.project, { ...initialProject, name: catalog.projects[0].name });
  assert.equal(snapshot.expectedEntries.length, 10);
  assert.equal(new Set(storage.reads).size, storage.reads.length);
  assert.equal(snapshot.expectedEntries[0].key, PROJECT_CATALOG_KEY);
  assert.equal(snapshot.expectedEntries.filter(item => item.value === null).length, 9);
  assert.equal(snapshot.document.project.config.projectPath, '');
  assert.equal(snapshot.document.project.config.autoSync, false);
  assert.equal(catalog.projects[0].config.projectPath, config.projectPath);
  assert.deepEqual(storage.writes, []);
});

test('new project defaults contain no legacy stories, records or milestones, and are detached from shared defaults', () => {
  const next = addSavedProject(catalog, '零起点');
  const project = next.projects.at(-1);
  const snapshot = captureProjectPackage(memoryStorage({ [PROJECT_CATALOG_KEY]: JSON.stringify(next) }), project);
  assert.deepEqual(snapshot.document.archives['enum-versions'].data, emptyProjectData);
  assert.deepEqual(snapshot.document.archives.stories, []);
  assert.deepEqual(snapshot.document.archives.milestones, []);
  assert.equal(snapshot.document.archives.project.description, '');
  assert.equal(snapshot.document.archives.project.version, 'v0.1.0');
  snapshot.document.archives.definitions[0].label = 'Changed';
  assert.equal(datasetDefinitions[0].label, 'Items');
});

test('real project round trip retains completed gameplay, functional status, art delivery/review/adoption and full enum history', async () => {
  const { storage, project, catalog: current } = await completedProject();
  const before = new Map(storage.values);
  const snapshot = captureProjectPackage(storage, project);
  for (const expected of snapshot.expectedEntries) assert.equal(expected.value, before.get(expected.key) ?? null);
  const documentBefore = structuredClone(snapshot.document);
  const imported = prepareProjectPackageImport(current, snapshot.document, '  恢复后的农场  ');
  writeProjectPackageImport(storage, imported);
  assert.notEqual(imported.project.id, project.id);
  assert.equal(imported.project.initialContent, 'empty');
  assert.equal(imported.project.name, '恢复后的农场');
  assert.deepEqual(imported.project.config, { ...config, projectPath: '', autoSync: false });
  assert.equal(imported.catalog.activeId, imported.project.id);
  assert.equal(imported.entries.length, 9);
  for (const [section, content] of Object.entries(snapshot.document.archives)) {
    assert.deepEqual(JSON.parse(storage.getItem(key(imported.project.id, section))), section === 'project' ? { ...content, name: imported.project.name } : content, section);
  }
  const restored = JSON.parse(storage.getItem(key(imported.project.id, 'enum-versions')));
  assert.equal(restored.revision, 12); assert.ok(restored.activeId); assert.ok(restored.candidateId);
  assert.equal(restored.releases.length, 1); assert.equal(restored.snapshots.length, 3);
  assert.equal(restored.snapshots[0].scan.projectPath, config.projectPath);
  assert.deepEqual(snapshot.document, documentBefore);
  for (const [key, value] of before) assert.equal(storage.values.get(key), value, key);
  assert.equal(storage.getItem(PROJECT_CATALOG_KEY), before.get(PROJECT_CATALOG_KEY), 'catalog remains unpublished');
});

test('drafts with unresolved references and missing values remain portable without inventing replacements', () => {
  const { storage, project } = projectStorage();
  updateArchive(storage, project, 'functional-systems', store => { store.capabilities[0].systemId = 'removed-system'; });
  updateArchive(storage, project, 'gameplay', store => { store.designs[0].links.push({ kind: 'story', targetId: 'deleted-story' }); });
  updateArchive(storage, project, 'enum-versions', store => { store.data.columns.items[2].enumId = 'not-yet-bound'; store.data.datasets.items.push({ id: 'partial-record' }); });
  const snapshot = captureProjectPackage(storage, project);
  assert.equal(snapshot.document.archives['functional-systems'].capabilities[0].systemId, 'removed-system');
  assert.deepEqual(snapshot.document.archives['enum-versions'].data.datasets.items, [{ id: 'partial-record' }]);
});

test('legacy gameplay schemas upgrade using the same model migration as the application', () => {
  const { storage, project } = projectStorage();
  updateArchive(storage, project, 'gameplay', store => {
    store.schema = 1;
    for (const design of store.designs) for (const field of ['dependencies', 'conditionRules', 'stateFlow', 'space', 'timeline']) delete design[field];
  });
  const document = captureProjectPackage(storage, project).document;
  assert.equal(document.archives.gameplay.schema, 3);
  assert.deepEqual(document.archives.gameplay.designs[0].dependencies, []);
  assert.ok(document.archives.gameplay.designs[0].space);
});

test('corrupt optional data-view uses safe view defaults without blocking content export', () => {
  const { storage, project } = projectStorage();
  storage.setItem(key(project.id, 'data-view'), '{ broken');
  const snapshot = captureProjectPackage(storage, project);
  assert.equal(snapshot.document.archives['data-view'].directoryWidth, 220);
  assert.equal(snapshot.expectedEntries.at(-1).value, '{ broken');
});

test('invalid package schemas, nested model shapes and asset paths are rejected before any import writes', async () => {
  const source = await completedProject();
  const valid = captureProjectPackage(source.storage, source.project).document;
  const mutations = [
    value => { value.schema = 2; }, value => { delete value.archives.stories; },
    value => { value.archives['unknown-module'] = {}; },
    value => { value.archives.gameplay.designs[0].checks[0].result = 'bad'; },
    value => { value.archives['functional-systems'].capabilities[0].configRefs = {}; },
    value => { value.archives['art-assets'].assets[0].versions[0].files[0].storagePath = '../outside.png'; },
    value => { value.archives['enum-versions'].snapshots[0].scan.groups[0].members[0].comment = 42; },
    value => { value.archives['enum-versions'].releases[0].patches = [null]; },
    value => { value.archives['enum-versions'].data.datasets.items = { invalid: [] }; },
    value => { value.archives['enum-versions'].data.columns.items[0].key = '__proto__'; },
    value => { value.archives.stories[0].relations.characters = 'bad'; },
    value => { value.archives.project.description = {}; }, value => { value.archives.milestones = [{ title: 'missing details' }]; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(valid); mutate(value);
    assert.throws(() => prepareProjectPackageImport(catalog, value, '导入'), undefined, mutate.toString());
  }
});

test('capture refuses stale catalog metadata instead of creating a package with mismatched source configuration', () => {
  const { storage, project } = projectStorage();
  const changed = structuredClone(project); changed.config.enumPath = 'Updated/Enums';
  assert.throws(() => captureProjectPackage(storage, changed), /项目资料已变化/);
});

test('repeated imports use separate identities; collisions and out-of-scope keys cannot touch existing archives', () => {
  const source = projectStorage(), document = captureProjectPackage(source.storage, source.project).document;
  const first = prepareProjectPackageImport(catalog, document, '副本');
  const second = prepareProjectPackageImport(catalog, document, '副本');
  assert.notEqual(first.project.id, second.project.id);
  const storage = memoryStorage({ [first.entries[3].key]: '{"existing":true}' });
  assert.throws(() => writeProjectPackageImport(storage, first), /已有数据/);
  assert.deepEqual(storage.writes, []);
  const wrong = { ...second, entries: [...second.entries, { key: key(catalog.activeId, 'stories'), value: '[]' }] };
  assert.throws(() => writeProjectPackageImport(storage, wrong), /范围无效/);
  assert.deepEqual(storage.writes, []);
});

test('mid-import write failure never publishes catalog or modifies previous project archives', () => {
  const source = projectStorage(), document = captureProjectPackage(source.storage, source.project).document;
  const before = new Map(source.storage.values), prepared = prepareProjectPackageImport(source.catalog, document, '写入失败');
  let count = 0;
  const failing = { getItem: source.storage.getItem, setItem(key, value) { if (++count === 4) throw new Error('磁盘已满'); source.storage.setItem(key, value); } };
  assert.throws(() => writeProjectPackageImport(failing, prepared), /磁盘已满/);
  for (const [key, value] of before) assert.equal(source.storage.values.get(key), value, key);
  assert.equal(source.storage.getItem(PROJECT_CATALOG_KEY), before.get(PROJECT_CATALOG_KEY));
  assert.ok(!JSON.parse(source.storage.getItem(PROJECT_CATALOG_KEY)).projects.some(project => project.id === prepared.project.id));
});
