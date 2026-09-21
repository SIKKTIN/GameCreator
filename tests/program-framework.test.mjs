import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {frameworkLibrary} from '../shared/program-framework-library.mjs';
import {emptyProgramFramework,validateProgramFramework,adoptedFrameworkDocuments,programFrameworkMarkdown,resolveFrameworkLink,frameworkDocumentBody} from '../shared/program-framework.mjs';
import {readProgramFramework,writeProgramFramework} from '../src/program-framework.ts';
import {captureProjectPackage,validateProjectPackage,prepareProjectPackageImport,writeProjectPackageImport} from '../src/project-package.ts';
import {addSavedProject} from '../src/project-catalog.ts';
import {buildAiDocument,buildAiDocumentFiles} from '../src/ai-export.ts';
import {buildSearchIndex,searchEntries} from '../src/global-search.ts';
import {syncDocuments} from '../shared/engine-sync.mjs';

const memory=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};};
const selected=()=>({...emptyProgramFramework(),enabled:true,extensions:['save'],notes:'Planting 与 Inventory 采用手工装配。'});
const catalog=()=>addSavedProject({schema:2,projects:[],activeId:'',mode:'project'},'框架测试');
const docFor=store=>buildAiDocument({name:'程序项目',genre:'',platform:'',version:'v1',status:'草稿',description:''},[],{datasets:{},columns:{}},[],{engine:'godot-gdscript',projectPath:'',enumPath:'',dataPath:'',outputFormat:'json',autoSync:false},{scan:null},undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,store);

test('bundled library is deterministic, complete and has portable internal links',()=>{
  execFileSync(process.execPath,['scripts/build-framework-library.mjs','--check'],{cwd:new URL('../',import.meta.url)});
  assert.equal(frameworkLibrary.documents.length,18);
  assert.equal(new Set(frameworkLibrary.documents.map(d=>d.id)).size,18);
  for(const d of frameworkLibrary.documents){
    assert.ok(d.content.startsWith('# '));assert.ok(!d.content.includes('E:/Project'));
    for(const [,href] of d.content.matchAll(/\]\(([^)\s]+)\)/g))if(!/^https?:/.test(href))assert.ok(resolveFrameworkLink(d.path,href),d.path+' -> '+href);
  }
  for(const href of ['../README.md','../../README.md','file:///x','javascript:alert(1)','E:/x','%zz'])assert.equal(resolveFrameworkLink('README.md',href),undefined);
});

test('single-player defaults do not adopt rules, networking or Oasis data plumbing',()=>{
  const store=emptyProgramFramework();assert.equal(store.enabled,false);assert.equal(store.runtime,'singleplayer');
  assert.deepEqual(adoptedFrameworkDocuments(store,'oasis-lua'),[]);
  assert.match(programFrameworkMarkdown(store,'oasis-lua'),/未采用/);
  store.extensions.push('save');assert.deepEqual(emptyProgramFramework().extensions,[]);
});

test('adoption combines base rules with only selected extensions and matching engine supplement',()=>{
  const store=selected(),before=JSON.stringify(store),ids=adoptedFrameworkDocuments(store,'godot-gdscript').map(d=>d.id);
  assert.equal(ids.length,10);assert.ok(ids.includes('architecture'));assert.ok(ids.includes('save'));
  for(const id of ['network','state','assembly','oasis','planting','intro'])assert.ok(!ids.includes(id));
  store.oasisSupplement=true;
  assert.ok(!adoptedFrameworkDocuments(store,'godot-gdscript').some(d=>d.id==='oasis'));
  assert.ok(adoptedFrameworkDocuments(store,'oasis-lua').some(d=>d.id==='oasis'));
  store.oasisSupplement=false;assert.equal(JSON.stringify(store),before);
  assert.deepEqual(adoptedFrameworkDocuments({...store,enabled:false},'oasis-lua'),[]);
});

test('invalid state is rejected, including unsupported versions and single-player networking',()=>{
  for(const edit of [s=>s.schema=2,s=>s.templateVersion='2.0',s=>s.enabled='yes',s=>s.runtime='server',s=>s.extensions=['network'],s=>s.extensions=['bad'],s=>s.extensions=['save','save'],s=>s.oasisSupplement=null,s=>s.notes='x'.repeat(30001),s=>s.extra=true]){
    const store=emptyProgramFramework();edit(store);assert.throws(()=>validateProgramFramework(store));
  }
  assert.ok(validateProgramFramework({...selected(),runtime:'multiplayer',extensions:['network']}));
});

test('storage distinguishes missing and corrupt data and prevents stale-window overwrite',()=>{
  const storage=memory();assert.deepEqual(readProgramFramework(storage,'one'),{raw:null,store:emptyProgramFramework()});
  const raw=writeProgramFramework(storage,'one',null,selected());assert.equal(readProgramFramework(storage,'one').raw,raw);
  assert.throws(()=>writeProgramFramework(storage,'one',null,emptyProgramFramework()),/其他窗口/);assert.equal(storage.getItem('one'),raw);
  assert.equal(storage.getItem('two'),null);
  storage.setItem('bad','{');assert.throws(()=>readProgramFramework(storage,'bad'));assert.equal(storage.getItem('bad'),'{');
});

test('project archives preserve adoption and disabled settings; old projects receive isolated defaults',()=>{
  const c=catalog(),storage=memory(),project=c.projects[0],key='gamecreator.workspace.v1:'+project.id+':program-framework';
  storage.setItem('gamecreator.projects.v1',JSON.stringify(c));storage.setItem(key,JSON.stringify({...selected(),enabled:false}));
  const snapshot=captureProjectPackage(storage,project),archive=snapshot.document.archives['program-framework'];
  assert.deepEqual(archive,{...selected(),enabled:false});assert.ok(snapshot.expectedEntries.some(e=>e.key===key));
  const imported=prepareProjectPackageImport(c,snapshot.document,'导入副本');writeProjectPackageImport(storage,imported);
  assert.deepEqual(JSON.parse(storage.getItem('gamecreator.workspace.v1:'+imported.project.id+':program-framework')),archive);
  const old=structuredClone(snapshot.document);delete old.archives['program-framework'];
  assert.deepEqual(validateProjectPackage(old).archives['program-framework'],emptyProgramFramework());assert.ok(!Object.hasOwn(old.archives,'program-framework'));
  const bad=structuredClone(snapshot.document);bad.archives['program-framework'].extensions=['unknown'];assert.throws(()=>validateProjectPackage(bad));
});

test('full AI, module Markdown and engine sync share adopted content without broken local navigation',()=>{
  const doc=docFor(selected()),section=doc.sections.find(s=>s.id==='framework');
  assert.match(section.body,/Planting 与 Inventory/);assert.match(section.body,/### 可选扩展：存档与数据迁移/);
  assert.doesNotMatch(section.body,/### 可选扩展：联机与状态同步/);assert.doesNotMatch(section.body,/### 绿洲启元补充/);
  assert.doesNotMatch(section.body,/\]\(\.\.\//);
  const bundle=buildAiDocumentFiles(doc,{folderName:'资料',summaryName:'总文档',moduleNames:{framework:'程序结构'}});
  assert.ok(bundle.files[0].content.includes(section.body));assert.ok(bundle.files.find(f=>f.path==='模块/程序结构.md').content.includes(section.body));
  assert.ok(syncDocuments(doc,['framework']).find(f=>f.path==='modules/framework.md').content.includes(section.body));
  assert.doesNotMatch(docFor(emptyProgramFramework()).sections.find(s=>s.id==='framework').body,/### 架构总纲/);
  const code={content:'# 标题\n```md\n# 保留代码标题\n```',path:'sample.md'};
  assert.match(frameworkDocumentBody(code,[]),/^### 标题\n```md\n# 保留代码标题/);
});

test('global search targets both project-specific notes and the bundled document reader',()=>{
  const entries=buildSearchIndex({framework:selected()});
  assert.equal(entries.length,19);
  const settings=searchEntries(entries,'Planting 与 Inventory').find(r=>r.entry.target.kind==='settings');assert.ok(settings);
  assert.ok(searchEntries(entries,'枪械').some(r=>r.entry.target.module==='程序框架'&&r.entry.target.id==='oasis'));
  assert.equal(buildSearchIndex({}).some(e=>e.target.module==='程序框架'),false);
});

test('desktop project folder validates and round-trips framework state, including concurrent-change checks',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-framework-package-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const c=catalog(),storage=memory(),project=c.projects[0];storage.setItem('gamecreator.projects.v1',JSON.stringify(c));
  const key='gamecreator.workspace.v1:'+project.id+':program-framework';storage.setItem(key,JSON.stringify(selected()));
  const {createProjectPackages}=createRequire(import.meta.url)('../desktop/project-package.cjs');const api=createProjectPackages({dataDirectory:path.join(dir,'data'),storage});
  const snapshot=captureProjectPackage(storage,project),args={projectId:project.id,...snapshot,directory:path.join(dir,'package')};
  await api.exportFolder(args);const result=await api.readFolder(args.directory);assert.deepEqual(result.document.archives['program-framework'],selected());
  const bad=structuredClone(snapshot.document);bad.archives['program-framework'].schema=3;
  await assert.rejects(api.exportFolder({...args,directory:path.join(dir,'invalid'),document:bad}),/程序框架/);
  storage.setItem(key,JSON.stringify({...selected(),notes:'另一个窗口'}));
  await assert.rejects(api.exportFolder({...args,directory:path.join(dir,'changed')}));
});
