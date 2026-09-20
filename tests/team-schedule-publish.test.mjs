import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readLocalSchedule} from '../src/team-schedule-publish.ts';
import {readPublicationPreview,assertPublicationCurrent} from '../src/team-publish.ts';
const project={id:'schedule-source',name:'测试项目',initialContent:'empty'},prefix='gamecreator.workspace.v1:schedule-source:';
for(const name of ['plants-vs-zombies','hollow-knight','stardew-valley','disco-elysium','vampire-survivors'])test(name+': publication preserves full schedule, IDs and source names without modifying local archives',async()=>{
  const example=JSON.parse(await fs.readFile(new URL('../examples/prototypes/'+name+'.json',import.meta.url),'utf8'));
  const data=new Map(Object.entries({'project-schedule':example.projectSchedule,gameplay:example.gameplay,'functional-systems':example.functionalSystems,'art-assets':example.artAssets,'map-design':example.mapDesign,'prototype-design':example.prototypeDesign}).filter(([,value])=>value!==undefined).map(([k,v])=>[prefix+k,JSON.stringify(v)]));
  const storage={getItem:key=>data.get(key)??null},before=[...data],preview=readLocalSchedule(storage,project);
  assert.deepEqual(preview.schedule.store,example.projectSchedule);assert.deepEqual([...data],before);
  assert.ok(preview.schedule.references.length>0);assert.ok(preview.schedule.references.every(r=>r.name&&!r.name.startsWith('来源内容 ')));
  const full=readPublicationPreview(storage,project);assert.deepEqual(full.schedule.store,example.projectSchedule);
  const changed=structuredClone(example.projectSchedule);changed.tasks[0].actualStart='2026-09-20';data.set(prefix+'project-schedule',JSON.stringify(changed));assert.throws(()=>assertPublicationCurrent(storage,project,full),/本地项目已变化/);
});
test('legacy milestones retain non-date notes, and corrupt schedule content stops publication',()=>{
  const data=new Map([[prefix+'milestones',JSON.stringify([{title:'原里程碑',owner:'负责人',due:'预计明年',status:'active'}])]]),storage={getItem:key=>data.get(key)??null};
  const a=readLocalSchedule(storage,project),b=readLocalSchedule(storage,project);assert.deepEqual(a,b);assert.equal(a.schedule.store.milestones[0].due,'');assert.ok(a.schedule.store.milestones[0].description.includes('预计明年'));
  data.set(prefix+'project-schedule','{broken');assert.throws(()=>readPublicationPreview(storage,project));assert.equal(data.get(prefix+'project-schedule'),'{broken');
});
