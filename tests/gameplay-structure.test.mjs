import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameplay, duplicateGameplay, validateGameplay, readGameplay, writeGameplay, gameplayMarkdown} from '../src/gameplay.ts';
import {emptyStructure,createRule,createState,createTransition,dependencyIssues,ruleIssues,stateFlowIssues,removeFlowState} from '../src/gameplay-structure.ts';
const dep=(targetId,kind='depends')=>({id:crypto.randomUUID(),targetId,kind,note:'提供植物实体'});
function fixture(){
 const a=createGameplay('战斗'),b=createGameplay('种植');a.dependencies=[dep(b.id)];const rule={...createRule(),name:'种植校验',trigger:'点击格子',mode:'all',conditions:[{id:'c1',subject:'阳光',operator:'gte',value:'成本'},{id:'c2',subject:'选中卡牌',operator:'exists',value:''}],actions:[{id:'a1',text:'扣费并种植'}],otherwise:[{id:'a2',text:'保留阳光并显示原因'}]};a.conditionRules=[rule];
 const ready={...createState(),name:'Ready'},running={...createState(),name:'Running'},won={...createState(),name:'Won',kind:'outcome'};
 a.stateFlow={initialStateId:ready.id,states:[ready,running,won],transitions:[{...createTransition(),fromId:ready.id,toId:running.id,event:'开始',action:'开始计时'},{...createTransition(),fromId:running.id,toId:won.id,event:'结算',condition:'全部生成且存活为0',priority:10},{...createTransition(),fromId:won.id,toId:ready.id,event:'重开',action:'清空场景'}]};return [a,b];
}
test('legacy schema migrates only on edit and preserves all previous content and IDs',()=>{
 const [d]=fixture();delete d.dependencies;delete d.conditionRules;delete d.stateFlow;d.rules='原规则不能丢失';d.checks=[{id:'check',question:'目标?',steps:'试玩',expected:'通过',actual:'待验证',result:'未测试'}];let raw=JSON.stringify({schema:1,designs:[d]}),writes=0;
 const storage={getItem:()=>raw,setItem:(_,v)=>{raw=v;writes++;}};const before=raw,loaded=readGameplay(storage,'gp');assert.equal(raw,before);assert.equal(writes,0);assert.equal(loaded.store.schema,2);assert.deepEqual(loaded.store.designs[0],{...emptyStructure(),...d});
 loaded.store.designs[0].conditionRules=[createRule()];writeGameplay(storage,'gp',before,loaded.store);assert.equal(JSON.parse(raw).schema,2);assert.equal(JSON.parse(raw).designs[0].rules,d.rules);assert.deepEqual(JSON.parse(raw).designs[0].checks,d.checks);
});
test('schema2 validates all nested structures without rejecting incomplete design drafts',()=>{
 const [d,b]=fixture();validateGameplay({schema:2,designs:[d,b]});
 for(const mutate of [d=>delete d.stateFlow,d=>d.dependencies[0].kind='__proto__',d=>d.conditionRules[0].conditions[0].operator='invalid',d=>d.conditionRules[0].actions.push(d.conditionRules[0].actions[0]),d=>d.stateFlow.transitions[0].priority=-1,d=>d.stateFlow.states.push(d.stateFlow.states[0])]){const x=structuredClone(d);mutate(x);assert.throws(()=>validateGameplay({schema:2,designs:[x]}));}
 const draft=createGameplay('未完成');draft.conditionRules=[createRule()];draft.stateFlow.states=[createState()];draft.stateFlow.transitions=[createTransition()];draft.dependencies=[dep('missing')];validateGameplay({schema:2,designs:[draft]});assert.ok(stateFlowIssues(draft.stateFlow).length>1);
});
test('copy remaps internal identities and state endpoints, preserving external dependency targets',()=>{
 const [d]=fixture(),before=structuredClone(d),copy=duplicateGameplay(d);const {states,transitions}=copy.stateFlow;
 assert.notEqual(copy.dependencies[0].id,d.dependencies[0].id);assert.equal(copy.dependencies[0].targetId,d.dependencies[0].targetId);assert.notEqual(copy.conditionRules[0].id,d.conditionRules[0].id);assert.notEqual(copy.conditionRules[0].conditions[0].id,d.conditionRules[0].conditions[0].id);assert.notEqual(copy.conditionRules[0].actions[0].id,d.conditionRules[0].actions[0].id);assert.notEqual(copy.conditionRules[0].otherwise[0].id,d.conditionRules[0].otherwise[0].id);
 assert.equal(copy.stateFlow.initialStateId,states[0].id);assert.notEqual(states[0].id,d.stateFlow.states[0].id);assert.equal(transitions[0].fromId,states[0].id);assert.equal(transitions[0].toId,states[1].id);assert.equal(transitions[2].toId,states[0].id);assert.deepEqual(stateFlowIssues(copy.stateFlow),[]);copy.conditionRules[0].actions[0].text='独立编辑';assert.deepEqual(d,before);
});
test('dependencies diagnose self, duplicate, missing, archived targets and cycles without dropping links',()=>{
 const [a,b]=fixture();assert.deepEqual(dependencyIssues(a,[a,b]),[]);b.dependencies=[dep(a.id)];assert.match(dependencyIssues(a,[a,b]).join(','),/依赖存在循环/);b.archived=true;a.dependencies.push(dep(b.id),dep(a.id),dep('missing'));const issues=dependencyIssues(a,[a,b]).join(',');for(const word of ['重复','自身','失效','归档','循环'])assert.ok(issues.includes(word));assert.equal(a.dependencies.length,4);
 a.dependencies=[dep(b.id,'collaborates')];b.dependencies=[dep(a.id,'collaborates')];b.archived=false;assert.deepEqual(dependencyIssues(a,[a,b]),[]);
});
test('rules distinguish unconditional ALL from incomplete ANY and validate operand/action drafts',()=>{
 const r={...createRule(),name:'校验',trigger:'点击',actions:[{id:'a',text:'记录'}]};assert.deepEqual(ruleIssues(r),[]);r.mode='any';assert.match(ruleIssues(r).join(','),/至少需要/);r.conditions=[{id:'c',subject:'目标',operator:'exists',value:''}];assert.deepEqual(ruleIssues(r),[]);r.conditions[0].operator='eq';assert.match(ruleIssues(r).join(','),/条件 1/);r.conditions[0].value='有效';r.otherwise=[{id:'b',text:''}];assert.match(ruleIssues(r).join(','),/不满足/);
});
test('flow accepts restart cycles but catches unreachable or broken paths and protects referenced states',()=>{
 const [d]=fixture(),flow=d.stateFlow;assert.deepEqual(stateFlowIssues(flow),[]);assert.throws(()=>removeFlowState(flow,flow.states[0].id),/仍被转移引用/);const isolated={...createState(),name:'孤岛'};flow.states.push(isolated);assert.match(stateFlowIssues(flow).join(','),/无法到达：孤岛/);assert.equal(removeFlowState(flow,isolated.id).states.length,3);flow.transitions[1].toId='missing';assert.match(stateFlowIssues(flow).join(','),/终点未选择或已失效/);const sole={initialStateId:isolated.id,states:[isolated],transitions:[]};assert.equal(removeFlowState(sole,isolated.id).initialStateId,'');
});
test('export resolves renamed nodes, branches, endpoint names and priorities, warning about incomplete ANY',()=>{
 const [a,b]=fixture();b.title='阳光经济';const md=gameplayMarkdown([a,b],{stories:[],datasets:[]});for(const word of ['依赖：阳光经济','反向引用','种植校验','全部满足（AND）','阳光 大于等于 成本','不满足时：','保留阳光','Ready → Running','Won → Ready','优先级：10'])assert.ok(md.includes(word),word);a.conditionRules[0].mode='any';a.conditionRules[0].conditions=[];assert.ok(gameplayMarkdown([a,b],{stories:[],datasets:[]}).includes('缺少条件，无法判断任一满足'));
});
