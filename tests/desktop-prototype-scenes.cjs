const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {createWorkspaceStorage}=require('../desktop/test-workspaces.cjs');
(async()=>{
 const root=path.resolve(__dirname,'..'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-authored-scenes-')),storage=createWorkspaceStorage(path.join(dir,'data'));
 const {preparePrototypeProject,writePrototypeProject}=await import('../src/prototype-import.ts');
 const slugs=['plants-vs-zombies','stardew-valley','hollow-knight','disco-elysium','vampire-survivors'];let catalog={schema:2,activeId:'',mode:'project',projects:[]};const projects=[];
 for(const slug of slugs){const example=JSON.parse(await fs.readFile(path.join(root,'examples/prototypes',slug+'.json'),'utf8')),prepared=preparePrototypeProject(catalog,example,'QA '+example.name);writePrototypeProject(storage,prepared);catalog=prepared.catalog;projects.push({slug,id:prepared.project.id,name:prepared.project.name,example});}
 catalog.activeId=projects[0].id;storage.setItem('gamecreator.projects.v1',JSON.stringify(catalog));
 const before=new Map(projects.map(p=>[p.id,storage.getItem('gamecreator.workspace.v1:'+p.id+':prototype-design')]));
 const env={...process.env,GAMECREATOR_DATA_DIR:path.join(dir,'data'),GAMECREATOR_USER_DATA_DIR:path.join(dir,'profile'),GAMECREATOR_TEAM_DATA_DIR:path.join(dir,'team')};delete env.ELECTRON_RUN_AS_NODE;
 let app,page;const errors=[],btn=name=>page.getByRole('button',{name,exact:true}),dialog=()=>page.getByRole('dialog',{name:'原型预览'}),act=async(name,condition=false)=>{await dialog().getByRole('button',{name:'交互：'+name,exact:true}).click();if(condition)await btn('本次满足，继续').click();};
 async function launch(){app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept().catch(()=>{}));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1920,1150));await btn('进入本地工作区').click();await btn('原型设计').click();}
 async function choose(p){await page.locator('.ps-trigger').click();await page.getByRole('menuitemradio').filter({hasText:p.name}).click();await btn('原型设计').click();assert.equal(await page.locator('.pd-scene-list button').count(),p.example.prototypeDesign.scenes.length);}
 async function shot(slug,suffix){await fs.mkdir(path.join(root,'.gamecreator/qa'),{recursive:true});await dialog().screenshot({path:path.join(root,'.gamecreator/qa/'+slug+'-prototype-'+suffix+'.png')});}
 try{
  await launch();
  for(const p of projects){await choose(p);await btn('从头预览').click();await shot(p.slug,'menu');
   if(p.slug==='plants-vs-zombies'){
    await act('开始挑战');await shot(p.slug,'selection');await act('携带三张卡出发');await shot(p.slug,'field');const rotations=await dialog().locator('[data-source-object] text').evaluateAll(nodes=>nodes.map(n=>{const m=n.getScreenCTM();return Math.abs(m.b)+Math.abs(m.c);}));assert.ok(rotations.every(n=>n<0.00001),'source labels stay upright despite facing rotation');await act('种向日葵');await act('推进到后续波次');await dialog().getByRole('button',{name:'交互：演示守关成功',exact:true}).click();await btn('不满足，留在此处').click();await dialog().locator('.pd-preview-header strong').filter({hasText:'三波压力'}).waitFor();await act('演示守关成功',true);await act('进入最终首领示意');await act('演示击败首领');await act('去花园');await act('浇水照料');await act('演示成熟并收获');await act('返回主界面');await act('无尽守卫');await act('本轮守住了，整备');await act('迎接下一轮');await act('演示本轮结束');await act('返回主界面');
   } else if(p.slug==='stardew-valley'){
    await act('开始农场生活');await shot(p.slug,'field');await act('前往村庄');await act('杂货铺');await act('演示购入萝卜种子',true);await act('回农场播种');await act('演示种下萝卜并浇水');await act('结束当天');await act('迎接新的一天');await act('自由活动');await act('河边钓鱼');await act('演示钓到鱼');await act('回农场');await act('出货与休息');await act('放入三颗萝卜并休息',true);await act('查看七日回顾');await act('返回主界面');
   } else if(p.slug==='hollow-knight'){
    await act('进入裂隙');await shot(p.slug,'field');await act('前往静默试炼');await act('演示通过试炼');await act('前往裂隙门槛');await act('冲刺到远岸',true);await act('前往遗壳守卫');await act('演示二阶段');await act('演示击败首领');await act('从石碑离开');await act('返回主界面');await act('进入裂隙');await act('前往静默试炼');await act('演示死亡');await act('演示抵达残影');await act('演示回收成功');await act('回到地图');await shot(p.slug,'map');await act('返回主界面');
   } else if(p.slug==='disco-elysium'){
    await act('开始新调查');await act('与林恩接案');await act('选择调查地点');await shot(p.slug,'map');await act('卸货后院');await shot(p.slug,'field');await act('耐力检定：检查断绳');await act('演示检定失败');await act('整理衣物后再试',true);await act('演示检定成功');await act('记录并找证人');await act('安抚埃达');await shot(p.slug,'dialogue');await act('温和追问，演示成功');await act('整理线索');await act('向林恩汇报');await act('查明事故真相',true);await act('返回主界面');
   } else {
    await act('开始生存');await shot(p.slug,'selection');await act('使用流浪猎手');await act('进入荒原');assert.equal(await dialog().locator('[data-range=ring]').count(),1);await shot(p.slug,'field');await act('拾取经验并升级');await shot(p.slug,'level');await act('选择空心之心');await act('带着构筑继续生存');await act('演示精英宝箱');await act('演示合格配方进化',true);await act('带进化武器迎接怪潮');await act('演示生存达标');await act('查看结算明细');await act('前往永久强化');await act('演示购买力量一档',true);await act('回主界面');
   }
   await btn('退出预览').click();assert.equal(storage.getItem('gamecreator.workspace.v1:'+p.id+':prototype-design'),before.get(p.id));
   // Render every authored scene, including secondary endings, and ensure each has visible interaction targets.
   for(let i=0;i<p.example.prototypeDesign.scenes.length;i++){await page.locator('.pd-scene-list button').nth(i).click();await btn('预览此场景').click();const expected=p.example.prototypeDesign.scenes[i];assert.equal(await dialog().locator('.pd-preview-header strong').innerText(),expected.name);assert.ok(await dialog().locator('[data-element]').count()>0);await btn('退出预览').click();}
  }
  await app.close();app=null;await launch();for(const p of projects)assert.equal(storage.getItem('gamecreator.workspace.v1:'+p.id+':prototype-design'),before.get(p.id));assert.deepEqual(errors,[]);
  console.log('PASS: all five populated templates; primary loops, failure/retry, conditions and endings; every authored scene renders; preview leaves archives unchanged; restart.');
 }catch(e){console.error(e);if(page&&!page.isClosed()){console.error((await page.locator('body').innerText()).slice(-4200));await fs.mkdir(path.join(root,'.gamecreator/qa'),{recursive:true});await page.screenshot({path:path.join(root,'.gamecreator/qa/prototype-scenes-failure.png')});}throw e;}finally{if(app)await app.close();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
