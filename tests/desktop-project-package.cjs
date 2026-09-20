// Real Electron IPC acceptance using only throwaway project storage and delivery files.
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
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sectionProperties = [['gameplay', 'gameplay'], ['functional-systems', 'functionalSystems'], ['art-assets', 'artAssets'], ['definitions', 'definitions'], ['stories', 'stories']];

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-project-package-'));
  const dataDir = path.join(dir, 'data'), storage = createWorkspaceStorage(dataDir);
  const sourceId = 'project-package-source', sourceName = 'QA 可迁移的完整原型';
  const fixture = JSON.parse(await fs.readFile(path.join(root, 'examples', 'prototypes', 'stardew-valley.json'), 'utf8'));
  fixture.gameplay.designs[0].status = '已验证';
  fixture.gameplay.designs[0].prototype.forEach(item => { item.done = true; });
  fixture.gameplay.designs[0].checks.forEach(check => { check.result = '通过'; check.actual = '迁移前已完成的原型验证'; });
  fixture.functionalSystems.capabilities[0].status = '已完成';
  fixture.artAssets.requirements[0].status = '制作中';
  fixture.artAssets.requirements[0].owner = '迁移前负责人';
  fixture.stories[0].status = '评审中';
  const cfg = { engine: 'oasis-lua', projectPath: path.join(dir, 'external-engine'), enumPath: 'Script/Const', dataPath: 'Script/Config', outputFormat: 'lua', autoSync: false, backupBeforeSync: true };
  const metadata = { name: sourceName, description: '有审核、文件和配置数据的实际项目', genre: '农场原型', platform: 'PC', version: 'v0.8.7', status: '制作中' };
  const milestones = [{ title: '已完成的灰盒', owner: 'QA', due: '2026-09-18', status: 'done' }, { title: '迁移验收', owner: 'QA', due: '2026-09-19', status: 'active' }];
  storage.setItem(catalogKey, JSON.stringify({ schema: 2, activeId: sourceId, mode: 'project', projects: [{ id: sourceId, name: sourceName, config: cfg, initialContent: 'empty' }] }));
  for (const [section, property] of sectionProperties) storage.setItem(moduleKey(sourceId, section), JSON.stringify(fixture[property]));
  storage.setItem(moduleKey(sourceId, 'project'), JSON.stringify(metadata));
  storage.setItem(moduleKey(sourceId, 'milestones'), JSON.stringify(milestones));
  const { emptyStore, makeSnapshot, stageSnapshot, decideChanges, diffEnums, publishRelease } = await import('../src/enum-versions.ts');
  const scan = { projectPath: cfg.projectPath, enumPath: cfg.enumPath, files: ['Script/Const/Const_QA.lua'], groups: [{ name: 'Const_QA.State', source: 'Script/Const/Const_QA.lua', line: 1, valueType: 'string', comment: '保存已发布枚举与待审差异', members: [{ key: 'IDLE', value: 'idle', line: 2, comment: '空闲' }] }], orderTables: [], dynamic: [], counts: { files: 1, groups: 1, members: 1 } };
  let registry = stageSnapshot(emptyStore(fixture.data), await makeSnapshot(scan, 'source'));
  registry = await publishRelease(decideChanges(registry, diffEnums(null, scan).map(change => change.id), true, 'QA reviewer'));
  const candidate = structuredClone(scan);
  candidate.groups[0].members.push({ key: 'WORKING', value: 'working', line: 3, comment: '工作中' }); candidate.counts.members = 2;
  registry = stageSnapshot(registry, await makeSnapshot(candidate, 'source'));
  registry = decideChanges(registry, diffEnums(scan, candidate).map(change => change.id), false, 'QA pending reviewer');
  registry = JSON.parse(JSON.stringify(registry));
  storage.setItem(enumKey(sourceId), JSON.stringify(registry));
  const png = path.join(dir, 'delivery-preview.png'), original = path.join(dir, 'delivery-original.blend');
  await fs.writeFile(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=', 'base64'));
  await fs.writeFile(original, Buffer.from('BLENDER\0isolated source delivery\0not an executable', 'utf8'));
  const exportParent = path.join(dir, 'exported'); await fs.mkdir(exportParent);
  const env = { ...process.env, GAMECREATOR_DATA_DIR: dataDir, GAMECREATOR_USER_DATA_DIR: path.join(dir, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
  const errors = [], imported = [], verified = [];
  let app, page;
  const catalog = () => JSON.parse(storage.getItem(catalogKey));
  const read = (id, section) => JSON.parse(storage.getItem(moduleKey(id, section)));
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
  async function nativeSelection(files) {
    await app.evaluate(({ dialog }, files) => {
      globalThis.packageDialogCalls = 0;
      dialog.showOpenDialog = async () => { globalThis.packageDialogCalls += 1; return { canceled: files === null, filePaths: files || [] }; };
    }, files);
  }
  async function menuAction(name, files) {
    await nativeSelection(files); await page.locator('.ps-trigger').click();
    await page.getByRole('menuitem', { name, exact: true }).click();
    await waitUntil(async () => (await app.evaluate(() => globalThis.packageDialogCalls)) === 1, 'native picker was not called for ' + name);
  }
  async function dismissDialog() {
    const visible = page.getByRole('dialog');
    if (await visible.count()) { await page.keyboard.press('Escape'); await visible.waitFor({ state: 'hidden' }); }
  }
  async function chooseProject(name) {
    await page.locator('.ps-trigger').click(); await page.getByRole('menuitemradio').filter({ hasText: name }).click();
    await waitUntil(async () => (await page.locator('.ps-trigger').innerText()).includes(name), 'project did not switch');
  }
  async function deliver(name, placeholder) {
    await nativeSelection([png, original]); await click('导入新版本');
    const delivery = modal('添加交付版本'); await delivery.getByLabel('交付版本名称', { exact: true }).fill(name);
    await delivery.getByLabel('这是占位版本', { exact: true }).setChecked(placeholder);
    await delivery.getByLabel('交付版本备注', { exact: true }).fill('迁移时需要保留的交付备注');
    await delivery.getByRole('button', { name: '保存交付版本', exact: true }).click();
    await delivery.waitFor({ state: 'hidden' });
  }
  function assetFilePath(id, file) { return path.join(dataDir, 'art-files', digest('project:' + id), file.storagePath); }
  async function assertFiles(id, expectedArt) {
    const actualArt = read(id, 'art-assets'); assert.deepEqual(actualArt, expectedArt, 'all version IDs, reviews, adoption and file metadata must survive');
    for (const asset of expectedArt.assets) for (const version of asset.versions) for (const file of version.files) {
      const actual = await fs.readFile(assetFilePath(id, file)), source = await fs.readFile(assetFilePath(sourceId, file));
      assert.equal(actual.length, file.size); assert.equal(digest(actual), digest(source), 'original file bytes differ: ' + file.name);
    }
  }
  async function verifyContent(id, name, expectedArt) {
    for (const [section, property] of sectionProperties.filter(([section]) => section !== 'art-assets')) assert.deepEqual(read(id, section), fixture[property], section + ' was not restored intact');
    assert.deepEqual(read(id, 'project'), { ...metadata, name }); assert.deepEqual(read(id, 'milestones'), milestones);
    assert.deepEqual(JSON.parse(storage.getItem(enumKey(id))), registry, 'published/candidate enums, decisions and release history differ');
    const project = catalog().projects.find(project => project.id === id);
    assert.equal(project.config.projectPath, '', 'import must require rebinding the external engine directory'); assert.equal(project.config.autoSync, false);
    await assertFiles(id, expectedArt);
  }
  async function verifyUI(expectedArt) {
    await click('玩法设计'); await page.getByRole('region', { name: '玩法设计工作区', exact: true }).waitFor();
    let documentCount = 0;
    for (const category of fixture.gameplay.categories) {
      await click('进入分类：' + category.name);
      documentCount += await page.getByRole('button', { name: /^打开玩法：/ }).count();
      await click('分类总览');
    }
    assert.equal(documentCount, fixture.gameplay.designs.length);
    await click('项目排期'); await page.getByRole('tab', { name: '里程碑', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: /^打开里程碑：/ }).count(), milestones.length);
    await click('功能系统'); await page.getByRole('region', { name: '功能系统工作区', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^打开系统：/ }).count(), fixture.functionalSystems.systems.length);
    await click('数据配置'); await page.locator('.data-dataset-link').first().waitFor();
    assert.equal(await page.locator('.data-dataset-link').count(), fixture.definitions.filter(def => fixture.data.datasets[def.key]?.length).length);
    await click('故事文档'); assert.ok((await page.locator('body').innerText()).includes(fixture.stories[0].title));
    await click('枚举定义'); await page.getByRole('heading', { name: 'Const_QA.State', exact: true }).waitFor();
    await click('枚举管理'); await page.getByRole('tab', { name: /^枚举更新检测/ }).click();
    assert.equal(await page.getByRole('button', { name: '不同意 Const_QA.State.WORKING · 新增成员', exact: true }).getAttribute('aria-pressed'), 'true');
    await click('美术资产'); await page.getByRole('tab', { name: /^资产库/ }).click();
    await click('打开美术资产：' + expectedArt.assets[0].name);
    await click('查看交付版本：v2 已审核正式素材');
    assert.equal(await page.getByLabel('版本审核状态', { exact: true }).inputValue(), '已通过');
    assert.equal(await page.getByLabel('版本审核反馈', { exact: true }).inputValue(), '原件和版本记录都需要随项目保留');
    await click('预览交付文件：delivery-preview.png'); await page.locator('.ar-preview-image').waitFor();
    await page.waitForFunction(() => document.querySelector('.ar-preview-image')?.naturalWidth > 0);
    await page.screenshot({ path: path.join(artifacts, 'project-package-restored-asset.png') });
  }
  async function importProject(directory, name) {
    const count = catalog().projects.length;
    await menuAction('从文件夹导入项目', [directory]);
    const dialog = modal('从文件夹导入项目'); await dialog.getByLabel('项目名称', { exact: true }).fill(name);
    await page.screenshot({ path: path.join(artifacts, 'project-package-import-dialog.png') });
    await dialog.getByRole('button', { name: '导入并打开', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(catalog().projects.length, count + 1, 'complete imported project was not published');
    const current = catalog(), project = current.projects.find(project => project.id === current.activeId);
    assert.match(project.id, /^project-[0-9a-f]{8}-[0-9a-f-]{27}$/); assert.equal(project.name, name); assert.notEqual(project.id, sourceId);
    assert.ok(!imported.some(item => item.id === project.id)); imported.push({ id: project.id, name }); return project.id;
  }
  async function failureAndRetry(directory, target, expectedArt) {
    const before = storage.getItem(catalogKey), count = catalog().projects.length, name = 'QA 写入失败后重试 ' + target;
    await menuAction('从文件夹导入项目', [directory]);
    const dialog = modal('从文件夹导入项目'); await dialog.getByLabel('项目名称', { exact: true }).fill(name);
    await app.evaluate(({ ipcMain }, target) => {
      globalThis.packageStorageHandler = ipcMain.listeners('workspace-storage')[0]; globalThis.packageFailedWrites = 0;
      ipcMain.removeAllListeners('workspace-storage');
      ipcMain.on('workspace-storage', (event, request) => {
        if (request?.operation === 'set' && (target === 'catalog' ? request.key === 'gamecreator.projects.v1' : request.key?.endsWith(':functional-systems'))) {
          globalThis.packageFailedWrites += 1; event.returnValue = { ok: false, error: 'QA 模拟项目迁移写入失败' }; return;
        }
        globalThis.packageStorageHandler(event, request);
      });
    }, target);
    await dialog.getByRole('button', { name: '导入并打开', exact: true }).click(); await dialog.getByRole('alert').waitFor();
    assert.equal(storage.getItem(catalogKey), before, 'failed import must not publish a partial project');
    assert.equal(await dialog.getByLabel('项目名称', { exact: true }).inputValue(), name);
    assert.equal(await app.evaluate(() => globalThis.packageFailedWrites), 1);
    assert.ok((await page.locator('body').innerText()).includes('QA 模拟项目迁移写入失败'));
    await app.evaluate(({ ipcMain }) => { ipcMain.removeAllListeners('workspace-storage'); ipcMain.on('workspace-storage', globalThis.packageStorageHandler); });
    await dialog.getByRole('button', { name: '导入并打开', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' }); assert.equal(catalog().projects.length, count + 1, 'retry did not publish imported project');
    const id = catalog().activeId; assert.ok(!imported.some(item => item.id === id)); imported.push({ id, name });
    await verifyContent(id, name, expectedArt); verified.push(target + ' write failure leaves original catalog and supports retry');
  }
  async function verifyPending(directory, expectedArt) {
    await menuAction('从文件夹导入项目', [directory]);
    const dialog = modal('从文件夹导入项目'), name = 'QA 导入忙碌态'; await dialog.getByLabel('项目名称', { exact: true }).fill(name);
    const count = catalog().projects.length;
    await app.evaluate(({ ipcMain }) => {
      const channel = 'project-package-restore-assets';
      globalThis.packageRestoreHandler = ipcMain._invokeHandlers.get(channel); globalThis.packageRestoreCalls = 0;
      if (typeof globalThis.packageRestoreHandler !== 'function') throw new Error('restore handler not registered');
      const gate = new Promise(resolve => { globalThis.packageRestoreResume = resolve; });
      ipcMain.removeHandler(channel); ipcMain.handle(channel, async (...args) => {
        globalThis.packageRestoreCalls += 1; await gate; return globalThis.packageRestoreHandler(...args);
      });
    });
    try {
      await dialog.getByRole('button', { name: '导入并打开', exact: true }).click();
      await waitUntil(async () => (await app.evaluate(() => globalThis.packageRestoreCalls)) === 1, 'restore never began');
      assert.equal(await dialog.getByRole('button', { name: '关闭项目迁移', exact: true }).isDisabled(), true);
      assert.equal(await dialog.getByLabel('项目名称', { exact: true }).isDisabled(), true);
      assert.equal(await page.locator('.ps-trigger').isDisabled(), true);
      await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), true);
      assert.equal(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true }))), false);
      await dialog.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      assert.equal(await app.evaluate(() => globalThis.packageRestoreCalls), 1, 'duplicate submit must not create another import');
    } finally { await app.evaluate(() => globalThis.packageRestoreResume()); }
    await dialog.waitFor({ state: 'hidden' }); assert.equal(catalog().projects.length, count + 1, 'held import failed after resuming');
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('project-package-restore-assets'); ipcMain.handle('project-package-restore-assets', globalThis.packageRestoreHandler); });
    const id = catalog().activeId; assert.ok(!imported.some(item => item.id === id)); imported.push({ id, name });
    await verifyContent(id, name, expectedArt); verified.push('pending import blocks close, switch, unload and duplicate submit');
  }
  async function rejectFolder(directory, label) {
    const before = storage.getItem(catalogKey);
    await menuAction('从文件夹导入项目', [directory]);
    const dialog = modal('从文件夹导入项目'); await dialog.getByRole('alert').waitFor();
    assert.ok((await dialog.getByRole('alert').innerText()).trim(), 'invalid folder must explain failure');
    assert.equal(storage.getItem(catalogKey), before, label + ' must not alter catalog'); await dismissDialog(); verified.push(label);
  }
  try {
    await fs.mkdir(artifacts, { recursive: true }); await launch();
    await click('美术资产'); await page.getByRole('tab', { name: /^资产库/ }).click(); await click('打开美术资产：' + fixture.artAssets.assets[0].name);
    await deliver('v1 灰盒素材', true); await click('采用此版本');
    await fs.writeFile(original, Buffer.from('BLENDER\0second delivery source bytes\0preserve both historical originals', 'utf8'));
    await deliver('v2 已审核正式素材', false);
    await page.getByLabel('版本审核反馈', { exact: true }).fill('原件和版本记录都需要随项目保留');
    await page.getByLabel('版本审核状态', { exact: true }).selectOption('已通过'); await click('采用此版本');
    await waitUntil(() => read(sourceId, 'art-assets').assets[0].adoptedVersionId === read(sourceId, 'art-assets').assets[0].versions[1].id, 'formal asset adoption not saved');
    const expectedArt = read(sourceId, 'art-assets'); assert.equal(expectedArt.assets[0].versions.length, 2);
    const sourceKeys = [...sectionProperties.map(([section]) => moduleKey(sourceId, section)), moduleKey(sourceId, 'project'), moduleKey(sourceId, 'milestones'), enumKey(sourceId)];
    const sourceArchives = new Map(sourceKeys.map(key => [key, storage.getItem(key)]));
    const originalCatalog = storage.getItem(catalogKey);
    await menuAction('导出项目到文件夹', [exportParent]);
    const exportDialog = modal('导出项目到文件夹');
    // The manifest also exists in the staging directory before the atomic rename.
    // Validate the completed path reported by the application, not the first directory seen.
    await exportDialog.getByText('项目已导出', { exact: true }).waitFor();
    const folder = await exportDialog.locator('.pp-success p').innerText();
    assert.equal(path.dirname(folder), exportParent);
    for (const name of ['manifest.json', 'data', 'assets', 'README.md']) await fs.stat(path.join(folder, name));
    assert.equal(storage.getItem(catalogKey), originalCatalog, 'export must not change project catalog');
    await page.screenshot({ path: path.join(artifacts, 'project-package-export-result.png') }); await dismissDialog();
    verified.push('native export to a manifest/data/assets folder');
    // Relocating the entire directory and removing original delivery selections must suffice.
    const movedFolder = path.join(dir, 'another-computer', '移动后的项目');
    await fs.cp(folder, movedFolder, { recursive: true }); await fs.unlink(png); await fs.unlink(original);
    const firstId = await importProject(movedFolder, 'QA 迁入原型 A'); await verifyContent(firstId, 'QA 迁入原型 A', expectedArt); await verifyUI(expectedArt);
    const secondId = await importProject(movedFolder, 'QA 迁入原型 B'); await verifyContent(secondId, 'QA 迁入原型 B', expectedArt);
    assert.notEqual(firstId, secondId); verified.push('relocated folder import with all modules, enum history and art originals', 'repeat imports use independent IDs');
    // Editing one imported copy must not change either the source or the second copy.
    await chooseProject('QA 迁入原型 A'); await click('美术资产'); await page.getByRole('tab', { name: /^美术需求/ }).click();
    await click('打开美术需求：' + expectedArt.requirements[0].name); await page.getByLabel('需求负责人', { exact: true }).fill('仅修改导入 A');
    await waitUntil(() => read(firstId, 'art-assets').requirements[0].owner === '仅修改导入 A', 'imported edit not persisted');
    await verifyContent(secondId, 'QA 迁入原型 B', expectedArt);
    await app.close(); app = null; await launch(); assert.equal(catalog().activeId, firstId);
    assert.equal(read(firstId, 'art-assets').requirements[0].owner, '仅修改导入 A'); await verifyUI(read(firstId, 'art-assets'));
    verified.push('edit isolation, restart recovery and managed-file preview');
    await failureAndRetry(movedFolder, 'module', expectedArt);
    await failureAndRetry(movedFolder, 'catalog', expectedArt);
    await verifyPending(movedFolder, expectedArt);
    // Native picker cancellation has no persistent effect.
    let before = storage.getItem(catalogKey);
    await menuAction('从文件夹导入项目', null); await dismissDialog(); assert.equal(storage.getItem(catalogKey), before);
    await menuAction('导出项目到文件夹', null); await dismissDialog(); assert.equal(storage.getItem(catalogKey), before); verified.push('native picker cancellations');
    const versionFolder = path.join(dir, 'unsupported-format'); await fs.cp(movedFolder, versionFolder, { recursive: true });
    const manifestPath = path.join(versionFolder, 'manifest.json'), manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    await fs.writeFile(manifestPath, JSON.stringify({ ...manifest, schema: 999, formatVersion: 999 }, null, 2));
    await rejectFolder(versionFolder, 'unsupported manifest version rejection');
    const corruptedFolder = path.join(dir, 'corrupted-file'); await fs.cp(movedFolder, corruptedFolder, { recursive: true });
    async function allFiles(base) { const results = []; for (const entry of await fs.readdir(base, { withFileTypes: true })) { const target = path.join(base, entry.name); results.push(...(entry.isDirectory() ? await allFiles(target) : [target])); } return results; }
    const exportedFiles = await allFiles(path.join(corruptedFolder, 'assets')); assert.equal(exportedFiles.length, 4, 'both versions and both original files must be exported');
    await fs.appendFile(exportedFiles[0], 'QA corrupt bytes'); await rejectFolder(corruptedFolder, 'asset checksum rejection');
    const missingFolder = path.join(dir, 'missing-file'); await fs.cp(movedFolder, missingFolder, { recursive: true });
    const missingFiles = await allFiles(path.join(missingFolder, 'assets')); await fs.unlink(missingFiles[0]); await rejectFolder(missingFolder, 'missing asset rejection');
    for (const [key, raw] of sourceArchives) assert.equal(storage.getItem(key), raw, 'source archive changed: ' + key);
    await verifyContent(secondId, 'QA 迁入原型 B', expectedArt); verified.push('existing archives remain byte-for-byte unchanged');
    await click('返回启动页'); await click('进入本地工作区');
    await page.locator('.ps-trigger').click();
    for (const name of ['从文件夹导入项目', '导出项目到文件夹']) assert.equal(await page.getByRole('menuitem', { name, exact: true }).count(), 1);
    verified.push('project folder actions available after local reentry'); assert.deepEqual(errors, []);
    await fs.writeFile(path.join(artifacts, 'project-package-results.json'), JSON.stringify({ verified, importedProjects: imported.length, deliveryVersions: expectedArt.assets[0].versions.length, deliveryFiles: exportedFiles.length }, null, 2));
    console.log('PASS project folder portability: ' + verified.join('; '));
  } catch (error) {
    if (page && !page.isClosed()) { await page.screenshot({ path: path.join(artifacts, 'project-package-failure.png') }).catch(() => {}); console.error((await page.locator('body').innerText().catch(() => '')).slice(-7000)); }
    throw error;
  } finally {
    if (app) await app.close();
    const target = path.resolve(dir); assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('gc-project-package-'));
    await fs.rm(target, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
