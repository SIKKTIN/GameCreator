const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createWorkspaceStorage}=require('../desktop/test-workspaces.cjs'),{createFolderProjects}=require('../desktop/folder-projects.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
  const {preparePrototypeProject,writePrototypeProject}=await import('../src/prototype-import.ts');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-feedback-ui-')),data=path.join(dir,'data'),engine=path.join(dir,'engine');
  await fs.mkdir(engine);await fs.writeFile(path.join(engine,'project.godot'),'config_version=5');
  const storage=createWorkspaceStorage(data),example=JSON.parse(await fs.readFile(path.join(root,'examples/prototypes/plants-vs-zombies.json'),'utf8'));
  const prepared=preparePrototypeProject({schema:2,projects:[],activeId:'',mode:'project'},example,'开发反馈验收');writePrototypeProject(storage,prepared);
  prepared.project.config={engine:'godot-gdscript',projectPath:engine,enumPath:'.',dataPath:'data/generated',outputFormat:'json',autoSync:false,backupBeforeSync:true};storage.setItem('gamecreator.projects.v1',JSON.stringify(prepared.catalog));
  const id=prepared.project.id,folders=createFolderProjects({legacyStorage:storage,dataDirectory:data});
  const saved=folders.create(path.join(dir,'project'),prepared.project,[],id);folders.storage.setItem('gamecreator.projects.v1',JSON.stringify({...prepared.catalog,projects:[saved]}));folders.close();
  const sk='gamecreator.workspace.v1:'+id+':project-schedule',tk='gamecreator.workspace.v1:'+id+':development-tools';
  let app,page;const errors=[],env={...process.env,GAMECREATOR_DATA_DIR:data,GAMECREATOR_USER_DATA_DIR:path.join(dir,'profile')};delete env.ELECTRON_RUN_AS_NODE;
  const button=name=>page.getByRole('button',{name,exact:true}),tab=name=>page.getByRole('tab',{name,exact:true}),field=name=>page.getByLabel(name,{exact:true});
  const read=key=>page.evaluate(k=>JSON.parse(window.desktopClient.storage.getItem(k)),key);
  async function launch(){app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1580,1080));await button('进入本地工作区').click();await button('引擎设置').click();}
  async function scan(){await button('读取开发反馈').click();await button('读取开发反馈').waitFor();}
  async function post(target,changes,summary){const p=JSON.parse(await fs.readFile(path.join(engine,'gamecreator/project.json'),'utf8'));const v={schema:1,projectId:id,engine:'godot-gdscript',id:randomUUID(),snapshotId:p.snapshotId,target,author:'程序开发 / AI 助手',summary,evidence:['入口：debug/animation_preview.tscn','验证：播放、暂停、逐帧和事件轨道通过；等待美术验收'],changes};await fs.writeFile(path.join(engine,'gamecreator/feedback',v.id+'.json'),JSON.stringify(v,null,2));return v;}
  try {
    await launch();await tab('同步配置').click();assert.equal(await field('同步开发协作（任务与工具回写）').isChecked(),true);
    await button('预览同步变更').click();await page.locator('.es-summary').waitFor();await button('同步到工程').click();await page.getByText(/文件已同步；引擎导入状态未检测，共/).waitFor();
    const schedule=await read(sk),toolStore=await read(tk),task=schedule.tasks.find(t=>t.title==='开发骨骼动画预览工具'),tool=toolStore.tools.find(t=>t.name==='骨骼动画预览工具');assert.ok(task&&tool);
    // Local schedule status is changed after the exported baseline.
    await button('项目排期').click();await tab('任务列表').click();await page.getByRole('row').filter({hasText:task.title}).getByRole('button').first().click();
    const dialog=page.getByRole('dialog',{name:'制作任务详情',exact:true});await dialog.getByLabel('制作状态',{exact:true}).selectOption('受阻');await dialog.getByRole('button',{name:'关闭',exact:true}).click();
    const f=await post({kind:'task',id:task.id},{status:'待验收',actualStart:'2026-09-22',result:'动画预览实现完成，等待验收'},'动画预览任务提交验收');
    await button('引擎设置').click();await tab('开发反馈').click();await field('反馈处理 任务状态').waitFor();assert.equal(await button('应用反馈').isDisabled(),true);await field('反馈处理 任务状态').selectOption('feedback');
    await fs.mkdir(path.join(root,'.gamecreator/qa'),{recursive:true});await page.screenshot({path:path.join(root,'.gamecreator/qa/engine-feedback.png')});await page.locator('.ef-field').first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(root,'.gamecreator/qa/engine-feedback-diff.png')});
    await button('应用反馈').click();await page.getByText(/反馈已应用，排期和开发工具已刷新/).waitFor();let next=await read(sk);assert.equal(next.tasks.find(t=>t.id===task.id).status,'待验收');assert.deepEqual(next.milestones,schedule.milestones);assert.equal((await read(tk)).tools.find(t=>t.id===tool.id).status,'待开发');
    await button('处理记录 1').waitFor();await page.getByText('没有待处理反馈',{exact:true}).waitFor();
    await button('项目排期').click();await tab('任务列表').click();assert.match(await page.getByRole('row').filter({hasText:task.title}).innerText(),/待验收/);
    await button('引擎设置').click();await tab('开发反馈').click();await button('处理记录 1').waitFor();await page.getByText('没有待处理反馈',{exact:true}).waitFor();
    const tf=await post({kind:'tool',id:tool.id},{status:'可使用',usage:'在开发场景选择骨架，点击播放或逐帧',delivery:'debug/animation_preview.tscn，测试完成'},'动画预览工具交付');await scan();await field('反馈处理 工具状态').waitFor();assert.equal(await button('应用反馈').isDisabled(),true);await page.getByLabel('已核实交付与验收情况，接收“已完成 / 可使用”状态').check();await button('应用反馈').click();await page.getByText(/反馈已应用/).waitFor();
    await button('开发工具').click();await button('选择开发工具：骨骼动画预览工具').click();assert.equal(await field('工具状态').inputValue(),'可使用');await tab('交付与验收').click();assert.equal(await field('交付位置与版本').inputValue(),'debug/animation_preview.tscn，测试完成');
    await post({kind:'task',id:task.id},{status:'已完成'},'待人工核实的完成反馈');await button('引擎设置').click();await tab('开发反馈').click();await button('忽略本条反馈').click();await page.getByText(/反馈已忽略/).waitFor();assert.equal((await read(sk)).tasks.find(t=>t.id===task.id).status,'待验收');
    await button('处理记录 3').click();assert.equal(await page.locator('.ef-panel .es-history').count(),3);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1100,900));await page.screenshot({path:path.join(root,'.gamecreator/qa/engine-feedback-narrow.png')});assert.equal(await page.locator('.ef-panel').evaluate(n=>n.scrollWidth>n.clientWidth+2),false);
    await app.close();app=null;await launch();await tab('开发反馈').click();await button('处理记录 3').waitFor();await page.getByText('没有待处理反馈',{exact:true}).waitFor();assert.equal((await read(sk)).feedbackHistory.length,2);assert.equal((await read(tk)).feedbackHistory.length,1);
    await fs.unlink(path.join(engine,'gamecreator/receipts',tf.id+'.json'));await scan();await button('补写回执').click();await page.getByText(/已补写 3 份处理回执/).waitFor();assert.equal(JSON.parse(await fs.readFile(path.join(engine,'gamecreator/receipts',f.id+'.json'),'utf8')).outcome,'applied');assert.deepEqual(errors,[]);
    // History is already local: an unavailable engine must not hide it behind a failed scan.
    await tab('工程连接').click();const marker=path.join(engine,'gamecreator/project.json');await fs.rename(marker,marker+'.saved');await tab('开发反馈').click();await button('处理记录 3').click();await page.getByRole('alert').filter({hasText:'协作项目文件已改变'}).waitFor();assert.equal(await page.locator('.ef-panel .es-history').count(),3);await fs.rename(marker+'.saved',marker);
    const batchTasks=schedule.tasks.filter(t=>t.id!==task.id).slice(0,4),batchTool=toolStore.tools.find(t=>t.id!==tool.id);
    for(const t of batchTasks.slice(0,3))await post({kind:'task',id:t.id},{status:'进行中',result:'批量开发进展'},'批量进度：'+t.title);
    await post({kind:'tool',id:batchTool.id},{status:'开发中',delivery:'批量工具交付'},'批量工具进展');await post({kind:'task',id:batchTasks[3].id},{status:'已完成',result:'已验证完成'},'批量完成验收');await post({kind:'task',id:task.id},{status:'受阻'},'需要逐条处理的冲突');
    await tab('工程连接').click();await tab('开发反馈').click();await button('待处理反馈 6').waitFor();assert.match(await button('一键应用反馈').innerText(),/4/);await button('一键应用反馈').click();await page.getByText(/批量处理完成：已应用 4 条，保留待处理 2 条，失败 0 条/).waitFor();await button('处理记录 7').waitFor();await button('待处理反馈 2').waitFor();await button('读取开发反馈').waitFor();
    assert.equal(await button('一键应用反馈').isDisabled(),true);await field('批量确认完成状态').check();await button('一键应用反馈').click();await page.getByText(/批量处理完成：已应用 1 条，保留待处理 1 条，失败 0 条/).waitFor();await button('处理记录 8').waitFor();await button('待处理反馈 1').waitFor();await button('读取开发反馈').waitFor();
    next=await read(sk);assert.ok(batchTasks.slice(0,3).every(t=>next.tasks.find(n=>n.id===t.id).status==='进行中'));assert.equal(next.tasks.find(t=>t.id===batchTasks[3].id).status,'已完成');assert.equal(next.tasks.find(t=>t.id===task.id).status,'待验收');assert.deepEqual(next.milestones,schedule.milestones);assert.equal((await read(tk)).tools.find(t=>t.id===batchTool.id).status,'开发中');
    await page.locator('.ef-batch-summary').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(root,'.gamecreator/qa/engine-feedback-batch.png')});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1100,900));assert.equal(await page.locator('.ef-panel').evaluate(n=>n.scrollWidth>n.clientWidth+2),false);await page.screenshot({path:path.join(root,'.gamecreator/qa/engine-feedback-batch-narrow.png')});
    await app.close();app=null;await launch();await tab('开发反馈').click();await button('处理记录 8').waitFor();await button('待处理反馈 1').waitFor();await button('处理记录 8').click();assert.equal(await page.locator('.ef-panel .es-history').count(),8);assert.deepEqual(errors,[]);
    console.log('PASS desktop feedback: automatic load and immediate persistent history, history after read failure, batch tasks/tools, completion confirmation, conflict retention, restart, receipt repair and narrow layout.');
  }catch(e){if(page&&!page.isClosed())console.error((await page.locator('body').innerText()).slice(-7000));console.error(errors);throw e;}
  finally{if(app)await app.close();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('gc-feedback-ui-'));await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
