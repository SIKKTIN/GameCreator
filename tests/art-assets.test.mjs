import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createGameplay } from '../src/gameplay.ts';
import { createRule, createState } from '../src/gameplay-structure.ts';
import { createTrack, createTimelineEvent, createStageObject } from '../src/gameplay-stage.ts';
import { emptyFunctionalSystems, createFunctionalSystem, createCapability } from '../src/functional-systems.ts';
import { emptyArtAssets, createArtRequirement, createArtAsset, validateArtAssets, validateArtMutation, readArtAssets, writeArtAssets, canAdoptVersion, artRequirementReadiness, artSourceText, artIssues, artAssetsMarkdown, artReferencesMarkdown } from '../src/art-assets.ts';
const require = createRequire(import.meta.url);
const { createWorkspaceStorage } = require('../desktop/test-workspaces.cjs');
function memory(initial=null) { let raw=initial,writes=0; return {getItem:()=>raw,setItem:(_,value)=>{raw=value;writes++;},get writes(){return writes;}}; }
function version(name,placeholder=false,review='待审核') {return {id:crypto.randomUUID(),name,notes:'保持剪影清楚',placeholder,review,feedback:'',files:[{id:crypto.randomUUID(),name:name+'.png',size:128,mime:'image/png',storagePath:'opaque-project-file-token/'+crypto.randomUUID()}],createdAt:new Date().toISOString()};}
function fixture() {
 const design=createGameplay('裂隙跳跃'),rule=createRule(),state=createState(),track=createTrack(),object=createStageObject('actor',2,3);
 Object.assign(rule,{name:'冲刺时出现残影',trigger:'DashStarted',actions:[{id:'a',text:'播放残影'}]});Object.assign(state,{name:'Dashing',description:'冲刺阶段保留轮廓辨识'});track.name='动作演出';object.name='主角';object.notes='只作为角色摆位示意';
 const event=createTimelineEvent(track.id);Object.assign(event,{name:'冲刺残影有效窗',duration:.2,notes:'0.2秒逐渐消退'});design.conditionRules=[rule];design.stateFlow.states=[state];design.timeline.tracks=[track];design.timeline.events=[event];design.space.objects=[object];
 const system=createFunctionalSystem('技能系统'),capability=createCapability(system.id,'玩家冲刺');capability.purpose='跨越裂隙';const functional={...emptyFunctionalSystems(),systems:[system],capabilities:[capability]};
 const requirement=createArtRequirement('冲刺视觉需求');Object.assign(requirement,{category:'特效',description:'短距离水平冲刺的视觉表达',specification:'透明背景，面向左右；尺寸由角色规格决定',acceptance:'0.2秒窗口可读，不遮挡危险物',owner:'美术A',dueDate:'2026-10-01',priority:'高'});
 requirement.sources=[{id:'source-design',kind:'gameplay',targetId:design.id,sourceKind:'design',sourceId:'',note:'教学场景需要读懂动作'},{id:'source-capability',kind:'capability',targetId:capability.id,sourceKind:'design',sourceId:'',note:'使用同一玩家冲刺能力'}];
 const asset=createArtAsset('主角残影'),placeholder=version('灰盒占位',true),formal=version('正式版',false,'已通过');asset.description='可被教学和首领战共用的残影资源';asset.versions=[placeholder,formal];asset.adoptedVersionId=placeholder.id;
 const store={...emptyArtAssets(),requirements:[requirement],assets:[asset],links:[{id:'link',requirementId:requirement.id,assetId:asset.id,note:'动作开始后播放'}]};
 return {store,sources:{designs:[design],functional},requirement,asset,placeholder,formal,design,capability,rule,state,event,object};
}
function commit(store) {const storage=memory();const raw=writeArtAssets(storage,'key',null,store);return {storage,raw};}

test('names create independent empty art requirements and assets without implicitly approving anything',()=>{
 const requirement=createArtRequirement('  玩家立绘  '),asset=createArtAsset(' 主角贴图 ');assert.equal(requirement.name,'玩家立绘');assert.equal(requirement.status,'待制作');assert.equal(requirement.category,'其他');assert.equal(requirement.archived,false);assert.deepEqual(requirement.sources,[]);assert.equal(asset.adoptedVersionId,'');assert.deepEqual(asset.versions,[]);assert.notEqual(asset.id,createArtAsset('主角贴图').id);assert.throws(()=>createArtRequirement(' '));assert.throws(()=>createArtAsset(' '));
 const storage=memory();assert.deepEqual(readArtAssets(storage,'empty').store,emptyArtAssets());assert.equal(storage.writes,0);
});

test('strict shape checks reject corrupt archives while retaining unresolved foreign references',()=>{
 const {store,sources}=fixture();
 for(const change of [s=>{s.schema=2;},s=>{delete s.links;},s=>{s.requirements[0].dueDate='2026-02-30';},s=>{s.requirements[0].status='草稿';},s=>{s.assets[0].versions[0].review='通过';},s=>{s.assets[0].versions[0].files[0].size=-1;},s=>{s.assets[0].versions[0].files[0].storagePath='';},s=>{s.assets[0].versions.push(s.assets[0].versions[0]);},s=>{s.requirements[0].sources[1].sourceKind='object';},s=>{s.requirements[0].sources[0].sourceId='unexpected';}]) {
  const broken=structuredClone(store);change(broken);const raw=JSON.stringify(broken),storage=memory(raw);assert.throws(()=>readArtAssets(storage,'key'),/格式异常/);assert.throws(()=>writeArtAssets(storage,'key',raw,emptyArtAssets()),/格式异常/);assert.equal(storage.getItem(),raw);assert.equal(storage.writes,0);
 }
 const storage=memory('{invalid');assert.throws(()=>writeArtAssets(storage,'key','{invalid',store));assert.equal(storage.getItem(),'{invalid');
 const stale=structuredClone(store);stale.requirements[0].sources[0].targetId='missing-design';stale.links[0].assetId='missing-asset';stale.assets[0].adoptedVersionId='missing-version';assert.deepEqual(validateArtAssets(stale),stale);const issues=artIssues(stale,sources).join('\n');for(const phrase of ['玩法来源已失效','关联资产已失效','采用版本已失效'])assert.ok(issues.includes(phrase),phrase);
});

test('disk stores remain isolated across projects, test workspaces and restarts',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'gamecreator-art-'));
 try {
  const {store}=fixture(),storage=createWorkspaceStorage(directory),a='gamecreator.workspace.v1:project-a:art-assets',b='gamecreator.workspace.v1:project-b:art-assets',testId=crypto.randomUUID();
  const testKey='gamecreator.workspace.v1:'+path.join(directory,'test-workspaces',testId,'project').replaceAll('\\','/').toLowerCase()+':art-assets';
  const raw=writeArtAssets(storage,a,null,store);writeArtAssets(storage,b,null,emptyArtAssets());writeArtAssets(storage,testKey,null,{...emptyArtAssets(),requirements:[createArtRequirement('测试美术')]});assert.equal(storage.getItem(a),raw);assert.ok(storage.info(testKey).directory.includes(testId));
  const reopened=createWorkspaceStorage(directory);assert.deepEqual(readArtAssets(reopened,a).store,store);assert.equal(readArtAssets(reopened,b).store.assets.length,0);assert.equal(readArtAssets(reopened,testKey).store.requirements[0].name,'测试美术');
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('stale writes and file system failure never overwrite a committed art archive and can retry',()=>{
 const {store}=fixture(),{storage,raw}=commit(store),next=structuredClone(store);next.requirements[0].description='新制作说明';assert.throws(()=>writeArtAssets(storage,'key',null,next),/其他窗口/);assert.equal(storage.getItem(),raw);
 assert.throws(()=>writeArtAssets({getItem:storage.getItem,setItem:()=>{throw Error('disk full');}},'key',raw,next),/disk full/);assert.equal(storage.getItem(),raw);writeArtAssets(storage,'key',raw,next);assert.equal(readArtAssets(storage,'key').store.requirements[0].description,'新制作说明');
});

test('placeholder adoption supports prototypes but formal pending or empty versions cannot be adopted',()=>{
 const {store,asset,placeholder,formal}=fixture();assert.equal(canAdoptVersion(placeholder),true);assert.equal(canAdoptVersion(formal),true);assert.equal(artRequirementReadiness(store.requirements[0].id,store).ready,false);
 const pending=version('待审正式版'),empty={...version('空占位版',true),files:[]};assert.equal(canAdoptVersion(pending),false);assert.equal(canAdoptVersion(empty),false);
 const {storage,raw}=commit(store);for(const rejected of [pending,empty]){const next=structuredClone(store);next.assets[0].versions.push(rejected);next.assets[0].adoptedVersionId=rejected.id;assert.throws(()=>writeArtAssets(storage,'key',raw,next),/只能采用/);assert.equal(storage.getItem(),raw);}
 const approved=structuredClone(store);approved.assets[0].adoptedVersionId=formal.id;writeArtAssets(storage,'key',raw,approved);assert.equal(readArtAssets(storage,'key').store.assets[0].adoptedVersionId,formal.id);assert.equal(asset.versions.length,2);
});

test('document completion does not require imported, linked or adopted files',()=>{
 const {store,sources}=fixture(),next=structuredClone(store);next.requirements[0].status='已通过';validateArtMutation(store,next);
 next.links=[];validateArtMutation(store,next);assert.equal(artIssues(next,sources).length,0);
 const empty={...emptyArtAssets(),requirements:[createArtRequirement('工程内交付')]};const done=structuredClone(empty);done.requirements[0].status='已通过';validateArtMutation(empty,done);
});

test('historical adoption and resource reuse are independent from production completion',()=>{
 const {store,formal}=fixture();store.assets[0].adoptedVersionId=formal.id;store.requirements[0].status='已通过';
 const next=structuredClone(store);next.assets[0].adoptedVersionId='';next.links=[];validateArtMutation(store,next);
 assert.equal(next.requirements[0].status,'已通过');assert.deepEqual(next.assets[0].versions,store.assets[0].versions);
});

test('adopted formal review cannot be withdrawn before canceling adoption',()=>{
 const {store,formal}=fixture();store.assets[0].adoptedVersionId=formal.id;const {storage,raw}=commit(store),next=structuredClone(store);next.assets[0].versions[1].review='需修改';assert.throws(()=>writeArtAssets(storage,'key',raw,next),/先取消采用/);assert.equal(storage.getItem(),raw);
 const canceled=structuredClone(store);canceled.assets[0].adoptedVersionId='';const saved=writeArtAssets(storage,'key',raw,canceled);canceled.assets[0].versions[1].review='需修改';canceled.assets[0].versions[1].feedback='边缘需要清理';writeArtAssets(storage,'key',saved,canceled);assert.equal(readArtAssets(storage,'key').store.assets[0].versions[1].feedback,'边缘需要清理');
});

test('version content and files are immutable, while reviews and feedback remain editable',()=>{
 const {store}=fixture(),{storage,raw}=commit(store);
 for(const mutate of [v=>{v.name='改名';},v=>{v.notes='覆盖内容';},v=>{v.placeholder=false;},v=>{v.files[0].storagePath='new-token';},v=>{v.files[0].name='replace.png';},v=>{v.files=[];},v=>{v.createdAt='2026-01-01T00:00:00.000Z';}]){const next=structuredClone(store);mutate(next.assets[0].versions[0]);assert.throws(()=>writeArtAssets(storage,'key',raw,next),/上传新增版本/);assert.equal(storage.getItem(),raw);}
 const removed=structuredClone(store);removed.assets[0].versions.pop();assert.throws(()=>writeArtAssets(storage,'key',raw,removed),/上传新增版本/);
 const next=structuredClone(store);next.assets[0].versions[0].review='需修改';next.assets[0].versions[0].feedback='占位剪影不够明显';next.assets[0].versions.push(version('v3新文件',false));writeArtAssets(storage,'key',raw,next);const saved=readArtAssets(storage,'key').store;assert.equal(saved.assets[0].versions.length,3);assert.deepEqual(saved.assets[0].versions[0].files,store.assets[0].versions[0].files);
});

test('archiving preserves history and completed evidence but makes content and relationships read-only',()=>{
 const {store,formal}=fixture();store.assets[0].adoptedVersionId=formal.id;store.requirements[0].status='已通过';const {storage,raw}=commit(store);const archived=structuredClone(store);archived.assets[0].archived=true;archived.requirements[0].archived=true;const saved=writeArtAssets(storage,'key',raw,archived);assert.equal(artRequirementReadiness(archived.requirements[0].id,archived).ready,true);
 for(const mutate of [s=>{s.assets[0].description='不能覆盖';},s=>{s.requirements[0].owner='不能改负责人';},s=>{s.links[0].note='不能改关联';},s=>{s.links=[];},s=>{const r=createArtRequirement('新需求');s.requirements.push(r);s.links.push({id:'new',requirementId:r.id,assetId:s.assets[0].id,note:''});}]){const next=structuredClone(archived);mutate(next);assert.throws(()=>writeArtAssets(storage,'key',saved,next),/已归档/);assert.equal(storage.getItem(),saved);}
 archived.assets[0].archived=false;archived.requirements[0].archived=false;const restored=writeArtAssets(storage,'key',saved,archived);archived.assets[0].description='恢复后编辑';writeArtAssets(storage,'key',restored,archived);assert.equal(readArtAssets(storage,'key').store.assets[0].description,'恢复后编辑');
 for(const field of ['assets','requirements']){const next=structuredClone(archived);next[field]=[];assert.throws(()=>validateArtMutation(archived,next),/使用归档/);}
});

test('source references resolve renamed rules, states, events, objects and capabilities by stable IDs',()=>{
 const {store,sources,requirement,design,rule,state,event,object,capability}=fixture();
 requirement.sources.push(...[['rule',rule.id],['state',state.id],['event',event.id],['object',object.id]].map(([sourceKind,sourceId],i)=>({id:'specific'+i,kind:'gameplay',targetId:design.id,sourceKind,sourceId,note:'具体表现需求'})));
 object.name='骑士轮廓';event.name='残影窗口新版';capability.name='短程冲刺';const text=artAssetsMarkdown(store,sources);for(const phrase of ['骑士轮廓','残影窗口新版','短程冲刺','播放残影','持续 0.2 秒','R2 / C3'])assert.ok(text.includes(phrase),phrase);
 assert.ok(artSourceText(requirement.sources[1],sources).includes('短程冲刺'));design.archived=true;sources.functional.systems[0].archived=true;design.space.objects=[];const issues=artIssues(store,sources).join('\n');for(const phrase of ['玩法来源已归档','功能来源已归档','空间对象来源已失效'])assert.ok(issues.includes(phrase),phrase);
 assert.equal(validateArtAssets(store).requirements[0].sources.length,6);assert.ok(artReferencesMarkdown('capability',capability.id,store,sources).includes(requirement.id));
});

test('multiple requirements can share assets and export complete definitions once with reverse references',()=>{
 const {store,sources,requirement,asset,design,capability}=fixture(),other=createArtRequirement('首领房冲刺表现');other.sources=[{id:'other-source',kind:'gameplay',targetId:design.id,sourceKind:'design',sourceId:'',note:'战斗中复用'}];store.requirements.push(other);store.links.push({id:'other-link',requirementId:other.id,assetId:asset.id,note:'共享同一视觉资产'});
 const markdown=artAssetsMarkdown(store,sources);assert.equal(markdown.split('#### 主角残影\n').length-1,1);assert.equal(markdown.split('#### 冲刺视觉需求\n').length-1,1);for(const phrase of ['制作规格','透明背景','0.2秒窗口可读','美术A','2026-10-01','灰盒占位','正式版','共享同一视觉资产','版本历史','存储标识','服务需求'])assert.ok(markdown.includes(phrase),phrase);
 const refs=artReferencesMarkdown('gameplay',design.id,store,sources);assert.ok(refs.includes(requirement.id));assert.ok(refs.includes(other.id));assert.ok(refs.includes(asset.id));assert.ok(!refs.includes('透明背景'));
 assert.ok(artReferencesMarkdown('capability',capability.id,store,sources).includes('冲刺视觉需求'));assert.deepEqual(artIssues(store,sources),[]);
});

test('unresolved links keep their explanatory notes and duplicate associations cannot be added',()=>{
 const {store,sources}=fixture();const duplicates=structuredClone(store);duplicates.links.push({...duplicates.links[0],id:'duplicate'});assert.throws(()=>validateArtMutation(store,duplicates),/重复关联/);assert.ok(artIssues(duplicates,sources).some(i=>i.includes('重复需求资产关联')));
 store.links.push({id:'lost',requirementId:'missing-req',assetId:'missing-asset',note:'需要人工重新关联的原始说明'});assert.ok(artAssetsMarkdown(store,sources).includes('需要人工重新关联的原始说明'));validateArtAssets(store);
});
