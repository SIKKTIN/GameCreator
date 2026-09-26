const { _electron } = require(process.env.GAMECREATOR_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { createWorkspaceStorage } = require('../desktop/test-workspaces.cjs');
const { createArtFiles } = require('../desktop/art-files.cjs');
const { createEngineSync } = require('../desktop/engine-sync.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-binding-ui-')), data = path.join(dir, 'data'), engine = path.join(dir, 'engine');
  await fs.mkdir(engine); await fs.writeFile(path.join(engine, 'project.godot'), 'config_version=5');
  const config = { engine: 'godot-gdscript', projectPath: engine, enumPath: '.', dataPath: 'data/generated', outputFormat: 'json', autoSync: false, backupBeforeSync: true };
  const storage = createWorkspaceStorage(data), currentId = 'project-new-ui', oldId = 'project-old-ui';
  storage.setItem('gamecreator.projects.v1', JSON.stringify({ schema: 2, activeId: currentId, mode: 'project', projects: [{ id: currentId, name: '迁移后的植物原型', config, initialContent: 'empty' }] }));
  const api = createEngineSync({ artFiles: createArtFiles(data) });
  const old = { projectId: oldId, config, settings: { documents: true, assets: false, includePlaceholders: true, docsDirectory: 'docs/gamecreator', assetsDirectory: 'assets/gamecreator', modules: ['gameplay'] }, document: { projectName: '旧原型', version: 'v1', generatedAt: '', sections: [{ id: 'gameplay', label: '玩法设计', body: '以前的玩法文档' }] }, art: { assets: [] } };
  const initialPlan = await api.preview(old); await api.apply({ token: initialPlan.token });
  const manifestPath = path.join(engine, '.gamecreator-sync/manifest.json'), originalRaw = await fs.readFile(manifestPath, 'utf8'), original = JSON.parse(originalRaw);
  const documentPath = path.join(engine, 'docs/gamecreator/modules/gameplay/gameplay.md'); await fs.writeFile(documentPath, 'engine-side manual changes');
  const env = { ...process.env, GAMECREATOR_DATA_DIR: data, GAMECREATOR_USER_DATA_DIR: path.join(dir, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page; const errors = [];
  const button = name => page.getByRole('button', { name, exact: true }), tab = name => page.getByRole('tab', { name, exact: true });
  const confirmation = () => page.getByRole('dialog', { name: '确认重新绑定工程', exact: true });
  async function launch() {
    app = await _electron.launch({ executablePath: require('electron'), args: [path.join(root, 'desktop/main.cjs')], env });
    page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 1050));
    await button('进入本地工作区').click(); await button('工程同步').click(); await tab('同步配置').click();
  }
  try {
    await launch(); await page.getByRole('region', { name: '工程同步归属冲突' }).waitFor();
    assert.equal(await fs.readFile(manifestPath, 'utf8'), originalRaw);
    assert.equal(await button('预览同步变更').isDisabled(), true);
    await button('重新绑定到当前项目').click(); const text = await confirmation().innerText();
    assert.ok(text.includes(oldId) && text.includes(currentId)); assert.ok(text.includes(engine));
    await confirmation().getByRole('button', { name: '取消', exact: true }).click(); assert.equal(await fs.readFile(manifestPath, 'utf8'), originalRaw);
    await button('重新绑定到当前项目').click(); await page.keyboard.press('Escape'); await confirmation().waitFor({ state: 'hidden' });

    // Review is stale after any external manifest edit, including changes made while the dialog is open.
    await button('重新绑定到当前项目').click(); await fs.writeFile(manifestPath, originalRaw + '\n');
    await confirmation().getByRole('button', { name: '备份并重新绑定', exact: true }).click();
    await confirmation().getByRole('alert').waitFor(); assert.match(await confirmation().innerText(), /同步记录已改变/);
    assert.equal(JSON.parse(await fs.readFile(manifestPath, 'utf8')).projectId, oldId);
    assert.equal((await confirmation().innerText()).includes('Error invoking remote method'), false);
    await confirmation().getByRole('button', { name: '取消', exact: true }).click(); await button('重新检查归属').click();
    await button('重新绑定到当前项目').click();
    await fs.mkdir(path.join(root, '.gamecreator/qa'), { recursive: true }); await page.screenshot({ path: path.join(root, '.gamecreator/qa/engine-rebind-confirm.png') });
    await confirmation().getByRole('button', { name: '备份并重新绑定', exact: true }).click(); await confirmation().waitFor({ state: 'hidden' });
    await page.getByRole('region', { name: '工程同步归属冲突' }).waitFor({ state: 'hidden' });
    const rebound = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert.equal(rebound.projectId, currentId); assert.deepEqual(rebound.files, original.files); assert.deepEqual(rebound.history.slice(1), original.history);
    assert.equal(await fs.readFile(path.join(rebound.history[0].backupDirectory, 'before-manifest.json'), 'utf8'), originalRaw + '\n');
    assert.equal(await fs.readFile(documentPath, 'utf8'), 'engine-side manual changes');
    await button('预览同步变更').click(); await page.locator('.es-summary').waitFor();
    await page.getByLabel('冲突处理 docs/gamecreator/modules/gameplay/gameplay.md', { exact: true }).waitFor();
    assert.equal(await button('同步到工程').isDisabled(), true);
    await tab('同步记录').click(); await page.getByText('已重新绑定', { exact: true }).waitFor();
    assert.equal(await fs.readFile(documentPath, 'utf8'), 'engine-side manual changes');

    // Restart retains ownership; an engine mismatch provides an explanation and never offers takeover.
    await app.close(); app = null; await launch(); await button('预览同步变更').waitFor();
    assert.equal(await button('重新绑定到当前项目').count(), 0);
    await app.close(); app = null; const mismatch = { ...rebound, engine: 'oasis-lua' }; await fs.writeFile(manifestPath, JSON.stringify(mismatch));
    await launch(); await page.getByText('此工程的同步记录使用另一种引擎', { exact: true }).waitFor();
    assert.equal(await button('重新绑定到当前项目').count(), 0); assert.equal(await button('预览同步变更').isDisabled(), true);
    assert.equal(await fs.readFile(manifestPath, 'utf8'), JSON.stringify(mismatch)); assert.deepEqual(errors, []);
    console.log('PASS engine binding UI: migration detection, old/new owners, cancel/Escape, stale review, backup, exact file/history preservation, manual conflicts, restart and incompatible engine protection.');
  } catch (error) { if (page && !page.isClosed()) console.error((await page.locator('body').innerText()).slice(-7000)); throw error; }
  finally { if (app) await app.close(); assert.equal(path.dirname(dir), path.resolve(os.tmpdir())); assert.ok(path.basename(dir).startsWith('gc-binding-ui-')); await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
