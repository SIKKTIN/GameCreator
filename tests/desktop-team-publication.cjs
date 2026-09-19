// Two isolated Electron clients; no user projects or running services are touched.
const { _electron } = require(process.env.GAMECREATOR_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const { createCollaborationServer } = require('../server/collaboration.cjs');
const { createWorkspaceStorage } = require('../desktop/test-workspaces.cjs');
const root = path.resolve(__dirname, '..');
const waitUntil = async (check, message) => {
  const end = Date.now() + 20000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(message);
};
(async () => {
  const prefix = path.join(os.tmpdir(), 'gc-publication-ui-'), directory = await fs.mkdtemp(prefix);
  const service = await createCollaborationServer({ directory: path.join(directory, 'server'), port: 0 });
  const storage = createWorkspaceStorage(path.join(directory, 'publisher', 'data'));
  const projectId = 'project-publish-source', storyKey = `gamecreator.workspace.v1:${projectId}:stories`;
  const config = { engine: 'oasis-lua', projectPath: '', enumPath: 'Script/Const', dataPath: 'Script/Config', outputFormat: 'lua', autoSync: false, backupBeforeSync: true };
  storage.setItem('gamecreator.projects.v1', JSON.stringify({ schema: 2, activeId: projectId, mode: 'project', projects: [
    { id: projectId, name: '本地原型', config, initialContent: 'empty' }, { id: 'project-empty-source', name: '空白本地', config, initialContent: 'empty' },
  ] }));
  const stories = Array.from({ length: 60 }, (_, i) => ({ id: 'source-' + i, title: '发布故事 ' + i, category: '角色设定', status: '评审中', updated: '昨天', summary: '摘要 ' + i, content: '本地正文 ' + i,
    tags: ['原型', '角色'], outlines: ['起因', '转折'], relations: { characters: ['甲'], locations: ['矿城'], systems: ['声望'] } }));
  storage.setItem(storyKey, JSON.stringify(stories));
  const metaKey = `gamecreator.workspace.v1:${projectId}:project`, milestoneKey = `gamecreator.workspace.v1:${projectId}:milestones`;
  storage.setItem(metaKey, JSON.stringify({ name: '本地原型', genre: '动作 RPG', platform: 'PC', version: 'v1.0.0', status: '制作中', description: '只留在本地的其他设计内容' }));
  storage.setItem(milestoneKey, JSON.stringify([{ title: '本地任务', owner: 'admin', due: '2026/10/20', status: 'planned' }]));
  const preserved = [metaKey, milestoneKey].map(key => [key, storage.getItem(key)]);
  const apps = new Set(), pages = [], errors = [];
  const launch = async (profile, username) => {
    const env = { ...process.env, GAMECREATOR_DATA_DIR: path.join(directory, profile, 'data'), GAMECREATOR_USER_DATA_DIR: path.join(directory, profile, 'profile'),
      GAMECREATOR_TEAM_DATA_DIR: path.join(directory, 'server'), GAMECREATOR_TEAM_PORT: new URL(service.url).port };
    delete env.ELECTRON_RUN_AS_NODE; delete env.GAMECREATOR_TEAM_ACCOUNT;
    const app = await _electron.launch({ executablePath: require('electron'), args: [path.join(root, 'desktop/main.cjs')], env, timeout: 30000 });
    apps.add(app); const page = await app.firstWindow(); pages.push(page); page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    await page.getByLabel('账号', { exact: true }).fill(username); await page.getByLabel('密码', { exact: true }).fill(username + '123');
    await page.getByRole('button', { name: '登录', exact: true }).click(); await page.locator('.ps-trigger').waitFor();
    return { app, page };
  };
  const menu = async page => { await page.locator('.ps-trigger').click(); return page.getByRole('menu', { name: '项目列表' }); };
  const choose = async (page, name, kind = '本地项目') => {
    await (await menu(page)).getByRole('menuitemradio', { name: new RegExp('^' + name + '[\\s\\S]*' + kind) }).click();
  };
  const connection = page => page.getByRole('dialog', { name: '连接团队服务器', exact: true });
  const connect = async (page, username) => {
    await connection(page).getByLabel('协作服务地址', { exact: true }).fill(service.url);
    await connection(page).getByLabel('模拟成员', { exact: true }).selectOption(username);
    await connection(page).getByRole('button', { name: '连接并进入项目', exact: true }).click();
  };
  const modal = page => page.getByRole('dialog', { name: '发布为协作项目', exact: true });
  const openPublish = async page => (await menu(page)).getByRole('menuitem', { name: '发布为协作项目', exact: true }).click();
  const submit = page => modal(page).getByRole('button', { name: '发布并进入协作项目', exact: true }).click();
  const prepare = async page => {
    await modal(page).getByLabel('协作项目名称', { exact: true }).fill('已发布原型');
    await modal(page).getByLabel('bob 权限', { exact: true }).selectOption('editor');
    await modal(page).getByLabel('viewer 权限', { exact: true }).selectOption('viewer');
  };
  let releaseResponse;
  try {
    let a = await launch('publisher', 'admin'); const b = await launch('member', 'user');
    const normalMenu = await menu(b.page); assert.equal(await normalMenu.getByRole('menuitem', { name: '发布为协作项目', exact: true }).count(), 0);
    await normalMenu.getByRole('menuitem', { name: '连接团队服务器', exact: true }).click(); await connect(b.page, 'bob');
    await b.page.locator('.team-project .story-workspace').waitFor();
    await openPublish(a.page); await connection(a.page).getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await modal(a.page).count(), 0, 'Cancelling the connection must cancel pending publication');
    await openPublish(a.page); await connect(a.page, 'admin'); await prepare(a.page);
    assert.ok((await modal(a.page).innerText()).includes('发布全部 60 篇故事文档'));
    // Simulate an edit made in a second local window after previewing.
    stories[0].content = '预览后修改的本地正文'; storage.setItem(storyKey, JSON.stringify(stories));
    await submit(a.page); await modal(a.page).getByText('本地项目已变化，请重新读取预览后再发布。', { exact: true }).waitFor();
    await modal(a.page).getByRole('button', { name: '重新读取预览', exact: true }).click(); await prepare(a.page);
    const localBefore = storage.getItem(storyKey);
    await fs.mkdir(path.join(root, '.gamecreator/qa'), { recursive: true });
    await a.page.screenshot({ path: path.join(root, '.gamecreator/qa/publish-local-project.png') });
    // Commit successfully at the server, but lose the response. Also verify UI guards while awaiting it.
    let committed, posts = 0;
    const held = new Promise(resolve => { releaseResponse = resolve; });
    await a.page.route('**/api/team/publications', async route => {
      posts++; const response = await route.fetch(); assert.equal(response.status(), 201); committed = await response.json();
      await held; await route.abort('failed');
    }, { times: 1 });
    await submit(a.page); await waitUntil(() => !!committed, 'Publication did not commit');
    assert.equal(committed.storyCount, 60);
    const guards = await a.page.evaluate(() => ['gamecreator:before-logout', 'gamecreator:leave-team'].map(name => window.dispatchEvent(new Event(name, { cancelable: true }))));
    assert.deepEqual(guards, [false, false]); assert.ok(await modal(a.page).getByRole('button', { name: '取消', exact: true }).isDisabled());
    releaseResponse();
    await modal(a.page).getByText(/发布结果尚未确认/).waitFor(); assert.equal(posts, 1);
    await choose(b.page, '已发布原型', '团队项目');
    await b.page.getByRole('button', { name: '打开故事文档：发布故事 0', exact: true }).click();
    for (const [label, value] of [['文档正文', stories[0].content], ['文档状态', '评审中'], ['文档标签', '原型\n角色'], ['文档大纲', '起因\n转折'], ['关联角色', '甲'], ['关联地点', '矿城'], ['关联系统', '声望']]) {
      assert.equal(await b.page.getByLabel(label, { exact: true }).inputValue(), value);
    }
    assert.equal(await b.page.getByRole('button', { name: /^打开故事文档：/ }).count(), 60);
    for (const name of ['玩法核心', '玩法设计', '美术资产', '数据配置']) assert.ok(await b.page.getByRole('navigation', { name: '工作区模块', exact: true }).getByRole('button', { name: new RegExp('^' + name) }).isDisabled());
    await b.page.getByLabel('文档正文', { exact: true }).fill('Bob 的团队修改');
    await b.page.getByRole('button', { name: '保存到团队', exact: true }).click();
    await waitUntil(async () => (await b.page.locator('.team-save-state').innerText()).includes('当前内容已保存到团队'), 'Bob save not confirmed');
    await a.app.close(); apps.delete(a.app); a = await launch('publisher', 'admin');
    await openPublish(a.page); await connect(a.page, 'admin');
    await modal(a.page).getByText('此本地项目已发布', { exact: true }).waitFor();
    assert.equal(await modal(a.page).getByRole('button', { name: '发布并进入协作项目', exact: true }).count(), 0);
    await modal(a.page).getByRole('button', { name: '进入已发布项目', exact: true }).click();
    await a.page.getByRole('button', { name: '打开故事文档：发布故事 0', exact: true }).click();
    assert.equal(await a.page.getByLabel('文档正文', { exact: true }).inputValue(), 'Bob 的团队修改');
    await a.page.getByRole('button', { name: '从本地导入故事', exact: true }).click();
    const importer = a.page.getByRole('dialog', { name: '复制本地故事到团队项目', exact: true });
    await importer.getByRole('button', { name: '复制 50 篇到团队', exact: true }).click();
    await importer.getByText(/已复制 0 篇；跳过 50 篇/).waitFor(); await importer.getByRole('button', { name: '完成', exact: true }).click();
    assert.equal(storage.getItem(storyKey), localBefore); for (const [key, value] of preserved) assert.equal(storage.getItem(key), value);
    await choose(a.page, '本地原型'); await a.page.getByRole('button', { name: '故事文档', exact: true }).click();
    await a.page.getByRole('button', { name: '打开故事文档：发布故事 0', exact: true }).click();
    assert.equal(await a.page.getByLabel('文档正文', { exact: true }).inputValue(), stories[0].content);
    assert.ok(await a.page.getByRole('button', { name: '玩法核心', exact: true }).isEnabled());
    await choose(a.page, '空白本地'); await openPublish(a.page);
    await modal(a.page).getByLabel('协作项目名称', { exact: true }).fill('空白协作'); await submit(a.page);
    await a.page.getByRole('heading', { name: '暂无故事文档', exact: true }).waitFor();
    await choose(a.page, '空白本地'); await a.page.getByRole('button', { name: '引擎设置', exact: true }).click();
    await a.page.getByRole('button', { name: /^测试面板/ }).click(); await a.page.getByRole('button', { name: '加载新增成员', exact: true }).click();
    await a.page.locator('.test-workspace-banner').waitFor();
    assert.equal(await (await menu(a.page)).getByRole('menuitem', { name: '发布为协作项目', exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: publish all 60 complete stories; preview changes block stale publication; lost acknowledgement and client restart recover the same project; team edits preserved; import deduplication; local data intact; unsupported team modules disabled; empty publication; no entry for local user or test workspace.');
  } catch (error) {
    for (const page of pages) if (!page.isClosed()) console.error((await page.locator('body').innerText()).slice(0, 4500)); throw error;
  } finally {
    releaseResponse?.(); for (const app of apps) await app.close(); await service.close();
    assert.ok(path.resolve(directory).startsWith(path.resolve(prefix))); await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
