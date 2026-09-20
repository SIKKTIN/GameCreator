// Desktop regression for retiring only untouched, empty starter tables.
// All projects, original deliveries and exported folders use throwaway storage.
const { _electron } = require(process.env.GAMECREATOR_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createWorkspaceStorage } = require('../desktop/test-workspaces.cjs');
const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, '.gamecreator', 'qa');
const catalogKey = 'gamecreator.projects.v1';
const moduleKey = (id, section) => 'gamecreator.workspace.v1:' + id + ':' + section;
const enumKey = id => 'gamecreator.enum-versions.v1:' + id;
const digest = value => createHash('sha256').update(value).digest('hex');
const retired = new Set(['items', 'characters', 'skills', 'economy', 'shop']);
const sections = [['gameplay', 'gameplay'], ['functional-systems', 'functionalSystems'], ['art-assets', 'artAssets'], ['stories', 'stories']];

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-no-default-tables-'));
  const dataDir = path.join(dir, 'data'), storage = createWorkspaceStorage(dataDir);
  const oldId = 'project-qa-old-empty-defaults', oldName = 'QA 旧版植物大战僵尸';
  const usedId = 'project-qa-used-default', usedName = 'QA 已使用的 Items';
  const fixtures = [];
  for (const [slug, title, tableCount] of [['plants-vs-zombies', '植物大战僵尸', 4], ['stardew-valley', '星露谷物语', 9], ['hollow-knight', '空洞骑士', 8]]) {
    const value = JSON.parse(await fs.readFile(path.join(root, 'examples', 'prototypes', slug + '.json'), 'utf8'));
    fixtures.push({ slug, title, tableCount, value });
  }
  const pvz = structuredClone(fixtures[0].value);
  pvz.definitions = pvz.definitions.filter(definition => !retired.has(definition.key));
  for (const key of retired) { delete pvz.data.columns[key]; delete pvz.data.datasets[key]; }
  const defaults = (await import('../src/project-defaults.ts')).datasetDefinitions;
  assert.equal(defaults.length, 5, 'historical fixture must contain the five original starter definitions');
  const oldDefinitions = [...structuredClone(defaults), ...pvz.definitions];
  const oldData = { columns: { ...Object.fromEntries(defaults.map(definition => [definition.key, structuredClone(definition.columns)])), ...pvz.data.columns },
    datasets: { ...Object.fromEntries(defaults.map(definition => [definition.key, []])), ...pvz.data.datasets } };
  const config = { engine: 'oasis-lua', projectPath: '', enumPath: 'Script/Const', dataPath: 'Script/Config', outputFormat: 'lua', autoSync: false, backupBeforeSync: true };
  const projects = [{ id: oldId, name: oldName, config, initialContent: 'empty' }, { id: usedId, name: usedName, config, initialContent: 'empty' }];
  storage.setItem(catalogKey, JSON.stringify({ schema: 2, activeId: oldId, mode: 'project', projects }));
  const { emptyStore, makeSnapshot, stageSnapshot, decideChanges, diffEnums, publishRelease } = await import('../src/enum-versions.ts');
  const scan = { projectPath: 'QA preserved source', enumPath: 'Script/Const', files: ['Script/Const/Const_QA.lua'], groups: [{ name: 'Const_QA.State', source: 'Script/Const/Const_QA.lua', line: 1, valueType: 'string', comment: '升级后保留版本记录', members: [{ key: 'IDLE', value: 'idle', line: 2, comment: '空闲' }] }], orderTables: [], dynamic: [], counts: { files: 1, groups: 1, members: 1 } };
  let oldRegistry = stageSnapshot(emptyStore(oldData), await makeSnapshot(scan, 'source'));
  oldRegistry = await publishRelease(decideChanges(oldRegistry, diffEnums(null, scan).map(change => change.id), true, 'QA reviewer'));
  const candidate = structuredClone(scan); candidate.groups[0].members.push({ key: 'READY', value: 'ready', line: 3, comment: '准备' }); candidate.counts.members = 2;
  oldRegistry = stageSnapshot(oldRegistry, await makeSnapshot(candidate, 'source'));
  oldRegistry = decideChanges(oldRegistry, diffEnums(scan, candidate).map(change => change.id), false, 'QA reviewer');
  oldRegistry = JSON.parse(JSON.stringify(oldRegistry));
  const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=', 'base64');
  const fileToken = 'e30c8a63-8d23-4015-8eb1-e5452b1b73d4.png';
  const delivered = { id: 'qa-file', name: 'approved-original.png', size: pngBytes.length, mime: 'image/png', storagePath: fileToken };
  const version = { id: 'qa-version', name: 'QA 已审核原件', notes: '删除空表不能影响交付记录', placeholder: false, review: '已通过', feedback: '保留审核和采用状态', files: [delivered], createdAt: '2026-09-19T00:00:00.000Z' };
  pvz.artAssets.assets[0].versions.push(version); pvz.artAssets.assets[0].adoptedVersionId = version.id;
  pvz.artAssets.requirements[0].owner = 'QA 原项目负责人';
  for (const project of projects) {
    for (const [section, property] of sections) storage.setItem(moduleKey(project.id, section), JSON.stringify(pvz[property]));
    storage.setItem(moduleKey(project.id, 'definitions'), JSON.stringify(oldDefinitions));
    storage.setItem(moduleKey(project.id, 'project'), JSON.stringify({ name: project.name, description: '旧版真实存档', genre: '原型', platform: 'PC', version: 'v0.1', status: '设计中' }));
    storage.setItem(moduleKey(project.id, 'milestones'), JSON.stringify([{ title: '保留里程碑', owner: 'QA', due: '2026-09-19', status: 'active' }]));
    const registry = structuredClone(oldRegistry);
    if (project.id === usedId) registry.data.datasets.items.push({ id: 'qa-real-item', name: '用户实际创建的物品', type: 'weapon', value: '17', rarity: '普通' });
    storage.setItem(enumKey(project.id), JSON.stringify(registry));
    const managed = path.join(dataDir, 'art-files', digest('project:' + project.id));
    await fs.mkdir(managed, { recursive: true }); await fs.writeFile(path.join(managed, fileToken), pngBytes);
  }
  const unchanged = new Map(projects.flatMap(project => [...sections.map(([section]) => moduleKey(project.id, section)), moduleKey(project.id, 'project'), moduleKey(project.id, 'milestones')]).map(key => [key, storage.getItem(key)]));
  const env = { ...process.env, GAMECREATOR_DATA_DIR: dataDir, GAMECREATOR_USER_DATA_DIR: path.join(dir, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
  const errors = [], verified = [], imported = [];
  let app, page, emptyId, customId;
  const catalog = () => JSON.parse(storage.getItem(catalogKey));
  const read = (id, section) => { const raw = storage.getItem(moduleKey(id, section)); return raw === null ? null : JSON.parse(raw); };
  const registry = id => JSON.parse(storage.getItem(enumKey(id)));
  const click = name => page.getByRole('button', { name, exact: true }).click();
  const modal = name => page.getByRole('dialog', { name, exact: true });
  async function waitUntil(check, message) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
    assert.fail(message);
  }
  async function launch() {
    app = await _electron.launch({ executablePath: require('electron'), args: [path.join(root, 'desktop', 'main.cjs')], env });
    page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => document.querySelector('.ps-trigger') || document.querySelector('.auth-submit'));
    if (await page.getByRole('button', { name: '进入本地工作区', exact: true }).isVisible()) await click('进入本地工作区');
    await page.locator('.ps-trigger').waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000));
  }
  async function chooseProject(name) {
    await page.locator('.ps-trigger').click(); await page.getByRole('menuitemradio').filter({ hasText: name }).click();
    await waitUntil(async () => (await page.locator('.ps-trigger').innerText()).includes(name), 'project did not switch: ' + name);
  }
  async function dataPage(expected) {
    await click('数据配置'); await page.locator('.data-workspace').waitFor();
    await waitUntil(async () => (await page.locator('.data-directory-heading').innerText()).replace(/\s+/g, ' ').trim() === '配置表 ' + expected, 'unexpected table count: ' + expected);
  }
  async function assertNoDefaultTables(id, expected) {
    await dataPage(expected);
    assert.equal(await page.locator('.data-empty-toggle').count(), 0, 'retired empty tables must not stay hidden in the directory');
    assert.equal(await page.locator('.data-dataset-link').count(), expected);
    const definitions = read(id, 'definitions') || [];
    assert.equal(definitions.length, expected); assert.ok(definitions.every(definition => !retired.has(definition.key)));
    const state = storage.getItem(enumKey(id));
    if (state) { const data = JSON.parse(state).data; assert.equal(Object.keys(data.datasets).length, expected); assert.ok([...Object.keys(data.datasets), ...Object.keys(data.columns)].every(key => !retired.has(key))); }
  }
  async function nativeSelection(files) { await app.evaluate(({ dialog }, files) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files }); }, files); }
  async function packageAction(name, files) { await nativeSelection(files); await page.locator('.ps-trigger').click(); await page.getByRole('menuitem', { name, exact: true }).click(); }
  async function exportCurrent(label) {
    const destination = path.join(dir, 'exports', label); await fs.mkdir(destination, { recursive: true });
    await packageAction('导出项目到文件夹', [destination]); const dialog = modal('导出项目到文件夹');
    // Await the published path: a staging folder can briefly contain manifest.json too.
    await dialog.locator('.pp-success p').waitFor();
    const folder = (await dialog.locator('.pp-success p').innerText()).trim();
    assert.ok(path.resolve(folder).startsWith(path.resolve(destination) + path.sep));
    assert.equal((await fs.stat(path.join(folder, 'manifest.json'))).isFile(), true);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); return folder;
  }
  async function importFolder(folder, name) {
    const count = catalog().projects.length; await packageAction('从文件夹导入项目', [folder]); const dialog = modal('从文件夹导入项目');
    await dialog.getByLabel('项目名称', { exact: true }).fill(name); await dialog.getByRole('button', { name: '导入并打开', exact: true }).click();
    await waitUntil(() => catalog().projects.length === count + 1, 'folder import failed: ' + name); await dialog.waitFor({ state: 'hidden' }); return catalog().activeId;
  }
  async function verifyOriginalContent() {
    for (const [key, value] of unchanged) assert.equal(storage.getItem(key), value, 'migration modified unrelated archive: ' + key);
    for (const id of [oldId, usedId]) {
      const state = registry(id);
      for (const key of ['activeId', 'candidateId', 'snapshots', 'reviews', 'releases']) assert.deepEqual(state[key], oldRegistry[key], 'enum history changed: ' + key);
      assert.equal(digest(await fs.readFile(path.join(dataDir, 'art-files', digest('project:' + id), fileToken))), digest(pngBytes), 'original art file changed');
    }
  }
  try {
    await fs.mkdir(artifacts, { recursive: true }); await launch();
    await assertNoDefaultTables(oldId, 4);
    assert.equal(Object.values(registry(oldId).data.datasets).reduce((sum, rows) => sum + rows.length, 0), 17);
    await page.screenshot({ path: path.join(artifacts, 'no-default-tables-pvz.png') });
    await verifyOriginalContent(); verified.push('existing PvZ upgrades from nine to four tables while preserving all 17 records, design content, enum history and original art delivery');
    const pvzFolder = await exportCurrent('pvz'); const restoredId = await importFolder(pvzFolder, 'QA 迁移后的 PVZ');
    await assertNoDefaultTables(restoredId, 4);
    assert.deepEqual(registry(restoredId), registry(oldId)); assert.deepEqual(read(restoredId, 'art-assets'), pvz.artAssets);
    assert.equal(digest(await fs.readFile(path.join(dataDir, 'art-files', digest('project:' + restoredId), fileToken))), digest(pngBytes));
    verified.push('export/import accepts four-table prototype and preserves all delivery bytes and enum history');
    await chooseProject(usedName); await dataPage(5);
    assert.equal(registry(usedId).data.datasets.items[0].name, '用户实际创建的物品');
    await page.getByRole('button', { name: 'Items，1 条记录', exact: true }).click();
    await page.getByRole('table', { name: 'Items 配置记录', exact: true }).waitFor();
    assert.equal(await page.getByLabel('qa-real-item · 名称', { exact: true }).inputValue(), '用户实际创建的物品');
    verified.push('used Items table remains visible and editable with original user record');
    await page.locator('.ps-trigger').click(); await page.getByRole('menuitem', { name: '新建项目', exact: true }).click();
    const newDialog = modal('新建项目'); await newDialog.getByLabel('项目名称', { exact: true }).fill('QA 从零创建');
    await newDialog.getByRole('button', { name: '创建并切换', exact: true }).click(); await newDialog.waitFor({ state: 'hidden' }); emptyId = catalog().activeId;
    await assertNoDefaultTables(emptyId, 0); await page.getByRole('heading', { name: '还没有配置表', exact: true }).waitFor();
    await page.screenshot({ path: path.join(artifacts, 'no-default-tables-empty-project.png') });
    const emptyFolder = await exportCurrent('empty'); customId = await importFolder(emptyFolder, 'QA 空项目迁移后建表');
    await assertNoDefaultTables(customId, 0);
    await page.locator('.data-content').getByRole('button', { name: '新建配置表', exact: true }).click();
    const tableDialog = modal('新建配置表'); await tableDialog.getByLabel('表名称', { exact: true }).fill('关卡原型参数'); await tableDialog.getByLabel('表 key', { exact: true }).fill('prototype_levels');
    await tableDialog.getByRole('button', { name: '创建配置表', exact: true }).click(); await tableDialog.waitFor({ state: 'hidden' });
    await dataPage(1); await click('新增记录');
    await waitUntil(() => registry(customId).data.datasets.prototype_levels.length === 1, 'new custom row was not saved');
    const createdRow = registry(customId).data.datasets.prototype_levels[0];
    await page.getByLabel('详情 ' + createdRow.id + ' · ID', { exact: true }).fill('stage_one');
    await waitUntil(() => registry(customId).data.datasets.prototype_levels[0].id === 'stage_one', 'custom row edit was not saved');
    if (await page.getByRole('button', { name: '关闭记录详情', exact: true }).isVisible()) await click('关闭记录详情');
    assert.equal(read(customId, 'definitions').length, 1); assert.deepEqual(Object.keys(registry(customId).data.datasets), ['prototype_levels']);
    verified.push('new project starts with zero tables, empty project exports/imports, and first custom table/row saves without injecting defaults');
    await click('字段');
    const fieldsDialog = modal('字段定义');
    await fieldsDialog.getByLabel('新字段 key', { exact: true }).fill('parent_level');
    await fieldsDialog.getByRole('button', { name: '添加字段', exact: true }).click();
    await fieldsDialog.getByLabel('parent_level 字段类型', { exact: true }).selectOption('reference');
    const referenceSelect = fieldsDialog.getByLabel('parent_level 引用表', { exact: true });
    assert.equal(await referenceSelect.inputValue(), 'prototype_levels');
    assert.equal(await referenceSelect.locator('option:checked').innerText(), '关卡原型参数');
    // Do not touch the target selector: its displayed initial choice must be saved.
    await fieldsDialog.getByRole('button', { name: '应用定义', exact: true }).click();
    await fieldsDialog.waitFor({ state: 'hidden' });
    assert.equal(registry(customId).data.columns.prototype_levels.find(column => column.key === 'parent_level').reference, 'prototype_levels');
    await page.getByLabel('stage_one · parent_level', { exact: true }).selectOption('stage_one');
    await waitUntil(() => registry(customId).data.datasets.prototype_levels[0].parent_level === 'stage_one', 'custom reference record was not saved');
    verified.push('reference fields in a project without Items save the displayed existing table without requiring an extra selection');
    // Seed a damaged historical target only in the inactive throwaway project.
    await chooseProject('QA 从零创建');
    const brokenReference = registry(customId);
    brokenReference.data.columns.prototype_levels.find(column => column.key === 'parent_level').reference = 'missing_table';
    brokenReference.revision += 1;
    storage.setItem(enumKey(customId), JSON.stringify(brokenReference));
    await chooseProject('QA 空项目迁移后建表'); await dataPage(1); await click('字段');
    const repairDialog = modal('字段定义'), repairSelect = repairDialog.getByLabel('parent_level 引用表', { exact: true });
    assert.equal(await repairSelect.inputValue(), 'missing_table');
    assert.equal(await repairSelect.locator('option:checked').innerText(), '引用表已失效：missing_table');
    assert.ok(await repairDialog.getByRole('button', { name: '应用定义', exact: true }).isDisabled());
    assert.match(await repairDialog.innerText(), /引用字段需要选择有效配置表/);
    assert.equal(registry(customId).data.columns.prototype_levels.find(column => column.key === 'parent_level').reference, 'missing_table');
    await repairSelect.selectOption('prototype_levels');
    assert.ok(await repairDialog.getByRole('button', { name: '应用定义', exact: true }).isEnabled());
    await repairDialog.getByRole('button', { name: '应用定义', exact: true }).click(); await repairDialog.waitFor({ state: 'hidden' });
    assert.equal(registry(customId).data.columns.prototype_levels.find(column => column.key === 'parent_level').reference, 'prototype_levels');
    verified.push('missing reference targets remain explicit and block applying fields until the user chooses an existing table');
    for (const fixture of fixtures) {
      const name = 'QA 新模板 ' + fixture.title; await page.locator('.ps-trigger').click(); await page.getByRole('menuitem', { name: '从原型示例创建项目', exact: true }).click();
      const dialog = modal('从原型示例创建项目'); await dialog.getByRole('radio', { name: fixture.title, exact: true }).check(); await dialog.getByLabel('项目名称', { exact: true }).fill(name);
      await dialog.getByRole('button', { name: '创建并打开', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
      const id = catalog().activeId; imported.push({ id, name, count: fixture.tableCount }); await assertNoDefaultTables(id, fixture.tableCount);
      assert.deepEqual(registry(id).data, fixture.value.data);
    }
    verified.push('built-in PvZ, Stardew and Hollow Knight create exactly 4, 9 and 8 actual tables');
    await app.close(); app = null; await launch();
    await chooseProject(oldName); await assertNoDefaultTables(oldId, 4); await verifyOriginalContent();
    await chooseProject('QA 从零创建'); await assertNoDefaultTables(emptyId, 0);
    await chooseProject('QA 空项目迁移后建表'); await dataPage(1);
    assert.equal(registry(customId).data.datasets.prototype_levels[0].id, 'stage_one');
    assert.deepEqual(Object.keys(registry(customId).data.datasets), ['prototype_levels']);
    assert.equal(registry(customId).data.columns.prototype_levels.find(column => column.key === 'parent_level').reference, 'prototype_levels');
    assert.equal(registry(customId).data.datasets.prototype_levels[0].parent_level, 'stage_one');
    assert.equal(await page.getByLabel('stage_one · parent_level', { exact: true }).inputValue(), 'stage_one');
    for (const project of imported) { await chooseProject(project.name); await assertNoDefaultTables(project.id, project.count); }
    verified.push('restart keeps migrated, empty, custom and all three imported projects without recreating starter tables');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(artifacts, 'no-default-tables-results.json'), JSON.stringify({ verified, errors }, null, 2));
    console.log(JSON.stringify({ ok: true, verified, artifacts }, null, 2));
  } catch (error) {
    if (page) { await page.screenshot({ path: path.join(artifacts, 'no-default-tables-failure.png') }).catch(() => {}); console.error((await page.locator('body').innerText().catch(() => '')).slice(-14000)); }
    throw error;
  } finally {
    if (app) await app.close().catch(() => {});
    const resolvedTemporary = path.resolve(dir);
    if (path.dirname(resolvedTemporary) !== path.resolve(os.tmpdir()) || !path.basename(resolvedTemporary).startsWith('gc-no-default-tables-')) throw new Error('Unexpected QA cleanup path');
    await fs.rm(resolvedTemporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
