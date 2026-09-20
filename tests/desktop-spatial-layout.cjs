// Isolated Electron acceptance: no user archives or active client are modified.
const { _electron } = require(process.env.GAMECREATOR_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { createWorkspaceStorage } = require('../desktop/test-workspaces.cjs');
(async () => {
  const root = path.resolve(__dirname, '..'), dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-spatial-'));
  const storage = createWorkspaceStorage(path.join(dir,'data')), key = 'gamecreator.workspace.v1:project-spatial:gameplay';
  const { createGameplay } = await import('../src/gameplay.ts');
  const { createStageObject, createTrack, createTimelineEvent } = await import('../src/gameplay-stage.ts');
  const { createArtRequirement, emptyArtAssets } = await import('../src/art-assets.ts');
  const d=createGameplay('空间实验'), external=createGameplay('关联房间'), actor=createStageObject('actor',3,4), guard=createStageObject('goal',1,1);
  actor.name='共享角色'; guard.name='美术关联对象'; d.space.objects=[actor,guard];external.space.objects=[{...createStageObject('spawn',2,2),name:'外部门'}];
  const track=createTrack();track.name='触发';const event=createTimelineEvent(track.id);event.name='拾取';event.objectId=actor.id;d.timeline.tracks=[track];d.timeline.events=[event];
  storage.setItem(key,JSON.stringify({schema:3,designs:[d,external]}));
  const art=emptyArtAssets(),req=createArtRequirement('保留外观');req.sources=[{id:'source',kind:'gameplay',targetId:d.id,sourceKind:'object',sourceId:guard.id,note:''}];art.requirements=[req];storage.setItem('gamecreator.workspace.v1:project-spatial:art-assets',JSON.stringify(art));
  const cfg={engine:'oasis-lua',projectPath:'',enumPath:'Script/Const',dataPath:'Script/Config',outputFormat:'lua',autoSync:false,backupBeforeSync:true};
  const projects=[{id:'project-spatial',name:'空间验证',config:cfg,initialContent:'empty'}];
  for(const slug of ['plants-vs-zombies','hollow-knight','stardew-valley','disco-elysium','vampire-survivors']){
    const example=JSON.parse(await fs.readFile(path.join(root,'examples/prototypes',slug+'.json'),'utf8')),id='project-'+slug;
    projects.push({id,name:'QA '+slug,config:cfg,initialContent:'empty'});storage.setItem('gamecreator.workspace.v1:'+id+':gameplay',JSON.stringify(example.gameplay));
  }
  storage.setItem('gamecreator.projects.v1',JSON.stringify({schema:2,mode:'project',activeId:'project-spatial',projects}));
  const env={...process.env,GAMECREATOR_DATA_DIR:path.join(dir,'data'),GAMECREATOR_USER_DATA_DIR:path.join(dir,'profile'),GAMECREATOR_TEAM_DATA_DIR:path.join(dir,'team')};delete env.ELECTRON_RUN_AS_NODE;
  let app,page;const errors=[],read=()=>JSON.parse(storage.getItem(key)),button=n=>page.getByRole('button',{name:n,exact:true}).click(),field=n=>page.getByLabel(n,{exact:true}),view=n=>page.getByRole('tab',{name:n,exact:true}).click();
  const num=async(n,v)=>{await field(n).fill(String(v));await field(n).press('Tab');};
  const canvas=()=>field('空间布局画布'),cam=()=>canvas().locator('[data-camera]').getAttribute('data-camera').then(s=>s.split(',').map(Number));
  async function launch(){app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1850,1050));await button('进入本地工作区');await button('玩法设计');}
  async function choose(name){await page.locator('.ps-trigger').click();await page.getByRole('menuitemradio',{name:new RegExp('^'+name)}).click();await button('玩法设计');}
  try {
    await launch();await page.getByRole('tab',{name:/^空间布局/}).click();
    await button('编辑空间对象：美术关联对象');await button('删除空间对象');await page.getByRole('alert').filter({hasText:'保留外观'}).waitFor();assert.equal(read().designs[0].space.objects.length,2);
    await button('编辑空间对象：共享角色');await view('自由二维');await num('对象 X',-3.125);await num('对象 Y',1.375);await num('对象宽度',2.5);await num('方向角度',35);await field('范围形状').selectOption('ring');await num('作用距离',8);await num('环形内半径',5);
    const before=read().designs[0].space.objects[0];for(const name of ['网格布局','房间连接','自由二维'])await view(name);assert.deepEqual(read().designs[0].space.objects[0],before);
    await button('隐藏空间列表');await button('隐藏空间属性');assert.equal(await page.locator('.sp-list').count(),0);assert.equal(await page.locator('.sp-properties').count(),0);
    await canvas().scrollIntoViewIfNeeded();let bounds=await canvas().boundingBox(),old=await cam(),px=Math.round(bounds.x+bounds.width*.7),py=Math.round(bounds.y+250);
    const persisted=storage.getItem(key);await page.mouse.move(px,py);await page.mouse.wheel(0,-140);await page.waitForFunction(z=>Number(document.querySelector('[data-camera]').dataset.camera.split(',')[2])>z,old[2]);let next=await cam();
    const localX=px-bounds.x,localY=py-bounds.y;assert.ok(Math.abs((localX-old[0])/old[2]-(localX-next[0])/next[2])<.1);assert.ok(Math.abs((localY-old[1])/old[2]-(localY-next[1])/next[2])<.1);
    old=next;await page.mouse.down({button:'right'});await page.mouse.move(px+70,py+35,{steps:5});await page.mouse.up({button:'right'});next=await cam();assert.ok(Math.abs(next[0]-old[0]-70)<1);assert.ok(Math.abs(next[1]-old[1]-35)<1);assert.equal(storage.getItem(key),persisted);
    await button('定位所选空间对象');await canvas().scrollIntoViewIfNeeded();const node=canvas().locator('[data-object-id="'+actor.id+'"]');bounds=await node.boundingBox();const zoom=(await cam())[2],start=read().designs[0].space.objects[0].geometry;
    await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2+56*zoom,bounds.y+bounds.height/2+28*zoom,{steps:6});await page.mouse.up();
    const moved=read().designs[0].space.objects[0].geometry;assert.ok(Math.abs(moved.x-start.x-1)<.04);assert.ok(Math.abs(moved.y-start.y-.5)<.04);
    await button('显示空间属性');await button('删除空间对象');await page.getByRole('alert').filter({hasText:'时间事件引用'}).waitFor();
    const diskBeforeFailure=storage.getItem(key);
    await app.evaluate(({ipcMain})=>{globalThis.spatialStorageHandler=ipcMain.listeners('workspace-storage')[0];ipcMain.removeAllListeners('workspace-storage');ipcMain.on('workspace-storage',(event,request)=>{if(request?.operation==='set'&&request.key?.endsWith(':gameplay'))event.returnValue={ok:false,error:'QA 空间写入失败'};else globalThis.spatialStorageHandler(event,request);});});
    await field('对象说明').fill('失败后保留的空间草稿');await page.getByRole('alert').filter({hasText:'QA 空间写入失败'}).waitFor();assert.equal(storage.getItem(key),diskBeforeFailure);assert.equal(await field('对象说明').inputValue(),'失败后保留的空间草稿');
    await app.evaluate(({ipcMain})=>{ipcMain.removeAllListeners('workspace-storage');ipcMain.on('workspace-storage',globalThis.spatialStorageHandler);});await button('重试保存玩法');assert.equal(read().designs[0].space.objects[0].notes,'失败后保留的空间草稿');
    await view('房间连接');await button('添加房间');await field('房间名称').fill('农田');await field('内部布局视图').selectOption('grid');const roomA=read().designs[0].space.spatial.rooms[0];await button('进入房间布局 →');await field('放置对象类型').selectOption('spawn');await button('格子 R2 C2');await field('对象名称').fill('农田门');const door=read().designs[0].space.objects.at(-1);assert.equal(door.roomId,roomA.id);
    await page.getByRole('button',{name:'房间连接',exact:true}).click();await button('添加房间');await field('房间名称').fill('村庄');const roomB=read().designs[0].space.spatial.rooms[1];await field('房间空间来源').selectOption(external.id);await button('添加房间连接');await field('连接名称').fill('农田到村庄');await field('起点房间').selectOption(roomA.id);await field('终点房间').selectOption(roomB.id);await field('出口对象').selectOption(door.id);await field('入口对象').selectOption(external.space.objects[0].id);await field('通行方向').selectOption('one');await field('通行条件').fill('取得钥匙后开放');
    await button('显示空间列表');await button('编辑房间：农田');await button('删除房间');await page.getByRole('alert').filter({hasText:'房间仍被使用'}).waitFor();await button('编辑空间对象：农田门');await button('删除空间对象');await page.getByRole('alert').filter({hasText:'农田到村庄'}).waitFor();
    await view('房间连接');await button('隐藏空间列表');await button('隐藏空间属性');await button('适应全部空间');await canvas().scrollIntoViewIfNeeded();await fs.mkdir(path.join(root,'.gamecreator/qa'),{recursive:true});await page.locator('.sp-page').screenshot({path:path.join(root,'.gamecreator/qa/spatial-rooms.png')});
    const unchanged=JSON.stringify(read().designs[0].space.objects);const roomNode=page.getByRole('button',{name:'选择房间：农田',exact:true});bounds=await roomNode.boundingBox();await page.mouse.move(bounds.x+50,bounds.y+35);await page.mouse.down();await page.mouse.move(bounds.x+95,bounds.y+70,{steps:4});await page.mouse.up();assert.equal(JSON.stringify(read().designs[0].space.objects),unchanged);
    await page.getByRole('button',{name:'选择房间：村庄',exact:true}).dblclick();await page.getByRole('heading',{name:'关联房间',exact:true}).waitFor();await button('打开玩法：空间实验');await page.getByRole('tab',{name:/^时间轴/}).click();await button('查看时间事件：拾取');const preview=field('时间轴空间预览');await preview.getByRole('button',{name:'选择空间对象：共享角色',exact:true}).waitFor();assert.equal(await preview.getByRole('button',{name:'选择空间对象：农田门',exact:true}).count(),0);
    await page.getByRole('tab',{name:/^空间布局/}).click();await view('房间连接');const saved=storage.getItem(key);await app.close();app=null;await launch();await page.getByRole('tab',{name:/^空间布局/}).click();assert.equal(await page.getByRole('tab',{name:'房间连接',exact:true}).getAttribute('aria-selected'),'true');assert.equal(storage.getItem(key),saved);
    await button('归档玩法');assert.equal(await page.getByRole('button',{name:'添加房间',exact:true}).isDisabled(),true);const archivedRaw=storage.getItem(key);await view('自由二维');assert.equal(storage.getItem(key),archivedRaw);
    for(const slug of ['plants-vs-zombies','hollow-knight','stardew-valley','disco-elysium','vampire-survivors']){
      await choose('QA '+slug);if(slug==='vampire-survivors')await button('打开玩法：自由走位与拾取');await page.getByRole('tab',{name:/^空间布局/}).click();
      if(slug==='hollow-knight'){assert.equal(await page.getByRole('button',{name:/^选择房间：/}).count(),4);assert.equal(await page.getByRole('button',{name:/^选择房间连接：/}).count(),8);}
      if(slug==='disco-elysium')assert.equal(await page.getByRole('button',{name:/^选择房间：/}).count(),5);
      if(slug==='vampire-survivors'){await button('编辑空间对象：刷怪环 20–26 米');assert.equal(await field('环形内半径').inputValue(),'20');await button('隐藏空间列表');await button('隐藏空间属性');await button('适应全部空间');await page.locator('.sp-page').screenshot({path:path.join(root,'.gamecreator/qa/spatial-free.png')});}
    }
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,850));
    await button('显示空间列表');await button('显示空间属性');await page.locator('.sp-page').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('.sp-workspace').evaluate(el=>el.scrollWidth<=el.clientWidth+2),true,'Narrow spatial editor should not overflow');
    await page.locator('.sp-page').screenshot({path:path.join(root,'.gamecreator/qa/spatial-narrow.png')});
    assert.deepEqual(errors,[]);console.log('PASS: all 3 views, exact zoom/pan/drag, shared positions, local and linked rooms, ports/conditions, deletion guards, timeline focus, readonly/restart and 5 prototypes.');
  } catch(e) { if(page&&!page.isClosed()){await page.screenshot({path:path.join(root,'.gamecreator/qa/spatial-failure.png')});console.error((await page.locator('body').innerText()).slice(-4500));}console.error(errors);throw e; }
  finally {if(app)await app.close();await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
