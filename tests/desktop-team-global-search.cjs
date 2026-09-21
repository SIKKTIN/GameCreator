const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {createCollaborationServer}=require('../server/collaboration.cjs');
const {gameplayPatch}=require('../src/team-gameplay-model.ts'),{sample}=require('./gameplay-fixture.cjs');
const {scheduleChanges}=require('../src/team-schedule-model.ts'),{createProductionTask}=require('../src/project-schedule.ts');
const root=path.resolve(__dirname,'..');
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-team-global-search-'));let app,page,service;const errors=[];
 try{
 service=await createCollaborationServer({directory:path.join(dir,'server'),port:0});
 const api=async(route,token,method='GET',body)=>{const r=await fetch(service.url+'/api/team'+route,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+(token||'')},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(r.ok,route+' '+r.status+' '+await r.clone().text());return r.json();};
 const token=(await api('/login','','POST',{username:'admin',password:'admin123'})).token;
 const base='/projects/team-demo',gp=sample();gp.designs[0].title='团队共享唯一玩法';await api(base+'/gameplay',token,'PUT',{...gameplayPatch(await api(base+'/gameplay',token),gp),requestId:crypto.randomUUID()});
 await api(base+'/core',token,'PUT',{requestId:crypto.randomUUID(),rootId:'root',changes:[{id:'root',revision:0,graph:{id:'root',title:'团队共享唯一流程',summary:'',edges:[],nodes:[{id:'node',title:'团队共享唯一节点',kind:'activity',description:'',x:100,y:100,childGraphId:'',gameplayIds:['combat']}]}}]});
 const schedule={schema:1,tasks:[{...createProductionTask('团队共享唯一任务'),id:'search-task'}],milestones:[]};await api(base+'/schedule',token,'PUT',{requestId:crypto.randomUUID(),changes:scheduleChanges(await api(base+'/schedule',token),schedule)});
 await api(base+'/stories',token,'POST',{title:'团队共享唯一故事',category:'世界观',status:'草稿',summary:'团队共享唯一描述',content:'正文唯一短句',tags:[],outlines:[],relations:{characters:[],locations:[],systems:[]}});
 const list=await api('/projects',token),project=list.projects.find(p=>p.id==='team-demo');
 const env={...process.env,GAMECREATOR_DATA_DIR:path.join(dir,'client-data'),GAMECREATOR_USER_DATA_DIR:path.join(dir,'profile'),GAMECREATOR_TEAM_DATA_DIR:path.join(dir,'server'),GAMECREATOR_TEAM_PORT:new URL(service.url).port};delete env.ELECTRON_RUN_AS_NODE;delete env.GAMECREATOR_TEAM_ACCOUNT;
 app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 const button=name=>page.getByRole('button',{name,exact:true}),panel=()=>page.getByRole('region',{name:'全局搜索工作区'});
 await page.getByRole('tab',{name:'团队协作',exact:true}).click();const entry=page.getByRole('main',{name:'工作区入口',exact:true});await entry.getByLabel('协作服务地址',{exact:true}).fill(service.url);await entry.getByLabel('团队账号',{exact:true}).fill('alice');await entry.getByLabel('团队密码',{exact:true}).fill('alice123');await button('登录团队协作').click();await page.locator('.team-project').waitFor();
 await button('全局搜索').click();await page.getByLabel('搜索当前项目',{exact:true}).fill('团队共享唯一');await button('打开搜索结果：团队共享唯一任务').waitFor();await button('打开搜索结果：团队共享唯一节点').waitFor();await button('打开搜索结果：团队共享唯一玩法').waitFor();await button('打开搜索结果：团队共享唯一故事').waitFor();assert.equal(await panel().locator('.gsearch-filters button').filter({hasText:'素材资产'}).count(),0);
 await button('打开搜索结果：团队共享唯一节点').click();assert.equal(await button('选择节点：团队共享唯一节点').getAttribute('aria-pressed'),'true');await page.getByRole('button',{name:/返回搜索结果/}).click();
 await button('打开搜索结果：团队共享唯一任务').click();const dialog=page.getByRole('dialog',{name:'制作任务详情',exact:true});await dialog.waitFor();await dialog.getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:/返回搜索结果/}).click();
 await button('打开搜索结果：团队共享唯一玩法').click();await page.getByRole('textbox',{name:'玩法名称',exact:true}).waitFor();await page.getByRole('button',{name:/返回搜索结果/}).click();
 await button('打开搜索结果：团队共享唯一故事').click();await page.locator('.shared-story-editor').waitFor();await page.getByRole('button',{name:/返回搜索结果/}).click();
 // A later server deletion must disappear without switching projects.
 const fresh=await api(base+'/schedule',token);await api(base+'/schedule',token,'PUT',{requestId:crypto.randomUUID(),changes:scheduleChanges(fresh,{...fresh.store,tasks:[]})});await button('打开搜索结果：团队共享唯一任务').waitFor({state:'detached'});
 const members=await api(base+'/members',token);await api(base+'/members',token,'PUT',{revision:members.revision,members:members.members.filter(m=>m.userId!=='alice').map(m=>({userId:m.userId,role:m.role,permissions:m.permissions}))});
 await page.getByText('当前项目不可访问，搜索结果已清除。',{exact:false}).waitFor();assert.equal(await panel().locator('.gsearch-result').count(),0);assert.equal(await panel().locator('.gsearch-preview').count(),0);assert.deepEqual(errors,[]);
 console.log('PASS team search: authorized shared story/gameplay/core/schedule coverage, direct navigation, live deletion and immediate result clearing after access revocation.');
 }catch(e){if(page&&!page.isClosed())console.error((await page.locator('body').innerText()).slice(-3200));throw e;}finally{if(app)await app.close();if(service)await service.close();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('gc-team-global-search-'));await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
