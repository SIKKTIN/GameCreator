import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionTask,createProductionMilestone,validateProjectSchedule,projectScheduleMarkdown} from '../src/project-schedule.ts';
import {withScheduleReleases,removeScheduleRelease,scheduleReleaseGroups,milestoneDisplayTitle} from '../src/schedule-releases.ts';
import {readLocalSchedule} from '../src/team-schedule-publish.ts';
import {scheduleChanges,emptyScheduleSnapshot,applyScheduleChanges,scheduleStructureErrors} from '../src/team-schedule-model.ts';
import {invalidateMilestoneAcceptance} from '../src/schedule-acceptance.ts';

const sample=()=>({schema:1,tasks:[{...createProductionTask('交付任务'),id:'task',milestoneId:'m1',status:'已完成',result:'已验证'}],milestones:[
  {...createProductionMilestone('v0.3.0 · M1 | 设计定稿'),id:'m1',due:'2026-10-13',description:'版本公共背景\n完整原文',status:'已验收',review:'原验收记录'},
  {...createProductionMilestone('v0.3.0 · M4 | 版本交付'),id:'m4',due:'2026-10-29',description:'版本公共背景\n完整原文'},
  {...createProductionMilestone('v0.2.0 · M1 | 灰盒'),id:'old',due:'2026-09-24',description:'本阶段独有说明'},
  {...createProductionMilestone('未定阶段'),id:'ungrouped'}
]});

test('legacy release inference is stable, lossless and read-only; explicit groups stop inference',()=>{
  const old=sample(),before=structuredClone(old),next=withScheduleReleases(old);
  assert.deepEqual(old,before);assert.deepEqual(withScheduleReleases(old),next);assert.equal(withScheduleReleases(next),next);
  assert.equal(next.releases.length,2);assert.equal(next.releases[0].description,old.milestones[0].description);
  assert.equal(next.milestones[0].description,'');assert.equal(next.milestones[2].description,'本阶段独有说明');
  assert.deepEqual(next.tasks,old.tasks);assert.equal(next.milestones[0].review,'原验收记录');assert.equal(next.milestones[0].status,'已验收');
  assert.deepEqual(next.milestones.map(m=>[m.id,m.title,m.due]),old.milestones.map(m=>[m.id,m.title,m.due]));
  assert.equal(milestoneDisplayTitle(next.milestones[0],next.releases[0]),'M1 | 设计定稿');
  const different=sample();different.milestones[1].description+='差异';const unmerged=withScheduleReleases(different);
  assert.equal(unmerged.releases[0].description,'');assert.equal(unmerged.milestones[0].description,different.milestones[0].description);
  assert.equal(withScheduleReleases({...old,releases:[]}).releases.length,0);
});

test('groups follow target dates; removing a version preserves tasks, acceptance and explicit ungrouping',()=>{
  const store=withScheduleReleases(sample()),groups=scheduleReleaseGroups(store);
  assert.deepEqual(groups.map(g=>g.release?.title??'未分组'),['v0.3.0','v0.2.0','未分组']);
  const removed=removeScheduleRelease(store,store.releases[0].id);
  assert.deepEqual(removed.tasks,store.tasks);assert.equal(removed.milestones.length,store.milestones.length);
  assert.equal(removed.milestones[0].releaseId,'');assert.equal(removed.milestones[0].review,'原验收记录');
  assert.equal(invalidateMilestoneAcceptance(store,removed).milestones[0].status,'已验收');assert.deepEqual(withScheduleReleases(removed),removed);
  assert.deepEqual(scheduleStructureErrors(removed),[]);
});

test('release validation catches malformed fields, duplicate names and cross-kind IDs',()=>{
  const store=withScheduleReleases(sample());assert.deepEqual(validateProjectSchedule(store),store);
  for(const mutate of [s=>s.releases.push({...s.releases[0],id:'other'}),s=>s.releases[0].id='m1',s=>s.releases[0].description=null,s=>s.milestones[0].releaseId=10]){
    const copy=structuredClone(store);mutate(copy);assert.throws(()=>validateProjectSchedule(copy));
  }
  const dangling=structuredClone(store);dangling.milestones[0].releaseId='missing';assert.ok(scheduleStructureErrors(dangling).includes('m1:release:missing'));
});

test('publication and collaboration changes carry releases without writing the local archive',()=>{
  const old=sample(),raw=JSON.stringify(old),storage={getItem:key=>key.endsWith(':project-schedule')?raw:null};
  const {schedule}=readLocalSchedule(storage,{id:'local',name:'发布测试',initialContent:'empty'});
  assert.deepEqual(schedule.store,withScheduleReleases(old));assert.equal(storage.getItem(':project-schedule'),raw);
  const changes=scheduleChanges(emptyScheduleSnapshot(),schedule.store);
  assert.equal(changes.filter(c=>c.kind==='release').length,2);assert.deepEqual(applyScheduleChanges(emptyScheduleSnapshot().store,changes),schedule.store);
  const markdown=projectScheduleMarkdown(schedule.store);assert.ok(markdown.includes('### 版本：v0.3.0'));assert.ok(markdown.includes('版本公共背景\n完整原文'));assert.ok(markdown.includes('所属版本：v0.3.0'));
});
