import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGameplay, duplicateGameplay, emptyGameplay, gameplayLinkName, gameplayMarkdown, moveGameplayItem, readGameplay, validateGameplay, writeGameplay } from '../src/gameplay.ts';
import { buildAiMarkdown } from '../src/ai-export.ts';
const require=createRequire(import.meta.url);
const {createWorkspaceStorage}=require('../desktop/test-workspaces.cjs');
const sources={stories:[{id:'story-1',title:'城镇防守背景'}],datasets:[{key:'enemies',label:'敌人配置'}]};
function populated(){
 const d=createGameplay('抵挡一波敌人');
 d.summary='利用有限资源守住营地';d.experience='在有限时间内权衡攻击与防御';d.rules='敌人每十秒出现';d.winCondition='全歼敌人';d.loseCondition='营地被摧毁';d.status='已验证';d.archived=true;
 d.loop=[{id:'step-a',text:'收集资源'},{id:'step-b',text:'建造防御'},{id:'step-c',text:'抵挡敌人'}];
 d.prototype=[{id:'item-a',text:'一个测试场地',done:true}];d.deferred='正式美术';
 d.checks=[{id:'check-a',question:'能否理解目标',steps:'试玩三分钟',expected:'建立防线',actual:'完成第一波',result:'通过'}];
 d.links=[{kind:'story',targetId:'story-1'},{kind:'dataset',targetId:'enemies'}];return d;
}
test('a gameplay needs only a name and contains no sample content',()=>{
 const d=createGameplay('  我的原型  ');assert.equal(d.title,'我的原型');assert.equal(d.status,'草稿');assert.equal(d.archived,false);
 for(const key of ['summary','experience','rules','winCondition','loseCondition','deferred'])assert.equal(d[key],'');
 for(const key of ['loop','prototype','checks','links'])assert.deepEqual(d[key],[]);
 assert.notEqual(d.id,createGameplay('我的原型').id);assert.throws(()=>createGameplay('  '),/玩法名称/);validateGameplay({schema:1,designs:[d]});
});
test('copy creates an independent untested draft while retaining design intent and links',()=>{
 const original=populated(),before=structuredClone(original),copy=duplicateGameplay(original);
 assert.notEqual(copy.id,original.id);assert.equal(copy.title,'抵挡一波敌人 · 副本');assert.equal(copy.status,'草稿');assert.equal(copy.archived,false);
 assert.deepEqual(copy.loop.map(s=>s.text),original.loop.map(s=>s.text));assert.notEqual(copy.loop[0].id,original.loop[0].id);
 assert.equal(copy.prototype[0].done,false);assert.notEqual(copy.prototype[0].id,original.prototype[0].id);
 assert.equal(copy.checks[0].result,'未测试');assert.equal(copy.checks[0].actual,'');assert.equal(copy.checks[0].expected,'建立防线');
 assert.notEqual(copy.checks[0].id,original.checks[0].id);copy.links[0].targetId='different';copy.loop[0].text='changed';assert.deepEqual(original,before);
 validateGameplay({schema:1,designs:[original,copy]});
});
test('loop order changes without losing identity, and completed checklists do not decide design status',()=>{
 const d=populated();d.status='草稿';d.archived=false;d.loop=moveGameplayItem(d.loop,1,-1);
 assert.deepEqual(d.loop.map(s=>s.id),['step-b','step-a','step-c']);assert.deepEqual(d.loop.map(s=>s.text),['建造防御','收集资源','抵挡敌人']);
 assert.equal(moveGameplayItem(d.loop,0,-1),d.loop);assert.equal(moveGameplayItem(d.loop,2,1),d.loop);
 const saved=validateGameplay(JSON.parse(JSON.stringify({schema:1,designs:[d]})));assert.equal(saved.designs[0].status,'草稿');
});
test('project IDs and isolated test workspaces keep independent disk archives across reopening',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gamecreator-gameplay-'));
 try{
  const storage=createWorkspaceStorage(dir),a='gamecreator.workspace.v1:project-a:gameplay',b='gamecreator.workspace.v1:project-b:gameplay';
  const testId=crypto.randomUUID(),testKey='gamecreator.workspace.v1:'+path.join(dir,'test-workspaces',testId,'project').replaceAll('\\','/').toLowerCase()+':gameplay';
  const d=populated();writeGameplay(storage,a,null,{schema:1,designs:[d]});writeGameplay(storage,b,null,{schema:1,designs:[createGameplay('另一个同名原型')]});
  const original=storage.getItem(a);writeGameplay(storage,testKey,null,{schema:1,designs:[createGameplay('测试玩法')]});
  assert.equal(storage.getItem(a),original);assert.ok(storage.info(testKey).directory.includes(testId));
  const restarted=createWorkspaceStorage(dir);assert.deepEqual(readGameplay(restarted,a).store.designs,[d]);assert.equal(readGameplay(restarted,b).store.designs[0].title,'另一个同名原型');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('malformed existing gameplay and stale revisions cannot overwrite a saved design',()=>{
 const d=populated(),valid={schema:1,designs:[d]};let raw=JSON.stringify(valid),writes=0;
 const storage={getItem:()=>raw,setItem:(_,v)=>{raw=v;writes++;}};
 for(const broken of ['{bad',JSON.stringify({schema:99,designs:[]}),JSON.stringify({...valid,designs:[d,d]}),JSON.stringify({...valid,designs:[{...d,checks:[{...d.checks[0],result:'guess'}]}]}),JSON.stringify({...valid,designs:[{...d,loop:[null]}]})]){
  raw=broken;assert.throws(()=>readGameplay(storage,'key'));assert.throws(()=>writeGameplay(storage,'key',raw,emptyGameplay()));assert.equal(raw,broken);
 }
 raw=JSON.stringify(valid);assert.throws(()=>writeGameplay(storage,'key',null,emptyGameplay()),/其他窗口/);assert.equal(writes,0);
 const prior=raw;storage.setItem=()=>{throw Error('disk full');};assert.throws(()=>writeGameplay(storage,'key',prior,emptyGameplay()),/disk full/);assert.equal(raw,prior);
});
test('AI export contains rules, prototype scope, playtest evidence and live or missing link names',()=>{
 const d=populated();d.links.push({kind:'story',targetId:'removed-story'});
 const text=gameplayMarkdown([d],sources);
 for(const phrase of ['抵挡一波敌人','已验证（已归档）','1. 收集资源','2. 建造防御','敌人每十秒出现','全歼敌人','营地被摧毁','- [x] 一个测试场地','正式美术','试玩三分钟','建立防线','完成第一波','城镇防守背景','敌人配置','关联已失效（removed-story）'])assert.ok(text.includes(phrase),phrase);
 assert.equal(gameplayLinkName(d.links[0],{...sources,stories:[{id:'story-1',title:'改名后背景'}]}),'改名后背景');
 const story={id:'story-1',title:'背景',category:'世界观',status:'草稿',summary:'',content:'',tags:[],outlines:[],relations:{characters:[],locations:[],systems:[]}};
 const markdown=buildAiMarkdown({name:'原型',genre:'',platform:'',version:'',status:'',description:''},[story],{datasets:{},columns:{}},[],{engine:'',projectPath:'',enumPath:'',dataPath:'',outputFormat:'',autoSync:false},{scan:null},[d]);
 assert.ok(markdown.includes('## 玩法设计'));assert.ok(markdown.includes('完成第一波'));assert.ok(markdown.includes('关联已失效（enemies）'));
});
