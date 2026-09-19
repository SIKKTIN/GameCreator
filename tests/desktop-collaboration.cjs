// Real, isolated Electron clients. Run npm run build first.
const { _electron } = require(process.env.GAMECREATOR_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createCollaborationServer } = require('../server/collaboration.cjs');
const { createWorkspaceStorage } = require('../desktop/test-workspaces.cjs');
const root = path.resolve(__dirname, '..');
const pauseUntil = async (check, message) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(message);
};
(async () => {
  const prefix = path.join(os.tmpdir(), 'gamecreator-team-ui-');
  const directory = await fs.mkdtemp(prefix);
  const teamDirectory = path.join(directory, 'server');
  let service = await createCollaborationServer({ directory: teamDirectory, port: 0 });
  const serviceUrl = service.url, servicePort = Number(new URL(serviceUrl).port);
  const apps = new Set(), pages = [], errors = [];
  const localStory = { id:'source-story', title:'本地完整故事', category:'角色设定', status:'评审中', updated:'昨天', summary:'导入预览摘要', content:'本地真实故事正文',
    tags:['星核','主角'], outlines:['起因','转折'], relations:{characters:['艾拉'],locations:['灰炉'],systems:['声望']} };
  const sourceKey = 'gamecreator.workspace.v1:project-source:stories';
  const launch = async account => {
    const env = { ...process.env, GAMECREATOR_TEAM_ACCOUNT: account, GAMECREATOR_USER_DATA_DIR: path.join(directory, account, 'profile'),
      GAMECREATOR_DATA_DIR: path.join(directory, account, 'data') };
    delete env.ELECTRON_RUN_AS_NODE;
    const storage = createWorkspaceStorage(env.GAMECREATOR_DATA_DIR);
    if (!storage.getItem('gamecreator.projects.v1')) {
      const config = {engine:'oasis-lua',projectPath:'',enumPath:'Script/Const',dataPath:'Script/Config',outputFormat:'lua',autoSync:false,backupBeforeSync:true};
      storage.setItem('gamecreator.projects.v1',JSON.stringify({schema:2,activeId:'project-source',mode:'project',projects:[
        {id:'project-source',name:'本地原型',initialContent:'empty',config}, {id:'project-empty',name:'空白项目',initialContent:'empty',config},
      ]}));
      storage.setItem(sourceKey,JSON.stringify([localStory]));
    }
    const app = await _electron.launch({ executablePath: require('electron'), args: [path.join(root, 'desktop/main.cjs')], env, timeout: 30000 });
    apps.add(app); const page = await app.firstWindow({ timeout: 20000 }); pages.push(page);
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(15000);
    return { app, page };
  };
  const login = async (page, account) => {
    await page.locator('.auth-submit, .ps-trigger').first().waitFor();
    if (await page.getByRole('button', { name: '登录', exact: true }).isVisible()) await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.locator('.ps-trigger').waitFor();
    const dialog = page.getByRole('dialog', { name: '连接团队服务器', exact: true });
    if (!await dialog.isVisible()) {
      await page.locator('.ps-trigger').click(); await page.getByRole('menuitem', { name: '连接团队服务器', exact: true }).click();
    }
    await page.getByLabel('协作服务地址', { exact: true }).fill(serviceUrl);
    await page.getByLabel('模拟成员', { exact: true }).selectOption(account);
    await page.getByRole('button', { name: '连接并进入项目', exact: true }).click();
    await page.locator('.team-project .story-workspace').waitFor();
  };
  const open = (page, title) => page.getByRole('button', { name: '打开故事文档：' + title, exact: true }).click();
  const selectProject = async (page, name) => { await page.locator('.ps-trigger').click(); await page.getByRole('menuitemradio', { name: new RegExp('^' + name) }).click(); };
  const body = page => page.getByLabel('文档正文', { exact: true });
  const save = async page => {
    await page.getByRole('button', { name: '保存到团队', exact: true }).click();
    await pauseUntil(async () => (await page.locator('.team-save-state').innerText()).includes('当前内容已保存到团队'), 'Save never confirmed');
  };
  try {
    let a = await launch('alice'); const b = await launch('bob');
    await login(a.page, 'alice'); await login(b.page, 'bob');
    assert.ok(await a.page.getByRole('button', { name: /^玩法设计/ }).isDisabled());
    assert.equal(await a.page.locator('.story-workspace').count(), 1);
    const sourceBefore = await a.page.evaluate(key => window.desktopClient.storage.getItem(key), sourceKey);
    await a.page.getByRole('button', { name: '从本地导入故事', exact: true }).click();
    const importer = a.page.getByRole('dialog', { name: '复制本地故事到团队项目', exact: true });
    await importer.getByLabel('来源本地项目', { exact: true }).selectOption('project-empty');
    assert.ok((await importer.innerText()).includes('还没有故事文档'));
    await importer.getByLabel('来源本地项目', { exact: true }).selectOption('project-source');
    await importer.getByText('预览内容', { exact: true }).click();
    assert.ok((await importer.innerText()).includes('起因 / 转折'));
    await importer.getByRole('button', { name: '复制 1 篇到团队', exact: true }).click();
    await importer.getByText(/已复制 1 篇/).waitFor();
    await importer.getByRole('button', { name: '完成', exact: true }).click();
    await b.page.getByRole('button', { name: '打开故事文档：本地完整故事', exact: true }).waitFor();
    await open(b.page, '本地完整故事');
    for (const [label,value] of [['文档状态','评审中'],['文档标签','星核\n主角'],['文档大纲','起因\n转折'],['关联角色','艾拉'],['关联地点','灰炉'],['关联系统','声望']]) {
      assert.equal(await b.page.getByLabel(label,{exact:true}).inputValue(),value);
    }
    await b.page.getByLabel('文档标签',{exact:true}).fill('星核\n已补充');
    await b.page.getByLabel('文档大纲',{exact:true}).fill('起因\n转折\n结局');
    await b.page.getByLabel('关联角色',{exact:true}).fill('艾拉\n诺恩');
    await b.page.getByLabel('文档状态',{exact:true}).selectOption('定稿'); await save(b.page);
    await pauseUntil(async()=>await a.page.getByLabel('文档状态',{exact:true}).inputValue()==='定稿','Full story metadata did not sync');
    await a.page.getByRole('button', { name: '从本地导入故事', exact: true }).click();
    await importer.getByRole('button', { name: '复制 1 篇到团队', exact: true }).click();
    await importer.getByText(/已复制 0 篇；跳过 1 篇/).waitFor(); await importer.getByRole('button',{name:'完成',exact:true}).click();
    assert.equal(await a.page.evaluate(key => window.desktopClient.storage.getItem(key),sourceKey),sourceBefore);
    await open(a.page,'世界背景'); await body(a.page).fill('切换项目后仍存在的团队草稿');
    await selectProject(a.page,'本地原型'); await a.page.getByRole('button',{name:'故事文档',exact:true}).click();
    assert.equal(await body(a.page).inputValue(),localStory.content);
    assert.equal(await a.page.getByLabel('文档标签',{exact:true}).inputValue(),'星核\n主角');
    assert.ok(await a.page.getByRole('button',{name:'玩法设计',exact:true}).isEnabled());
    await a.page.locator('.ps-trigger').click();
    assert.ok((await a.page.getByRole('menu',{name:'项目列表'}).innerText()).includes('本地项目'));
    assert.ok((await a.page.getByRole('menu',{name:'项目列表'}).innerText()).includes('团队项目'));
    await a.page.getByRole('menuitemradio',{name:/^多人协作验证项目/}).click(); await open(a.page,'世界背景');
    assert.equal(await body(a.page).inputValue(),'切换项目后仍存在的团队草稿'); await save(a.page);
    await open(a.page, '世界背景'); await open(b.page, '世界背景');
    await body(b.page).fill('Bob 的未提交草稿');
    await body(a.page).fill('Alice 的团队版本'); await save(a.page);
    await b.page.getByRole('alert', { name: '文档冲突', exact: true }).waitFor();
    assert.equal(await body(b.page).inputValue(), 'Bob 的未提交草稿');
    await pauseUntil(async () => (await b.page.getByRole('region', { name: '团队最新版本', exact: true }).innerText()).includes('Alice 的团队版本'), 'Conflict comparison did not receive the latest team version');
    assert.ok(await b.page.getByRole('button', { name: '保存到团队', exact: true }).isDisabled());
    await fs.mkdir(path.join(root, '.gamecreator/qa'), { recursive: true });
    await b.page.screenshot({ path: path.join(root, '.gamecreator/qa/team-conflict.png'), fullPage: true });
    await body(b.page).fill('Alice 的团队版本\nBob 的补充');
    await b.page.getByRole('button', { name: '已合并，准备提交', exact: true }).click(); await save(b.page);
    await pauseUntil(async () => (await body(a.page).inputValue()).includes('Bob 的补充'), 'Other client did not receive update');
    // Different documents can be edited together.
    await open(b.page, '第一章剧情');
    await body(a.page).fill('Alice 独立世界'); await body(b.page).fill('Bob 独立章节');
    await Promise.all([save(a.page), save(b.page)]);
    assert.equal(await a.page.locator('.team-conflict').count(), 0); assert.equal(await b.page.locator('.team-conflict').count(), 0);
    await open(b.page, '世界背景'); await b.page.getByRole('button', { name: '修改历史', exact: true }).click();
    await b.page.getByRole('region', { name: '文档修改历史', exact: true }).waitFor();
    assert.ok((await b.page.locator('.team-history').innerText()).includes('bob'));
    await b.page.getByRole('button', { name: '新建故事文档', exact: true }).click();
    await pauseUntil(async()=>await b.page.getByLabel('文档标题',{exact:true}).inputValue()==='新的故事文档','New story was not selected');
    await b.page.getByLabel('文档标题', { exact: true }).fill('协作新增故事'); await save(b.page);
    await a.page.getByRole('button', { name: '打开故事文档：协作新增故事', exact: true }).waitFor();
    await b.page.getByRole('button', { name: '断开团队连接', exact: true }).click(); await login(b.page, 'viewer');
    assert.ok(await body(b.page).isDisabled());
    assert.equal(await b.page.getByRole('button', { name: '保存到团队', exact: true }).count(), 0);
    assert.equal(await b.page.getByRole('button', { name: '新建故事文档', exact: true }).count(), 0);
    assert.equal(await b.page.getByRole('button', { name: '从本地导入故事', exact: true }).count(), 0);
    // Disk errors keep the editor mounted, and a retry preserves its draft.
    await a.app.evaluate(({ ipcMain }) => {
      const original = ipcMain.listeners('workspace-storage')[0]; ipcMain.removeAllListeners('workspace-storage');
      globalThis.failTeamDraft = true;
      ipcMain.on('workspace-storage', (event, request) => {
        if (globalThis.failTeamDraft && request.operation === 'set' && request.key.startsWith('gamecreator.team-draft.v1:')) {
          event.returnValue = { ok: false, error: '测试草稿写入失败' };
        } else original(event, request);
      });
    });
    await body(a.page).fill('需要恢复的本机草稿');
    await a.page.getByRole('button', { name: '重试保存草稿', exact: true }).waitFor();
    await open(a.page, '第一章剧情'); assert.equal(await body(a.page).inputValue(), '需要恢复的本机草稿');
    await a.app.evaluate(() => { globalThis.failTeamDraft = false; });
    await a.page.getByRole('button', { name: '重试保存草稿', exact: true }).click();
    const oldUrl = a.page.url(); await a.app.close(); apps.delete(a.app);
    a = await launch('alice'); await login(a.page, 'alice'); await open(a.page, '世界背景');
    assert.notEqual(a.page.url(), oldUrl); assert.equal(await body(a.page).inputValue(), '需要恢复的本机草稿');
    // Stop and restart the actual service; drafts survive both an offline save and a renderer reload.
    await service.close();
    await body(a.page).fill('断线后保留的草稿');
    await a.page.getByRole('button', { name: '保存到团队', exact: true }).click();
    await a.page.getByText('无法连接协作服务，请确认服务正在运行。未提交的草稿保留在本机。', { exact: true }).first().waitFor();
    assert.equal(await body(a.page).inputValue(), '断线后保留的草稿');
    await a.page.reload();
    service = await createCollaborationServer({ directory: teamDirectory, port: servicePort });
    await login(a.page, 'alice'); await open(a.page, '世界背景');
    assert.equal(await body(a.page).inputValue(), '断线后保留的草稿'); await save(a.page);
    await a.page.screenshot({ path: path.join(root, '.gamecreator/qa/team-editor.png'), fullPage: true });
    // A corrupt archive is never overwritten, but it must not trap the user in that document.
    const draftKey = `gamecreator.team-draft.v1:${service.serverId}:alice:team-demo:world`;
    await a.page.evaluate(key => window.desktopClient.storage.setItem(key, JSON.stringify({ broken: true })), draftKey);
    await open(a.page, '第一章剧情'); await open(a.page, '世界背景');
    assert.ok(await body(a.page).isDisabled());
    await open(a.page, '第一章剧情'); assert.ok(await body(a.page).isEnabled());
    assert.equal(await a.page.evaluate(key => window.desktopClient.storage.getItem(key), draftKey), JSON.stringify({ broken: true }));
    // Return to the existing local workspace without a team session overriding its login.
    await a.page.getByRole('button', { name: '断开团队连接', exact: true }).click();
    await a.page.getByRole('button', { name: '故事文档', exact: true }).waitFor();
    assert.equal(await a.page.evaluate(key=>window.desktopClient.storage.getItem(key),sourceKey),sourceBefore);
    assert.equal(await a.page.evaluate(()=>JSON.parse(window.desktopClient.storage.getItem('gamecreator.projects.v1')).projects.length),2);
    assert.deepEqual(errors, []);
    console.log('PASS: unified project picker and shared story editor; complete import/preview/retry with source untouched; metadata sync; disabled unsupported modules; two real clients, independent edits/conflicts, history, permissions, draft and offline recovery, local/team isolation.');
  } catch (error) {
    for (const page of pages) if (!page.isClosed()) console.error((await page.locator('body').innerText()).slice(0,4500));
    throw error;
  } finally {
    for (const app of apps) await app.close();
    await service.close();
    assert.ok(path.resolve(directory).startsWith(path.resolve(prefix)));
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
