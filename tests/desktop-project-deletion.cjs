// Build first. All deletion scenarios run in a throwaway Electron profile.
const { _electron } = require(process.env.GAMECREATOR_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { createWorkspaceStorage } = require('../desktop/test-workspaces.cjs');
const root = path.resolve(__dirname, '..'), catalogKey = 'gamecreator.projects.v1';
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-project-deletion-'));
  const storage = createWorkspaceStorage(path.join(directory, 'data'));
  const config = { engine: 'oasis-lua', projectPath: '', enumPath: 'Script/Const', dataPath: 'Script/Config', outputFormat: 'lua', autoSync: false, backupBeforeSync: true };
  const projects = ['历史项目', '当前项目', '其他项目'].map((name, i) => ({ id: 'project-delete-' + i, name, config, initialContent: 'empty' }));
  storage.setItem(catalogKey, JSON.stringify({ schema: 2, mode: 'project', activeId: projects[1].id, projects }));
  const archivedKey = 'gamecreator.workspace.v1:' + projects[2].id + ':project';
  const archived = JSON.stringify({ name: '其他项目', description: '保留原项目内容', genre: '', platform: '', version: '', status: '设计中' });
  storage.setItem(archivedKey, archived);
  const env = { ...process.env, GAMECREATOR_DATA_DIR: path.join(directory, 'data'), GAMECREATOR_USER_DATA_DIR: path.join(directory, 'profile'), GAMECREATOR_TEAM_DATA_DIR: path.join(directory, 'team') };
  delete env.ELECTRON_RUN_AS_NODE; delete env.GAMECREATOR_TEAM_ACCOUNT;
  const qa = path.join(root, '.gamecreator/qa'), errors = [];
  let app, page;
  const button = name => page.getByRole('button', { name, exact: true });
  const menu = () => page.getByRole('menu', { name: '项目列表', exact: true });
  const row = name => menu().getByRole('menuitemradio', { name: new RegExp('^' + name) });
  const context = () => page.locator('.ps-context-menu');
  const dialog = () => page.getByRole('dialog', { name: '删除本地项目', exact: true });
  const read = () => JSON.parse(storage.getItem(catalogKey));
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function launch() {
    app = await _electron.launch({ executablePath: require('electron'), args: [path.join(root, 'desktop/main.cjs')], env });
    page = await app.firstWindow(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message));
    await button('登录').click(); await page.locator('.ps-trigger').waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1500, 1000));
  }
  async function openContext(name) {
    if (!(await menu().isVisible())) await page.locator('.ps-trigger').click();
    await row(name).click({ button: 'right' }); await context().waitFor();
  }
  async function askDelete(name) {
    await openContext(name); await context().getByRole('menuitem', { name: '删除项目', exact: true }).click(); await dialog().waitFor();
    assert.equal(await dialog().locator('.ps-delete-name').innerText(), name);
    assert.equal(await dialog().getByRole('button', { name: '取消', exact: true }).evaluate(el => el === document.activeElement), true);
  }
  try {
    await fs.mkdir(qa, { recursive: true }); await launch();
    await button('故事文档').click(); await button('新建故事文档').click();
    await page.locator('.story-title-input').fill('保留正在编辑的文档'); await page.locator('.story-body').fill('删除其他项目不能改变正文');
    await page.evaluate(() => { window.deletionEditor = document.querySelector('.story-body'); });
    const before = storage.getItem(catalogKey);
    await openContext('其他项目'); assert.equal(read().activeId, projects[1].id, 'right click switched project');
    await page.screenshot({ path: path.join(qa, 'project-delete-context.png') });
    await page.keyboard.press('Escape'); await context().waitFor({ state: 'hidden' });
    assert.ok(await menu().isVisible());
    await row('其他项目').focus(); await page.keyboard.press('Shift+F10'); await context().waitFor();
    await page.mouse.click(700, 70); await context().waitFor({ state: 'hidden' });
    await askDelete('其他项目'); await page.screenshot({ path: path.join(qa, 'project-delete-confirm.png') });
    await dialog().getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(storage.getItem(catalogKey), before);
    await askDelete('其他项目'); await dialog().getByRole('button', { name: '删除项目', exact: true }).click();
    await dialog().waitFor({ state: 'hidden' });
    assert.equal(read().projects.length, 2); assert.equal(read().activeId, projects[1].id);
    assert.equal(storage.getItem(archivedKey), archived);
    assert.equal(await page.evaluate(() => window.deletionEditor === document.querySelector('.story-body')), true);
    assert.equal(await page.locator('.story-body').inputValue(), '删除其他项目不能改变正文');
    // Inject a real IPC disk-write failure: stay in the dialog and retain the catalog.
    await askDelete('当前项目'); const failBefore = storage.getItem(catalogKey);
    await app.evaluate(({ ipcMain }) => {
      globalThis.deleteStorageHandler = ipcMain.listeners('workspace-storage')[0];
      ipcMain.removeAllListeners('workspace-storage');
      ipcMain.on('workspace-storage', (event, request) => {
        if (request?.operation === 'set' && request.key === 'gamecreator.projects.v1') { event.returnValue = { ok: false, error: 'QA disk failure' }; return; }
        globalThis.deleteStorageHandler(event, request);
      });
    });
    await dialog().getByRole('button', { name: '删除项目', exact: true }).click(); await dialog().getByRole('alert').waitFor();
    assert.equal(storage.getItem(catalogKey), failBefore);
    await app.evaluate(({ ipcMain }) => { ipcMain.removeAllListeners('workspace-storage'); ipcMain.on('workspace-storage', globalThis.deleteStorageHandler); });
    // A pending-save guard must prevent deleting the active editor as well.
    await page.evaluate(() => { window.deleteGuard = event => event.preventDefault(); window.addEventListener('gamecreator:before-logout', window.deleteGuard); });
    await dialog().getByRole('button', { name: '删除项目', exact: true }).click();
    assert.equal(storage.getItem(catalogKey), failBefore);
    assert.match(await dialog().getByRole('alert').innerText(), /尚未保存|进行中/);
    await page.evaluate(() => window.removeEventListener('gamecreator:before-logout', window.deleteGuard));
    await dialog().getByRole('button', { name: '删除项目', exact: true }).click(); await dialog().waitFor({ state: 'hidden' });
    await settle(); assert.equal(read().activeId, projects[0].id); assert.equal(read().projects.length, 1);
    assert.ok((await page.locator('.ps-trigger').innerText()).includes('历史项目'));
    await askDelete('历史项目'); await page.keyboard.press('Escape'); await dialog().waitFor({ state: 'hidden' });
    assert.equal(read().projects.length, 1);
    await askDelete('历史项目'); await dialog().getByRole('button', { name: '删除项目', exact: true }).click();
    await page.getByRole('heading', { name: '暂无本地项目', exact: true }).waitFor();
    assert.deepEqual(read(), { schema: 2, mode: 'project', activeId: '', projects: [] });
    assert.ok(await button('玩法核心').isDisabled());
    await page.screenshot({ path: path.join(qa, 'project-delete-empty.png') });
    await app.close(); app = null; await launch();
    await page.getByRole('heading', { name: '暂无本地项目', exact: true }).waitFor();
    assert.equal(read().projects.length, 0);
    await button('用户与权限').click();
    const users = page.getByRole('main', { name: '用户与权限', exact: true });
    await users.getByRole('button', { name: '连接服务器管理员', exact: true }).waitFor();
    await users.getByRole('button', { name: '返回工作区', exact: true }).click();
    await page.getByRole('heading', { name: '暂无本地项目', exact: true }).waitFor();
    await page.locator('.ps-trigger').click(); await menu().getByRole('menuitem', { name: '新建项目', exact: true }).click();
    const create = page.getByRole('dialog', { name: '新建项目', exact: true });
    await create.getByLabel('项目名称', { exact: true }).fill('其他项目'); await create.getByRole('button', { name: '创建并切换', exact: true }).click();
    await page.getByRole('textbox', { name: '项目名称', exact: true }).waitFor();
    assert.equal(read().projects.length, 1); assert.notEqual(read().activeId, projects[2].id);
    assert.equal(await page.getByRole('textbox', { name: '项目简介', exact: true }).inputValue(), '');
    // With an empty catalog, prototype import remains available and initializes normally.
    await askDelete('其他项目'); await dialog().getByRole('button', { name: '删除项目', exact: true }).click();
    await page.getByRole('heading', { name: '暂无本地项目', exact: true }).waitFor();
    await page.locator('.ps-trigger').click(); await menu().getByRole('menuitem', { name: '从原型示例创建项目', exact: true }).click();
    const importer = page.getByRole('dialog', { name: '从原型示例创建项目', exact: true });
    await importer.getByRole('radio', { name: '植物大战僵尸', exact: true }).check();
    await importer.getByLabel('项目名称', { exact: true }).fill('导入后的项目');
    await importer.getByRole('button', { name: '创建并打开', exact: true }).click();
    await importer.waitFor({ state: 'hidden' }); assert.equal(read().projects.length, 1);
    // Local read-only users can switch, but must have no delete operation.
    await button('退出登录').click(); await page.getByLabel('账号', { exact: true }).fill('user'); await page.getByLabel('密码', { exact: true }).fill('user123');
    await button('登录').click(); await page.locator('.ps-trigger').click();
    await row('导入后的项目').click({ button: 'right' }); await settle();
    assert.equal(await context().count(), 0); assert.equal(await page.getByRole('menuitem', { name: '删除项目', exact: true }).count(), 0);
    assert.equal(storage.getItem(archivedKey), archived);
    assert.deepEqual(errors, []);
    console.log('PASS: right-click/keyboard/cancel; inactive editor preservation; failed write and save guard; current/last project deletion; empty restart/create/import; local-user permissions; original archives retained.');
  } catch (error) {
    if (page && !page.isClosed()) {
      console.error((await page.locator('body').innerText()).slice(0, 5000));
      await page.screenshot({ path: path.join(qa, 'project-deletion-failure.png') }).catch(() => {});
    }
    throw error;
  } finally {
    if (app) await app.close();
    const target = path.resolve(directory);
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('gc-project-deletion-'));
    await fs.rm(target, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
