const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createWorkspaceStorage}=require('../desktop/test-workspaces.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-data-folder-')),data=path.join(dir,'data'),storage=createWorkspaceStorage(data);
 const config={engine:'godot-gdscript',projectPath:'',enumPath:'.',dataPath:'data/generated',outputFormat:'json',autoSync:false,backupBeforeSync:true};
 const projects=['当前项目','其他项目','尚无内容'].map((name,i)=>({id:'project-folder-'+i,name,config:{...config},initialContent:'empty'}));
 projects[1].config.projectPath=path.join(dir,'unrelated-engine-folder');
 const catalog={schema:2,mode:'project',activeId:projects[0].id,projects};storage.setItem('gamecreator.projects.v1',JSON.stringify(catalog));
 const key='gamecreator.workspace.v1:'+projects[1].id+':project',value=JSON.stringify({name:'其他项目',description:'其他项目内容',genre:'',platform:'',version:'',status:'设计中'});storage.setItem(key,value);
 const env={...process.env,GAMECREATOR_DATA_DIR:data,GAMECREATOR_USER_DATA_DIR:path.join(dir,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 let app,page;const errors=[];
 const context=()=>page.locator('.ps-context-menu');
 async function open(name){if(!await page.getByRole('menu',{name:'项目列表',exact:true}).isVisible())await page.locator('.ps-trigger').click();await page.getByRole('menuitemradio',{name:new RegExp('^'+name)}).click({button:'right'});await context().waitFor();}
 try{
  app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.getByRole('button',{name:'进入本地工作区',exact:true}).click();
  await app.evaluate(({shell,BrowserWindow})=>{globalThis.folderCalls=[];shell.showItemInFolder=file=>globalThis.folderCalls.push({kind:'reveal',path:file});shell.openPath=async directory=>{globalThis.folderCalls.push({kind:'open',path:directory});return '';};BrowserWindow.getAllWindows()[0].setContentSize(1280,900);});
  await open('其他项目');assert.equal(JSON.parse(storage.getItem('gamecreator.projects.v1')).activeId,projects[0].id);await fs.mkdir(path.join(root,'.gamecreator/qa'),{recursive:true});await page.screenshot({path:path.join(root,'.gamecreator/qa/project-data-folder.jpg'),type:'jpeg',quality:70});
  assert.equal(await context().getByRole('menuitem',{name:'打开数据文件夹',exact:true}).evaluate(n=>n===document.activeElement),true);await page.keyboard.press('ArrowDown');assert.equal(await context().getByRole('menuitem',{name:'删除项目',exact:true}).evaluate(n=>n===document.activeElement),true);await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter');await context().waitFor({state:'hidden'});await page.waitForFunction(()=>!document.querySelector('.ps-trigger').disabled);
  assert.deepEqual(await app.evaluate(()=>globalThis.folderCalls),[{kind:'reveal',path:storage.info(key).file}]);assert.equal(storage.getItem(key),value);assert.equal(JSON.parse(storage.getItem('gamecreator.projects.v1')).activeId,projects[0].id);
  await open('尚无内容');await context().getByRole('menuitem',{name:'打开数据文件夹',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.ps-trigger').disabled);assert.deepEqual((await app.evaluate(()=>globalThis.folderCalls)).at(-1),{kind:'open',path:path.join(data,'storage')});
  const before=await app.evaluate(()=>globalThis.folderCalls.length);const error=await page.evaluate(async()=>{try{await window.desktopClient.revealProjectData('C:/Windows');return '';}catch(e){return e.message;}});assert.match(error,/不存在/);assert.equal(await app.evaluate(()=>globalThis.folderCalls.length),before);
  await app.evaluate(({shell})=>{shell.openPath=async()=> 'QA folder unavailable';});await open('尚无内容');await context().getByRole('menuitem',{name:'打开数据文件夹',exact:true}).click();await page.getByRole('alert').filter({hasText:'QA folder unavailable'}).waitFor();assert.equal(JSON.parse(storage.getItem('gamecreator.projects.v1')).activeId,projects[0].id);
  await open('其他项目');await context().getByRole('menuitem',{name:'删除项目',exact:true}).click();const dialog=page.getByRole('dialog',{name:'删除本地项目',exact:true});await dialog.waitFor();await dialog.getByRole('button',{name:'取消',exact:true}).click();assert.equal(JSON.parse(storage.getItem('gamecreator.projects.v1')).projects.length,3);
  assert.deepEqual(errors,[]);console.log('PASS project data folder: inactive project archive, unbound/empty project, storage instead of engine path, keyboard actions, error handling, unknown ID refusal, deletion preserved.');
 }finally{if(app)await app.close();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('gc-data-folder-'));await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
