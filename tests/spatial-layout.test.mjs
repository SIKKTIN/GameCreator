import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createGameplay, duplicateGameplay, validateGameplay, readGameplay, writeGameplay } from '../src/gameplay.ts';
import { createStageObject, removeStageObject, stageIssues, stageMarkdown } from '../src/gameplay-stage.ts';
import { createRule } from '../src/gameplay-structure.ts';
import { createSpatialRoom, objectGeometry, spatialLayout, moveSpatialObject, removeSpatialRoom, spatialObjectReferences } from '../src/spatial-layout.ts';
import { preparePrototypeProject, writePrototypeProject } from '../src/prototype-import.ts';
import { captureProjectPackage, prepareProjectPackageImport, writeProjectPackageImport } from '../src/project-package.ts';
import { defaultCatalog } from '../src/project-catalog.ts';
const memory = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) }; };
function setup() {
  const d = createGameplay('空间'), external = createGameplay('外部房间');
  const a = createSpatialRoom(0), b = createSpatialRoom(1); b.sourceDesignId = external.id;
  const o = createStageObject('spawn', 2, 3); o.roomId = a.id; d.space.objects.push(o);
  const target = createStageObject('goal', 1, 1); external.space.objects.push(target);
  const rule = createRule(); d.conditionRules.push(rule);
  const c = { id: 'connection', name: '冲刺门', from: a.id, to: b.id, fromObjectId: o.id, toObjectId: target.id, direction: 'one', condition: '取得冲刺', ruleId: rule.id };
  d.space.spatial = { version: 1, view: 'rooms', rooms: [a, b], connections: [c] };
  return { d, external, a, b, o, target, c };
}
test('legacy archives render in grid without writes; continuous projection keeps IDs and subcell coordinates across view switches', () => {
  const d = createGameplay('旧网格'); d.space.cellSize = 2; const o = createStageObject('actor', 3, 4); d.space.objects.push(o);
  const storage = memory(), raw = JSON.stringify({ schema: 3, designs: [d] }); storage.setItem('k',raw);
  const read = readGameplay(storage,'k'); assert.equal(spatialLayout(read.store.designs[0].space).view,'grid'); assert.equal(storage.getItem('k'),raw);
  assert.equal(objectGeometry(o,d.space).x,6); const moved = moveSpatialObject(o,d.space,-3.125,1.375,false); assert.equal(moved.id,o.id);
  d.space.objects = [moved];
  for (const view of ['free','rooms','grid','free']) { d.space.spatial = {version:1,view,rooms:[],connections:[]}; validateGameplay({schema:3,designs:[d]}); assert.equal(objectGeometry(moved,d.space).x,-3.125); }
  const saved = writeGameplay(storage,'k',raw,{schema:3,designs:[d]}); assert.deepEqual(readGameplay(storage,'k').store.designs[0],d); assert.notEqual(saved,raw);
  assert.deepEqual(o.geometry,undefined);
});
test('snap is explicit, uses world units, and preserves legacy edge anchors until an intentional move', () => {
  const d=createGameplay('网格');d.space.cellSize=2;const o=createStageObject('spawn',2,3);o.anchor='right';
  assert.equal(objectGeometry(o,d.space).x,24);d.space.columns=20;assert.equal(objectGeometry(o,d.space).x,40);
  const moved=moveSpatialObject(o,d.space,5.3,3.7,true);assert.equal(moved.column,4);assert.equal(moved.row,3);assert.equal(moved.anchor,'cell');
  const free=moveSpatialObject(o,d.space,-2.125,8.875,false), snapped=moveSpatialObject(free,d.space,-2.125,8.875,true);
  assert.equal(snapped.geometry.x,-2);assert.equal(snapped.geometry.y,8);assert.equal(free.geometry.x,-2.125);
});
test('malformed new geometry, schema, IDs and connections fail closed while missing design references remain repairable', () => {
  const {d,external,o}=setup();o.geometry=objectGeometry(o,d.space);
  for(const mutate of [x=>x.space.spatial.version=2,x=>x.space.spatial.view='3d',x=>x.space.spatial.rooms=null,x=>x.space.spatial.rooms.push(x.space.spatial.rooms[0]),x=>x.space.spatial.connections[0].direction='bad',x=>x.space.objects[0].geometry.x=NaN,x=>x.space.objects[0].geometry.height=0,x=>x.space.objects[0].geometry.innerRange=1e9]){
    const copy=structuredClone(d);mutate(copy);assert.throws(()=>validateGameplay({schema:3,designs:[copy]}));
  }
  assert.deepEqual(stageIssues(d,[d,external]),[]);d.space.spatial.rooms[1].sourceDesignId='missing';validateGameplay({schema:3,designs:[d]});assert.ok(stageIssues(d,[d]).some(x=>x.includes('来源玩法已失效')));
});
test('copy remaps room memberships, local ports, condition rules and connections but preserves external source ports', () => {
  const {d,external,o,target}=setup();o.geometry=objectGeometry(o,d.space);const copy=duplicateGameplay(d),c=copy.space.spatial.connections[0];
  assert.notEqual(copy.space.objects[0].id,o.id);assert.equal(copy.space.objects[0].roomId,copy.space.spatial.rooms[0].id);assert.equal(c.fromObjectId,copy.space.objects[0].id);assert.equal(c.toObjectId,target.id);assert.equal(c.ruleId,copy.conditionRules[0].id);assert.notEqual(c.ruleId,d.conditionRules[0].id);
  assert.deepEqual(stageIssues(copy,[copy,external]),[]);copy.space.objects[0].geometry.x=99;assert.notEqual(o.geometry.x,99);
});
test('deletion protects internal objects, room connections and cross-design ports even from archived owners', () => {
  const {d,external,a,o,target}=setup();assert.throws(()=>removeSpatialRoom(d.space,a.id),/房间仍被使用/);assert.throws(()=>removeStageObject(d,[d,external],o.id),/冲刺门/);
  d.archived=true;assert.equal(spatialObjectReferences(external,[external,d],target.id).length,1);assert.throws(()=>removeStageObject(external,[external,d],target.id),/冲刺门/);
  d.space.spatial.connections=[];d.space.objects=[];assert.equal(removeSpatialRoom(d.space,a.id).spatial.rooms.length,1);
});
test('room graph arrangement never changes physical coordinates; exports include ports, units, ranges and conditions', () => {
  const {d,external,o}=setup();o.geometry={...objectGeometry(o,d.space),range:26,innerRange:20,arc:70,rotation:25};o.rangeShape='ring';
  const before=structuredClone(o);d.space.spatial.rooms[0].x=1200;assert.deepEqual(o,before);
  const text=stageMarkdown(d,[d,external]);for(const phrase of ['房间连接','冲刺门','取得冲刺','ring 20–26','角度 25','出口：'+o.id])assert.ok(text.includes(phrase),phrase);
});
for(const name of ['plants-vs-zombies','hollow-knight','stardew-valley','disco-elysium','vampire-survivors'])test(name+': complete spatial archives round trip with every room, geometry and reference intact',async()=>{
  const example=JSON.parse(await fs.readFile(new URL('../examples/prototypes/'+name+'.json',import.meta.url),'utf8'));
  const cfg={engine:'oasis-lua',projectPath:'',enumPath:'Script/Const',dataPath:'Script/Config',outputFormat:'lua',autoSync:false,backupBeforeSync:true};const catalog=defaultCatalog({...cfg,projectPath:'E:/QA/spatial'},'原型');
  const prepared=preparePrototypeProject(catalog,example,'空间验收'),storage=memory();writePrototypeProject(storage,prepared);
  const doc=captureProjectPackage(storage,prepared.project).document, imported=prepareProjectPackageImport(catalog,doc,'空间副本'),target=memory();writeProjectPackageImport(target,imported);
  assert.deepEqual(JSON.parse(target.getItem('gamecreator.workspace.v1:'+imported.project.id+':gameplay')),example.gameplay);
  for(const d of example.gameplay.designs) assert.deepEqual(stageIssues(d,example.gameplay.designs),[]);
  if(name==='plants-vs-zombies') assert.ok(example.gameplay.designs.every(d=>spatialLayout(d.space).view==='grid'));
  if(name==='hollow-knight') assert.equal(example.gameplay.designs[0].space.spatial.connections.length,8);
  if(name==='vampire-survivors'){const s=example.gameplay.designs.find(d=>d.id==='vs-play-movement').space;assert.ok(s.objects.some(o=>o.rangeShape==='ring'&&o.geometry.innerRange===20&&o.geometry.range===26));assert.ok(s.objects.some(o=>o.geometry.x<0));}
});
