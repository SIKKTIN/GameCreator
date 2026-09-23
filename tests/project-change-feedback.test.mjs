import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {preparePrototypeProject,writePrototypeProject} from '../src/prototype-import.ts';
import {defaultWorkTeam,defaultAiTeam} from '../shared/ai-personnel.mjs';
import {validateFeedback,feedbackBatchItems} from '../shared/engine-feedback.mjs';
import {projectContentModules,assertContentChange,applyProjectRows,projectChangeRows} from '../shared/project-changes.mjs';
import {captureProjectPackage} from '../src/project-package.ts';
const require=createRequire(import.meta.url),{createEngineSync}=require('../desktop/engine-sync.cjs'),{createStorage}=require('../desktop/storage.cjs'),{createDeveloperService}=require('../desktop/ai-developers.cjs'),{signFeedback}=require('../shared/ai-feedback-client.cjs'),{archiveKey}=require('../desktop/project-package.cjs');
async function fixture(t,options={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-project-change-'));t.after(()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));return fs.rm(dir,{recursive:true,force:true});});const engine=path.join(dir,'engine');await fs.mkdir(engine);await fs.writeFile(path.join(engine,'project.godot'),'config_version=5');
 const storage=createStorage(path.join(dir,'data')),example=JSON.parse(await fs.readFile(new URL('../examples/prototypes/plants-vs-zombies.json',import.meta.url),'utf8')),prepared=preparePrototypeProject({schema:2,projects:[],activeId:'',mode:'project'},example,'项目修改测试');writePrototypeProject(storage,prepared);const {project}=prepared,projectId=project.id,config={...project.config,engine:'godot-gdscript',projectPath:engine,enumPath:'.',dataPath:'data/generated',outputFormat:'json'};project.config=config;storage.setItem('gamecreator.projects.v1',JSON.stringify(prepared.catalog));
 const key=module=>archiveKey(projectId,module),read=module=>JSON.parse(storage.getItem(key(module))),write=(module,value)=>storage.setItem(key(module),JSON.stringify(value));const schedule=read('project-schedule');schedule.personnel=defaultWorkTeam();write('project-schedule',schedule);const task=schedule.tasks.find(t=>t.kind==='程序');
 const vault=new Map(),service=createDeveloperService({storage,vault:{put:s=>vault.set(s.credentialId,s),get:(_p,id)=>vault.get(id),remove:(_p,id)=>vault.delete(id)}}),input=()=>({projectId,schedule:read('project-schedule'),name:'制作人',duties:'统筹项目',active:true,permissions:['progress','review','propose','spec_change','project_write'],profile:{positionIds:['producer'],scope:'project',taskIds:[],expiresAt:''}});
 const created=await service.change('create',input()),secret=service.read({projectId,credentialId:created.credential.id}),api=createEngineSync({storage,artFiles:{},...options});
 const fresh=()=>({projectId,config,settings:{documents:true,assets:false,collaboration:true,includePlaceholders:false,docsDirectory:'docs/gamecreator',assetsDirectory:'assets/gamecreator',modules:['schedule']},document:{projectName:project.name,version:'v1',sections:[{id:'schedule',label:'排期',body:'任务'}]},art:{assets:[],requirements:[]},collaboration:{schedule:read('project-schedule'),tools:read('development-tools')}});
 let snapshotId;async function sync(){const plan=await api.preview(fresh());if(plan.rows.some(r=>r.status!=='unchanged'))await api.apply({token:plan.token});snapshotId=JSON.parse(await fs.readFile(path.join(engine,'gamecreator/project.json'),'utf8')).snapshotId;}
 await sync();
 const draft=(intent,changes,target={kind:'task',id:task.id})=>({schema:1,projectId,engine:config.engine,id:randomUUID(),snapshotId,target,author:'开发者',summary:'修改建议',evidence:['原型验证结果'],reason:'原定义需要澄清',impact:'影响后续实现和测试用例',intent,changes});
 const put=async value=>{await fs.writeFile(path.join(engine,'gamecreator/feedback',value.id+'.json'),JSON.stringify(value));return value;};
 const post=(intent,changes,target)=>put(signFeedback(draft(intent,changes,target),secret)),scan=()=>api.feedbackScan(fresh()),entry=async id=>(await scan()).entries.find(e=>e.feedback?.id===id),apply=(e,extra={})=>api.feedbackApply({token:e.token,...extra});
 return{dir,engine,storage,projectId,project,config,key,read,write,task,api,service,input,created,secret,fresh,sync,draft,put,post,scan,entry,apply};
}
test('spec_change requires its own grant and explicit acceptance; changes only specification fields with traceable receipts',async t=>{
 const f=await fixture(t),before=f.read('project-schedule'),v=await f.post('spec_change',{description:'清晰的任务说明',acceptance:'新的可验证验收标准'}),e=await f.entry(v.id);assert.equal(e.state,'pending');assert.deepEqual(f.read('project-schedule'),before);assert.equal(feedbackBatchItems([e],true).ready.length,0);
 await assert.rejects(f.apply(e),/评估/);await f.apply(e,{acceptProjectChange:true});const after=f.read('project-schedule'),task=after.tasks.find(t=>t.id===f.task.id);assert.equal(task.description,'清晰的任务说明');assert.equal(task.acceptance,'新的可验证验收标准');assert.equal(task.status,f.task.status);assert.equal(task.result,f.task.result);assert.deepEqual(after.personnel,before.personnel);assert.equal(after.feedbackHistory[0].reason,v.reason);assert.equal(after.feedbackHistory[0].identity.intent,'spec_change');assert.equal((await f.entry(v.id)).state,'processed');
 for(const intent of ['progress','review','propose'])assert.throws(()=>validateFeedback(f.draft(intent,{description:'越界'})),/不支持/);assert.throws(()=>validateFeedback(f.draft('spec_change',{status:'已完成'})),/不支持/);
 await f.service.change('update',{...f.input(),memberId:f.created.memberId,permissions:['progress']});const denied=await f.post('spec_change',{description:'无权限'});assert.equal((await f.scan()).entries.find(e=>e.path.endsWith(denied.id+'.json')).state,'invalid');
});
test('spec_change compares baseline/current/proposed fields and rejection preserves formal requirements',async t=>{
 const f=await fixture(t),s=f.read('project-schedule');s.tasks.find(t=>t.id===f.task.id).acceptance='管理者新标准';f.write('project-schedule',s);const v=await f.post('spec_change',{acceptance:'开发者建议'}),e=await f.entry(v.id);assert.equal(e.rows[0].state,'conflict');await assert.rejects(f.apply(e,{acceptProjectChange:true}),/冲突/);await f.apply(e,{dismiss:true});assert.equal(f.read('project-schedule').tasks.find(t=>t.id===f.task.id).acceptance,'管理者新标准');assert.equal(f.read('project-schedule').feedbackHistory[0].outcome,'dismissed');
});
test('project_write edits project, gameplay, schedule, development configuration, story and material documents',async t=>{
 const f=await fixture(t),g=f.read('gameplay').designs[0],art=f.read('art-assets').requirements[0],stories=f.read('stories'),data=f.read('enum-versions').data,table=Object.keys(data.datasets)[0],row=data.datasets[table][0],column=Object.keys(row).find(k=>k!=='id');
 const edits=[['project','/description','新项目说明'],['gameplay','/designs/@'+g.id+'/summary','玩法修订'],['project-schedule','/tasks/@'+f.task.id+'/start','2026-01-01'],['art-assets','/requirements/@'+art.id+'/specification','引擎内制作资源'],['enum-versions','/data/datasets/'+table+'/@'+row.id+'/'+column,Number.isFinite(Number(row[column]))?String(Number(row[column])+1):row[column]+'（修改）']];
 if(stories.length)edits.push(['stories','/@'+stories[0].id+'/summary','故事说明更新']);
 // Use actual editable fields from the gameplay schema.
 if(!Object.hasOwn(g,'summary'))edits[1][1]='/designs/@'+g.id+'/title';
 for(const [module,field,value] of edits){const v=await f.post('project_change',{[field]:JSON.stringify(value)},{kind:'module',id:module}),e=await f.entry(v.id);assert.ok(e,'missing '+module);assert.equal(e.state,'pending',e.error);assert.equal(feedbackBatchItems([e],true).ready.length,0);await assert.rejects(f.apply(e),/核对/);await f.apply(e,{acceptProjectChange:true});assert.equal((await f.entry(v.id)).state,'processed');}
 assert.equal(f.read('project').description,'新项目说明');assert.equal(f.read('art-assets').requirements[0].specification,'引擎内制作资源');assert.equal(f.read('project-schedule').personnel.members[0].id,f.created.memberId);assert.equal(f.read('project-schedule').feedbackHistory.length,edits.length);
 for(const module of Object.keys(projectContentModules))assert.ok(await fs.stat(path.join(f.engine,'gamecreator/context/content',module+'.json')));
 const portable=captureProjectPackage(f.storage,f.project).document;assert.equal(portable.archives['project-schedule'].feedbackHistory.length,edits.length);assert.ok(!JSON.stringify(portable).includes(f.secret.privateKey));
});
test('project writes cannot modify personnel, immutable history, file paths, task completion, or bypass guards through parent replacement',async t=>{
 const f=await fixture(t),s=f.read('project-schedule'),art=f.read('art-assets');const attempts=[['project-schedule','/personnel',s.personnel],['project-schedule','/tasks/@'+f.task.id+'/status','已完成'],['project-schedule','/tasks',s.tasks],['enum-versions','/dataReleases',{}],['art-assets','/assets/@'+art.assets[0].id+'/versions',[]],['project','/__proto__/polluted',true]];
 for(const [module,field,value] of attempts){const v=await f.post('project_change',{[field]:JSON.stringify(value)},{kind:'module',id:module});assert.equal((await f.scan()).entries.find(e=>e.path.endsWith(v.id+'.json')).state,'invalid',field);}
 const v=await f.put(f.draft('project_change',{'/description':JSON.stringify('未签名')},{kind:'module',id:'project'}));assert.equal((await f.scan()).entries.find(e=>e.path.endsWith(v.id+'.json')).state,'invalid');assert.equal({}.polluted,undefined);
});
test('project field conflicts are explicit, changing authorization after preview blocks the final write',async t=>{
 let mutate=async()=>{};const f=await fixture(t,{beforeFeedbackCommit:()=>mutate()}),p=f.read('project');p.description='本地新描述';f.write('project',p);const v=await f.post('project_change',{'/description':JSON.stringify('另一建议')},{kind:'module',id:'project'}),e=await f.entry(v.id);assert.equal(e.rows[0].state,'conflict');await assert.rejects(f.apply(e,{acceptProjectChange:true}),/冲突/);
 mutate=()=>f.service.change('update',{...f.input(),memberId:f.created.memberId,permissions:['spec_change']});await assert.rejects(f.apply(e,{acceptProjectChange:true,decisions:{'/description':'feedback'}}),/授权|变化|权限/);assert.equal(f.read('project').description,'本地新描述');assert.equal(f.read('project-schedule').feedbackHistory,undefined);
});
test('interrupted project writes recover content and receipt once; completed transactions never replay',async t=>{
 const f=await fixture(t),v=await f.post('project_change',{'/description':JSON.stringify('恢复后的描述')},{kind:'module',id:'project'}),e=await f.entry(v.id),set=f.storage.setItem;
 let once=true;f.storage.setItem=(key,value)=>{if(once&&key===f.key('project-schedule')){once=false;throw new Error('disk unavailable');}return set(key,value);};await assert.rejects(f.apply(e,{acceptProjectChange:true}),/尚未完成/);assert.equal(f.read('project').description,'恢复后的描述');assert.equal(f.read('project-schedule').feedbackHistory,undefined);assert.throws(()=>captureProjectPackage(f.storage,f.project),/未完成/);f.storage.setItem=set;
 const restarted=createEngineSync({storage:f.storage,artFiles:{}});assert.equal((await restarted.feedbackScan(f.fresh())).contentReload,true);assert.equal(f.read('project-schedule').feedbackHistory.length,1);assert.equal((await restarted.feedbackScan(f.fresh())).entries.find(e=>e.feedback?.id===v.id).state,'processed');assert.equal(f.read('project-schedule').feedbackHistory.length,1);await restarted.feedbackRepair(f.fresh());
});
test('producer defaults are explicit and other positions do not gain project writing',()=>{const team=defaultAiTeam();assert.ok(team.members.find(m=>m.roles.includes('制作管理')).permissions.includes('project_write'));assert.ok(team.members.filter(m=>!m.roles.includes('制作管理')).every(m=>!m.permissions.includes('project_write')));});

test('project changes preserve role-derived authority and derived acceptance, including enclosing object replacements',()=>{
 for(const field of ['kind','references','positionIds','assignment'])assert.throws(()=>assertContentChange('project-schedule',{},{},['/tasks/@task/'+field]),/单独管理|独立/);
 for(const [module,list,field,beforeValue,afterValue] of [
  ['art-assets','requirements','productionStatus','待制作','已通过'],
  ['art-assets','assets','productionStatus','制作中','已通过'],
  ['art-assets','assets','scheduleProgress',{taskIds:['first']},{taskIds:['done']}],
  ['development-tools','tools','scheduleAcceptance',{taskIds:['first']},{taskIds:['done']}],
  ['art-assets','requirements','delivery',{path:'',notes:''},{path:'fake.png',notes:'验收通过'}],
 ]){const before={[list]:[{id:'item',[field]:beforeValue}]},after={[list]:[{id:'item',[field]:afterValue}]};assert.throws(()=>assertContentChange(module,before,after,['/'+list+'/@item']),/进度或验收/);}
});

test('stable record paths survive ordering changes and array values such as tags remain editable',()=>{
 const base={designs:[{id:'a',title:'A',tags:[]},{id:'b',title:'B',tags:[]}]},current={designs:[base.designs[1],base.designs[0]]};const f={target:{id:'gameplay'},changes:{'/designs/@a/title':JSON.stringify('新的 A'),'/designs/@a/tags':JSON.stringify(['标签'])}};
 const next=applyProjectRows('gameplay',current,projectChangeRows(f,base,current));assert.equal(next.designs[0].title,'B');assert.equal(next.designs[1].title,'新的 A');assert.deepEqual(next.designs[1].tags,['标签']);
});

test('pending project recovery blocks older feedback tokens and never overwrites intervening local edits',async t=>{
 const f=await fixture(t),progress=await f.post('progress',{status:'进行中'}),oldEntry=await f.entry(progress.id),v=await f.post('project_change',{'/description':JSON.stringify('已确认修改')},{kind:'module',id:'project'}),e=await f.entry(v.id),set=f.storage.setItem;
 f.storage.setItem=(key,value)=>{if(key===f.key('project-schedule'))throw new Error('disk unavailable');return set(key,value);};await assert.rejects(f.apply(e,{acceptProjectChange:true}),/尚未完成/);f.storage.setItem=set;
 await assert.rejects(f.apply(oldEntry),/未完成/);const current=f.read('project');current.description='保存中断后的其他编辑';f.write('project',current);await assert.rejects(f.scan(),/恢复备份/);assert.equal(f.read('project').description,current.description);assert.equal(f.read('project-schedule').feedbackHistory,undefined);
});

test('bulk progress processing skips project edits and leaves them ready for a fresh individual review',async t=>{
 const f=await fixture(t),v=await f.post('project_change',{'/description':JSON.stringify('单独核对')},{kind:'module',id:'project'}),progress=await f.post('progress',{status:'进行中'}),scan=await f.scan();const selection=feedbackBatchItems(scan.entries,true);assert.equal(selection.ready.length,1);assert.equal(selection.skipped.length,1);
 const result=await f.api.feedbackApplyBatch({tokens:scan.entries.map(e=>e.token),acceptCompletion:true});assert.equal(result.applied.length,1);assert.equal((await f.entry(progress.id)).state,'processed');assert.equal((await f.entry(v.id)).state,'pending');assert.notEqual(f.read('project').description,'单独核对');
});
