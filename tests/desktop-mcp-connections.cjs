const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {fixture}=require('./authoring-fixture.cjs');
const {createGlobalClient}=require('../shared/workflow-global-mcp.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'),f=await fixture(),profile=path.join(f.root,'profile');f.folders.close();
 const env={...process.env,GAMECREATOR_DATA_DIR:path.join(f.root,'data'),GAMECREATOR_USER_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 let app,page,client;
 try{
  app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));const button=name=>page.getByRole('button',{name,exact:true});
  await button('进入本地工作区').click();await page.getByRole('heading',{level:1,name:'项目概览',exact:true}).waitFor();
  const encrypted=await app.evaluate(({safeStorage},secret)=>safeStorage.encryptString(JSON.stringify(secret)).toString('base64'),f.secret);
  const vault=path.join(profile,'ai-credential-vault');fs.mkdirSync(vault,{recursive:true});fs.writeFileSync(path.join(vault,require('node:crypto').createHash('sha256').update(JSON.stringify([f.project.id,f.credential.id])).digest('hex')+'.bin'),Buffer.from(encrypted,'base64'));
  await button('MCP 连接').click();await page.getByRole('heading',{level:1,name:'MCP 连接',exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog').count(),0);
  await page.getByLabel('GameCreator 项目',{exact:true}).selectOption(f.project.id);await page.getByLabel('开发者身份',{exact:true}).selectOption(f.credential.id);await page.getByLabel('连接名称',{exact:true}).fill('制作人测试连接');await button('添加连接').click();await page.getByRole('heading',{name:'制作人测试连接',exact:true}).waitFor();
  await button('客户端接入').click();await page.getByText('一次注册，按会话授权',{exact:true}).waitFor();assert.match(await page.locator('.mcp-page pre').innerText(),/workflow-global-mcp/);assert.ok(!(await page.locator('.mcp-page pre').innerText()).includes(f.project.folderPath));
  client=createGlobalClient({discoveryFile:path.join(profile,'mcp/service.json'),name:'桌面回归助手'});const initial=await client.call('gc_connections');assert.equal(initial.connections.length,0);
  await page.getByRole('button',{name:/^会话授权/}).click();await page.getByText(client.verificationCode,{exact:true}).waitFor();
  await page.getByRole('checkbox',{name:'制作人测试连接 · 制作人',exact:true}).check();await button('保存会话授权').click();await page.getByText(/已授权 1 个连接/).waitFor();
  const connection=(await client.call('gc_connections')).connections[0];assert.equal((await client.call('gc_project_read',{connectionId:connection.id})).projectId,f.project.id);
  await button('调用记录').click();await page.getByText(/制作人测试连接 · gc_project_read/).waitFor();
  await page.screenshot({path:path.join(root,'.gamecreator/qa/mcp-connections.png'),fullPage:true});
  await page.getByRole('button',{name:/^会话授权/}).click();await button('撤销会话').click();await assert.rejects(client.call('gc_connections'),/撤销/);
  await button('停止接入').click();await page.getByText('服务已停止',{exact:true}).waitFor();await button('启动接入').click();await page.getByText('服务运行中',{exact:true}).waitFor();
  await button('返回工作区').click();await page.getByRole('heading',{level:1,name:'项目概览',exact:true}).waitFor();assert.deepEqual(errors,[]);
  console.log('PASS desktop MCP: main-panel navigation, connection creation, config, session approval, signed read, call log, revocation and service controls.');
 }catch(error){if(page&&!page.isClosed())console.error((await page.locator('body').innerText()).slice(-2500));throw error;}
 finally{await client?.close();if(app)await app.close();f.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
