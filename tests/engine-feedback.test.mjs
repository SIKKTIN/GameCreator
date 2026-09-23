import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {validateFeedback,feedbackDiff,mergeFeedback,validateFeedbackHistory,feedbackBatchItems} from '../shared/engine-feedback.mjs';
import {createProductionTask,createProductionMilestone,validateProjectSchedule} from '../src/project-schedule.ts';
import {createDevelopmentTool,validateDevelopmentTools} from '../shared/development-tools.mjs';
import {defaultAiTeam,defaultWorkTeam,normalizePersonnelSchedule} from '../shared/ai-personnel.mjs';
const require=createRequire(import.meta.url),{createEngineSync}=require('../desktop/engine-sync.cjs'),{createStorage}=require('../desktop/storage.cjs');
const rawRead=(s,key)=>JSON.parse(s.getItem(key));
async function fixture(t,options={}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-feedback-'));
  t.after(()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));return fs.rm(dir,{recursive:true,force:true});});
  const engine=path.join(dir,'engine');await fs.mkdir(engine);await fs.writeFile(path.join(engine,'project.godot'),'config_version=5');
  const storage=createStorage(path.join(dir,'data')),projectId='feedback-test',config={engine:'godot-gdscript',projectPath:engine};
  storage.setItem('gamecreator.projects.v1',JSON.stringify({activeId:projectId,projects:[{id:projectId,config}]}));
  const schedule={schema:1,tasks:[{...createProductionTask('骨骼动画预览'),id:'task-a',acceptance:'逐帧查看动画事件'}],milestones:[{...createProductionMilestone('工具验收'),id:'m1'}]},tools={schema:1,tools:[{...createDevelopmentTool('动画预览工具'),id:'tool-a'}]};
  const sk='gamecreator.workspace.v1:'+projectId+':project-schedule',tk='gamecreator.workspace.v1:'+projectId+':development-tools';
  storage.setItem(sk,JSON.stringify(schedule));storage.setItem(tk,JSON.stringify(tools));
  const input={projectId,config,settings:{documents:true,assets:false,collaboration:true,includePlaceholders:false,docsDirectory:'docs/gamecreator',assetsDirectory:'assets/gamecreator',modules:['schedule']},document:{projectName:'测试原型',version:'v1',sections:[{id:'schedule',label:'排期',body:'任务需求'}]},art:{assets:[],requirements:[]},collaboration:{schedule,tools}};
  const api=createEngineSync({storage,artFiles:{},...options}),fresh=()=>({...input,collaboration:{schedule:rawRead(storage,sk),tools:rawRead(storage,tk)}});
  async function sync(){const plan=await api.preview(fresh());if(plan.rows.some(r=>r.status!=='unchanged'))await api.apply({token:plan.token});return plan;}
  await sync();
  const project=JSON.parse(await fs.readFile(path.join(engine,'gamecreator/project.json'),'utf8'));
  const make=(changes={status:'待验收',result:'已实现，逐帧测试通过'},kind='task')=>({schema:1,projectId,engine:config.engine,id:randomUUID(),snapshotId:project.snapshotId,target:{kind,id:kind==='task'?'task-a':'tool-a'},author:'测试开发者',summary:'动画工具进展',evidence:['工具入口：debug/animation','验证：逐帧播放通过'],changes});
  async function put(feedback){const filename=path.join(engine,'gamecreator/feedback',feedback.id+'.json');await fs.writeFile(filename,JSON.stringify(feedback,null,2));return filename;}
  const scan=()=>api.feedbackScan(fresh());
  const apply=(entry,other={})=>api.feedbackApply({token:entry.token,...other});
  return {dir,engine,storage,sk,tk,input,api,fresh,sync,project,make,put,scan,apply};
}
async function batchFixture(t,options={}) {
  const f=await fixture(t,options),s=rawRead(f.storage,f.sk);
  for(const id of ['task-b','task-c','task-d'])s.tasks.push({...createProductionTask(id),id});
  f.storage.setItem(f.sk,JSON.stringify(s));await f.sync();Object.assign(f.project,JSON.parse(await fs.readFile(path.join(f.engine,'gamecreator/project.json'),'utf8')));
  f.post=async(id,changes,kind='task')=>{const v=f.make(changes,kind);v.target.id=id;await f.put(v);return v;};
  f.batch=(entries,acceptCompletion=false)=>f.api.feedbackApplyBatch({tokens:entries.filter(e=>e.token).map(e=>e.token),acceptCompletion});return f;
}

async function aiFixture(t,options={}){
 const f=await fixture(t,options),s=rawRead(f.storage,f.sk);s.personnel=defaultAiTeam();f.dev=s.personnel.members.find(m=>m.name==='程序A');f.producer=s.personnel.members[0];
 s.tasks[0].assignment={primaryId:f.dev.id,collaboratorIds:[],reviewerId:f.producer.id};s.tasks[0].references=[{kind:'tool',targetId:'tool-a'}];f.storage.setItem(f.sk,JSON.stringify(normalizePersonnelSchedule(s)));
 const {issueAiCredential}=require('../desktop/ai-credentials.cjs'),{signFeedback}=require('../shared/ai-feedback-client.cjs');
 f.issue=(member=f.dev)=>issueAiCredential(f.storage,{projectId:f.input.projectId,memberId:member.id,name:'验收令牌',expiresAt:new Date(Date.now()+86400000).toISOString(),permissions:member.permissions,taskIds:[],schedule:rawRead(f.storage,f.sk)});
 f.credential=f.issue();f.producerCredential=f.issue(f.producer);await f.sync();Object.assign(f.project,JSON.parse(await fs.readFile(path.join(f.engine,'gamecreator/project.json'),'utf8')));
 f.signed=(changes,extra={},secret=f.credential.secret)=>signFeedback({...f.make(changes),...extra},secret);
 return f;
}

test('AI context exports assignments and signing helper without secret; verified feedback uses bound name',async t=>{
 const f=await aiFixture(t),team=JSON.parse(await fs.readFile(path.join(f.engine,'gamecreator/context/team.json'),'utf8'));assert.equal(team.members.length,6);
 const tasks=JSON.parse(await fs.readFile(path.join(f.engine,'gamecreator/context/assignments.json'),'utf8'));assert.equal(tasks.tasks[0].assignment.primaryId,f.dev.id);
 const helper=await fs.readFile(path.join(f.engine,'gamecreator/submit-feedback.cjs'),'utf8');assert.match(helper,/signFeedback/);
 assert.match(await fs.readFile(path.join(f.engine,'gamecreator/members',f.dev.id+'.md'),'utf8'),/程序A/);
 const snapshot=await fs.readFile(path.join(f.engine,'gamecreator/context/snapshots',f.project.snapshotId+'.json'),'utf8');assert.ok(!snapshot.includes(f.credential.secret.privateKey));assert.ok(!JSON.stringify(team).includes(f.credential.secret.privateKey));
 const v=f.signed({status:'待验收',result:'工程开发完成'});await f.put(v);const entry=(await f.scan()).entries[0];assert.equal(entry.identity.memberName,'程序A');assert.equal(entry.legacy,false);
 await f.apply(entry);const receipt=rawRead(f.storage,f.sk).feedbackHistory[0];assert.equal(receipt.author,'程序A');assert.equal(receipt.identity.memberId,f.dev.id);assert.equal((await f.scan()).entries[0].state,'processed');
});
test('named work credentials export exact briefs and batch only their selected work across positions',async t=>{
 const f=await fixture(t),s=rawRead(f.storage,f.sk);s.personnel=defaultWorkTeam();s.tasks[0].references=[{kind:'tool',targetId:'tool-a'}];s.tasks.push({...createProductionTask('制作资源'),id:'art-work',kind:'美术'});f.storage.setItem(f.sk,JSON.stringify(s));
 const {issueAiCredential}=require('../desktop/ai-credentials.cjs'),{signFeedback}=require('../shared/ai-feedback-client.cjs');
 const {secret,credential}=await issueAiCredential(f.storage,{projectId:f.input.projectId,executorName:'跨岗位执行助手',name:'本轮工作',positionIds:['program','art'],taskIds:['task-a','art-work'],workDescription:'交付工具和测试资源',permissions:['progress'],expiresAt:new Date(Date.now()+86400000).toISOString(),schedule:s});
 await f.sync();Object.assign(f.project,JSON.parse(await fs.readFile(path.join(f.engine,'gamecreator/project.json'),'utf8')));
 const brief=await fs.readFile(path.join(f.engine,'gamecreator/assignments',credential.id+'.md'),'utf8');assert.match(brief,/交付工具和测试资源/);assert.match(brief,/art-work/);assert.ok(!brief.includes(secret.privateKey));
 for(const id of ['task-a','art-work'])await f.put(signFeedback({...f.make({status:'待验收'}),target:{kind:'task',id}},secret));
 const scan=await f.scan();assert.equal(scan.entries.filter(e=>e.identity?.verified).length,2);
 const batch=await f.api.feedbackApplyBatch({tokens:scan.entries.map(e=>e.token)});assert.equal(batch.applied.length,2);assert.ok(rawRead(f.storage,f.sk).tasks.every(t=>t.status==='待验收'));
 const next=rawRead(f.storage,f.sk);next.personnel.positions.find(p=>p.id==='program').active=false;f.storage.setItem(f.sk,JSON.stringify(next));
 await f.put(signFeedback(f.make({status:'开发中'},'tool'),secret));const blocked=(await f.scan()).entries.find(e=>e.state==='invalid');assert.match(blocked.error,/任务范围/);
});

test('persistent developer context exports current scope and rechecks changed authority at final feedback commit',async t=>{
 let change=async()=>{};const f=await fixture(t,{beforeFeedbackCommit:async()=>change()}),s=rawRead(f.storage,f.sk);s.personnel=defaultWorkTeam();s.tasks[0].references=[{kind:'tool',targetId:'tool-a'}];f.storage.setItem(f.sk,JSON.stringify(s));
 const {createDeveloperService}=require('../desktop/ai-developers.cjs'),{signFeedback}=require('../shared/ai-feedback-client.cjs'),secrets=new Map();
 const service=createDeveloperService({storage:f.storage,vault:{put:v=>secrets.set(v.credentialId,v),get:(_p,id)=>secrets.get(id),remove:(_p,id)=>secrets.delete(id)}}),input=()=>({projectId:f.input.projectId,schedule:rawRead(f.storage,f.sk),name:'持续开发助手',duties:'维护工具',active:true,permissions:['progress'],profile:{positionIds:['program'],taskIds:[],scope:'positions',expiresAt:''}});
 const created=await service.change('create',input()),secret=service.read({projectId:f.input.projectId,credentialId:created.credential.id});await f.sync();Object.assign(f.project,JSON.parse(await fs.readFile(path.join(f.engine,'gamecreator/project.json'),'utf8')));
 const context=JSON.parse(await fs.readFile(path.join(f.engine,'gamecreator/context/team.json'),'utf8'));assert.equal(context.members[0].developer.scope,'positions');assert.ok(!JSON.stringify(context).includes(secret.privateKey));
 const brief=await fs.readFile(path.join(f.engine,'gamecreator/assignments',created.credential.id+'.md'),'utf8');assert.match(brief,/包含后续任务/);assert.match(brief,/暂无具体任务/);
 const v=signFeedback(f.make({status:'开发中'},'tool'),secret);await f.put(v);const entry=(await f.scan()).entries[0];assert.ok(entry.identity.verified);const before=f.storage.getItem(f.tk);
 change=()=>service.change('update',{...input(),memberId:created.memberId,active:false});await assert.rejects(f.apply(entry),/停用/);assert.equal(f.storage.getItem(f.tk),before);
 change=async()=>{};await service.change('update',{...input(),memberId:created.memberId});const fresh=(await f.scan()).entries.find(e=>e.feedback?.id===v.id);await f.apply(fresh);assert.equal(rawRead(f.storage,f.tk).tools[0].status,'开发中');assert.equal(rawRead(f.storage,f.tk).feedbackHistory[0].identity.memberId,created.memberId);
});

test('AI suggestions append without replacing results; verified review still needs user acceptance',async t=>{
 const f=await aiFixture(t),s=rawRead(f.storage,f.sk);s.tasks[0].result='原交付记录';f.storage.setItem(f.sk,JSON.stringify(s));
 const p=f.signed({result:'建议拆分后续任务'},{intent:'propose'},f.producerCredential.secret);await f.put(p);const e=(await f.scan()).entries[0];assert.equal(e.rows[0].label,'排期与分配建议');await f.apply(e);
 const next=rawRead(f.storage,f.sk);assert.equal(next.tasks[0].result,'原交付记录');assert.equal(next.tasks[0].status,s.tasks[0].status);assert.equal(next.tasks[0].proposals[0].text,'建议拆分后续任务');assert.deepEqual(next.tasks[0].assignment,s.tasks[0].assignment);
 const review=f.signed({status:'已完成'},{intent:'review'},f.producerCredential.secret);await f.put(review);const current=(await f.scan()).entries.find(e=>e.feedback?.id===review.id);await assert.rejects(f.apply(current),/验收/);await f.apply(current,{acceptCompletion:true});assert.equal(rawRead(f.storage,f.sk).tasks[0].status,'已完成');
});

test('unsigned legacy feedback requires individual acknowledgement and is excluded from batch',async t=>{
 const f=await aiFixture(t),old=f.make({status:'进行中'});await f.put(old);const entry=(await f.scan()).entries[0];assert.equal(entry.legacy,true);assert.equal(feedbackBatchItems([entry],true).ready.length,0);
 await assert.rejects(f.apply(entry),/逐条确认/);const batch=await f.api.feedbackApplyBatch({tokens:[entry.token],acceptCompletion:true});assert.equal(batch.applied.length,0);assert.equal(batch.skipped.length,1);
 await f.apply(entry,{acceptLegacy:true});assert.equal(rawRead(f.storage,f.sk).tasks[0].status,'进行中');assert.equal(rawRead(f.storage,f.sk).feedbackHistory[0].identity,undefined);
});

test('revoked AI credentials cannot pass batch or the final asynchronous commit boundary',async t=>{
 let revoke=()=>{};const f=await aiFixture(t,{beforeFeedbackCommit:async()=>revoke()});
 const v=f.signed({status:'开发中'},{target:{kind:'tool',id:'tool-a'}});await f.put(v);const entry=(await f.scan()).entries[0],before=f.storage.getItem(f.tk);
 revoke=()=>{const s=rawRead(f.storage,f.sk);s.personnel.credentials[0].revokedAt=new Date().toISOString();f.storage.setItem(f.sk,JSON.stringify(s));};
 await assert.rejects(f.apply(entry),/撤销/);assert.equal(f.storage.getItem(f.tk),before);
 const batch=await f.api.feedbackApplyBatch({tokens:[entry.token],acceptCompletion:true});assert.equal(batch.applied.length,0);assert.match(batch.failed[0].reason,/撤销/);
});
test('collaboration produces readable context, stable snapshots and preserves feedback/history on scope changes',async t=>{
  const f=await fixture(t),readme=await fs.readFile(path.join(f.engine,'gamecreator/README.md'),'utf8');assert.match(readme,/待验收/);assert.match(readme,/单机工程/);
  const tasks=JSON.parse(await fs.readFile(path.join(f.engine,'gamecreator/context/tasks.json'),'utf8'));assert.equal(tasks.tasks[0].id,'task-a');
  assert.ok((await f.sync()).rows.every(r=>r.status==='unchanged'));
  const feedback=f.make();await f.put(feedback);const task=rawRead(f.storage,f.sk);task.tasks[0].description='需求补充';f.storage.setItem(f.sk,JSON.stringify(task));await f.sync();
  assert.ok(await fs.stat(path.join(f.engine,'gamecreator/context/snapshots',f.project.snapshotId+'.json')));
  assert.equal((await f.scan()).entries[0].state,'pending');
  const plan=await f.api.preview({...f.fresh(),settings:{...f.input.settings,documents:false,collaboration:false}});assert.ok(!plan.rows.some(r=>r.path.startsWith('gamecreator/')));
  await assert.rejects(()=>f.api.preview({...f.fresh(),settings:{...f.input.settings,docsDirectory:'gamecreator/docs'}}),/保留给开发协作/);
});
test('feedback applies whitelisted task fields, preserves plans/milestones/tools and is idempotent across restart',async t=>{
  const f=await fixture(t),feedback=f.make({status:'待验收',actualStart:'2026-09-22',result:'已完成实现，等待验收'});await f.put(feedback);
  const original=rawRead(f.storage,f.sk),tools=f.storage.getItem(f.tk),entry=(await f.scan()).entries[0];assert.equal(entry.rows[0].state,'updated');
  const {receipt}=await f.apply(entry),next=rawRead(f.storage,f.sk);assert.equal(next.tasks[0].status,'待验收');assert.equal(next.tasks[0].start,original.tasks[0].start);assert.deepEqual(next.milestones,original.milestones);assert.equal(f.storage.getItem(f.tk),tools);validateProjectSchedule(next);
  assert.equal(next.feedbackHistory[0].id,feedback.id);assert.equal(JSON.parse(await fs.readFile(path.join(f.engine,'gamecreator/receipts',feedback.id+'.json'),'utf8')).id,receipt.id);
  const restarted=createEngineSync({storage:f.storage,artFiles:{}});assert.equal((await restarted.feedbackScan(f.fresh())).entries[0].state,'processed');assert.equal(rawRead(f.storage,f.sk).feedbackHistory.length,1);
  feedback.changes.result='修改已处理文件';await f.put(feedback);assert.match((await f.scan()).entries[0].error,/新的更新编号/);
});
test('same-field conflicts require a choice; unrelated edits survive and mixed dates are validated',async t=>{
  const f=await fixture(t),feedback=f.make({status:'待验收',result:'反馈结果',actualEnd:'2026-09-22'});await f.put(feedback);
  const current=rawRead(f.storage,f.sk);current.tasks[0].status='受阻';current.tasks[0].owner='负责人修改';current.tasks[0].actualStart='2026-09-23';f.storage.setItem(f.sk,JSON.stringify(current));
  const entry=(await f.scan()).entries[0];assert.equal(entry.rows.find(r=>r.field==='status').state,'conflict');assert.equal(entry.designChanged,true);
  await assert.rejects(()=>f.apply(entry),/冲突/);
  await assert.rejects(()=>f.apply(entry,{decisions:{status:'keep'}}),/实际结束日期/);
  await f.apply(entry,{decisions:{status:'keep',actualEnd:'keep'}});const next=rawRead(f.storage,f.sk);assert.equal(next.tasks[0].status,'受阻');assert.equal(next.tasks[0].result,'反馈结果');assert.equal(next.tasks[0].owner,'负责人修改');
});
test('tool completion requires explicit acceptance, tasks remain independent, dismissal records no changes',async t=>{
  const f=await fixture(t),feedback=f.make({status:'可使用',delivery:'debug/animation.tscn\n测试通过',usage:'打开场景后选择动画'},'tool');await f.put(feedback);
  const entry=(await f.scan()).entries[0];await assert.rejects(()=>f.apply(entry),/核实交付/);
  await f.apply(entry,{acceptCompletion:true});const next=rawRead(f.storage,f.tk);validateDevelopmentTools(next);assert.equal(next.tools[0].status,'可使用');assert.equal(rawRead(f.storage,f.sk).tasks[0].status,'待开始');
  const rejected=f.make({status:'已完成'});await f.put(rejected);const before=rawRead(f.storage,f.sk).tasks;await f.apply((await f.scan()).entries.find(e=>e.feedback?.id===rejected.id),{dismiss:true});assert.deepEqual(rawRead(f.storage,f.sk).tasks,before);assert.equal(rawRead(f.storage,f.sk).feedbackHistory[0].outcome,'dismissed');
});
test('foreign identities, forbidden fields, bad dates, corrupt JSON and missing targets are isolated',async t=>{
  const f=await fixture(t);
  for(const change of [v=>v.projectId='other',v=>v.engine='oasis-lua',v=>v.changes={owner:'overwritten'},v=>v.changes={actualEnd:'2026-02-30'},v=>v.target.id='missing']){const v=f.make();change(v);await f.put(v);}
  await fs.writeFile(path.join(f.engine,'gamecreator/feedback/broken.json'),'{bad');
  const valid=f.make();await f.put(valid);const scan=await f.scan();assert.equal(scan.entries.filter(e=>e.state==='invalid').length,6);assert.equal(scan.entries.filter(e=>e.state==='pending').length,1);await f.apply(scan.entries.find(e=>e.state==='pending'));
});
test('feedback or archive mutations after preview stop writes; active project changes cannot receive an old token',async t=>{
  const f=await fixture(t),feedback=f.make();await f.put(feedback);let entry=(await f.scan()).entries[0];
  feedback.summary='Changed';await f.put(feedback);await assert.rejects(()=>f.apply(entry),/预览后发生变化/);
  entry=(await f.scan()).entries[0];const value=rawRead(f.storage,f.sk);value.tasks[0].result='用户新输入';f.storage.setItem(f.sk,JSON.stringify(value));await assert.rejects(()=>f.apply(entry),/项目内容在预览后发生变化/);
  entry=(await f.scan()).entries[0];const catalog=rawRead(f.storage,'gamecreator.projects.v1');catalog.activeId='another';f.storage.setItem('gamecreator.projects.v1',JSON.stringify(catalog));await assert.rejects(()=>f.apply(entry),/项目或已保存的工程连接/);assert.equal(rawRead(f.storage,f.sk).tasks[0].status,'待开始');
});
test('atomic project save failure does not mark processed; retry is safe',async t=>{
  const f=await fixture(t),feedback=f.make();await f.put(feedback);const entry=(await f.scan()).entries[0],set=f.storage.setItem;
  f.storage.setItem=()=>{throw new Error('模拟磁盘写入失败');};await assert.rejects(()=>f.apply(entry),/磁盘写入失败/);assert.equal(rawRead(f.storage,f.sk).tasks[0].status,'待开始');assert.equal(rawRead(f.storage,f.sk).feedbackHistory,undefined);
  f.storage.setItem=set;await f.apply(entry);assert.equal((await f.scan()).entries[0].state,'processed');
});
test('a failed receipt mirror can be repaired after restart without replaying task updates',async t=>{
  const f=await fixture(t),feedback=f.make();await f.put(feedback);const entry=(await f.scan()).entries[0],receiptPath=path.join(f.engine,'gamecreator/receipts',feedback.id+'.json');await fs.mkdir(receiptPath);
  const result=await f.apply(entry);assert.match(result.warning,/项目已保存/);const value=rawRead(f.storage,f.sk);value.tasks[0].result='后续人工修改';f.storage.setItem(f.sk,JSON.stringify(value));
  let scan=await f.scan();assert.equal(scan.entries[0].state,'processed');assert.deepEqual(scan.missingReceipts,[feedback.id]);
  await fs.rmdir(receiptPath);const restarted=createEngineSync({storage:f.storage,artFiles:{}});await restarted.feedbackRepair(f.input);scan=await restarted.feedbackScan(f.fresh());assert.deepEqual(scan.missingReceipts,[]);assert.equal(rawRead(f.storage,f.sk).tasks[0].result,'后续人工修改');assert.equal(rawRead(f.storage,f.sk).feedbackHistory.length,1);
});
test('tampered snapshot, archived tool, stale source and hardlinked feedback are rejected',async t=>{
  const f=await fixture(t),feedback=f.make();const file=await f.put(feedback),base=path.join(f.engine,'gamecreator/context/snapshots',feedback.snapshotId+'.json'),bytes=await fs.readFile(base);
  await fs.writeFile(base,'{}');assert.match((await f.scan()).entries[0].error,/比较基准/);await fs.writeFile(base,bytes);
  const ext=path.join(f.dir,'linked.json');await fs.link(file,ext);assert.match((await f.scan()).entries[0].error,/链接/);await fs.unlink(ext);
  const tools=rawRead(f.storage,f.tk);tools.tools[0].archived=true;f.storage.setItem(f.tk,JSON.stringify(tools));await f.put(f.make({status:'开发中'},'tool'));assert.ok((await f.scan()).entries.some(e=>e.error?.includes('已归档')));
  await assert.rejects(()=>f.api.feedbackScan(f.input),/项目内容已变化/);
});
test('commit rechecks the project archive after asynchronous work',async t=>{
  let mutate=()=>{};const f=await fixture(t,{beforeFeedbackCommit:async()=>mutate()}),feedback=f.make();await f.put(feedback);const entry=(await f.scan()).entries[0];
  mutate=()=>{const value=rawRead(f.storage,f.sk);value.tasks[0].result='Concurrent';f.storage.setItem(f.sk,JSON.stringify(value));};
  await assert.rejects(()=>f.apply(entry),/应用前发生变化/);assert.equal(rawRead(f.storage,f.sk).tasks[0].result,'Concurrent');assert.equal(rawRead(f.storage,f.sk).feedbackHistory,undefined);
});
test('expired feedback reviews, changed snapshots, pending sync and deleted targets cannot write',async t=>{
  const f=await fixture(t),v=f.make();await f.put(v);let entry=(await f.scan()).entries[0];
  const now=Date.now;try{Date.now=()=>now()+601000;await assert.rejects(()=>f.apply(entry),/已过期/);}finally{Date.now=now;}
  entry=(await f.scan()).entries[0];const snapshot=path.join(f.engine,'gamecreator/context/snapshots',v.snapshotId+'.json'),saved=await fs.readFile(snapshot);await fs.writeFile(snapshot,'{}');await assert.rejects(()=>f.apply(entry),/比较基准/);await fs.writeFile(snapshot,saved);
  const pending=path.join(f.engine,'.gamecreator-sync/pending.json');await fs.writeFile(pending,'{}');await assert.rejects(()=>f.apply(entry),/恢复中断/);await fs.unlink(pending);
  const s=rawRead(f.storage,f.sk);s.tasks=[];f.storage.setItem(f.sk,JSON.stringify(s));assert.match((await f.scan()).entries[0].error,/已删除/);assert.equal(rawRead(f.storage,f.sk).feedbackHistory,undefined);
});
test('strict feedback schema and merge preserve unknown local fields and reject forged decisions',()=>{
  const v={schema:1,id:randomUUID(),snapshotId:'a'.repeat(64),projectId:'p',engine:'godot-gdscript',target:{kind:'task',id:'t'},author:'A',summary:'S',evidence:[],changes:{status:'待验收'}};
  validateFeedback(v);assert.throws(()=>validateFeedback({...v,changes:{dependencyIds:[]}}),/不支持回写/);assert.throws(()=>validateFeedback({...v,target:{kind:'__proto__',id:'a'}}),/标识/);
  const rows=feedbackDiff(v,{status:'待开始'},{status:'进行中'});assert.throws(()=>mergeFeedback({status:'进行中'},rows,{}),/冲突/);assert.deepEqual(mergeFeedback({status:'进行中',extra:'preserve'},rows,{status:'feedback'}),{status:'待验收',extra:'preserve'});
});
test('Oasis uses the same feedback protocol and keeps task acceptance separate from milestones',async t=>{
  const f=await fixture(t),engine=path.join(f.dir,'oasis');await fs.mkdir(engine);f.input.config={engine:'oasis-lua',projectPath:engine};const cat=rawRead(f.storage,'gamecreator.projects.v1');cat.projects[0].config=f.input.config;f.storage.setItem('gamecreator.projects.v1',JSON.stringify(cat));await f.sync();
  const p=JSON.parse(await fs.readFile(path.join(engine,'gamecreator/project.json'),'utf8')),v={...f.make({status:'已完成',result:'验收通过'}),engine:'oasis-lua',snapshotId:p.snapshotId};await fs.writeFile(path.join(engine,'gamecreator/feedback',v.id+'.json'),JSON.stringify(v));
  const e=(await f.scan()).entries[0];await assert.rejects(()=>f.apply(e),/核实交付/);await f.apply(e,{acceptCompletion:true});assert.equal(rawRead(f.storage,f.sk).tasks[0].status,'已完成');assert.equal(rawRead(f.storage,f.sk).milestones[0].status,'计划中');
});
test('feedback history is portable through full project folder export and rejects malformed receipts',async t=>{
  const f=await fixture(t);await f.put(f.make());await f.apply((await f.scan()).entries[0]);const receipt=rawRead(f.storage,f.sk).feedbackHistory[0];
  const {preparePrototypeProject,writePrototypeProject}=await import('../src/prototype-import.ts'),{captureProjectPackage,validateProjectPackage}=await import('../src/project-package.ts');
  const {createProjectPackages}=require('../desktop/project-package.cjs');
  const example=JSON.parse(await fs.readFile(new URL('../examples/prototypes/plants-vs-zombies.json',import.meta.url),'utf8')),p=preparePrototypeProject({schema:2,projects:[],activeId:'',mode:'project'},example,'反馈存档');
  const storage=createStorage(path.join(f.dir,'portable-data'));writePrototypeProject(storage,p);storage.setItem('gamecreator.projects.v1',JSON.stringify(p.catalog));
  const key='gamecreator.workspace.v1:'+p.project.id+':project-schedule',value=rawRead(storage,key);value.feedbackHistory=[receipt];storage.setItem(key,JSON.stringify(value));
  const snapshot=captureProjectPackage(storage,p.project);assert.deepEqual(validateProjectPackage(snapshot.document).archives['project-schedule'].feedbackHistory,[receipt]);
  const service=createProjectPackages({dataDirectory:path.join(f.dir,'portable-data'),storage}),directory=path.join(f.dir,'export');await service.exportFolder({directory,projectId:p.project.id,...snapshot});
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory,'data/project-schedule.json'),'utf8')).feedbackHistory,[receipt]);
  assert.throws(()=>validateFeedbackHistory([{...receipt,rows:[{...receipt.rows[0],current:{bad:true}}]}],'task'),/处理记录损坏/);
  const bad=rawRead(f.storage,f.sk);bad.feedbackHistory[0].decisions={other:'feedback'};f.storage.setItem(f.sk,JSON.stringify(bad));await assert.rejects(()=>f.scan(),/处理记录损坏/);
});
test('batch applies different tasks in one archive and tools without treating its own writes as concurrent edits',async t=>{
  const f=await batchFixture(t);for(const id of ['task-a','task-b','task-c','task-d'])await f.post(id,{status:'进行中',result:'开发进展：'+id});await f.post('tool-a',{status:'开发中',delivery:'工具入口'},'tool');
  const entries=(await f.scan()).entries,result=await f.batch(entries);assert.equal(result.applied.length,5);assert.deepEqual(result.failed,[]);assert.deepEqual(result.skipped,[]);
  const s=rawRead(f.storage,f.sk);assert.equal(s.feedbackHistory.length,4);assert.ok(s.tasks.every(t=>t.status==='进行中'&&t.result==='开发进展：'+t.id));assert.equal(s.milestones[0].status,'计划中');assert.equal(rawRead(f.storage,f.tk).feedbackHistory.length,1);
  assert.ok((await f.scan()).entries.every(e=>e.state==='processed'));await assert.rejects(()=>f.batch(entries),/已过期/);assert.equal(rawRead(f.storage,f.sk).feedbackHistory.length,4);
});
test('batch retains conflicts, duplicate targets and invalid files; completed states require batch acceptance',async t=>{
  const f=await batchFixture(t);await f.post('task-a',{status:'进行中'});await f.post('task-b',{status:'待验收'});await f.post('task-c',{status:'已完成'});await f.post('tool-a',{status:'开发中'},'tool');await f.post('tool-a',{usage:'重复反馈'},'tool');
  await fs.writeFile(path.join(f.engine,'gamecreator/feedback/broken.json'),'{bad');const s=rawRead(f.storage,f.sk);s.tasks.find(t=>t.id==='task-b').status='受阻';f.storage.setItem(f.sk,JSON.stringify(s));
  let scan=await f.scan(),selection=feedbackBatchItems(scan.entries);assert.equal(selection.ready.length,1);assert.equal(selection.skipped.length,5);
  let result=await f.batch(scan.entries);assert.equal(result.applied.length,1);assert.equal(result.skipped.length,4);assert.equal(result.failed.length,0);assert.equal(rawRead(f.storage,f.sk).tasks.find(t=>t.id==='task-c').status,'待开始');
  scan=await f.scan();selection=feedbackBatchItems(scan.entries,true);assert.equal(selection.ready.length,1);result=await f.batch(scan.entries,true);assert.equal(result.applied[0].receipt.target.id,'task-c');assert.equal(rawRead(f.storage,f.sk).tasks.find(t=>t.id==='task-b').status,'受阻');assert.equal(rawRead(f.storage,f.tk).tools[0].status,'待开发');assert.equal((await f.scan()).entries.filter(e=>e.state==='pending').length,3);
});
test('batch stops on external writes and reports partial success without replaying completed items',async t=>{
  let before=()=>{};const f=await batchFixture(t,{beforeFeedbackCommit:async()=>before()});for(const id of ['task-a','task-b','task-c'])await f.post(id,{status:'进行中'});
  const entries=(await f.scan()).entries.sort((a,b)=>a.feedback.target.id.localeCompare(b.feedback.target.id));let calls=0;
  before=()=>{if(++calls===2){const s=rawRead(f.storage,f.sk);s.tasks.find(t=>t.id==='task-b').owner='新的用户编辑';f.storage.setItem(f.sk,JSON.stringify(s));}};
  const result=await f.batch(entries);assert.equal(result.applied.length,1);assert.equal(result.failed.length,1);assert.equal(result.skipped.length,1);assert.match(result.failed[0].reason,/应用前发生变化/);
  const s=rawRead(f.storage,f.sk);assert.equal(s.feedbackHistory.length,1);assert.equal(s.tasks.find(t=>t.id==='task-a').status,'进行中');assert.equal(s.tasks.find(t=>t.id==='task-b').status,'待开始');assert.equal(s.tasks.find(t=>t.id==='task-b').owner,'新的用户编辑');assert.equal(s.tasks.find(t=>t.id==='task-c').status,'待开始');
  before=()=>{};const again=await f.batch((await f.scan()).entries);assert.equal(again.applied.length,2);assert.equal(rawRead(f.storage,f.sk).feedbackHistory.length,3);
});
test('batch rejects mixed generations or duplicate tokens before writing and detects modified feedback files',async t=>{
  const f=await batchFixture(t),a=await f.post('task-a',{status:'进行中'});await f.post('task-b',{status:'进行中'});let entries=(await f.scan()).entries;
  await assert.rejects(()=>f.api.feedbackApplyBatch({tokens:[entries[0].token,entries[0].token]}),/选择无效/);
  const old=entries.find(e=>e.feedback.id===a.id);const s=rawRead(f.storage,f.sk);s.tasks[0].description='更新需求';f.storage.setItem(f.sk,JSON.stringify(s));entries=(await f.scan()).entries;const other=entries.find(e=>e.feedback.id!==a.id);
  await assert.rejects(()=>f.api.feedbackApplyBatch({tokens:[old.token,other.token]}),/快照不一致/);assert.equal(rawRead(f.storage,f.sk).feedbackHistory,undefined);
  a.summary='文件已更改';await f.put(a);entries.sort((x,y)=>x.feedback.target.id.localeCompare(y.feedback.target.id));const result=await f.batch(entries);assert.equal(result.applied.length,0);assert.equal(result.failed.length,1);assert.match(result.failed[0].reason,/反馈文件在预览后发生变化/);assert.equal(rawRead(f.storage,f.sk).feedbackHistory,undefined);
});
