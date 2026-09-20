import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createGameplay, duplicateGameplay, readGameplay, writeGameplay, validateGameplay, gameplayMarkdown, moveGameplayItem} from '../src/gameplay.ts';
import {categoryOf, saveGameplayCategory, removeGameplayCategory, moveGameplayDocuments, gameplayMatches} from '../src/gameplay-library.ts';
import {preparePrototypeProject, writePrototypeProject} from '../src/prototype-import.ts';
import {defaultCatalog} from '../src/project-catalog.ts';
import {captureProjectPackage, prepareProjectPackageImport, writeProjectPackageImport, validateProjectPackage} from '../src/project-package.ts';
const require=createRequire(import.meta.url),{createWorkspaceStorage}=require('../desktop/test-workspaces.cjs'),{createProjectPackages}=require('../desktop/project-package.cjs');
const memory=()=>{const entries=new Map();return {entries,getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v)};};
const category=name=>({name,description:'主题说明',icon:'folder'});
test('old gameplay reads stay unchanged and uncategorized; optional metadata is validated without replacing content',()=>{
 const storage=memory(),original={schema:3,designs:[createGameplay('旧文档')]};storage.setItem('gameplay',JSON.stringify(original));
 assert.deepEqual(readGameplay(storage,'gameplay').store,original);assert.equal(categoryOf(original.designs[0],[]),'');assert.equal(storage.getItem('gameplay'),JSON.stringify(original));
 for(const patch of [{categories:null},{categories:[{id:'x',...category('角色'),icon:'__proto__'}]},{categories:[{id:'x',...category('角色')},{id:'x',...category('地图')}]},{categories:[{id:'x',...category('角色')},{id:'y',...category('角色')}]},{designs:[{...original.designs[0],tags:'bad'}]},{designs:[{...original.designs[0],categoryId:1}]}])assert.throws(()=>validateGameplay({...original,...patch}),/分类/);
 assert.equal(categoryOf({...original.designs[0],categoryId:'missing'},[]),'');
});
test('category management and batch moves preserve document IDs, rule/state/space links and archived content',()=>{
 let store={schema:3,designs:[createGameplay('冲刺'),{...createGameplay('旧战斗'),archived:true}]};
 const original=structuredClone(store.designs);store=saveGameplayCategory(store,category('角色'));const a=store.categories[0].id;store=saveGameplayCategory(store,category('探索'));const b=store.categories[1].id;
 store=moveGameplayDocuments(store,store.designs.map(d=>d.id),a);store=saveGameplayCategory(store,category('角色与战斗'),a);store={...store,categories:moveGameplayItem(store.categories,1,-1)};
 assert.deepEqual(store.categories.map(c=>c.id),[b,a]);assert.ok(store.designs.every(d=>d.categoryId===a));
 for(const [i,d]of store.designs.entries())assert.deepEqual({...d,categoryId:null,updatedAt:null},{...original[i],categoryId:null,updatedAt:null});
 assert.throws(()=>saveGameplayCategory(store,category('探索')),/已存在/);assert.throws(()=>moveGameplayDocuments(store,[original[0].id],'missing'),/不存在/);
 store=removeGameplayCategory(store,a);assert.equal(store.designs.length,2);assert.equal(store.designs[1].archived,true);assert.ok(store.designs.every(d=>d.categoryId===''));assert.equal(store.categories.length,1);
 const storage=memory();const raw=writeGameplay(storage,'g',null,store);assert.deepEqual(readGameplay(storage,'g').store,store);assert.throws(()=>writeGameplay(storage,'g',null,store),/其他窗口/);assert.equal(storage.getItem('g'),raw);
});
test('copies keep category and tags; search covers body text and tags; markdown includes category paths',()=>{
 let store=saveGameplayCategory({schema:3,designs:[createGameplay('角色冲刺')]},category('角色'));store=moveGameplayDocuments(store,[store.designs[0].id],store.categories[0].id);
 const d={...store.designs[0],tags:['战斗','移动'],rules:'落地后恢复空中使用次数'};const copy=duplicateGameplay(d);assert.equal(copy.categoryId,d.categoryId);assert.deepEqual(copy.tags,d.tags);assert.notEqual(copy.id,d.id);assert.equal(gameplayMatches(d,'空中使用'),true);assert.equal(gameplayMatches(d,'战斗'),true);
 const md=gameplayMarkdown([d],{stories:[],datasets:[]},undefined,store.categories);assert.ok(md.includes('- 分类：角色'));assert.ok(md.includes('- 标签：战斗、移动'));
});
test('project folder round trip retains category order and membership with all functional/core/art references',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-library-package-'));
 try{
  const storage=createWorkspaceStorage(path.join(dir,'source')),api=createProjectPackages({dataDirectory:path.join(dir,'source'),storage});
  const example=JSON.parse(await fs.readFile(new URL('../examples/prototypes/hollow-knight.json',import.meta.url),'utf8'));
  const config={engine:'oasis-lua',projectPath:'E:/QA/Engine',enumPath:'Script/Const',dataPath:'Script/Config',outputFormat:'lua',autoSync:false,backupBeforeSync:true};
  const catalog=defaultCatalog(config,'原始项目'),prepared=preparePrototypeProject(catalog,example,'分类迁移测试');writePrototypeProject(storage,prepared);storage.setItem('gamecreator.projects.v1',JSON.stringify(prepared.catalog));
  const key='gamecreator.workspace.v1:'+prepared.project.id+':gameplay',raw=storage.getItem(key);let store=saveGameplayCategory(JSON.parse(raw),category('角色'));store=moveGameplayDocuments(store,[store.designs[0].id,store.designs[1].id],store.categories[0].id);store.designs[0].tags=['重要'];writeGameplay(storage,key,raw,store);
  const snapshot=captureProjectPackage(storage,prepared.project),folder=path.join(dir,'package');await api.exportFolder({projectId:prepared.project.id,document:snapshot.document,expectedEntries:snapshot.expectedEntries,directory:folder});
  const loaded=validateProjectPackage((await api.readFolder(folder)).document);assert.deepEqual(loaded.archives.gameplay,store);assert.deepEqual(loaded.archives['functional-systems'],example.functionalSystems);assert.deepEqual(loaded.archives['gameplay-core'],example.gameplayCore);assert.deepEqual(loaded.archives['art-assets'],example.artAssets);
  const target=memory(),imported=prepareProjectPackageImport(catalog,loaded,'恢复分类项目');writeProjectPackageImport(target,imported);assert.deepEqual(readGameplay(target,'gamecreator.workspace.v1:'+imported.project.id+':gameplay').store,store);
  const malformed=structuredClone(snapshot.document);malformed.archives.gameplay.categories[0].icon='not-an-icon';await assert.rejects(api.exportFolder({projectId:prepared.project.id,document:malformed,expectedEntries:snapshot.expectedEntries,directory:path.join(dir,'bad')}),/分类/);
 }finally{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('gc-library-package-'));await fs.rm(dir,{recursive:true,force:true});}
});
