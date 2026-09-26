// Run after npm run build. Requires Playwright (GAMECREATOR_PLAYWRIGHT_PATH is supported).
const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {createWorkspaceStorage}=require('../desktop/test-workspaces.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'gamecreator-panel-'));
 const profile=path.join(directory,'profile'),dataDirectory=path.join(directory,'data');
 await fs.mkdir(profile);
 const storage=createWorkspaceStorage(dataDirectory);
 const sessionKey='gamecreator.test-session.v1';
 const env={...process.env,GAMECREATOR_USER_DATA_DIR:profile,GAMECREATOR_DATA_DIR:dataDirectory};delete env.ELECTRON_RUN_AS_NODE;
 let app,page;const errors=[];
 const launch=async()=>{
  app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});
  page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  await page.getByRole('button',{name:'进入本地工作区',exact:true}).click();
 };
 const session=()=>JSON.parse(storage.getItem(sessionKey)||'null');
 const testKey=()=> 'gamecreator.enum-versions.v1:'+session().config.projectPath.replaceAll('\\','/').toLowerCase();
 const open=async()=>{await page.getByRole('button',{name:/^测试面板/}).click();await page.getByRole('dialog',{name:'测试面板',exact:true}).waitFor();};
 const close=async()=>{await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);};
 const load=async name=>{
  const old=session()?.id;
  await open();await page.getByRole('button',{name:'加载'+name,exact:true}).click();
  await page.waitForFunction(old=>JSON.parse(window.desktopClient.storage.getItem('gamecreator.test-session.v1')||'null')?.id!==old,old);
  await page.locator('.test-workspace-banner').waitFor();
  assert.equal(await page.getByRole('dialog').count(),0);
 };
 const officialFiles=async()=>{
  const files=await fs.readdir(path.join(dataDirectory,'storage'));
  const result={};
  for(const file of files.filter(file=>file.endsWith('.json'))){
   const raw=await fs.readFile(path.join(dataDirectory,'storage',file),'utf8');
   const entry=JSON.parse(raw);
   if(entry.key==='gamecreator.projects.v1') result[file]=JSON.stringify(JSON.parse(entry.value).projects);
   else if(entry.key!==sessionKey)result[file]=raw;
  }
  return result;
 };
 try{
  const {buildTestWorkspace}=await import(pathToFileURL(path.join(root,'src/test-scenarios.ts')));
  const group={name:'Const_Official.Mode',source:'Script/Const/Const_Official.lua',line:1,comment:'',valueType:'number',members:[{key:'A',value:1,line:2,comment:''},{key:'B',value:2,line:3,comment:''}]};
  const config={engine:'oasis-lua',projectPath:'E:/OfficialFixture',enumPath:'Script/Const',dataPath:'Script/Config',outputFormat:'lua',autoSync:false,backupBeforeSync:true};
  const scan={projectPath:config.projectPath,enumPath:config.enumPath,groups:[group],files:[group.source],orderTables:[],dynamic:[],counts:{files:1,groups:1,members:2}};
  const formal=await buildTestWorkspace({id:'official',scenario:'unchanged',config,baseline:scan,incoming:scan},'admin');
  storage.setItem(formal.key,JSON.stringify(formal.store));storage.setItem('gamecreator.engine-config.v1',JSON.stringify(config));
  await launch();
  await page.locator('h1').click();await page.keyboard.down('Space');await page.keyboard.down('Space');
  assert.equal(await page.getByRole('dialog').count(),1);await page.keyboard.up('Space');
  assert.equal(await page.evaluate(()=>document.activeElement?.tagName),'DIALOG');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(()=>document.querySelector('dialog[open]').contains(document.activeElement)),true);
  await close();
  await page.getByRole('textbox',{name:'项目名称',exact:true}).click();
  await page.keyboard.press('End');await page.keyboard.press('Space');
  assert.equal(await page.getByRole('dialog').count(),0);
  await page.locator('h1').click();
  await page.dispatchEvent('body','compositionstart');await page.keyboard.press('Space');await page.dispatchEvent('body','compositionend');
  assert.equal(await page.getByRole('dialog').count(),0);
  await page.keyboard.press('Control+Space');assert.equal(await page.getByRole('dialog').count(),0);
  await open();await close();
  assert.equal(await page.getByRole('button',{name:/^测试面板/}).evaluate(el=>el===document.activeElement),true);
  const official=await officialFiles();
  for(const [name,id] of [['首次导入','first'],['无变化','unchanged'],['新增成员','added'],['删除成员','removed'],['修改成员','modified'],['混合变化','mixed'],['删除被引用成员','referenced'],['异常来源','error']]){
    await load(name);assert.equal(session().scenario,id);
    assert.ok(storage.info(testKey()).directory.startsWith(path.join(dataDirectory,'test-workspaces',session().id)));
    const state=JSON.parse(storage.getItem(testKey()));assert.equal(!!state.activeId,id!=='first');
    if(id==='error')await page.locator('.enum-management [role=alert]').waitFor();
    assert.deepEqual(await officialFiles(),official);
  }
  await load('混合变化');
  await page.getByRole('button',{name:'同意 Const_Panel.Mode.C · 新增成员',exact:true}).click();
  await open();
  await fs.mkdir(path.join(root,'.gamecreator/qa'),{recursive:true});
  await page.screenshot({path:path.join(root,'.gamecreator/qa/test-panel-scenarios.png')});
  await page.getByRole('tab',{name:'通用调试',exact:true}).click();
  const before=storage.getItem(testKey());
  await page.getByRole('button',{name:'运行只读检查',exact:true}).click();
  await page.getByText('只读检查完成',{exact:true}).waitFor();
  assert.equal(storage.getItem(testKey()),before);
  await page.getByRole('button',{name:'复制诊断信息',exact:true}).click();
  await page.getByText('诊断信息已复制',{exact:true}).waitFor();
  const clipboard=await app.evaluate(({clipboard})=>clipboard.readText());
  const report=JSON.parse(clipboard);assert.equal(report.workspace.type,'测试');assert.equal(report.decisions.agreed,1);
  assert.ok(report.recentLogs.some(entry=>entry.action==='审核决定'));
  await page.screenshot({path:path.join(root,'.gamecreator/qa/test-panel-debug.png')});
  await page.getByRole('button',{name:'清空面板日志',exact:true}).click();
  assert.equal(await page.locator('.test-debug-log li').count(),0);assert.equal(storage.getItem(testKey()),before);
  await page.getByRole('tab',{name:'枚举测试',exact:true}).click();
  const oldSession=session(),oldKey=testKey();
  await page.getByRole('button',{name:'重置当前场景',exact:true}).click();
  await page.waitForFunction(old=>JSON.parse(window.desktopClient.storage.getItem('gamecreator.test-session.v1')).id!==old,oldSession.id);
  await page.locator('.test-workspace-banner').waitFor();
  assert.equal(storage.getItem(oldKey),before);
  let state=JSON.parse(storage.getItem(testKey()));assert.equal(state.reviews[state.candidateId].selected.length,0);
  await page.getByRole('button',{name:'同意 Const_Panel.Mode.C · 新增成员',exact:true}).click();
  await page.waitForFunction(key => { const state=JSON.parse(window.desktopClient.storage.getItem(key)); return state.reviews[state.candidateId].selected.some(id=>id.includes('add-member')); }, testKey());
  const savedId=session().id,savedKey=testKey();
  await app.close();app=null;
  await launch();await page.locator('.test-workspace-banner').waitFor();
  assert.equal(session().id,savedId);assert.equal(testKey(),savedKey);
  assert.equal(await page.getByRole('button',{name:'同意 Const_Panel.Mode.C · 新增成员',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'工程同步',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:/^项目目录/}).isDisabled(),true);
  await page.locator('.test-workspace-banner').getByRole('button',{name:'返回原工作区',exact:true}).click();
  assert.equal(session(),null);assert.equal(await page.locator('.test-workspace-banner').count(),0);
  assert.deepEqual(await officialFiles(),official);
  await page.getByRole('button',{name:'返回启动页',exact:true}).click();
  await page.getByRole('button',{name:'进入本地工作区',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:/^测试面板/}).count(),1);
  await page.locator('h1').click();await page.keyboard.press('Space');await page.getByRole('dialog',{name:'测试面板',exact:true}).waitFor();await close();
  assert.deepEqual(errors,[]);
  console.log('PASS: Space/Esc, key repeat/IME/input guards, modal focus, all eight scenarios, isolated disk data, diagnostics/clipboard/logs, safe reset, restored test session, return to formal workspace, local workspace UI without account gates.');
 }finally{
  if(app)await app.close();
  await fs.rm(directory,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
