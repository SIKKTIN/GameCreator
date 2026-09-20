// Isolated acceptance: metadata, real file IPC, references, review and recovery.
const { _electron } = require(process.env.GAMECREATOR_PLAYWRIGHT_PATH || 'playwright');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { createWorkspaceStorage } = require('../desktop/test-workspaces.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const { createGameplay } = await import('../src/gameplay.ts');
  const { createRule } = await import('../src/gameplay-structure.ts');
  const { createStageObject } = await import('../src/gameplay-stage.ts');
  const { createFunctionalSystem, createCapability, emptyFunctionalSystems } = await import('../src/functional-systems.ts');
  const { artIssues } = await import('../src/art-assets.ts');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-art-')), dataDir = path.join(dir, 'data'), storage = createWorkspaceStorage(dataDir);
  const a = 'project-art-a', b = 'project-art-b', key = id => 'gamecreator.workspace.v1:' + id + ':art-assets', read = () => JSON.parse(storage.getItem(key(a)));
  const cfg = {engine:'oasis-lua',projectPath:'',enumPath:'Script/Const',dataPath:'Script/Config',outputFormat:'lua',autoSync:false,backupBeforeSync:true};
  storage.setItem('gamecreator.projects.v1', JSON.stringify({schema:2,activeId:a,mode:'project',projects:[{id:a,name:'美术项目A',config:cfg,initialContent:'empty'},{id:b,name:'美术项目B',config:cfg,initialContent:'empty'}]}));
  const design = createGameplay('种植与射击'), rule = {...createRule(), name:'种下豌豆射手'}, object = {...createStageObject('actor',2,2), name:'豌豆射手站位'};
  design.conditionRules = [rule]; design.space.objects = [object];
  const gameKey='gamecreator.workspace.v1:'+a+':gameplay', gameRaw=JSON.stringify({schema:3,designs:[design]});storage.setItem(gameKey,gameRaw);
  const system=createFunctionalSystem('战斗表现'),capability=createCapability(system.id,'播放攻击动画'),functional={...emptyFunctionalSystems(),systems:[system],capabilities:[capability]};
  const funcKey='gamecreator.workspace.v1:'+a+':functional-systems',funcRaw=JSON.stringify(functional);storage.setItem(funcKey,funcRaw);
  const png=path.join(dir,'pea-preview.png'), source=path.join(dir,'pea-source.psd');
  await fs.writeFile(png,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1sAAAAASUVORK5CYII=','base64'));
  await fs.writeFile(source,'Isolated QA source file; not a real PSD.');
  const env={...process.env,GAMECREATOR_DATA_DIR:dataDir,GAMECREATOR_USER_DATA_DIR:path.join(dir,'profile')};delete env.ELECTRON_RUN_AS_NODE;
  let app,page; const errors=[];
  const click = name => page.getByRole('button',{name,exact:true}).click(), field = name => page.getByLabel(name,{exact:true});
  async function launch(){app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await click('进入本地工作区');await click('素材资产');await click('查看全部内容');}
  async function selectProject(name){await page.locator('.ps-trigger').click();await page.getByRole('menuitemradio',{name:new RegExp('^'+name)}).click();await click('素材资产');await click('查看全部内容');}
  async function requirement(name){await page.getByRole('tab',{name:/^制作需求/}).click();await click('新建素材需求');const dialog=page.getByRole('dialog',{name:'新建素材需求',exact:true});assert.equal(await dialog.getByRole('textbox').count(),1);await dialog.getByLabel('新需求名称',{exact:true}).fill(name);await dialog.getByRole('button',{name:'创建需求',exact:true}).click();return read().requirements.at(-1).id;}
  async function asset(name){await page.getByRole('tab',{name:/^资产文件/}).click();await click('新建素材资产');const dialog=page.getByRole('dialog',{name:'新建素材资产',exact:true});assert.equal(await dialog.getByRole('textbox').count(),1);await dialog.getByLabel('新资产名称',{exact:true}).fill(name);await dialog.getByRole('button',{name:'创建资产',exact:true}).click();return read().assets.at(-1).id;}
  async function version(name,placeholder){await app.evaluate(({dialog},files)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:files});},[png,source]);await click('导入新版本');const dialog=page.getByRole('dialog',{name:'添加交付版本',exact:true});await dialog.getByLabel('交付版本名称',{exact:true}).fill(name);assert.equal(await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),false);await dialog.getByLabel('这是占位版本',{exact:true}).setChecked(placeholder);await dialog.getByLabel('交付版本备注',{exact:true}).fill('可追溯的交付说明');await dialog.getByRole('button',{name:'保存交付版本',exact:true}).click();}
  try{
    await launch();assert.equal(storage.getItem(key(a)),null);
    const req=await requirement('豌豆射手动画需求');await field('素材分类').selectOption('动画');await field('制作规格').fill('侧视，待机与攻击，透明背景');await field('素材验收标准').fill('攻击帧与发射事件对应');
    await field('素材需求来源类型').selectOption('gameplay');await field('素材需求关联目标').selectOption(design.id);await field('素材需求具体来源').selectOption(JSON.stringify(['object',object.id]));await click('关联需求来源');
    await field('素材需求来源类型').selectOption('capability');await field('素材需求关联目标').selectOption(capability.id);await click('关联需求来源');
    // Enter only a name, then attach copied delivery files.
    const assetId=await asset('豌豆射手动画');await version('v1 灰盒占位',true);await click('采用此版本');
    const first=read().assets.find(x=>x.id===assetId).versions[0];assert.equal(first.files.length,2);assert.equal(read().assets[0].adoptedVersionId,first.id);
    await click('预览交付文件：pea-preview.png');await page.locator('.ar-preview-image').waitFor();await page.waitForFunction(()=>document.querySelector('.ar-preview-image')?.naturalWidth>0);
    await page.getByRole('tab',{name:/^制作需求/}).click();await click('打开素材需求：豌豆射手动画需求');await field('选择关联素材资产').selectOption(assetId);await click('关联素材资产');
    assert.equal(await field('需求状态').getByRole('option',{name:'已通过',exact:true}).evaluate(option=>option.disabled),true);assert.notEqual(read().requirements.find(x=>x.id===req).status,'已通过');assert.equal(await page.locator('.ps-trigger').isDisabled(),false);
    // Reuse one asset in a second requirement.
    const req2=await requirement('卡牌预览素材');await field('选择关联素材资产').selectOption(assetId);await click('关联素材资产');assert.equal(read().links.filter(x=>x.assetId===assetId).length,2);
    await page.getByRole('tab',{name:/^资产文件/}).click();await click('打开素材资产：豌豆射手动画');await version('v2 正式动画',false);
    assert.equal(await page.getByRole('button',{name:'采用此版本',exact:true}).isDisabled(),true);
    await field('版本审核反馈').fill('动作节奏与轮廓符合要求');await field('版本审核状态').selectOption('已通过');await click('采用此版本');
    const second=read().assets[0].versions[1];assert.equal(read().assets[0].adoptedVersionId,second.id);assert.equal(read().assets[0].versions.length,2);
    await click('查看交付版本：v1 灰盒占位');assert.equal(await field('版本审核状态').inputValue(),'待审核');await click('查看交付版本：v2 正式动画');
    await fs.mkdir(path.join(root,'.gamecreator','qa'),{recursive:true});await page.screenshot({path:path.join(root,'.gamecreator/qa/art-asset-delivery.png')});
    await page.getByRole('tab',{name:/^制作需求/}).click();await click('打开素材需求：豌豆射手动画需求');await field('需求状态').selectOption('已通过');assert.equal(read().requirements.find(x=>x.id===req).status,'已通过');
    // Forward and reverse references work from actual existing modules.
    await click('玩法设计');await click('进入分类：未分类');await click('打开玩法：种植与射击');await page.getByRole('region',{name:'关联素材需求',exact:true}).getByRole('button',{name:'查看素材需求：豌豆射手动画需求',exact:true}).click();assert.equal(await field('需求名称').inputValue(),'豌豆射手动画需求');
    // Source labels are resolved from IDs, including precise spatial object.
    const sourceButton=page.getByRole('button',{name:/种植与射击.*空间对象/});await sourceButton.click();assert.equal(await field('对象名称').inputValue(),'豌豆射手站位');
    await click('功能系统');await click('打开功能：播放攻击动画');await page.getByRole('region',{name:'关联素材需求',exact:true}).getByRole('button',{name:'查看素材需求：豌豆射手动画需求',exact:true}).click();assert.equal(await field('需求名称').inputValue(),'豌豆射手动画需求');
    assert.deepEqual(artIssues(read(),{designs:[design],functional}),[]);
    await page.screenshot({path:path.join(root,'.gamecreator/qa/art-requirement-editor.png')});
    // Failed metadata write keeps a draft and blocks losing it through shell actions.
    const saved=storage.getItem(key(a));await app.evaluate(({ipcMain},key)=>{globalThis.artStorageHandler=ipcMain.listeners('workspace-storage')[0];ipcMain.removeAllListeners('workspace-storage');ipcMain.on('workspace-storage',(event,request)=>{if(request?.operation==='set'&&request.key===key){event.returnValue={ok:false,error:'模拟素材存档写入失败'};return;}globalThis.artStorageHandler(event,request);});},key(a));
    await field('需求描述').fill('磁盘失败仍保留的草稿');assert.equal(storage.getItem(key(a)),saved);await page.getByRole('button',{name:'重试保存素材资产',exact:true}).waitFor();assert.equal(await page.locator('.ps-trigger').isDisabled(),true);assert.equal(await page.getByRole('button',{name:'生成 AI 文档',exact:true}).isDisabled(),true);assert.equal(await page.evaluate(()=>window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),false);await click('返回启动页');assert.equal(await field('需求描述').inputValue(),'磁盘失败仍保留的草稿');
    await app.evaluate(({ipcMain})=>{ipcMain.removeAllListeners('workspace-storage');ipcMain.on('workspace-storage',globalThis.artStorageHandler);});await click('重试保存素材资产');assert.equal(read().requirements.find(x=>x.id===req).description,'磁盘失败仍保留的草稿');
    await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('write-markdown');ipcMain.handle('write-markdown',(_event,payload)=>{globalThis.artExport=payload;return '隔离测试导出';});});page.on('dialog',d=>d.accept());await click('生成 AI 文档');const exported=await app.evaluate(()=>globalThis.artExport);for(const value of ['素材需求','豌豆射手动画需求','侧视，待机与攻击','v1 灰盒占位','v2 正式动画','动作节奏与轮廓符合要求','pea-preview.png'])assert.ok(exported.content.includes(value),value);
    const persisted=storage.getItem(key(a));await selectProject('美术项目B');assert.equal(storage.getItem(key(b)),null);await asset('B 项目独立素材');assert.equal(storage.getItem(key(a)),persisted);await selectProject('美术项目A');
    // Original delivery location is no longer needed; relaunch loads the copied file.
    await fs.unlink(png);await fs.unlink(source);await app.close();app=null;await launch();await page.getByRole('tab',{name:/^资产文件/}).click();await click('打开素材资产：豌豆射手动画');await click('预览交付文件：pea-preview.png');await page.locator('.ar-preview-image').waitFor();await page.waitForFunction(()=>document.querySelector('.ar-preview-image')?.naturalWidth>0);assert.equal(storage.getItem(key(a)),persisted);assert.equal(storage.getItem(gameKey),gameRaw);assert.equal(storage.getItem(funcKey),funcRaw);
    await app.close();app=null;storage.setItem(key(a),'{"schema":99}');await launch();assert.equal(await page.getByRole('button',{name:'新建素材需求',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'生成 AI 文档',exact:true}).isDisabled(),true);assert.equal(storage.getItem(key(a)),'{"schema":99}');assert.deepEqual(errors,[]);
    console.log('PASS art assets: name-only creation, real imported copies and preview, reuse, version review/adoption, gameplay/object/function links, failed-save protection, export, project isolation, restart and corruption protection');
  }catch(error){if(page&&!page.isClosed())console.error((await page.locator('body').innerText()).slice(-7000));throw error;}
  finally{if(app)await app.close();const target=path.resolve(dir);assert.ok(target.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(target).startsWith('gc-art-'));await fs.rm(target,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
