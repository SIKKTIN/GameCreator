import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createProductionTask,createProductionMilestone} from '../src/project-schedule.ts';
import {createDevelopmentTool,validateDevelopmentTools} from '../src/development-tools.ts';
import {milestoneAcceptance,acceptProductionMilestone,invalidateMilestoneAcceptance,reconcileToolAcceptance} from '../src/schedule-acceptance.ts';

test('milestone acceptance requires nonempty completed work, keeps evidence and cannot double-accept',()=>{
 const m=createProductionMilestone('工具链'),a={...createProductionTask('开发'),milestoneId:m.id,status:'已完成'},b={...createProductionTask('测试'),milestoneId:m.id,status:'待验收'},s={schema:1,tasks:[a,b],milestones:[{...m,review:'原验收记录'}]};
 assert.equal(milestoneAcceptance(s,m.id).ready,false);assert.throws(()=>acceptProductionMilestone(s,m.id,'','2026-09-23'),/尚未全部完成/);
 assert.throws(()=>acceptProductionMilestone({...s,tasks:[]},m.id,'','2026-09-23'),/尚未全部完成/);
 const done={...s,tasks:s.tasks.map(t=>({...t,status:'已完成'}))},accepted=acceptProductionMilestone(done,m.id,'交付入口验证通过','2026-09-23');
 assert.equal(accepted.milestones[0].status,'已验收');assert.match(accepted.milestones[0].review,/原验收记录\n2026-09-23.*2 项.*交付入口验证通过/);assert.equal(s.milestones[0].status,'计划中');
 assert.throws(()=>acceptProductionMilestone(accepted,m.id,'','2026-09-23'),/已经验收/);
 const reopened=invalidateMilestoneAcceptance(accepted,{...accepted,tasks:[{...a,status:'进行中'},accepted.tasks[1]]});assert.equal(reopened.milestones[0].status,'进行中');assert.equal(reopened.milestones[0].review,accepted.milestones[0].review);
 const finished=invalidateMilestoneAcceptance(reopened,{...reopened,tasks:done.tasks});assert.equal(finished.milestones[0].status,'进行中');
 assert.equal(invalidateMilestoneAcceptance(accepted,{...accepted,tasks:[]}).milestones[0].status,'进行中');
 assert.equal(invalidateMilestoneAcceptance(accepted,{...accepted,tasks:accepted.tasks.map(t=>({...t,owner:'新负责人'}))}).milestones[0].status,'已验收');
});

test('all linked tasks gate tool readiness; old PVZ completions repair without replacing delivery/history',async()=>{
 const example=JSON.parse(await readFile(new URL('../examples/prototypes/plants-vs-zombies.json',import.meta.url),'utf8'));
 const store=structuredClone(example.developmentTools);store.tools.forEach(t=>{t.status='待验收';t.usage='原入口';t.delivery='原交付';});store.feedbackHistory=[];
 const schedule=structuredClone(example.projectSchedule);schedule.tasks.forEach(t=>t.status='已完成');
 const before=structuredClone(store),next=reconcileToolAcceptance(store,schedule);assert.ok(next.tools.every(t=>t.status==='可使用'));assert.deepEqual(store,before);assert.ok(next.tools.every(t=>t.usage==='原入口'&&t.delivery==='原交付'&&t.scheduleAcceptance.taskIds.length>1));assert.equal(next.feedbackHistory,store.feedbackHistory);
 assert.equal(reconcileToolAcceptance(next,schedule),next);validateDevelopmentTools(JSON.parse(JSON.stringify(next)));
 const testTask=schedule.tasks.find(t=>t.references.filter(r=>r.kind==='tool').length===3&&t.kind==='测试');testTask.status='待验收';
 const again=reconcileToolAcceptance(next,schedule);assert.ok(again.tools.every(t=>t.status==='待验收'&&!t.scheduleAcceptance));assert.equal(reconcileToolAcceptance(again,schedule),again);
});

test('unrelated work, disabled, archived and manually available tools keep their states',()=>{
 const tool=createDevelopmentTool('工具'),tasks=[{...createProductionTask('实现'),status:'已完成',references:[{kind:'tool',targetId:tool.id}]},{...createProductionTask('验证'),references:[{kind:'tool',targetId:tool.id}]}],schedule={schema:1,tasks,milestones:[]};
 const store={schema:1,tools:[tool]};assert.equal(reconcileToolAcceptance(store,schedule),store);
 tasks[1].status='已完成';tasks.push(createProductionTask('其他任务'));
 assert.equal(reconcileToolAcceptance(store,schedule).tools[0].status,'可使用');
 for(const values of [{status:'停用'},{archived:true},{status:'可使用'}]){const untouched={...store,tools:[{...tool,...values}]};assert.equal(reconcileToolAcceptance(untouched,schedule),untouched);}
 const managed=reconcileToolAcceptance(store,schedule);assert.equal(reconcileToolAcceptance(managed,{...schedule,tasks:[]}).tools[0].status,'待验收');
 assert.throws(()=>validateDevelopmentTools({...store,tools:[{...tool,scheduleAcceptance:{taskIds:['a','a']}}]}),/格式异常/);
});
