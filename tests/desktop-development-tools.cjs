const { _electron } = require(process.env.GAMECREATOR_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { createWorkspaceStorage } = require('../desktop/test-workspaces.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const { preparePrototypeProject, writePrototypeProject } = await import('../src/prototype-import.ts');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-tools-ui-')), storage = createWorkspaceStorage(path.join(dir, 'data'));
  const example = JSON.parse(await fs.readFile(path.join(root, 'examples/prototypes/plants-vs-zombies.json'), 'utf8'));
  const p = preparePrototypeProject({ schema: 2, projects: [], activeId: '', mode: 'project' }, example, '旧植物原型工具验收'); writePrototypeProject(storage, p);
  const key = 'gamecreator.workspace.v1:' + p.project.id + ':development-tools', scheduleKey = 'gamecreator.workspace.v1:' + p.project.id + ':project-schedule';
  const read = () => JSON.parse(storage.getItem(key)), readSchedule = () => JSON.parse(storage.getItem(scheduleKey));
  const plan = JSON.parse(await fs.readFile(path.join(root, 'examples/development-tools/plants-vs-zombies.json'), 'utf8'));
  const old = readSchedule(); old.tasks = old.tasks.filter(t => !plan.schedule.tasks.some(x => x.id === t.id)); old.tasks.forEach(t => { t.dependencyIds = t.dependencyIds.filter(id => old.tasks.some(x => x.id === id)); }); old.milestones = old.milestones.filter(m => !plan.schedule.milestones.some(x => x.id === m.id));
  old.tasks[0].status = '已完成'; old.tasks[0].result = '用户原有验收记录';
  storage.setItem(scheduleKey, JSON.stringify(old)); storage.setItem(key, JSON.stringify({ schema: 1, tools: [] }));
  const second = { ...p.project, id: 'tools-other', name: '其他空白项目' }; p.catalog.projects.push(second); storage.setItem('gamecreator.projects.v1', JSON.stringify(p.catalog));
  const env = { ...process.env, GAMECREATOR_DATA_DIR: path.join(dir, 'data'), GAMECREATOR_USER_DATA_DIR: path.join(dir, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page; const errors = [];
  const button = name => page.getByRole('button', { name, exact: true }), field = name => page.getByLabel(name, { exact: true });
  const tab = name => page.getByRole('tab', { name, exact: true });
  async function launch() {
    app = await _electron.launch({ executablePath: require('electron'), args: [path.join(root, 'desktop/main.cjs')], env }); page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1580, 1080)); await button('进入本地工作区').click(); await button('开发工具').click();
  }
  async function create(name) { await button('新建开发工具').click(); const modal = page.getByRole('dialog', { name: '新建开发工具', exact: true }); await modal.getByLabel('工具名称', { exact: true }).fill(name); await modal.getByRole('button', { name: '创建工具', exact: true }).click(); await modal.waitFor({ state: 'hidden' }); }
  try {
    await launch(); const navigation = await page.getByRole('navigation', { name: '工作区模块', exact: true }).getByRole('button').allTextContents(); assert.equal(navigation[navigation.indexOf('功能系统') + 1], '开发工具');
    assert.equal(read().tools.length, 0); assert.deepEqual(readSchedule(), old);
    await button('补充工具与排期').click(); assert.equal(read().tools.length, 3); assert.equal(readSchedule().tasks.length, 18); assert.deepEqual(readSchedule().tasks.slice(0, 12), old.tasks);
    assert.ok(readSchedule().tasks.slice(12).every(t => !t.start && !t.end)); await button('补充工具与排期').click(); assert.equal(readSchedule().tasks.length, 18);
    await button('选择开发工具：骨骼动画预览工具').click(); assert.ok((await field('功能范围').inputValue()).includes('逐帧')); await tab('交付与验收').click(); assert.ok((await field('验收标准').inputValue()).includes('豌豆射手'));
    await tab('开发排期').click(); assert.equal(await page.locator('.dt-task').count(), 4); await page.locator('.dt-task').filter({ hasText: '开发骨骼动画预览工具' }).click();
    const detail = page.getByRole('dialog', { name: '制作任务详情', exact: true }); assert.equal(await detail.getByLabel('制作任务名称', { exact: true }).inputValue(), '开发骨骼动画预览工具');
    await detail.getByRole('button').filter({ hasText: '开发工具 / 骨骼动画预览工具' }).click(); assert.equal(await field('工具名称').inputValue(), '骨骼动画预览工具');
    await field('工具状态').selectOption('开发中'); assert.equal(readSchedule().tasks.find(t => t.title === '开发骨骼动画预览工具').status, '待开始');
    await fs.mkdir(path.join(root, '.gamecreator/qa'), { recursive: true }); await page.screenshot({ path: path.join(root, '.gamecreator/qa/development-tools.png') });
    await button('删除').click(); await page.getByRole('status').filter({ hasText: '工具仍有关联排期' }).waitFor(); assert.equal(read().tools.length, 3);
    await create('资源校验助手'); await field('工具负责人').fill('工具程序'); await field('用途与目标').fill('统一检查资源命名'); await tab('交付与验收').click(); await field('验收标准').fill('异常资源可定位并导出问题清单'); await tab('开发排期').click(); await button('添加制作任务').click();
    assert.equal(await detail.getByLabel('制作任务名称', { exact: true }).inputValue(), '开发：资源校验助手'); assert.equal(await detail.getByLabel('任务负责人', { exact: true }).inputValue(), '工具程序'); await detail.getByLabel('制作状态', { exact: true }).selectOption('已完成');
    await detail.getByRole('button').filter({ hasText: '开发工具 / 资源校验助手' }).click(); assert.equal(await field('工具状态').inputValue(), '可使用');
    await button('归档').click(); await field('开发工具显示范围').selectOption('archived'); await button('选择开发工具：资源校验助手').click(); await button('恢复').click(); await field('开发工具显示范围').selectOption('active');
    await create('可删除的临时工具'); await button('选择开发工具：可删除的临时工具').click({ button: 'right' }); await page.getByRole('menuitem', { name: '删除工具', exact: true }).click(); assert.ok(!read().tools.some(t => t.name === '可删除的临时工具'));
    await page.keyboard.press('Control+k'); await field('搜索当前项目').fill('资源校验助手'); await button('打开搜索结果：资源校验助手').click(); assert.equal(await field('工具名称').inputValue(), '资源校验助手'); await page.getByRole('button', { name: /返回搜索结果/ }).click(); assert.equal(await field('搜索当前项目').inputValue(), '资源校验助手');
    await button('开发工具').click(); assert.equal(await page.getByRole('button', { name: /返回搜索结果/ }).count(), 0); await button('选择开发工具：资源校验助手').click();
    const saved = storage.getItem(key);
    await app.evaluate(({ ipcMain }, key) => { globalThis.toolsStorageHandler = ipcMain.listeners('workspace-storage')[0]; ipcMain.removeAllListeners('workspace-storage'); ipcMain.on('workspace-storage', (e, request) => { if (request?.operation === 'set' && request.key === key) e.returnValue = { ok: false, error: '模拟工具保存失败' }; else globalThis.toolsStorageHandler(e, request); }); }, key);
    await field('工具负责人').fill('保留失败草稿'); await button('重试保存开发工具').waitFor(); assert.equal(storage.getItem(key), saved); assert.ok(await page.locator('.ps-trigger').isDisabled());
    await app.evaluate(({ ipcMain }) => { ipcMain.removeAllListeners('workspace-storage'); ipcMain.on('workspace-storage', globalThis.toolsStorageHandler); }); await button('重试保存开发工具').click(); assert.equal(read().tools.find(t => t.name === '资源校验助手').owner, '保留失败草稿');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 900)); assert.ok(await page.locator('.dt-page').evaluate(e => e.scrollWidth <= e.clientWidth + 2)); await page.screenshot({ path: path.join(root, '.gamecreator/qa/development-tools-narrow.png') });
    const final = storage.getItem(key); await app.close(); app = null; await launch(); await button('选择开发工具：资源校验助手').click(); assert.equal(await field('工具负责人').inputValue(), '保留失败草稿'); assert.equal(storage.getItem(key), final);
    await page.locator('.ps-trigger').click(); await page.getByRole('menuitemradio', { name: /其他空白项目/ }).click(); await button('开发工具').click(); assert.equal(await page.locator('.dt-card').count(), 0); assert.equal(storage.getItem('gamecreator.workspace.v1:' + second.id + ':development-tools'), null); assert.equal(storage.getItem(key), final); assert.deepEqual(errors, []);
    console.log('PASS development tools: sidebar order, safe/idempotent old-project supplement, editable requirements, schedule creation/navigation, linked acceptance, archive/restore/context deletion, search return, failed-save recovery, restart and project isolation.');
  } catch (error) { if (page && !page.isClosed()) console.error((await page.locator('body').innerText()).slice(-6500)); throw error; }
  finally { if (app) await app.close(); assert.equal(path.dirname(dir), path.resolve(os.tmpdir())); await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
