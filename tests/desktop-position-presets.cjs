const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createWorkspaceStorage}=require('../desktop/test-workspaces.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
 const {preparePrototypeProject,writePrototypeProject}=await import('../src/prototype-import.ts');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-position-presets-')),storage=createWorkspaceStorage(path.join(dir,'data'));
 const example=JSON.parse(await fs.readFile(path.join(root,'examples/prototypes/plants-vs-zombies.json'),'utf8'));
 const p=preparePrototypeProject({schema:2,projects:[],activeId:'',mode:'project'},example,'岗位预设验收');writePrototypeProject(storage,p);
 p.catalog.projects.push({...p.project,id:'preset-other',name:'其他项目',initialContent:'empty'});storage.setItem('gamecreator.projects.v1',JSON.stringify(p.catalog));
 const key='gamecreator.workspace.v1:'+p.project.id+':project-schedule',read=()=>JSON.parse(storage.getItem(key)),before=read();
 let app,page;const errors=[],env={...process.env,GAMECREATOR_DATA_DIR:path.join(dir,'data'),GAMECREATOR_USER_DATA_DIR:path.join(dir,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 const button=name=>page.getByRole('button',{name,exact:true}),field=name=>page.getByLabel(name,{exact:true});
 async function launch(){app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1520,1080));await button('进入本地工作区').click();await button('人员分配').click();}
 try{
  await launch();assert.equal(await page.locator('.ai-member-card').count(),6);assert.deepEqual(read(),before);
  await button('选择岗位预设：完整制作').click();await page.getByRole('dialog',{name:'切换岗位预设'}).waitFor();await button('取消').click();assert.deepEqual(read(),before);
  await button('选择岗位预设：完整制作').click();await button('确认应用岗位预设').click();await page.getByRole('dialog',{name:'切换岗位预设'}).waitFor({state:'detached'});
  assert.equal(await page.locator('.ai-member-card').count(),8);assert.equal(read().personnel.positionPreset,'production');assert.deepEqual(read().tasks,before.tasks);
  const task=before.tasks.find(t=>t.kind==='美术');await button('编辑岗位：主美').click();await field('岗位工作：'+task.title).check();await field('岗位职责').fill('审核最终画面，并检查轮廓辨识度。');await button('保存岗位').click();
  await fs.mkdir(path.join(root,'.gamecreator/qa'),{recursive:true});await page.screenshot({path:path.join(root,'.gamecreator/qa/position-presets-production.png')});
  const prior=read();await button('选择岗位预设：基础协作').click();const dialog=page.getByRole('dialog',{name:'切换岗位预设'});assert.ok((await dialog.innerText()).includes(task.title));await button('取消').click();assert.deepEqual(read(),prior);
  await button('选择岗位预设：基础协作').click();await button('确认应用岗位预设').click();await dialog.waitFor({state:'detached'});assert.equal(await page.locator('.ai-member-card').count(),6);
  assert.deepEqual(read().tasks.find(t=>t.id===task.id).positionIds,['art']);assert.equal(read().tasks.find(t=>t.id===task.id).status,task.status);
  await page.getByLabel(/显示停用岗位/).check();assert.equal(await page.locator('.ai-member-card').count(),8);await button('编辑岗位：主美').click();assert.equal(await field('岗位职责').inputValue(),'审核最终画面，并检查轮廓辨识度。');await button('关闭编辑岗位：主美').click();
  await button('选择岗位预设：完整制作').click();await button('确认应用岗位预设').click();await dialog.waitFor({state:'detached'});assert.equal(read().personnel.positions.find(p=>p.id==='art-director').duties,'审核最终画面，并检查轮廓辨识度。');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1050,900));assert.ok(await page.locator('.ai-personnel').evaluate(e=>e.scrollWidth<=e.clientWidth+2));
  const saved=read();await app.close();app=null;await launch();assert.deepEqual(read(),saved);assert.equal(await page.locator('.ai-member-card').count(),8);
  await page.locator('.ps-trigger').click();await page.getByRole('menuitemradio').filter({hasText:'其他项目'}).click();await button('人员分配').click();assert.equal(await page.locator('.ai-member-card').count(),6);assert.deepEqual(errors,[]);
  console.log('PASS position presets: preview/cancel, six/eight roles, task merge, preserved duties, disabled history, narrow layout, restart and project isolation.');
 }finally{if(app)await app.close();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('gc-position-presets-'));await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
})().catch(e=>{console.error(e);process.exitCode=1;});
