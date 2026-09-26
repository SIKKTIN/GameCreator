const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {fixture,initialOperations}=require('./authoring-fixture.cjs');
const {archiveKey}=require('../desktop/project-package.cjs');
async function setup(t){const f=await fixture();t.after(f.close);return f;}
const first=(f,p)=>{f.submit(p);const item=f.run('scan').items.find(i=>i.id===p.id);assert.ok(item,!item);return item;};
const apply=(f,item,decisions={})=>f.run('apply',{id:item.id,digest:item.digest,reviewId:item.reviewId,decisions});
test('engine-independent blank project can author all content modules together, preserve identity, and record exactly one receipt',async t=>{
 const f=await setup(t);assert.equal(f.project.config.projectPath,'');assert.match(fs.readFileSync(path.join(f.project.folderPath,'README.md'),'utf8'),/GAMECREATOR_GUIDE/);
 assert.match(fs.readFileSync(path.join(f.project.folderPath,'README.md'),'utf8'),/\(ai\/README.md\)/);
 const aiReadme=fs.readFileSync(path.join(f.project.folderPath,'ai/README.md'),'utf8');assert.match(aiReadme,/推荐阅读顺序/);assert.match(aiReadme,/node submit-change.cjs validate draft.json/);assert.match(aiReadme,/node ai\/submit-change.cjs validate ai\/draft.json/);assert.match(aiReadme,/receipts/);
 assert.ok(!JSON.stringify(f.read('ai/project.json')).includes(f.secret.privateKey));
 const p=f.draft(initialOperations()),item=first(f,p);assert.equal(item.error,undefined);assert.equal(item.rows.length,p.operations.length);assert.equal(item.unresolved,0);apply(f,item);
 const next=f.model.captureProjectPackage(f.storage,f.project).document.archives;assert.equal(next['project-schedule'].tasks.length,1);assert.equal(next['project-schedule'].tasks[0].status,'待开始');assert.equal(next['project-schedule'].personnel.members[0].id,f.memberId);assert.equal(next['functional-systems'].capabilities[0].systemId,'sys');assert.equal(next['art-assets'].requirements[0].status,'待制作');assert.equal(next['enum-versions'].data.datasets.units[0].id,'unit-1');assert.equal(next['project-schedule'].authoringHistory.length,1);
 assert.equal(f.run('scan').items.length,0);assert.equal(apply(f,item).applied,true);assert.equal(f.run('scan').history.length,1);
 const filename=path.join(f.project.folderPath,'ai/changes',p.id+'.json');const changed=JSON.parse(fs.readFileSync(filename));changed.summary='改过的相同编号';fs.writeFileSync(filename,JSON.stringify(changed));assert.match(f.run('scan').items[0].error,/重放/);
});
test('row edits, reclassification, explicit archive and delete retain IDs and enforce cross-module references',async t=>{
 const f=await setup(t);apply(f,first(f,f.draft(initialOperations())));f.run('export');
 const bad=first(f,f.draft([{id:'delete',module:'functional-systems',op:'remove',path:'/capabilities/@cap'}]));assert.match(bad.error,/失效引用/);
 const p=f.draft([{id:'row',module:'enum-versions',op:'set',path:'/data/datasets/units/@unit-1/name',value:'新角色'}, {id:'archive',module:'gameplay',op:'add',path:'/categories',value:[{id:'category',name:'核心玩法',description:'',icon:'book'}]}]);
 // A record can be deleted only when its links are changed in the same validated batch.
 const clean=f.draft([{id:'delete',module:'functional-systems',op:'remove',path:'/capabilities/@cap'},{id:'task-ref',module:'project-schedule',op:'set',path:'/tasks/@work/references',value:[]},{id:'tool-ref',module:'development-tools',op:'set',path:'/tools/@tool/capabilityIds',value:[]},p.operations[0],{id:'archive',module:'art-assets',op:'set',path:'/requirements/@art/archived',value:true}]);
 const item=first(f,clean);assert.equal(item.error,undefined);apply(f,item);assert.equal(f.model.captureProjectPackage(f.storage,f.project).document.archives['functional-systems'].capabilities.length,0);
});
test('grants, signature, disabled role, revocation, changed project and expired baseline block writes',async t=>{
 const f=await setup(t),p=f.draft([{id:'overview',module:'project',op:'set',path:'/description',value:'proposal'}]),item=first(f,p);
 const original=JSON.parse(f.storage.getItem(f.sk)),s=structuredClone(original);s.personnel.members[0].developer.projectModules=['gameplay'];f.storage.setItem(f.sk,JSON.stringify(s));assert.throws(()=>apply(f,item),/权限/);
 s.personnel.members[0].developer.projectModules=['project'];s.personnel.credentials[0].revokedAt=new Date().toISOString();f.storage.setItem(f.sk,JSON.stringify(s));assert.throws(()=>apply(f,item),/撤销/);
 f.storage.setItem(f.sk,JSON.stringify(original));const file=path.join(f.project.folderPath,'ai/changes',p.id+'.json'),modified=JSON.parse(fs.readFileSync(file));modified.operations[0].value='unsigned';fs.writeFileSync(file,JSON.stringify(modified));assert.match(f.run('scan').items[0].error,/签名/);
 f.submit(p);s.personnel.credentials[0].revokedAt='';s.personnel.positions.find(p=>p.id==='producer').active=false;f.storage.setItem(f.sk,JSON.stringify(s));assert.throws(()=>apply(f,item),/权限/);
 f.storage.setItem(f.sk,JSON.stringify(original));fs.writeFileSync(path.join(f.project.folderPath,'ai/context/snapshots',p.snapshotId+'.json'),'{}');assert.throws(()=>apply(f,item),/快照/);
});
test('protected workflow, history, authorization and shipped files cannot be injected by new or enclosing records',async t=>{
 const f=await setup(t),ops=initialOperations();
 const examples=[{...ops.find(o=>o.module==='project-schedule'&&o.path.includes('tasks')),value:{...f.model.authoringTemplates().productionTask,id:'work',status:'已完成'}},{id:'auth',module:'project-schedule',op:'set',path:'/personnel',value:{schema:1,positions:[],members:[],credentials:[]}},{id:'history',module:'project-schedule',op:'add',path:'/authoringHistory',value:[{id:'forged'}]},{id:'file',module:'art-assets',op:'add',path:'/assets/@a',value:{...f.model.authoringTemplates().asset,id:'a',versions:[{id:'fake',files:[]}]}},{id:'baseline',module:'enum-versions',op:'set',path:'/snapshots',value:[{}]}];
 for(const op of examples){const p=f.draft([op]),item=first(f,p);assert.match(item.error,/维护|发布/);assert.equal(f.model.captureProjectPackage(f.storage,f.project).document.archives['project-schedule'].tasks.length,0);}
});
test('three-way conflicts keep concurrent edits, recheck at apply, and permit explicit choices',async t=>{
 const f=await setup(t),p=f.draft([{id:'overview',module:'project',op:'set',path:'/description',value:'proposal'}]),item=first(f,p),key=archiveKey(f.project.id,'project'),current=f.model.captureProjectPackage(f.storage,f.project).document.archives.project;
 f.storage.setItem(key,JSON.stringify({...current,description:'local'}));assert.throws(()=>apply(f,item),/预览后/);const conflicted=f.run('scan').items[0];assert.equal(conflicted.rows[0].state,'conflict');apply(f,conflicted,{overview:'keep'});assert.equal(JSON.parse(f.storage.getItem(key)).description,'local');
 f.run('export');const next=first(f,f.draft([{id:'overview',module:'project',op:'set',path:'/description',value:'chosen'}]));f.storage.setItem(key,JSON.stringify({...current,description:'new-local'}));assert.throws(()=>apply(f,next,{overview:'proposal'}),/预览后/);apply(f,f.run('scan').items[0],{overview:'proposal'});assert.equal(JSON.parse(f.storage.getItem(key)).description,'chosen');
});
test('interrupted multi-module writes recover the whole confirmed transaction and receipt once',async t=>{
 const f=await setup(t),item=first(f,f.draft(initialOperations())),save=f.storage.setItem;let count=0;f.storage.setItem=(k,v)=>{if(k.endsWith(':gameplay')&&++count===1)throw new Error('disk failure');return save(k,v);};
 assert.throws(()=>apply(f,item),/尚未完成/);assert.throws(()=>f.run('scan'),/未完成/);f.storage.setItem=save;
 assert.equal(f.service.run('recover',{projectId:f.project.id}).recovered,true);const result=f.run('scan');assert.equal(result.history.length,1);assert.equal(result.items.length,0);assert.equal(f.service.run('recover',{projectId:f.project.id}).recovered,false);
});
test('helper submits a signed file, never replaces an existing ID, and documentation updates preserve user files',async t=>{
 const f=await setup(t),root=f.project.folderPath,p=f.draft([{id:'overview',module:'project',op:'set',path:'/description',value:'CLI authored'}]),draft=path.join(f.root,'change.json'),credential=path.join(f.root,'credential.json'),helper=path.join(root,'ai/submit-change.cjs');fs.writeFileSync(draft,JSON.stringify(p));fs.writeFileSync(credential,JSON.stringify(f.secret));
 execFileSync(process.execPath,[helper,'validate',draft]);execFileSync(process.execPath,[helper,'submit',draft,credential]);assert.throws(()=>execFileSync(process.execPath,[helper,'submit',draft,credential],{stdio:'pipe'}));assert.equal(f.run('scan').items[0].error,undefined);
 fs.writeFileSync(path.join(root,'README.md'),'# My instructions\nCustom notes.');fs.writeFileSync(path.join(root,'AGENTS.md'),'Keep my instructions.');f.run('export');assert.match(fs.readFileSync(path.join(root,'README.md'),'utf8'),/^# My instructions\nCustom notes./);assert.equal(fs.readFileSync(path.join(root,'AGENTS.md'),'utf8'),'Keep my instructions.');
 fs.writeFileSync(path.join(root,'ai/README.md'),'# Custom AI instructions\nKeep these project conventions.');f.run('export');assert.equal(fs.readFileSync(path.join(root,'ai/README.md'),'utf8'),'# Custom AI instructions\nKeep these project conventions.');assert.equal(fs.readFileSync(path.join(root,'README.md'),'utf8').split('(ai/README.md)').length,2);
 fs.writeFileSync(path.join(root,'GAMECREATOR_GUIDE.md'),'Custom guide');assert.throws(()=>f.run('export'),/自定义/);
});
test('strict IDs, overlapping operations and unknown modules fail before storage mutation',async t=>{
 const f=await setup(t),simple={id:'one',module:'project',op:'set',path:'/description',value:'ok'};
 for(const ops of [[simple,{...simple,id:'two'}],[{...simple,path:'/__proto__/bad'}],[{...simple,module:'personnel'}],[{...simple,module:'project-schedule',path:'/tasks/0/title'}]]){const item=first(f,f.draft(ops));assert.ok(item.error);}
});
test('nested links, material documents and config field changes are validated together; design cannot rebind accepted delivery',async t=>{
 const f=await setup(t);apply(f,first(f,f.draft(initialOperations())));f.run('export');
 const broken=[
  {id:'missing',module:'gameplay',op:'set',path:'/designs/@play/dependencies',value:[{id:'dep',kind:'depends',targetId:'missing',note:''}]},
  {id:'missing',module:'stories',op:'set',path:'/\u0040story',value:{...f.model.authoringTemplates().story,id:'story',references:[{kind:'narrative',targetId:'missing',label:'不存在'}]}},
  {id:'remove',module:'art-assets',op:'remove',path:'/requirements/@art'},
  {id:'column',module:'definitions',op:'set',path:'/@units/columns',value:[{key:'id',label:'ID'},{key:'changed',label:'改列'}]}
 ];
 for(const op of broken)assert.match(first(f,f.draft([op])).error,/引用|不一致/);
 const schedule=JSON.parse(f.storage.getItem(f.sk));schedule.tasks[0].status='已完成';f.storage.setItem(f.sk,JSON.stringify(schedule));f.run('export');
 assert.match(first(f,f.draft([{id:'rebind',module:'project-schedule',op:'set',path:'/tasks/@work/references',value:[]}])).error,/验收成果/);
 const categories=[{id:'main',name:'核心玩法',description:'按主题组织',icon:'book'}];const item=first(f,f.draft([{id:'categories',module:'gameplay',op:'add',path:'/categories',value:categories},{id:'classify',module:'gameplay',op:'add',path:'/designs/@play/categoryId',value:'main'}]));assert.equal(item.error,undefined);apply(f,item);
 assert.equal(f.model.captureProjectPackage(f.storage,f.project).document.archives.gameplay.designs[0].categoryId,'main');
});
test('folder junctions cannot redirect context exports or submission reads',async t=>{
 const f=await setup(t),outside=path.join(f.root,'outside');fs.mkdirSync(outside);
 const changes=path.join(f.project.folderPath,'ai/changes'),saved=path.join(f.project.folderPath,'ai/saved-changes');fs.renameSync(changes,saved);fs.symlinkSync(outside,changes,'junction');
 assert.throws(()=>f.run('scan'),/链接|无效文件/);assert.throws(()=>f.run('export'),/链接|无效文件/);assert.deepEqual(fs.readdirSync(outside),[]);
 fs.unlinkSync(changes);fs.renameSync(saved,changes);
});
test('project rename and content share recovery; configuration data edits advance the editor revision',async t=>{
 const f=await setup(t),item=first(f,f.draft([{id:'rename',module:'project',op:'set',path:'/name',value:'重新设计的项目'}])),save=f.storage.setItem;let fail=true;
 f.storage.setItem=(k,v)=>{if(k==='gamecreator.projects.v1'&&fail){fail=false;throw new Error('catalog interrupted');}return save(k,v);};assert.throws(()=>apply(f,item),/尚未完成/);f.storage.setItem=save;
 f.service.run('recover',{projectId:f.project.id});assert.equal(JSON.parse(f.storage.getItem('gamecreator.projects.v1')).projects[0].name,'重新设计的项目');assert.equal(f.read('project.gamecreator').project.name,'重新设计的项目');
 f.project.name='重新设计的项目';assert.equal(f.run('scan').history.length,1);f.run('export');const before=f.model.captureProjectPackage(f.storage,f.project).document.archives['enum-versions'].revision;apply(f,first(f,f.draft(initialOperations())));assert.equal(f.model.captureProjectPackage(f.storage,f.project).document.archives['enum-versions'].revision,before+1);
});
