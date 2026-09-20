import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createPrototypeScene, createPrototypeElement, emptyPrototypeDesign, validatePrototypeDesign, prototypeFromSpace, prototypeSource, prototypeGeometry, prototypeIssues, duplicatePrototypeScene, removePrototypeScene, removePrototypeElement, startPrototype, applyPrototypeAction, readPrototypeDesign, writePrototypeDesign } from '../src/prototype-design.ts';
import { emptyGameplayCore } from '../src/gameplay-core.ts';
import { emptyArtAssets } from '../src/art-assets.ts';
import { validatePrototypeExample, preparePrototypeProject, writePrototypeProject } from '../src/prototype-import.ts';
import { defaultCatalog } from '../src/project-catalog.ts';
import { captureProjectPackage, validateProjectPackage, prepareProjectPackageImport, writeProjectPackageImport } from '../src/project-package.ts';
import { buildAiMarkdown } from '../src/ai-export.ts';
const examples = await Promise.all(['plants-vs-zombies', 'hollow-knight', 'stardew-valley', 'disco-elysium', 'vampire-survivors'].map(async name => ({ name, data: JSON.parse(await fs.readFile(new URL('../examples/prototypes/' + name + '.json', import.meta.url), 'utf8')) })));
const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const config = { engine: 'oasis-lua', projectPath: '', enumPath: 'Script/Const', dataPath: 'Script/Config', outputFormat: 'lua', autoSync: false, backupBeforeSync: true };
for (const {name,data} of examples) test(name + ': compose every spatial view as references, preserve sources and package round-trip', () => {
  const before = JSON.stringify(data);
  for (const design of data.gameplay.designs) {
    const scenes = prototypeFromSpace(design, data.gameplay.designs), store = { schema: 1, entryId: scenes[0].id, scenes };
    validatePrototypeDesign(store); assert.deepEqual(prototypeIssues(store, data.gameplay.designs, data.gameplayCore, data.artAssets), []);
    const started = startPrototype(store); const entered = applyPrototypeAction(store, started, scenes[0].elements[1].id); assert.equal(entered.sceneId, scenes[1].id);
    for (const scene of scenes.slice(1)) {
      const source = prototypeSource(scene, data.gameplay.designs), geo = prototypeGeometry(scene, data.gameplay.designs);
      assert.ok(source.source); assert.equal(geo.objects.length, source.objects.length);
      for (const item of geo.objects) for (const k of ['x', 'y', 'width', 'height']) assert.ok(Number.isFinite(item[k]));
      for (const e of scene.elements.filter(e => e.action.kind === 'scene')) assert.ok(store.scenes.some(s => s.id === applyPrototypeAction(store, startPrototype(store, scene.id), e.id, true).sceneId));
    }
  }
  assert.equal(JSON.stringify(data), before);
  const scenes = prototypeFromSpace(data.gameplay.designs[0], data.gameplay.designs), prototypeDesign = {schema:1, entryId:scenes[0].id, scenes};
  // Replacing prototype scenes also replaces the schedule fixture that referenced the original scenes.
  const extended = {...structuredClone(data),prototypeDesign}; delete extended.projectSchedule; validatePrototypeExample(extended);
  const catalog = defaultCatalog({...config,projectPath:'E:/QA/Existing'},'旧项目'), p = preparePrototypeProject(catalog,extended,'原型'), storage=memory(); writePrototypeProject(storage,p);
  const doc = captureProjectPackage(storage,p.project).document; assert.deepEqual(doc.archives['prototype-design'],prototypeDesign);
  const prepared = prepareProjectPackageImport(catalog,doc,'转移后的原型'), target=memory(); writeProjectPackageImport(target,prepared);
  assert.deepEqual(JSON.parse(target.getItem('gamecreator.workspace.v1:'+prepared.project.id+':prototype-design')),prototypeDesign);
  const md=buildAiMarkdown(doc.archives.project,[],data.data,data.definitions,config,{scan:null,active:null},data.gameplay.designs,data.functionalSystems,data.artAssets,data.gameplayCore,prototypeDesign);assert.ok(md.includes(scenes[0].name));
  delete doc.archives['prototype-design'];assert.deepEqual(validateProjectPackage(doc).archives['prototype-design'],emptyPrototypeDesign());assert.equal(Object.hasOwn(doc.archives,'prototype-design'),false);
});
test('runtime gates, visibility, bad targets and restarting never alter authoring data',()=>{
 const scene=createPrototypeScene('主界面'),target=createPrototypeElement('shape'),button=createPrototypeElement('button');target.visible=false;button.action={kind:'toggle',targetId:target.id,condition:'拥有钥匙'};scene.elements=[button,target];const store={schema:1,entryId:scene.id,scenes:[scene]},before=JSON.stringify(store),runtime=startPrototype(store);
 assert.throws(()=>applyPrototypeAction(store,runtime,button.id),/条件/);const next=applyPrototypeAction(store,runtime,button.id,true);assert.equal(next.visibility[target.id],true);assert.deepEqual(runtime.visibility,{});assert.equal(applyPrototypeAction(store,next,button.id,true).visibility[target.id],false);assert.equal(JSON.stringify(store),before);assert.deepEqual(startPrototype(store).visibility,{});
 button.action={kind:'scene',targetId:'missing',condition:''};assert.throws(()=>applyPrototypeAction(store,runtime,button.id),/不存在/);
 button.action={kind:'hide',targetId:'missing',condition:''};assert.throws(()=>applyPrototypeAction(store,runtime,button.id),/失效/);
 button.visible=false;assert.throws(()=>applyPrototypeAction(store,runtime,button.id),/不可用/);
});
test('duplication remaps local targets and deletion blocks referenced scenes/elements',()=>{
 const scene=createPrototypeScene(),button=createPrototypeElement('button'),shape=createPrototypeElement('shape'),self=createPrototypeElement('button');button.action={kind:'show',targetId:shape.id,condition:''};self.action={kind:'scene',targetId:scene.id,condition:''};scene.elements=[button,shape,self];
 const copy=duplicatePrototypeScene(scene);assert.equal(copy.elements[0].action.targetId,copy.elements[1].id);assert.equal(copy.elements[2].action.targetId,copy.id);assert.notEqual(copy.elements[0].id,button.id);assert.throws(()=>removePrototypeElement(scene,shape.id),/引用/);
 const second=createPrototypeScene();second.elements=[{...createPrototypeElement('button'),action:{kind:'scene',targetId:scene.id,condition:''}}];const store={schema:1,entryId:scene.id,scenes:[scene,second]};assert.throws(()=>removePrototypeScene(store,scene.id),/引用/);assert.equal(removePrototypeScene(store,second.id).scenes.length,1);
});
test('invalid geometry and archive versions are rejected; broken references remain repairable',()=>{
 const scene=createPrototypeScene(),e=createPrototypeElement('image');e.sourceObjectId='missing';e.assetId='missing';scene.sourceDesignId='missing';scene.roomId='gone';scene.coreNodeId='gone';scene.elements=[e];const store={schema:1,entryId:'missing',scenes:[scene]};validatePrototypeDesign(store);assert.ok(prototypeIssues(store,[],emptyGameplayCore(),emptyArtAssets()).length>=5);
 for(const change of [s=>s.schema=2,s=>s.scenes[0].width=0,s=>s.scenes[0].elements[0].x=Infinity,s=>s.scenes[0].elements[0].color='url(javascript:x)',s=>s.scenes[0].elements[0].action.kind='eval',s=>s.scenes.push(structuredClone(s.scenes[0]))]){const draft=structuredClone(store);change(draft);assert.throws(()=>validatePrototypeDesign(draft));}
});
test('save failures and compare-and-swap conflicts preserve previous stored bytes',()=>{
 const storage=memory();assert.deepEqual(readPrototypeDesign(storage,'k').store,emptyPrototypeDesign());const scene=createPrototypeScene(),store={schema:1,entryId:scene.id,scenes:[scene]},raw=writePrototypeDesign(storage,'k',null,store);assert.equal(storage.getItem('k'),raw);
 assert.throws(()=>writePrototypeDesign(storage,'k',null,emptyPrototypeDesign()),/其他窗口/);assert.equal(storage.getItem('k'),raw);assert.throws(()=>writePrototypeDesign({...storage,setItem(){throw Error('disk full')}},'k',raw,emptyPrototypeDesign()),/disk full/);assert.equal(storage.getItem('k'),raw);storage.setItem('k','broken');assert.throws(()=>readPrototypeDesign(storage,'k'));
});

test('element IDs cannot inherit preview visibility from Object.prototype',()=>{
 const scene=createPrototypeScene(),e=createPrototypeElement('button');e.id='toString';e.visible=false;scene.elements=[e];const store={schema:1,entryId:scene.id,scenes:[scene]};validatePrototypeDesign(store);assert.throws(()=>applyPrototypeAction(store,startPrototype(store),e.id),/不可用/);
});
