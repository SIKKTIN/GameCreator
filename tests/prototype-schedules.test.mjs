import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validatePrototypeExample, preparePrototypeProject, writePrototypeProject } from '../src/prototype-import.ts';
import { defaultCatalog } from '../src/project-catalog.ts';
import { buildScheduleSources, projectScheduleIssues } from '../src/project-schedule.ts';
import { captureProjectPackage, prepareProjectPackageImport, writeProjectPackageImport } from '../src/project-package.ts';
const expected = {'plants-vs-zombies':[12,3], 'stardew-valley':[14,4], 'hollow-knight':[16,5], 'disco-elysium':[17,5], 'vampire-survivors':[14,4]};
const catalog=defaultCatalog({engine:'oasis-lua',projectPath:'E:/Existing/Game',enumPath:'Script/Const',dataPath:'Private/Data',outputFormat:'lua',autoSync:false,backupBeforeSync:true},'Existing');
const memory=()=>{const entries=new Map();return {getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v)};};
for(const [slug,counts] of Object.entries(expected))test(slug+': complete schedule, feasible dependencies and portable round trip',()=>{
 const e=validatePrototypeExample(JSON.parse(fs.readFileSync(new URL('../examples/prototypes/'+slug+'.json',import.meta.url),'utf8'))),s=e.projectSchedule;
 assert.deepEqual([s.tasks.length,s.milestones.length],counts);
 const sources=buildScheduleSources(e.gameplay.designs,e.functionalSystems,e.artAssets,e.mapDesign??{schema:1,enabled:false,maps:[]},e.prototypeDesign);
 assert.deepEqual(projectScheduleIssues(s,'2026-09-20',sources).filter(i=>i.kind!=='blocked'),[]);
 const refs=new Set(s.tasks.flatMap(t=>t.references.map(r=>r.kind+':'+r.targetId)));
 for(const kind of ['gameplay','capability','requirement','prototype'])for(const item of sources[kind])assert.ok(refs.has(kind+':'+item.id),`${kind}: ${item.name} must have planned work`);
 for(const t of s.tasks){
  assert.ok(t.start&&t.end&&t.acceptance&&t.description&&t.references.length&&t.milestoneId);
  assert.equal(t.status,'待开始');assert.equal(t.owner+t.actualStart+t.actualEnd+t.result,'');
  for(const d of t.dependencyIds)assert.ok(s.tasks.find(p=>p.id===d).end<t.start,'dependencies finish before next task starts');
 }
 for(const m of s.milestones){assert.ok(m.acceptance&&m.description.includes('未计法定假期'));assert.ok(s.tasks.some(t=>t.milestoneId===m.id));}
 for(let d=new Date('2026-09-21T00:00:00Z');d<=new Date(s.milestones.at(-1).due+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1)){
  const day=d.toISOString().slice(0,10),active=s.tasks.filter(t=>t.start<=day&&t.end>=day);
  if([0,6].includes(d.getUTCDay()))continue;
  assert.ok(active.filter(t=>t.kind==='程序').length<=2,'two-programmer baseline');
  assert.ok(active.filter(t=>t.kind==='美术').length<=1,'one-art-role baseline');
 }
 const storage=memory(),prepared=preparePrototypeProject(catalog,e,'Scheduled');writePrototypeProject(storage,prepared);
 const key='gamecreator.workspace.v1:'+prepared.project.id+':project-schedule';assert.deepEqual(JSON.parse(storage.getItem(key)),s);
 const captured=captureProjectPackage(storage,prepared.project);
 assert.deepEqual(captured.document.archives['project-schedule'],s);
 const imported=prepareProjectPackageImport(prepared.catalog,captured.document,'Transferred');writeProjectPackageImport(storage,imported);
 assert.deepEqual(JSON.parse(storage.getItem('gamecreator.workspace.v1:'+imported.project.id+':project-schedule')),s);
 const legacy=structuredClone(e);delete legacy.projectSchedule;assert.ok(validatePrototypeExample(legacy));
 assert.deepEqual(JSON.parse(preparePrototypeProject(catalog,legacy,'Old template').entries.find(x=>x.key.endsWith(':project-schedule')).value),{schema:1,tasks:[],milestones:[]});
 for(const malformed of [null,false,{},[]])assert.throws(()=>validatePrototypeExample({...e,projectSchedule:malformed}));
 const invalid=structuredClone(e);invalid.projectSchedule.tasks[0].references.push({kind:'gameplay',targetId:'missing'});assert.throws(()=>validatePrototypeExample(invalid),/项目排期/);
 const badDate=structuredClone(e);badDate.projectSchedule.tasks[1].start=badDate.projectSchedule.tasks[0].start;assert.throws(()=>validatePrototypeExample(badDate),/项目排期/);
});
