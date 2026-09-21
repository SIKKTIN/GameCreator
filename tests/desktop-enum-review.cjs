// Run after npm run build. Requires Playwright (GAMECREATOR_PLAYWRIGHT_PATH is supported).
const { _electron } = require(process.env.GAMECREATOR_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { createStorage } = require('../desktop/storage.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gamecreator-review-'));
  const profile = path.join(directory, 'profile'), dataDirectory = path.join(directory, 'data');
  const project = path.join(directory, 'project'), sourceFile = path.join(project, 'Script/Const/Const_Test.lua');
  await fs.mkdir(profile);
  await fs.mkdir(path.dirname(sourceFile), { recursive: true });
  const env = { ...process.env, GAMECREATOR_USER_DATA_DIR: profile, GAMECREATOR_DATA_DIR: dataDirectory };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  const launch = async () => {
    app = await _electron.launch({ executablePath: require('electron'), args: [path.join(root, 'desktop/main.cjs')], env });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: '进入本地工作区', exact: true }).click();
    return page;
  };
  try {
    const { scanConstDirectory } = await import(pathToFileURL(path.join(root, 'server/lua-enum-parser.mjs')));
    const { emptyStore, prepareScan, makeSnapshot, stageSnapshot, decideChanges, diffEnums, publishRelease } = await import(pathToFileURL(path.join(root, 'src/enum-versions.ts')));
    const { enumId, projectIdentity } = await import(pathToFileURL(path.join(root, 'src/data-model.ts')));
    const lua = (updated) => [
      'local Const_Test = {}',
      'Const_Test.Mode = {', updated ? ' A = 11,' : ' A = 1,', updated ? ' C = 3,' : ' B = 2,', '}',
      'Const_Test.Unchanged = {', ' KEEP = 7,', '}',
      updated ? 'Const_Test.New = {' : 'Const_Test.Old = {', ' VALUE = 8,', '}', 'return Const_Test',
    ].join('\n');
    await fs.writeFile(sourceFile, lua(false));
    const base = prepareScan(await scanConstDirectory(project, 'Script/Const'));
    const data = { columns: {}, datasets: {} };
    for (const table of ['items', 'characters', 'skills', 'economy', 'shop']) {
      data.columns[table] = [{ key: 'id', label: 'ID' }]; data.datasets[table] = [];
    }
    data.columns.items.push({key:'mode',label:'模式',type:'enum',enumId:enumId(base.groups.find(group=>group.name==='Const_Test.Mode'))});
    data.datasets.items.push({id:'item_1',mode:'B'});
    let store = stageSnapshot(emptyStore(data), await makeSnapshot(base,'source'));
    store = await publishRelease(decideChanges(store,diffEnums(null,base).map(change=>change.id),true,'admin'));
    const key = 'gamecreator.enum-versions.v1:' + projectIdentity(project);
    const storage = createStorage(path.join(dataDirectory,'storage'));
    storage.setItem(key, JSON.stringify(store));
    storage.setItem('gamecreator.engine-config.v1',JSON.stringify({engine:'oasis-lua',projectPath:project,enumPath:'Script/Const',dataPath:'Script/Config',outputFormat:'lua',autoSync:false,backupBeforeSync:true}));
    await fs.writeFile(sourceFile,lua(true));
    let page = await launch();
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.getByRole('button',{name:'枚举管理',exact:true}).click();
    assert.equal(await page.getByRole('tab',{name:'枚举更新检测',exact:true}).getAttribute('aria-selected'),'true');
    await page.getByRole('tab',{name:'外部导入',exact:true}).click();
    await page.getByRole('button',{name:'从工程导入',exact:true}).click();
    await page.getByText('5 项待审核差异',{exact:true}).waitFor();
    assert.equal(JSON.parse(storage.getItem(key)).activeId,store.activeId);
    await page.getByRole('button',{name:'前往更新检测',exact:true}).click();
    await page.getByRole('heading',{name:'Const_Test.Mode',exact:true}).waitFor();
    const panel=page.getByRole('tabpanel');
    assert.equal(await panel.locator('textarea').count(),0);
    assert.equal(await panel.locator('input:not([type=search])').count(),0);
    assert.equal(await panel.locator('.enum-change-item.added').count(),2);
    assert.equal(await panel.locator('.enum-change-item.removed').count(),2);
    assert.equal(await panel.locator('.enum-change-item.modified').count(),1);
    await page.getByRole('combobox',{name:'筛选变更'}).selectOption('modified');
    assert.equal(await panel.locator('.enum-change-item').count(),1);
    await page.getByRole('combobox',{name:'筛选变更'}).selectOption('all');
    await panel.getByRole('heading',{name:'Const_Test.Unchanged',exact:true}).waitFor();
    await page.getByRole('searchbox',{name:'搜索待审核枚举或成员'}).fill('B');
    assert.equal(await panel.locator('.enum-review-member').count(),1);
    await page.getByRole('searchbox',{name:'搜索待审核枚举或成员'}).fill('');
    await page.getByRole('combobox',{name:'筛选变更'}).selectOption('changes');
    await fs.mkdir(path.join(root,'.gamecreator/qa'),{recursive:true});
    await page.screenshot({path:path.join(root,'.gamecreator/qa/enum-review.png')});
    await page.getByRole('button',{name:'同意 Const_Test.Mode.B · 删除成员',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'同步已同意的变更',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'不同意 Const_Test.Mode.B · 删除成员',exact:true}).click();
    await page.getByRole('button',{name:'同意 Const_Test.Mode.C · 新增成员',exact:true}).click();
    await page.getByRole('button',{name:'同意 Const_Test.Mode.A · 修改值 / 类型',exact:true}).click();
    await page.getByRole('button',{name:'不同意 Const_Test.Old · 删除枚举组',exact:true}).click();
    assert.equal(JSON.parse(storage.getItem(key)).activeId,store.activeId);
    await page.waitForFunction(key => { const state=JSON.parse(window.desktopClient.storage.getItem(key)); const review=state.reviews[state.candidateId]; return review.selected.length===2 && review.declined.length===2; }, key);
    const decided=JSON.parse(storage.getItem(key));
    assert.equal(decided.reviews[decided.candidateId].selected.length,2);
    assert.equal(decided.reviews[decided.candidateId].declined.length,2);
    await app.close(); app=null;
    page=await launch();
    await page.getByRole('button',{name:'枚举管理',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'同意 Const_Test.Mode.A · 修改值 / 类型',exact:true}).getAttribute('aria-pressed'),'true');
    assert.equal(await page.getByRole('button',{name:'不同意 Const_Test.Mode.B · 删除成员',exact:true}).getAttribute('aria-pressed'),'true');
    await page.getByRole('button',{name:'同步已同意的变更',exact:true}).click();
    await page.getByText('已同步同意的变更，枚举定义已更新。',{exact:true}).waitFor();
    const synced=JSON.parse(storage.getItem(key));
    const active=synced.snapshots.find(snapshot=>snapshot.id===synced.activeId);
    assert.deepEqual(active.scan.groups.find(group=>group.name==='Const_Test.Mode').members.map(member=>[member.key,member.value]),[['A',11],['B',2],['C',3]]);
    assert.ok(active.scan.groups.some(group=>group.name==='Const_Test.Old'));
    assert.ok(!active.scan.groups.some(group=>group.name==='Const_Test.New'));
    assert.equal(synced.data.datasets.items[0].mode,'B');
    assert.equal(synced.releases.at(-1).reviewer,'本地');
    await page.getByRole('button',{name:'检测更新',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.enum-update-panel > .enum-catalog-heading button')?.disabled);
    assert.equal(await page.getByRole('button',{name:'不同意 Const_Test.Mode.B · 删除成员',exact:true}).getAttribute('aria-pressed'),'true');
    await page.getByRole('button',{name:'数据配置',exact:true}).click();
    await page.getByRole('combobox',{name:'item_1 · 模式',exact:true}).selectOption('A');
    await page.getByRole('button',{name:'枚举管理',exact:true}).click();
    await page.getByRole('button',{name:'同意 Const_Test.Mode.B · 删除成员',exact:true}).click();
    await page.getByRole('button',{name:'同步已同意的变更',exact:true}).click();
    await page.getByText('已同步同意的变更，枚举定义已更新。',{exact:true}).waitFor();
    await page.getByRole('button',{name:'枚举定义',exact:true}).click();
    const catalog=page.getByRole('region',{name:'枚举定义目录'});
    assert.equal(await catalog.locator('code').filter({hasText:/^B$/}).count(),0);
    assert.equal(await catalog.locator('code').filter({hasText:/^C$/}).count(),1);
    assert.deepEqual(errors,[]);
    console.log('PASS: internal tabs; external Lua import; readonly colored diffs; search/filters; persisted decisions; partial sync; retained rejections; blocked deletion; references resolved outside review; definitions updated only after sync.');
  } finally {
    if(app)await app.close();
    await fs.rm(directory,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
