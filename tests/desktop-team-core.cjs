// Two isolated Electron profiles and a temporary collaboration database.
const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {createCollaborationServer}=require('../server/collaboration.cjs');
const {coreChanges}=require('../src/team-core-model.ts');
const root=path.resolve(__dirname,'..'),qa=path.join(root,'.gamecreator/qa');
const until=async(check,message)=>{const end=Date.now()+20000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,80));}throw new Error(message);};
(async()=>{
  const prefix=path.join(os.tmpdir(),'gc-core-ui-'),directory=await fs.mkdtemp(prefix),apps=new Set(),pages=[],errors=[];
  const service=await createCollaborationServer({directory:path.join(directory,'server'),port:0});
  const api=async(route,token,method='GET',body)=>{const res=await fetch(service.url+'/api/team'+route,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+(token||'')},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(res.ok,route+' '+res.status+' '+await res.clone().text());return res.json();};
  const token=(await api('/login','','POST',{username:'admin',password:'admin123'})).token,route='/projects/team-demo/core';
  const n=(id,title,childGraphId='')=>({id,title,kind:childGraphId?'module':'activity',description:'',childGraphId,x:100,y:100,gameplayIds:[]});
  const g=(id,title,nodes)=>({id,title,summary:'',nodes,edges:[]});
  const initial={schema:1,rootId:'root',graphs:[g('root','游戏入口',[n('module-a','战斗循环','a'),{...n('module-b','养成循环','b'),x:450}]),g('a','战斗循环',[n('fight','战斗')]),g('b','养成循环',[n('grow','养成')])]};
  const base=await api(route,token);await api(route,token,'PUT',{rootId:'root',requestId:crypto.randomUUID(),changes:coreChanges(base,initial)});
  const launch=async profile=>{
    const env={...process.env,GAMECREATOR_DATA_DIR:path.join(directory,profile,'data'),GAMECREATOR_USER_DATA_DIR:path.join(directory,profile,'profile'),GAMECREATOR_TEAM_DATA_DIR:path.join(directory,'server'),GAMECREATOR_TEAM_PORT:new URL(service.url).port};
    delete env.ELECTRON_RUN_AS_NODE;delete env.GAMECREATOR_TEAM_ACCOUNT;
    const app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env,timeout:30000});apps.add(app);
    const page=await app.firstWindow();pages.push(page);page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
    await page.getByLabel('账号',{exact:true}).fill('admin');await page.getByLabel('密码',{exact:true}).fill('admin123');await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('.ps-trigger').waitFor();return {app,page};
  };
  const nav=(p,name)=>p.getByRole('navigation',{name:'工作区模块',exact:true}).getByRole('button',{name,exact:true}).click();
  const button=(p,name)=>p.getByRole('button',{name,exact:true});
  const graph=(p,name)=>button(p,'打开流程：'+name).click();
  const node=(p,name)=>button(p,'选择节点：'+name);
  const connect=async(p,user)=>{
    await p.locator('.ps-trigger').click();await p.getByRole('menuitem',{name:'连接团队服务器',exact:true}).click();
    const dialog=p.getByRole('dialog',{name:'连接团队服务器',exact:true});await dialog.getByLabel('协作服务地址',{exact:true}).fill(service.url);await dialog.getByLabel('团队账号',{exact:true}).fill(user);await dialog.getByLabel('团队密码',{exact:true}).fill(user+'123');await button(dialog,'连接并进入项目').click();
    await p.locator('.team-project .story-workspace').waitFor();await nav(p,'玩法核心');await p.locator('.team-core .gc-workspace').waitFor();
  };
  const saved=p=>until(async()=>(await p.getByTestId('core-save-state').innerText()).includes('已与团队同步'),'Core save not confirmed');
  const save=async p=>{await button(p,'保存玩法核心到团队').click();await saved(p);};
  const pos=(p,title)=>node(p,title).evaluate(el=>({x:el.closest('.gc-node').style.left,y:el.closest('.gc-node').style.top}));
  const drag=async(p,title)=>{await node(p,title).scrollIntoViewIfNeeded();const box=await node(p,title).boundingBox();const x=box.x+box.width/2,y=box.y+box.height/2;await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x+110,y+65,{steps:12});await p.mouse.up();};
  let release;
  try{
    let a=await launch('alice');const b=await launch('bob');await connect(a.page,'alice');await connect(b.page,'bob');
    const before=await api(route,token),other=await pos(b.page,'战斗循环');let puts=0;a.page.on('request',r=>{if(r.method()==='PUT'&&r.url().endsWith('/core'))puts++;});
    await a.app.evaluate(({ipcMain})=>{globalThis.layoutBatchWrites=0;globalThis.originalLayoutHandler=ipcMain.listeners('workspace-storage')[0];ipcMain.removeAllListeners('workspace-storage');ipcMain.on('workspace-storage',(event,request)=>{if(request?.operation==='set'&&request.key?.startsWith('gamecreator.team-core-layout.v1:'))globalThis.layoutBatchWrites++;globalThis.originalLayoutHandler(event,request);});});
    await button(a.page,'全选节点').click();assert.equal(await a.page.locator('.gc-node.is-selected').count(),2);const secondBefore=await pos(a.page,'养成循环');await drag(a.page,'战斗循环');const secondAfter=await pos(a.page,'养成循环');assert.notDeepEqual(secondAfter,secondBefore);const mine=await pos(a.page,'战斗循环');assert.notDeepEqual(mine,other);assert.deepEqual(await pos(b.page,'战斗循环'),other);assert.equal(parseFloat(secondAfter.x)-parseFloat(mine.x),350);assert.equal(parseFloat(secondAfter.y)-parseFloat(mine.y),0);
    assert.equal(await a.app.evaluate(()=>globalThis.layoutBatchWrites),1,'group layout should write once');await saved(a.page);assert.equal(puts,0);assert.deepEqual(await api(route,token),before);
    await graph(a.page,'战斗循环');await graph(b.page,'养成循环');await a.page.getByLabel('流程图说明',{exact:true}).fill('Alice 战斗');await b.page.getByLabel('流程图说明',{exact:true}).fill('Bob 养成');
    await save(a.page);await save(b.page);await graph(b.page,'战斗循环');await until(async()=>await b.page.getByLabel('流程图说明',{exact:true}).inputValue()==='Alice 战斗','Independent graph not received');
    await a.page.getByLabel('流程图说明',{exact:true}).fill('Alice 草稿');await b.page.getByLabel('流程图说明',{exact:true}).fill('Bob 新版');await save(b.page);
    await a.page.getByRole('region',{name:'玩法核心冲突',exact:true}).waitFor();assert.equal(await a.page.getByLabel('流程图说明',{exact:true}).inputValue(),'Alice 草稿');
    await a.page.getByLabel('流程图说明',{exact:true}).fill('双方合并');await button(a.page,'已对照合并，准备提交').click();await save(a.page);
    // A locally removed module must not erase a subsequent child edit.
    await graph(a.page,'游戏入口');await node(a.page,'战斗循环').click();await button(a.page,'删除节点').click();await button(a.page,'确认删除模块').click();
    await until(async()=>await b.page.getByLabel('流程图说明',{exact:true}).inputValue()==='双方合并','Merged flow not received');await b.page.getByLabel('流程图说明',{exact:true}).fill('内部流程的新修改');await save(b.page);
    await a.page.getByRole('region',{name:'玩法核心冲突',exact:true}).waitFor();a.page.once('dialog',d=>d.accept());await button(a.page,'采用团队版本并丢弃玩法草稿').click();await node(a.page,'战斗循环').waitFor();
    // A successful save with a lost response is recognized by polling, without duplication.
    await button(a.page,'添加活动').click();await a.page.getByLabel('节点名称',{exact:true}).fill('联机新增节点');let committed=false;const held=new Promise(r=>release=r);
    await a.page.route('**/api/team/projects/team-demo/core',async r=>{if(r.request().method()!=='PUT')return r.continue();const res=await r.fetch();assert.equal(res.status(),200);committed=true;await held;await r.abort('failed');});
    await button(a.page,'保存玩法核心到团队').click();await until(()=>committed,'Content did not commit');assert.deepEqual(await a.page.evaluate(()=>['gamecreator:before-logout','gamecreator:leave-team'].map(n=>window.dispatchEvent(new Event(n,{cancelable:true})))),[false,false]);release();await saved(a.page);await a.page.unroute('**/api/team/projects/team-demo/core');
    const snapshot=await api(route,token);assert.equal(snapshot.store.graphs.find(g=>g.id==='root').nodes.filter(n=>n.title==='联机新增节点').length,1);
    // Draft and layout survive unrelated modules and a full client restart.
    await graph(a.page,'战斗循环');await a.page.getByLabel('流程图说明',{exact:true}).fill('重启保留草稿');await nav(a.page,'故事文档');await nav(a.page,'玩法核心');assert.equal(await a.page.getByLabel('流程图说明',{exact:true}).inputValue(),'重启保留草稿');
    await a.app.close();apps.delete(a.app);a=await launch('alice');await connect(a.page,'alice');assert.deepEqual(await pos(a.page,'战斗循环'),mine);assert.deepEqual(await pos(a.page,'养成循环'),secondAfter);await graph(a.page,'战斗循环');assert.equal(await a.page.getByLabel('流程图说明',{exact:true}).inputValue(),'重启保留草稿');await save(a.page);
    // Module-level permission revocation preserves the draft, while local layout still works.
    await node(b.page,'战斗').click();await b.page.getByLabel('节点说明',{exact:true}).fill('撤权前草稿');const members=await api('/projects/team-demo/members',token);
    await api('/projects/team-demo/members',token,'PUT',{revision:members.revision,members:members.members.map(m=>({userId:m.userId,role:m.role,permissions:{...m.permissions,...(m.userId==='bob'?{core:'view'}:{})}}))});
    await until(()=>b.page.getByLabel('节点说明',{exact:true}).isDisabled(),'Core permission not revoked');assert.equal(await b.page.getByLabel('节点说明',{exact:true}).inputValue(),'撤权前草稿');const bp=await pos(b.page,'战斗');await drag(b.page,'战斗');assert.notDeepEqual(await pos(b.page,'战斗'),bp);
    await connect(b.page,'viewer');await graph(b.page,'战斗循环');await node(b.page,'战斗').click();assert.ok(await b.page.getByLabel('节点说明',{exact:true}).isDisabled());const vp=await pos(b.page,'战斗');await drag(b.page,'战斗');assert.notDeepEqual(await pos(b.page,'战斗'),vp);
    await graph(b.page,'游戏入口');await button(b.page,'全选节点').click();assert.ok(await b.page.locator('.gc-node.is-selected').count()>1);const viewerServer=await api(route,token),viewerBefore=await pos(b.page,'养成循环');await drag(b.page,'战斗循环');assert.notDeepEqual(await pos(b.page,'养成循环'),viewerBefore);assert.deepEqual(await api(route,token),viewerServer);
    await fs.mkdir(qa,{recursive:true});await a.page.screenshot({path:path.join(qa,'team-gameplay-core.png'),fullPage:true});assert.deepEqual(errors,[]);
    console.log('PASS: two clients; private layout; independent graphs; conflict and subtree protection; lost acknowledgement; draft/layout restart; editor revocation and viewer layout');
  }catch(error){await fs.mkdir(qa,{recursive:true});for(const [i,p]of pages.entries())if(!p.isClosed())await p.screenshot({path:path.join(qa,'team-core-failure-'+i+'.png'),fullPage:true});throw error;}
  finally{release?.();for(const app of apps)await app.close().catch(()=>{});await service.close();assert.ok(path.resolve(directory).startsWith(path.resolve(prefix)));await fs.rm(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
