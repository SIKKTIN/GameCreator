const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture}=require('./authoring-fixture.cjs'),{createClient}=require('../shared/workflow-mcp.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'),f=await fixture(),credentialFile=path.join(f.root,'identity.json');fs.writeFileSync(credentialFile,JSON.stringify(f.secret));f.folders.close();
 const env={...process.env,GAMECREATOR_DATA_DIR:path.join(f.root,'data'),GAMECREATOR_USER_DATA_DIR:path.join(f.root,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 let app,page;try{
  app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));const button=name=>page.getByRole('button',{name,exact:true});await button('进入本地工作区').click();await page.getByRole('heading',{level:1,name:'项目概览',exact:true}).waitFor();
  const client=createClient({projectDirectory:f.project.folderPath,credentialFile}),call=(name,args={})=>client.call('gc_'+name,args);
  await call('collaboration_export',{requestId:randomUUID()});await page.getByRole('heading',{level:1,name:'项目概览',exact:true}).waitFor();
  const context=await call('project_read'),draft={format:'gamecreator-content-change',schema:1,id:randomUUID(),projectId:f.project.id,snapshotId:context.snapshotId,intent:'project_change',target:{kind:'module',id:'project'},summary:'MCP 桌面回归',compatibility:{reuse:'沿用项目',modify:'更新描述',add:'无',archive:'无'},operations:[{id:'desc',module:'project',op:'set',path:'/description',value:'通过工作流工具更新的设计基线'}]};
  await call('content_submit',{draft,requestId:randomUUID()});const item=(await call('content_scan')).items[0];
  const apply=()=>call('content_apply',{id:item.id,digest:item.digest,reviewId:item.reviewId,requestId:randomUUID()});
  await button('工程连接').click();const form=page.getByRole('form',{name:'工程连接'});await form.waitFor();
  const inputs=form.locator('input');await inputs.first().fill('E:\\unsaved-test-path');
  await assert.rejects(apply(),/未完成|未保存/);assert.equal(await inputs.first().inputValue(),'E:\\unsaved-test-path');
  await inputs.first().fill('');await button('项目概览').click();await apply();
  await page.getByRole('heading',{level:1,name:'项目概览',exact:true}).waitFor();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('textarea')).some(el=>el.value==='通过工作流工具更新的设计基线'));
  assert.equal(await page.locator('.local-workspace[inert]').count(),0);assert.deepEqual(errors,[]);
  await button('AI 工作流工具').click();await page.getByRole('heading',{name:'制作人的完整操作顺序',exact:true}).waitFor();
  console.log('PASS desktop workflow MCP: signed submission, draft guard, page-preserving reload, latest design content and embedded help.');
 }catch(e){if(page&&!page.isClosed())console.error((await page.locator('body').innerText()).slice(-3000));throw e;}
 finally{if(app)await app.close();f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
