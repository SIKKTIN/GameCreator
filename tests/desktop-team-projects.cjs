// Isolated server and two real Electron clients. Build before running.
const { _electron } = require(process.env.GAMECREATOR_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const { createCollaborationServer } = require('../server/collaboration.cjs');
const root = path.resolve(__dirname, '..');
const waitUntil = async (check, message) => {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(message);
};
(async () => {
  const prefix = path.join(os.tmpdir(), 'gamecreator-project-ui-'), directory = await fs.mkdtemp(prefix);
  const service = await createCollaborationServer({ directory: path.join(directory, 'server'), port: 0 });
  const apps = [], pages = [], errors = [];
  const launch = async account => {
    const env = { ...process.env, GAMECREATOR_DATA_DIR: path.join(directory, account, 'data'),
      GAMECREATOR_USER_DATA_DIR: path.join(directory, account, 'profile'), GAMECREATOR_TEAM_DATA_DIR: path.join(directory, 'server'),
      GAMECREATOR_TEAM_PORT: new URL(service.url).port };
    delete env.ELECTRON_RUN_AS_NODE; delete env.GAMECREATOR_TEAM_ACCOUNT;
    const app = await _electron.launch({ executablePath: require('electron'), args: [path.join(root, 'desktop/main.cjs')], env, timeout: 30000 });
    apps.push(app); const page = await app.firstWindow(); pages.push(page); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.getByLabel('账号', { exact: true }).fill(account);
    await page.getByLabel('密码', { exact: true }).fill(account + '123');
    await page.getByRole('button', { name: '登录', exact: true }).click(); await page.locator('.ps-trigger').waitFor();
    return page;
  };
  const menu = async page => { await page.locator('.ps-trigger').click(); return page.getByRole('menu', { name: '项目列表' }); };
  const connection = page => page.getByRole('dialog', { name: '连接团队服务器', exact: true });
  const connect = async (page, username) => {
    await connection(page).getByLabel('协作服务地址', { exact: true }).fill(service.url);
    await connection(page).getByLabel('团队账号', { exact: true }).fill(username);
    await connection(page).getByLabel('团队密码', { exact: true }).fill(username+'123');
    await connection(page).getByRole('button', { name: '连接并进入项目', exact: true }).click();
  };
  const choose = async (page, name) => { const list = await menu(page); await list.getByRole('menuitemradio', { name: new RegExp('^' + name) }).click(); };
  const create = async (page, name, account) => {
    const dialog = page.getByRole('dialog', { name: '新建协作项目', exact: true });
    await dialog.getByLabel('协作项目名称', { exact: true }).fill(name);
    await dialog.getByLabel(account + ' 权限', { exact: true }).selectOption('editor');
    assert.ok(await dialog.getByLabel('admin 权限', { exact: true }).isDisabled());
    await fs.mkdir(path.join(root, '.gamecreator/qa'), { recursive: true });
    await page.screenshot({ path: path.join(root, '.gamecreator/qa/team-project-create.png') });
    await dialog.getByRole('button', { name: '创建并进入协作项目', exact: true }).click();
    await page.getByRole('heading', { name: '暂无故事文档', exact: true }).waitFor();
    assert.ok((await page.locator('.ps-trigger').innerText()).includes(name));
  };
  const changeBob = async (page, role) => {
    await page.getByRole('button', { name: '成员管理', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '成员管理', exact: true });
    await dialog.getByLabel('bob 权限', { exact: true }).selectOption(role);
    await page.screenshot({ path: path.join(root, '.gamecreator/qa/team-project-members.png') });
    await dialog.getByRole('button', { name: '保存成员配置', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  };
  try {
    const a = await launch('admin'), b = await launch('user');
    const userMenu = await menu(b);
    assert.equal(await userMenu.getByRole('menuitem', { name: '新建协作项目', exact: true }).count(), 0);
    await userMenu.getByRole('menuitem', { name: '连接团队服务器', exact: true }).click(); await connect(b, 'bob');
    await b.locator('.team-project .story-workspace').waitFor();
    await (await menu(a)).getByRole('menuitem', { name: '新建协作项目', exact: true }).click();
    assert.equal(await connection(a).getByLabel('团队账号', { exact: true }).inputValue(), 'admin');
    await connection(a).getByLabel('团队密码', { exact: true }).fill('保留已输入密码');
    await connection(a).getByRole('button', { name: '前往服务器管理', exact: true }).click();
    await a.getByRole('main', { name: '服务器管理', exact: true }).getByRole('button', { name: '返回连接设置', exact: true }).click();
    assert.equal(await connection(a).getByLabel('团队密码', { exact: true }).inputValue(), '保留已输入密码');
    await connect(a, 'admin'); await create(a, '项目甲', 'bob');
    await a.getByRole('button', { name: '新建故事文档', exact: true }).click();
    await a.getByLabel('文档标题', { exact: true }).fill('甲的独立文档');
    await a.getByLabel('文档正文', { exact: true }).fill('项目甲内容');
    await a.getByRole('button', { name: '保存到团队', exact: true }).click();
    await waitUntil(async () => (await a.locator('.team-save-state').innerText()).includes('当前内容已保存到团队'), 'Save not confirmed');
    await (await menu(a)).getByRole('menuitem', { name: '新建协作项目', exact: true }).click(); await create(a, '项目乙', 'alice');
    await menu(b); await b.getByRole('menuitemradio', { name: /^项目甲/ }).waitFor();
    assert.equal(await b.getByRole('menuitemradio', { name: /^项目乙/ }).count(), 0);
    await b.getByRole('menuitemradio', { name: /^项目甲/ }).click();
    await b.getByRole('button', { name: '打开故事文档：甲的独立文档', exact: true }).waitFor();
    assert.equal(await b.getByLabel('文档正文', { exact: true }).inputValue(), '项目甲内容');
    assert.equal(await b.getByRole('button', { name: '成员管理', exact: true }).count(), 0);
    await choose(a, '项目甲'); await changeBob(a, 'viewer');
    await b.getByText('当前账号只有查看权限', { exact: true }).waitFor(); assert.ok(await b.getByLabel('文档正文', { exact: true }).isDisabled());
    await changeBob(a, 'editor'); await waitUntil(() => b.getByLabel('文档正文', { exact: true }).isEnabled(), 'Role promotion not reflected');
    await b.getByLabel('文档正文', { exact: true }).fill('移除成员时仍保留的本机草稿');
    await changeBob(a, 'none');
    await b.getByText('你已无权访问这个项目。本机未提交草稿仍保留，请选择其他项目或联系项目管理员。', { exact: true }).waitFor();
    assert.equal(await b.getByLabel('文档正文', { exact: true }).isVisible(), false);
    await menu(b); await waitUntil(async () => await b.getByRole('menuitemradio', { name: /^项目甲/ }).count() === 0, 'Removed project remains in directory');
    assert.equal(await b.getByRole('menuitemradio', { name: /^项目乙/ }).count(), 0);
    await b.locator('.ps-trigger').press('Escape');
    await changeBob(a, 'editor'); await b.getByLabel('文档正文', { exact: true }).waitFor();
    assert.equal(await b.getByLabel('文档正文', { exact: true }).inputValue(), '移除成员时仍保留的本机草稿');
    await b.getByRole('button', { name: '保存到团队', exact: true }).click();
    await waitUntil(async () => (await b.locator('.team-save-state').innerText()).includes('当前内容已保存到团队'), 'Restored draft not saved');
    await choose(a, '项目乙'); await a.getByRole('heading', { name: '暂无故事文档', exact: true }).waitFor();
    // An authenticated account with no memberships can remain connected and
    // discover a newly granted project without a second login.
    const loginResponse = await fetch(service.url + '/api/team/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
    const adminToken = (await loginResponse.json()).token;
    const reset = await fetch(service.url + '/api/team/projects/team-demo/members', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminToken },
      body: JSON.stringify({ revision: 1, members: [{ userId: 'admin', role: 'admin' }] }) });
    assert.equal(reset.status, 200);
    await b.getByRole('button', { name: '连接设置', exact: true }).click(); await connect(b, 'viewer');
    await menu(b); await b.getByText('已连接 viewer，尚未加入协作项目。请联系项目管理员添加。', { exact: true }).waitFor();
    await a.getByRole('button', { name: '成员管理', exact: true }).click();
    const finalMembers = a.getByRole('dialog', { name: '成员管理', exact: true });
    await finalMembers.getByLabel('viewer 权限', { exact: true }).selectOption('viewer');
    await finalMembers.getByRole('button', { name: '保存成员配置', exact: true }).click();
    await b.getByRole('menuitemradio', { name: /^项目乙/ }).waitFor(); await b.getByRole('menuitemradio', { name: /^项目乙/ }).click();
    await b.getByRole('heading', { name: '暂无故事文档', exact: true }).waitFor();
    assert.equal(await b.getByRole('button', { name: '新建故事文档', exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: two real clients; admin creation from project picker; connection form survives server management; two empty isolated projects; live membership directory; viewer/revoked rights; preserved draft after restoring membership; local user cannot create server projects.');
  } catch (error) {
    for (const page of pages) if (!page.isClosed()) console.error((await page.locator('body').innerText()).slice(0, 3000));
    throw error;
  } finally {
    for (const app of apps) await app.close(); await service.close();
    assert.ok(path.resolve(directory).startsWith(path.resolve(prefix))); await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
