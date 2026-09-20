const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createWorkspaceStorage}=require('../desktop/test-workspaces.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-map-portals-'));
 const storage=createWorkspaceStorage(path.join(dir,'data')),qa=path.join(root,'.gamecreator/qa');await fs.mkdir(qa,{recursive:true});
 const {createDesignMap}=await import('../src/map-design.ts'),{defaultTravel}=await import('../src/map-world.ts');
 const a=createDesignMap('A 回廊'),b=createDesignMap('B 试炼');
 const portal=(m,id,x,y)=>({id,name:id,kind:'portal',layerId:m.layers[0].id,x,y,width:1,height:1,color:'blue',notes:'',references:[]});
 for(const m of [a,b]){m.perspective='side';m.rows=10;m.columns=20;m.y=0;}a.x=0;b.x=240;
 a.objects=[portal(a,'A去B的门',10,4)];b.objects=[portal(b,'B安全点',2,4)];
 const link={id:'route',name:'A → B',from:a.id,to:b.id,fromObjectId:a.objects[0].id,toObjectId:b.objects[0].id,direction:'both',kind:'passage',condition:'',travel:{...defaultTravel(),forward:'jump',reverse:'jump',maxRise:100,maxGap:100,maxDrop:100}};
 const fixture={schema:1,enabled:true,maps:[a,b],connections:[link]},id='project-'+crypto.randomUUID(),key='gamecreator.workspace.v1:'+id+':map-design',raw=JSON.stringify(fixture);
 const config={engine:'oasis-lua',projectPath:'',enumPath:'Script/Const',dataPath:'Script/Config',outputFormat:'lua',autoSync:false,backupBeforeSync:true};
 storage.setItem(key,raw);storage.setItem('gamecreator.projects.v1',JSON.stringify({schema:2,activeId:id,mode:'project',projects:[{id,name:'旧项目出入口回归',config,initialContent:'empty'}]}));
 const env={...process.env,GAMECREATOR_DATA_DIR:path.join(dir,'data'),GAMECREATOR_USER_DATA_DIR:path.join(dir,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 let app,page;const errors=[],read=()=>JSON.parse(storage.getItem(key));
 const button=name=>page.getByRole('button',{name,exact:true}),click=name=>button(name).click(),select=name=>page.getByRole('combobox',{name,exact:true}),number=name=>page.getByRole('spinbutton',{name,exact:true});
 const route=()=>button('世界通路：A → B'),chooseRoute=()=>page.locator('.md-link-list button').filter({hasText:'A → B'}).click();
 async function launch(){app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));await click('登录');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1780,1100));await click('地图设计');}
 async function inspectSides(from,to){assert.equal(await route().getAttribute('data-from-side'),from);assert.equal(await route().getAttribute('data-to-side'),to);await chooseRoute();assert.equal(await select('出口所在侧面').inputValue(),from);assert.equal(await select('入口所在侧面').inputValue(),to);}
 async function blocked(reason){assert.equal(await route().getAttribute('data-route-allowed'),'false');await page.locator('.mw-route-status.warn').filter({hasText:reason}).first().waitFor();await click('通路预演');await select('预演起点').selectOption(a.id);assert.equal(await button('沿此通路前进').isDisabled(),true);await click('世界总览');await chooseRoute();}
 try{
  await launch();await inspectSides('right','left');assert.equal(storage.getItem(key),raw);assert.equal(await route().getAttribute('data-route-allowed'),'true');
  await app.evaluate(({ipcMain},key)=>{globalThis.portalHandler=ipcMain.listeners('workspace-storage')[0];ipcMain.removeAllListeners('workspace-storage');ipcMain.on('workspace-storage',(e,r)=>r.operation==='set'&&r.key===key?e.returnValue={ok:false,error:'模拟朝向保存失败'}:globalThis.portalHandler(e,r));},key);
  await page.getByRole('textbox',{name:'世界单位',exact:true}).fill('格');await button('重试保存地图').waitFor();assert.equal(storage.getItem(key),raw);
  await app.evaluate(({ipcMain})=>{ipcMain.removeAllListeners('workspace-storage');ipcMain.on('workspace-storage',globalThis.portalHandler);});await click('重试保存地图');
  assert.equal(read().connections[0].fromSide,'right');assert.equal(read().connections[0].toSide,'left');assert.deepEqual(read().maps.map(m=>m.objects),[a.objects,b.objects]);
  await page.locator('.mw-shell').screenshot({path:path.join(qa,'portal-horizontal-fixed.png')});
  await select('出口所在侧面').selectOption('top');await blocked('朝向不匹配');assert.equal(await button('移动终点地图以对齐出入口').isDisabled(),true);
  await click('按当前布局设置朝向');await inspectSides('right','left');assert.equal(await route().getAttribute('data-route-allowed'),'true');
  await page.locator('.md-map-card').filter({hasText:'B 试炼'}).click();await number('世界纵坐标（向下）').fill('-14');await number('世界横坐标').fill('0');await inspectSides('right','left');await blocked('固定出入口朝向冲突');
  await select('世界总览类型').selectOption('top');await inspectSides('right','left');await blocked('固定出入口朝向冲突');await select('世界总览类型').selectOption('side');
  await click('按当前布局设置朝向');await inspectSides('top','bottom');assert.equal(await route().getAttribute('data-route-allowed'),'true');
  await click('移动终点地图以对齐出入口');assert.equal(read().maps[1].placement.y,-10);assert.equal(await route().getAttribute('data-route-allowed'),'true');
  await select('入口所在侧面').selectOption('left');await blocked('朝向不匹配');await select('连接类型').selectOption('transport');assert.equal(await route().getAttribute('data-route-allowed'),'true');
  await click('通路预演');await select('预演起点').selectOption(a.id);assert.equal(await button('沿此通路前进').isDisabled(),false);await click('沿此通路前进');assert.equal(await page.locator('.md-travel h2').innerText(),'B 试炼');
  await click('世界总览');await chooseRoute();await select('连接类型').selectOption('passage');await click('按当前布局设置朝向');await inspectSides('top','bottom');
  const final=storage.getItem(key);await app.close();app=null;await launch();await inspectSides('top','bottom');assert.equal(storage.getItem(key),final);assert.deepEqual(read().maps.map(m=>m.objects),[a.objects,b.objects]);assert.deepEqual(errors,[]);
  console.log('PASS portals: legacy read-only migration, fixed sides, retry persistence, mismatched faces, wrong-side rooms, perspective switch, explicit reset, alignment, transport, preview and restart.');
 }catch(error){if(page&&!page.isClosed()){console.error((await page.locator('body').innerText()).slice(-6000));await page.screenshot({path:path.join(qa,'portal-failure.png'),fullPage:true});}throw error;}
 finally{if(app)await app.close();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
