// Build first. Real Electron interactions with isolated project/profile storage.
const { _electron } = require(process.env.GAMECREATOR_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { createWorkspaceStorage } = require('../desktop/test-workspaces.cjs');
const { createCollaborationServer } = require('../server/collaboration.cjs');
const root = path.resolve(__dirname, '..'), key = 'gamecreator.ui-preferences.v1';
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-navigation-'));
  const storage = createWorkspaceStorage(path.join(directory, 'data'));
  const config = { engine: 'oasis-lua', projectPath: '', enumPath: 'Script/Const', dataPath: 'Script/Config', outputFormat: 'lua', autoSync: false, backupBeforeSync: true };
  const projects = ['导航测试甲', '导航测试乙'].map((name, i) => ({ id: 'project-navigation-' + i, name, config, initialContent: 'empty' }));
  storage.setItem('gamecreator.projects.v1', JSON.stringify({ schema: 2, mode: 'project', activeId: projects[0].id, projects }));
  const coreKey = 'gamecreator.workspace.v1:' + projects[0].id + ':gameplay-core';
  storage.setItem(coreKey, JSON.stringify({ schema: 1, rootId: 'root', graphs: [{ id: 'root', title: '游戏入口', summary: '导航测试', nodes: [
    { id: 'entry', kind: 'entry', title: '主界面', description: '', x: 100, y: 100, childGraphId: '', gameplayIds: [] },
    { id: 'loop', kind: 'activity', title: '游戏循环', description: '', x: 500, y: 150, childGraphId: '', gameplayIds: [] },
  ], edges: [{ id: 'start', fromId: 'entry', toId: 'loop', label: '开始', condition: '' }] }] }));
  const service = await createCollaborationServer({ directory: path.join(directory, 'team'), port: 0 });
  const env = { ...process.env, GAMECREATOR_DATA_DIR: path.join(directory, 'data'), GAMECREATOR_USER_DATA_DIR: path.join(directory, 'profile'), GAMECREATOR_TEAM_DATA_DIR: path.join(directory, 'team'), GAMECREATOR_TEAM_PORT: new URL(service.url).port };
  delete env.ELECTRON_RUN_AS_NODE; delete env.GAMECREATOR_TEAM_ACCOUNT;
  const errors = [], qa = path.join(root, '.gamecreator/qa');
  let app, page;
  const button = name => page.getByRole('button', { name, exact: true });
  const toggle = () => page.locator('.auth-navigation-toggle');
  const sidebar = () => page.locator('#workspace-navigation');
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function launch() {
    app = await _electron.launch({ executablePath: require('electron'), args: [path.join(root, 'desktop/main.cjs')], env });
    page = await app.firstWindow(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => document.querySelector('.auth-submit') || document.querySelector('.auth-navigation-toggle'));
    if (await button('进入本地工作区').isVisible()) await button('进入本地工作区').click();
    await toggle().waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1800, 1050));
  }
  async function check(visible) {
    await settle();
    assert.equal(await sidebar().isVisible(), visible);
    assert.equal(await toggle().getAttribute('aria-expanded'), String(visible));
    assert.equal(await toggle().getAttribute('aria-label'), visible ? '隐藏主导航栏' : '显示主导航栏');
    const box = await toggle().boundingBox();
    assert.ok(box && box.y >= 0 && box.y < 40, 'reopen control must remain in the top toolbar');
  }
  try {
    await fs.mkdir(qa, { recursive: true }); await launch(); await check(true);
    await button('玩法核心').click(); await button('选择节点：主界面').click();
    await page.getByLabel('节点名称', { exact: true }).fill('保留编辑后的入口');
    await button('缩小画布').click();
    await page.evaluate(() => { window.navigationEditor = document.querySelector('.gc-canvas-surface'); });
    const groupButton = name => sidebar().getByRole('button', { name, exact: true });
    assert.deepEqual(await sidebar().locator('.workspace-nav-group-toggle').allTextContents(), ['项目指南','项目管理','玩法与关卡','系统与开发','内容制作','数据与引擎']);
    assert.equal(await sidebar().getByRole('button', {name:'游戏任务与流程',exact:true}).count(),1);
    assert.equal(await sidebar().getByRole('button', {name:'地图设计',exact:true}).count(),0);
    assert.equal(await sidebar().getByRole('button', {name:'故事编排',exact:true}).count(),0);
    await groupButton('项目指南').click(); await groupButton('数据与引擎').click();
    await groupButton('玩法与关卡').click();
    assert.equal(await sidebar().getByRole('button',{name:'玩法核心',exact:true}).isVisible(),false);
    assert.equal(await page.evaluate(() => window.navigationEditor === document.querySelector('.gc-canvas-surface')),true);
    await page.keyboard.press('Control+k');await page.getByLabel('搜索当前项目',{exact:true}).filter({visible:true}).fill('保留编辑后的入口');
    await button('打开搜索结果：保留编辑后的入口').click();
    assert.equal(await groupButton('玩法与关卡').getAttribute('aria-expanded'),'true');
    assert.equal(await groupButton('项目指南').getAttribute('aria-expanded'),'false');
    // Search intentionally reopens the editor; subsequent sidebar actions must preserve this instance.
    await page.evaluate(() => { window.navigationEditor = document.querySelector('.gc-canvas-surface'); });
    const camera = await page.locator('.gc-canvas-surface').evaluate(el => getComputedStyle(el).transform);
    const beforeRaw = storage.getItem(coreKey), before = await page.locator('.gc-canvas-scroll').boundingBox(), nav = await sidebar().boundingBox();
    await page.screenshot({ path: path.join(qa, 'navigation-shown.png') });
    await button('隐藏主导航栏').click(); await check(false);
    const after = await page.locator('.gc-canvas-scroll').boundingBox();
    assert.ok(after.width >= before.width + nav.width - 2, 'canvas must use released sidebar width');
    assert.equal(await page.evaluate(() => window.navigationEditor === document.querySelector('.gc-canvas-surface')), true, 'editor remounted');
    assert.equal(await page.getByLabel('节点名称', { exact: true }).inputValue(), '保留编辑后的入口');
    assert.equal(await page.locator('.gc-canvas-surface').evaluate(el => getComputedStyle(el).transform), camera, 'camera reset');
    assert.equal(storage.getItem(coreKey), beforeRaw, 'navigation changed project data');
    assert.deepEqual(JSON.parse(storage.getItem(key)), { schema: 1, navigationVisible: false, collapsedNavigationGroups:['project-guide','data-engine'] });
    await page.screenshot({ path: path.join(qa, 'navigation-hidden.png') });
    // The same button works with keyboard, and hidden links leave keyboard navigation.
    await toggle().focus(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('#workspace-navigation')), false);
    await toggle().focus(); await page.keyboard.press('Enter'); await check(true);
    await page.evaluate(() => { document.querySelector('main.core-workspace-page').scrollTop = 900; window.scrollTo(0, 1000); });
    await toggle().focus(); await page.keyboard.press('Space'); await check(false);
    await app.close(); app = null; await launch(); await check(false);
    await toggle().click(); await check(true);
    assert.equal(await groupButton('项目指南').getAttribute('aria-expanded'),'false');
    assert.equal(await groupButton('数据与引擎').getAttribute('aria-expanded'),'false');
    await page.locator('.ps-trigger').click();
    await page.getByRole('menuitemradio', { name: /^导航测试乙/ }).click();
    assert.ok((await page.locator('.ps-trigger').innerText()).includes('导航测试乙'));
    assert.equal(await groupButton('项目指南').getAttribute('aria-expanded'),'false');
    await toggle().click(); await check(false);
    await app.close(); app = null; await launch(); await check(false);
    assert.ok((await page.locator('.ps-trigger').innerText()).includes('导航测试乙'));
    // A failed preference write still allows opening and closing the navigation.
    await app.evaluate(({ ipcMain }, key) => {
      globalThis.navigationStorageHandler = ipcMain.listeners('workspace-storage')[0];
      ipcMain.removeAllListeners('workspace-storage');
      ipcMain.on('workspace-storage', (event, request) => {
        if (request?.operation === 'set' && request.key === key) { event.returnValue = { ok: false, error: 'QA preference disk failure' }; return; }
        globalThis.navigationStorageHandler(event, request);
      });
    }, key);
    await toggle().click(); await check(true);
    await page.getByRole('status').filter({ hasText: '导航状态仅在本次会话生效' }).waitFor();
    await groupButton('项目指南').click();
    await page.getByRole('status').filter({hasText:'菜单展开状态暂未保存'}).waitFor();
    assert.equal(await groupButton('项目指南').getAttribute('aria-expanded'),'true');
    await toggle().click(); await check(false);
    await app.evaluate(({ ipcMain }) => { ipcMain.removeAllListeners('workspace-storage'); ipcMain.on('workspace-storage', globalThis.navigationStorageHandler); });
    await toggle().click(); await check(true);
    await groupButton('项目指南').click();
    assert.equal(await page.locator('.workspace-nav-save-error').count(),0);
    assert.equal(await page.locator('.auth-preference-status').count(), 0);
    // Returning through startup must not block this UI-only preference.
    await toggle().click(); await button('返回启动页').click();
    await button('进入本地工作区').click(); await check(false); await toggle().click(); await check(true);
    await page.locator('.ps-trigger').click();
    await page.getByRole('menuitem', { name: '连接团队服务器', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '连接团队服务器', exact: true });
    await dialog.getByLabel('协作服务地址', { exact: true }).fill(service.url);
    await dialog.getByLabel('团队账号', { exact: true }).fill('bob');
    await dialog.getByLabel('团队密码', { exact: true }).fill('bob123');
    await dialog.getByRole('button', { name: '连接并进入项目', exact: true }).click();
    await page.locator('.team-project .story-workspace').waitFor();
    const teamWidth = (await page.locator('.team-project > main').boundingBox()).width;
    await toggle().click(); await check(false);
    assert.ok((await page.locator('.team-project > main').boundingBox()).width > teamWidth + 200);
    await toggle().click(); await check(true);
    // Invalid old preference shapes safely recover to a visible navigation.
    await app.close(); app = null;
    storage.setItem(key, JSON.stringify({ schema: 1, navigationVisible: 'false' }));
    await launch(); await check(true); await toggle().click(); await check(false);
    assert.deepEqual(JSON.parse(storage.getItem(key)), { schema: 1, navigationVisible: false });
    assert.deepEqual(errors, []);
    console.log('PASS: six navigation groups, search auto-expansion, optional modules, persistent group and sidebar preferences, editing/camera preservation, keyboard/scrolling, failed-save recovery, local reentry and team workspace.');
  } catch (error) {
    if (page && !page.isClosed()) {
      console.error((await page.locator('body').innerText()).slice(0, 3500));
      await page.screenshot({ path: path.join(qa, 'navigation-failure.png') }).catch(() => {});
    }
    throw error;
  } finally {
    if (app) await app.close(); await service.close();
    const target = path.resolve(directory);
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('gc-navigation-'));
    await fs.rm(target, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
