import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { emptyMapDesign, createDesignMap, validateMapDesign, mapIssues, mapStage, mapObjectReferences, removeDesignMap, removeMapObject, readMapDesign, writeMapDesign, mapMarkdown } from '../src/map-design.ts';
import { prototypeFromMaps, prototypeIssues, prototypeGeometry, applyPrototypeAction, startPrototype } from '../src/prototype-design.ts';
import { defaultCatalog } from '../src/project-catalog.ts';
import { preparePrototypeProject, writePrototypeProject, validatePrototypeExample } from '../src/prototype-import.ts';
import { captureProjectPackage, validateProjectPackage, prepareProjectPackageImport, writeProjectPackageImport } from '../src/project-package.ts';
const example=async file=>JSON.parse(await fs.readFile(new URL('../examples/prototypes/'+file+'.json',import.meta.url),'utf8'));
const storage=()=>{const values=new Map();return {values,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};};
const config={engine:'oasis-lua',projectPath:'E:/Example/Map',enumPath:'Script/Const',dataPath:'Script/Config',outputFormat:'lua',autoSync:false,backupBeforeSync:true};
const catalog=defaultCatalog(config,'原项目'),key=id=>'gamecreator.workspace.v1:'+id+':map-design';
for(const file of ['hollow-knight','stardew-valley'])test(file+': live spatial references, all routes and conditions, layering and disabled data survive transfer',async()=>{
  const e=await example(file),before=JSON.stringify(e),maps=validateMapDesign(e.mapDesign),designs=e.gameplay.designs;
  assert.equal(maps.enabled,true);assert.deepEqual(mapIssues(maps,designs),[]);
  const scenes=prototypeFromMaps(maps,designs),store={schema:1,entryId:scenes[0].id,scenes};
  assert.deepEqual(prototypeIssues(store,designs,e.gameplayCore,e.artAssets,maps),[]);
  assert.equal(scenes.length,maps.maps.length);
  for(const c of maps.connections){const scene=scenes.find(s=>s.mapId===c.from),button=scene.elements.find(b=>b.name===c.name&&b.sourceObjectId===c.fromObjectId);assert.ok(button);assert.equal(button.action.condition,c.condition);if(c.condition)assert.throws(()=>applyPrototypeAction(store,startPrototype(store,scene.id),button.id),/条件/);assert.equal(applyPrototypeAction(store,startPrototype(store,scene.id),button.id,true).sceneId,scenes.find(s=>s.mapId===c.to).id);assert.throws(()=>removeDesignMap(maps,c.from));}
  const m=maps.maps[0],source=designs.find(d=>d.id===m.sourceDesignId),obj=source.space.objects[0];
  const old=prototypeGeometry(scenes[0],designs,maps).objects.find(o=>o.object.id===obj.id);
  const changed=structuredClone(designs);changed.find(d=>d.id===source.id).space.objects[0].geometry={x:100,y:200,width:2,height:3,rotation:0,shape:'rect',range:0,innerRange:0,arc:90};
  assert.equal(mapStage(m,changed).objects.find(o=>o.id===obj.id).geometry.x,100);assert.notDeepEqual(prototypeGeometry(scenes[0],changed,maps).objects.find(o=>o.object.id===obj.id),old);assert.ok(!m.objects.some(o=>o.id===obj.id));
  const hidden={...m,sourceVisible:false,layers:m.layers.map(l=>({...l,visible:false}))};assert.equal(mapStage(hidden,designs,true).objects.length,0);assert.ok(mapStage(hidden,designs).objects.length>0);
  const c=maps.connections[0],owner=designs.find(d=>d.id===maps.maps.find(m=>m.id===c.from).sourceDesignId);assert.ok(mapObjectReferences(maps,designs,owner.id,c.fromObjectId).length);
  const memory=storage(),a=preparePrototypeProject(catalog,e,'地图A'),b=preparePrototypeProject(catalog,e,'地图B');writePrototypeProject(memory,a);writePrototypeProject(memory,b);
  const disabled={...maps,enabled:false};writeMapDesign(memory,key(a.project.id),memory.getItem(key(a.project.id)),disabled);assert.equal(JSON.parse(memory.getItem(key(b.project.id))).enabled,true);
  const snapshot=captureProjectPackage(memory,a.project);assert.deepEqual(snapshot.document.archives['map-design'],disabled);const restored=prepareProjectPackageImport(catalog,snapshot.document,'复原');writeProjectPackageImport(memory,restored);assert.deepEqual(JSON.parse(memory.getItem(key(restored.project.id))),disabled);
  assert.ok(mapMarkdown(maps,designs).includes(m.name));assert.equal(mapMarkdown(disabled,designs),'');assert.equal(JSON.stringify(e),before);
});
test('generic native maps protect layer/portal references, reject malformed archives and preserve failed writes',()=>{
  const a=createDesignMap('空间站'),b=createDesignMap('轨道仓库');a.objects=[{id:'airlock',name:'气闸',kind:'portal',layerId:a.layers[0].id,x:2,y:3,width:1,height:2,color:'blue',notes:'',references:[]}];b.objects=[{...a.objects[0],id:'arrival',layerId:b.layers[0].id}];const maps={schema:1,enabled:true,maps:[a,b],connections:[{id:'route',name:'对接桥',from:a.id,to:b.id,fromObjectId:'airlock',toObjectId:'arrival',direction:'both',kind:'door',condition:'气压已平衡'}]};
  assert.deepEqual(mapIssues(validateMapDesign(maps),[]),[]);assert.throws(()=>removeMapObject(maps,a.id,'airlock'));assert.throws(()=>removeDesignMap({...maps,connections:[]},a.id,['场景']));assert.throws(()=>removeMapObject({...maps,connections:[]},a.id,'airlock',['热点']));
  for(const mutate of [s=>s.enabled='yes',s=>s.maps[0].rows=1.2,s=>s.maps[0].objects[0].x=Infinity,s=>s.maps[0].objects[0].width=0,s=>s.maps[0].layers=[],s=>s.maps[1].id=s.maps[0].id,s=>s.connections[0].direction='bad']){const bad=structuredClone(maps);mutate(bad);assert.throws(()=>validateMapDesign(bad));}
  const draft=structuredClone(maps);draft.maps[0].objects[0].layerId='missing';validateMapDesign(draft);assert.ok(mapIssues(draft,[]).length);
  const memory=storage();assert.deepEqual(readMapDesign(memory,'key').store,emptyMapDesign());assert.equal(memory.values.size,0);const raw=writeMapDesign(memory,'key',null,maps);assert.throws(()=>writeMapDesign(memory,'key',null,emptyMapDesign()),/其他窗口/);assert.equal(memory.getItem('key'),raw);assert.throws(()=>writeMapDesign({...memory,setItem(){throw new Error('disk full');}},'key',raw,emptyMapDesign()));assert.equal(memory.getItem('key'),raw);memory.setItem('key','{broken');assert.throws(()=>readMapDesign(memory,'key'));
});
test('old project archives remain opt-in; desktop folder boundary validates and detects concurrent map changes',async t=>{
  const {createProjectPackages}=createRequire(import.meta.url)('../desktop/project-package.cjs'),e=await example('stardew-valley'),old=structuredClone(e);delete old.mapDesign;validatePrototypeExample(old);const memory=storage(),a=preparePrototypeProject(catalog,old,'旧项目');writePrototypeProject(memory,a);assert.deepEqual(JSON.parse(memory.getItem(key(a.project.id))),emptyMapDesign());
  const doc=captureProjectPackage(memory,a.project).document;delete doc.archives['map-design'];assert.deepEqual(validateProjectPackage(doc).archives['map-design'],emptyMapDesign());
  const prepared=preparePrototypeProject(catalog,e,'地图包');writePrototypeProject(memory,prepared);memory.setItem('gamecreator.projects.v1',JSON.stringify(prepared.catalog));const snapshot=captureProjectPackage(memory,prepared.project);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-map-package-'));t.after(async()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));await fs.rm(dir,{recursive:true,force:true});});
  const service=createProjectPackages({dataDirectory:path.join(dir,'data'),storage:memory}),args={directory:path.join(dir,'package'),projectId:prepared.project.id,...snapshot};await service.exportFolder(args);const read=await service.readFolder(args.directory);assert.deepEqual(read.document.archives['map-design'],e.mapDesign);
  const raw=memory.getItem(key(prepared.project.id));memory.setItem(key(prepared.project.id),JSON.stringify({...e.mapDesign,enabled:false}));await assert.rejects(service.exportFolder({...args,directory:path.join(dir,'conflict')}));memory.setItem(key(prepared.project.id),raw);
  for(const mutate of [m=>m.maps[0].objects[0].x='bad',m=>m.connections[0].direction='sideways',m=>m.maps[0].layers=[]]){const bad=structuredClone(snapshot.document);mutate(bad.archives['map-design']);await assert.rejects(service.exportFolder({...args,document:bad,directory:path.join(dir,crypto.randomUUID())}));assert.throws(()=>validateProjectPackage(bad));}
});
