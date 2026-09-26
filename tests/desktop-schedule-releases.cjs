const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createWorkspaceStorage}=require('../desktop/test-workspaces.cjs'),{createCollaborationServer}=require('../server/collaboration.cjs');
const {createProductionMilestone,createProductionTask}=require('../src/project-schedule.ts');
const {withScheduleReleases}=require('../src/schedule-releases.ts'),{scheduleChanges}=require('../src/team-schedule-model.ts');
const root=path.resolve(__dirname,'..');
const until=async(fn)=>{for(let i=0;i<120;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('UI state did not settle');};
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-release-ui-')),apps=new Set(),errors=[],qa=path.join(root,'.gamecreator/qa');
 const storage=createWorkspaceStorage(path.join(dir,'local/data')),key='gamecreator.workspace.v1:release-qa:project-schedule';
 const background='v0.3.0「奶龙来袭」：新增冰霜主题减速射手与奶龙敌人，新增第四、第五关，形成4种植物、3种敌人、5个关卡。目标是让经济、输出、阻挡和减速形成可替代的布阵选择。新增单位和关卡均尚未开发；本次录入不代表数值或视觉稿已验收。日历基线：2026-10-09至2026-10-29。';
 const store={schema:1,tasks:[],milestones:[...['M1 | 设计定稿','M2 | 新单位可玩','M3 | 五关内容串联','M4 | 平衡复验与交付'].map((title,i)=>({...createProductionMilestone('v0.3.0 · '+title),id:'m'+(i+1),description:background,due:['2026-10-13','2026-10-20','2026-10-23','2026-10-29'][i],acceptance:'完成本阶段设计与运行验证，并记录验收证据。'.repeat(10)})),{...createProductionMilestone('v0.2.0 · M1 | 旧阶段'),id:'old',due:'2026-09-24'},{...createProductionMilestone('待规划阶段'),id:'later'}]};
 store.tasks=[{...createProductionTask('交付任务'),id:'task',milestoneId:'m4',status:'已完成',result:'验证通过'}];
 const config={engine:'oasis-lua',projectPath:'',enumPath:'Script/Const',dataPath:'Script/Config',outputFormat:'lua',autoSync:false,backupBeforeSync:true};
 storage.setItem('gamecreator.projects.v1',JSON.stringify({schema:2,mode:'project',activeId:'release-qa',projects:[{id:'release-qa',name:'版本排期验证',initialContent:'empty',config}]}));storage.setItem(key,JSON.stringify(store));const original=storage.getItem(key);
 const btn=(p,name)=>p.getByRole('button',{name,exact:true}),tab=(p,name)=>p.getByRole('tab',{name,exact:true}),group=(p,title)=>p.getByRole('region',{name:'版本分组：'+title,exact:true});
 const launch=async name=>{const env={...process.env,GAMECREATOR_DATA_DIR:path.join(dir,name,'data'),GAMECREATOR_USER_DATA_DIR:path.join(dir,name,'profile')};delete env.ELECTRON_RUN_AS_NODE;delete env.GAMECREATOR_TEAM_ACCOUNT;const app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});apps.add(app);const page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1600,1050));return{app,page};};
 let service;
 try{
  await fs.mkdir(qa,{recursive:true});const a=await launch('local'),p=a.page;await btn(p,'进入本地工作区').click();await btn(p,'项目排期').click();await tab(p,'里程碑').click();
  const current=group(p,'v0.3.0');await current.waitFor();assert.deepEqual(await current.locator('.sch-milestone-open h3').allTextContents(),['M4 | 平衡复验与交付','M3 | 五关内容串联','M2 | 新单位可玩','M1 | 设计定稿']);
  assert.equal(await current.locator('.sch-release-description').count(),1);assert.equal(storage.getItem(key),original);
  const cardSizes=await current.locator('.sch-milestone-card').evaluateAll(nodes=>nodes.map(n=>({height:n.getBoundingClientRect().height,overflows:n.scrollWidth>n.clientWidth+2})));
  assert.ok(cardSizes.every(s=>s.height<410&&!s.overflows),JSON.stringify(cardSizes));await current.screenshot({path:path.join(qa,'schedule-release-cards.png')});
  await btn(p,'紧凑列表').click();await btn(p,'收起版本：v0.2.0').click();assert.equal(await group(p,'v0.2.0').locator('.sch-milestone-card').count(),0);assert.equal(storage.getItem(key),original);
  assert.ok((await current.locator('.sch-milestone-card').first().boundingBox()).height<200);await current.screenshot({path:path.join(qa,'schedule-release-list.png')});
  await current.locator('.sch-milestone-details summary').first().click();assert.ok((await current.locator('.sch-milestone-details').first().innerText()).includes(store.milestones[3].acceptance));
  await a.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1100,950));assert.equal(await p.locator('.sch-release-board').evaluate(e=>e.scrollWidth<=e.clientWidth+2),true);await a.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1600,1050));
  await btn(p,'编辑版本：v0.3.0').click();let edit=p.getByRole('dialog',{name:'编辑版本',exact:true});await edit.getByLabel('版本背景与目标',{exact:true}).fill('统一维护的新版本背景');await btn(edit,'保存版本').click();
  let persisted=JSON.parse(storage.getItem(key));assert.equal(persisted.releases.length,2);assert.equal(persisted.releases.find(r=>r.title==='v0.3.0').description,'统一维护的新版本背景');assert.deepEqual(persisted.tasks,store.tasks);assert.equal(persisted.milestones.find(m=>m.id==='m1').description,'');
  await btn(p,'新建版本').click();let create=p.getByRole('dialog',{name:'新建版本',exact:true});await create.getByLabel('版本名称',{exact:true}).fill('v0.4.0');await create.getByLabel('版本背景与目标',{exact:true}).fill('下一版本目标');await btn(create,'保存版本').click();
  const release=JSON.parse(storage.getItem(key)).releases.find(r=>r.title==='v0.4.0');
  await btn(p,'新建里程碑').click();const fresh=p.getByRole('dialog',{name:'新建里程碑',exact:true});await fresh.getByLabel('里程碑名称',{exact:true}).fill('新增阶段');await fresh.getByLabel('所属版本',{exact:true}).selectOption(release.id);await btn(fresh,'创建').click();const detail=p.getByRole('dialog',{name:'里程碑详情',exact:true});await detail.getByLabel('里程碑目标日期',{exact:true}).fill('2026-11-10');await btn(detail,'关闭里程碑详情').click();await group(p,'v0.4.0').waitFor();
  await btn(p,'打开里程碑：v0.3.0 · M4 | 平衡复验与交付').click();await detail.getByLabel('所属版本',{exact:true}).selectOption(release.id);await btn(detail,'关闭里程碑详情').click();assert.equal(await group(p,'v0.4.0').locator('.sch-milestone-card').count(),2);
  const beforeDelete=JSON.parse(storage.getItem(key));await btn(p,'编辑版本：v0.4.0').click();edit=p.getByRole('dialog',{name:'编辑版本',exact:true});await btn(edit,'删除版本').click();persisted=JSON.parse(storage.getItem(key));assert.equal(persisted.milestones.length,beforeDelete.milestones.length);assert.deepEqual(persisted.tasks,beforeDelete.tasks);assert.equal(persisted.milestones.find(m=>m.id==='m4').releaseId,'');
  await a.app.close();apps.delete(a.app);const again=await launch('local');await btn(again.page,'进入本地工作区').click();await btn(again.page,'项目排期').click();await tab(again.page,'里程碑').click();assert.equal(await group(again.page,'未分组').locator('.sch-milestone-card').count(),3);await again.app.close();apps.delete(again.app);

  service=await createCollaborationServer({directory:path.join(dir,'server'),port:0});
  const api=async(route,token,method='GET',body)=>{const r=await fetch(service.url+'/api/team'+route,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+(token||'')},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(r.ok,route+' '+r.status+' '+await r.clone().text());return r.json();};
  const token=(await api('/login','','POST',{username:'admin',password:'admin123'})).token,route='/projects/team-demo/schedule',base=await api(route,token);
  await api(route,token,'PUT',{requestId:crypto.randomUUID(),changes:scheduleChanges(base,withScheduleReleases(store))});
  const login=async(p,user)=>{await tab(p,'团队协作').click();await p.getByLabel('协作服务地址',{exact:true}).fill(service.url);await p.getByLabel('团队账号',{exact:true}).fill(user);await p.getByLabel('团队密码',{exact:true}).fill(user+'123');await btn(p,'登录团队协作').click();await btn(p,'项目排期').click();await tab(p,'里程碑').click();await group(p,'v0.3.0').waitFor();};
  const admin=await launch('admin'),viewer=await launch('viewer');await login(admin.page,'admin');await login(viewer.page,'alice');assert.ok(await btn(viewer.page,'新建版本').isDisabled());assert.ok(await btn(viewer.page,'编辑版本：v0.3.0').isDisabled());
  await btn(viewer.page,'紧凑列表').click();await btn(viewer.page,'收起版本：v0.2.0').click();
  await btn(admin.page,'编辑版本：v0.3.0').click();edit=admin.page.getByRole('dialog',{name:'编辑版本',exact:true});await edit.getByLabel('版本背景与目标',{exact:true}).fill('团队共同的版本背景');await btn(edit,'保存版本').click();await btn(admin.page,'保存排期到团队').click();await until(async()=>(await group(viewer.page,'v0.3.0').locator('.sch-release-description').innerText()).includes('团队共同的版本背景'));
  assert.equal((await api(route,token)).store.releases.find(r=>r.title==='v0.3.0').description,'团队共同的版本背景');assert.deepEqual(errors,[]);
  console.log('PASS: compact cards/list, date sorting, shared background, collapse/read-only views without writes, migration, version create/edit/delete, reassignment, restart, two-client sharing and permissions.');
 }catch(error){console.error('Renderer errors:',errors);for(const app of apps){const page=await app.firstWindow();console.error(await page.locator('dialog[open]').evaluateAll(nodes=>nodes.map(n=>n.outerHTML.slice(0,2500))));await page.screenshot({path:path.join(qa,'schedule-release-failure.png')}).catch(()=>{});}throw error;}finally{for(const app of apps)await app.close();if(service)await service.close();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('gc-release-ui-'));await fs.rm(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
