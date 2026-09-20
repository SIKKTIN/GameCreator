import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createNarrative, validateStoryOrchestration, narrativeIssues, copyNarrative, removeNarrativeNode, readStoryOrchestration, writeStoryOrchestration, storyOrchestrationMarkdown } from '../src/story-orchestration.ts';
import { importDiscoStory } from '../src/story-import-config.ts';
import { startStory, chooseStoryOption, rewindStory, visibleStoryChoices, choiceBlockReason } from '../src/story-playthrough.ts';
const example = JSON.parse(await fs.readFile(new URL('../examples/prototypes/disco-elysium.json',import.meta.url),'utf8'));
const story = example.storyOrchestration.stories[0];
const store = () => structuredClone(example.storyOrchestration);
function walk(initial={}) {
  let preview=startStory(story,initial);
  return { get preview(){return preview;}, get node(){return preview.current.nodeId;}, get state(){return preview.current.state;}, step(id,result='success'){preview=chooseStoryOption(story,preview,id,result);return preview;}, set(p){preview=p;}, option(label){return visibleStoryChoices(story,preview.current).find(x=>x.choice.label===label&&!x.reason)?.choice.id;} };
}
function toYard(w) { w.step('begin'); assert.equal(w.node,'yard_voice'); w.step('doubt_voice'); w.step('leave_thought_hint'); w.step('visit-yard'); assert.equal(w.node,'yard_hub'); }
function until(w,time){while(w.state.elapsed<time)w.step('wait-half-hour');}
test('optional module defaults off and bundled story preserves all authored text, choices, checks and valid task references',()=>{
  assert.equal(example.storyOrchestration.enabled,false);assert.equal(story.nodes.length,37);assert.equal(story.choices.length,76);assert.equal(story.checks.length,5);
  validateStoryOrchestration(store()); assert.deepEqual(narrativeIssues(story,example.taskFlows.tasks),[]);
  const before=JSON.stringify(example.data), imported=importDiscoStory(example.data,example.taskFlows.tasks.map(t=>t.id));
  for(const n of example.data.datasets.de_dialogue_nodes)assert.equal(imported.nodes.find(x=>x.id===n.id).text,n.text);
  for(const c of example.data.datasets.de_dialogue_options)assert.ok(imported.choices.some(x=>x.id===c.id&&x.label===c.label));
  assert.equal(JSON.stringify(example.data),before);
});
test('full direct reading route reaches truth using real choices, schedule gates, check results and objective evidence',()=>{
  const w=walk(), before=JSON.stringify(story); toYard(w); w.step('rope_try');w.step('leave_rope_success');
  assert.match(choiceBlockReason(story,w.preview.current,story.choices.find(c=>c.id==='visit-clerk')),/累计游戏秒/);
  until(w,32400);w.step('visit-clerk');w.step('read_ledger');w.step('leave_ledger_success');w.step('visit-witness');
  assert.equal(w.node,'witness_voice');w.step('leave_witness_voice');w.step('testimony_try');w.step('leave_witness_success');w.step('return-report');
  const id=w.option('提交交叉验证后的事故报告');assert.ok(id);w.step(id);assert.equal(w.node,'report_true');assert.equal(w.state.case_closed,1);assert.equal(w.preview.current.tasks['de-task-case'],'completed');
  assert.ok(w.preview.current.visited.includes('yard_hub'));assert.ok(w.preview.current.visited.includes('yard_voice'));assert.equal(JSON.stringify(story),before);
});
test('failed checks retain a complete alternative story route through partner assistance, a red failure and the evening clinic',()=>{
  const w=walk();toYard(w);w.step('rope_try','failure');assert.equal(w.state.health,2);w.step('partner_rope');w.step('leave_rope_success');until(w,32400);
  w.step('visit-foreman');assert.equal(w.node,'foreman_voice');w.step('pressure_from_voice','failure');assert.equal(w.state.note_found,1);assert.equal(w.state.partner_trust,-1);w.step('leave_foreman_failure');
  until(w,64800);w.step('visit-doctor');w.step('doctor_copy');w.step('leave_copy_node');w.step('return-report');w.step(w.option('提交交叉验证后的事故报告'));
  assert.equal(w.node,'report_true');assert.equal(w.state.ledger_found,0);assert.equal(w.state.testimony_found,0);assert.ok(w.state.elapsed<165600);
});
test('a hypothesis can lead to a completed misjudgment, while postponement is suspended and no evidence is fabricated',()=>{
  const w=walk();w.step('begin');w.step('believe_voice');for(const c of example.data.datasets.de_clues)assert.equal(w.state[c.state],0);
  w.step('return-report');assert.equal(w.option('提交交叉验证后的事故报告'),undefined);w.step('wrong_report');assert.equal(w.node,'report_wrong');assert.equal(w.preview.current.tasks['de-task-case'],'completed');
  const p=walk();p.step('leave_opening');p.step('return-report');p.step('pause_report');assert.equal(p.node,'report_pause');assert.equal(p.preview.current.tasks['de-task-case'],'suspended');
});
test('white retries require a newly acquired source, red checks share one ledger, and rereading cannot duplicate costs or rewards',()=>{
  const w=walk();toYard(w);w.step('rope_try','failure');w.step('leave_rope_failure');w.step('visit-yard');
  const snap=JSON.stringify(w.preview);assert.throws(()=>w.step('rope_try'),/重试来源/);assert.equal(JSON.stringify(w.preview),snap);
  w.step('leave_yard_hub');w.step('equip-scarf');w.step('visit-yard');w.step('rope_try');w.step('leave_rope_success');w.step('visit-yard');const time=w.state.elapsed;w.step('rope_try','failure');assert.equal(w.node,'rope_success');assert.equal(w.state.elapsed,time);
  w.step('leave_rope_success');until(w,32400);w.step('visit-foreman');w.step('pressure_from_voice','failure');w.step('leave_foreman_failure');w.step('visit-foreman');
  const state=structuredClone(w.state);w.step('pressure_try','success');assert.equal(w.node,'foreman_failure');assert.deepEqual(w.state,state);
});
test('time advances atomically, deadline leaves only reports, and recovery resumes the existing check result without rerolling',()=>{
  const w=walk({elapsed:165500});w.step('leave_opening');w.step('wait-half-hour');assert.equal(w.state.elapsed,165600);assert.equal(w.node,'report_hub');w.step('pause_report');assert.equal(w.node,'report_pause');
  const r=walk({health:1});toYard(r);r.step('rope_try','failure');assert.equal(r.node,'recovery');assert.equal(r.state.health,0);const time=r.state.elapsed;r.step('recover-health');assert.equal(r.node,'rope_failure');assert.equal(r.state.health,2);assert.equal(r.state.meds,0);assert.equal(r.state.elapsed,time);assert.equal(r.preview.current.checks.rope.result,'failure');
  const previous=rewindStory(r.preview);assert.equal(previous.current.nodeId,'recovery');assert.equal(previous.current.state.meds,1);assert.equal(previous.current.state.health,0);
  const both=walk({health:0,morale:0,meds:2});assert.equal(both.node,'recovery');both.step('recover-health');assert.equal(both.node,'recovery');both.step('recover-morale');assert.equal(both.node,'opening');
});
test('invalid or unaffordable choices are pure failures; automatic loops are bounded',()=>{
  const w=walk({money:0});w.step('host_chat');w.step('ask_rent');const before=JSON.stringify(w.preview);assert.throws(()=>w.step('pay_rent'));assert.equal(JSON.stringify(w.preview),before);
  const s=structuredClone(story);s.choices.find(c=>c.id==='host_chat').effects=[{variableId:'money',op:'add',value:-100}];const p=startStory(s);assert.throws(()=>chooseStoryOption(s,p,'host_chat'),/状态不足/);assert.equal(p.current.state.money,12);
  s.choices.find(c=>c.id==='host_chat').effects=[];s.choices.find(c=>c.id==='host_chat').toId='missing';assert.throws(()=>chooseStoryOption(s,p,'host_chat'),/后继片段/);
  const cyclic=structuredClone(story);cyclic.nodes.find(n=>n.id==='host_hub').kind='return';cyclic.interrupts=[{id:'cycle',name:'循环',condition:{groups:[]},nodeId:'host_hub'}];assert.throws(()=>startStory(cyclic),/100步/);
});
test('2d6 respects natural success/failure and conditional modifiers, OR equivalent reports appear once',()=>{
  const fail=walk({'skill:endurance':100});toYard(fail);fail.step('rope_try',[1,1]);assert.equal(fail.node,'rope_failure');
  const pass=walk({'skill:endurance':0});toYard(pass);pass.step('rope_try',[6,6]);assert.equal(pass.node,'rope_success');
  const p=walk({rope_found:1,ledger_found:1,copy_found:1,testimony_found:1,note_found:1});p.step('leave_opening');p.step('return-report');assert.equal(visibleStoryChoices(story,p.preview.current).filter(x=>x.choice.label==='提交交叉验证后的事故报告').length,1);
});
test('shape validation blocks corrupt archives while missing references remain repairable; disabling retains content',()=>{
  for(const mutate of [s=>s.schema=2,s=>s.enabled='yes',s=>s.stories[0].variables[0].initial=NaN,s=>s.stories[0].choices[0].condition.groups[0].push({variableId:'x',op:'eval',value:1}),s=>s.stories[0].nodes[1].id=s.stories[0].nodes[0].id]){const s=store();mutate(s);assert.throws(()=>validateStoryOrchestration(s));}
  const s=store();s.stories[0].choices[0].toId='missing';assert.equal(validateStoryOrchestration(s),s);assert.ok(narrativeIssues(s.stories[0]).some(i=>/后继/.test(i.message)));
  const raw=new Map(),storage={getItem:k=>raw.get(k)??null,setItem:(k,v)=>raw.set(k,v)};assert.equal(readStoryOrchestration(storage,'a').store.enabled,false);assert.equal(raw.size,0);
  const first=writeStoryOrchestration(storage,'a',null,{...store(),enabled:true});assert.throws(()=>writeStoryOrchestration(storage,'a',null,store()),/其他窗口/);
  writeStoryOrchestration(storage,'a',first,store());assert.deepEqual(readStoryOrchestration(storage,'a').store.stories,store().stories);
  raw.set('a','{"schema":99}');assert.throws(()=>writeStoryOrchestration(storage,'a',raw.get('a'),store()));assert.equal(raw.get('a'),'{"schema":99}');
});
test('copy gives an independent namespace; active AI export contains every passage, conditional route and narrative outcome',()=>{
  const copied=copyNarrative(story);assert.notEqual(copied.id,story.id);copied.nodes[0].text='独立正文';assert.notEqual(story.nodes[0].text,copied.nodes[0].text);
  assert.throws(()=>removeNarrativeNode(story,story.entryId),/先调整/);
  const empty=createNarrative('新故事');assert.equal(narrativeIssues(empty).length,2);
  assert.equal(storyOrchestrationMarkdown(store()),'');const md=storyOrchestrationMarkdown({...store(),enabled:true});for(const n of story.nodes)assert.ok(md.includes(n.text));for(const c of story.choices)assert.ok(md.includes(c.label));assert.match(md,/任务状态：suspended/);
  assert.match(md,/任务状态：completed；目标：de-task-rent/);for(const actor of story.actors)assert.ok(md.includes(actor.description));
  const broken=store();broken.enabled=true;broken.stories[0].nodes[0].sceneId='lost-scene';const draft=storyOrchestrationMarkdown(broken);assert.ok(draft.includes(story.nodes[0].text));assert.match(draft,/失效场景：lost-scene/);
});
