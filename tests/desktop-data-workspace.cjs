// Real renderer acceptance in throwaway desktop storage; never reads user archives.
const { _electron } = require(process.env.GAMECREATOR_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createWorkspaceStorage } = require('../desktop/test-workspaces.cjs');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, '.gamecreator', 'qa');

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-data-layout-'));
  const dataDir = path.join(dir, 'data');
  const storage = createWorkspaceStorage(dataDir);
  const projectA = 'project-layout-hollow', projectB = 'project-layout-farm';
  const key = id => 'gamecreator.enum-versions.v1:' + id;
  const archive = id => JSON.parse(storage.getItem(key(id)));
  const fixture = async slug => JSON.parse(await fs.readFile(path.join(root, 'examples', 'prototypes', slug + '.json'), 'utf8'));
  const hollow = await fixture('hollow-knight'), farm = await fixture('stardew-valley');
  const longKey = 'qa_long_chinese';
  const longName = '用于验证长中文名称不会挤成竖排的连续配置表名称与固定记录数量';
  const columns = [{ key: 'id', label: 'ID', type: 'text' }, ...Array.from({ length: 10 }, (_, index) => ({ key: 'field_' + index, label: '测试参数字段 ' + index, type: 'text' }))];
  hollow.definitions.push({ key: longKey, label: longName, badge: '100', columns });
  hollow.data.columns[longKey] = columns;
  hollow.data.datasets[longKey] = Array.from({ length: 100 }, (_, index) => Object.fromEntries(columns.map(column => [column.key, column.key === 'id' ? 'qa_row_' + index : '横向滚动测试值 ' + index])));
  // One invalid value gives the real warning filter a deterministic result.
  hollow.data.datasets.hk_params[0].unit = '';
  const cfg = { engine: 'oasis-lua', projectPath: '', enumPath: 'Script/Const', dataPath: 'Script/Config', outputFormat: 'lua', autoSync: false, backupBeforeSync: true };
  storage.setItem('gamecreator.projects.v1', JSON.stringify({ schema: 2, activeId: projectA, mode: 'project', projects: [
    { id: projectA, name: '布局测试 · 空洞', config: cfg, initialContent: 'empty' },
    { id: projectB, name: '布局测试 · 农场', config: cfg, initialContent: 'empty' },
  ] }));
  for (const [id, value] of [[projectA, hollow], [projectB, farm]]) {
    storage.setItem(key(id), JSON.stringify({ schema: 1, revision: 0, activeId: null, candidateId: null, snapshots: [], reviews: {}, releases: [], data: value.data }));
    storage.setItem('gamecreator.workspace.v1:' + id + ':definitions', JSON.stringify(value.definitions));
  }
  const env = { ...process.env, GAMECREATOR_DATA_DIR: dataDir, GAMECREATOR_USER_DATA_DIR: path.join(dir, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  const errors = [], metrics = [];
  let app, page;
  const field = name => page.getByLabel(name, { exact: true });
  const click = name => page.getByRole('button', { name, exact: true }).click();
  const selectedName = () => page.locator('.data-dataset-link[aria-current="true"], .data-dataset-link.active').first().getAttribute('aria-label');
  const expectTable = async name => {
    await page.waitForFunction(value => Array.from(document.querySelectorAll('.data-dataset-link')).some(button => (button.classList.contains('active') || button.getAttribute('aria-current') === 'true') && button.getAttribute('aria-label')?.startsWith(value + '，')), name);
    assert.ok((await selectedName()).startsWith(name + '，'));
  };
  async function waitUntil(check, message) {
    const end = Date.now() + 10000;
    while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 40)); }
    assert.fail(message);
  }
  async function openDirectory() {
    const trigger = page.locator('.data-directory-trigger');
    if (await trigger.isVisible()) {
      if (await page.locator('.data-directory').isVisible()) return;
      await trigger.click();
    }
  }
  async function selectTable(label) {
    await openDirectory();
    await page.locator('.data-dataset-link').filter({ has: page.locator('.data-dataset-name', { hasText: label }) }).first().click();
    await expectTable(label);
  }
  async function selectProject(name) {
    await page.locator('.ps-trigger').click();
    await page.getByRole('menuitemradio', { name: new RegExp('^' + name) }).click();
    await click('数据配置');
  }
  async function resize(width, height = 1000) {
    await app.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows()[0]; win.setMinimumSize(800, 600); win.setContentSize(size.width, size.height); }, { width, height });
    await page.waitForFunction(width => innerWidth === width, width);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  async function noOuterOverflow(label) {
    const result = await page.evaluate(() => {
      const root = document.querySelector('.data-workspace'), main = document.querySelector('.app > main');
      return { width: innerWidth, pageClient: document.documentElement.clientWidth, pageScroll: document.documentElement.scrollWidth,
        rootClient: root.clientWidth, rootScroll: root.scrollWidth, mainClient: main.clientWidth, mainScroll: main.scrollWidth };
    });
    metrics.push({ label, ...result });
    assert.ok(result.pageScroll <= result.pageClient + 2, label + ' page overflows: ' + JSON.stringify(result));
    assert.ok(result.rootScroll <= result.rootClient + 2, label + ' workspace overflows: ' + JSON.stringify(result));
    assert.ok(result.mainScroll <= result.mainClient + 2, label + ' main overflows: ' + JSON.stringify(result));
  }
  async function holdWrite() {
    await page.evaluate(key => {
      window.__qaWriteLockHeld = false;
      void navigator.locks.request(key, () => new Promise(resolve => { window.__qaWriteLockHeld = true; window.__qaReleaseWrite = resolve; }));
    }, key(projectA));
    await page.waitForFunction(() => window.__qaWriteLockHeld);
  }
  const releaseWrite = () => page.evaluate(() => window.__qaReleaseWrite());
  async function launch() {
    app = await _electron.launch({ executablePath: require('electron'), args: [path.join(root, 'desktop', 'main.cjs')], env });
    page = await app.firstWindow(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await click('登录'); await click('数据配置');
    await resize(1440);
  }
  try {
    await fs.mkdir(artifacts, { recursive: true });
    await launch();
    await expectTable('裂隙 · 核心参数');
    await page.screenshot({ path: path.join(artifacts, 'data-workspace-default.png') });
    assert.equal(await page.getByRole('region', { name: '记录详情', exact: true }).count(), 0);
    assert.equal(await page.locator('.data-dataset-link').count(), 9, 'five empty starter tables are folded');
    await click('展开空表');
    assert.equal(await page.locator('.data-dataset-link').count(), 14);
    await click('收起空表');
    await field('搜索配置表').fill('qa_long');
    assert.equal(await page.locator('.data-dataset-link').count(), 1);
    const longText = page.locator('.data-dataset-name').first();
    const longStyle = await longText.evaluate(el => ({ whiteSpace: getComputedStyle(el).whiteSpace, overflow: getComputedStyle(el).overflow, textOverflow: getComputedStyle(el).textOverflow, title: el.getAttribute('title') }));
    assert.equal(longStyle.whiteSpace, 'nowrap'); assert.equal(longStyle.textOverflow, 'ellipsis');
    await field('搜索配置表').fill('');
    const resizeHandle = page.getByRole('separator', { name: '调整表目录宽度', exact: true });
    await resizeHandle.focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await resizeHandle.getAttribute('aria-valuenow'), '230');
    await click('收起表目录');
    assert.equal(await page.locator('.data-directory').isVisible(), false);
    await click('打开配置表目录');
    assert.equal(await page.locator('.data-directory').isVisible(), true);

    // Changing a table's filter must not leak to another table or leave hidden details open.
    await field('搜索记录').fill('hp_max');
    await field('记录状态筛选').selectOption('warning');
    assert.equal(await page.locator('.data-table tbody tr').count(), 1);
    await click('查看 hp_max 的详情');
    await page.getByRole('region', { name: '记录详情', exact: true }).waitFor();
    await click('关闭记录详情');
    await selectTable('裂隙 · 房间');
    assert.equal(await field('搜索记录').inputValue(), '');
    assert.equal(await field('记录状态筛选').inputValue(), 'all');
    await field('搜索记录').fill('bench');
    await selectTable('裂隙 · 核心参数');
    assert.equal(await field('搜索记录').inputValue(), 'hp_max');
    assert.equal(await field('记录状态筛选').inputValue(), 'warning');
    await click('查看 hp_max 的详情');
    await field('搜索记录').fill('does-not-exist');
    assert.equal(await page.getByRole('region', { name: '记录详情', exact: true }).count(), 0);
    await field('搜索记录').fill(''); await field('记录状态筛选').selectOption('all');

    const initialName = archive(projectA).data.columns.hk_params.find(column => column.key === 'value').label;
    await click('字段');
    let modal = page.getByRole('dialog', { name: '字段定义', exact: true });
    await modal.getByLabel('value 字段名称', { exact: true }).fill('不应保存的字段名');
    await page.keyboard.press('Escape');
    assert.equal(await modal.count(), 0);
    assert.equal(archive(projectA).data.columns.hk_params.find(column => column.key === 'value').label, initialName);
    await click('字段'); modal = page.getByRole('dialog', { name: '字段定义', exact: true });
    await modal.getByLabel('value 字段名称', { exact: true }).fill('测试数值');
    await page.screenshot({ path: path.join(artifacts, 'data-workspace-fields.png') });
    await holdWrite();
    await modal.getByRole('button', { name: '应用定义', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await modal.isVisible(), true, 'pending field save must retain the dialog');
    assert.equal(await modal.getByLabel('value 字段名称', { exact: true }).isDisabled(), true);
    await app.evaluate(({ ipcMain }, key) => {
      globalThis.dataWorkspaceStorageHandler = ipcMain.listeners('workspace-storage')[0];
      ipcMain.removeAllListeners('workspace-storage');
      ipcMain.on('workspace-storage', (event, request) => {
        if (request?.operation === 'set' && request.key === key) { event.returnValue = { ok: false, error: 'QA 模拟数据存档写入失败' }; return; }
        globalThis.dataWorkspaceStorageHandler(event, request);
      });
    }, key(projectA));
    await releaseWrite();
    await modal.getByRole('button', { name: '应用定义', exact: true }).waitFor();
    assert.equal(await modal.getByLabel('value 字段名称', { exact: true }).inputValue(), '测试数值');
    assert.equal(archive(projectA).data.columns.hk_params.find(column => column.key === 'value').label, initialName);
    await app.evaluate(({ ipcMain }) => { ipcMain.removeAllListeners('workspace-storage'); ipcMain.on('workspace-storage', globalThis.dataWorkspaceStorageHandler); });
    await modal.getByRole('button', { name: '应用定义', exact: true }).click();
    await waitUntil(() => archive(projectA).data.columns.hk_params.find(column => column.key === 'value').label === '测试数值', 'field update did not persist');
    await field('hp_max · 测试数值').fill('9');
    await waitUntil(() => archive(projectA).data.datasets.hk_params[0].value === '9', 'cell edit did not persist');

    const beforeDuplicate = storage.getItem(key(projectA));
    await click('新建配置表'); modal = page.getByRole('dialog', { name: '新建配置表', exact: true });
    await modal.getByLabel('表名称', { exact: true }).fill('重复表不得覆盖');
    await modal.getByLabel('表 key', { exact: true }).fill('hk_params');
    await modal.getByRole('button', { name: '创建配置表', exact: true }).click();
    assert.equal(await modal.isVisible(), true);
    assert.equal(storage.getItem(key(projectA)), beforeDuplicate, 'duplicate table must not overwrite existing data');
    await modal.getByLabel('表名称', { exact: true }).fill('QA 新建空表');
    await modal.getByLabel('表 key', { exact: true }).fill('qa_created');
    await holdWrite();
    await modal.getByRole('button', { name: '创建配置表', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await modal.isVisible(), true, 'pending table creation must retain the dialog');
    assert.equal(await modal.getByLabel('表 key', { exact: true }).isDisabled(), true);
    await releaseWrite();
    await expectTable('QA 新建空表');
    await click('新增记录');
    await waitUntil(() => archive(projectA).data.datasets.qa_created?.length === 1, 'new row did not persist');
    const createdId = archive(projectA).data.datasets.qa_created[0].id;
    await page.getByRole('region', { name: '记录详情', exact: true }).waitFor();
    assert.equal(await field('详情 ' + createdId + ' · ID').inputValue(), createdId, 'saved new row retains selection and opens details');
    await click('关闭记录详情');

    await selectTable(longName);
    for (const width of [1440, 1100, 1920]) {
      await resize(width); await noOuterOverflow('table ' + width);
      await click('查看 qa_row_0 的详情');
      const inspector = page.getByRole('region', { name: '记录详情', exact: true });
      const mode = await inspector.evaluate(el => getComputedStyle(el).position);
      metrics.push({ label: 'inspector ' + width, position: mode });
      if (width === 1920) {
        assert.equal(mode, 'static', 'wide workspace should dock inspector');
        const boxes = await page.locator('.data-layout').evaluate(el => ({ table: el.querySelector('.data-grid').getBoundingClientRect().right, inspector: el.querySelector('.data-inspector').getBoundingClientRect().left }));
        assert.ok(boxes.table <= boxes.inspector, 'docked inspector must not overlap the grid');
      }
      else assert.ok(['absolute', 'fixed'].includes(mode), 'narrow workspace should overlay inspector');
      await noOuterOverflow('inspector ' + width);
      await page.screenshot({ path: path.join(artifacts, 'data-workspace-' + width + '.png') });
      await click('关闭记录详情');
    }
    const tableWrap = page.locator('.data-table-wrap');
    const scrollability = await tableWrap.evaluate(el => ({ horizontal: el.scrollWidth > el.clientWidth, vertical: el.scrollHeight > el.clientHeight }));
    assert.ok(scrollability.horizontal, 'wide columns should scroll inside the table');
    assert.ok(scrollability.vertical, 'long table should scroll inside the table');
    await tableWrap.evaluate(el => { el.scrollTop = 0; el.scrollLeft = 0; });
    const fixedBefore = await page.locator('.data-table').evaluate(table => ({ idLeft: table.querySelector('tbody tr .data-id-column').getBoundingClientRect().left, headerTop: table.querySelector('thead th').getBoundingClientRect().top }));
    await tableWrap.evaluate(el => { el.scrollTop = 400; el.scrollLeft = 450; });
    const fixedAfter = await page.locator('.data-table').evaluate(table => ({ idLeft: table.querySelector('tbody tr .data-id-column').getBoundingClientRect().left, headerTop: table.querySelector('thead th').getBoundingClientRect().top }));
    assert.ok(Math.abs(fixedAfter.idLeft - fixedBefore.idLeft) < 2, 'ID column should remain fixed when scrolling horizontally');
    assert.ok(Math.abs(fixedAfter.headerTop - fixedBefore.headerTop) < 2, 'header should remain fixed when scrolling vertically');
    const sticky = await page.locator('.data-table').evaluate(table => {
      const id = table.querySelector('tbody tr td:nth-child(2)'), header = table.querySelector('thead th');
      return { id: getComputedStyle(id).position, header: getComputedStyle(header).position };
    });
    assert.equal(sticky.id, 'sticky'); assert.equal(sticky.header, 'sticky');
    await selectTable('裂隙 · 核心参数');
    await selectTable(longName);
    await waitUntil(async () => (await tableWrap.evaluate(el => el.scrollTop)) >= 390, 'table scroll position did not restore');

    await resize(1100);
    const directoryTrigger = page.locator('.data-directory-trigger');
    assert.equal(await directoryTrigger.isVisible(), true);
    await directoryTrigger.click();
    assert.equal(await page.locator('.data-directory').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.data-directory').isVisible(), false);
    await resize(1440);

    await selectTable('裂隙 · 房间');
    const aSnapshot = storage.getItem(key(projectA));
    await selectProject('布局测试 · 农场');
    await expectTable('农场 · 物品');
    await selectTable('农场 · 作物');
    await selectProject('布局测试 · 空洞');
    await expectTable('裂隙 · 房间');
    assert.equal(await field('搜索记录').inputValue(), 'bench');
    assert.equal(storage.getItem(key(projectA)), aSnapshot, 'view navigation must not change project data');
    await app.close(); app = null;
    await launch();
    await expectTable('裂隙 · 房间');
    assert.equal(await field('搜索记录').inputValue(), 'bench');
    await selectTable('裂隙 · 核心参数');
    assert.equal(await field('hp_max · 测试数值').inputValue(), '9');
    await selectProject('布局测试 · 农场'); await expectTable('农场 · 作物');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(artifacts, 'data-workspace-metrics.json'), JSON.stringify(metrics, null, 2));
    console.log('PASS data workspace: nonempty initial table, searchable directory, folded empty tables, long labels, per-table and per-project state, optional details, modal cancel/apply, duplicate protection, disk edit/restart, responsive 1100/1440/1920 layouts and internal sticky table scrolling');
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(artifacts, 'data-workspace-failure.png') }).catch(() => {});
      console.error((await page.locator('body').innerText().catch(() => '')).slice(-6500));
    }
    throw error;
  } finally {
    if (app) await app.close();
    const target = path.resolve(dir);
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('gc-data-layout-'));
    await fs.rm(target, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
