const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {fixture}=require('./authoring-fixture.cjs');
const {createGlobalClient}=require('../shared/workflow-global-mcp.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'),f=await fixture(),profile=path.join(f.root,'profile'),credentialFile=path.join(f.root,'producer.json');fs.writeFileSync(credentialFile,JSON.stringify(f.secret));f.folders.close();
 const env={...process.env,GAMECREATOR_DATA_DIR:path.join(f.root,'data'),GAMECREATOR_USER_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 let app,page,client;
 try{
  app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));const button=name=>page.getByRole('button',{name,exact:true});
  await button('进入本地工作区').click();await page.getByRole('heading',{level:1,name:'项目概览',exact:true}).waitFor();
  await button('MCP 连接').click();await page.getByRole('heading',{level:1,name:'MCP 连接',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),0);
  client=createGlobalClient({discoveryFile:path.join(profile,'mcp/service.json'),name:'令牌自助回归助手'});
  const bound=await client.call('gc_connect_credential',{credentialFile});assert.equal(bound.access,'ready');const connectionId=bound.connection.id;
  assert.equal((await client.call('gc_project_read',{connectionId,credentialFile})).projectId,f.project.id);assert.equal(fs.existsSync(path.join(profile,'ai-credential-vault')),false);
  await page.getByRole('heading',{name:'全新原型 · 制作人',exact:true}).waitFor();await button('客户端接入').click();await page.getByText('一次注册，凭令牌自助接入',{exact:true}).waitFor();assert.match(await page.locator('.mcp-page pre').first().innerText(),/workflow-global-mcp/);
  await button('接入策略').click();await page.getByLabel('接入方式',{exact:true}).selectOption('approval');await page.getByText('设置已保存',{exact:true}).waitFor();await assert.rejects(client.call('gc_project_read',{connectionId,credentialFile}),/附加会话审批/);
  await page.getByRole('button',{name:/^会话与审批/}).click();await page.getByText(client.verificationCode,{exact:true}).waitFor();await page.getByRole('checkbox',{name:/全新原型.*制作人/}).check();await button('保存附加审批').click();await page.getByText(/附加批准 1 个/).waitFor();
  assert.equal((await client.call('gc_project_read',{connectionId,credentialFile})).projectId,f.project.id);
  await button('调用记录').click();await page.getByText(/全新原型 · 制作人 · gc_project_read/).first().waitFor();await button('接入策略').click();await page.getByLabel('接入方式',{exact:true}).selectOption('credential');
  await page.screenshot({path:path.join(root,'.gamecreator/qa/mcp-credential-access.png'),fullPage:true});
  await page.getByRole('button',{name:/^会话与审批/}).click();assert.equal(await button('保存附加审批').count(),0);await button('撤销会话').click();await assert.rejects(client.call('gc_connections'),/撤销/);
  await button('停止接入').click();await page.getByText('服务已停止',{exact:true}).waitFor();await button('启动接入').click();await page.getByText('服务运行中',{exact:true}).waitFor();await button('返回工作区').click();await page.getByRole('heading',{level:1,name:'项目概览',exact:true}).waitFor();assert.deepEqual(errors,[]);
  console.log('PASS desktop credential MCP: automatic identity connection without vault, per-call signed read, optional approval policy, session approval, logs, revocation and service controls.');
 }catch(error){if(page&&!page.isClosed())console.error((await page.locator('body').innerText()).slice(-2500));throw error;}
 finally{await client?.close();if(app)await app.close();f.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
