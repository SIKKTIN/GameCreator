import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {defaultAiTeam,newAiMember,nextAiName,applyAssignments,suggestAssignments,normalizePersonnelSchedule,personnelMarkdown,defaultWorkTeam,positionsOf,positionTasks,workAssignees,credentialMarkdown} from '../shared/ai-personnel.mjs';
import {createProductionTask,validateProjectSchedule} from '../src/project-schedule.ts';
const require=createRequire(import.meta.url),{issueAiCredential,verifyAiFeedback}=require('../desktop/ai-credentials.cjs'),{signFeedback}=require('../shared/ai-feedback-client.cjs'),{validateProjectScheduleArchive}=require('../desktop/project-package.cjs');
function fixture(){const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},projectId='ai-team',sk='gamecreator.workspace.v1:'+projectId+':project-schedule';storage.setItem('gamecreator.projects.v1',JSON.stringify({activeId:projectId,projects:[{id:projectId}]}));const personnel=defaultAiTeam(),developer=personnel.members.find(m=>m.name==='程序A'),reviewer=personnel.members.find(m=>m.name==='测试A'),producer=personnel.members[0],task={...createProductionTask('实现种植'),assignment:{primaryId:developer.id,collaboratorIds:[],reviewerId:reviewer.id}},schedule=normalizePersonnelSchedule({schema:1,personnel,tasks:[task,{...createProductionTask('其他开发'),id:'other'}],milestones:[]});const read=()=>JSON.parse(storage.getItem(sk));storage.setItem(sk,JSON.stringify(schedule));const issue=(member=developer,extra={})=>issueAiCredential(storage,{projectId,memberId:member.id,name:'测试凭证',expiresAt:new Date(Date.now()+86400000).toISOString(),permissions:member.permissions,taskIds:[],schedule:read(),...extra});const draft=(extra={})=>({schema:1,projectId,engine:'godot-gdscript',id:randomUUID(),snapshotId:'f'.repeat(64),target:{kind:'task',id:task.id},author:'伪造姓名',summary:'工作进度',evidence:['验证通过'],changes:{status:'待验收',result:'工作已完成'},...extra});return{storage,read,sk,developer,reviewer,producer,task,schedule,issue,draft};}
test('AI names, multi-role identity, conservative suggestions and atomic renames',()=>{
 const team=defaultAiTeam();assert.deepEqual(team.members.map(m=>m.name),['制作人','策划A','程序A','美术A','测试A','音效A']);const dev=team.members[2];dev.roles.push('测试');assert.equal(newAiMember(team.members,'程序开发').name,'程序B');assert.equal(nextAiName(Array.from({length:26},(_,i)=>({name:'程序'+String.fromCharCode(65+i)})),'程序开发'),'程序AA');
 const tasks=[createProductionTask('实现'),{...createProductionTask('旧负责人'),owner:'历史人员'},{...createProductionTask('杂项'),kind:'其他'}],schedule={schema:1,tasks,milestones:[],personnel:team};
 assert.deepEqual(suggestAssignments(schedule).map(s=>s.taskId),[tasks[0].id]);const next=applyAssignments(schedule,suggestAssignments(schedule));assert.equal(next.tasks[0].owner,'程序A');assert.equal(next.tasks[1].owner,'历史人员');assert.equal(next.tasks[2].assignment,undefined);
 const other=newAiMember(team.members,'程序开发');team.members.push(other);assert.equal(suggestAssignments(schedule).length,0);
 next.personnel.members.find(m=>m.id===dev.id).name='程序负责人';const renamed=normalizePersonnelSchedule(next);assert.equal(renamed.tasks[0].assignment.primaryId,dev.id);assert.equal(renamed.tasks[0].owner,'程序负责人');assert.match(personnelMarkdown(renamed),/程序负责人/);validateProjectSchedule(renamed);validateProjectScheduleArchive(renamed);
});
test('credential issuance persists only public verification; strict validation matches desktop boundary',()=>{
 const f=fixture(),{secret,credential}=f.issue();assert.ok(secret.privateKey);assert.ok(credential.publicKey);assert.ok(!JSON.stringify(f.read()).includes(secret.privateKey));assert.ok(!personnelMarkdown(f.read()).includes(secret.privateKey));
 assert.throws(()=>f.issue(f.developer,{permissions:['review']}),/权限/);assert.throws(()=>f.issue(f.developer,{schedule:f.schedule}),/已变化/);
 for(const change of [s=>s.personnel.members[1].name=s.personnel.members[0].name,s=>s.personnel.members[0].roles=[],s=>s.personnel.members[0].permissions=['admin'],s=>s.personnel.credentials[0].privateKey='secret',s=>s.tasks[0].assignment.collaboratorIds=[s.tasks[0].assignment.primaryId],s=>s.personnel.credentials[0].expiresAt='bad']){const s=f.read();change(s);assert.throws(()=>validateProjectSchedule(s));assert.throws(()=>validateProjectScheduleArchive(s));}
});
test('signature verifies assigned identity; tampering, cross-project and cross-task grants cannot pass',()=>{
 const f=fixture(),{secret}=f.issue(),feedback=signFeedback(f.draft(),secret);assert.equal(verifyAiFeedback(feedback,f.read()).memberName,'程序A');
 for(const mutate of [v=>v.author='制作人',v=>v.changes.result='篡改结果',v=>v.identity.memberId=f.producer.id,v=>v.identity.signature='x']){const v=structuredClone(feedback);mutate(v);assert.throws(()=>verifyAiFeedback(v,f.read()),/签名|令牌/);}
 assert.throws(()=>verifyAiFeedback(signFeedback(f.draft({target:{kind:'task',id:'other'}}),secret),f.read()),/范围/);
 const cross=signFeedback(f.draft({projectId:'other-project'}),{...secret,projectId:'other-project'});assert.throws(()=>verifyAiFeedback(cross,f.read()),/令牌/);
 const copy=f.read();copy.personnel.members.find(m=>m.id===f.developer.id).name='程序B';assert.equal(verifyAiFeedback(feedback,copy).memberName,'程序B');
});
test('current assignments, revocation, expiry, stopped members and reduced permissions apply immediately',()=>{
 const f=fixture(),{secret}=f.issue(),feedback=signFeedback(f.draft(),secret),original=f.read();
 for(const mutate of [s=>s.personnel.credentials[0].revokedAt=new Date().toISOString(),s=>s.personnel.credentials[0].expiresAt='2020-01-01',s=>s.personnel.members.find(m=>m.id===f.developer.id).active=false,s=>s.personnel.members.find(m=>m.id===f.developer.id).permissions=[],s=>s.tasks[0].assignment.primaryId=f.producer.id]){const s=structuredClone(original);mutate(s);assert.throws(()=>verifyAiFeedback(feedback,s));}
 assert.throws(()=>verifyAiFeedback(signFeedback(f.draft({changes:{status:'已完成'}}),secret),original),/验收权限/);
 const restricted=f.issue(f.developer,{taskIds:['other']});assert.throws(()=>verifyAiFeedback(signFeedback(f.draft(),restricted.secret),f.read()),/范围/);
});
test('review and planning feedback require their own grants, preserve legacy as explicitly unverified',()=>{
 const f=fixture(),review=f.issue(f.reviewer),producer=f.issue(f.producer);
 assert.equal(verifyAiFeedback(signFeedback(f.draft({intent:'review',changes:{status:'已完成',result:'已核验'}}),review.secret),f.read()).intent,'review');
 assert.throws(()=>verifyAiFeedback(signFeedback(f.draft({intent:'review',changes:{actualStart:'2026-01-01'}}),review.secret),f.read()),/实际工作日期/);
 assert.equal(verifyAiFeedback(signFeedback(f.draft({intent:'propose',changes:{result:'建议任务拆分'}}),producer.secret),f.read()).intent,'propose');
 assert.throws(()=>verifyAiFeedback(signFeedback(f.draft({intent:'propose',changes:{status:'已完成'}}),producer.secret),f.read()),/只能提交/);
 assert.equal(verifyAiFeedback(f.draft(),f.read()).legacy,true);assert.throws(()=>verifyAiFeedback(f.draft({intent:'review'}),f.read()),/签名/);
 const empty={...f.read()};delete empty.personnel;assert.equal(verifyAiFeedback(f.draft(),empty),undefined);
});
test('failed persistence does not issue a credential; retry succeeds without duplicate public records',()=>{
 const f=fixture(),before=f.storage.getItem(f.sk),save=f.storage.setItem;
 f.storage.setItem=()=>{throw new Error('disk unavailable');};
 assert.throws(()=>f.issue(),/disk unavailable/);assert.equal(f.storage.getItem(f.sk),before);
 f.storage.setItem=save;const {secret}=f.issue();assert.equal(f.read().personnel.credentials.length,1);
 assert.equal(verifyAiFeedback(signFeedback(f.draft(),secret),f.read()).verified,true);
});
test('positions group work without multiplying executor names; explicit job allocation creates identity atomically',async()=>{
 const f=fixture(),legacy=f.read(),s={...structuredClone(legacy),personnel:defaultWorkTeam()};delete s.tasks[0].assignment;s.tasks[0].owner='';s.tasks[1].kind='美术';f.storage.setItem(f.sk,JSON.stringify(s));
 assert.deepEqual(positionsOf(s).map(p=>p.name),['制作人','策划','程序','美术','测试','音效']);assert.equal(s.personnel.members.length,0);
 assert.equal(positionTasks(s,'program').length,1);assert.equal(positionTasks(legacy,'program').length,2);assert.equal(legacy.personnel.members.length,6);
 const input={projectId:'ai-team',executorName:'战斗与资源助手',name:'本轮交付',permissions:['progress'],positionIds:['program','art'],taskIds:[s.tasks[0].id,'other'],workDescription:'完成程序与素材接入',expiresAt:new Date(Date.now()+86400000).toISOString(),schedule:s};
 const save=f.storage.setItem;f.storage.setItem=()=>{throw new Error('disk unavailable');};await assert.rejects(issueAiCredential(f.storage,input),/disk unavailable/);assert.deepEqual(f.read(),s);f.storage.setItem=save;
 const {secret,credential}=await issueAiCredential(f.storage,input),next=f.read();assert.equal(next.personnel.members.length,1);assert.deepEqual(next.tasks,s.tasks);assert.equal(next.personnel.members[0].name,input.executorName);assert.equal(workAssignees(next,s.tasks[0].id,'ai-team').length,1);
 for(const task of next.tasks){const feedback=signFeedback(f.draft({target:{kind:'task',id:task.id}}),secret);assert.equal(verifyAiFeedback(feedback,next).memberName,input.executorName);}
 assert.match(credentialMarkdown(next,credential),/完成程序与素材接入/);assert.ok(!JSON.stringify(next).includes(secret.privateKey));validateProjectSchedule(next);validateProjectScheduleArchive(next);
 const newTask={...createProductionTask('新加程序工作'),id:'new'};next.tasks.push(newTask);assert.throws(()=>verifyAiFeedback(signFeedback(f.draft({target:{kind:'task',id:'new'}}),secret),next),/范围/);
 next.tasks[0].positionIds=['qa'];assert.throws(()=>verifyAiFeedback(signFeedback(f.draft(),secret),next),/范围/);next.tasks[0].positionIds=['program'];next.personnel.positions.find(p=>p.id==='program').active=false;assert.throws(()=>verifyAiFeedback(signFeedback(f.draft(),secret),next),/范围/);
 assert.equal(verifyAiFeedback(signFeedback(f.draft({target:{kind:'task',id:'other'}}),secret),next).verified,true);
 await assert.rejects(issueAiCredential(f.storage,{...input,schedule:f.read()}),/唯一/);
 await assert.rejects(issueAiCredential(f.storage,{...input,executorName:'超范围',positionIds:['program'],schedule:f.read()}),/具体工作/);
 const reused=await issueAiCredential(f.storage,{...input,memberId:secret.memberId,schedule:f.read(),taskIds:[s.tasks[0].id]});assert.equal(f.read().personnel.members.length,1);assert.equal(reused.secret.memberId,secret.memberId);
 const bad=f.read();bad.personnel.credentials[0].taskIds=[];assert.throws(()=>validateProjectSchedule(bad));assert.throws(()=>validateProjectScheduleArchive(bad));
});
test('exported signing helper publishes complete feedback without overwriting a prior submission',()=>{
 const f=fixture(),{secret}=f.issue(),root=fs.mkdtempSync(path.join(os.tmpdir(),'gc-ai-cli-'));
 try {
  const output=path.join(root,'feedback');fs.mkdirSync(output);
  const credentialFile=path.join(root,'private.json'),draftFile=path.join(root,'draft.json'),draft=f.draft();
  fs.writeFileSync(credentialFile,JSON.stringify(secret));fs.writeFileSync(draftFile,JSON.stringify(draft));
  const helper=fileURLToPath(new URL('../shared/ai-feedback-client.cjs',import.meta.url));
  const run=()=>spawnSync(process.execPath,[helper,credentialFile,draftFile,output],{encoding:'utf8'});
  const first=run();assert.equal(first.status,0,first.stderr);
  const file=path.join(output,draft.id+'.json'),content=fs.readFileSync(file,'utf8');
  assert.equal(verifyAiFeedback(JSON.parse(content),f.read()).verified,true);assert.ok(!content.includes(secret.privateKey));
  fs.writeFileSync(draftFile,JSON.stringify({...draft,changes:{result:'replacement'}}));
  assert.equal(run().status,1);assert.equal(fs.readFileSync(file,'utf8'),content);
  assert.deepEqual(fs.readdirSync(output),[draft.id+'.json']);
 } finally {
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'gc-ai-cli-'));fs.rmSync(root,{recursive:true,force:true});
 }
});
