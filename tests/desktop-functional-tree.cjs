// Run after npm run build. Uses isolated project archives and a separate Electron profile.
const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),{createWorkspaceStorage}=require('../desktop/test-workspaces.cjs');
(async()=>{
 const example=JSON.parse(await fs.readFile(path.join(root,'examples/prototypes/hollow-knight.json'),'utf8'));
 const {emptyStore}=await import('../src/enum-versions.ts');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-functional-tree-')),storage=createWorkspaceStorage(path.join(dir,'data'));
 const cfg={engine:'oasis-lua',projectPath:'',enumPath:'Script/Const',dataPath:'Script/Config',outputFormat:'lua',autoSync:false,backupBeforeSync:true};
 const ids=['project-tree-a','project-tree-b'],key=(id,s)=>'gamecreator.workspace.v1:'+id+':'+s;
 for(const id of ids){for(const [s,v]of Object.entries({'functional-systems':example.functionalSystems,gameplay:example.gameplay,definitions:example.definitions}))storage.setItem(key(id,s),JSON.stringify(v));storage.setItem('gamecreator.enum-versions.v1:'+id,JSON.stringify(emptyStore(example.data)));}
 storage.setItem('gamecreator.projects.v1',JSON.stringify({schema:2,activeId:ids[0],mode:'project',projects:ids.map((id,i)=>({id,name:'目录测试'+i,config:cfg,initialContent:'empty'}))}));
 const env={...process.env,GAMECREATOR_DATA_DIR:path.join(dir,'data'),GAMECREATOR_USER_DATA_DIR:path.join(dir,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 let app,page;const errors=[],btn=name=>page.getByRole('button',{name,exact:true}),visibleCaps=()=>page.locator('.fs-tree-capability:visible').count(),tree=()=>page.locator('.fs-tree');
 const original=storage.getItem(key(ids[0],'functional-systems'));
 async function launch(){app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,1000));await btn('登录').click();await btn('功能系统').click();await tree().waitFor();}
 async function project(i){await page.locator('.ps-trigger').click();await page.getByRole('menuitemradio',{name:new RegExp('^目录测试'+i)}).click();await btn('功能系统').click();}
 try{
  await launch();assert.equal(await visibleCaps(),17);assert.equal(storage.getItem(key(ids[0],'functional-view')),null);
  await btn('收起系统：玩家能力系统').focus();await page.keyboard.press('Enter');assert.equal(await visibleCaps(),14);assert.equal(await btn('展开系统：玩家能力系统').getAttribute('aria-expanded'),'false');
  await btn('打开系统：玩家能力系统').click();assert.equal(await page.getByLabel('系统名称',{exact:true}).inputValue(),'玩家能力系统');assert.equal(await visibleCaps(),14);
  await btn('查看功能：玩家冲刺').click();await btn('打开功能：玩家冲刺').waitFor();assert.equal(await btn('收起系统：玩家能力系统').getAttribute('aria-expanded'),'true');
  await btn('全部收起').click();assert.equal(await visibleCaps(),0);assert.equal(await page.getByLabel('功能名称',{exact:true}).inputValue(),'玩家冲刺');
  const collapsed=storage.getItem(key(ids[0],'functional-view'));
  await page.getByLabel('搜索系统或功能').fill('首领跃砸与冲击波');assert.equal(await visibleCaps(),1);assert.equal(await btn('全部收起').isDisabled(),true);assert.equal(storage.getItem(key(ids[0],'functional-view')),collapsed);
  await page.getByLabel('搜索系统或功能').fill('');assert.equal(await visibleCaps(),0);
  await page.getByLabel('实现状态筛选').selectOption('待开发');assert.equal(await visibleCaps(),17);await page.getByLabel('实现状态筛选').selectOption('all');assert.equal(await visibleCaps(),0);
  await btn('玩法设计').click();await btn('进入分类：'+example.gameplay.categories.find(c=>c.id===example.gameplay.designs[0].categoryId).name).click();await page.locator('.gl-document-card .gp-list-card').first().click();const link=page.locator('.fs-usages .fs-reference-heading .gp-link-name').first();const label=await link.innerText();const cap=example.functionalSystems.capabilities.find(c=>label.trim().endsWith(c.name));assert.ok(cap,label);await link.click();await tree().waitFor();const owner=example.functionalSystems.systems.find(s=>s.id===cap.systemId);assert.equal(await btn('收起系统：'+owner.name).getAttribute('aria-expanded'),'true');assert.equal(await btn('打开功能：'+cap.name).isVisible(),true);
  await btn('全部收起').click();await btn('打开系统：输入系统').click();await project(1);assert.equal(await visibleCaps(),17);assert.equal(storage.getItem(key(ids[1],'functional-view')),null);await project(0);assert.equal(await visibleCaps(),0);
  await fs.mkdir(path.join(root,'.gamecreator/qa'),{recursive:true});await page.locator('.fs-workspace').screenshot({path:path.join(root,'.gamecreator/qa/functional-tree-collapsed.png')});
  await app.close();app=null;await launch();assert.equal(await visibleCaps(),0);
  await btn('全部展开').click();assert.equal(await visibleCaps(),17);assert.equal(storage.getItem(key(ids[0],'functional-systems')),original);
  await app.evaluate(({ipcMain},key)=>{globalThis.viewHandler=ipcMain.listeners('workspace-storage')[0];ipcMain.removeAllListeners('workspace-storage');ipcMain.on('workspace-storage',(event,r)=>{if(r?.operation==='set'&&r.key===key)event.returnValue={ok:false,error:'QA preference failure'};else globalThis.viewHandler(event,r);});},key(ids[0],'functional-view'));
  await btn('全部收起').click();assert.equal(await visibleCaps(),0);await page.locator('.fs-view-note').waitFor();assert.equal(await page.locator('.ps-trigger').isDisabled(),false);assert.equal(storage.getItem(key(ids[0],'functional-systems')),original);
  await app.evaluate(({ipcMain})=>{ipcMain.removeAllListeners('workspace-storage');ipcMain.on('workspace-storage',globalThis.viewHandler);});
  await btn('全部展开').click();await btn('打开系统：敌人技能系统').click();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1120,1000));assert.equal(await tree().evaluate(e=>e.scrollWidth<=e.clientWidth+2),true);await page.locator('.fs-workspace').screenshot({path:path.join(root,'.gamecreator/qa/functional-tree-narrow.png')});assert.deepEqual(errors,[]);
  console.log('PASS: per-system and bulk folding, title selection, search/status reveal, external usage jump, restart, project isolation, preference failures, unchanged project content and narrow layout.');
 }catch(e){if(page&&!page.isClosed())console.error((await page.locator('body').innerText()).slice(-3000));throw e;}finally{if(app)await app.close();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('gc-functional-tree-'));await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
