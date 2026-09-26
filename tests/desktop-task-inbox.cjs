const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createWorkspaceStorage}=require('../desktop/test-workspaces.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
 const {preparePrototypeProject,writePrototypeProject}=await import('../src/prototype-import.ts'),{presetPositions}=await import('../shared/ai-personnel.mjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-task-inbox-')),storage=createWorkspaceStorage(path.join(dir,'data'));
 const example=JSON.parse(await fs.readFile(path.join(root,'examples/prototypes/plants-vs-zombies.json'),'utf8')),p=preparePrototypeProject({schema:2,projects:[],activeId:'',mode:'project'},example,'美术协作验收');writePrototypeProject(storage,p);storage.setItem('gamecreator.projects.v1',JSON.stringify(p.catalog));
 const key='gamecreator.workspace.v1:'+p.project.id+':project-schedule',read=()=>JSON.parse(storage.getItem(key)),s=read(),task=s.tasks.find(t=>t.kind==='美术');task.status='待开始';task.positionIds=['art'];
 const member=(id,role,artPermissions)=>({id,name:id==='lead'?'主美A':'美术开发A',active:true,roles:[role],scope:'assigned',permissions:['progress','review'],createdAt:new Date().toISOString(),duties:'制作',developer:{positionIds:[role],taskIds:[],scope:'assigned',expiresAt:'',artPermissions}});
 s.personnel={schema:1,positions:presetPositions('production'),members:[member('lead','art-director',['style','details','propose','dispatch']),member('artist','art',[])],credentials:[]};storage.setItem(key,JSON.stringify(s));
 let app,page;const errors=[],env={...process.env,GAMECREATOR_DATA_DIR:path.join(dir,'data'),GAMECREATOR_USER_DATA_DIR:path.join(dir,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 const button=name=>page.getByRole('button',{name,exact:true}),field=name=>page.getByLabel(name,{exact:true});
 async function launch(){app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1520,1000));await button('进入本地工作区').click();await button('任务清单').click();}
 try{
  await launch();await button('派发任务').click();await field('发起成员').selectOption('lead');await field('关联任务').selectOption(task.id);await field('接收成员').selectOption('artist');await button('确认派发').click();await page.getByRole('dialog').waitFor({state:'detached'});assert.equal(read().tasks.find(t=>t.id===task.id).assignment.primaryId,'artist');
  await field('任务清单成员').selectOption('artist');assert.equal(await page.locator('.inbox-list article').count(),1);await button('打开任务与验收').click();assert.ok((await page.locator('body').innerText()).includes(task.title));await page.keyboard.press('Escape');await button('任务清单').click();
  await button('提出建议').click();await field('发起成员').selectOption('lead');await field('关联任务').selectOption(task.id);await field('建议内容').fill('建议增加僵尸受击动画，保留原有分类并调整制作排期。');await button('确认记录建议').click();await page.getByRole('dialog').waitFor({state:'detached'});await page.getByRole('tab',{name:/协作建议/}).click();await button('标记已采纳').click();assert.equal(read().tasks.find(t=>t.id===task.id).proposals[0].resolution,'accepted');assert.equal(read().tasks.find(t=>t.id===task.id).status,'待开始');
  await page.getByRole('tab',{name:/我派发的/}).click();await field('任务清单成员').selectOption('lead');assert.equal(await page.locator('.inbox-list article').count(),1);await fs.mkdir(path.join(root,'.gamecreator/qa'),{recursive:true});await page.screenshot({path:path.join(root,'.gamecreator/qa/task-inbox.png')});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1050,900));assert.ok(await page.locator('.task-inbox').evaluate(e=>e.scrollWidth<=e.clientWidth+2));
  const saved=read();await app.close();app=null;await launch();assert.deepEqual(read(),saved);await field('任务清单成员').selectOption('artist');assert.equal(await page.locator('.inbox-list article').count(),1);assert.deepEqual(errors,[]);
  console.log('PASS inbox: dispatch, member filter, source task, proposal resolution, narrow layout and restart persistence.');
 }finally{if(app)await app.close();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('gc-task-inbox-'));await fs.rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
})().catch(e=>{console.error(e);process.exitCode=1;});
