const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const exec=require('node:util').promisify(require('node:child_process').execFile),{fixture}=require('./authoring-fixture.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'),f=await fixture();f.folders.close();
 const env={...process.env,GAMECREATOR_DATA_DIR:path.join(f.root,'data'),GAMECREATOR_USER_DATA_DIR:path.join(f.root,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 let app,page;const errors=[],button=name=>page.getByRole('button',{name,exact:true}),tab=name=>page.getByRole('tab',{name,exact:true}),card=name=>page.getByRole('article',{name:'开发者令牌：'+name,exact:true});
 try{
  app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await button('进入本地工作区').click();await button('人员分配').click();await tab('协作令牌').click();
  await page.getByLabel('开发者名称',{exact:true}).fill('制作负责人');await page.getByLabel('开发者岗位：制作人',{exact:true}).check();
  assert.equal(await page.getByLabel('开发者权限：team_manage',{exact:true}).isChecked(),true);
  assert.equal(await page.getByLabel('开发者权限范围',{exact:true}).inputValue(),'project');
  await button('创建开发者并生成令牌').click();await card('制作负责人').waitFor();await card('制作负责人').getByRole('button',{name:'复制令牌',exact:true}).click();await page.getByText('完整令牌已复制。',{exact:true}).waitFor();
  const secret=JSON.parse(await app.evaluate(({clipboard})=>clipboard.readText())),secretFile=path.join(f.root,'producer.json');fs.writeFileSync(secretFile,JSON.stringify(secret));
  const cli=path.join(f.project.folderPath,'ai/manage-team.cjs'),run=(...args)=>exec(process.execPath,[cli,...args]);
  const status=()=>run('status',secretFile).then(r=>JSON.parse(r.stdout));const state=await status();assert.equal(state.schedule.personnel.members.length,2);
  const input={name:'程序开发',duties:'实现原型并提供测试证据',permissions:['progress'],active:true,profile:{positionIds:['program'],taskIds:[],scope:'positions',expiresAt:'',projectModules:[],artPermissions:[]}},draftFile=path.join(f.root,'request.json');
  const write=(operation,input,revision)=>fs.writeFileSync(draftFile,JSON.stringify({id:randomUUID(),operation,input,revision}));
  write('create',input,state.revision);const created=JSON.parse((await run('run',secretFile,draftFile,path.join(f.root,'program.json'))).stdout);await card('程序开发').waitFor();
  await page.getByText('团队管理记录 · 1',{exact:true}).waitFor();assert.ok(!(await page.locator('body').innerText()).includes(secret.privateKey));
  // An open editor must not replace new external duties with its earlier snapshot.
  await card('程序开发').getByRole('button',{name:'编辑开发者',exact:true}).click();const dialog=page.getByRole('dialog',{name:'编辑开发者',exact:true});await dialog.getByLabel('开发者职责').fill('本地旧草稿');
  write('update',{...input,memberId:created.memberId,duties:'制作人更新的职责'},(await status()).revision);await run('run',secretFile,draftFile);
  await dialog.getByRole('button',{name:'保存开发者',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'已变化'}).waitFor();assert.equal((await status()).schedule.personnel.members.find(m=>m.id===created.memberId).duties,'制作人更新的职责');
  await dialog.getByRole('button',{name:'关闭编辑开发者',exact:true}).click();await card('程序开发').getByText('制作人更新的职责',{exact:true}).waitFor();
  // Reopen desktop: existing exported CLI discovers the new endpoint automatically.
  await app.close();app=null;
  app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();await button('进入本地工作区').click();await button('人员分配').click();await tab('开发者与令牌').click();await card('程序开发').waitFor();
  assert.equal((await status()).schedule.personnel.members.length,3);assert.deepEqual(errors,[]);
  console.log('PASS producer permission defaults, encrypted issuance, signed CLI, live list refresh, stale-editor conflict and restart discovery.');
 }finally{if(app)await app.close();f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
