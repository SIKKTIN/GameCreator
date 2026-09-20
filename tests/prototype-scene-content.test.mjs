import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { buildPrototypeScenes } from '../scripts/build-prototype-scenes.mjs';
import { validatePrototypeExample, preparePrototypeProject, writePrototypeProject } from '../src/prototype-import.ts';
import { validatePrototypeDesign, prototypeIssues, startPrototype, applyPrototypeAction } from '../src/prototype-design.ts';
import { captureProjectPackage, prepareProjectPackageImport, writeProjectPackageImport } from '../src/project-package.ts';
import { defaultCatalog } from '../src/project-catalog.ts';
const config={engine:'oasis-lua',projectPath:'E:/QA/Existing',enumPath:'Script/Const',dataPath:'Script/Config',outputFormat:'lua',autoSync:false,backupBeforeSync:true};
const cases=[['plants-vs-zombies','pvz',17,['select','field','boss','complete','endless','garden','defeat']],['stardew-valley','farm',19,['farm','village','field','night','goals','fishing','mine']],['hollow-knight','hk',15,['A','B','C','D','dash','death','shade','victory']],['disco-elysium','de',31,['hotel','yard','pier','archive','clinic','white-fail','red-fail','truth','wrong','pause-ending']],['vampire-survivors','vs',24,['character','field','level','evolution','died','quit','settlement-win','meta']]];
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};};
for(const [slug,prefix,count,required] of cases)test(slug+': authored scenes are deterministic, traversable and survive import/export',async()=>{
 const example=JSON.parse(await fs.readFile(new URL('../examples/prototypes/'+slug+'.json',import.meta.url),'utf8')),before=JSON.stringify(example);validatePrototypeExample(example);
 const store=example.prototypeDesign;assert.equal(store.scenes.length,count);assert.deepEqual(store,buildPrototypeScenes(slug,example));assert.equal(JSON.stringify(example),before);validatePrototypeDesign(store);assert.deepEqual(prototypeIssues(store,example.gameplay.designs,example.gameplayCore,example.artAssets),[]);
 const byId=new Map(store.scenes.map(s=>[s.id,s]));for(const key of required)assert.ok(byId.has(prefix+'-proto-'+key),key);
 const reached=new Set(),queue=[store.entryId];while(queue.length){const id=queue.shift();if(reached.has(id))continue;reached.add(id);const s=byId.get(id);assert.ok(s);for(const e of s.elements){assert.ok(e.x>=0&&e.y>=0&&e.x+e.width<=s.width+1&&e.y+e.height<=s.height+1,'element fits frame: '+s.name+'/'+e.name);if(e.action.kind==='scene'){if(e.action.condition)assert.throws(()=>applyPrototypeAction(store,startPrototype(store,id),e.id),/条件/);const next=applyPrototypeAction(store,startPrototype(store,id),e.id,true);assert.equal(next.sceneId,e.action.targetId);queue.push(next.sceneId);}}}
 assert.equal(reached.size,store.scenes.length,'every scene reachable from main menu');
 for(const start of store.scenes){const seen=new Set(),todo=[start.id];while(todo.length){const next=todo.shift();if(seen.has(next))continue;seen.add(next);for(const e of byId.get(next).elements)if(e.action.kind==='scene')todo.push(e.action.targetId);}assert.ok(seen.has(store.entryId),'scene has route back to main menu: '+start.name);}
 assert.ok(store.scenes.some(s=>s.sourceDesignId));assert.ok(store.scenes.some(s=>s.elements.some(e=>e.sourceObjectId)));assert.ok(store.scenes.every(s=>s.coreNodeId));assert.ok(store.scenes.flatMap(s=>s.elements).every(e=>!e.assetId),'do not invent asset deliveries');
 const catalog=defaultCatalog(config,'已有项目'),p=preparePrototypeProject(catalog,example,'可点击副本'),storage=memory();writePrototypeProject(storage,p);const key='gamecreator.workspace.v1:'+p.project.id+':prototype-design';assert.deepEqual(JSON.parse(storage.getItem(key)),store);
 const snapshot=captureProjectPackage(storage,p.project),prepared=prepareProjectPackageImport(catalog,snapshot.document,'迁移副本'),target=memory();writeProjectPackageImport(target,prepared);assert.deepEqual(JSON.parse(target.getItem('gamecreator.workspace.v1:'+prepared.project.id+':prototype-design')),store);
 const runtime=startPrototype(store),first=byId.get(runtime.sceneId).elements.find(e=>e.action.kind==='scene');applyPrototypeAction(store,runtime,first.id,true);assert.deepEqual(runtime,startPrototype(store));assert.equal(JSON.stringify(example),before);
});
test('sample names and ending rules stay aligned with authored data',async()=>{
 const load=async name=>JSON.parse(await fs.readFile(new URL('../examples/prototypes/'+name+'.json',import.meta.url),'utf8'));
 const vs=await load('vampire-survivors'),text=vs.prototypeDesign.scenes.flatMap(s=>s.elements.map(e=>e.text)).join('\n');for(const id of ['blood_whip','holy_wand','unholy_book'])assert.ok(text.includes(vs.data.datasets.vs_weapons.find(w=>w.id===id).name));assert.match(text,/无需击杀终场敌人/);
 const de=await load('disco-elysium'),deText=de.prototypeDesign.scenes.flatMap(s=>s.elements.map(e=>e.text)).join('\n');assert.ok(deText.includes(de.data.datasets.de_thoughts.find(t=>t.id==='worker').name));assert.match(deText,/本次红检定不能重试/);assert.match(deText,/断绳.*账册或复写件.*证词或维修便条/);
});
