import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {artLibrary,artCategoryId,saveArtCategory,assignArtCategory,removeArtCategory,moveArtCategory} from '../src/art-library.ts';
import {emptyArtAssets,createArtRequirement,createArtAsset,validateArtAssets,validateArtMutation,readArtAssets,writeArtAssets} from '../src/art-assets.ts';
import {preparePrototypeProject,writePrototypeProject} from '../src/prototype-import.ts';
import {captureProjectPackage,prepareProjectPackageImport,writeProjectPackageImport} from '../src/project-package.ts';
const example=JSON.parse(fs.readFileSync(new URL('../examples/prototypes/hollow-knight.json',import.meta.url),'utf8'));
const memory=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};};
test('legacy art categories are deterministic, read-only and shared assets remain unclassified',()=>{
 const s=structuredClone(example.artAssets),before=structuredClone(s),library=artLibrary(s);assert.deepEqual(artLibrary(s),library);assert.deepEqual(s,before);assert.equal(s.library,undefined);
 for(const a of s.assets){const ids=new Set(s.links.filter(l=>l.assetId===a.id).map(l=>library.requirements[l.requirementId]));if(ids.size>1)assert.equal(library.assets[a.id],'');}
 const storage=memory(),raw=JSON.stringify(s);storage.setItem('art',raw);artLibrary(readArtAssets(storage,'art').store);assert.equal(storage.getItem('art'),raw);
 const boss=s.requirements.find(r=>r.name.includes('遗壳守卫'));assert.equal(library.categories.find(c=>c.id===library.requirements[boss.id]).name,boss.category==='角色'?'敌人与首领':boss.category);
});
test('category CRUD, reordering and archived-item organization preserve content and version history',()=>{
 const original=structuredClone(example.artAssets);original.requirements[0].archived=true;original.assets[0].archived=true;
 let s=saveArtCategory(original,'共享界面','HUD 与菜单');const id=s.library.categories.at(-1).id;
 s=assignArtCategory(s,'requirement',s.requirements[0].id,id);s=assignArtCategory(s,'asset',s.assets[0].id,id);assert.doesNotThrow(()=>validateArtMutation(original,s));
 s=saveArtCategory(s,'通用界面','共用 HUD',id);s=moveArtCategory(s,id,-1);assert.equal(s.library.categories.at(-2).id,id);
 const after=removeArtCategory(s,id);assert.equal(artCategoryId(artLibrary(after),'requirement',s.requirements[0].id),'');assert.equal(artCategoryId(artLibrary(after),'asset',s.assets[0].id),'');
 const {library,...content}=after;assert.deepEqual(content,original);assert.doesNotThrow(()=>validateArtAssets(after));
 assert.throws(()=>saveArtCategory(s,'角色',''),/同名/);assert.throws(()=>saveArtCategory(s,'未分类',''),/保留/);assert.throws(()=>assignArtCategory(s,'asset','missing',''),/不存在/);
 for(const bad of [null,{}, {categories:[],requirements:{missing:'oops'},assets:{}}, {categories:[{id:'x',name:'X',description:''},{id:'x',name:'Y',description:''}],requirements:{},assets:{}}])assert.throws(()=>validateArtAssets({...s,library:bad}),/分类/);
});
test('folder package capture and import preserve manual categories and edits guard stale writes',()=>{
 const storage=memory(),catalog={schema:2,activeId:'',mode:'project',projects:[]};const prepared=preparePrototypeProject(catalog,example,'分类原型');writePrototypeProject(storage,prepared);
 const key='gamecreator.workspace.v1:'+prepared.project.id+':art-assets',raw=storage.getItem(key);let next=saveArtCategory(JSON.parse(raw),'自定义交付','按用途归类');next=assignArtCategory(next,'requirement',next.requirements[0].id,next.library.categories.at(-1).id);
 writeArtAssets(storage,key,raw,next);assert.throws(()=>writeArtAssets(storage,key,raw,next),/其他窗口/);
 const pkg=captureProjectPackage(storage,prepared.project);const restored=prepareProjectPackageImport(prepared.catalog,pkg.document,'还原分类');writeProjectPackageImport(storage,restored);assert.deepEqual(JSON.parse(storage.getItem('gamecreator.workspace.v1:'+restored.project.id+':art-assets')),next);
});
test('new items can be assigned independently and removing one category never changes shared links',()=>{
 const r=createArtRequirement('需求'),a=createArtAsset('文件');let s={...emptyArtAssets(),requirements:[r],assets:[a],links:[{id:'l',requirementId:r.id,assetId:a.id,note:'复用'}]};s=saveArtCategory(s,'道具交付','');const id=s.library.categories.at(-1).id;s=assignArtCategory(s,'requirement',r.id,id);assert.equal(artCategoryId(artLibrary(s),'asset',a.id),'');assert.deepEqual(removeArtCategory(s,id).links,s.links);
});
