const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {createWorkspaceStorage}=require('../desktop/test-workspaces.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
  const {addSavedProject}=await import('../src/project-catalog.ts');
  const {selectEngine}=await import('../src/engine.ts');
  const {emptyProgramFramework}=await import('../shared/program-framework.mjs');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-framework-desktop-')),storage=createWorkspaceStorage(path.join(dir,'data'));
  let catalog=addSavedProject({schema:2,projects:[],activeId:'',mode:'project'},'程序框架项目A');
  const a=catalog.projects[0];a.config=selectEngine(a.config,'godot-gdscript');
  catalog=addSavedProject(catalog,'程序框架项目B');const b=catalog.projects[1];catalog.activeId=a.id;
  storage.setItem('gamecreator.projects.v1',JSON.stringify(catalog));
  const key=id=>'gamecreator.workspace.v1:'+id+':program-framework';
  const env={...process.env,GAMECREATOR_DATA_DIR:path.join(dir,'data'),GAMECREATOR_USER_DATA_DIR:path.join(dir,'profile')};delete env.ELECTRON_RUN_AS_NODE;
  let app,page;const errors=[];
  const button=name=>page.getByRole('button',{name,exact:true}),field=name=>page.getByLabel(name,{exact:true});
  const launch=async()=>{app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1500,1000));await button('进入本地工作区').click();};
  const open=async()=>{await button('程序框架').click();await page.getByRole('region',{name:'程序框架工作区'}).waitFor();};
  const projectTab=()=>page.getByRole('tab',{name:/项目采用方案/}).click();
  const switchProject=async name=>{await page.locator('.ps-trigger').click();await page.getByRole('menuitemradio').filter({hasText:name}).click();};
  try{
    await launch();await open();assert.equal(await page.getByText('这个工作区正在搭建中，你可以先从项目概览、故事文档和数据配置开始。').count(),0);
    assert.equal(await button('返回搜索结果').count(),0);
    assert.equal(await page.locator('.pf-doc-list button').count(),19);
    assert.equal(await button('阅读框架规范：配置数据管理与同步规范').getByLabel('默认加入',{exact:true}).count(),1);
    assert.equal(await button('阅读框架规范：架构总纲').getByLabel('本项目已采用',{exact:true}).count(),0);
    await page.locator('.pf-doc-list button').filter({hasText:'配置数据管理与同步规范'}).click();await page.getByRole('heading',{name:'配置数据管理与同步规范',exact:true}).waitFor();
    await button('阅读框架规范：架构总纲').click();assert.ok(await page.locator('.pf-markdown table').count()>0);assert.ok(await page.locator('.pf-markdown pre').count()>0);
    await field('搜索框架规范').fill('枪械');assert.ok(await page.locator('.pf-doc-list button').count()<19);await field('搜索框架规范').fill('不存在的搜索结果abcdef');await page.getByText('没有找到匹配文档，试试其他关键词。').waitFor();await field('搜索框架规范').fill('');
    await button('阅读框架规范：通用游戏项目框架').click();await page.locator('.pf-markdown').getByRole('button',{name:'最小项目结构',exact:true}).first().click();await page.locator('.pf-markdown h1').filter({hasText:'最小项目结构'}).waitFor();
    // Actual ZIP download contains the complete reference library and readable UTF-8 Markdown.
    const zip=path.join(dir,'framework.zip');
    await app.evaluate(({session},filename)=>{globalThis.frameworkDownload=new Promise((resolve,reject)=>session.defaultSession.once('will-download',(_event,item)=>{item.setSavePath(filename);item.once('done',(_e,state)=>state==='completed'?resolve(filename):reject(new Error(state)));}));},zip);
    await button('下载规范包').click();assert.equal(await app.evaluate(()=>globalThis.frameworkDownload),zip);
    const files=JSON.parse(execFileSync('python',['-c',"import zipfile,json,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps(z.namelist()))",zip],{encoding:'utf8'}));assert.equal(files.length,19);assert.ok(files.includes('通用游戏项目框架/README.md'));
    await projectTab();assert.equal(await field('采用内置通用框架').isChecked(),false);assert.equal(await field('采用联机与状态同步').isEnabled(),false);assert.equal(await field('采用绿洲启元补充').isEnabled(),false);
    await field('采用内置通用框架').check();await field('采用存档与数据迁移').check();await field('程序框架项目约定').fill('只为当前项目：CropPackage 负责种植规则。');
    await field('框架运行模式').selectOption('multiplayer');await field('采用联机与状态同步').check();await field('框架运行模式').selectOption('singleplayer');assert.equal(await field('采用联机与状态同步').isChecked(),false);
    assert.equal(JSON.parse(storage.getItem(key(a.id))).notes,'只为当前项目：CropPackage 负责种植规则。');
    await fs.mkdir(path.join(root,'.gamecreator/qa'),{recursive:true});await page.locator('.pf-intro').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(root,'.gamecreator/qa/program-framework-project.png')});
    // Export uses the current adoption plan, not all documents in the reader.
    await button('生成 AI 文档').click();await field('AI 文档保存位置').fill(dir);await field('输出文件夹名称').fill('框架AI资料');await button('生成文档文件夹').click();await page.getByRole('region',{name:'文档生成结果'}).waitFor();
    assert.match(await fs.readFile(path.join(dir,'框架AI资料/模块/config-data-policy.md'),'utf8'),/当前项目目录约定/);
    const md=await fs.readFile(path.join(dir,'框架AI资料','模块','程序框架.md'),'utf8');assert.match(md,/CropPackage/);assert.match(md,/### 可选扩展：存档与数据迁移/);assert.doesNotMatch(md,/### 可选扩展：联机与状态同步/);assert.doesNotMatch(md,/### 绿洲启元补充/);await button('完成').click();
    // Global search opens the correct reader and ordinary navigation clears return context.
    await field('全局搜索入口').fill('Core 边界与公共机制');await button('打开全局搜索').click();await button('打开搜索结果：Core 边界与公共机制').click();await page.locator('.pf-markdown h1').filter({hasText:'Core 边界与公共机制'}).waitFor();assert.equal(await page.locator('.gsearch-return').count(),1);
    await button('阅读框架规范：数据与配置').click();assert.equal(await page.locator('.gsearch-return').count(),0);
    assert.equal(await button('阅读框架规范：配置数据管理与同步规范').getByLabel('默认加入',{exact:true}).count(),1);
    assert.equal(await button('阅读框架规范：架构总纲').getByLabel('本项目已采用',{exact:true}).count(),1);
    await page.screenshot({path:path.join(root,'.gamecreator/qa/program-framework-library.png')});
    await switchProject(b.name);await open();await projectTab();assert.equal(await field('采用内置通用框架').isChecked(),false);assert.equal(await field('程序框架项目约定').inputValue(),'');assert.equal(storage.getItem(key(b.id)),null);
    await switchProject(a.name);await open();await projectTab();await field('采用内置通用框架').uncheck();assert.equal(await field('采用存档与数据迁移').isChecked(),true);await field('采用内置通用框架').check();
    await app.close();app=null;await launch();await open();await projectTab();assert.equal(await field('采用内置通用框架').isChecked(),true);assert.match(await field('程序框架项目约定').inputValue(),/CropPackage/);
    // Simulate a storage failure in the native bridge, then retry the retained draft.
    await app.evaluate(({ipcMain})=>{const listener=ipcMain.listeners('workspace-storage')[0];ipcMain.removeAllListeners('workspace-storage');globalThis.frameworkFailWrite=true;ipcMain.on('workspace-storage',(event,request)=>{if(globalThis.frameworkFailWrite&&request.operation==='set'&&request.key.endsWith(':program-framework'))event.returnValue={ok:false,error:'模拟写入失败'};else listener(event,request);});});
    await field('程序框架项目约定').fill('保留失败草稿');await page.locator('.pf-warning').filter({hasText:'模拟写入失败'}).waitFor();assert.match(JSON.parse(storage.getItem(key(a.id))).notes,/CropPackage/);assert.equal(await button('生成 AI 文档').isDisabled(),true);
    await app.evaluate(()=>{globalThis.frameworkFailWrite=false;});await button('重试保存程序框架').click();assert.equal(JSON.parse(storage.getItem(key(a.id))).notes,'保留失败草稿');assert.equal(await page.locator('.pf-warning').count(),0);
    // Corrupt archive remains untouched, the reference library remains readable, and recovery is explicit.
    await page.evaluate(k=>window.desktopClient.storage.setItem(k,'{"schema":99}'),key(a.id));await switchProject(b.name);await switchProject(a.name);await open();await projectTab();assert.equal(await field('采用内置通用框架').isDisabled(),true);assert.equal(storage.getItem(key(a.id)),'{"schema":99}');assert.equal(await button('生成 AI 文档').isDisabled(),true);
    await page.evaluate(({k,value})=>window.desktopClient.storage.setItem(k,JSON.stringify(value)),{k:key(a.id),value:emptyProgramFramework()});await button('重新读取程序框架').click();assert.equal(await field('采用内置通用框架').isEnabled(),true);
    assert.deepEqual(errors,[]);console.log('PASS program framework: reader/tables/code/internal links, search navigation, 19-document ZIP, adoption and engine filtering, AI export, isolation/restart, draft retry and corrupt archive recovery.');
  }catch(error){if(page&&!page.isClosed())console.error((await page.locator('body').innerText()).slice(-2500));throw error;}
  finally{if(app)await app.close();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('gc-framework-desktop-'));await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
