import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { defaultCatalog } from '../src/project-catalog.ts';
import { preparePrototypeProject, writePrototypeProject, validatePrototypeExample } from '../src/prototype-import.ts';
import { captureProjectPackage, validateProjectPackage, prepareProjectPackageImport, writeProjectPackageImport } from '../src/project-package.ts';
import { emptyStoryOrchestration } from '../src/story-orchestration.ts';
import { buildAiMarkdown } from '../src/ai-export.ts';
const {createProjectPackages}=createRequire(import.meta.url)('../desktop/project-package.cjs');
const config={engine:'oasis-lua',projectPath:'E:/Example/Narrative',enumPath:'Script/Const',dataPath:'Script/Config',outputFormat:'lua',autoSync:false,backupBeforeSync:true};
const catalog=defaultCatalog(config,'原项目'),key=id=>'gamecreator.workspace.v1:'+id+':story-orchestration';
const example=JSON.parse(await fs.readFile(new URL('../examples/prototypes/disco-elysium.json',import.meta.url),'utf8'));
const storage=()=>{const values=new Map();return {values,getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};};
test('optional story module stays off in new copies; enabling and disabling are isolated and every archive survives folder transfer',()=>{
  const memory=storage(),a=preparePrototypeProject(catalog,example,'A'),b=preparePrototypeProject(catalog,example,'B');writePrototypeProject(memory,a);writePrototypeProject(memory,b);
  const original=memory.getItem(key(b.project.id));const enabled=JSON.parse(memory.getItem(key(a.project.id)));enabled.enabled=true;memory.setItem(key(a.project.id),JSON.stringify(enabled));assert.equal(memory.getItem(key(b.project.id)),original);
  for(const flag of [true,false]){
    enabled.enabled=flag;memory.setItem(key(a.project.id),JSON.stringify(enabled));const snapshot=captureProjectPackage(memory,a.project);assert.ok(snapshot.expectedEntries.some(e=>e.key===key(a.project.id)));
    const imported=prepareProjectPackageImport(catalog,snapshot.document,'复制'+flag),target=storage();writeProjectPackageImport(target,imported);
    assert.deepEqual(JSON.parse(target.getItem(key(imported.project.id))),enabled);
    const md=buildAiMarkdown(snapshot.document.archives.project,example.stories,example.data,example.definitions,config,{scan:null,active:null},example.gameplay.designs,example.functionalSystems,example.artAssets,example.gameplayCore,undefined,example.taskFlows,enabled);
    assert.equal(md.includes('## 故事编排'),flag);if(flag)assert.ok(md.includes(example.storyOrchestration.stories[0].nodes[0].text));
  }
});
test('old templates and folders gain a disabled empty module without rewriting source, damaged story archives are rejected before import',()=>{
  const old=structuredClone(example);delete old.storyOrchestration;validatePrototypeExample(old);const memory=storage(),prepared=preparePrototypeProject(catalog,old,'旧模板');writePrototypeProject(memory,prepared);assert.deepEqual(JSON.parse(memory.getItem(key(prepared.project.id))),emptyStoryOrchestration());assert.equal(Object.hasOwn(old,'storyOrchestration'),false);
  const doc=captureProjectPackage(memory,prepared.project).document;delete doc.archives['story-orchestration'];assert.deepEqual(validateProjectPackage(doc).archives['story-orchestration'],emptyStoryOrchestration());assert.equal(Object.hasOwn(doc.archives,'story-orchestration'),false);
  for(const mutate of [s=>s.enabled='yes',s=>s.stories[0].choices[0].condition={groups:'invalid'},s=>s.stories[0].variables[0].initial=Infinity,s=>s.stories[0].checks[0].successEffects=[{variableId:'x',op:'execute',value:1}]]){
    const bad=structuredClone(example);mutate(bad.storyOrchestration);assert.throws(()=>validatePrototypeExample(bad));doc.archives['story-orchestration']=bad.storyOrchestration;assert.throws(()=>prepareProjectPackageImport(catalog,doc,'坏数据'));
  }
});
test('desktop package writer validates story metadata, preserves disabled contents and detects simultaneous edits',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-story-package-'));t.after(async()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));await fs.rm(dir,{recursive:true,force:true});});
  const memory=storage(),prepared=preparePrototypeProject(catalog,example,'港区故事');writePrototypeProject(memory,prepared);memory.setItem('gamecreator.projects.v1',JSON.stringify(prepared.catalog));
  const snapshot=captureProjectPackage(memory,prepared.project),service=createProjectPackages({dataDirectory:path.join(dir,'data'),storage:memory});const args={directory:path.join(dir,'export'),projectId:prepared.project.id,...snapshot};await service.exportFolder(args);
  const loaded=await service.readFolder(args.directory);assert.deepEqual(loaded.document.archives['story-orchestration'],example.storyOrchestration);assert.ok(JSON.parse(await fs.readFile(path.join(args.directory,'manifest.json'),'utf8')).files.some(f=>f.path==='data/story-orchestration.json'));
  const raw=memory.getItem(key(prepared.project.id)),edit=JSON.parse(raw);edit.enabled=true;memory.setItem(key(prepared.project.id),JSON.stringify(edit));await assert.rejects(service.exportFolder({...args,directory:path.join(dir,'conflict')}));memory.setItem(key(prepared.project.id),raw);
  for(const mutate of [s=>s.enabled='yes',s=>s.stories[0].nodes[1].id=s.stories[0].nodes[0].id,s=>s.stories[0].choices[0].condition={groups:'invalid'}]){const bad=structuredClone(snapshot.document);mutate(bad.archives['story-orchestration']);await assert.rejects(service.exportFolder({...args,document:bad,directory:path.join(dir,crypto.randomUUID())}));}
});
