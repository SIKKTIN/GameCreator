const { _electron } = require(process.env.GAMECREATOR_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { createWorkspaceStorage } = require('../desktop/test-workspaces.cjs');
const { createArtFiles } = require('../desktop/art-files.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const { createArtAsset, createArtRequirement, emptyArtAssets } = await import('../src/art-assets.ts');
  const { createPrototypeScene, createPrototypeElement, emptyPrototypeDesign } = await import('../src/prototype-design.ts');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-art-delete-')), data = path.join(dir, 'data'), storage = createWorkspaceStorage(data);
  const a = 'delete-project-a', b = 'delete-project-b', key = 'gamecreator.workspace.v1:' + a + ':art-assets';
  const config = { engine: 'oasis-lua', projectPath: '', enumPath: 'Script/Const', dataPath: 'Script/Config', outputFormat: 'lua', autoSync: false, backupBeforeSync: true };
  storage.setItem('gamecreator.projects.v1', JSON.stringify({ schema: 2, activeId: a, mode: 'project', projects: [{ id: a, name: '删除测试 A', config, initialContent: 'empty' }, { id: b, name: '删除测试 B', config, initialContent: 'empty' }] }));
  const unused = createArtAsset('未使用卡片'), linked = createArtAsset('需求使用中'), referenced = createArtAsset('原型使用中'), archived = createArtAsset('归档交付'), requirement = createArtRequirement('动画制作');
  archived.archived = true;
  const source = path.join(dir, 'retained.txt'); await fs.writeFile(source, 'Retain this delivery file after card deletion.');
  const files = createArtFiles(data), imported = await files.importFiles('project:' + a, [source]);
  archived.versions = [{ id: 'delivery', name: '交付一', notes: '', placeholder: true, review: '待审核', feedback: '', files: imported, createdAt: new Date().toISOString() }];
  const initial = { ...emptyArtAssets(), assets: [unused, linked, referenced, archived], requirements: [requirement], links: [{ id: 'used', requirementId: requirement.id, assetId: linked.id, note: '' }] };
  storage.setItem(key, JSON.stringify(initial)); const otherKey = 'gamecreator.workspace.v1:' + b + ':art-assets'; storage.setItem(otherKey, JSON.stringify(initial));
  const scene = createPrototypeScene('草坪'); scene.elements = [{ ...createPrototypeElement('image'), name: '植物头像', assetId: referenced.id }];
  const prototypeKey = 'gamecreator.workspace.v1:' + a + ':prototype-design', prototypeRaw = JSON.stringify({ ...emptyPrototypeDesign(), scenes: [scene], entryId: scene.id }); storage.setItem(prototypeKey, prototypeRaw);
  const env = { ...process.env, GAMECREATOR_DATA_DIR: data, GAMECREATOR_USER_DATA_DIR: path.join(dir, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
  let app, page; const errors = [], read = () => JSON.parse(storage.getItem(key));
  const button = name => page.getByRole('button', { name, exact: true }), field = name => page.getByLabel(name, { exact: true });
  const card = (name, kind = 'asset') => button('打开素材条目：'+name);
  const dialog = () => page.getByRole('dialog', { name: /^删除素材/ });
  async function launch() {
    app = await _electron.launch({ executablePath: require('electron'), args: [path.join(root, 'desktop/main.cjs')], env });
    page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1500, 980));
    await button('进入本地工作区').click(); await button('素材资产').click(); await button('查看全部内容').click();

  }
  async function ask(locator, kind = 'asset') {
    await locator.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '删除素材条目', exact: true }).click();
    await dialog().waitFor();
  }
  async function cancel() { await dialog().getByRole('button', { name: '取消', exact: true }).click(); }
  async function confirm() { await dialog().getByRole('button', { name: '确认删除', exact: true }).click(); await dialog().waitFor({ state: 'hidden' }); }
  try {
    await launch(); await card(unused.name).click(); const original = storage.getItem(key);
    await card(unused.name).click({ button: 'right' }); await page.getByRole('menu').waitFor(); await page.keyboard.press('Escape');
    await page.getByRole('menu').waitFor({ state: 'hidden' }); assert.equal(await card(unused.name).evaluate(e => e === document.activeElement), true);
    await card(unused.name).press('Shift+F10'); await page.getByRole('menuitem').click(); await cancel(); assert.equal(storage.getItem(key), original);
    await card(unused.name).click({ button: 'right' }); await page.getByRole('menu').waitFor(); await field('搜索素材内容').click(); await page.getByRole('menu').waitFor({ state: 'hidden' });

    // A right click acts on its own card, without replacing the detail selection.
    await ask(card(requirement.name)); assert.ok((await dialog().innerText()).includes('独占的交付资源'));
    assert.equal(await dialog().getByRole('button', { name: '确认删除', exact: true }).isDisabled(), false); await cancel();
    assert.equal(await field('资源名称').inputValue(), unused.name);
    await ask(card(referenced.name)); assert.ok((await dialog().innerText()).includes('原型设计 / 草坪 / 植物头像')); await cancel();

    await field('素材内容范围').selectOption('all'); await ask(card(archived.name)); assert.ok((await dialog().innerText()).includes('本地文件仍保留'));
    await fs.mkdir(path.join(root, '.gamecreator/qa'), { recursive: true }); await page.screenshot({ path: path.join(root, '.gamecreator/qa/art-card-delete-confirm.png') });
    await confirm(); assert.equal(await field('资源名称').inputValue(), unused.name); assert.ok(!read().assets.some(x => x.id === archived.id));
    assert.ok(await files.readBytes('project:' + a, imported[0].storagePath));

    // A failed write leaves both the card and detail intact; confirming again can retry.
    await ask(card(unused.name)); const saved = storage.getItem(key);
    await app.evaluate(({ ipcMain }, key) => {
      globalThis.deleteStorageHandler = ipcMain.listeners('workspace-storage')[0]; ipcMain.removeAllListeners('workspace-storage');
      ipcMain.on('workspace-storage', (event, request) => { if (request?.operation === 'set' && request.key === key) event.returnValue = { ok: false, error: '模拟删除写入失败' }; else globalThis.deleteStorageHandler(event, request); });
    }, key);
    await dialog().getByRole('button', { name: '确认删除', exact: true }).click(); await dialog().getByRole('alert').waitFor();
    assert.ok((await dialog().innerText()).includes('模拟删除写入失败')); assert.equal(storage.getItem(key), saved); assert.equal(await card(unused.name).count(), 1);
    await app.evaluate(({ ipcMain }) => { ipcMain.removeAllListeners('workspace-storage'); ipcMain.on('workspace-storage', globalThis.deleteStorageHandler); });
    await confirm(); assert.equal(await card(unused.name).count(), 0); assert.equal(await field('资源名称').count(), 0);

    // Search-result cards expose the same menu. Removing a requirement releases its asset.
    await button('素材分类').click(); await field('搜索全部素材内容').fill(requirement.name);
    await ask(page.locator('.ar-search-result'), 'requirement'); await confirm();
    assert.equal(read().requirements.length, 0); assert.equal(read().links.length, 0); assert.ok(!read().assets.some(x => x.id === linked.id));
    assert.equal(await page.locator('.ar-search-result').count(), 0);
    assert.deepEqual(read().assets.map(x => x.id), [referenced.id]);

    // A newly added card is immediately deletable, and concurrent archive changes are not overwritten.
    await button('新建素材条目').click(); const create = page.getByRole('dialog', { name: '新建素材条目', exact: true });
    await create.getByLabel('新素材名称').fill('刚加的卡片'); await create.getByRole('button', { name: '创建条目', exact: true }).click();
    await ask(card('刚加的卡片')); const beforeConflict = storage.getItem(key), concurrent = read(); concurrent.assets[0].description = '其他窗口的修改'; storage.setItem(key, JSON.stringify(concurrent));
    await dialog().getByRole('button', { name: '确认删除', exact: true }).click(); await dialog().getByRole('alert').waitFor();
    assert.ok((await dialog().innerText()).includes('其他窗口')); assert.equal(read().requirements.at(-1).name, '刚加的卡片');
    storage.setItem(key, beforeConflict); await confirm(); assert.equal(await card('刚加的卡片').count(), 0);
    const final = storage.getItem(key); assert.equal(storage.getItem(otherKey), JSON.stringify(initial)); assert.equal(storage.getItem(prototypeKey), prototypeRaw);
    await app.close(); app = null; await launch(); assert.equal(storage.getItem(key), final); await card(referenced.name).waitFor();
    assert.equal(await card(unused.name).count(), 0); assert.equal(await card('刚加的卡片').count(), 0); assert.deepEqual(errors, []);
    console.log('PASS art card deletion: context and keyboard menus, cancel, references, archived versions, files retained, write failure/retry, correct selection, search results, new cards, stale writes, project isolation and restart.');
  } catch (error) { if (page && !page.isClosed()) console.error((await page.locator('body').innerText()).slice(-6000)); throw error; }
  finally { if (app) await app.close(); assert.equal(path.dirname(dir), path.resolve(os.tmpdir())); assert.ok(path.basename(dir).startsWith('gc-art-delete-')); await fs.rm(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
