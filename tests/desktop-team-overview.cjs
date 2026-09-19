// Isolated clients and a temporary server; never connects to the user's data.
const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {createCollaborationServer}=require('../server/collaboration.cjs');
const root=path.resolve(__dirname,'..');
const until=async(check,message)=>{const end=Date.now()+20000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(message);};
(async()=>{
  const prefix=path.join(os.tmpdir(),'gc-overview-ui-'),directory=await fs.mkdtemp(prefix);
  const service=await createCollaborationServer({directory:path.join(directory,'server'),port:0});
  const apps=new Set(),pages=[],errors=[];
  const api=async(route,token,method='GET',body)=>{const response=await fetch(service.url+'/api/team'+route,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+(token||'')},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(response.ok,route+' '+response.status);return response.json();};
  const token=(await api('/login','','POST',{username:'admin',password:'admin123'})).token;
  const launch=async profile=>{
    const env={...process.env,GAMECREATOR_DATA_DIR:path.join(directory,profile,'data'),GAMECREATOR_USER_DATA_DIR:path.join(directory,profile,'profile'),GAMECREATOR_TEAM_DATA_DIR:path.join(directory,'server'),GAMECREATOR_TEAM_PORT:new URL(service.url).port};
    delete env.ELECTRON_RUN_AS_NODE;delete env.GAMECREATOR_TEAM_ACCOUNT;
    const app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env,timeout:30000});apps.add(app);
    const page=await app.firstWindow();pages.push(page);page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
    await page.getByLabel('账号',{exact:true}).fill('admin');await page.getByLabel('密码',{exact:true}).fill('admin123');await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('.ps-trigger').waitFor();return {app,page};
  };
  const nav=(page,name)=>page.getByRole('navigation',{name:'工作区模块',exact:true}).getByRole('button',{name,exact:true}).click();
  const connect=async(page,user)=>{
    await page.locator('.ps-trigger').click();await page.getByRole('menuitem',{name:'连接团队服务器',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'连接团队服务器',exact:true});await dialog.getByLabel('协作服务地址',{exact:true}).fill(service.url);
    await dialog.getByLabel('模拟成员',{exact:true}).selectOption(user);await dialog.getByRole('button',{name:'连接并进入项目',exact:true}).click();
    await page.locator('.team-project .story-workspace').waitFor();await nav(page,'项目概览');await info(page).waitFor();
  };
  const info=page=>page.getByRole('form',{name:'项目基本信息',exact:true});
  const milestone=(page,title)=>page.getByRole('form',{name:'里程碑：'+title,exact:true});
  const newMilestone=page=>page.getByRole('form',{name:'新里程碑',exact:true});
  const saved=form=>until(async()=>!(await form.locator('.team-record-state').innerText()).includes('尚未提交')&&!(await form.locator('.team-record-state').innerText()).includes('等待服务器'),'Save not confirmed');
  const create=async(page,title)=>{await page.getByRole('button',{name:'添加里程碑',exact:true}).click();await newMilestone(page).getByLabel('里程碑名称',{exact:true}).fill(title);await newMilestone(page).getByRole('button',{name:'保存里程碑到团队',exact:true}).click();await milestone(page,title).waitFor();};
  let release;
  try{
    let a=await launch('alice');const b=await launch('bob');await connect(a.page,'alice');await connect(b.page,'bob');
    assert.equal(await info(a.page).getByLabel('项目简介',{exact:true}).inputValue(),'');await a.page.getByText('暂无项目动态',{exact:true}).waitFor();
    assert.equal(await a.page.locator('.team-overview-members strong').count(),4);
    await info(a.page).getByLabel('项目名称',{exact:true}).fill('双人概览验收');await info(a.page).getByLabel('项目简介',{exact:true}).fill('共享初稿');
    await info(a.page).getByRole('button',{name:'保存基本信息到团队',exact:true}).click();await saved(info(a.page));
    await until(async()=>await info(b.page).getByLabel('项目简介',{exact:true}).inputValue()==='共享初稿','Shared info not refreshed');
    await until(async()=>(await b.page.locator('.ps-trigger').innerText()).includes('双人概览验收'),'Project name not refreshed');
    await info(a.page).getByLabel('项目简介',{exact:true}).fill('Alice 草稿');await info(b.page).getByLabel('项目简介',{exact:true}).fill('Bob 新版');
    await info(b.page).getByRole('button',{name:'保存基本信息到团队',exact:true}).click();await saved(info(b.page));
    await info(a.page).getByRole('region',{name:'内容冲突',exact:true}).waitFor();assert.equal(await info(a.page).getByLabel('项目简介',{exact:true}).inputValue(),'Alice 草稿');
    await info(a.page).getByLabel('项目简介',{exact:true}).fill('Alice 与 Bob 合并');await info(a.page).getByRole('button',{name:'已合并，准备提交',exact:true}).click();
    await info(a.page).getByRole('button',{name:'保存基本信息到团队',exact:true}).click();await saved(info(a.page));
    await create(a.page,'原型');await create(b.page,'测试');await milestone(a.page,'测试').waitFor();await milestone(b.page,'原型').waitFor();
    await milestone(a.page,'原型').getByLabel('负责人',{exact:true}).fill('Alice');await milestone(b.page,'测试').getByLabel('负责人',{exact:true}).fill('Bob');
    await milestone(a.page,'原型').getByRole('button',{name:'保存里程碑到团队',exact:true}).click();await milestone(b.page,'测试').getByRole('button',{name:'保存里程碑到团队',exact:true}).click();
    await saved(milestone(a.page,'原型'));await saved(milestone(b.page,'测试'));
    await until(async()=>await milestone(b.page,'原型').getByLabel('负责人',{exact:true}).inputValue()==='Alice','Independent milestone not refreshed');
    await milestone(a.page,'原型').getByLabel('里程碑状态',{exact:true}).selectOption('done');await milestone(b.page,'原型').getByLabel('负责人',{exact:true}).fill('冲突草稿');
    await milestone(a.page,'原型').getByRole('button',{name:'保存里程碑到团队',exact:true}).click();await saved(milestone(a.page,'原型'));
    await milestone(b.page,'原型').getByRole('region',{name:'内容冲突',exact:true}).waitFor();await milestone(b.page,'原型').getByRole('button',{name:'采用最新版本并丢弃草稿',exact:true}).click();
    assert.equal(await milestone(b.page,'原型').getByLabel('里程碑状态',{exact:true}).inputValue(),'done');assert.ok((await b.page.locator('.overview-progress').innerText()).includes('50%'));
    // Offline drafts remain editable and survive module changes, server management and a client restart.
    await a.page.route('**/api/team/projects/team-demo/overview',route=>route.abort('failed'));
    await info(a.page).getByLabel('项目简介',{exact:true}).fill('离线草稿');await info(a.page).getByRole('button',{name:'保存基本信息到团队',exact:true}).click();
    await until(async()=>await info(a.page).getByRole('alert').count()>0,'Offline failure not shown');
    await nav(a.page,'故事文档');await a.page.getByLabel('文档正文',{exact:true}).fill('故事草稿同样保留');await nav(a.page,'项目概览');
    assert.equal(await info(a.page).getByLabel('项目简介',{exact:true}).inputValue(),'离线草稿');await a.page.getByRole('button',{name:'服务器管理',exact:true}).click();
    await a.page.getByRole('button',{name:'返回工作区',exact:true}).click();assert.equal(await info(a.page).getByLabel('项目简介',{exact:true}).inputValue(),'离线草稿');
    await a.page.getByRole('button',{name:'添加里程碑',exact:true}).click();await newMilestone(a.page).getByLabel('负责人',{exact:true}).fill('未命名草稿');
    await a.app.close();apps.delete(a.app);a=await launch('alice');await connect(a.page,'alice');
    assert.equal(await info(a.page).getByLabel('项目简介',{exact:true}).inputValue(),'离线草稿');assert.equal(await newMilestone(a.page).getByLabel('负责人',{exact:true}).inputValue(),'未命名草稿');
    await nav(a.page,'故事文档');assert.equal(await a.page.getByLabel('文档正文',{exact:true}).inputValue(),'故事草稿同样保留');await nav(a.page,'项目概览');
    await info(a.page).getByRole('button',{name:'保存基本信息到团队',exact:true}).click();await saved(info(a.page));
    // Lose a successful new-milestone response. Polling recognizes the same UUID without duplicating it.
    await newMilestone(a.page).getByLabel('里程碑名称',{exact:true}).fill('恢复后的新里程碑');
    let committed=false;const held=new Promise(resolve=>{release=resolve;});
    await a.page.route('**/api/team/projects/team-demo/milestones/*',async route=>{const response=await route.fetch();assert.equal(response.status(),200);committed=true;await held;await route.abort('failed');},{times:1});
    await newMilestone(a.page).getByRole('button',{name:'保存里程碑到团队',exact:true}).click();await until(()=>committed,'New milestone not committed');
    release();await milestone(a.page,'恢复后的新里程碑').waitFor();assert.equal((await api('/projects/team-demo/overview',token)).milestones.length,3);
    await fs.mkdir(path.join(root,'.gamecreator/qa'),{recursive:true});await a.page.locator('.team-project main').evaluate(element=>element.scrollTop=0);await a.page.evaluate(()=>window.scrollTo(0,0));await a.page.screenshot({path:path.join(root,'.gamecreator/qa/team-overview.png'),fullPage:true});
    // A live demotion disables editing while retaining the member's unsent draft.
    await info(b.page).getByLabel('项目简介',{exact:true}).fill('权限变化前的草稿');
    const members=await api('/projects/team-demo/members',token);
    await api('/projects/team-demo/members',token,'PUT',{revision:members.revision,members:members.members.map(member=>({userId:member.userId,role:member.userId==='bob'?'viewer':member.role}))});
    await until(async()=>await info(b.page).getByLabel('项目简介',{exact:true}).isDisabled(),'Viewer remained writable');
    assert.equal(await info(b.page).getByLabel('项目简介',{exact:true}).inputValue(),'权限变化前的草稿');assert.equal(await b.page.getByRole('button',{name:'添加里程碑',exact:true}).count(),0);
    const latest=await api('/projects/team-demo/members',token);await api('/projects/team-demo/members',token,'PUT',{revision:latest.revision,members:latest.members.filter(member=>member.userId!=='bob').map(({userId,role})=>({userId,role}))});
    await until(async()=>!(await info(b.page).isVisible()),'Revoked member still sees overview');assert.deepEqual(errors,[]);
    console.log('PASS: two-client overview/name sync, independent milestone revisions and conflicts, completion/activity, offline and restart drafts, story/server navigation, lost acknowledgement without duplicates, live demotion and revocation.');
  }catch(error){for(const page of pages)if(!page.isClosed())console.error((await page.locator('body').innerText()).slice(0,6000));throw error;}
  finally{release?.();for(const app of apps)await app.close();await service.close();assert.ok(path.resolve(directory).startsWith(path.resolve(prefix)));await fs.rm(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
