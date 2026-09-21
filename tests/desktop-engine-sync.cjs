const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createWorkspaceStorage}=require('../desktop/test-workspaces.cjs'),{createArtFiles}=require('../desktop/art-files.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
 const {preparePrototypeProject,writePrototypeProject}=await import('../src/prototype-import.ts');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-sync-ui-')),data=path.join(dir,'data'),engine=path.join(dir,'engine');await fs.mkdir(engine);await fs.writeFile(path.join(engine,'project.godot'),'config_version=5');
 const storage=createWorkspaceStorage(data),example=JSON.parse(await fs.readFile(path.join(root,'examples/prototypes/plants-vs-zombies.json'),'utf8'));
 const prepared=preparePrototypeProject({schema:2,projects:[],activeId:'',mode:'project'},example,'工程同步测试');writePrototypeProject(storage,prepared);
 const id=prepared.project.id;prepared.project.config={engine:'godot-gdscript',projectPath:engine,enumPath:'.',dataPath:'data/generated',outputFormat:'json',autoSync:false,backupBeforeSync:true};storage.setItem('gamecreator.projects.v1',JSON.stringify(prepared.catalog));
 const source=path.join(dir,'plant.png');await fs.writeFile(source,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aV8AAAAASUVORK5CYII=','base64'));
 const files=await createArtFiles(data).importFiles('project:'+id,[source]),artKey='gamecreator.workspace.v1:'+id+':art-assets',art=JSON.parse(storage.getItem(artKey)),now=new Date().toISOString();
 art.assets.push({id:'sync-plant',name:'同步测试植物',description:'用于真实文件交付测试',versions:[{id:'delivery-v1',name:'交付第一版',notes:'',placeholder:false,review:'已通过',feedback:'',files,createdAt:now}],adoptedVersionId:'delivery-v1',archived:false,createdAt:now,updatedAt:now});storage.setItem(artKey,JSON.stringify(art));
 let app,page;const errors=[],env={...process.env,GAMECREATOR_DATA_DIR:data,GAMECREATOR_USER_DATA_DIR:path.join(dir,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 const button=name=>page.getByRole('button',{name,exact:true}),tab=name=>page.getByRole('tab',{name,exact:true}),field=name=>page.getByLabel(name,{exact:true});
 async function launch(){app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1440,1000));await button('进入本地工作区').click();await button('引擎设置').click();}
 async function check(){await tab('待同步变更').click();await button('检查同步变更').click();await page.locator('.es-summary').waitFor();}
 try {
   await launch();await tab('同步配置').click();await field('文档目标目录').fill('res://design/reference');await field('素材目标目录').fill('art/delivery');await button('保存同步配置').click();await page.getByText('同步配置已保存。',{exact:true}).waitFor();
   await button('预览同步变更').click();await page.locator('.es-summary').waitFor();assert.ok((await page.locator('.es-changes').innerText()).includes('同步测试植物'));
   await fs.mkdir(path.join(root,'.gamecreator/qa'),{recursive:true});await page.screenshot({path:path.join(root,'.gamecreator/qa/engine-sync-preview.jpg'),type:'jpeg',quality:70,scale:'css'});
   await button('同步到工程').click();await page.getByText(/文件已同步；引擎导入状态未检测，共/).waitFor();
   const manifest=JSON.parse(await fs.readFile(path.join(engine,'.gamecreator-sync/manifest.json'),'utf8')),asset=manifest.files.find(f=>f.kind==='asset');assert.equal(manifest.history.length,1);assert.ok(asset.path.startsWith('art/delivery/'));assert.deepEqual(await fs.readFile(path.join(engine,asset.path)),await fs.readFile(source));assert.match(await fs.readFile(path.join(engine,'design/reference/modules/gameplay.md'),'utf8'),/植物|豌豆/);
   await check();await page.getByText('所选范围的工程文件已是最新版本。',{exact:true}).waitFor();assert.equal(await button('同步到工程').isDisabled(),true);
   const target='design/reference/modules/gameplay.md';await fs.writeFile(path.join(engine,target),'手工修改，必须保留');await check();assert.equal(await button('同步到工程').isDisabled(),true);await field('冲突处理 '+target).selectOption('keep');assert.equal(await button('同步到工程').isDisabled(),true);assert.equal(await fs.readFile(path.join(engine,target),'utf8'),'手工修改，必须保留');
   await field('冲突处理 '+target).selectOption('replace');await button('同步到工程').click();await page.getByText(/文件已同步；引擎导入状态未检测，共 1 个文件/).waitFor();assert.match(await fs.readFile(path.join(engine,target),'utf8'),/植物/);
   await tab('同步记录').click();await page.locator('.es-history').first().waitFor();assert.equal(await page.locator('.es-history').count(),2);await page.locator('.es-history').first().locator('summary').click();assert.ok((await page.locator('.es-history').first().innerText()).includes('写入前备份位置'));
   await tab('同步配置').click();await field('故事文档').uncheck();await button('保存同步配置').click();await check();await field('确认移除 design/reference/modules/stories.md').check();await button('同步到工程').click();await page.getByText(/文件已同步；引擎导入状态未检测，共/).waitFor();assert.equal(await fs.stat(path.join(engine,'design/reference/modules/stories.md')).catch(()=>null),null);
   await app.close();app=null;await launch();await tab('同步配置').click();assert.equal(await field('文档目标目录').inputValue(),'design/reference');assert.equal(await field('故事文档').isChecked(),false);
   await page.screenshot({path:path.join(root,'.gamecreator/qa/engine-sync-settings.jpg'),type:'jpeg',quality:70,scale:'css'});
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1100,900));await page.waitForTimeout(200);const overflow=await page.locator('.engine-content').evaluate(n=>n.scrollWidth>n.clientWidth+2);assert.equal(overflow,false);await tab('同步记录').click();await page.locator('.es-history').first().waitFor();assert.equal(await page.locator('.es-history').count(),3);
   assert.deepEqual(errors,[]);console.log('PASS desktop engine sync: selected docs + real adopted asset, custom paths, unchanged checks, conflict keep/replace, explicit removal, backups/history, restart and narrow layout.');
 }catch(e){if(page&&!page.isClosed())console.error((await page.locator('body').innerText()).slice(-6000));console.error(errors);throw e;}
 finally{if(app)await app.close();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('gc-sync-ui-'));await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
