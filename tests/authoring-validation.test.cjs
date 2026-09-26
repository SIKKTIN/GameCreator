const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {fixture,initialOperations}=require('./authoring-fixture.cjs');
const model=require('../desktop/project-content-model.cjs');
async function setup(t){const f=await fixture();t.after(f.close);return f;}
function cli(f,p,command='validate',credential){const file=path.join(f.root,'draft.json');fs.writeFileSync(file,JSON.stringify(p));const run=spawnSync(process.execPath,[path.join(f.project.folderPath,'ai/submit-change.cjs'),command,file,...(credential?[credential]:[]),'--json'],{encoding:'utf8'});assert.equal(run.error,undefined);return {status:run.status,...JSON.parse(run.stdout)};}
function invalidGameplay(t){return {...t.gameplay,id:'play',loop:['步骤'],prototype:['范围'],checks:['验收'],stateFlow:{initialStateId:'end',states:[{...t.gameplayState,id:'end',kind:'terminal'}],transitions:[]}};}
test('exported CLI and desktop report every Falcon nested-field error without touching archives or signing',async t=>{
 const f=await setup(t),g=invalidGameplay(f.read('ai/context/templates.json')),p=f.draft([{id:'gameplay-main-loop',module:'gameplay',op:'add',path:'/designs/@play',value:g}]);
 const before=f.model.canonical(f.model.captureProjectPackage(f.storage,f.project));
 const result=cli(f,p);assert.equal(result.status,1);assert.equal(result.scope,'candidate');assert.equal(result.diagnostics.length,4);
 assert.deepEqual(result.diagnostics.map(d=>d.path),['/designs/@play/loop/0','/designs/@play/prototype/0','/designs/@play/checks/0','/designs/@play/stateFlow/states/@end/kind']);
 assert.ok(result.diagnostics.every(d=>d.module==='gameplay'&&d.operationId==='gameplay-main-loop'));
 assert.equal(result.diagnostics.at(-1).code,'FIELD_ENUM');assert.equal(result.diagnostics.at(-1).expected,'normal | outcome');
 assert.equal(cli(f,p,'submit',path.join(f.root,'nonexistent-secret.json')).scope,'candidate');
 assert.equal(fs.existsSync(path.join(f.project.folderPath,'ai/changes',p.id+'.json')),false);
 f.submit(p);const item=f.run('scan').items[0];assert.deepEqual(item.diagnostics,result.diagnostics);assert.equal(item.errorScope,'candidate');
 assert.match(item.error,/未写入正式项目/);assert.equal(f.model.canonical(f.model.captureProjectPackage(f.storage,f.project)),before);assert.equal(fs.existsSync(path.join(f.project.folderPath,'ai/receipts',p.id+'.json')),false);
});
test('exported nested templates build a nonempty gameplay and core graph, then sign/apply/receipt',async t=>{
 const f=await setup(t),v=f.read('ai/context/templates.json'),opts=f.read('ai/context/template-options.json');
 assert.deepEqual(opts.enums['gameplay.stateFlow.states.kind'],['normal','outcome']);assert.equal(v.gameplayPrototypeItem.done,false);assert.equal(v.gameplayCheck.result,'未测试');
 const g={...v.gameplay,id:'play',loop:[v.gameplayLoopStep],prototype:[v.gameplayPrototypeItem],checks:[v.gameplayCheck],conditionRules:[{...v.gameplayRule,conditions:[v.gameplayRuleCondition],actions:[v.gameplayRuleAction]}],stateFlow:{initialStateId:v.gameplayState.id,states:[v.gameplayState],transitions:[{...v.gameplayTransition,fromId:v.gameplayState.id,toId:v.gameplayState.id}]},space:{...v.gameplay.space,objects:[v.gameplayStageObject]},timeline:{...v.gameplay.timeline,tracks:[v.gameplayTimelineTrack],events:[{...v.gameplayTimelineEvent,trackId:v.gameplayTimelineTrack.id,objectId:v.gameplayStageObject.id}]}};
 const ops=initialOperations().map(o=>o.module==='gameplay'?{...o,value:g}:o);
 ops.push({id:'exit',module:'gameplay-core',op:'add',path:'/graphs/@root/nodes/@exit',value:{...v.coreNode,id:'exit',kind:'exit'}});
 ops.push({id:'edge',module:'gameplay-core',op:'add',path:'/graphs/@root/edges/@edge',value:{...v.coreEdge,id:'edge',fromId:'loop',toId:'exit'}});
 const p=f.draft(ops),result=cli(f,p);assert.equal(result.status,0,JSON.stringify(result));assert.equal(result.scope,'exported-baseline');
 const secret=path.join(f.root,'private.json');fs.writeFileSync(secret,JSON.stringify(f.secret));assert.equal(cli(f,p,'submit',secret).status,0);
 const item=f.run('scan').items[0];assert.equal(item.error,undefined);f.run('apply',{id:item.id,digest:item.digest,reviewId:item.reviewId,decisions:{}});assert.equal(f.read('ai/receipts/'+p.id+'.json').id,p.id);
 assert.equal(JSON.parse(f.storage.getItem(f.sk)).tasks[0].status,'待开始');
});
test('CLI rejects protected fields, bad paths, references, cycles, columns and non-gameplay formats',async t=>{
 const f=await setup(t),templates=model.authoringTemplates();
 const cases=[
  [{id:'path',module:'project',op:'set',path:'/missing/description',value:'x'}],
  [{id:'protected',module:'project-schedule',op:'add',path:'/tasks/@task',value:{...templates.productionTask,id:'task',status:'已完成'}}],
  [{id:'ref',module:'development-tools',op:'add',path:'/tools/@tool',value:{...templates.tool,id:'tool',capabilityIds:['missing']}}],
  [{id:'cycle-a',module:'project-schedule',op:'add',path:'/tasks/@a',value:{...templates.productionTask,id:'a',dependencyIds:['b']}},{id:'cycle-b',module:'project-schedule',op:'add',path:'/tasks/@b',value:{...templates.productionTask,id:'b',dependencyIds:['a']}}],
  [{id:'tool',module:'development-tools',op:'add',path:'/tools/@tool',value:{...templates.tool,id:'tool',kind:'nonsense'}}],
  initialOperations().map(o=>o.module==='enum-versions'&&o.path.includes('columns')?{...o,value:[{key:'id',label:'ID'}]}:o)
 ];
 for(const ops of cases){const p=f.draft(ops),r=cli(f,p);assert.equal(r.status,1);f.submit(p);const item=f.run('scan').items.find(i=>i.id===p.id);assert.ok(item.error);assert.deepEqual(item.diagnostics,r.diagnostics);}
 assert.equal(cli(f,f.draft(cases[0])).diagnostics[0].operationId,'path');
});
test('validator presence, hash, model version and baseline identity are checked',async t=>{
 const f=await setup(t),p=f.draft([{id:'overview',module:'project',op:'set',path:'/description',value:'test'}]),metadata=path.join(f.project.folderPath,'ai/project.json'),bundle=path.join(f.project.folderPath,'ai/validator.cjs'),original=f.read('ai/project.json');
 fs.appendFileSync(bundle,'\n// mismatch');assert.match(cli(f,p).message,/校验包.*不匹配/);f.run('export');
 fs.writeFileSync(metadata,JSON.stringify({...original,validator:{...original.validator,version:'wrong'}}));assert.match(cli(f,p).message,/版本不匹配/);
 fs.writeFileSync(metadata,JSON.stringify({...original,validator:undefined}));assert.match(cli(f,p).message,/缺少完整校验包/);f.run('export');
 const snapshot=path.join(f.project.folderPath,'ai/context/snapshots',p.snapshotId+'.json');fs.appendFileSync(snapshot,' ');assert.match(cli(f,p).message,/快照损坏/);
});
test('source diagnostics preserve schema upgrades and identify baseline versus proposed corruption',()=>{
 const base=model.emptyContentDocument().archives,g={...model.authoringTemplates().gameplay,id:'play'};
 for(const schema of [1,2,3]){const legacy=structuredClone(g);if(schema===1){delete legacy.stateFlow;delete legacy.dependencies;delete legacy.conditionRules;}if(schema<3){delete legacy.space;delete legacy.timeline;}
  assert.doesNotThrow(()=>model.validateContentArchive('gameplay',{schema,designs:[legacy]}));
 }
 const broken=structuredClone(base);broken.gameplay.designs=[invalidGameplay(model.authoringTemplates())];
 const p={format:'gamecreator-content-change',schema:1,id:'baseline-test',projectId:'p',snapshotId:'a'.repeat(64),intent:'project_change',target:{kind:'module',id:'project'},summary:'x',compatibility:{reuse:'x',modify:'x',add:'x',archive:'x'},operations:[{id:'overview',module:'project',op:'set',path:'/description',value:'new'}]};
 assert.throws(()=>model.validateContentChange(p,broken),e=>e.scope==='baseline'&&e.diagnostics[0].module==='gameplay');
 assert.throws(()=>model.validateContentChange(p,base,broken),e=>e.scope==='current'&&e.diagnostics[0].module==='gameplay');
});
