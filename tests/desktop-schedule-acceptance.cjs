const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createWorkspaceStorage}=require('../desktop/test-workspaces.cjs'),root=path.resolve(__dirname,'..');
(async()=>{
 const {preparePrototypeProject,writePrototypeProject}=await import('../src/prototype-import.ts');
 const example=JSON.parse(await fs.readFile(path.join(root,'examples/prototypes/plants-vs-zombies.json'),'utf8'));
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-acceptance-')),storage=createWorkspaceStorage(path.join(dir,'data')),p=preparePrototypeProject({schema:2,projects:[],mode:'project',activeId:''},example,'工具验收联动');writePrototypeProject(storage,p);
 const second={...p.project,id:'acceptance-other',name:'其他空项目'};p.catalog.projects.push(second);storage.setItem('gamecreator.projects.v1',JSON.stringify(p.catalog));
 const prefix='gamecreator.workspace.v1:'+p.project.id+':',sk=prefix+'project-schedule',tk=prefix+'development-tools',schedule=()=>JSON.parse(storage.getItem(sk)),tools=()=>JSON.parse(storage.getItem(tk));
 example.projectSchedule.tasks.forEach(t=>t.status='已完成');example.developmentTools.tools.forEach(t=>t.status='待验收');storage.setItem(sk,JSON.stringify(example.projectSchedule));storage.setItem(tk,JSON.stringify(example.developmentTools));
 const last=example.projectSchedule.tasks.find(t=>t.kind==='测试'&&t.references.filter(r=>r.kind==='tool').length===3),milestone=example.projectSchedule.milestones.find(m=>m.id===last.milestoneId);
 const env={...process.env,GAMECREATOR_DATA_DIR:path.join(dir,'data'),GAMECREATOR_USER_DATA_DIR:path.join(dir,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 let app,page;const errors=[],btn=n=>page.getByRole('button',{name:n,exact:true}),tab=n=>page.getByRole('tab',{name:n,exact:true});
 async function launch(){app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1580,1050));await btn('进入本地工作区').click();}
 async function wait(check){for(let n=0;n<150;n++){if(await check())return;await new Promise(r=>setTimeout(r,30));}assert.fail('acceptance state did not settle');}
 async function intercept(key){await app.evaluate(({ipcMain},key)=>{globalThis.acceptanceStorage=ipcMain.listeners('workspace-storage')[0];ipcMain.removeAllListeners('workspace-storage');ipcMain.on('workspace-storage',(e,r)=>{if(r?.operation==='set'&&r.key===key)e.returnValue={ok:false,error:'验收保存失败测试'};else globalThis.acceptanceStorage(e,r);});},key);}
 async function restore(){await app.evaluate(({ipcMain})=>{ipcMain.removeAllListeners('workspace-storage');ipcMain.on('workspace-storage',globalThis.acceptanceStorage);});}
 try{
  await launch();await wait(()=>tools().tools.every(t=>t.status==='可使用'));assert.deepEqual(schedule().tasks,example.projectSchedule.tasks);assert.ok(tools().tools.every(t=>t.usage===example.developmentTools.tools.find(x=>x.id===t.id).usage));
  await btn('开发工具').click();assert.equal(await page.getByLabel('工具状态',{exact:true}).inputValue(),'可使用');
  await btn('项目排期').click();await btn('查看待验收里程碑').click();const action=btn('验收里程碑：'+milestone.title);await action.click();const review=page.getByRole('dialog',{name:'确认里程碑验收',exact:true});await btn('关闭确认里程碑验收').click();assert.equal(schedule().milestones.find(m=>m.id===milestone.id).status,'计划中');
  await action.click();await review.getByLabel('本次验收说明').fill('三个工具交付入口已核验');await review.getByRole('button',{name:'确认验收通过',exact:true}).click();await review.waitFor({state:'hidden'});assert.equal(schedule().milestones.find(m=>m.id===milestone.id).status,'已验收');assert.match(schedule().milestones.find(m=>m.id===milestone.id).review,/三个工具交付入口已核验/);
  await tab('任务进度').click();await btn('重新打开任务：'+last.title).click();await wait(()=>tools().tools.every(t=>t.status==='待验收'));assert.equal(schedule().milestones.find(m=>m.id===milestone.id).status,'进行中');
  await tab('里程碑').click();assert.equal(await btn('验收里程碑：'+milestone.title).isDisabled(),true);await tab('任务进度').click();
  // A failed task save never promotes the tools using an uncommitted draft.
  await intercept(sk);await btn('标记任务完成：'+last.title).click();assert.ok(tools().tools.every(t=>t.status==='待验收'));assert.equal(schedule().tasks.find(t=>t.id===last.id).status,'进行中');assert.equal(await page.locator('.ps-trigger').isDisabled(),true);
  await restore();await intercept(tk);await btn('重试保存排期').click();await btn('处理开发工具存档').waitFor();assert.ok(tools().tools.every(t=>t.status==='待验收'));assert.equal(schedule().tasks.find(t=>t.id===last.id).status,'已完成');
  await restore();await btn('处理开发工具存档').click();await btn('重试保存开发工具').click();await wait(()=>tools().tools.every(t=>t.status==='可使用'));assert.equal(schedule().milestones.find(m=>m.id===milestone.id).status,'进行中');
  await btn('项目排期').click();await tab('里程碑').click();await fs.mkdir(path.join(root,'.gamecreator/qa'),{recursive:true});await page.screenshot({path:path.join(root,'.gamecreator/qa/schedule-acceptance-ready.png')});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1100,900));assert.ok(await page.locator('.sch-workspace').evaluate(e=>e.scrollWidth<=e.clientWidth+2));
  await btn('验收里程碑：'+milestone.title).click();await page.screenshot({path:path.join(root,'.gamecreator/qa/schedule-acceptance-dialog.png')});await btn('确认验收通过').click();const accepted=schedule().milestones.find(m=>m.id===milestone.id);assert.equal(accepted.status,'已验收');assert.match(accepted.review,/三个工具交付入口已核验/);
  const before=storage.getItem(tk);await app.close();app=null;await launch();assert.equal(storage.getItem(tk),before);assert.equal(schedule().milestones.find(m=>m.id===milestone.id).status,'已验收');
  await page.locator('.ps-trigger').click();await page.getByRole('menuitemradio').filter({hasText:second.name}).click();await btn('开发工具').click();assert.equal(await page.locator('.dt-card').count(),0);assert.equal(storage.getItem('gamecreator.workspace.v1:'+second.id+':development-tools'),null);assert.deepEqual(errors,[]);
  console.log('PASS acceptance sync: legacy completion repair, all linked tasks, explicit milestone decision/cancel, reopen and reaccept, task/tool save failures and retry, restart, project isolation and narrow layout.');
 }catch(e){if(page&&!page.isClosed())console.error((await page.locator('body').innerText()).slice(-7000));throw e;}finally{if(app)await app.close();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('gc-acceptance-'));await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
