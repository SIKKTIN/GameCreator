import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {emptyArtAssets,createArtRequirement,createArtAsset,validateArtAssets,validateArtMutation,artAssetsMarkdown} from '../src/art-assets.ts';
import {emptyProjectSchedule,createProductionTask} from '../src/project-schedule.ts';
import {materialProductionTasks,materialTaskStatus,reconcileMaterialProgress} from '../src/material-progress.ts';
import {materialItems,addMaterialRequirements} from '../src/material-items.ts';
import {defaultSyncSettings} from '../shared/engine-sync.mjs';
const task=(kind,id,status='待开始')=>({...createProductionTask('美术任务'),kind:'美术',status,references:[{kind,targetId:id}]});
function fixture(){const r=createArtRequirement('角色'),other=createArtRequirement('另一用途'),a=createArtAsset('共用角色资源');return {schema:1,requirements:[r,other],assets:[a],links:[r,other].map((r,i)=>({id:'l'+i,requirementId:r.id,assetId:a.id,note:''}))};}
test('completed baseline repairs 20 PvZ materials, preserving future work and legacy content',()=>{
 const example=JSON.parse(fs.readFileSync(new URL('../examples/prototypes/plants-vs-zombies.json',import.meta.url)));
 const store=example.artAssets,schedule=example.projectSchedule,extra=createArtRequirement('后续多关 UI');store.requirements.push(extra);schedule.tasks.push(task('requirement',extra.id));
 schedule.tasks.filter(t=>t.kind==='美术'&&t.references.some(r=>r.kind==='requirement'&&r.targetId!==extra.id)).forEach(t=>t.status='已完成');
 const before=structuredClone(store),next=reconcileMaterialProgress(store,schedule,'2026-09-23T00:00:00.000Z');validateArtMutation(store,next);
 assert.equal(next.requirements.filter(r=>r.status==='已通过').length,20);assert.equal(next.requirements.at(-1).status,'待制作');
 assert.deepEqual(next.assets.map(a=>a.versions),store.assets.map(a=>a.versions));assert.deepEqual(next.links,store.links);assert.deepEqual(next.library,store.library);assert.deepEqual(store,before);
 assert.equal(reconcileMaterialProgress(next,schedule),next);assert.ok(next.requirements.slice(0,20).every(r=>r.scheduleProgress.taskIds.length));
});
test('explicit art references gate progress; code tasks and similarly named tasks do not',()=>{
 const s=fixture(),r=s.requirements[0],schedule=emptyProjectSchedule();schedule.tasks=[task('requirement',r.id,'已完成'),{...task('requirement',r.id,'受阻'),kind:'程序'},task('requirement','missing','受阻')];
 const next=reconcileMaterialProgress(s,schedule);assert.equal(next.requirements[0].status,'已通过');assert.equal(next.requirements[1].status,'待制作');assert.equal(next.requirements[1].scheduleProgress,undefined);assert.equal(next.assets[0].productionStatus,'已通过');
 schedule.tasks.push(task('requirement',s.requirements[1].id,'待开始'));
 const shared=reconcileMaterialProgress(next,schedule);assert.equal(shared.requirements[0].status,'已通过');assert.equal(shared.assets[0].productionStatus,'制作中');
 schedule.tasks.push(task('asset',s.assets[0].id,'受阻'));
 const blocked=reconcileMaterialProgress(shared,schedule);assert.equal(blocked.requirements[0].status,'需修改');assert.equal(blocked.requirements[1].status,'需修改');assert.equal(blocked.assets[0].productionStatus,'需修改');
 assert.equal(materialProductionTasks(s,schedule,{kind:'requirement',id:r.id}).length,2);
});
test('all task states, multi-task completion, reopen, archiving and unlinking preserve intent',()=>{
 for(const [statuses,expected] of [[[],'待制作'],[['待开始'],'待制作'],[['进行中','待开始'],'制作中'],[['待验收','已完成'],'待审核'],[['已完成','待开始'],'制作中'],[['已完成','已完成'],'已通过'],[['受阻','已完成'],'需修改']])assert.equal(materialTaskStatus(statuses.map(status=>task('requirement','r',status))),expected);
 const store=fixture(),r=store.requirements[0],schedule={...emptyProjectSchedule(),tasks:[task('requirement',r.id,'已完成')]};const done=reconcileMaterialProgress(store,schedule);
 schedule.tasks[0].status='进行中';const reopened=reconcileMaterialProgress(done,schedule);assert.equal(reopened.requirements[0].status,'制作中');assert.equal(reopened.assets[0].productionStatus,'制作中');
 const archived=structuredClone(done);archived.requirements[0].archived=true;archived.assets[0].archived=true;assert.equal(reconcileMaterialProgress(archived,schedule),archived);
 const manual=reconcileMaterialProgress(done,emptyProjectSchedule());assert.equal(manual.requirements[0].status,'已通过');assert.equal(manual.requirements[0].scheduleProgress,undefined);validateArtMutation(done,manual);
});
test('delivery documentation validates, exports and survives standalone conversion without image requirements',()=>{
 const store=emptyArtAssets(),a=createArtAsset('工程贴图');a.productionStatus='已通过';a.delivery={path:'assets/characters/sunflower/',notes:'场景验证通过\n源文件位于同目录'};store.assets.push(a);
 validateArtAssets(store);assert.equal(materialItems(store)[0].status,'已通过');assert.match(materialItems(store)[0].searchText,/sunflower/);
 const next=addMaterialRequirements(store,a.id).store;assert.equal(next.requirements[0].status,'已通过');assert.deepEqual(next.requirements[0].delivery,a.delivery);validateArtMutation(store,next);
 const md=artAssetsMarkdown(next,{designs:[],functional:{schema:1,systems:[],capabilities:[],bindings:[]}});assert.match(md,/工程内交付路径：assets\/characters\/sunflower/);assert.match(md,/状态：已完成/);assert.doesNotMatch(md,/正式版本就绪检查/);assert.deepEqual(JSON.parse(JSON.stringify(next)),next);
 for(const change of [a=>a.delivery.path=2,a=>a.delivery.notes=null,a=>a.productionStatus='unknown',a=>a.scheduleProgress={taskIds:['x','x']},a=>a.scheduleProgress={taskIds:[]},a=>a.delivery=[]]){const bad=structuredClone(store);change(bad.assets[0]);assert.throws(()=>validateArtAssets(bad));}
 assert.equal(defaultSyncSettings.assets,false,'new projects deliver docs by default, not legacy binary versions');
});
