const {_electron}=require(process.env.GAMECREATOR_PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),{createWorkspaceStorage}=require('../desktop/test-workspaces.cjs');
(async()=>{
 const {preparePrototypeProject,writePrototypeProject}=await import('../src/prototype-import.ts');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-global-search-')),storage=createWorkspaceStorage(path.join(dir,'data'));
 const example=JSON.parse(await fs.readFile(path.join(root,'examples/prototypes/hollow-knight.json'),'utf8'));
 let catalog={schema:2,activeId:'',mode:'project',projects:[]};const first=preparePrototypeProject(catalog,example,'搜索测试A');writePrototypeProject(storage,first);catalog=first.catalog;
 const disco=JSON.parse(await fs.readFile(path.join(root,'examples/prototypes/disco-elysium.json'),'utf8'));const second=preparePrototypeProject(catalog,disco,'搜索测试B');writePrototypeProject(storage,second);catalog=second.catalog;catalog.activeId=first.project.id;storage.setItem('gamecreator.projects.v1',JSON.stringify(catalog));
 const prefix='gamecreator.workspace.v1:'+first.project.id+':',artKey=prefix+'art-assets';const art=JSON.parse(storage.getItem(artKey));art.requirements[0].generationPrompt.prompt+='\n独有的搜索提示词';art.requirements[1].archived=true;storage.setItem(artKey,JSON.stringify(art));
 const ev=await import('../src/enum-versions.ts'),versionKey='gamecreator.enum-versions.v1:'+first.project.id;
 const scan={projectPath:'',enumPath:'Script/Const',files:['Script/Const/Const_Search.lua'],groups:[{name:'Const_Search.State',source:'Script/Const/Const_Search.lua',line:1,valueType:'number',comment:'搜索验收枚举',members:[{key:'SEARCH_RUNNING',value:1,line:2,comment:'正在运行'}]}],orderTables:[],dynamic:[],counts:{files:1,groups:1,members:1}};
 let enums=ev.stageSnapshot(JSON.parse(storage.getItem(versionKey)),await ev.makeSnapshot(scan,'source'));enums=ev.decideChanges(enums,ev.diffEnums(null,scan).map(c=>c.id),true,'test');enums=await ev.syncApprovedChanges(enums);storage.setItem(versionKey,JSON.stringify(enums));
 let app,page;const errors=[],env={...process.env,GAMECREATOR_DATA_DIR:path.join(dir,'data'),GAMECREATOR_USER_DATA_DIR:path.join(dir,'profile')};delete env.ELECTRON_RUN_AS_NODE;
 const button=name=>page.getByRole('button',{name,exact:true}),field=name=>page.getByLabel(name,{exact:true}).filter({visible:true});
 const panel=()=>page.getByRole('region',{name:'全局搜索工作区'});
 async function search(q,module='') {await page.keyboard.press('Control+k');await field('搜索当前项目').fill(q);await page.waitForTimeout(240);if(module)await panel().locator('.gsearch-filters button').filter({hasText:module}).click();else await panel().locator('.gsearch-filters button').first().click();}
 async function open(q,title,module){await search(q,module);await button('打开搜索结果：'+title).click();}
 try{
 app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env});page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1560,1000));await button('进入本地工作区').click();
 await field('全局搜索入口').fill('冲刺');await field('全局搜索入口').press('Enter');await panel().waitFor();await panel().locator('.gsearch-result').first().waitFor();assert.ok(await panel().locator('mark').count()>0);
 await panel().locator('.gsearch-filters button').filter({hasText:'玩法设计'}).click();assert.ok(await panel().locator('.gsearch-result').count()>0);assert.ok((await panel().locator('.gsearch-result-meta').allTextContents()).every(t=>t.includes('玩法设计')));
 const design=example.gameplay.designs[1];await open(design.id,design.title,'玩法设计');await field('玩法名称').waitFor();assert.equal(await field('玩法名称').inputValue(),design.title);await page.getByRole('button',{name:/返回搜索结果/}).click();assert.equal(await field('搜索当前项目').inputValue(),design.id);
 const state=design.stateFlow.states[3];await open(state.id,state.name,'玩法设计');assert.equal(await field('状态名称').inputValue(),state.name);
 const cap=example.functionalSystems.capabilities[0];await open(cap.id,cap.name,'功能系统');assert.equal(await field('功能名称').inputValue(),cap.name);
 const req=art.requirements[0];await open('独有的搜索提示词',req.name,'素材资产');assert.ok((await field('生成提示词').inputValue()).includes('独有的搜索提示词'));
 await search(art.requirements[1].id);assert.equal(await panel().locator('.gsearch-result').count(),0);await field('包含已归档内容').check();await button('打开搜索结果：'+art.requirements[1].name).click();assert.equal(await field('生成提示词').isDisabled(),true);
 const graph=example.gameplayCore.graphs.find(g=>g.id!==example.gameplayCore.rootId),node=graph.nodes[1];await open(node.id,node.title,'玩法核心');await button('选择节点：'+node.title).waitFor();assert.equal(await button('选择节点：'+node.title).getAttribute('aria-pressed'),'true');
 const scene=example.prototypeDesign.scenes.find(s=>s.elements.length>0),element=scene.elements[0];await open(element.id,element.name,'原型设计');assert.equal(await field('元素名称').inputValue(),element.name);
 const map=example.mapDesign.maps.find(m=>m.objects.length),object=map.objects[0];await open(object.id,object.name,'地图设计');assert.equal(await field('地图对象名称').inputValue(),object.name);
 await open('SEARCH_RUNNING','SEARCH_RUNNING','枚举定义');assert.equal(await page.locator('.gsearch-enum-focus code').innerText(),'SEARCH_RUNNING');
 const tableKey=Object.keys(example.data.datasets).find(k=>example.data.datasets[k].length),record=example.data.datasets[tableKey][0];await open(record.id,record.name||record.title||record.id,'数据配置');await page.locator('.data-inspector').waitFor();assert.ok((await page.locator('.data-inspector input').evaluateAll(nodes=>nodes.map(n=>n.value))).includes(record.id));
 const task=example.projectSchedule.tasks[0];await open(task.id,task.title,'项目排期');assert.equal(await page.getByRole('tab',{name:'任务列表',exact:true}).getAttribute('aria-selected'),'true');assert.ok((await page.locator('main').innerText()).includes(task.title));
 await page.getByRole('dialog',{name:'制作任务详情',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
 const analysis=example.numericalAnalysis.plans[0];await open(analysis.id,analysis.name,'数值分析');assert.equal(await field('分析名称').inputValue(),analysis.name);
 await search('独有的搜索提示词');await button('预览搜索结果：'+req.name).click();await page.getByRole('complementary',{name:'搜索结果预览'}).waitFor();await fs.mkdir(path.join(root,'.gamecreator/qa'),{recursive:true});await page.screenshot({path:path.join(root,'.gamecreator/qa/global-search.jpg'),type:'jpeg',quality:50,scale:'css'});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1080,850));assert.ok(await panel().evaluate(n=>n.scrollWidth<=n.clientWidth+2));
 await page.locator('.ps-trigger').click();await page.getByRole('menuitemradio',{name:/^搜索测试B/}).click();await button('全局搜索').click();assert.equal(await field('搜索当前项目').inputValue(),'');await search('独有的搜索提示词');assert.equal(await panel().locator('.gsearch-result').count(),0);
 const narrative=disco.storyOrchestration.stories[0],fragment=narrative.nodes[8];await open(fragment.id,fragment.title,'故事编排');assert.ok(await page.getByRole('button',{name:'选择故事片段：'+fragment.title,exact:true}).evaluate(n=>n.classList.contains('selected')));
 assert.deepEqual(errors,[]);console.log('PASS desktop global search: header/Ctrl K, highlights/filter, document/function/prompt/archived/node/state/element/map/enum/record/schedule/story navigation, return, preview, narrow layout and project isolation.');
 }catch(e){if(page&&!page.isClosed()){console.error((await page.locator('body').innerText()).slice(-4200));console.error('PAGE ERRORS',errors);}throw e;}finally{if(app)await app.close();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('gc-global-search-'));await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});

