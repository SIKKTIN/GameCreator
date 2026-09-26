import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {assertArtPermission,recommendedArtPermissions} from '../shared/art-permissions.mjs';
import {dispatchTask,assertDispatch,taskInbox,inboxMarkdown} from '../shared/task-inbox.mjs';
import {presetPositions} from '../shared/ai-personnel.mjs';
import {createProductionTask,validateProjectSchedule} from '../src/project-schedule.ts';
const require=createRequire(import.meta.url),{fixture,initialOperations}=require('./authoring-fixture.cjs'),{signFeedback}=require('../shared/ai-feedback-client.cjs');
const member=(id,role,grants=[])=>({id,name:id,active:true,roles:[role],permissions:['progress','review'],scope:'assigned',duties:'',createdAt:new Date().toISOString(),developer:{positionIds:[role],taskIds:[],scope:'assigned',expiresAt:'',artPermissions:grants}});
const setup=()=>({schema:1,tasks:[{...createProductionTask('僵尸动画'),id:'art-task',kind:'美术',positionIds:['art']},{...createProductionTask('方案设计'),id:'technical-task',kind:'美术',positionIds:['technical-art']}],milestones:[],personnel:{schema:1,positions:presetPositions('production'),members:[member('lead','art-director',recommendedArtPermissions(['art-director'])),member('ta','technical-art',recommendedArtPermissions(['technical-art'])),member('artist','art'),member('coder','program')],credentials:[]}});
test('detail editing cannot smuggle structure, history, files or workflow through enclosing arrays',()=>{
 const s=setup(),lead=s.personnel.members[0],ta=s.personnel.members[1],before={schema:1,requirements:[{id:'r',name:'素材',description:'旧',sources:[],archived:false}],assets:[],links:[],style:{draft:{direction:'旧'},versions:[]}};
 const after=structuredClone(before);after.requirements[0].description='新';assert.doesNotThrow(()=>assertArtPermission(lead,before,after));assert.doesNotThrow(()=>assertArtPermission(ta,before,after));
 for(const mutate of [x=>x.requirements.push({id:'new'}),x=>x.requirements=[],x=>x.requirements[0].archived=true,x=>x.requirements[0].sources.push({id:'other'}),x=>x.requirements[0].status='已完成',x=>x.assets.push({id:'a',versions:[]}),x=>x.library={categories:[]}]){const next=structuredClone(before);mutate(next);assert.throws(()=>assertArtPermission(lead,before,next));}
 after.style.draft.direction='剪纸';assert.doesNotThrow(()=>assertArtPermission(lead,before,after));assert.throws(()=>assertArtPermission(ta,before,after),/风格/);
 const plan={...before,productionDocs:[{id:'plan',content:'骨骼动画'}]};assert.doesNotThrow(()=>assertArtPermission(ta,before,plan));assert.throws(()=>assertArtPermission(lead,before,plan),/技术/);assert.throws(()=>assertArtPermission(ta,plan,before),/建议/);
});
test('dispatch keeps a single task and validates active roles, explicit authority and recipient scope',()=>{
 const s=setup(),next=dispatchTask(s,'lead','artist','art-task','dispatch-1');validateProjectSchedule(next);require('../desktop/project-package.cjs').validateProjectScheduleArchive(next);
 assert.equal(s.tasks[0].assignment,undefined);assert.equal(next.tasks.length,s.tasks.length);assert.equal(next.tasks[0].assignment.primaryId,'artist');assert.equal(next.tasks[0].assignment.reviewerId,'lead');assert.deepEqual(next.personnel.members[2].developer.taskIds,['art-task']);assert.equal(next.personnel.members[2].developer.scope,'assigned');
 assert.equal(taskInbox(next,'artist').tasks[0].id,'art-task');assert.equal(taskInbox(next,'lead').dispatched[0].id,'art-task');next.tasks[0].status='待验收';assert.equal(taskInbox(next,'lead').reviews.length,1);assert.match(inboxMarkdown(next,'lead'),/僵尸动画/);
 assert.throws(()=>assertDispatch(s,'lead','coder','art-task'),/只能派发/);assert.throws(()=>assertDispatch(s,'lead','ta','art-task'),/岗位/);assert.throws(()=>assertDispatch(s,'ta','artist','art-task'),/权限/);
 s.personnel.members[1].developer.artPermissions.push('dispatch');assert.doesNotThrow(()=>assertDispatch(s,'ta','artist','art-task'));s.personnel.positions.find(p=>p.id==='art-director').active=false;assert.throws(()=>assertDispatch(s,'lead','artist','art-task'));
});
test('member inbox includes received proposals, review work and dispatch history without duplicating status',()=>{
 const s=dispatchTask(setup(),'lead','artist','art-task','d1');s.tasks[0].proposals=[{id:'p1',memberId:'artist',text:'建议增加受击动画，请评估排期影响',at:new Date().toISOString()}];assert.equal(taskInbox(s,'lead').proposals.length,1);assert.equal(taskInbox(s,'coder').proposals.length,0);
 s.tasks[0].proposals[0].resolution='accepted';s.tasks[0].proposals[0].resolvedAt=new Date().toISOString();validateProjectSchedule(s);assert.equal(s.tasks[0].status,'待开始');
});
test('native signed authoring accepts granular art changes and rejects scope/structure bypasses',async()=>{
 const f=await fixture();try{
  const initial=f.draft(initialOperations());f.submit(initial);let entry=f.run('scan').items[0];f.run('apply',entry);
  let schedule=JSON.parse(f.storage.getItem(f.sk));schedule.personnel.positions=presetPositions('production');f.storage.setItem(f.sk,JSON.stringify(schedule));
  const created=await f.developers.change('create',{projectId:f.project.id,schedule,name:'主美',duties:'风格与细节',permissions:['progress'],profile:{positionIds:['art-director'],taskIds:[],scope:'assigned',expiresAt:'',artPermissions:['style','details','propose','dispatch']}}),secret=f.developers.read({projectId:f.project.id,credentialId:created.credential.id});f.run('export');
  const submit=ops=>{const p=f.draft(ops);require('node:fs').writeFileSync(require('node:path').join(f.project.folderPath,'ai/changes',p.id+'.json'),JSON.stringify(signFeedback(p,secret)));return f.run('scan').items.find(i=>i.id===p.id);};
  entry=submit([{id:'detail',module:'art-assets',op:'set',path:'/requirements/@art/description',value:'清晰轮廓，拆分四肢'}]);assert.equal(entry.error,undefined);f.run('apply',entry);
  assert.match(submit([{id:'remove',module:'art-assets',op:'remove',path:'/requirements/@art'}]).error,/建议|引用/);
  assert.match(submit([{id:'foreign',module:'project',op:'set',path:'/description',value:'越权'}]).error,/权限/);
  entry=submit([{id:'style',module:'art-assets',op:'set',path:'/style/draft/direction',value:'统一风格'}]);assert.equal(entry.error,undefined);
  schedule=JSON.parse(f.storage.getItem(f.sk));schedule.personnel.members.find(m=>m.id===created.memberId).developer.artPermissions=[];f.storage.setItem(f.sk,JSON.stringify(schedule));assert.throws(()=>f.run('apply',entry),/权限/);
 }finally{f.close();}
});
