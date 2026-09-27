const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createWorkspaceStorage}=require('../desktop/test-workspaces.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'gc-help-ui-')),storage=createWorkspaceStorage(path.join(dir,'data'));
 const catalog=JSON.stringify({schema:2,mode:'project',activeId:'',projects:[]});storage.setItem('gamecreator.projects.v1',catalog);
 const env={...process.env,GAMECREATOR_DATA_DIR:path.join(dir,'data'),GAMECREATOR_USER_DATA_DIR:path.join(dir,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 let app;try{
  app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});const page=await app.firstWindow();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const button=name=>page.getByRole('button',{name,exact:true});await button('进入本地工作区').click();await page.getByRole('heading',{name:'暂无本地项目',exact:true}).waitFor();
  assert.equal(await button('项目内容同步').isDisabled(),true);assert.equal(await button('操作说明').isEnabled(),true);assert.equal(await button('通用规范').isEnabled(),true);
  await button('操作说明').click();const help=page.getByRole('dialog',{name:'使用帮助',exact:true});await help.waitFor();await help.getByRole('heading',{name:'从零设计原型',exact:true}).waitFor();assert.equal(await help.getByRole('button',{name:'读取设计提交',exact:true}).count(),0);assert.equal(await help.locator('textarea').count(),0);
  await help.getByRole('tab',{name:'通用规范',exact:true}).click();await help.getByRole('heading',{name:'先复用，再扩展',exact:true}).waitFor();await help.getByLabel('通用规范范围').selectOption('data');await help.getByRole('heading',{name:'先核对数据契约',exact:true}).waitFor();
  fs.mkdirSync(path.join(root,'.gamecreator/qa'),{recursive:true});await page.screenshot({path:path.join(root,'.gamecreator/qa/software-help.png')});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1000,800));assert.ok(await help.evaluate(el=>el.scrollWidth<=el.clientWidth+2));
  await page.keyboard.press('Escape');await help.waitFor({state:'hidden'});assert.equal(storage.getItem('gamecreator.projects.v1'),catalog);assert.deepEqual(errors,[]);console.log('PASS software help: available without a project, read-only static documents, rule scope, close/Escape, narrow layout and no project writes.');
 }finally{if(app)await app.close();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('gc-help-ui-'));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
