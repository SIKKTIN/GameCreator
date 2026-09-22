const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createWorkspaceStorage}=require('../desktop/test-workspaces.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
 const {toData}=await import('../shared/data-sync.mjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-table-delete-')),dataDir=path.join(dir,'data'),storage=createWorkspaceStorage(dataDir);
 const id='table-delete-test',key='gamecreator.enum-versions.v1:'+id,defKey='gamecreator.workspace.v1:'+id+':definitions';
 const config={engine:'oasis-lua',projectPath:'',enumPath:'Script/Const',dataPath:'Script/Config',outputFormat:'lua',autoSync:false,backupBeforeSync:true};
 storage.setItem('gamecreator.projects.v1',JSON.stringify({schema:2,mode:'project',activeId:id,projects:[{id,name:'删除表测试',initialContent:'empty',config}]}));
 let data=toData({datasets:{},columns:{}},'plants',[{id:'pea',cost:100}]);data=toData(data,'manifest',{version:1});
 data.datasets.empty=[];data.columns.empty=[{key:'id',label:'ID',type:'text'}];
 data.datasets.references=[];data.columns.references=[{key:'id',label:'ID'},{key:'plant',label:'植物',type:'reference',reference:'plants'}];
 storage.setItem(key,JSON.stringify({schema:1,revision:0,activeId:null,candidateId:null,snapshots:[],reviews:{},releases:[],data}));
 storage.setItem(defKey,JSON.stringify(Object.keys(data.datasets).map(key=>({key,label:key,badge:'',columns:data.columns[key]}))));
 const read=()=>JSON.parse(storage.getItem(key));const env={...process.env,GAMECREATOR_DATA_DIR:dataDir,GAMECREATOR_USER_DATA_DIR:path.join(dir,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 let app,page;const errors=[];const button=name=>page.getByRole('button',{name,exact:true});const table=name=>page.getByRole('button',{name:new RegExp('^'+name+'，')});const dialog=()=>page.getByRole('dialog',{name:'删除配置表',exact:true});
 const openDelete=async name=>{await table(name).click({button:'right'});await page.getByRole('menuitem',{name:'删除表',exact:true}).click();await dialog().waitFor();};
 async function launch(){app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await button('进入本地工作区').click();await button('数据配置').click();if(await button('展开空表').count())await button('展开空表').click();}
 try{
  await launch();const initial=storage.getItem(key);await openDelete('manifest');await dialog().getByRole('button',{name:'取消',exact:true}).click();assert.equal(storage.getItem(key),initial);
  await table('empty').focus();await table('empty').press('Shift+F10');await page.getByRole('menu').waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByRole('menu').count(),0);
  await openDelete('plants');assert.ok((await dialog().innerText()).includes('references / 植物'));assert.equal(await button('确认删除表').isDisabled(),true);await button('取消').click();
  await table('manifest').click();
  const beforeFailure=storage.getItem(key),defsBeforeFailure=storage.getItem(defKey);
  await app.evaluate(({ipcMain},key)=>{globalThis.deleteTableHandler=ipcMain.listeners('workspace-storage')[0];ipcMain.removeAllListeners('workspace-storage');ipcMain.on('workspace-storage',(event,request)=>{if(request?.operation==='set'&&request.key===key)event.returnValue={ok:false,error:'模拟删除保存失败'};else globalThis.deleteTableHandler(event,request);});},key);
  await openDelete('empty');await button('确认删除表').click();await page.getByText('删除未保存，请检查页面保存状态后重试。',{exact:true}).waitFor();
  assert.equal(storage.getItem(key),beforeFailure);assert.equal(storage.getItem(defKey),defsBeforeFailure);await button('取消').click();
  await app.evaluate(({ipcMain})=>{ipcMain.removeAllListeners('workspace-storage');ipcMain.on('workspace-storage',globalThis.deleteTableHandler);});
  await app.close();app=null;await launch();await table('manifest').click();await openDelete('empty');await button('确认删除表').click();await dialog().waitFor({state:'hidden'});assert.ok(!Object.hasOwn(read().data.datasets,'empty'));assert.equal(await table('manifest').getAttribute('aria-current'),'page');
  await openDelete('manifest');await button('确认删除表').click();await dialog().waitFor({state:'hidden'});assert.ok(!Object.hasOwn(read().data.jsonFormats,'manifest'));assert.equal(await table('plants').getAttribute('aria-current'),'page');
  await app.close();app=null;await launch();assert.equal(await table('manifest').count(),0);assert.equal(await table('empty').count(),0);assert.deepEqual(read().data.datasets.plants,data.datasets.plants);
  await openDelete('references');await button('确认删除表').click();await dialog().waitFor({state:'hidden'});
  await openDelete('plants');await button('确认删除表').click();await page.getByRole('heading',{name:'还没有配置表',exact:true}).waitFor();assert.deepEqual(read().data,{datasets:{},columns:{},jsonFormats:{}});assert.deepEqual(JSON.parse(storage.getItem(defKey)),[]);
  await app.close();app=null;await launch();await page.getByRole('heading',{name:'还没有配置表',exact:true}).waitFor();
  await fs.mkdir(path.join(root,'.gamecreator/qa'),{recursive:true});await page.screenshot({path:path.join(root,'.gamecreator/qa/table-delete-empty.png')});assert.deepEqual(errors,[]);
  console.log('PASS delete tables: cancel, keyboard menu, reference guard, inactive/active/object/last table, fields and JSON cleanup, unchanged other rows and restart persistence.');
 }catch(e){if(page&&!page.isClosed())console.error((await page.locator('body').innerText()).slice(-4500));throw e;}finally{if(app)await app.close();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('gc-table-delete-'));await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
