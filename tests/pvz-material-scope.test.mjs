import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {reviewPvzMaterials,pvzUnitDeliveries} from '../scripts/review-pvz-materials.mjs';
import {validateArtAssets,validateArtMutation} from '../src/art-assets.ts';
import {artLibrary,assignArtCategory,saveArtCategory} from '../src/art-library.ts';
import {validatePrototypeExample,preparePrototypeProject,writePrototypeProject} from '../src/prototype-import.ts';
import {captureProjectPackage,prepareProjectPackageImport,writeProjectPackageImport} from '../src/project-package.ts';
const example=JSON.parse(fs.readFileSync(new URL('../examples/prototypes/plants-vs-zombies.json',import.meta.url),'utf8'));
function legacy(){const s=structuredClone(example.artAssets);delete s.library;s.assets=s.assets.filter(a=>!pvzUnitDeliveries.some(u=>a.id==='pvz-art-asset-'+u.key+'-design'));s.links=s.links.filter(l=>s.assets.some(a=>a.id===l.assetId));for(const r of s.requirements){r.specification=r.specification.split('\n\n【本版角色交付补充】')[0];if(r.generationPrompt)r.generationPrompt.prompt=r.generationPrompt.prompt.split('\n\n【本版角色交付补充】')[0];}return s;}
test('the scoped prototype exposes all three plants and both enemies, with every delivery categorized',()=>{
 validatePrototypeExample(example);const a=example.artAssets,lib=artLibrary(a),names=folder=>a.requirements.filter(r=>lib.requirements[r.id]===lib.categories.find(c=>c.name===folder).id).map(r=>r.id);
 assert.deepEqual(names('角色'),['sunflower','peashooter','wallnut'].map(s=>'pvz-art-req-'+s));assert.deepEqual(names('敌人与首领'),['normal-zombie','cone-zombie'].map(s=>'pvz-art-req-'+s));
 assert.equal(a.requirements.length,20);assert.equal(a.assets.length,37);assert.equal(a.links.length,55);
 assert.ok(a.assets.every(item=>lib.assets[item.id]&&item.versions.length===0&&!item.adoptedVersionId));
 assert.equal(example.data.datasets.pvz_plants.length,3);assert.equal(example.data.datasets.pvz_zombies.length,2);
 for(const u of pvzUnitDeliveries){const r=a.requirements.find(r=>r.id==='pvz-art-req-'+u.key),asset=a.assets.find(a=>a.id==='pvz-art-asset-'+u.key+'-design');assert.ok(asset);assert.ok(a.links.some(l=>l.requirementId===r.id&&l.assetId===asset.id));assert.ok(r.specification.includes(asset.name));assert.ok(r.generationPrompt.prompt.includes(asset.name));}
 const zombie=a.assets.filter(a=>a.id==='pvz-art-asset-zombie-motion');assert.equal(zombie.length,1);for(const r of ['normal-zombie','cone-zombie'])assert.ok(a.links.some(l=>l.requirementId==='pvz-art-req-'+r&&l.assetId===zombie[0].id));
});
test('explicit review is idempotent and preserves prior IDs, links, versions, authored text and references',()=>{
 const before=legacy();before.requirements.find(r=>r.id==='pvz-art-req-peashooter').specification+='\n用户保留的枪口规范';const asset=before.assets[0];asset.versions=[{id:'custom',name:'占位规范',notes:'用户文件',placeholder:true,review:'待审核',feedback:'',files:[{id:'file',name:'guide.png',size:1,mime:'image/png',storagePath:'file.png'}],createdAt:asset.createdAt}];asset.adoptedVersionId='custom';
 const untouched=structuredClone(before),r=reviewPvzMaterials(before,'2026-09-21T02:00:00.000Z');assert.deepEqual(before,untouched);assert.equal(r.added.length,5);assert.equal(r.updated.length,5);validateArtMutation(before,r.store);
 for(const old of before.assets)assert.deepEqual(r.store.assets.find(a=>a.id===old.id),old);for(const old of before.links)assert.deepEqual(r.store.links.find(l=>l.id===old.id),old);
 for(const old of before.requirements){const next=r.store.requirements.find(x=>x.id===old.id);assert.ok(next.specification.startsWith(old.specification));assert.deepEqual(next.sources,old.sources);assert.equal(next.status,old.status);assert.equal(next.owner,old.owner);if(old.generationPrompt)assert.ok(next.generationPrompt.prompt.startsWith(old.generationPrompt.prompt));}
 const repeat=reviewPvzMaterials(r.store,'2030-01-01T00:00:00.000Z');assert.deepEqual(repeat.store,r.store);assert.deepEqual(repeat.added,[]);assert.deepEqual(repeat.updated,[]);assert.deepEqual(repeat.moved,[]);
});
test('custom categories and archived content survive explicit review',()=>{
 let before=legacy();before=saveArtCategory(before,'我的植物','个人分类');const id=before.library.categories.at(-1).id;before=assignArtCategory(before,'requirement','pvz-art-req-sunflower',id);before=assignArtCategory(before,'asset','pvz-art-asset-sunflower-motion','');const archived=before.requirements.find(r=>r.id==='pvz-art-req-wallnut');archived.archived=true;
 const r=reviewPvzMaterials(before);assert.equal(r.store.library.requirements['pvz-art-req-sunflower'],id);assert.equal(r.store.library.assets['pvz-art-asset-sunflower-motion'],'');assert.deepEqual(r.store.requirements.find(x=>x.id===archived.id),archived);assert.ok(!r.store.assets.some(a=>a.id==='pvz-art-asset-wallnut-design'));validateArtAssets(r.store);
});
test('revised material folders and all links travel with an independent project copy',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},catalog={schema:2,activeId:'',mode:'project',projects:[]};const first=preparePrototypeProject(catalog,example,'PVZ素材范围');writePrototypeProject(storage,first);const pkg=captureProjectPackage(storage,first.project);const second=prepareProjectPackageImport(first.catalog,pkg.document,'素材副本');writeProjectPackageImport(storage,second);assert.deepEqual(JSON.parse(storage.getItem('gamecreator.workspace.v1:'+second.project.id+':art-assets')),example.artAssets);
 assert.deepEqual(pkg.document.archives.gameplay,example.gameplay);assert.deepEqual(pkg.document.archives['prototype-design'],example.prototypeDesign);assert.deepEqual(pkg.document.archives['numerical-analysis'],example.numericalAnalysis);
});
