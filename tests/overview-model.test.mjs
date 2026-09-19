import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLocalOverview,normalizeInfo,normalizeMilestone,sameRecordFields } from '../src/overview-model.ts';
import { readPublicationPreview,publicationBody,assertPublicationCurrent } from '../src/team-publish.ts';
test('overview publication captures local defaults, all metadata and milestones without modifying archives',()=>{
  const project={id:'source',name:'来源',initialContent:'empty'},records=new Map(),storage={getItem:key=>records.get(key)??null};
  const empty=readLocalOverview(storage,project);assert.deepEqual(empty.milestones,[]);assert.equal(empty.info.description,'');assert.equal(empty.info.version,'v0.1.0');
  const meta={name:'本地名称',genre:'自定义类型',platform:'掌机',version:'v2',status:'评审中',description:'简介'};
  const milestones=[{title:'原型',owner:'本地负责人',due:'2026/09/20',status:'done'}];
  records.set('gamecreator.workspace.v1:source:project',JSON.stringify(meta));records.set('gamecreator.workspace.v1:source:milestones',JSON.stringify(milestones));
  const before=[...records],preview=readPublicationPreview(storage,project),body=publicationBody(preview,{sourceInstanceId:'client',sourceProjectId:'source'},'团队名称',[]);
  assert.deepEqual(body.overview,{info:{...meta,name:'团队名称'},milestones});assert.deepEqual([...records],before);
  records.set('gamecreator.workspace.v1:source:milestones',JSON.stringify([{...milestones[0],status:'active'}]));
  assert.throws(()=>assertPublicationCurrent(storage,project,preview),/本地项目已变化/);
  assert.ok(readLocalOverview({getItem:()=>null},{...project,initialContent:'legacy'}).milestones.length>0);
});
test('invalid overview archives fail closed, while incomplete editing drafts remain recoverable',()=>{
  const base={name:'',genre:'',platform:'',version:'',status:'',description:''};
  assert.deepEqual(normalizeInfo(base,true),base);assert.throws(()=>normalizeInfo(base),/项目名称/);
  assert.ok(sameRecordFields(base,Object.fromEntries(Object.entries(base).reverse())), 'Restored drafts and server field order must not produce a false conflict');
  assert.equal(sameRecordFields(base,{...base,description:'changed'}),false);
  const milestone={title:'',owner:'',due:'',status:'planned'};assert.deepEqual(normalizeMilestone(milestone,true),milestone);assert.throws(()=>normalizeMilestone(milestone),/里程碑名称/);
  for(const raw of ['{bad','{}',JSON.stringify(Array(201).fill({...milestone,title:'过多'})),JSON.stringify([{...milestone,title:'正常',status:'bad'}])]) {
    const storage={getItem:key=>key.endsWith(':milestones')?raw:null};assert.throws(()=>readLocalOverview(storage,{id:'p',name:'项目',initialContent:'empty'}));assert.equal(storage.getItem(':milestones'),raw);
  }
});
