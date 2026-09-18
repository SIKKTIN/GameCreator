import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  PROJECT_CATALOG_KEY, addSavedProject, defaultCatalog, readProjectCatalog,
  selectSavedProject, updateSavedConfig, validateCatalog,
} from '../src/project-catalog.ts';

const require = createRequire(import.meta.url);
const { createWorkspaceStorage } = require('../desktop/test-workspaces.cjs');
const { validateProjectLocation } = require('../desktop/project-locations.cjs');
const config = {
  engine: 'oasis-lua', projectPath: 'E:/Projects/Original', enumPath: 'Script/Const',
  dataPath: 'Script/Config', outputFormat: 'lua', autoSync: false, backupBeforeSync: true,
};
const originalId = 'e:/projects/original';
const secondConfig = { ...config, projectPath: 'E:/Projects/Second', enumPath: 'Enums', dataPath: 'Data' };
const legacySecondId = 'e:/projects/second';
const workspaceKey = (id, section) => 'gamecreator.workspace.v1:' + id + ':' + section;
const enumKey = id => 'gamecreator.enum-versions.v1:' + id;
function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  const writes = [];
  return {
    values, writes,
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { writes.push(key); values.set(key, value); },
  };
}
async function temporaryDirectory(t) {
  const prefix = path.join(os.tmpdir(), 'gamecreator-project-catalog-');
  const directory = await fs.mkdtemp(prefix);
  t.after(async () => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('gamecreator-project-catalog-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return directory;
}

test('legacy project migration preserves existing content and scopes global table labels only to the original project', () => {
  const definitions = JSON.stringify([{ key: 'quests', label: '任务配置', badge: '', columns: [{ key: 'id', label: 'ID' }] }]);
  const existing = {
    'gamecreator.engine-config.v1': JSON.stringify({ ...config, projectPath: ' E:\\Projects\\Original\\ ' }),
    'gamecreator.dataset-definitions.v1': definitions,
    [enumKey(originalId)]: '{"revision":7,"existing":"enum and approval history"}',
    [workspaceKey(originalId, 'project')]: '{"name":"我的原项目","description":"保留介绍"}',
    [workspaceKey(originalId, 'stories')]: '[{"id":"story_1","content":"已有故事"}]',
    [workspaceKey(originalId, 'milestones')]: '[{"title":"已有里程碑","status":"done"}]',
  };
  const storage = memoryStorage(existing);
  const catalog = readProjectCatalog(storage, config, 'Fallback');
  assert.equal(catalog.schema, 2);
  assert.equal(catalog.activeId, originalId);
  assert.equal(catalog.projects[0].name, '我的原项目');
  assert.equal(catalog.projects[0].initialContent, 'legacy');
  assert.equal(storage.getItem(workspaceKey(originalId, 'definitions')), definitions);
  for (const [key, value] of Object.entries(existing)) assert.equal(storage.getItem(key), value, key);
  assert.deepEqual(storage.writes, [workspaceKey(originalId, 'definitions'), PROJECT_CATALOG_KEY]);
  const added = addSavedProject(catalog, '新项目');
  storage.setItem(PROJECT_CATALOG_KEY, JSON.stringify(added));
  const reopened = readProjectCatalog(storage, config, 'Ignored');
  assert.equal(reopened.activeId, added.activeId);
  assert.notEqual(reopened.activeId, originalId);
  assert.equal(reopened.projects[1].initialContent, 'empty');
  assert.equal(storage.getItem(workspaceKey(added.activeId, 'definitions')), null);
  assert.equal(storage.getItem(enumKey(added.activeId)), null);
});

test('migration preserves an existing project-scoped table catalog instead of replacing it with legacy global labels', () => {
  const scoped = '[{"key":"items","label":"独立表名"}]';
  const storage = memoryStorage({
    'gamecreator.dataset-definitions.v1': '[{"key":"items","label":"旧全局表名"}]',
    [workspaceKey(originalId, 'definitions')]: scoped,
  });
  readProjectCatalog(storage, config, 'Original');
  assert.equal(storage.getItem(workspaceKey(originalId, 'definitions')), scoped);
  assert.deepEqual(storage.writes, [PROJECT_CATALOG_KEY]);
});

test('same-name unbound projects have independent permanent IDs and survive disk restart without mixing archives', async t => {
  const directory = await temporaryDirectory(t);
  let storage = createWorkspaceStorage(directory);
  const original = defaultCatalog(config, 'Original');
  const first = addSavedProject(original, '  新原型  ');
  const firstId = first.activeId;
  const second = addSavedProject(first, '新原型');
  const secondId = second.activeId;
  assert.notEqual(firstId, secondId);
  for (const project of second.projects.slice(1)) {
    assert.match(project.id, /^project-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(project.name, '新原型');
    assert.equal(project.config.projectPath, '');
    assert.equal(project.config.enumPath, 'Script/Const');
    assert.equal(project.initialContent, 'empty');
  }
  assert.equal(original.projects.length, 1);
  storage.setItem(PROJECT_CATALOG_KEY, JSON.stringify(second));
  const originals = {
    [workspaceKey(firstId, 'project')]: '{"name":"新原型","description":"first"}',
    [workspaceKey(secondId, 'project')]: '{"name":"新原型","description":"second"}',
    [workspaceKey(firstId, 'stories')]: '[{"id":"story","content":"first story"}]',
    [workspaceKey(secondId, 'stories')]: '[{"id":"story","content":"second story"}]',
    [workspaceKey(firstId, 'definitions')]: '[{"key":"items","label":"第一项目道具"}]',
    [workspaceKey(secondId, 'definitions')]: '[{"key":"items","label":"第二项目道具"}]',
    [enumKey(firstId)]: '{"revision":9,"activeId":"first-release"}',
    [enumKey(secondId)]: '{"revision":2,"activeId":"second-release"}',
  };
  for (const [key, value] of Object.entries(originals)) storage.setItem(key, value);
  storage = createWorkspaceStorage(directory);
  const reopened = readProjectCatalog(storage, { ...config, projectPath: 'E:/IgnoredDefaults' }, 'Ignored');
  assert.equal(reopened.activeId, secondId);
  assert.deepEqual(reopened, second);
  const returned = selectSavedProject({ ...reopened, mode: 'test' }, firstId);
  assert.equal(returned.mode, 'project');
  storage.setItem(PROJECT_CATALOG_KEY, JSON.stringify(returned));
  const restarted = readProjectCatalog(createWorkspaceStorage(directory), config, 'Ignored');
  assert.equal(restarted.activeId, firstId);
  for (const [key, value] of Object.entries(originals)) assert.equal(storage.getItem(key), value, key);
  assert.throws(() => storage.getItem('gamecreator.enum-versions.v1:'), /不支持的存档键/);
});

test('binding, replacing, sharing, and clearing source directories never changes project IDs or archives', () => {
  const storage = memoryStorage();
  const initial = addSavedProject(defaultCatalog(config, 'Original'), 'Prototype');
  const projectId = initial.activeId;
  const content = {
    [enumKey(projectId)]: '{"revision":11,"activeId":"my-release"}',
    [workspaceKey(projectId, 'project')]: '{"name":"Prototype","description":"keep"}',
    [workspaceKey(projectId, 'stories')]: '[{"id":"first","content":"keep"}]',
    [workspaceKey(projectId, 'milestones')]: '[{"title":"keep"}]',
    [workspaceKey(projectId, 'definitions')]: '[{"key":"custom","label":"keep"}]',
  };
  for (const [key, value] of Object.entries(content)) storage.setItem(key, value);
  let catalog = initial;
  for (const projectPath of [config.projectPath, secondConfig.projectPath, '']) {
    const before = JSON.stringify(catalog);
    const changed = updateSavedConfig(catalog, projectId, { ...catalog.projects[1].config, projectPath });
    assert.equal(JSON.stringify(catalog), before);
    assert.equal(changed.projects[1].id, projectId);
    assert.equal(changed.activeId, projectId);
    assert.equal(changed.projects[0].id, originalId);
    assert.deepEqual(changed.projects[0].config, config);
    storage.setItem(PROJECT_CATALOG_KEY, JSON.stringify(changed));
    catalog = readProjectCatalog(storage, config, 'Ignored');
    assert.equal(catalog.projects[1].config.projectPath, projectPath);
    for (const [key, value] of Object.entries(content)) assert.equal(storage.getItem(key), value, key);
  }
  // Legacy path IDs are equally permanent after schema 2 migration.
  const detachedLegacy = updateSavedConfig(catalog, originalId, { ...config, projectPath: '' });
  assert.equal(detachedLegacy.projects[0].id, originalId);
  assert.equal(detachedLegacy.projects[0].config.projectPath, '');
  assert.equal(initial.projects[1].config.projectPath, '');
  assert.throws(() => addSavedProject(catalog, '   '), /项目名称/);
  assert.throws(() => selectSavedProject(catalog, 'missing'), /不存在/);
  assert.throws(() => updateSavedConfig(catalog, 'missing', config), /不存在/);
});

test('schema 1 catalogs upgrade only the schema and preserve legacy identities, selection, test mode and all stored content', () => {
  const legacy = { ...defaultCatalog(config, 'Original'), schema: 1, mode: 'test', activeId: legacySecondId,
    projects: [
      { id: originalId, name: 'Original', config, initialContent: 'legacy' },
      { id: legacySecondId, name: 'Second', config: secondConfig, initialContent: 'empty' },
    ] };
  const archives = {
    [enumKey(originalId)]: '{"revision":8,"data":"original"}',
    [enumKey(legacySecondId)]: '{"revision":3,"data":"second"}',
    [workspaceKey(originalId, 'project')]: '{"name":"Original","description":"old original"}',
    [workspaceKey(legacySecondId, 'stories')]: '[{"id":"story","content":"old second"}]',
    [workspaceKey(legacySecondId, 'definitions')]: '[{"key":"items","label":"second label"}]',
    'gamecreator.test-session.v1': '{"id":"existing-session"}',
  };
  const storage = memoryStorage({ ...archives, [PROJECT_CATALOG_KEY]: JSON.stringify(legacy) });
  const upgraded = readProjectCatalog(storage, config, 'Ignored');
  assert.deepEqual(upgraded, { ...legacy, schema: 2 });
  assert.deepEqual(storage.writes, [PROJECT_CATALOG_KEY]);
  for (const [key, value] of Object.entries(archives)) assert.equal(storage.getItem(key), value, key);
  assert.deepEqual(readProjectCatalog(storage, config, 'Ignored'), upgraded);
  assert.deepEqual(storage.writes, [PROJECT_CATALOG_KEY]);
});

test('schema 1 identity mismatches and empty paths fail closed before the relaxed schema 2 contract is applied', () => {
  const legacy = { ...defaultCatalog(config, 'Original'), schema: 1 };
  const invalid = [
    { ...legacy, projects: [{ ...legacy.projects[0], id: 'e:/wrong-project' }], activeId: 'e:/wrong-project' },
    { ...legacy, projects: [{ ...legacy.projects[0], config: { ...config, projectPath: '' } }] },
    { ...legacy, projects: [...legacy.projects, legacy.projects[0]] },
  ];
  for (const value of invalid) {
    const raw = JSON.stringify(value);
    const storage = memoryStorage({ [PROJECT_CATALOG_KEY]: raw });
    assert.throws(() => readProjectCatalog(storage, config, 'Ignored'));
    assert.equal(storage.getItem(PROJECT_CATALOG_KEY), raw);
    assert.deepEqual(storage.writes, []);
  }
  // Older settings accepted relative paths, so those existing archive IDs remain readable.
  const relative = { ...legacy, activeId: 'old-project', projects: [{ ...legacy.projects[0], id: 'old-project', config: { ...config, projectPath: 'Old-Project/' } }] };
  assert.equal(readProjectCatalog(memoryStorage({ [PROJECT_CATALOG_KEY]: JSON.stringify(relative) }), config, 'Ignored').activeId, 'old-project');
});

test('invalid existing project catalogs fail closed without falling back or changing stored content', () => {
  const valid = defaultCatalog(config, 'Original');
  const invalidCatalogs = [
    '{invalid json',
    JSON.stringify({ ...valid, schema: 3 }),
    JSON.stringify({ ...valid, projects: [] }),
    JSON.stringify({ ...valid, activeId: legacySecondId }),
    JSON.stringify({ ...valid, projects: [...valid.projects, valid.projects[0]] }),
    JSON.stringify({ ...valid, projects: [{ ...valid.projects[0], id: '' }], activeId: '' }),
    JSON.stringify({ ...valid, projects: [{ ...valid.projects[0], id: 'E:/UPPERCASE' }], activeId: 'E:/UPPERCASE' }),
    JSON.stringify({ ...valid, projects: [{ ...valid.projects[0], config: { ...config, backupBeforeSync: 'yes' } }] }),
    JSON.stringify({ ...valid, projects: [{ ...valid.projects[0], config: { ...config, projectPath: null } }] }),
  ];
  for (const raw of invalidCatalogs) {
    const storage = memoryStorage({ [PROJECT_CATALOG_KEY]: raw, 'gamecreator.engine-config.v1': JSON.stringify(config) });
    assert.throws(() => readProjectCatalog(storage, config, 'Fallback'));
    assert.equal(storage.getItem(PROJECT_CATALOG_KEY), raw);
    assert.deepEqual(storage.writes, []);
  }
  assert.throws(() => validateCatalog(null), /格式异常/);
});

test('corrupt legacy test-session JSON does not block migration or revive test mode', () => {
  const storage = memoryStorage({ 'gamecreator.test-session.v1': '{invalid json' });
  const result = readProjectCatalog(storage, config, 'Original');
  assert.equal(result.mode, 'project');
  assert.equal(result.activeId, originalId);
  assert.equal(storage.getItem('gamecreator.test-session.v1'), '{invalid json');
  assert.deepEqual(readProjectCatalog(storage, config, 'Ignored'), result);
});

test('an existing legacy test session resumes test mode while retaining the formal project to return to', () => {
  const storage = memoryStorage({ 'gamecreator.test-session.v1': '{"id":"saved-test-session"}' });
  const result = readProjectCatalog(storage, config, 'Original');
  assert.equal(result.mode, 'test');
  assert.equal(result.activeId, originalId);
  const returned = selectSavedProject(result, originalId);
  assert.equal(returned.mode, 'project');
  assert.equal(storage.getItem('gamecreator.test-session.v1'), '{"id":"saved-test-session"}');
});

test('directory validation accepts real project folders and rejects missing, file, relative, and escaping locations', async t => {
  const directory = await temporaryDirectory(t);
  const project = path.join(directory, 'project');
  const file = path.join(directory, 'not-a-directory.lua');
  await fs.mkdir(project);
  await fs.writeFile(file, '-- fixture');
  const actual = await fs.realpath(project);
  assert.deepEqual(await validateProjectLocation(' ' + project + ' ', 'Script/Temp/../Const'), { projectPath: actual, enumPath: 'Script/Const' });
  assert.deepEqual(await validateProjectLocation(project, '.'), { projectPath: actual, enumPath: '.' });
  await assert.rejects(validateProjectLocation(path.join(directory, 'missing')), /不存在或无法访问/);
  await assert.rejects(validateProjectLocation(file), /必须是文件夹/);
  await assert.rejects(validateProjectLocation('relative/project'), /完整的工程目录/);
  await assert.rejects(validateProjectLocation(''), /完整的工程目录/);
  await assert.rejects(validateProjectLocation(project, '../outside'), /工程目录内/);
  await assert.rejects(validateProjectLocation(project, 'Script/../../outside'), /工程目录内/);
  await assert.rejects(validateProjectLocation(project, directory), /相对路径/);
  await assert.rejects(validateProjectLocation(project, 'C:outside'), /相对路径/);
  await assert.rejects(validateProjectLocation(project, ''), /相对路径/);
});
