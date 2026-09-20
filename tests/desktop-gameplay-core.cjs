// Run after npm run build. Uses isolated archives/profile; never edits user projects.
const { _electron } = require(process.env.GAMECREATOR_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { createWorkspaceStorage } = require('../desktop/test-workspaces.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-core-ui-'));
  const storage = createWorkspaceStorage(path.join(dir, 'data'));
  const a = 'project-' + crypto.randomUUID(), b = 'project-' + crypto.randomUUID();
  const key = id => 'gamecreator.workspace.v1:' + id + ':gameplay-core';
  const section = (id, name) => 'gamecreator.workspace.v1:' + id + ':' + name;
  const read = id => JSON.parse(storage.getItem(key(id)) || 'null');
  const config = { engine: 'oasis-lua', projectPath: '', enumPath: 'Script/Const', dataPath: 'Script/Config', outputFormat: 'lua', autoSync: false, backupBeforeSync: true };
  const projects = [{ id: a, name: '核心项目A', config, initialContent: 'empty' }, { id: b, name: '核心项目B', config, initialContent: 'empty' }];
  const { createGameplay } = await import('../src/gameplay.ts');
  const { validateGameplayCore } = await import('../src/gameplay-core.ts');
  const design = createGameplay('防守关卡详细设计');
  storage.setItem(section(a, 'gameplay'), JSON.stringify({ schema: 3, designs: [design] }));
  for (const slug of ['plants-vs-zombies', 'stardew-valley', 'hollow-knight', 'disco-elysium', 'vampire-survivors']) {
    const example = JSON.parse(await fs.readFile(path.join(root, 'examples/prototypes', slug + '.json'), 'utf8'));
    validateGameplayCore(example.gameplayCore);
    const id = 'project-' + crypto.randomUUID();
    projects.push({ id, name: 'QA ' + slug, config, initialContent: 'empty' });
    storage.setItem(key(id), JSON.stringify(example.gameplayCore));
    storage.setItem(section(id, 'gameplay'), JSON.stringify(example.gameplay));
  }
  storage.setItem('gamecreator.projects.v1', JSON.stringify({ schema: 2, activeId: a, mode: 'project', projects }));
  const env = { ...process.env, GAMECREATOR_DATA_DIR: path.join(dir, 'data'), GAMECREATOR_USER_DATA_DIR: path.join(dir, 'profile'), GAMECREATOR_TEAM_DATA_DIR: path.join(dir, 'team') };
  delete env.ELECTRON_RUN_AS_NODE;
  let app, page; const errors = [];
  const button = name => page.getByRole('button', { name, exact: true });
  const click = name => button(name).click();
  const field = name => page.getByLabel(name, { exact: true });
  const node = title => button('选择节点：' + title);
  const wait = async (fn, message) => { const until = Date.now() + 15000; while (Date.now() < until) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 50)); } assert.fail(message); };
  async function launch() {
    app = await _electron.launch({ executablePath: require('electron'), args: [path.join(root, 'desktop/main.cjs')], env });
    page = await app.firstWindow(); page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '进入本地工作区', exact: true }).click(); await page.locator('.ps-trigger').waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000));
    await click('玩法核心');
  }
  async function add(kind, title) { await click('添加' + kind); await field('节点名称').fill(title); await node(title).waitFor(); }
  async function connect(from, to, label, condition = '') {
    await click('连接节点'); await node(from).click(); await node(to).click();
    await field('连线说明').fill(label); await field('流转条件').fill(condition);
  }
  async function chooseProject(name) {
    await page.locator('.ps-trigger').click(); await page.getByRole('menuitemradio').filter({ hasText: name }).click(); await click('玩法核心');
  }
  const qaDir = path.join(root, '.gamecreator/qa'); await fs.mkdir(qaDir, { recursive: true });
  try {
    await launch(); assert.equal(read(a), null, 'empty core is not written merely by visiting');
    await add('入口', '主界面'); await add('循环模块', '挑战模式'); await connect('主界面', '挑战模式', '开始游戏');
    await node('挑战模式').dblclick(); await field('流程图名称').waitFor();
    await add('入口', '选择植物'); await add('活动', '挑战关卡'); await add('活动', '获得奖励'); await add('条件分支', '完成所有关卡？'); await add('结束', '通关');
    await connect('选择植物', '挑战关卡', '进入关卡'); await connect('挑战关卡', '获得奖励', '获胜');
    await connect('获得奖励', '完成所有关卡？', '结算'); await connect('完成所有关卡？', '选择植物', '继续挑战', '仍有未完成关卡');
    await connect('完成所有关卡？', '通关', '完成挑战', '所有关卡完成并击败 Boss'); await connect('挑战关卡', '挑战关卡', '重新挑战', '失败后重试');
    const rootGraph = read(a).graphs.find(graph => graph.id === read(a).rootId), module = rootGraph.nodes.find(n => n.title === '挑战模式');
    const graphId = module.childGraphId, graph = () => read(a).graphs.find(g => g.id === graphId);
    assert.equal(graph().edges.length, 6); assert.ok(graph().edges.some(e => e.fromId === e.toId));
    await node('挑战关卡').click();
    // Associate an existing detailed design without copying its text into the flow.
    await field('添加关联玩法').selectOption(design.id);
    await wait(() => graph().nodes.find(n => n.title === '挑战关卡').gameplayIds.includes(design.id), 'gameplay reference was not saved');
    await click('打开关联玩法：' + design.title); await page.getByRole('textbox', {name: '玩法名称', exact: true}).waitFor();
    assert.equal(await page.getByRole('textbox', {name: '玩法名称', exact: true}).inputValue(), design.title);
    await click('玩法核心'); await node('挑战关卡').waitFor();
    // Pointer coordinates are persisted on drop and survive returning to a module.
    await click('还原缩放'); await node('挑战关卡').scrollIntoViewIfNeeded();
    const beforeMove = graph().nodes.find(n => n.title === '挑战关卡');
    const box = await node('挑战关卡').boundingBox();
    await page.mouse.move(box.x + 45, box.y + 35); await page.mouse.down(); await page.mouse.move(box.x + 105, box.y + 75, { steps: 8 }); await page.mouse.up();
    await wait(() => graph().nodes.find(n => n.id === beforeMove.id).x !== beforeMove.x, 'drag was not persisted');
    await click('返回流程：游戏入口'); await node('主界面').waitFor(); await node('挑战模式').dblclick();
    assert.notEqual(graph().nodes.find(n => n.id === beforeMove.id).x, beforeMove.x);
    await node('挑战关卡').click(); await field('节点说明').fill('使用详细玩法中的战斗规则');
    // Space in text inputs must not open the test panel.
    await field('节点说明').press('End'); await field('节点说明').press('Space'); assert.equal(await page.getByRole('dialog', { name: '测试面板', exact: true }).count(), 0);
    // Disk failures retain in-memory drafts and block project switching/export/logout.
    const committed = storage.getItem(key(a));
    await app.evaluate(({ ipcMain }, storageKey) => { const original = ipcMain.listeners('workspace-storage')[0]; globalThis.coreStorageHandler = original;
      ipcMain.removeAllListeners('workspace-storage'); ipcMain.on('workspace-storage', (event, request) => {
        if (request.operation === 'set' && request.key === storageKey) event.returnValue = { ok: false, error: '模拟磁盘写入失败' }; else original(event, request);
      }); }, key(a));
    await field('节点说明').fill('保存失败后保留的核心草稿'); await button('重试保存玩法核心').waitFor();
    assert.equal(storage.getItem(key(a)), committed); assert.equal(await page.locator('.ps-trigger').isDisabled(), true);
    assert.equal(await button('生成 AI 文档').isDisabled(), true); await click('返回启动页'); assert.equal(await field('节点说明').inputValue(), '保存失败后保留的核心草稿');
    await app.evaluate(({ ipcMain }) => { ipcMain.removeAllListeners('workspace-storage'); ipcMain.on('workspace-storage', globalThis.coreStorageHandler); });
    await click('重试保存玩法核心'); await wait(() => graph().nodes.find(n => n.title === '挑战关卡').description === '保存失败后保留的核心草稿', 'retry did not save');
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('write-markdown'); ipcMain.handle('write-markdown', (_event, payload) => { globalThis.coreMarkdown = payload; return '隔离测试导出'; }); });
    await click('生成 AI 文档'); const markdown = await app.evaluate(() => globalThis.coreMarkdown.content);
    for (const text of ['## 玩法核心', '开始游戏', '所有关卡完成并击败 Boss', design.title]) assert.ok(markdown.includes(text), text);
    // Deleting a connection source must clear linking rather than crashing the canvas.
    const originalNodes = graph().nodes.length;
    await add('活动', '临时连线起点'); await click('从此节点连线'); await click('删除节点');
    assert.equal(graph().nodes.length, originalNodes); assert.equal(await button('连接节点').isVisible(), true);
    await add('循环模块', '临时子循环'); await node('临时子循环').dblclick(); await add('活动', '子循环活动');
    await click('返回流程：挑战模式'); await node('临时子循环').click(); await click('删除节点');
    const removal = page.getByRole('dialog', { name: '删除循环模块？', exact: true });
    await removal.getByRole('button', { name: '取消', exact: true }).click(); assert.equal(read(a).graphs.length, 3);
    await click('删除节点'); await removal.getByRole('button', { name: '确认删除模块', exact: true }).click();
    assert.equal(read(a).graphs.length, 2); assert.equal(graph().nodes.length, originalNodes);
    // A conflict can reload the other writer's revision without replacing their changes.
    const external = read(a); external.graphs.find(g => g.id === graphId).summary = '另一个窗口保存的说明'; storage.setItem(key(a), JSON.stringify(external));
    await node('挑战关卡').click(); await field('节点说明').fill('尚未保存的冲突草稿'); await button('导出当前草稿').waitFor();
    assert.equal(read(a).graphs.find(g => g.id === graphId).summary, '另一个窗口保存的说明');
    const draftPath = path.join(dir, 'core-draft.json');
    await app.evaluate(({ session }, filename) => { session.defaultSession.once('will-download', (_event, item) => item.setSavePath(filename)); }, draftPath);
    await click('导出当前草稿');
    await wait(async () => { try { const backup = JSON.parse(await fs.readFile(draftPath, 'utf8')); return backup.graphs.some(g => g.nodes.some(n => n.description === '尚未保存的冲突草稿')); } catch { return false; } }, 'draft backup was not downloaded');
    await click('重新读取存档'); await wait(() => page.locator('.ps-trigger').isEnabled(), 'reload did not resolve conflict');
    await field('节点说明').fill('保存失败后保留的核心草稿'); assert.equal(graph().summary, '另一个窗口保存的说明');
    const savedA = storage.getItem(key(a));
    await chooseProject('核心项目B'); assert.equal(read(b), null); await add('入口', 'B独立入口'); assert.equal(storage.getItem(key(a)), savedA);
    await chooseProject('核心项目A'); await node('挑战模式').dblclick(); await node('挑战关卡').click(); assert.equal(await field('节点说明').inputValue(), '保存失败后保留的核心草稿');
    await app.close(); app = null; await launch(); await node('挑战模式').dblclick(); await node('挑战关卡').click();
    assert.equal(await field('节点说明').inputValue(), '保存失败后保留的核心草稿'); assert.equal(storage.getItem(key(a)), savedA);
    await click('适配画布'); await page.screenshot({ path: path.join(qaDir, 'gameplay-core-editor.png') });
    for (const exampleProject of projects.slice(2)) {
      await chooseProject(exampleProject.name); await click('适配画布');
      await page.screenshot({ path: path.join(qaDir, 'core-' + exampleProject.name.slice(3) + '.png') });
      const value = read(exampleProject.id), root = value.graphs.find(g => g.id === value.rootId), firstModule = root.nodes.find(n => n.kind === 'module');
      assert.ok(firstModule); await node(firstModule.title).dblclick();
      const child = value.graphs.find(g => g.id === firstModule.childGraphId); assert.ok(child.nodes.length); await node(child.nodes[0].title).waitFor();
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 850));
    await click('适配画布');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), 'page overflows the narrow viewport');
    await page.locator('main.core-workspace-page').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: path.join(qaDir, 'gameplay-core-narrow.png') });
    // Corrupt content must remain untouched and stop writes to this archive.
    await chooseProject('核心项目A'); await app.close(); app = null;
    const corrupt = '{"schema":99}'; storage.setItem(key(a), corrupt); await launch();
    assert.equal(await button('添加入口').isDisabled(), true); assert.equal(storage.getItem(key(a)), corrupt);
    assert.equal(await page.locator('.ps-trigger').isEnabled(), true); await chooseProject('核心项目B'); await node('B独立入口').waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS gameplay core: layered editing, branches/cycles/self-loop, links, drag, retry, AI export, project isolation/restart, examples, narrow viewport and corrupt archive protection.');
  } catch (error) {
    if (page && !page.isClosed()) { console.error((await page.locator('body').innerText()).slice(-10000)); await page.screenshot({ path: path.join(qaDir, 'gameplay-core-failure.png') }); }
    console.error('Renderer errors:', errors); throw error;
  } finally {
    if (app) await app.close();
    const target = path.resolve(dir); assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('gc-core-ui-'));
    await fs.rm(target, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
