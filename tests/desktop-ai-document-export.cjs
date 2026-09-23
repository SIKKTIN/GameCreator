const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {createWorkspaceStorage}=require('../desktop/test-workspaces.cjs'),root=path.resolve(__dirname,'..');
(async()=>{
  const {preparePrototypeProject,writePrototypeProject}=await import('../src/prototype-import.ts');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-ai-desktop-')),storage=createWorkspaceStorage(path.join(dir,'data')),output=path.join(dir,'中文 保存位置');await fs.mkdir(output);
  const pvz=JSON.parse(await fs.readFile(path.join(root,'examples/prototypes/plants-vs-zombies.json'),'utf8')),disco=JSON.parse(await fs.readFile(path.join(root,'examples/prototypes/disco-elysium.json'),'utf8'));
  const a=preparePrototypeProject({schema:2,projects:[],activeId:'',mode:'project'},pvz,'文档测试A');writePrototypeProject(storage,a);
  const b=preparePrototypeProject(a.catalog,disco,'文档测试B');writePrototypeProject(storage,b);const catalog={...b.catalog,activeId:a.project.id};storage.setItem('gamecreator.projects.v1',JSON.stringify(catalog));
  let app,page;const errors=[],env={...process.env,GAMECREATOR_DATA_DIR:path.join(dir,'data'),GAMECREATOR_USER_DATA_DIR:path.join(dir,'profile')};delete env.ELECTRON_RUN_AS_NODE;
  const button=name=>page.getByRole('button',{name,exact:true}),field=name=>page.getByLabel(name,{exact:true}),dialog=()=>page.getByRole('dialog',{name:'生成 AI 文档',exact:true});
  const open=async()=>{await button('生成 AI 文档').click();await dialog().waitFor();};
  const generate=async()=>{await button('生成文档文件夹').click();await page.getByRole('region',{name:'文档生成结果'}).waitFor();};
  try {
    app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1380,920));await button('进入本地工作区').click();await open();
    await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});
    const original=await field('AI 文档保存位置').inputValue();await button('选择文件夹').click();assert.equal(await field('AI 文档保存位置').inputValue(),original);
    await button('取消').click();assert.deepEqual(await fs.readdir(output),[]);await open();
    await app.evaluate(({dialog},directory)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]});},output);await button('选择文件夹').click();
    await field('AI 文档保存位置').evaluate((n,expected)=>{if(n.value!==expected)throw new Error('path not selected');},output);
    await field('输出文件夹名称').fill('首版 文档');await field('总文档文件名').fill('总览 自定义');await field('玩法设计文档文件名').fill('玩法 #规则 [一]');
    await field('项目概览文档文件名').fill('CON');assert.equal(await button('生成文档文件夹').isDisabled(),true);
    await field('项目概览文档文件名').fill('项目排期.md');assert.ok((await dialog().innerText()).includes('文件名重复'));await field('项目概览文档文件名').fill('config-data-policy.md');assert.ok((await dialog().innerText()).includes('文件名重复'));await field('项目概览文档文件名').fill('项目概览.md');
    assert.equal(await field('故事编排文档文件名').count(),0);assert.equal(await field('地图设计文档文件名').count(),0);
    const moduleCount=await page.locator('.aie-file-list input').count();
    await fs.mkdir(path.join(root,'.gamecreator/qa'),{recursive:true});await page.screenshot({path:path.join(root,'.gamecreator/qa/ai-document-export-settings.png')});
    // A failed write leaves the settings available for retry.
    const notDirectory=path.join(dir,'不是目录.txt');await fs.writeFile(notDirectory,'原文件');await field('AI 文档保存位置').fill(notDirectory);await button('生成文档文件夹').click();await dialog().getByRole('alert').waitFor();assert.equal(await fs.readFile(notDirectory,'utf8'),'原文件');
    await field('AI 文档保存位置').fill(output);await generate();
    const first=path.join(output,'首版 文档'),summary=await fs.readFile(path.join(first,'总览 自定义.md'),'utf8');
    assert.ok(summary.includes(pvz.name)||summary.includes('文档测试A'));assert.ok(summary.includes('豌豆'));assert.ok(summary.includes(encodeURIComponent('玩法 #规则 [一].md')));
    assert.equal((await fs.readdir(path.join(first,'模块'))).length,moduleCount+1);assert.ok((await fs.readFile(path.join(first,'模块','玩法 #规则 [一].md'),'utf8')).includes('返回项目完整文档'));
    assert.match(await fs.readFile(path.join(first,'模块/config-data-policy.md'),'utf8'),/当前项目目录约定/);assert.match(summary,/配置数据管理与同步规范/);
    await app.evaluate(({shell})=>{shell.openPath=async directory=>{globalThis.aiRevealed=directory;return '';};});await button('打开文件夹').click();assert.equal(await app.evaluate(()=>globalThis.aiRevealed),first);
    await page.screenshot({path:path.join(root,'.gamecreator/qa/ai-document-export-success.png')});await button('完成').click();
    await open();assert.equal(await field('AI 文档保存位置').inputValue(),output);assert.equal(await field('总文档文件名').inputValue(),'总览 自定义');assert.equal(await field('玩法设计文档文件名').inputValue(),'玩法 #规则 [一]');await generate();assert.ok((await dialog().innerText()).includes('首版 文档 (1)'));assert.equal(await fs.readFile(path.join(first,'总览 自定义.md'),'utf8'),summary);await button('完成').click();
    // Project settings are isolated, and the optional story module is included.
    await page.locator('.ps-trigger').click();await page.getByRole('menuitemradio',{name:/^文档测试B/}).click();await open();assert.equal(await field('总文档文件名').inputValue(),'项目完整文档.md');await field('故事编排文档文件名').waitFor();await field('AI 文档保存位置').fill(output);await field('输出文件夹名称').fill('故事文档');await generate();assert.ok((await fs.readFile(path.join(output,'故事文档','模块','故事编排.md'),'utf8')).includes('故事编排'));await button('完成').click();
    // A second window without preload behaves as the browser build, including download.
    const windowPromise=app.waitForEvent('window');await app.evaluate(async({BrowserWindow})=>{const url=BrowserWindow.getAllWindows()[0].webContents.getURL();const w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});await w.loadURL(url);});
    const web=await windowPromise;web.on('pageerror',e=>errors.push(e.message));await web.evaluate(({entries,catalog})=>{for(const e of entries)localStorage.setItem(e.key,e.value);localStorage.setItem('gamecreator.projects.v1',JSON.stringify(catalog));},{entries:a.entries,catalog:a.catalog});await web.reload();
    await web.getByRole('button',{name:'进入本地工作区',exact:true}).click();await web.getByRole('button',{name:'生成 AI 文档',exact:true}).click();assert.equal(await web.getByLabel('AI 文档保存位置',{exact:true}).count(),0);
    await web.getByLabel('输出文件夹名称',{exact:true}).fill('浏览器 中文');
    const zip=path.join(dir,'browser.zip');await app.evaluate(({session},filename)=>{globalThis.aiDownload=new Promise((resolve,reject)=>{session.defaultSession.once('will-download',(_e,item)=>{item.setSavePath(filename);item.once('done',(_event,state)=>state==='completed'?resolve(item.getSavePath()):reject(new Error(state)));});});},zip);
    await web.getByRole('button',{name:'生成文档文件夹',exact:true}).click();assert.equal(await app.evaluate(()=>globalThis.aiDownload),zip);
    const names=JSON.parse(execFileSync('python',['-c',"import zipfile,json,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps(z.namelist()))",zip],{encoding:'utf8'}));assert.equal(names.length,moduleCount+2);assert.ok(names.includes('浏览器 中文/模块/config-data-policy.md'));assert.ok(names.includes('浏览器 中文/模块/玩法设计.md'));
    assert.deepEqual(errors,[]);console.log('PASS AI document export: custom paths/names, cancellation, validation/retry, real Markdown folders, duplicate preservation, remembered project settings, optional modules, reveal and real browser ZIP download.');
  } catch(e){if(page&&!page.isClosed())console.error((await page.locator('body').innerText()).slice(-2200));throw e;}
  finally {if(app)await app.close();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('gc-ai-desktop-'));await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
