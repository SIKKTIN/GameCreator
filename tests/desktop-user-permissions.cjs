// Real Electron clients use isolated profiles and a temporary server only.
const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {createCollaborationServer}=require('../server/collaboration.cjs');
const root=path.resolve(__dirname,'..');
const until=async(check,message)=>{const end=Date.now()+20000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(message);};
(async()=>{
  const prefix=path.join(os.tmpdir(),'gc-permission-ui-'),directory=await fs.mkdtemp(prefix);
  const service=await createCollaborationServer({directory:path.join(directory,'server'),port:0});
  const apps=[],pages=[],errors=[];let release;
  const launch=async username=>{
    const env={...process.env,GAMECREATOR_DATA_DIR:path.join(directory,username,'data'),GAMECREATOR_USER_DATA_DIR:path.join(directory,username,'profile'),GAMECREATOR_TEAM_DATA_DIR:path.join(directory,'server'),GAMECREATOR_TEAM_PORT:new URL(service.url).port};
    delete env.ELECTRON_RUN_AS_NODE;delete env.GAMECREATOR_TEAM_ACCOUNT;
    const app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env,timeout:30000});apps.push(app);
    const page=await app.firstWindow();pages.push(page);page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
    await page.getByLabel('账号',{exact:true}).fill(username);await page.getByLabel('密码',{exact:true}).fill(username+'123');await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('.ps-trigger').waitFor();return page;
  };
  const dialog=(page,name)=>page.getByRole('dialog',{name,exact:true});
  const connection=page=>dialog(page,'连接团队服务器');
  const credentials=async(page,user,password)=>{await connection(page).getByLabel('协作服务地址',{exact:true}).fill(service.url);await connection(page).getByLabel('团队账号',{exact:true}).fill(user);await connection(page).getByLabel('团队密码',{exact:true}).fill(password);await connection(page).getByRole('button',{name:'连接并进入项目',exact:true}).click();};
  const connect=async(page,user,password=user+'123')=>{await page.locator('.ps-trigger').click();await page.getByRole('menuitem',{name:'连接团队服务器',exact:true}).click();await credentials(page,user,password);await connection(page).waitFor({state:'hidden'});};
  const nav=(page,name)=>page.getByRole('navigation',{name:'工作区模块',exact:true}).getByRole('button',{name,exact:true}).click();
  const info=page=>page.getByRole('form',{name:'项目基本信息',exact:true});
  const manager=page=>page.getByRole('main',{name:'用户与权限',exact:true});
  const configure=async(page,overview,stories)=>{
    await manager(page).getByRole('button',{name:'配置项目权限：多人协作验证项目',exact:true}).click();const d=dialog(page,'成员管理');
    await d.getByLabel('bob 项目概览权限',{exact:true}).selectOption(overview);await d.getByLabel('bob 故事文档权限',{exact:true}).selectOption(stories);
    return d;
  };
  const saveMembers=async d=>{await d.getByRole('button',{name:'保存成员配置',exact:true}).click();await d.waitFor({state:'hidden'});};
  const accountState=async(page,name,state)=>{await manager(page).getByRole('button',{name:'管理账号：'+name,exact:true}).click();const d=dialog(page,'管理协作账号');await d.getByLabel('账号状态',{exact:true}).selectOption(state);await d.getByRole('button',{name:'保存账号配置',exact:true}).click();await d.waitFor({state:'hidden'});};
  try{
    const a=await launch('admin'),b=await launch('user');assert.equal(await b.getByRole('button',{name:'用户与权限',exact:true}).count(),0);
    await a.getByRole('button',{name:'用户与权限',exact:true}).click();await manager(a).getByRole('button',{name:'连接服务器管理员',exact:true}).click();
    assert.equal(await connection(a).getByLabel('团队密码',{exact:true}).inputValue(),'');await credentials(a,'admin','admin123');await manager(a).getByRole('button',{name:'创建协作账号',exact:true}).waitFor();
    await connect(b,'bob');await nav(b,'项目概览');assert.ok(await info(b).getByLabel('项目简介',{exact:true}).isDisabled());assert.equal(await b.getByRole('button',{name:'添加里程碑',exact:true}).count(),0);
    await nav(b,'故事文档');await b.getByLabel('文档正文',{exact:true}).fill('故事撤权前的草稿');
    // A new account request succeeds but its acknowledgement is lost. It remains a single account after refresh.
    await manager(a).getByRole('button',{name:'创建协作账号',exact:true}).click();const create=dialog(a,'创建协作账号');await create.getByLabel('新账号',{exact:true}).fill('writer.new');await create.getByLabel('初始密码',{exact:true}).fill('WriterPass-123');
    let committed=false;const held=new Promise(resolve=>release=resolve);
    await a.route('**/api/team/admin/users',async route=>{if(route.request().method()!=='POST')return route.continue();const response=await route.fetch();assert.equal(response.status(),201);committed=true;await held;await route.abort('failed');});
    await create.getByRole('button',{name:'创建账号',exact:true}).click();await until(()=>committed,'Account creation did not commit');
    assert.deepEqual(await a.evaluate(()=>['gamecreator:before-logout','gamecreator:leave-team'].map(name=>window.dispatchEvent(new Event(name,{cancelable:true})))),[false,false]);
    assert.ok(await create.getByRole('button',{name:'取消',exact:true}).isDisabled());release();await create.getByText(/操作结果尚未确认/).waitFor();await create.getByRole('button',{name:'取消',exact:true}).click();await a.unroute('**/api/team/admin/users');
    await manager(a).getByRole('button',{name:'管理账号：writer.new',exact:true}).waitFor();assert.equal(await manager(a).getByRole('button',{name:'管理账号：writer.new',exact:true}).count(),1);
    let members=await configure(a,'edit','view');await members.getByLabel('writer.new 权限',{exact:true}).selectOption('editor');
    await fs.mkdir(path.join(root,'.gamecreator/qa'),{recursive:true});await a.screenshot({path:path.join(root,'.gamecreator/qa/project-module-permissions.png')});await saveMembers(members);
    await until(()=>b.getByLabel('文档正文',{exact:true}).isDisabled(),'Story permission was not revoked');assert.equal(await b.getByLabel('文档正文',{exact:true}).inputValue(),'故事撤权前的草稿');assert.equal(await b.getByRole('button',{name:'从本地导入故事',exact:true}).count(),0);
    await nav(b,'项目概览');await until(()=>info(b).getByLabel('项目简介',{exact:true}).isEnabled(),'Overview grant did not arrive');
    await info(b).getByLabel('项目简介',{exact:true}).fill('Bob 获得授权后的概览');await info(b).getByRole('button',{name:'保存基本信息到团队',exact:true}).click();await until(async()=>(await info(b).locator('.team-record-state').innerText()).includes('与团队内容一致'),'Authorized overview did not save');
    await info(b).getByLabel('项目简介',{exact:true}).fill('概览撤权前的草稿');await b.getByRole('button',{name:'添加里程碑',exact:true}).click();await b.getByRole('form',{name:'新里程碑',exact:true}).getByLabel('里程碑名称',{exact:true}).fill('未提交里程碑');
    members=await configure(a,'inherit','inherit');await saveMembers(members);await until(()=>info(b).getByLabel('项目简介',{exact:true}).isDisabled(),'Overview revocation did not arrive');
    assert.equal(await info(b).getByLabel('项目简介',{exact:true}).inputValue(),'概览撤权前的草稿');assert.ok(await b.getByRole('form',{name:'新里程碑',exact:true}).getByLabel('里程碑名称',{exact:true}).isDisabled());
    await nav(b,'故事文档');await until(()=>b.getByLabel('文档正文',{exact:true}).isEnabled(),'Story permission not restored');assert.equal(await b.getByLabel('文档正文',{exact:true}).inputValue(),'故事撤权前的草稿');
    await connect(b,'writer.new','WriterPass-123');await b.getByLabel('文档正文',{exact:true}).fill('密码重置前的草稿');
    await manager(a).getByRole('button',{name:'重置密码：writer.new',exact:true}).click();const reset=dialog(a,'重置协作密码');await reset.getByLabel('新密码',{exact:true}).fill('ChangedPass-123');await reset.getByRole('button',{name:'确认重置密码',exact:true}).click();await reset.waitFor({state:'hidden'});
    await until(async()=>!(await b.getByLabel('文档正文',{exact:true}).isVisible()),'Password reset left content accessible');
    await b.getByRole('button',{name:'连接设置',exact:true}).click();await credentials(b,'writer.new','WriterPass-123');await connection(b).getByRole('alert').waitFor();await credentials(b,'writer.new','ChangedPass-123');await connection(b).waitFor({state:'hidden'});
    assert.equal(await b.getByLabel('文档正文',{exact:true}).inputValue(),'密码重置前的草稿');
    await accountState(a,'writer.new','disabled');await until(async()=>!(await b.getByLabel('文档正文',{exact:true}).isVisible()),'Disabled session left content accessible');
    await b.getByRole('button',{name:'连接设置',exact:true}).click();await credentials(b,'writer.new','ChangedPass-123');await connection(b).getByRole('alert').waitFor();
    await accountState(a,'writer.new','enabled');await credentials(b,'writer.new','ChangedPass-123');await connection(b).waitFor({state:'hidden'});assert.equal(await b.getByLabel('文档正文',{exact:true}).inputValue(),'密码重置前的草稿');
    await manager(a).getByRole('button',{name:'管理账号：admin',exact:true}).click();const admin=dialog(a,'管理协作账号');await admin.getByLabel('账号状态',{exact:true}).selectOption('disabled');await admin.getByRole('button',{name:'保存账号配置',exact:true}).click();await admin.getByText('至少保留一位启用的服务器管理员',{exact:true}).waitFor();await admin.getByRole('button',{name:'取消',exact:true}).click();
    // The management module preserves the active workspace and its draft.
    await manager(a).getByRole('button',{name:'返回工作区',exact:true}).click();await nav(a,'项目概览');await info(a).getByLabel('项目简介',{exact:true}).fill('管理员工作区草稿');await a.getByRole('button',{name:'用户与权限',exact:true}).click();
    await manager(a).getByRole('button',{name:'管理账号：writer.new',exact:true}).waitFor();await a.screenshot({path:path.join(root,'.gamecreator/qa/user-permissions.png')});await manager(a).getByRole('button',{name:'返回工作区',exact:true}).click();assert.equal(await info(a).getByLabel('项目简介',{exact:true}).inputValue(),'管理员工作区草稿');
    await connect(b,'bob');await nav(b,'项目概览');assert.equal(await info(b).getByLabel('项目简介',{exact:true}).inputValue(),'概览撤权前的草稿');assert.ok(await info(b).getByLabel('项目简介',{exact:true}).isDisabled());assert.equal(await b.getByRole('form',{name:'新里程碑',exact:true}).getByLabel('里程碑名称',{exact:true}).inputValue(),'未提交里程碑');
    assert.deepEqual(errors,[]);console.log('PASS: independent admin module; standard team login/new accounts; no entry for local user; default overview read-only; explicit module grants/revocation and preserved drafts; lost create response; password reset and disabled sessions; administrator protection; manager/workspace navigation.');
  }catch(error){for(const page of pages)if(!page.isClosed())console.error((await page.locator('body').innerText()).slice(0,6000));throw error;}
  finally{release?.();for(const app of apps)await app.close();await service.close();assert.ok(path.resolve(directory).startsWith(path.resolve(prefix)));await fs.rm(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
