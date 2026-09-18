// Run after npm run build; all data and engine files are isolated test fixtures.
const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {createWorkspaceStorage}=require('../desktop/test-workspaces.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gamecreator-gameplay-ui-'));
 const dataDir=path.join(dir,'data'),profile=path.join(dir,'profile'),engine=path.join(dir,'engine');
 const storage=createWorkspaceStorage(dataDir),a='project-'+crypto.randomUUID(),b='project-'+crypto.randomUUID();
 const key=id=>'gamecreator.workspace.v1:'+id+':gameplay',read=id=>JSON.parse(storage.getItem(key(id))||'null');
 const cfg={engine:'oasis-lua',projectPath:'',enumPath:'Script/Const',dataPath:'Script/Config',outputFormat:'lua',autoSync:false,backupBeforeSync:true};
 const env={...process.env,GAMECREATOR_USER_DATA_DIR:profile,GAMECREATOR_DATA_DIR:dataDir};delete env.ELECTRON_RUN_AS_NODE;
 let app,page;const errors=[],scans=[];
 const launch=async()=>{
  app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().includes('/api/engine/scan'))scans.push(r.url());});await page.getByRole('button',{name:'登录',exact:true}).click();
 };
 const nav=name=>page.getByRole('button',{name,exact:true}).click();
 const create=async name=>{
  await nav('新建玩法');const d=page.getByRole('dialog',{name:'新建玩法',exact:true});assert.equal(await d.getByRole('textbox').count(),1);
  await d.getByLabel('玩法名称',{exact:true}).fill(name);await d.getByRole('button',{name:'创建玩法',exact:true}).click();await d.waitFor({state:'hidden'});
 };
 const selectProject=async name=>{await page.locator('.ps-trigger').click();await page.getByRole('menuitemradio',{name:new RegExp('^'+name)}).click();await nav('玩法设计');};
 const openOriginal=()=>page.getByRole('button',{name:'打开玩法：抵挡一波敌人',exact:true}).click();
 try{
  await fs.mkdir(profile);await fs.mkdir(path.join(engine,'Script/Const'),{recursive:true});await fs.writeFile(path.join(engine,'Script/Const/Const_Fixture.lua'),'local Const_Fixture = {}\nConst_Fixture.Mode = {\nA = 1,\nB = 2,\n}\nreturn Const_Fixture');
  storage.setItem('gamecreator.projects.v1',JSON.stringify({schema:2,activeId:a,mode:'project',projects:[{id:a,name:'原型A',config:cfg,initialContent:'empty'},{id:b,name:'原型B',config:cfg,initialContent:'empty'}]}));
  const story={id:'story-1',title:'防守背景',category:'世界观',status:'草稿',updated:'刚刚',summary:'守住营地',content:'营地受到袭击。',tags:[],outlines:[],relations:{characters:[],locations:[],systems:[]}};
  storage.setItem('gamecreator.workspace.v1:'+a+':stories',JSON.stringify([story]));
  await launch();await nav('玩法设计');await page.getByRole('heading',{name:'设计你的第一个玩法',exact:true}).waitFor();
  await create('抵挡一波敌人');const originalId=read(a).designs[0].id;assert.equal(read(a).designs[0].rules,'');assert.equal(scans.length,0);
  await page.getByLabel('一句话说明',{exact:true}).fill('利用有限资源守住营地');await page.getByLabel('体验目标',{exact:true}).fill('在进攻和防守之间做出选择');
  const summary=page.getByLabel('一句话说明',{exact:true});await summary.focus();await page.keyboard.press('End');await page.keyboard.press('Space');assert.equal(await page.getByRole('dialog',{name:'测试面板',exact:true}).count(),0);
  await summary.fill('利用有限资源守住营地');
  for(const [i,text] of ['收集资源','建造防御','抵挡敌人'].entries()){await nav('添加步骤');await page.getByLabel('循环步骤 '+(i+1),{exact:true}).fill(text);}
  await nav('下移步骤 1');assert.deepEqual(read(a).designs[0].loop.map(s=>s.text),['建造防御','收集资源','抵挡敌人']);await nav('上移步骤 2');
  await nav('添加步骤');await page.getByLabel('循环步骤 4',{exact:true}).fill('临时步骤');await nav('删除步骤 4');assert.equal(read(a).designs[0].loop.length,3);
  await page.getByLabel('操作、条件与反馈',{exact:true}).fill('敌人每十秒出现，玩家可建造防御塔。');await page.getByLabel('胜利条件',{exact:true}).fill('全歼敌人');await page.getByLabel('失败条件',{exact:true}).fill('营地被摧毁');
  for(const [i,text] of ['一个测试场地','一种敌人'].entries()){await nav('添加制作项');await page.getByLabel('制作项 '+(i+1),{exact:true}).fill(text);await page.getByLabel('完成制作项 '+(i+1),{exact:true}).check();}
  await page.getByLabel('暂缓内容',{exact:true}).fill('正式美术与成长系统');assert.equal(read(a).designs[0].status,'草稿');
  await nav('添加验证项');const check=page.getByRole('region',{name:'验证项 1',exact:true});
  for(const [label,value] of [['要验证的问题','能否理解防守目标'],['试玩步骤','从空白场地开始试玩三分钟'],['预期结果','建立防线并抵挡第一波'],['实际结果','通过首次试玩，玩家理解了目标']])await check.getByLabel(label,{exact:true}).fill(value);
  await page.getByLabel('验证结论 1',{exact:true}).selectOption('通过');assert.equal(read(a).designs[0].status,'草稿');await page.getByLabel('设计状态',{exact:true}).selectOption('已验证');
  await nav('添加验证项');await nav('删除验证项 2');assert.equal(read(a).designs[0].checks.length,1);
  await page.getByLabel('关联目标',{exact:true}).selectOption('story-1');await nav('添加关联');
  await page.getByLabel('内容类型',{exact:true}).selectOption('dataset');await page.getByLabel('关联目标',{exact:true}).selectOption('items');await nav('添加关联');assert.equal(read(a).designs[0].links.length,2);
  await page.locator('.gp-links').getByRole('button',{name:'防守背景',exact:true}).click();assert.equal(await page.locator('.story-title-input').inputValue(),'防守背景');await page.locator('.story-title-input').fill('防守背景已改名');await nav('玩法设计');await page.locator('.gp-links').getByRole('button',{name:'防守背景已改名',exact:true}).waitFor();
  await page.locator('.gp-links').getByRole('button',{name:'Items',exact:true}).click();await page.locator('.data-workspace').waitFor();await nav('玩法设计');
  await nav('复制玩法');assert.equal(read(a).designs.length,2);const copy=read(a).designs[1];assert.notEqual(copy.id,originalId);assert.equal(copy.status,'草稿');assert.ok(copy.prototype.every(i=>!i.done));assert.equal(copy.checks[0].actual,'');assert.equal(copy.checks[0].result,'未测试');
  await nav('归档玩法');assert.equal(read(a).designs[1].archived,true);assert.equal(await page.getByRole('textbox',{name:'玩法名称',exact:true}).isDisabled(),true);await nav('恢复玩法');assert.equal(read(a).designs[1].archived,false);
  await page.getByLabel('玩法状态筛选',{exact:true}).selectOption('已验证');assert.equal(await page.locator('.gp-list-card').count(),1);await page.getByLabel('玩法状态筛选',{exact:true}).selectOption('all');
  await page.getByRole('searchbox',{name:'搜索玩法',exact:true}).fill('不存在的玩法');assert.equal(await page.locator('.gp-list-card').count(),0);await page.getByRole('searchbox',{name:'搜索玩法',exact:true}).fill('');await openOriginal();
  // Inject a disk failure only for gameplay writes; normal IPC continues unchanged.
  await app.evaluate(({ipcMain})=>{const original=ipcMain.listeners('workspace-storage')[0];ipcMain.removeAllListeners('workspace-storage');globalThis.failGameplay=true;
   ipcMain.on('workspace-storage',(event,request)=>{if(globalThis.failGameplay&&request.operation==='set'&&request.key.endsWith(':gameplay'))event.returnValue={ok:false,error:'测试磁盘写入失败'};else original(event,request);});});
  const beforeFailure=storage.getItem(key(a));await page.getByLabel('一句话说明',{exact:true}).fill('失败后仍保留的草稿');await page.getByRole('button',{name:'重试保存玩法',exact:true}).waitFor();assert.equal(storage.getItem(key(a)),beforeFailure);
  assert.equal(await page.getByLabel('一句话说明',{exact:true}).inputValue(),'失败后仍保留的草稿');assert.equal(await page.locator('.ps-trigger').isDisabled(),true);assert.equal(await page.getByRole('button',{name:'生成 AI 文档',exact:true}).isDisabled(),true);
  await app.evaluate(()=>{globalThis.failGameplay=false;});await nav('重试保存玩法');assert.equal(read(a).designs[0].summary,'失败后仍保留的草稿');assert.equal(await page.locator('.ps-trigger').isEnabled(),true);
  // Verify actual export IPC payload without creating user-visible files in generate/.
  await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('write-markdown');ipcMain.handle('write-markdown',(_event,payload)=>{globalThis.gameplayExport=payload;return '隔离测试导出';});});page.on('dialog',d=>d.accept());await nav('生成 AI 文档');
  const exported=await app.evaluate(()=>globalThis.gameplayExport);assert.match(exported.filename,/^gamecreator-[0-9a-f]{12}-context-/);for(const phrase of ['## 玩法设计','抵挡一波敌人','建造防御','正式美术与成长系统','通过首次试玩','防守背景已改名'])assert.ok(exported.content.includes(phrase),phrase);
  const aBeforeSwitch=storage.getItem(key(a));await selectProject('原型B');await page.getByRole('heading',{name:'设计你的第一个玩法',exact:true}).waitFor();await create('抵挡一波敌人');await page.getByLabel('一句话说明',{exact:true}).fill('B独立玩法');assert.notEqual(read(b).designs[0].id,originalId);assert.equal(storage.getItem(key(a)),aBeforeSwitch);
  await selectProject('原型A');assert.equal(read(a).designs[0].summary,'失败后仍保留的草稿');
  await nav('引擎设置');await page.getByRole('textbox',{name:/^项目目录/}).fill(engine);await nav('保存设置');await page.waitForFunction(()=>!document.querySelector('.ps-trigger').disabled);assert.equal(storage.getItem(key(a)),aBeforeSwitch);
  await page.getByRole('button',{name:/^测试面板/}).click();await nav('加载混合变化');await page.locator('.test-workspace-banner').waitFor();await nav('玩法设计');await page.getByRole('heading',{name:'设计你的第一个玩法',exact:true}).waitFor();await create('隔离测试玩法');
  const session=JSON.parse(storage.getItem('gamecreator.test-session.v1'));const testIdentity=session.config.projectPath.replaceAll('\\','/').toLowerCase();assert.equal(read(testIdentity).designs[0].title,'隔离测试玩法');assert.ok(storage.info(key(testIdentity)).directory.includes(session.id));assert.equal(storage.getItem(key(a)),aBeforeSwitch);
  await page.locator('.test-workspace-banner').getByRole('button',{name:'返回原工作区',exact:true}).click();await nav('玩法设计');await openOriginal();
  await app.close();app=null;await launch();await nav('玩法设计');await openOriginal();assert.equal(await page.getByLabel('一句话说明',{exact:true}).inputValue(),'失败后仍保留的草稿');assert.equal(await page.getByLabel('实际结果',{exact:true}).inputValue(),'通过首次试玩，玩家理解了目标');assert.equal(await page.getByLabel('设计状态',{exact:true}).inputValue(),'已验证');assert.equal(storage.getItem(key(a)),aBeforeSwitch);
  await fs.mkdir(path.join(root,'.gamecreator/qa'),{recursive:true});await page.locator('main').evaluate(el=>{el.scrollTop=0;});await page.screenshot({path:path.join(root,'.gamecreator/qa/gameplay-editor.png')});
  await page.getByRole('heading',{name:'验证清单',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(root,'.gamecreator/qa/gameplay-validation.png')});
  // A removed link target is a warning, never a reason to delete the design.
  await app.close();app=null;storage.setItem('gamecreator.workspace.v1:'+a+':stories','[]');await launch();await nav('玩法设计');await openOriginal();await page.getByRole('button',{name:'关联已失效：story-1',exact:true}).waitFor();assert.equal(storage.getItem(key(a)),aBeforeSwitch);
  await nav('解除关联 story-1');assert.equal(read(a).designs[0].links.length,1);assert.equal(read(a).designs[0].checks[0].actual,'通过首次试玩，玩家理解了目标');
  await app.close();app=null;const corrupt=JSON.stringify({schema:99,designs:[]});storage.setItem(key(a),corrupt);await launch();await nav('玩法设计');await page.getByRole('heading',{name:'玩法存档暂时无法读取',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'新建玩法',exact:true}).isDisabled(),true);assert.equal(storage.getItem(key(a)),corrupt);
  assert.deepEqual(errors,[]);console.log('PASS: name-only gameplay creation; all design fields, order/edit/delete, manual status, copy/archive/restore/filter; live links; failed-save draft and retry; AI export; unbound projects, engine binding, test isolation, restart; missing references and corrupt archive protection.');
 }catch(error){console.error('Renderer errors:',errors);if(page&&!page.isClosed())console.error((await page.locator('body').innerText()).slice(0,6000));throw error;}finally{if(app)await app.close();await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
