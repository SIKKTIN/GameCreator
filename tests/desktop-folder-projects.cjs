const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createWorkspaceStorage}=require('../desktop/test-workspaces.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-folder-ui-')),data=path.join(dir,'app-data');
 const legacy=createWorkspaceStorage(data),id='project-legacy-test';
 const config={engine:'godot-gdscript',projectPath:'',enumPath:'.',dataPath:'data',outputFormat:'json',autoSync:false,backupBeforeSync:true};
 legacy.setItem('gamecreator.projects.v1',JSON.stringify({schema:2,mode:'project',activeId:id,projects:[{id,name:'旧项目',config,initialContent:'empty'}]}));
 legacy.setItem('gamecreator.workspace.v1:'+id+':project',JSON.stringify({name:'旧项目',genre:'动作 RPG',platform:'PC',version:'v1',status:'制作中',description:'迁移前数据'}));
 let app,page;const errors=[];
 const env={...process.env,GAMECREATOR_DATA_DIR:data,GAMECREATOR_USER_DATA_DIR:path.join(dir,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 const idle=()=>page.waitForFunction(()=>!document.querySelector('.ps-trigger')?.disabled);
 const catalog=()=>page.evaluate(()=>JSON.parse(window.desktopClient.storage.getItem('gamecreator.projects.v1')));
 const menu=async name=>{await idle();await page.locator('.ps-trigger').click();await page.getByRole('menuitem',{name,exact:true}).click();};
 const setSave=async destination=>app.evaluate(({dialog},destination)=>{dialog.showSaveDialog=async()=>destination?{canceled:false,filePath:destination}:{canceled:true};},destination);
 const setOpen=async destination=>app.evaluate(({dialog},destination)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[destination]});},destination);
 const closeNotice=async()=>{const dialog=page.locator('.pp-dialog');await dialog.getByRole('button',{name:'关闭',exact:true}).last().click();await idle();};
 async function launch(){app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.getByRole('button',{name:'进入本地工作区',exact:true}).click();await idle();}
 try{
  await launch();const original=path.join(dir,'独立旧项目');await setSave(original);
  await page.getByRole('button',{name:'保存到文件夹',exact:true}).click();await page.locator('.pp-path').filter({hasText:original}).waitFor();await closeNotice();
  assert.equal((await catalog()).activeId,id);assert.equal((await catalog()).projects[0].folderPath,original);
  assert.equal(JSON.parse(legacy.getItem('gamecreator.workspace.v1:'+id+':project')).description,'迁移前数据');
  await page.locator('.project-info textarea').fill('直接写入项目文件夹');await idle();
  const raw=await page.evaluate(id=>window.desktopClient.storage.getItem('gamecreator.workspace.v1:'+id+':project'),id);assert.equal(JSON.parse(raw).description,'直接写入项目文件夹');
  assert.equal(JSON.parse(legacy.getItem('gamecreator.workspace.v1:'+id+':project')).description,'迁移前数据');
  await page.keyboard.press('Control+s');await page.locator('.pp-path').waitFor();await closeNotice();
  const copy=path.join(dir,'副本');await setSave(copy);await menu('项目另存为…');await page.locator('.pp-path').filter({hasText:copy}).waitFor();await closeNotice();
  const copyId=(await catalog()).activeId;assert.notEqual(copyId,id);
  await page.locator('.project-info textarea').fill('副本独有内容');
  await app.evaluate(({shell})=>{globalThis.openedFolders=[];shell.openPath=async p=>{globalThis.openedFolders.push(p);return '';};});
  await idle();await page.locator('.ps-trigger').click();await page.getByRole('menuitemradio').filter({hasText:'旧项目'}).last().click({button:'right'});
  await page.locator('.ps-context-menu').getByRole('menuitem',{name:'打开项目文件夹'}).click();await idle();assert.equal((await app.evaluate(()=>globalThis.openedFolders)).at(-1),copy);
  await page.locator('.ps-trigger').click();await page.getByRole('menuitemradio').filter({hasText:'旧项目'}).last().click({button:'right'});
  await page.locator('.ps-context-menu').getByRole('menuitem',{name:'移除项目',exact:true}).click();await page.getByRole('dialog',{name:'从最近项目移除'}).getByRole('button',{name:'移除项目',exact:true}).click();await idle();
  assert.equal((await catalog()).projects.length,1);assert.ok(await fs.stat(path.join(copy,'project.gamecreator')));
  await setOpen(copy);await menu('打开项目');await idle();await page.locator('.project-info textarea').filter({hasText:''}).waitFor();
  await page.waitForFunction(id=>JSON.parse(window.desktopClient.storage.getItem('gamecreator.projects.v1')).activeId===id,copyId);
  assert.equal(await page.locator('.project-info textarea').inputValue(),'副本独有内容');
  await setSave(null);await menu('新建项目');const create=page.getByRole('dialog',{name:'新建项目',exact:true});await create.getByLabel('项目名称',{exact:true}).fill('新项目');await create.getByRole('button',{name:'选择位置并创建'}).click();await idle();assert.equal((await catalog()).projects.length,2);
  const fresh=path.join(dir,'新项目');await setSave(fresh);await create.getByRole('button',{name:'选择位置并创建'}).click();await page.waitForFunction(()=>!document.querySelector('.ps-dialog[open]'));await idle();
  assert.equal((await catalog()).projects.length,3);assert.ok(await fs.stat(path.join(fresh,'project.gamecreator')));
  await app.close();app=null;await launch();assert.equal(await page.locator('.project-info input').first().inputValue(),'新项目');
  await setOpen(original);await menu('打开项目');await page.waitForFunction(id=>JSON.parse(window.desktopClient.storage.getItem('gamecreator.projects.v1')).activeId===id,id);await idle();
  assert.equal(await page.locator('.project-info textarea').inputValue(),'直接写入项目文件夹');
  for(const name of ['植物大战僵尸','星露谷物语','空洞骑士','极乐迪斯科','吸血鬼幸存者']) {
    const destination=path.join(dir,name);await setSave(destination);await menu('从原型示例创建项目');
    const template=page.getByRole('dialog',{name:'从原型示例创建项目',exact:true});await template.getByRole('radio',{name,exact:true}).check();
    await template.getByRole('button',{name:'创建并打开',exact:true}).click();await template.waitFor({state:'hidden'});await idle();
    const current=await catalog(),active=current.projects.find(p=>p.id===current.activeId);assert.equal(active.folderPath,destination);
    const counts=await page.evaluate(id=>{const get=s=>JSON.parse(window.desktopClient.storage.getItem('gamecreator.workspace.v1:'+id+':'+s));return [get('gameplay').designs.length,get('art-assets').assets.length];},active.id);
    assert.ok(counts.every(n=>n>0));assert.ok((await fs.readdir(path.join(destination,'archives'))).length>=16);
  }
  await page.locator('.ps-trigger').click();await fs.mkdir(path.join(root,'.gamecreator/qa'),{recursive:true});await page.screenshot({path:path.join(root,'.gamecreator/qa/folder-projects-success.png')});
  const last=(await catalog()).projects.find(p=>p.id===(JSON.parse(legacy.getItem('gamecreator.projects.v1'))).activeId);
  await app.close();app=null;const moved=last.folderPath+'-moved';await fs.rename(last.folderPath,moved);await launch();
  await page.getByText('项目文件夹暂时无法读取。',{exact:false}).waitFor();await setOpen(moved);await menu('打开项目');await idle();
  await page.locator('.project-info textarea').waitFor();assert.equal((await catalog()).projects.find(p=>p.id===last.id).folderPath,moved);
  assert.deepEqual(errors,[]);console.log('PASS desktop project folders: migration, direct autosave, Ctrl+S, independent Save As, native reveal, remove/reopen, canceled/new creation, restart.');
 }catch(error){if(page){console.error((await page.locator('body').innerText()).slice(0,5500));await fs.mkdir(path.join(root,'.gamecreator/qa'),{recursive:true});await page.screenshot({path:path.join(root,'.gamecreator/qa/folder-projects.png')});}throw error;}finally{if(app)await app.close();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('gc-folder-ui-'));await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
