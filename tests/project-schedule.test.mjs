import test from 'node:test';
import {defaultAiTeam,applyAssignments,suggestAssignments} from '../shared/ai-personnel.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { emptyProjectSchedule, createProductionTask, createProductionMilestone, validateProjectSchedule, scheduleFromMilestones, readProjectSchedule, writeProjectSchedule, shiftScheduleDate, moveProductionTask, projectScheduleIssues, removeProductionTask, removeProductionMilestone, projectScheduleMarkdown, buildScheduleSources } from '../src/project-schedule.ts';
import { preparePrototypeProject, writePrototypeProject } from '../src/prototype-import.ts';
import { captureProjectPackage, validateProjectPackage, prepareProjectPackageImport, writeProjectPackageImport } from '../src/project-package.ts';
import { readLocalOverview } from '../src/overview-model.ts';
const require=createRequire(import.meta.url),{createWorkspaceStorage}=require('../desktop/test-workspaces.cjs'),{createProjectPackages}=require('../desktop/project-package.cjs');
const memory=()=>{const data=new Map();return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};};
const fixture=()=>{const a={...createProductionTask('程序灰盒'),id:'a',start:'2026-09-21',end:'2026-09-23'},b={...createProductionTask('验证闭环'),id:'b',kind:'测试',dependencyIds:['a'],start:'2026-09-24',end:'2026-09-25'},m={...createProductionMilestone('首个闭环'),id:'m',due:'2026-09-25',acceptance:'可进入对局并重开'};a.milestoneId=b.milestoneId=m.id;return {schema:1,tasks:[a,b],milestones:[m]};};
test('legacy milestones are read without writes, keep stable IDs and completion, and guard concurrent migration',()=>{
 const s=memory(),legacy=[{title:'历史成果',owner:'设计师',due:'2026/09/20',status:'done'},{title:'未定',owner:'',due:'下个月',status:'planned'}];s.setItem('legacy',JSON.stringify(legacy));
 const r=readProjectSchedule(s,'schedule','legacy');assert.equal(r.raw,null);assert.equal(s.getItem('schedule'),null);assert.equal(r.store.milestones[0].due,'2026-09-20');assert.equal(r.store.milestones[0].status,'已验收');assert.ok(r.store.milestones[1].description.includes('下个月'));assert.deepEqual(readProjectSchedule(s,'schedule','legacy').store,r.store);
 s.setItem('legacy',JSON.stringify([]));assert.throws(()=>writeProjectSchedule(s,'schedule',null,r.store,{key:'legacy',expected:r.legacyRaw}),/其他窗口/);assert.equal(s.getItem('schedule'),null);
 const raw=writeProjectSchedule(s,'schedule',null,r.store,{key:'legacy',expected:'[]'});assert.equal(readProjectSchedule(s,'schedule','legacy').raw,raw);assert.throws(()=>writeProjectSchedule(s,'schedule',null,emptyProjectSchedule()),/其他窗口/);
 assert.throws(()=>scheduleFromMilestones({}),/异常/);assert.throws(()=>readProjectSchedule({getItem:()=>'{bad'},'s','l'));
});
test('dates and drag operations respect leap days, UTC day math, inclusive duration and independent task fields',()=>{
 const t={...fixture().tasks[0],start:'2028-02-28',end:'2028-03-01',actualStart:'2028-02-28'};assert.equal(shiftScheduleDate('2028-02-28',1),'2028-02-29');assert.equal(shiftScheduleDate('2027-02-28',1),'2027-03-01');
 assert.deepEqual(moveProductionTask(t,2),{...t,start:'2028-03-01',end:'2028-03-03'});assert.equal(moveProductionTask(t,-1,'end').end,'2028-02-29');assert.deepEqual(moveProductionTask(t,5,'start'),t);assert.throws(()=>moveProductionTask({...t,start:''},2));
 for(const changes of [{start:'2026-02-30'},{end:'2026-09-01'},{actualStart:'2026-09-23',actualEnd:'2026-09-22'},{status:'done'},{references:[{kind:'invalid',targetId:'a'}]},{dependencyIds:['a','a']}])assert.throws(()=>validateProjectSchedule({...fixture(),tasks:[{...fixture().tasks[0],...changes}]}),/格式/);
});
test('dependencies, cycles, missed dates and milestone acceptance remain explicit without mutating content status',()=>{
 const s=fixture(),before=structuredClone(s);let issues=projectScheduleIssues(s,'2026-09-26');assert.ok(issues.some(i=>i.taskId==='b'&&i.kind==='blocked'));assert.ok(issues.some(i=>i.milestoneId==='m'&&i.kind==='overdue'));assert.deepEqual(s,before);
 s.tasks[0].status='已完成';s.tasks[0].result='已验证';assert.ok(!projectScheduleIssues(s,'2026-09-20').some(i=>i.taskId==='b'&&i.kind==='blocked'));
 s.tasks[1].start='2026-09-23';s.tasks[0].dependencyIds=['b'];assert.ok(projectScheduleIssues(s,'2026-09-20').some(i=>i.message.includes('循环')));assert.ok(projectScheduleIssues(s,'2026-09-20').some(i=>i.message.includes('重叠')));
 s.milestones[0].status='已验收';assert.ok(projectScheduleIssues(s,'2026-09-20').some(i=>i.milestoneId==='m'&&i.kind==='review'));
 assert.equal(removeProductionTask(s,'a').tasks[0].dependencyIds.length,0);assert.ok(removeProductionMilestone(s,'m').tasks.every(t=>t.milestoneId===''));assert.equal(s.tasks.length,2);
});
test('overview uses the same schedule milestones once saved and notices changed publication metadata',()=>{
 const s=memory(),project={id:'p',name:'原型',initialContent:'empty'},key='gamecreator.workspace.v1:p:';s.setItem(key+'milestones',JSON.stringify([{title:'旧目标',owner:'',due:'',status:'planned'}]));
 const store=fixture();s.setItem(key+'project-schedule',JSON.stringify(store));const view=readLocalOverview(s,project);assert.equal(view.milestones[0].title,'首个闭环');assert.equal(view.milestones[0].status,'planned');store.milestones[0].status='已验收';s.setItem(key+'project-schedule',JSON.stringify(store));assert.equal(readLocalOverview(s,project).milestones[0].status,'done');assert.notEqual(readLocalOverview(s,project).signature,view.signature);
});
test('full folder export/import preserves scheduling, actual dates and references; missing/invalid optional sections stay safe',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-schedule-package-'));
 try{
  const storage=createWorkspaceStorage(path.join(dir,'source')),api=createProjectPackages({dataDirectory:path.join(dir,'source'),storage});
  const example=JSON.parse(await fs.readFile(new URL('../examples/prototypes/hollow-knight.json',import.meta.url),'utf8')),p=preparePrototypeProject({schema:2,activeId:'',mode:'project',projects:[]},example,'排期原型');writePrototypeProject(storage,p);storage.setItem('gamecreator.projects.v1',JSON.stringify(p.catalog));
  let schedule={...fixture(),personnel:defaultAiTeam()};schedule=applyAssignments(schedule,suggestAssignments(schedule));schedule.tasks[0].references=[{kind:'gameplay',targetId:example.gameplay.designs[0].id},{kind:'capability',targetId:example.functionalSystems.capabilities[0].id},{kind:'requirement',targetId:example.artAssets.requirements[0].id},{kind:'asset',targetId:example.artAssets.assets[0].id},{kind:'map',targetId:example.mapDesign.maps[0].id},{kind:'prototype',targetId:example.prototypeDesign.scenes[0].id}];schedule.tasks[0].actualStart='2026-09-22';schedule.tasks[0].actualEnd='2026-09-24';
  const sources=buildScheduleSources(example.gameplay.designs,example.functionalSystems,example.artAssets,example.mapDesign,example.prototypeDesign),md=projectScheduleMarkdown(schedule,sources);assert.ok(md.includes('实际：2026-09-22 → 2026-09-24'));assert.ok(md.includes(example.gameplay.designs[0].title));
  const key='gamecreator.workspace.v1:'+p.project.id+':project-schedule';storage.setItem(key,JSON.stringify(schedule));const {issueAiCredential,verifyAiFeedback}=require('../desktop/ai-credentials.cjs'),{signFeedback}=require('../shared/ai-feedback-client.cjs');const member=schedule.personnel.members.find(m=>m.name==='程序A');const issued=issueAiCredential(storage,{projectId:p.project.id,memberId:member.id,name:'迁移验证',permissions:['progress'],expiresAt:new Date(Date.now()+86400000).toISOString(),schedule});schedule=JSON.parse(storage.getItem(key));const captured=captureProjectPackage(storage,p.project),folder=path.join(dir,'export');await api.exportFolder({projectId:p.project.id,directory:folder,...captured});
  const loaded=validateProjectPackage((await api.readFolder(folder)).document);assert.deepEqual(loaded.archives['project-schedule'],schedule);assert.deepEqual(loaded.archives.gameplay,example.gameplay);assert.deepEqual(loaded.archives['functional-systems'],example.functionalSystems);assert.deepEqual(loaded.archives['art-assets'],example.artAssets);
  const dest=memory(),copy=prepareProjectPackageImport(p.catalog,loaded,'恢复排期');writeProjectPackageImport(dest,copy);assert.deepEqual(JSON.parse(dest.getItem('gamecreator.workspace.v1:'+copy.project.id+':project-schedule')),schedule);
  assert.ok(!JSON.stringify(loaded).includes(issued.secret.privateKey));assert.notEqual(copy.project.id,p.project.id);const feedback=signFeedback({projectId:copy.project.id,target:{kind:'task',id:'a'},changes:{status:'进行中'}},{...issued.secret,projectId:copy.project.id});assert.throws(()=>verifyAiFeedback(feedback,copy.entries.map(e=>e.key.endsWith(':project-schedule')?JSON.parse(e.value):null).find(Boolean)),/令牌/);
  const legacy=structuredClone(captured.document);delete legacy.archives['project-schedule'];assert.deepEqual(validateProjectPackage(legacy).archives['project-schedule'],emptyProjectSchedule());
  const bad=structuredClone(captured.document);bad.archives['project-schedule'].tasks[0].end='invalid';assert.throws(()=>validateProjectPackage(bad),/排期/);await assert.rejects(api.exportFolder({projectId:p.project.id,directory:path.join(dir,'bad'),document:bad,expectedEntries:captured.expectedEntries}),/排期/);
  storage.setItem(key,JSON.stringify({...schedule,tasks:[]}));await assert.rejects(api.exportFolder({projectId:p.project.id,directory:path.join(dir,'stale'),...captured}),/变化/);
 }finally{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('gc-schedule-package-'));await fs.rm(dir,{recursive:true,force:true});}
});
