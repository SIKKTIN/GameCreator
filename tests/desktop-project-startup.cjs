const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {fixture}=require('./authoring-fixture.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'),f=await fixture(),engine=path.join(f.root,'engine');fs.mkdirSync(engine);fs.writeFileSync(path.join(engine,'project.godot'),'config_version=5');
 f.project.config.projectPath=engine;const catalog=JSON.parse(f.storage.getItem('gamecreator.projects.v1'));catalog.projects[0].config=f.project.config;f.storage.setItem('gamecreator.projects.v1',JSON.stringify(catalog));f.folders.close();
 const env={...process.env,GAMECREATOR_DATA_DIR:path.join(f.root,'data'),GAMECREATOR_USER_DATA_DIR:path.join(f.root,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 let app,page;const errors=[];const button=name=>page.getByRole('button',{name,exact:true});
 async function launch(){app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1460,1020));await button('进入本地工作区').click();}
 try{
  await launch();await button('工程连接').click();await page.getByRole('form',{name:'工程连接'}).waitFor();
  await button('工程同步').click();assert.equal(await page.getByRole('tab',{name:'工程连接',exact:true}).count(),0);await page.getByRole('tab',{name:'同步配置',exact:true}).waitFor();
  await button('项目启动').click();await page.getByText(/本机没有此凭证/).first().waitFor();
  await app.evaluate(({app,safeStorage},{root,secret})=>{const require=process.getBuiltinModule('module').createRequire(root+'/desktop/main.cjs');require(require('node:path').join(root,'desktop/ai-credential-vault.cjs')).createCredentialVault({directory:require('node:path').join(app.getPath('userData'),'ai-credential-vault'),safeStorage}).put(secret);},{root,secret:f.secret});
  await button('检查准备状态').click();await page.getByText('凭证可用',{exact:true}).waitFor();
  await page.getByLabel('协作入口子目录',{exact:true}).fill('team');await button('预览初始化').click();await page.getByRole('heading',{name:'确认初始化内容',exact:true}).waitFor();await button('初始化项目').click();await page.getByRole('status').filter({hasText:'项目协作环境已初始化'}).waitFor();
  const secret=JSON.parse(fs.readFileSync(path.join(engine,'team/personal',f.memberId+'.json')));assert.equal(secret.credentialId,f.credential.id);assert.equal(secret.privateKey,f.secret.privateKey);
  assert.ok(fs.readFileSync(path.join(engine,'docs/gamecreator/README.md'),'utf8').includes(f.project.folderPath));assert.ok(fs.existsSync(path.join(engine,'docs/gamecreator/modules/project-guide/usage-guide.md')));
  assert.equal((await page.locator('body').innerText()).includes(f.secret.privateKey),false);
  for(const name of ['项目指南','玩法与关卡','系统与开发','内容制作','数据与同步']){const b=page.locator('#workspace-navigation').getByRole('button',{name,exact:true});if(await b.getAttribute('aria-expanded')==='true')await b.click();}
  fs.mkdirSync(path.join(root,'.gamecreator/qa'),{recursive:true});await page.locator('.local-workspace>main').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(root,'.gamecreator/qa/project-startup.png')});
  await button('预览初始化').click();await page.getByRole('heading',{name:'确认初始化内容',exact:true}).waitFor();await button('初始化项目').click();await page.getByRole('status').filter({hasText:'项目协作环境已初始化'}).waitFor();
  await app.close();app=null;await launch();await button('项目启动').click();await page.getByText(/上次完成/).waitFor();assert.equal(await page.getByLabel('协作入口子目录',{exact:true}).inputValue(),'team');
  await button('进入项目编写').click();await page.getByText('本页的协作文件与设计提交在此目录的 ai/ 中读写。',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);console.log('PASS startup: separated navigation, missing vault credential, private export, classified documents, repeat, restart, workflow paths and browser error checks.');
 }catch(e){if(page&&!page.isClosed()){console.error((await page.locator('body').innerText()).slice(-5000));await page.screenshot({path:path.join(root,'.gamecreator/qa/startup-failure.png')}).catch(()=>{});}throw e;}
 finally{if(app)await app.close();f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
