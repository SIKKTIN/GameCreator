const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createWorkspaceStorage}=require('../desktop/test-workspaces.cjs'),{createFolderProjects}=require('../desktop/folder-projects.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
  const {preparePrototypeProject,writePrototypeProject}=await import('../src/prototype-import.ts');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-data-ui-')),data=path.join(dir,'data'),engine=path.join(dir,'engine');
  await fs.mkdir(path.join(engine,'data/generated'),{recursive:true});await fs.writeFile(path.join(engine,'project.godot'),'config_version=5');
  const storage=createWorkspaceStorage(data),example=JSON.parse(await fs.readFile(path.join(root,'examples/prototypes/plants-vs-zombies.json'),'utf8'));
  const prepared=preparePrototypeProject({schema:2,projects:[],activeId:'',mode:'project'},example,'数据同步验收');writePrototypeProject(storage,prepared);
  prepared.project.config={engine:'godot-gdscript',projectPath:engine,enumPath:'.',dataPath:'data/generated',outputFormat:'json',autoSync:false,backupBeforeSync:true};storage.setItem('gamecreator.projects.v1',JSON.stringify(prepared.catalog));
  const id=prepared.project.id,key='gamecreator.enum-versions.v1:'+id;
  const initial=JSON.parse(storage.getItem(key));initial.data={datasets:{},columns:{}};storage.setItem(key,JSON.stringify(initial));
  const json={schema_version:1,rows:[{id:'sunflower',name:'向日葵',cost:50,hp:300,enabled:true},{id:'peashooter',name:'豌豆射手',cost:100,hp:300,enabled:false}]};
  const manifest={schema_version:1,project_version:'0.1.0',source:'docs/gamecreator/modules/data.md',wave_counts:[3,5,8],spawn_count:16};
  for(const [name,value] of [['pvz_plants',json],['manifest',manifest]])await fs.writeFile(path.join(engine,'data/generated',name+'.json'),JSON.stringify(value,null,2));
  const folders=createFolderProjects({legacyStorage:storage,dataDirectory:data});const saved=folders.create(path.join(dir,'project'),prepared.project,[],id);folders.storage.setItem('gamecreator.projects.v1',JSON.stringify({...prepared.catalog,projects:[saved]}));folders.close();
  let app,page;const errors=[],env={...process.env,GAMECREATOR_DATA_DIR:data,GAMECREATOR_USER_DATA_DIR:path.join(dir,'profile')};delete env.ELECTRON_RUN_AS_NODE;
  const button=name=>page.getByRole('button',{name,exact:true}),tab=name=>page.getByRole('tab',{name,exact:true}),field=name=>page.getByLabel(name,{exact:true});
  const read=()=>page.evaluate(k=>JSON.parse(window.desktopClient.storage.getItem(k)),key);
  async function launch(){app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1580,1080));await button('进入本地工作区').click();await button('数据同步').click();}
  async function preview(){await button('读取并预览差异').click();await page.locator('.ds-file').first().waitFor();}
  async function editManifest(value){await button('数据配置').click();await page.getByRole('button',{name:/manifest，/}).click();const row=page.locator('.json-object-field').filter({has:page.locator('code').filter({hasText:/^spawn_count$/})});await row.getByRole('button',{name:'编辑值',exact:true}).click();await field('编辑 spawn_count').fill(value);await row.getByRole('button',{name:'保存字段',exact:true}).click();}
  try {
    await launch();assert.equal(await field('数据配置子目录').inputValue(),'data/generated');await preview();assert.equal(await page.locator('.ds-file').count(),2);await button('应用导入（2）').click();await page.getByText(/导入完成，已保存/).waitFor();assert.deepEqual(Object.keys((await read()).data.datasets),['manifest','pvz_plants']);
    await editManifest('17');await button('数据同步').click();await tab('导出').click();await preview();await button('应用导出（2）').click();await page.getByText(/导出完成，已保存/).waitFor();assert.equal(JSON.parse(await fs.readFile(path.join(engine,'data/generated/manifest.json'),'utf8')).spawn_count,17);assert.deepEqual(JSON.parse(await fs.readFile(path.join(engine,'data/generated/pvz_plants.json'),'utf8')),json);
    // Both sides change the same typed field; no write is allowed until a choice is made.
    await editManifest('18');await fs.writeFile(path.join(engine,'data/generated/manifest.json'),JSON.stringify({...manifest,spawn_count:19}));await button('数据同步').click();await preview();await field('同步 manifest').check();assert.equal(await button('应用导入（2）').isDisabled(),true);await button('manifest 对象配置 spawn_count GameCreator 差异详情').click();await field('manifest value/spawn_count 采用值').selectOption('remote');await button('应用导入（2）').click();await page.getByText(/导入完成，已保存/).waitFor();assert.equal((await read()).data.datasets.manifest.find(r=>r.id==='spawn_count').value,'19');
    // Auto export runs while the editor is open, without navigating back to sync.
    await field('保存配置后自动导出已绑定文件').check();await button('保存同步设置').click();await page.getByText('数据同步设置已保存。',{exact:true}).waitFor();await editManifest('20');await page.getByText(/已自动导出 1 个配置文件/).waitFor();assert.equal(JSON.parse(await fs.readFile(path.join(engine,'data/generated/manifest.json'),'utf8')).spawn_count,20);
    await button('数据同步').click();await preview();await fs.mkdir(path.join(root,'.gamecreator/qa'),{recursive:true});await page.locator('.ds-tabs').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(root,'.gamecreator/qa/data-sync.png')});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1100,900));assert.equal(await page.locator('.data-sync').evaluate(n=>n.scrollWidth>n.clientWidth+2),false);await page.screenshot({path:path.join(root,'.gamecreator/qa/data-sync-narrow.png')});
    await app.close();app=null;await launch();assert.equal((await read()).data.datasets.manifest.find(r=>r.id==='spawn_count').value,'20');assert.ok((await read()).dataSync.history.length>=4);await button('数据配置').click();await page.getByRole('button',{name:/manifest，/}).click();await page.getByLabel('对象配置编辑器').waitFor();await page.screenshot({path:path.join(root,'.gamecreator/qa/data-sync-object.png')});assert.deepEqual(errors,[]);
    // The schema review groups a missing column once, while the grid only shows
    // values for matching keys. Batch and custom decisions still persist exactly.
    await button('数据同步').click();
    const changed={...json,rows:json.rows.map(({cost,...row},i)=>({...row,price:cost,hp:400+i*100,name:i?row.name:'向日葵 · 新'}))};
    await fs.writeFile(path.join(engine,'data/generated/pvz_plants.json'),JSON.stringify(changed));await preview();
    const card=page.locator('.ds-file').filter({has:field('同步 pvz_plants')});
    const structure=page.getByRole('table',{name:'pvz_plants 字段结构差异',exact:true}),grid=page.getByRole('table',{name:'pvz_plants 同名字段值差异',exact:true});
    assert.equal(await structure.locator('tbody tr').count(),2);assert.equal(await grid.locator('tbody tr').count(),4);
    const headings=await grid.locator('thead').innerText();assert.ok(headings.includes('hp'));assert.ok(!headings.includes('cost'));assert.ok(!headings.includes('price'));assert.ok(!(await structure.innerText()).includes('50'));
    await field('同步 pvz_plants').check();assert.equal(await button('应用导入（2）').isDisabled(),true);
    await card.scrollIntoViewIfNeeded();await card.screenshot({path:path.join(root,'.gamecreator/qa/data-sync-comparison.png')});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1100,900));
    assert.equal(await page.locator('.data-sync').evaluate(n=>n.scrollWidth>n.clientWidth+2),false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
    await card.screenshot({path:path.join(root,'.gamecreator/qa/data-sync-comparison-narrow.png')});
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1580,1080));
    await card.getByRole('button',{name:'值差异全部采用引擎',exact:true}).click();
    await field('pvz_plants peashooter 批量处理').selectOption('local');
    await button('pvz_plants sunflower hp GameCreator 差异详情').click();await field('pvz_plants rows/sunflower/hp 采用值').selectOption('custom');
    await field('pvz_plants rows/sunflower/hp 自定义 JSON 值').fill('{');await field('pvz_plants cost 确认删除').check();assert.equal(await button('应用导入（2）').isDisabled(),true);
    await field('pvz_plants rows/sunflower/hp 自定义 JSON 值').fill('325');await card.screenshot({path:path.join(root,'.gamecreator/qa/data-sync-comparison-custom.png')});
    await button('应用导入（2）').click();await page.getByText(/导入完成，已保存/).waitFor();
    const result=(await read()).data.datasets.pvz_plants;assert.equal(result[0].hp,'325');assert.equal(result[1].hp,'300');assert.equal(result[0].price,'50');assert.ok(result.every(row=>!Object.hasOwn(row,'cost')));assert.deepEqual(errors,[]);
    console.log('PASS desktop data sync: import/export, conflicts, automatic export, restart, header alignment, grouped missing fields, value matrix, batch/custom decisions, deletion confirmation and narrow layout.');
  }catch(e){if(page&&!page.isClosed())console.error((await page.locator('body').innerText()).slice(-8000));console.error(errors);throw e;}
  finally{if(app)await app.close();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('gc-data-ui-'));await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
