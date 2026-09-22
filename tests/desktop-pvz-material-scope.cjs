const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createWorkspaceStorage}=require('../desktop/test-workspaces.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-pvz-material-scope-')),qa=path.join(root,'.gamecreator/qa');await fs.mkdir(qa,{recursive:true});
 const {preparePrototypeProject,writePrototypeProject}=await import('../src/prototype-import.ts'),example=JSON.parse(await fs.readFile(path.join(root,'examples/prototypes/plants-vs-zombies.json'),'utf8')),storage=createWorkspaceStorage(path.join(dir,'data'));
 const p=preparePrototypeProject({schema:2,activeId:'',mode:'project',projects:[]},example,'植物大战僵尸 · 素材范围复核');writePrototypeProject(storage,p);storage.setItem('gamecreator.projects.v1',JSON.stringify(p.catalog));const key='gamecreator.workspace.v1:'+p.project.id+':art-assets',before=storage.getItem(key);
 const env={...process.env,GAMECREATOR_DATA_DIR:path.join(dir,'data'),GAMECREATOR_USER_DATA_DIR:path.join(dir,'profile')};delete env.ELECTRON_RUN_AS_NODE;let app,page;const errors=[];
 try{
  app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1780,1100));const click=n=>page.getByRole('button',{name:n,exact:true}).click();
  await click('进入本地工作区');await click('素材资产');await click('打开素材分类：角色');assert.equal(await page.getByRole('button',{name:/^打开素材条目：/}).count(),3);
  for(const name of ['向日葵场上形象与产出动作','豌豆射手形象与发射动作','坚果墙阻挡形象与受压表现'])await page.getByRole('button',{name:'打开素材条目：'+name,exact:true}).waitFor();
  await page.screenshot({path:path.join(qa,'pvz-material-characters.png')});await click('打开素材条目：向日葵场上形象与产出动作');await page.getByLabel('需求名称',{exact:true}).waitFor();await page.getByRole('tab',{name:'交付与版本',exact:true}).click();assert.equal(await page.getByLabel('资产名称',{exact:true}).inputValue(),'向日葵角色定型与配色基准');
  await click('素材分类');await click('打开素材分类：敌人与首领');assert.equal(await page.getByRole('button',{name:/^打开素材条目：/}).count(),2);await page.screenshot({path:path.join(qa,'pvz-material-enemies.png')});
  await click('素材分类');await click('打开素材分类：动画');assert.equal(await page.getByRole('button',{name:/^打开素材条目：/}).count(),4);
  assert.equal(storage.getItem(key),before);assert.deepEqual(errors,[]);console.log('PASS PVZ material scope: three plant requirements, two enemies, design reference links, four shared animation packages, read-only browsing.');
 }finally{if(app)await app.close();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
