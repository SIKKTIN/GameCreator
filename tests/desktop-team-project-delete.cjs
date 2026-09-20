// Isolated client profiles/database: never deletes an actual user project.
const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {createCollaborationServer}=require('../server/collaboration.cjs'),{createWorkspaceStorage}=require('../desktop/test-workspaces.cjs');
const {emptyGameplayCore}=require('../src/gameplay-core.ts');
const root=path.resolve(__dirname,'..'),qa=path.join(root,'.gamecreator/qa');
const until=async(check,message)=>{const end=Date.now()+20000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,80));}throw new Error(message);};
(async()=>{
  const prefix=path.join(os.tmpdir(),'gc-project-delete-ui-'),directory=await fs.mkdtemp(prefix),apps=[],pages=[],errors=[];
  const service=await createCollaborationServer({directory:path.join(directory,'server'),port:0});
  const api=async(route,token,method='GET',body)=>{const res=await fetch(service.url+'/api/team'+route,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+(token||'')},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(res.ok,route+' '+res.status);return res.json();};
  const token=(await api('/login','','POST',{username:'admin',password:'admin123'})).token;
  const source={sourceInstanceId:crypto.randomUUID(),sourceProjectId:'local-source'},name='01 删除验收';
  const story={id:'local-story',title:'保留本地原稿',category:'世界观',status:'草稿',summary:'',content:'本地原始内容',updated:'本地',tags:[],outlines:[],relations:{characters:[],locations:[],systems:[]}},core=emptyGameplayCore();
  const project=(await api('/publications',token,'POST',{...source,name,members:[{userId:'admin',role:'admin'},{userId:'bob',role:'editor'}],stories:[story],core:{store:core,references:[]},gameplay:{store:require('./gameplay-fixture.cjs').sample(),references:[]}})).project;
  const storages={};
  const launch=async user=>{
    const data=path.join(directory,user,'data'),storage=createWorkspaceStorage(data);storages[user]=storage;
    const config={engine:'oasis-lua',projectPath:'',enumPath:'Script/Const',dataPath:'Script/Config',outputFormat:'lua',autoSync:false,backupBeforeSync:true};
    storage.setItem('gamecreator.projects.v1',JSON.stringify({schema:2,mode:'project',activeId:'local-source',projects:[{id:'local-source',name:'本地原型',initialContent:'empty',config}]}));
    storage.setItem('gamecreator.local-source.v1',JSON.stringify(source.sourceInstanceId));storage.setItem('gamecreator.workspace.v1:local-source:stories',JSON.stringify([story]));storage.setItem('gamecreator.workspace.v1:local-source:gameplay-core',JSON.stringify(core));
    const env={...process.env,GAMECREATOR_DATA_DIR:data,GAMECREATOR_USER_DATA_DIR:path.join(directory,user,'profile'),GAMECREATOR_TEAM_DATA_DIR:path.join(directory,'server'),GAMECREATOR_TEAM_PORT:new URL(service.url).port};delete env.ELECTRON_RUN_AS_NODE;delete env.GAMECREATOR_TEAM_ACCOUNT;
    const app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env,timeout:30000});apps.push(app);
    const page=await app.firstWindow();pages.push(page);page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
    await page.getByLabel('账号',{exact:true}).fill(user);await page.getByLabel('密码',{exact:true}).fill(user+'123');await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('.ps-trigger').waitFor();return page;
  };
  const button=(p,n)=>p.getByRole('button',{name:n,exact:true}),modal=p=>p.getByRole('dialog',{name:'删除协作项目',exact:true});
  const menu=async p=>{await p.locator('.ps-trigger').click();return p.getByRole('menu',{name:'项目列表'});};
  const connect=async(p,user)=>{
    await (await menu(p)).getByRole('menuitem',{name:'连接团队服务器',exact:true}).click();const d=p.getByRole('dialog',{name:'连接团队服务器',exact:true});
    await d.getByLabel('协作服务地址',{exact:true}).fill(service.url);await d.getByLabel('团队账号',{exact:true}).fill(user);await d.getByLabel('团队密码',{exact:true}).fill(user+'123');await button(d,'连接并进入项目').click();await p.locator('.team-project .story-workspace').waitFor();
  };
  const nav=(p,n)=>p.getByRole('navigation',{name:'工作区模块',exact:true}).getByRole('button',{name:n,exact:true}).click();
  let release;
  try{
    const a=await launch('admin'),b=await launch('user');await connect(a,'admin');await connect(b,'bob');
    await b.getByLabel('文档正文',{exact:true}).fill('删除前的故事草稿');await nav(b,'玩法核心');await b.getByLabel('流程图说明',{exact:true}).fill('删除前的核心草稿');await nav(b,'故事文档');
    const prefixKey=`gamecreator.team-draft.v1:${service.serverId}:bob:${project.id}:`,remoteStory=(await api('/projects/'+project.id+'/stories',token)).stories[0];
    const savedStory=storages.user.getItem(prefixKey+remoteStory.id),savedCore=storages.user.getItem(prefixKey+'gameplay-core');
    const duplicate=(await api('/projects',token,'POST',{name,members:[{userId:'admin',role:'admin'}],requestId:crypto.randomUUID()})).project;
    await button(a,'用户与权限').click();const row=a.locator(`[data-project-id="${project.id}"]`);await row.waitFor();await a.locator(`[data-project-id="${duplicate.id}"]`).waitFor();
    await button(row,'删除协作项目：'+name).click();await modal(a).getByText('1 篇故事文档、1 条文档历史',{exact:true}).waitFor();await modal(a).getByLabel('删除确认项目名称',{exact:true}).fill('wrong');assert.ok(await button(modal(a),'确认删除协作项目').isDisabled());await button(modal(a),'取消').click();assert.equal((await api('/admin/projects/'+project.id,token)).deleted,false);
    await button(row,'删除协作项目：'+name).click();await modal(a).getByText('1 篇故事文档、1 条文档历史',{exact:true}).waitFor();
    await api(`/projects/${project.id}/stories/${remoteStory.id}`,token,'PUT',{...remoteStory,content:'确认期间的新团队内容'});
    await modal(a).getByLabel('删除确认项目名称',{exact:true}).fill(name);await button(modal(a),'确认删除协作项目').click();await modal(a).getByText('项目内容或成员已变化，请重新核对删除范围后确认',{exact:true}).waitFor();
    await button(modal(a),'重新核对删除范围').click();await modal(a).getByText('1 篇故事文档、2 条文档历史',{exact:true}).waitFor();assert.equal(await modal(a).getByLabel('删除确认项目名称',{exact:true}).inputValue(),'');
    await modal(a).getByLabel('删除确认项目名称',{exact:true}).fill(name);await fs.mkdir(qa,{recursive:true});await a.screenshot({path:path.join(qa,'delete-project-confirmation.png')});
    let committed=false;const held=new Promise(r=>release=r);await a.route('**/api/team/admin/projects/'+project.id,async r=>{if(r.request().method()!=='DELETE')return r.continue();const res=await r.fetch();assert.equal(res.status(),200);committed=true;await held;await r.abort('failed');});
    await button(modal(a),'确认删除协作项目').click();await until(()=>committed,'Deletion did not commit');assert.deepEqual(await a.evaluate(()=>['gamecreator:before-logout','gamecreator:leave-team'].map(n=>window.dispatchEvent(new Event(n,{cancelable:true})))),[false,false]);assert.ok(await button(modal(a),'取消').isDisabled());release();await modal(a).getByText('删除结果尚未确认。请重新核对项目状态，避免误操作。',{exact:true}).waitFor();
    await button(modal(a),'重新核对删除范围').click();await modal(a).getByText(/此协作项目已删除/).waitFor();await button(modal(a),'完成并刷新列表').click();await row.waitFor({state:'detached'});await a.locator(`[data-project-id="${duplicate.id}"]`).waitFor();
    await b.getByText('此协作项目已被管理员删除。本机项目和未提交草稿仍保留，请从项目列表选择其他项目。',{exact:true}).waitFor();assert.ok(!(await b.getByLabel('文档正文',{exact:true}).isVisible()));
    assert.equal(storages.user.getItem(prefixKey+remoteStory.id),savedStory);assert.equal(storages.user.getItem(prefixKey+'gameplay-core'),savedCore);assert.deepEqual(JSON.parse(storages.admin.getItem('gamecreator.workspace.v1:local-source:stories')),[story]);
    await (await menu(a)).getByRole('menuitemradio',{name:/^本地原型/}).click();await (await menu(a)).getByRole('menuitem',{name:'发布为协作项目',exact:true}).click();
    const publish=a.getByRole('dialog',{name:'发布为协作项目',exact:true});await publish.getByText(/原协作项目「01 删除验收」已删除/).waitFor();assert.ok(await button(publish,'发布并进入协作项目').isDisabled());
    await publish.getByLabel('我确认重新发布为新的协作项目',{exact:true}).check();await publish.getByLabel('协作项目名称',{exact:true}).fill('重新发布的项目');await button(publish,'发布并进入协作项目').click();await a.locator('.team-project .story-workspace').waitFor();
    const republished=(await api('/publications/lookup',token,'POST',source)).publication;assert.notEqual(republished.project.id,project.id);assert.equal((await api('/projects/'+republished.project.id+'/stories',token)).stories[0].content,story.content);assert.equal((await api('/admin/projects/'+duplicate.id,token)).deleted,false);
    await (await menu(b)).getByRole('menuitemradio',{name:/^本地原型/}).click();await nav(b,'故事文档');assert.equal(await b.getByLabel('文档正文',{exact:true}).inputValue(),story.content);assert.deepEqual(errors,[]);
    console.log('PASS: scoped same-name deletion; typed confirmation; concurrent edits; lost acknowledgement; active collaborator disabled with drafts retained; local project untouched; explicit re-publication uses a new ID.');
  }catch(error){await fs.mkdir(qa,{recursive:true});for(const [i,p]of pages.entries())if(!p.isClosed()){await p.screenshot({path:path.join(qa,'delete-project-failure-'+i+'.png'),fullPage:true});console.error((await p.locator('body').innerText()).slice(-7000));}throw error;}
  finally{release?.();for(const app of apps)await app.close().catch(()=>{});await service.close();assert.ok(path.resolve(directory).startsWith(path.resolve(prefix)));await fs.rm(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
