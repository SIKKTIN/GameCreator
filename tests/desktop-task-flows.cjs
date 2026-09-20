// Isolated Electron acceptance; only temporary project storage and profile are used.
const { _electron } = require(process.env.GAMECREATOR_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { createWorkspaceStorage } = require('../desktop/test-workspaces.cjs');
(async () => {
  const root = path.resolve(__dirname, '..'), dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-task-ui-'));
  const storage = createWorkspaceStorage(path.join(dir, 'data')), a = 'project-' + crypto.randomUUID(), b = 'project-' + crypto.randomUUID();
  const key = id => 'gamecreator.workspace.v1:' + id + ':task-flows';
  const config = { engine: 'oasis-lua', projectPath: '', enumPath: 'Script/Const', dataPath: 'Script/Config', outputFormat: 'lua', autoSync: false, backupBeforeSync: true };
  let catalog = { schema: 2, activeId: a, mode: 'project', projects: [{ id: a, name: '任务项目A', config, initialContent: 'empty' }, { id: b, name: '任务项目B', config, initialContent: 'empty' }] };
  const { preparePrototypeProject, writePrototypeProject } = await import('../src/prototype-import.ts');
  const examples = [];
  for (const slug of ['hollow-knight', 'stardew-valley', 'plants-vs-zombies', 'disco-elysium', 'vampire-survivors']) {
    const example = JSON.parse(await fs.readFile(path.join(root, 'examples/prototypes', slug + '.json'), 'utf8'));
    const p = preparePrototypeProject(catalog, example, 'QA ' + slug); writePrototypeProject(storage, p); catalog = p.catalog; examples.push({ slug, project: p.project, example });
  }
  catalog.activeId = a; storage.setItem('gamecreator.projects.v1', JSON.stringify(catalog));
  const env = { ...process.env, GAMECREATOR_DATA_DIR: path.join(dir, 'data'), GAMECREATOR_USER_DATA_DIR: path.join(dir, 'profile'), GAMECREATOR_TEAM_DATA_DIR: path.join(dir, 'team') }; delete env.ELECTRON_RUN_AS_NODE;
  const qa = path.join(root, '.gamecreator', 'qa'); await fs.mkdir(qa, { recursive: true });
  let app, page; const errors = [];
  const button = name => page.getByRole('button', { name, exact: true }), click = name => button(name).click(), field = name => page.getByLabel(name, { exact: true });
  const read = id => JSON.parse(storage.getItem(key(id)) || 'null');
  async function launch() {
    app = await _electron.launch({ executablePath: require('electron'), args: [path.join(root, 'desktop/main.cjs')], env });
    page = await app.firstWindow(); page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
    await click('进入本地工作区'); await page.locator('.ps-trigger').waitFor(); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1550, 1050)); await click('任务与流程');
  }
  async function choose(name) { await page.locator('.ps-trigger').click(); await page.getByRole('menuitemradio').filter({ hasText: name }).click(); await click('任务与流程'); }
  async function create(name) { await click('新建任务'); await field('新任务名称').fill(name); await click('创建任务'); await field('任务名称').waitFor(); }
  try {
    await launch(); assert.equal(read(a), null, 'visiting an old project must not create task storage');
    await create('提交三枚晶石'); await field('任务说明').fill('验证采集、提交、分支与一次性奖励');
    await click('阶段与分支'); await click('添加目标阶段'); await field('阶段名称').fill('收集晶石'); await click('添加目标');
    await field('目标名称 1').fill('可用晶石'); await field('目标数量 1').fill('3'); await field('达成条件 1').fill('背包中当前可交付的晶石，消耗后数量回退');
    await click('添加成功结果'); await field('阶段名称').fill('交付完成'); await field('完成结果').fill('扣除三枚晶石，奖励仅结算一次');
    const t = () => read(a).tasks[0]; const success = t().stages.find(s => s.kind === 'success');
    await click('编辑阶段：收集晶石'); await click('添加分支'); await field('分支名称 1').fill('确认交付'); await field('目标阶段 1').selectOption(success.id); await field('分支条件 1').fill('玩家选择交付且背包数量足够');
    const saved = storage.getItem(key(a)); await click('流程与预览'); await click('开始预览');
    const advance = button('确认交付 → 交付完成'); assert.equal(await advance.isDisabled(), true);
    await field('模拟进度：可用晶石').fill('2'); assert.equal(await advance.isDisabled(), true);
    await field('模拟进度：可用晶石').fill('3'); assert.equal(await advance.isDisabled(), true);
    await page.getByLabel('假定条件满足：玩家选择交付且背包数量足够', { exact: true }).check(); await advance.click(); await page.getByText('模拟成功结果', { exact: true }).waitFor();
    assert.equal(storage.getItem(key(a)), saved); await click('返回上一步'); assert.equal(await field('模拟进度：可用晶石').inputValue(), '3');
    await page.screenshot({ path: path.join(qa, 'task-flows-preview.png'), fullPage: true });
    await click('任务设置'); await click('复制任务'); assert.equal(read(a).tasks.length, 2); await click('归档任务'); assert.equal(await field('任务名称').isDisabled(), true); await click('恢复任务'); assert.equal(await field('任务名称').isEnabled(), true);
    await click('选择任务：提交三枚晶石');
    const committed = storage.getItem(key(a));
    await app.evaluate(({ ipcMain }, storageKey) => { const original = ipcMain.listeners('workspace-storage')[0]; globalThis.taskStorageHandler = original; ipcMain.removeAllListeners('workspace-storage'); ipcMain.on('workspace-storage', (event, request) => {
      if (request.operation === 'set' && request.key === storageKey) event.returnValue = { ok: false, error: '模拟磁盘写入失败' }; else original(event, request);
    }); }, key(a));
    await field('任务说明').fill('保存失败后保留任务草稿'); await button('重试保存任务与流程').waitFor(); assert.equal(storage.getItem(key(a)), committed);
    assert.equal(await page.locator('.ps-trigger').isDisabled(), true); assert.equal(await button('生成 AI 文档').isDisabled(), true); await click('返回启动页'); assert.equal(await field('任务说明').inputValue(), '保存失败后保留任务草稿');
    await app.evaluate(({ ipcMain }) => { ipcMain.removeAllListeners('workspace-storage'); ipcMain.on('workspace-storage', globalThis.taskStorageHandler); }); await click('重试保存任务与流程'); assert.equal(t().summary, '保存失败后保留任务草稿');
    const external = read(a); external.tasks[0].summary = '其他窗口的更新'; storage.setItem(key(a), JSON.stringify(external)); await field('任务说明').fill('冲突草稿'); await button('导出任务草稿').waitFor(); assert.equal(read(a).tasks[0].summary, '其他窗口的更新');
    const draftPath = path.join(dir, 'task-draft.json'); await app.evaluate(({ session }, filename) => { session.defaultSession.once('will-download', (_event, item) => item.setSavePath(filename)); }, draftPath);
    await click('导出任务草稿');
    const until = Date.now() + 10000; while (true) { try { assert.equal(JSON.parse(await fs.readFile(draftPath, 'utf8')).tasks[0].summary, '冲突草稿'); break; } catch (error) { if (Date.now() > until) throw error; await new Promise(r => setTimeout(r, 50)); } }
    await click('重新读取任务存档'); assert.equal(await field('任务说明').inputValue(), '其他窗口的更新');
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('write-markdown'); ipcMain.handle('write-markdown', (_event, payload) => { globalThis.taskMarkdown = payload.content; return '测试导出'; }); });
    await click('生成 AI 文档'); assert.ok((await app.evaluate(() => globalThis.taskMarkdown)).includes('扣除三枚晶石'));
    const beforeSwitch = storage.getItem(key(a)); await choose('任务项目B'); assert.equal(read(b), null); await create('B独立目标'); assert.equal(storage.getItem(key(a)), beforeSwitch);
    await choose('任务项目A'); await click('选择任务：提交三枚晶石'); assert.equal(await field('任务说明').inputValue(), '其他窗口的更新');
    await app.close(); app = null; await launch(); await click('选择任务：提交三枚晶石'); assert.equal(await field('任务说明').inputValue(), '其他窗口的更新'); assert.equal(storage.getItem(key(a)), beforeSwitch);
    for (const { slug, project, example } of examples) {
      await choose(project.name); assert.deepEqual(read(project.id), example.taskFlows);
      await click('选择任务：' + example.taskFlows.tasks[0].title); await click('任务设置');
      const ref = page.locator('.tf-reference .tf-link').first(); const refName = await ref.innerText(); await ref.click(); await page.getByRole('textbox', { name: '玩法名称', exact: true }).waitFor(); assert.ok(refName.includes(await page.getByRole('textbox', { name: '玩法名称', exact: true }).inputValue()));
      await click('任务与流程'); await click('流程与预览'); await page.locator('.local-workspace > main').evaluate(el => { el.scrollTop = 0; }); await page.screenshot({ path: path.join(qa, 'tasks-' + slug + '.png'), fullPage: true });
      assert.equal(await page.locator('.tf-graph-node').count(), example.taskFlows.tasks[0].stages.length);
    }
    // Exercise farm ANY objectives and timeout branch, and cross-task prerequisites in the knight example.
    const farm = examples.find(e => e.slug === 'stardew-valley'); await choose(farm.project.name); await click('选择任务：阿禾的三颗萝卜'); await click('流程与预览');
    await field('假定开放条件已满足').check(); await click('开始预览'); await field('模拟进度：委托期限结束').fill('1'); await field('假定条件满足：第7日结算开始且尚未提交').check(); await click('到期结束 → 本轮未完成'); await page.getByText('模拟失败结果', { exact: true }).waitFor();
    const knight = examples.find(e => e.slug === 'hollow-knight'); await choose(knight.project.name); await click('选择任务：打开裂隙近路'); await click('任务设置'); await field('添加前置任务').selectOption('hk-task-boss'); assert.equal(read(knight.project.id).tasks[1].prerequisiteIds.length, 2);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 850)); await click('阶段与分支'); await page.locator('.local-workspace > main').evaluate(el => { el.scrollTop = 0; }); await page.screenshot({ path: path.join(qa, 'task-flows-narrow.png'), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'task editor must fit a narrow viewport');
    assert.ok(await page.locator('.tf-workspace').evaluate(el => { const library = el.querySelector('.gp-library').getBoundingClientRect(), detail = el.querySelector('.gp-detail').getBoundingClientRect(); return library.right <= detail.left + 1 || library.bottom <= detail.top + 1; }), 'task library must not overlap the editor');
    await choose('任务项目A'); await app.close(); app = null; const corrupt = '{"schema":99}'; storage.setItem(key(a), corrupt); await launch(); assert.equal(await button('新建任务').isDisabled(), true); assert.equal(storage.getItem(key(a)), corrupt); assert.equal(await page.locator('.ps-trigger').isEnabled(), true); await choose('任务项目B'); await button('选择任务：B独立目标').waitFor();
    assert.deepEqual(errors, []); console.log('PASS task flows: editing, counts, branches, success/failure preview, references, copies/archive, save failure/conflict recovery, AI export, isolation/restart, five examples, narrow layout and corrupt storage.');
  } catch (error) { if (page && !page.isClosed()) { console.error((await page.locator('body').innerText()).slice(-7000)); await page.screenshot({ path: path.join(qa, 'task-flows-failure.png'), fullPage: true }); } throw error; }
  finally { if (app) await app.close(); assert.equal(path.dirname(dir), path.resolve(os.tmpdir())); assert.ok(path.basename(dir).startsWith('gc-task-ui-')); await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
