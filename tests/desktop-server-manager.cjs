const { _electron } = require(process.env.GAMECREATOR_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs/promises'), fsSync = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const assert = require('node:assert/strict');
const { createCollaborationHost } = require('../desktop/collaboration-host.cjs');
const { createCollaborationServer } = require('../server/collaboration.cjs');
const root = path.resolve(__dirname, '..');
const waitUntil = async (check, message) => {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve,100)); }
  throw new Error(message);
};
(async () => {
  const prefix = path.join(os.tmpdir(),'gamecreator-host-ui-'), dir = await fs.mkdtemp(prefix), serverData = path.join(dir,'server');
  const probe = http.createServer(); await new Promise(resolve => probe.listen(0,'127.0.0.1',resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const url = `http://127.0.0.1:${port}`, host = createCollaborationHost({root,directory:serverData,port,nodeExecutable:process.execPath});
  let app, page, external, observer; const errors=[], closingApps=[];
  const launch = async (profile = 'primary') => {
    const env = {...process.env,GAMECREATOR_DATA_DIR:path.join(dir,profile,'client-data'),GAMECREATOR_USER_DATA_DIR:path.join(dir,profile,'profile'),
      GAMECREATOR_TEAM_DATA_DIR:serverData,GAMECREATOR_TEAM_PORT:String(port),GAMECREATOR_NODE_PATH:process.execPath};
    delete env.ELECTRON_RUN_AS_NODE; delete env.GAMECREATOR_TEAM_ACCOUNT;
    app = await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env,timeout:30000});
    page = await app.firstWindow({timeout:20000}); page.setDefaultTimeout(15000); page.on('pageerror',e=>errors.push(e.message));
  };
  const login = async username => {
    await page.getByLabel('账号',{exact:true}).fill(username); await page.getByLabel('密码',{exact:true}).fill(username+'123');
    await page.getByRole('button',{name:'登录',exact:true}).click(); await page.locator('.ps-trigger').waitFor();
  };
  const closeApp = async (closingApp = app) => {
    if (!closingApp) return;
    const launchedProcess = closingApp.process();
    closingApps.push(closingApp.close().then(() => null, error => error));
    // Check actual process exit. On Windows the detached server can retain debugger
    // handles, so Playwright's transport cleanup may finish only after that server stops.
    await waitUntil(() => launchedProcess.exitCode !== null || launchedProcess.signalCode !== null, 'Electron launcher did not exit');
    if (app === closingApp) app = null;
  };
  const manager = () => page.getByRole('main',{name:'服务器管理',exact:true});
  const openManager = async () => { await page.getByRole('navigation',{name:'管理模块',exact:true}).getByRole('button',{name:'服务器管理',exact:true}).click(); await manager().waitFor(); };
  const closeManager = () => manager().getByRole('button',{name:'返回工作区',exact:true}).click();
  const assertDenied = async () => {
    const result = await page.evaluate(async()=>{try{await window.desktopClient.collaborationHost.start();return 'allowed';}catch(e){return e.message;}});
    assert.match(result,/管理员/);
  };
  try {
    await launch(); await page.getByRole('button',{name:'登录',exact:true}).waitFor();
    await page.evaluate(()=>localStorage.setItem('gamecreator.auth.session',JSON.stringify({username:'admin',role:'admin'})));
    await page.reload(); await page.getByRole('button',{name:'登录',exact:true}).waitFor(); await assertDenied();
    await login('user'); assert.equal(await page.getByRole('button',{name:'服务器管理',exact:true}).count(),0); await assertDenied();
    await page.evaluate(()=>localStorage.setItem('gamecreator.auth.session',JSON.stringify({username:'admin',role:'admin'})));
    await page.reload(); await page.locator('.ps-trigger').waitFor(); await assertDenied();
    await page.getByRole('button',{name:'退出登录',exact:true}).click(); await login('admin');
    console.log('PASS: administrator permissions and forged-role rejection');
    assert.equal(await page.locator('.auth-toolbar').getByRole('button',{name:'服务器管理',exact:true}).count(),0);
    await page.getByRole('navigation',{name:'工作区模块',exact:true}).getByRole('button',{name:'数据配置',exact:true}).click();
    await page.getByRole('heading',{name:'还没有配置表',exact:true}).waitFor();
    assert.equal(await page.locator('.data-directory-heading small').innerText(),'0');
    await openManager(); await closeManager();
    await page.getByRole('heading',{name:'还没有配置表',exact:true}).waitFor();
    assert.equal(await page.locator('.data-directory-heading small').innerText(),'0');
    await page.getByRole('navigation',{name:'工作区模块',exact:true}).getByRole('button',{name:'故事文档',exact:true}).click();
    // A fresh workspace has no built-in tables or stories. Create the local
    // document through the same UI that the navigation regression exercises.
    await page.getByRole('button',{name:'新建故事文档',exact:true}).click();
    await page.getByLabel('文档标题',{exact:true}).fill('服务器管理导航测试');
    const localTitle = await page.getByLabel('文档标题',{exact:true}).inputValue();
    await page.getByLabel('文档正文',{exact:true}).fill('切换服务器管理后保留的本地内容');
    await openManager(); await manager().getByText('未启动',{exact:true}).waitFor();
    assert.equal(await page.getByRole('main').count(),1);
    assert.equal(await page.getByRole('dialog').count(),0);
    assert.ok((await manager().innerText()).includes(serverData));
    const primary = {app,page}; await launch('observer'); await login('admin'); await openManager();
    observer = {app,page}; app = primary.app; page = primary.page;
    await manager().getByRole('button',{name:'启动服务器',exact:true}).click();
    await manager().getByText('运行中',{exact:true}).waitFor(); assert.equal((await host.status()).managed,true);
    const observerManager = observer.page.getByRole('main',{name:'服务器管理',exact:true});
    await observerManager.getByText('运行中',{exact:true}).waitFor();
    await fs.mkdir(path.join(root,'.gamecreator/qa'),{recursive:true});
    await page.screenshot({path:path.join(root,'.gamecreator/qa/server-manager.png')});
    await closeManager();
    assert.equal(await page.getByLabel('文档标题',{exact:true}).inputValue(),localTitle);
    assert.equal(await page.getByLabel('文档正文',{exact:true}).inputValue(),'切换服务器管理后保留的本地内容');
    await page.locator('.ps-trigger').click(); await page.getByRole('menuitem',{name:'连接团队服务器',exact:true}).click();
    const connection = page.getByRole('dialog',{name:'连接团队服务器',exact:true});
    await connection.getByLabel('团队账号',{exact:true}).fill('bob');
    await connection.getByLabel('团队密码',{exact:true}).fill('保留连接表单');
    await connection.getByRole('button',{name:'前往服务器管理',exact:true}).click();
    await manager().getByRole('button',{name:'返回连接设置',exact:true}).click();
    assert.equal(await connection.getByLabel('团队密码',{exact:true}).inputValue(),'保留连接表单');
    await connection.getByLabel('团队密码',{exact:true}).fill('bob123');
    await connection.getByRole('button',{name:'前往服务器管理',exact:true}).click();
    await manager().getByText('运行中',{exact:true}).waitFor();
    await manager().getByRole('button',{name:'使用此地址连接',exact:true}).click();
    assert.equal(await connection.getByLabel('协作服务地址',{exact:true}).inputValue(),url);
    assert.equal(await connection.getByLabel('团队账号',{exact:true}).inputValue(),'bob');
    await connection.getByRole('button',{name:'连接并进入项目',exact:true}).click(); await page.locator('.team-project .story-workspace').waitFor();
    await page.getByRole('button',{name:'打开故事文档：第一章剧情',exact:true}).click();
    await page.getByLabel('文档正文',{exact:true}).fill('管理员退出后仍可共享的内容');
    await openManager(); await manager().getByText('运行中',{exact:true}).waitFor();
    await page.getByRole('navigation',{name:'工作区模块',exact:true}).getByRole('button',{name:'故事文档',exact:true}).click();
    assert.equal(await page.getByLabel('文档标题',{exact:true}).inputValue(),'第一章剧情');
    assert.equal(await page.getByLabel('文档正文',{exact:true}).inputValue(),'管理员退出后仍可共享的内容');
    await page.getByRole('button',{name:'保存到团队',exact:true}).click();
    await waitUntil(async()=> (await page.locator('.team-save-state').innerText()).includes('当前内容已保存到团队'),'Save did not finish');
    await closeApp(observer.app); observer = null;
    await closeApp();
    assert.equal((await host.status()).state,'running','Closing Electron must not stop the server');
    console.log('PASS: Electron exited and the managed server is still running');
    const token = await fetch(url+'/api/team/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'bob',password:'bob123'})}).then(r=>r.json()).then(r=>r.token);
    const shared = await fetch(url+'/api/team/projects/team-demo/stories',{headers:{Authorization:'Bearer '+token}}).then(r=>r.json());
    assert.ok(shared.stories.some(story=>story.content==='管理员退出后仍可共享的内容'));
    await launch(); await login('admin'); await openManager(); await manager().getByText('运行中',{exact:true}).waitFor();
    await manager().getByRole('button',{name:'停止服务器',exact:true}).click();
    await manager().getByRole('button',{name:'确认停止服务器',exact:true}).click(); await manager().getByText('未启动',{exact:true}).waitFor();
    await waitUntil(()=>!fsSync.existsSync(path.join(serverData,'.host-runtime.json')),'Ownership file not removed');
    assert.ok(fsSync.existsSync(path.join(serverData,'team.sqlite')));
    await manager().getByRole('button',{name:'启动服务器',exact:true}).click(); await manager().getByText('运行中',{exact:true}).waitFor();
    await host.stop(); await waitUntil(()=>!fsSync.existsSync(path.join(serverData,'.host-runtime.json')),'Second stop did not complete');
    external = await createCollaborationServer({directory:path.join(dir,'external-server'),port});
    await manager().getByRole('button',{name:'刷新服务器状态',exact:true}).click();
    await manager().getByText('外部服务运行中',{exact:true}).waitFor();
    assert.ok(await manager().getByRole('button',{name:'停止服务器',exact:true}).isDisabled());
    const stopped = await page.evaluate(async()=>{try{await window.desktopClient.collaborationHost.stop();return 'allowed';}catch(e){return e.message;}});
    assert.match(stopped,/不能停止/); assert.equal((await fetch(url+'/api/team/health')).status,200);
    // Local user stays unprivileged even when connected as the team's administrator.
    await page.getByRole('button',{name:'退出登录',exact:true}).click(); await login('user');
    assert.equal(await manager().count(),0); assert.equal(await page.getByRole('navigation',{name:'管理模块',exact:true}).count(),0);
    await assertDenied();
    await page.locator('.ps-trigger').click(); await page.getByRole('menuitem',{name:'连接团队服务器',exact:true}).click();
    const userConnection = page.getByRole('dialog',{name:'连接团队服务器',exact:true});
    assert.equal(await userConnection.getByRole('button',{name:'前往服务器管理',exact:true}).count(),0);
    await userConnection.getByLabel('协作服务地址',{exact:true}).fill(url);
    await userConnection.getByLabel('团队账号',{exact:true}).fill('admin');
    await userConnection.getByLabel('团队密码',{exact:true}).fill('admin123');
    await userConnection.getByRole('button',{name:'连接并进入项目',exact:true}).click(); await page.locator('.team-project .story-workspace').waitFor();
    assert.equal(await page.getByRole('button',{name:'服务器管理',exact:true}).count(),0); await assertDenied();
    assert.deepEqual(errors,[]);
    console.log('PASS: independent admin module; hidden for local user even with team-admin identity; two administrators sync status; empty data configuration, local document and team draft survive navigation; connection form preserved; background lifecycle, restart and external-service protection.');
  } catch(error) {
    if(page&&!page.isClosed()) console.error((await page.locator('body').innerText()).slice(0,5000));
    throw error;
  } finally {
    if(external) await external.close();
    if((await host.status()).managed) await host.stop();
    if(observer) await closeApp(observer.app);
    if(app) await closeApp();
    let closed;
    void Promise.all(closingApps).then(results => { closed = results; });
    await waitUntil(() => !!closed, 'Playwright did not finish cleanup after the test server stopped');
    for (const error of closed) if (error) throw error;
    await waitUntil(()=>!fsSync.existsSync(path.join(serverData,'.host-runtime.json')),'Cleanup server still running');
    assert.ok(path.resolve(dir).startsWith(path.resolve(prefix))); await fs.rm(dir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
