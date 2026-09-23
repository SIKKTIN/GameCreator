import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {emptyProjectStandards,validateProjectStandards,projectStandardRules,projectStandardsMarkdown,validateCompatibility} from '../shared/project-standards.mjs';
import {readProjectStandards,writeProjectStandards} from '../src/project-standards.ts';
import {checkProjectStructure} from '../shared/project-standards-checks.mjs';
import {captureProjectPackage,validateProjectPackage,prepareProjectPackageImport,writeProjectPackageImport} from '../src/project-package.ts';
import {addSavedProject} from '../src/project-catalog.ts';
import {buildAiDocument,buildAiDocumentFiles} from '../src/ai-export.ts';
import {syncDocuments} from '../shared/engine-sync.mjs';
import {buildSearchIndex,searchEntries} from '../src/global-search.ts';
const memory=()=>{const v=new Map();return{getItem:k=>v.get(k)??null,setItem:(k,s)=>v.set(k,s)};};
const example=()=>({...emptyProjectStandards(),notes:'新增规则先列出旧内容的复用依据。',moduleNotes:{data:'时间统一以秒保存。'}});
const catalog=()=>addSavedProject({schema:2,projects:[],activeId:'',mode:'project'},'通用规范测试');
test('rules remain engine-neutral and reading a legacy project never rewrites content',()=>{
 const storage=memory();assert.deepEqual(readProjectStandards(storage,'p').store,emptyProjectStandards());assert.equal(storage.getItem('p'),null);
 const content=projectStandardsMarkdown();assert.equal(new Set(projectStandardRules.map(r=>r.id)).size,projectStandardRules.length);assert.match(content,/先复用，再扩展/);assert.match(content,/版本先后不构成父子关系/);assert.match(content,/不同游戏类型和引擎/);assert.doesNotMatch(content,/植物大战僵尸|奶龙|星露谷|空洞骑士/);
 const first=emptyProjectStandards();first.moduleNotes.art='仅这个项目';assert.deepEqual(emptyProjectStandards().moduleNotes,{});
});
test('project supplements validate and cannot silently overwrite a concurrent window',()=>{
 const s=memory(),raw=writeProjectStandards(s,'one',null,example());assert.equal(readProjectStandards(s,'one').raw,raw);assert.equal(s.getItem('two'),null);
 assert.throws(()=>writeProjectStandards(s,'one',null,emptyProjectStandards()),/其他窗口/);assert.equal(s.getItem('one'),raw);
 for(const v of [{...example(),schema:2},{...example(),moduleNotes:{unknown:'test'}},{...example(),notes:'x'.repeat(30001)},{...example(),moduleNotes:{data:3}},{...example(),enabled:false}])assert.throws(()=>validateProjectStandards(v));
 s.setItem('broken','{');assert.throws(()=>readProjectStandards(s,'broken'));assert.equal(s.getItem('broken'),'{');
});
test('portable archives include supplements and missing legacy sections materialize without mutating input',()=>{
 const c=catalog(),s=memory(),p=c.projects[0],key='gamecreator.workspace.v1:'+p.id+':project-standards';s.setItem('gamecreator.projects.v1',JSON.stringify(c));s.setItem(key,JSON.stringify(example()));const snapshot=captureProjectPackage(s,p);assert.deepEqual(snapshot.document.archives['project-standards'],example());assert.ok(snapshot.expectedEntries.some(e=>e.key===key));
 const old=structuredClone(snapshot.document);delete old.archives['project-standards'];assert.deepEqual(validateProjectPackage(old).archives['project-standards'],emptyProjectStandards());assert.equal(old.archives['project-standards'],undefined);
 const imported=prepareProjectPackageImport(c,snapshot.document,'规范副本');writeProjectPackageImport(s,imported);assert.deepEqual(readProjectStandards(s,'gamecreator.workspace.v1:'+imported.project.id+':project-standards').store,example());
});
test('full AI export, standalone rules, filtered engine delivery and search carry the same rules',()=>{
 const args=[{name:'游戏',genre:'',platform:'',version:'v1',status:'',description:''},[],{datasets:{},columns:{}},[],{engine:'godot-gdscript',projectPath:'',enumPath:'.',dataPath:'data/generated',outputFormat:'json',autoSync:false},{scan:null,active:null}];args.length=19;args.push(example());
 const doc=buildAiDocument(...args),section=doc.sections.find(s=>s.id==='standards');assert.match(section.body,/时间统一以秒保存/);assert.equal(doc.sections[1].id,'standards');const files=buildAiDocumentFiles(doc,{folderName:'资料',summaryName:'总文档',moduleNames:{}}).files;assert.ok(files[0].content.includes(section.body));assert.ok(files.find(f=>f.path==='模块/项目规范.md').content.includes(section.body));
 const engine=syncDocuments(doc,['overview']);assert.ok(engine.find(f=>f.path==='modules/standards.md').content.includes(section.body));assert.match(engine[0].content,/项目规范/);assert.match(engine.find(f=>f.path==='modules/overview.md').content,/更新项目前先读 \[项目规范\]\(standards.md\)/);
 const named=buildAiDocumentFiles(doc,{folderName:'资料',summaryName:'总文档',moduleNames:{standards:'项目规则 定制'}});assert.ok(named.files.find(f=>f.path==='模块/项目概览.md').content.includes(encodeURIComponent('项目规则 定制.md')));
 const index=buildSearchIndex({standards:example()});assert.ok(searchEntries(index,'时间统一以秒保存').some(r=>r.entry.target.module==='项目规范'&&r.entry.target.id==='data-contract'));
});
test('structural diagnostics distinguish version organization hints from broken references without changing data',()=>{
 const input={gameplay:{categories:[{id:'v','name':'v0.3 新扩展'}],designs:[{id:'a',title:'攻击',categoryId:'missing'},{id:'b',title:'v0.2 攻击'},{id:'c',title:'攻击',archived:true}]},core:{rootId:'root',graphs:[{id:'root',title:'v0.3 五关循环',nodes:[{id:'n',title:'战斗',gameplayIds:['missing'],childGraphId:'missing'}],edges:[]}]},functional:{systems:[{id:'s',name:'战斗'}],capabilities:[{id:'c',name:'攻击',systemId:'missing'}],usages:[],dependencies:[]},schedule:{tasks:[{id:'task',title:'v0.3 发布',milestoneId:'missing',dependencyIds:['task']}],milestones:[]}};
 const before=JSON.stringify(input),issues=checkProjectStructure(input);assert.ok(issues.some(i=>i.severity==='warning'&&i.message.includes('业务职责')));assert.ok(issues.some(i=>i.message.includes('名称相近')));assert.ok(issues.some(i=>i.severity==='error'&&i.module==='功能系统'));assert.ok(issues.some(i=>i.message.includes('分类已不存在')));assert.ok(!issues.some(i=>i.module==='项目排期'&&i.message.includes('业务职责')));assert.equal(JSON.stringify(input),before);
 assert.deepEqual(checkProjectStructure({}),[]);
});
test('compatibility plans require all four nonempty fields for new baselines and remain optional for old feedback',()=>{
 validateCompatibility(undefined);assert.throws(()=>validateCompatibility(undefined,true),/兼容方案/);for(const p of [{reuse:'A'},{reuse:'A',modify:'B',add:'',archive:'无'},{reuse:'A',modify:'B',add:'无',archive:'无',other:'no'}])assert.throws(()=>validateCompatibility(p));validateCompatibility({reuse:'A',modify:'B',add:'无',archive:'无'},true);
});
test('desktop folder export preserves supplements and protects the new archive against stale capture',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-standards-'));t.after(()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));return fs.rm(dir,{recursive:true,force:true});});const c=catalog(),p=c.projects[0],storage=memory();storage.setItem('gamecreator.projects.v1',JSON.stringify(c));const key='gamecreator.workspace.v1:'+p.id+':project-standards';storage.setItem(key,JSON.stringify(example()));const api=createRequire(import.meta.url)('../desktop/project-package.cjs').createProjectPackages({storage,dataDirectory:path.join(dir,'data')}),snapshot=captureProjectPackage(storage,p),args={...snapshot,projectId:p.id,directory:path.join(dir,'export')};await api.exportFolder(args);assert.deepEqual((await api.readFolder(args.directory)).document.archives['project-standards'],example());storage.setItem(key,JSON.stringify({...example(),notes:'外部修改'}));await assert.rejects(api.exportFolder({...args,directory:path.join(dir,'stale')}),/变化/);
});
