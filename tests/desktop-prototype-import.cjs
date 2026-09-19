// Renderer and disk acceptance in throwaway storage; never reads user archives.
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
const moduleKey = (id, suffix) => 'gamecreator.workspace.v1:' + id + ':' + suffix;
const dataKey = id => 'gamecreator.enum-versions.v1:' + id;
const digest = value => createHash('sha256').update(value).digest('hex');

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-prototype-import-'));
  const dataDir = path.join(dir, 'data'), storage = createWorkspaceStorage(dataDir);
  const oldId = 'project-qa-existing', oldName = 'QA 已有项目 · 保留内容';
  const fixtures = [];
  for (const [slug, title] of [['hollow-knight', '空洞骑士'], ['stardew-valley', '星露谷物语'], ['plants-vs-zombies', '植物大战僵尸'], ['disco-elysium', '极乐迪斯科'], ['vampire-survivors', '吸血鬼幸存者']]) {
    const file = path.join(root, 'examples', 'prototypes', slug + '.json');
    const raw = await fs.readFile(file, 'utf8');
    fixtures.push({ slug, title, file, hash: digest(raw), value: JSON.parse(raw) });
  }
  const cfg = { engine: 'oasis-lua', projectPath: '', enumPath: 'Script/Const', dataPath: 'Script/Config', outputFormat: 'lua', autoSync: false, backupBeforeSync: true };
  storage.setItem(catalogKey, JSON.stringify({ schema: 2, activeId: oldId, mode: 'project', projects: [{ id: oldId, name: oldName, config: cfg, initialContent: 'empty' }] }));
  const existing = structuredClone(fixtures[0].value);
  existing.artAssets.requirements[0].owner = '已有项目负责人';
  const oldArchives = new Map([
    [moduleKey(oldId, 'project'), JSON.stringify({ name: oldName, description: '保留已有设计', genre: '原型', platform: '', version: 'v0.0.1', status: '设计中' })],
    ...[['gameplay', 'gameplay'], ['functional-systems', 'functionalSystems'], ['art-assets', 'artAssets'], ['definitions', 'definitions'], ['stories', 'stories']]
      .map(([suffix, property]) => [moduleKey(oldId, suffix), JSON.stringify(existing[property])]),
    [dataKey(oldId), JSON.stringify({ schema: 1, revision: 0, activeId: null, candidateId: null, snapshots: [], reviews: {}, releases: [], data: existing.data })],
  ]);
  for (const [key, value] of oldArchives) storage.setItem(key, value);
  const env = { ...process.env, GAMECREATOR_DATA_DIR: dataDir, GAMECREATOR_USER_DATA_DIR: path.join(dir, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  const errors = [], results = [], imported = [];
  let app, page;
  const catalog = () => JSON.parse(storage.getItem(catalogKey));
  const read = (id, suffix) => JSON.parse(storage.getItem(moduleKey(id, suffix)));
  const click = name => page.getByRole('button', { name, exact: true }).click();
  const modal = () => page.getByRole('dialog', { name: '从原型示例创建项目', exact: true });
  async function waitUntil(check, message) {
    const end = Date.now() + 15000;
    while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
    assert.fail(message);
  }
  async function launch() {
    app = await _electron.launch({ executablePath: require('electron'), args: [path.join(root, 'desktop', 'main.cjs')], env });
    page = await app.firstWindow(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => document.querySelector('.ps-trigger') || document.querySelector('.auth-submit'));
    if (await page.getByRole('button', { name: '登录', exact: true }).isVisible()) await click('登录');
    await page.locator('.ps-trigger').waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000));
  }
  async function chooseProject(name) {
    await page.locator('.ps-trigger').click();
    await page.getByRole('menuitemradio').filter({ hasText: name }).click();
    await waitUntil(async () => (await page.locator('.ps-trigger').innerText()).includes(name), 'project switch failed: ' + name);
  }
  async function openImport(fixture, name) {
    await page.locator('.ps-trigger').click();
    await page.getByRole('menuitem', { name: '从原型示例创建项目', exact: true }).click();
    await modal().waitFor();
    assert.equal(await modal().getByRole('radio').count(), fixtures.length);
    await modal().getByRole('radio', { name: fixture.title, exact: true }).check();
    await modal().getByLabel('项目名称', { exact: true }).fill(name);
  }
  async function finishImport(count, name) {
    await modal().getByRole('button', { name: '创建并打开', exact: true }).click();
    await waitUntil(() => catalog().projects.length === count + 1, 'import did not publish the completed project');
    await modal().waitFor({ state: 'hidden' });
    const next = catalog(), project = next.projects.find(item => item.id === next.activeId);
    assert.equal(project.name, name); assert.match(project.id, /^project-[0-9a-f]{8}-[0-9a-f-]{27}$/);
    assert.equal(project.initialContent, 'empty'); assert.equal(project.config.projectPath, '');
    await waitUntil(async () => (await page.locator('.ps-trigger').innerText()).includes(name), 'created project did not open');
    return project.id;
  }
  function assertImported(id, fixture) {
    for (const [suffix, property] of [['gameplay', 'gameplay'], ['functional-systems', 'functionalSystems'], ['art-assets', 'artAssets'], ['definitions', 'definitions'], ['stories', 'stories']]) {
      assert.deepEqual(read(id, suffix), fixture.value[property], fixture.slug + ': imported ' + property + ' differs');
    }
    const registry = JSON.parse(storage.getItem(dataKey(id)));
    assert.deepEqual(registry.data, fixture.value.data); assert.deepEqual(registry.snapshots, []); assert.equal(registry.activeId, null);
    assert.ok(read(id, 'art-assets').assets.every(asset => asset.versions.length === 0 && !asset.adoptedVersionId));
  }
  async function verifyModules(id, fixture) {
    const value = fixture.value;
    await click('玩法设计'); await page.getByRole('region', { name: '玩法设计工作区', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^打开玩法：/ }).count(), value.gameplay.designs.length);
    await page.getByRole('button', { name: '打开玩法：' + value.gameplay.designs[0].title, exact: true }).click();
    await page.getByRole('tab', { name: /^空间布局/ }).click(); await page.getByRole('tab', { name: /^时间轴/ }).click();
    await click('功能系统'); await page.getByRole('region', { name: '功能系统工作区', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^打开系统：/ }).count(), value.functionalSystems.systems.length);
    await click('美术资产'); await page.getByRole('region', { name: '美术资产工作区', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^打开美术需求：/ }).count(), value.artAssets.requirements.length);
    await page.getByRole('tab', { name: /^资产库/ }).click();
    assert.equal(await page.getByRole('button', { name: /^打开美术资产：/ }).count(), value.artAssets.assets.length);
    await click('数据配置'); await page.locator('.data-dataset-link').first().waitFor();
    assert.equal(await page.locator('.data-dataset-link').count(), value.definitions.filter(def => value.data.datasets[def.key]?.length).length);
    await click('故事文档'); assert.ok((await page.locator('body').innerText()).includes(value.stories[0].title));
    assertImported(id, fixture);
    results.push({ slug: fixture.slug, designs: value.gameplay.designs.length, systems: value.functionalSystems.systems.length,
      capabilities: value.functionalSystems.capabilities.length, requirements: value.artAssets.requirements.length, assets: value.artAssets.assets.length,
      records: Object.values(value.data.datasets).reduce((sum, rows) => sum + rows.length, 0), stories: value.stories.length });
  }
  async function failureAndRetry(fixture, target, name) {
    await chooseProject(oldName);
    const before = storage.getItem(catalogKey);
    await openImport(fixture, name);
    await app.evaluate(({ ipcMain }, target) => {
      globalThis.prototypeStorageHandler = ipcMain.listeners('workspace-storage')[0]; globalThis.prototypeFailedWrites = 0;
      ipcMain.removeAllListeners('workspace-storage');
      ipcMain.on('workspace-storage', (event, request) => {
        if (request?.operation === 'set' && (target === 'catalog' ? request.key === 'gamecreator.projects.v1' : request.key?.endsWith(':functional-systems'))) {
          globalThis.prototypeFailedWrites += 1; event.returnValue = { ok: false, error: 'QA 模拟原型写入失败' }; return;
        }
        globalThis.prototypeStorageHandler(event, request);
      });
    }, target);
    await modal().getByRole('button', { name: '创建并打开', exact: true }).click();
    await modal().getByRole('alert').waitFor();
    assert.ok((await modal().getByRole('alert').innerText()).trim());
    if (target === 'module') assert.ok((await modal().getByRole('alert').innerText()).includes('QA 模拟原型写入失败'));
    assert.ok((await page.locator('body').innerText()).includes('QA 模拟原型写入失败'));
    assert.equal(storage.getItem(catalogKey), before, 'partial project must not appear in the catalog');
    assert.ok((await page.locator('.ps-trigger').innerText()).includes(oldName));
    assert.equal(await modal().getByLabel('项目名称', { exact: true }).inputValue(), name);
    assert.equal(await modal().getByRole('radio', { name: fixture.title, exact: true }).isChecked(), true);
    assert.equal(await app.evaluate(() => globalThis.prototypeFailedWrites), 1);
    await app.evaluate(({ ipcMain }) => { ipcMain.removeAllListeners('workspace-storage'); ipcMain.on('workspace-storage', globalThis.prototypeStorageHandler); });
    const id = await finishImport(catalog().projects.length, name); assertImported(id, fixture);
  }
  try {
    await fs.mkdir(artifacts, { recursive: true }); await launch();
    assert.equal(catalog().projects.length, 1, 'starting app must not auto-import examples');
    for (const fixture of fixtures) {
      const name = 'QA 导入 · ' + fixture.title; await openImport(fixture, name);
      if (fixture.slug === 'hollow-knight') {
        await page.screenshot({ path: path.join(artifacts, 'prototype-import-dialog.png') });
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 1000));
        await page.waitForFunction(() => innerWidth === 1100);
        const bounds = await modal().evaluate(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right,
          width: innerWidth, scroll: el.scrollWidth, client: el.clientWidth }));
        assert.ok(bounds.left >= 0 && bounds.right <= bounds.width && bounds.scroll <= bounds.client + 2, 'import dialog overflows at 1100 pixels');
        await modal().getByRole('button', { name: '创建并打开', exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(artifacts, 'prototype-import-dialog-1100.png') });
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 1000));
        await page.waitForFunction(() => innerWidth === 1440);
      }
      const id = await finishImport(catalog().projects.length, name); assertImported(id, fixture);
      imported.push({ id, name, fixture }); await verifyModules(id, fixture);
    }
    await openImport(fixtures[0], 'QA 空洞 · 第二份');
    const duplicateId = await finishImport(catalog().projects.length, 'QA 空洞 · 第二份');
    assert.ok(!imported.some(item => item.id === duplicateId)); assertImported(duplicateId, fixtures[0]);
    await chooseProject(imported[0].name); await click('美术资产');
    await page.getByRole('button', { name: '打开美术需求：' + fixtures[0].value.artAssets.requirements[0].name, exact: true }).click();
    await page.getByLabel('需求负责人', { exact: true }).fill('QA 重启后仍保留');
    await waitUntil(() => read(imported[0].id, 'art-assets').requirements[0].owner === 'QA 重启后仍保留', 'edit was not persisted');
    assertImported(duplicateId, fixtures[0]); for (const item of imported.slice(1)) assertImported(item.id, item.fixture);
    await app.close(); app = null; await launch(); assert.equal(catalog().activeId, imported[0].id);
    await click('美术资产'); await page.getByRole('button', { name: '打开美术需求：' + fixtures[0].value.artAssets.requirements[0].name, exact: true }).click();
    assert.equal(await page.getByLabel('需求负责人', { exact: true }).inputValue(), 'QA 重启后仍保留');
    await failureAndRetry(fixtures[1], 'module', 'QA 中途失败后重试');
    await failureAndRetry(fixtures[2], 'catalog', 'QA 发布失败后重试');
    for (const [key, raw] of oldArchives) assert.equal(storage.getItem(key), raw, 'existing archive changed: ' + key);
    for (const fixture of fixtures) assert.equal(digest(await fs.readFile(fixture.file, 'utf8')), fixture.hash, 'example changed');
    await click('退出登录'); await page.getByLabel('账号', { exact: true }).fill('user'); await page.getByLabel('密码', { exact: true }).fill('user123');
    await click('登录'); await page.locator('.ps-trigger').click();
    assert.equal(await page.getByRole('menuitem', { name: '从原型示例创建项目', exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(artifacts, 'prototype-import-results.json'), JSON.stringify({ examples: results, importedProjects: catalog().projects.length - 1,
      verified: ['five complete imports', 'module rendering', 'repeat import isolation', 'edit/restart persistence', 'module-write failure/retry', 'catalog-write failure/retry', 'existing archives unchanged', 'repository examples unchanged', 'admin-only entry'] }, null, 2));
    console.log('PASS prototype import: five examples, module rendering, independent repeat copies, edit/restart, module and catalog write failures/retry, unchanged existing projects and examples, admin-only entry');
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(artifacts, 'prototype-import-failure.png') }).catch(() => {});
      console.error((await page.locator('body').innerText().catch(() => '')).slice(-5500));
    }
    throw error;
  } finally {
    if (app) await app.close();
    const target = path.resolve(dir);
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('gc-prototype-import-'));
    await fs.rm(target, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
