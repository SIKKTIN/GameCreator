import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createGameplay } from '../src/gameplay.ts';
import { createRule, createState } from '../src/gameplay-structure.ts';
import { createTrack, createTimelineEvent } from '../src/gameplay-stage.ts';
import {
  emptyFunctionalSystems, createFunctionalSystem, createCapability, validateFunctionalSystems, readFunctionalSystems, writeFunctionalSystems,
  removeFunctionalSystem, removeCapability, functionalIssues, configReferenceText, usageSourceText, functionalSystemsMarkdown, gameplayFunctionalMarkdown,
} from '../src/functional-systems.ts';
const require = createRequire(import.meta.url);
const { createWorkspaceStorage } = require('../desktop/test-workspaces.cjs');
function fixture() {
  const skills = createFunctionalSystem('技能系统'), motion = createFunctionalSystem('角色移动系统');
  skills.purpose = '管理技能释放及冷却'; skills.boundary = '位移和碰撞交给移动系统';
  const dash = createCapability(skills.id, '玩家冲刺'), move = createCapability(motion.id, '水平位移');
  Object.assign(dash, { purpose: '跨越裂隙', input: 'K 新按下', conditions: '已解锁；冷却结束', process: '保存纵速并水平位移', output: '开始/结束事件', failure: '碰墙提前结束；受击打断', state: '就绪、冲刺中、冷却', acceptance: '空中一次，落地恢复' });
  const designs = [createGameplay('移动教学'), createGameplay('静默试炼'), createGameplay('裂隙通行')];
  designs[0].summary = '获得冲刺后学习横向越过缺口';
  const rule = createRule(); Object.assign(rule, { name: '冲刺判定', trigger: '按下 K', conditions: [{id:'cond', subject:'hasDash', operator:'eq', value:'true'}], actions: [{id:'action', text:'请求玩家冲刺'}] });
  designs[0].conditionRules = [rule];
  const state = createState(); Object.assign(state, {name:'Dashing', description:'锁定纵向位置'}); designs[0].stateFlow.states = [state];
  const track = createTrack(); track.name = '动作阶段'; designs[0].timeline.tracks = [track];
  const event = createTimelineEvent(track.id); Object.assign(event, {name:'冲刺执行窗', start:0, duration:.2, condition:'释放成功', notes:'结束后恢复纵速'}); designs[0].timeline.events = [event];
  const columns = [{ key: 'id', label: 'ID' }, { key: 'value', label: '数值' }];
  const sources = { designs, definitions: [{key:'params',label:'核心参数',badge:'P',columns}], data: {columns:{params:columns},datasets:{params:[{id:'dashSpeed',value:'20'},{id:'dashDuration',value:'0.2'}]}} };
  dash.configRefs = [{id:'ref',datasetKey:'params',rowId:'dashSpeed',columnKey:'value',note:'当前水平速度'}];
  const store = { ...emptyFunctionalSystems(), systems:[skills,motion], capabilities:[dash,move], dependencies:[{id:'dep',fromId:dash.id,toId:move.id,kind:'call',note:'由移动系统执行位移'}], usages:designs.map((d,i)=>({id:'usage'+i,gameplayId:d.id,capabilityId:dash.id,sourceKind:'design',sourceId:'',note:['使用冲刺','完成试炼后解锁','需要已解锁冲刺'][i]})) };
  return {store,sources,skills,motion,dash,move,rule,state,event};
}
function memory(initial = null) { let raw = initial, count = 0; return {getItem:()=>raw,setItem:(_,value)=>{raw=value;count++;},get writes(){return count;}}; }

test('systems and capabilities start empty with independent IDs and implementation status', () => {
  const system=createFunctionalSystem('  技能  '), capability=createCapability(system.id,' 冲刺 ');
  assert.equal(system.name,'技能'); assert.equal(capability.name,'冲刺'); assert.equal(capability.status,'待开发'); assert.equal(capability.archived,false);
  assert.deepEqual(capability.configRefs,[]); assert.equal(capability.process,''); assert.notEqual(capability.id,createCapability(system.id,'冲刺').id);
  assert.throws(()=>createFunctionalSystem(' '),/系统名称/); assert.throws(()=>createCapability(system.id,' '),/功能名称/); assert.throws(()=>createCapability('','冲刺'),/所属系统/);
  validateFunctionalSystems({...emptyFunctionalSystems(),systems:[system],capabilities:[capability]});
  const storage=memory();assert.deepEqual(readFunctionalSystems(storage,'new-project').store,emptyFunctionalSystems());assert.equal(storage.writes,0);assert.equal(storage.getItem(),null);
});

test('malformed archives fail closed while broken references remain repairable', () => {
  const {store,sources,dash}=fixture();
  for (const mutate of [s=>{s.schema=2;},s=>{delete s.usages;},s=>{s.systems.push(s.systems[0]);},s=>{s.capabilities[0].createdAt='invalid';},s=>{s.capabilities[0].status='已验证';},s=>{s.dependencies[0].kind='toString';},s=>{s.capabilities[0].configRefs[0].rowId=20;},s=>{s.usages[0].sourceId='unexpected';},s=>{s.usages[0].sourceKind='transition';}]) {
    const broken=structuredClone(store);mutate(broken);const raw=JSON.stringify(broken),storage=memory(raw);
    assert.throws(()=>readFunctionalSystems(storage,'key'),/格式异常/);assert.throws(()=>writeFunctionalSystems(storage,'key',raw,emptyFunctionalSystems()),/格式异常/);assert.equal(storage.getItem(),raw);assert.equal(storage.writes,0);
  }
  const brokenJson=memory('{bad');assert.throws(()=>writeFunctionalSystems(brokenJson,'key','{bad',store));assert.equal(brokenJson.getItem(),'{bad');
  const stale=structuredClone(store);stale.capabilities[0].systemId='missing-system';stale.dependencies[0].toId='missing-function';stale.usages[0].gameplayId='missing-gameplay';stale.capabilities[0].configRefs[0].rowId='missing-row';
  assert.deepEqual(validateFunctionalSystems(stale),stale); const issues=functionalIssues(stale,sources).join('\n');
  for(const phrase of ['所属系统已失效','依赖功能已失效','玩法已失效','配置记录已失效']) assert.ok(issues.includes(phrase),phrase);
  assert.equal(stale.capabilities[0].id,dash.id);
});

test('disk archives survive reopening and stay isolated by project and test workspace', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gamecreator-functional-'));
  try {
    const {store}=fixture(),storage=createWorkspaceStorage(dir),a='gamecreator.workspace.v1:project-a:functional-systems',b='gamecreator.workspace.v1:project-b:functional-systems';
    const testId=crypto.randomUUID(),testKey='gamecreator.workspace.v1:'+path.join(dir,'test-workspaces',testId,'project').replaceAll('\\','/').toLowerCase()+':functional-systems';
    const raw=writeFunctionalSystems(storage,a,null,store);writeFunctionalSystems(storage,b,null,emptyFunctionalSystems());writeFunctionalSystems(storage,testKey,null,{...emptyFunctionalSystems(),systems:[createFunctionalSystem('测试系统')]});
    assert.equal(storage.getItem(a),raw);assert.ok(storage.info(testKey).directory.includes(testId));
    const reopened=createWorkspaceStorage(dir);assert.deepEqual(readFunctionalSystems(reopened,a).store,store);assert.equal(readFunctionalSystems(reopened,b).store.systems.length,0);assert.equal(readFunctionalSystems(reopened,testKey).store.systems[0].name,'测试系统');
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});

test('stale writes and storage failures preserve committed content and allow a genuine retry', () => {
  const {store}=fixture(),storage=memory();const saved=writeFunctionalSystems(storage,'key',null,store),next=structuredClone(store);next.capabilities[0].purpose='改后的用途';
  assert.throws(()=>writeFunctionalSystems(storage,'key',null,next),/其他窗口/);assert.equal(storage.getItem(),saved);
  const fail={getItem:storage.getItem,setItem:()=>{throw Error('disk full');}};
  assert.throws(()=>writeFunctionalSystems(fail,'key',saved,next),/disk full/);assert.equal(storage.getItem(),saved);
  writeFunctionalSystems(storage,'key',saved,next);assert.equal(readFunctionalSystems(storage,'key').store.capabilities[0].purpose,'改后的用途');
});

test('deletion protects owners and incoming references and removes only unused outgoing edges', () => {
  const {store,skills,dash,move}=fixture();const before=structuredClone(store);
  assert.throws(()=>removeFunctionalSystem(store,skills.id),/包含功能/);assert.throws(()=>removeCapability(store,move.id),/被依赖/);assert.throws(()=>removeCapability(store,dash.id),/玩法引用/);assert.deepEqual(store,before);
  const unreferenced={...store,usages:[]};const removed=removeCapability(unreferenced,dash.id);assert.deepEqual(removed.capabilities,[move]);assert.deepEqual(removed.dependencies,[]);assert.equal(removeFunctionalSystem(removed,skills.id).systems.length,1);
});

test('renaming and reparenting preserve a single shared capability identity and reverse usages', () => {
  const {store,sources,dash,motion}=fixture(),moved=structuredClone(store);Object.assign(moved.capabilities[0],{name:'短距冲刺',systemId:motion.id});
  const markdown=functionalSystemsMarkdown(moved,sources);assert.equal(moved.usages.filter(u=>u.capabilityId===dash.id).length,3);assert.equal(markdown.split('#### 短距冲刺\n').length-1,1);
  for(const d of sources.designs){assert.ok(gameplayFunctionalMarkdown(d.id,moved,sources).includes('角色移动系统 / 短距冲刺'));assert.ok(markdown.includes(d.title));}
  assert.deepEqual(functionalIssues(moved,sources),[]);
  const storage=memory();const raw=writeFunctionalSystems(storage,'key',null,store);writeFunctionalSystems(storage,'key',raw,moved);assert.deepEqual(readFunctionalSystems(storage,'key').store.usages,store.usages);
});

test('duplicate and self relations are diagnosed; call cycles show a path but event feedback is allowed', () => {
  const {store,sources,dash,move}=fixture();const extra=createCapability(store.systems[0].id,'技能协调');store.capabilities.push(extra);
  store.dependencies.push({id:'reverse',fromId:move.id,toId:extra.id,kind:'call',note:''},{id:'back',fromId:extra.id,toId:dash.id,kind:'call',note:''});
  let issues=functionalIssues(store,sources);const cycle=issues.find(i=>i.startsWith('调用依赖存在循环'));assert.ok(cycle);for(const name of ['玩家冲刺','水平位移','技能协调'])assert.ok(cycle.includes(name));assert.ok(cycle.split('玩家冲刺').length>=3);
  store.dependencies[2].kind='event';assert.ok(!functionalIssues(store,sources).some(i=>i.includes('循环')));
  store.dependencies.push({...store.dependencies[0],id:'duplicate'},{id:'self',fromId:dash.id,toId:dash.id,kind:'data',note:''});
  store.usages.push({...store.usages[0],id:'repeat-usage'});issues=functionalIssues(store,sources);assert.ok(issues.some(i=>i.includes('重复依赖')));assert.ok(issues.some(i=>i.includes('不能依赖自身')));assert.ok(issues.some(i=>i.includes('重复玩法引用')));
});

test('archiving a parent protects child content and prevents new references without losing history', () => {
  const {store,sources,skills,dash,move}=fixture(),storage=memory();let saved=writeFunctionalSystems(storage,'key',null,store);
  const archived=structuredClone(store);archived.systems[0].archived=true;saved=writeFunctionalSystems(storage,'key',saved,archived);
  assert.deepEqual(readFunctionalSystems(storage,'key').store.usages,store.usages);assert.ok(functionalIssues(archived,sources).some(i=>i.includes('系统已归档')));
  const modified=structuredClone(archived);modified.capabilities[0].input='新输入';assert.throws(()=>writeFunctionalSystems(storage,'key',saved,modified),/先恢复/);
  const extra=structuredClone(archived);extra.capabilities.push(createCapability(skills.id,'新技能'));assert.throws(()=>writeFunctionalSystems(storage,'key',saved,extra),/已归档系统/);
  const usage=structuredClone(archived);usage.usages.push({id:'new',gameplayId:sources.designs[0].id,capabilityId:dash.id,sourceKind:'rule',sourceId:'missing-rule',note:''});assert.throws(()=>writeFunctionalSystems(storage,'key',saved,usage),/不能新增/);
  const dependency=structuredClone(archived);dependency.dependencies.push({id:'new',fromId:move.id,toId:dash.id,kind:'data',note:''});assert.throws(()=>writeFunctionalSystems(storage,'key',saved,dependency),/不能为已归档/);
  assert.equal(storage.getItem(),saved);archived.systems[0].archived=false;saved=writeFunctionalSystems(storage,'key',saved,archived);archived.capabilities[0].input='恢复后编辑';writeFunctionalSystems(storage,'key',saved,archived);assert.equal(readFunctionalSystems(storage,'key').store.capabilities[0].input,'恢复后编辑');
});

test('configuration references resolve live rows and fields, including renamed and deleted sources', () => {
  const {store,sources}=fixture(),ref=store.capabilities[0].configRefs[0];assert.ok(configReferenceText(ref,sources).includes('数值：20'));
  assert.ok(configReferenceText({...ref,datasetKey:'toString'},sources).includes('配置表已失效'));
  sources.data.datasets.params[0].value='24';sources.data.columns.params[1].label='速度';sources.definitions[0].label='冲刺参数';
  assert.ok(configReferenceText(ref,sources).includes('冲刺参数 / dashSpeed / 速度：24'));assert.ok(functionalSystemsMarkdown(store,sources).includes('速度：24'));
  const rowOnly={...ref,columnKey:''},columnOnly={...ref,rowId:''},tableOnly={...ref,rowId:'',columnKey:''};assert.ok(configReferenceText(rowOnly,sources).includes('速度=24'));assert.ok(configReferenceText(columnOnly,sources).includes('dashSpeed=24'));assert.ok(configReferenceText(tableOnly,sources).includes('2 条记录'));
  sources.data.columns.params= sources.data.columns.params.slice(0,1);assert.ok(configReferenceText(ref,sources).includes('字段已失效'));assert.ok(functionalIssues(store,sources).some(i=>i.includes('字段已失效')));
  sources.data.datasets.params=[];assert.ok(configReferenceText(ref,sources).includes('记录已失效'));sources.definitions=[];assert.ok(configReferenceText(ref,sources).includes('配置表已失效'));
});

test('rule, state and event sources resolve by ID, show live content, and retain stale references', () => {
  const {store,sources,dash,rule,state,event}=fixture();const design=sources.designs[0];
  store.usages=['rule','state','event'].map((kind,index)=>({id:'specific'+index,gameplayId:design.id,capabilityId:dash.id,sourceKind:kind,sourceId:[rule.id,state.id,event.id][index],note:'程序需求'}));
  assert.ok(usageSourceText(store.usages[0],sources).includes('冲刺判定'));rule.name='空中冲刺判定';assert.ok(usageSourceText(store.usages[0],sources).includes('空中冲刺判定'));
  let markdown=functionalSystemsMarkdown(store,sources);for(const phrase of ['按下 K','请求玩家冲刺','锁定纵向位置','持续 0.2 秒','结束后恢复纵速'])assert.ok(markdown.includes(phrase),phrase);
  rule.mode='any';rule.conditions=[];assert.ok(functionalSystemsMarkdown(store,sources).includes('缺少条件，无法判断任一满足'));
  design.archived=true;design.conditionRules=[];design.stateFlow.states=[];design.timeline.events=[];
  const issues=functionalIssues(store,sources).join('\n');for(const phrase of ['来源玩法已归档','条件规则来源已失效','状态来源已失效','时间事件来源已失效'])assert.ok(issues.includes(phrase),phrase);
  assert.equal(validateFunctionalSystems(store).usages.length,3);markdown=functionalSystemsMarkdown(store,sources);assert.ok(markdown.includes('来源已失效'));assert.ok(markdown.includes('玩法已归档'));
});

test('export contains each complete definition once with both dependency directions and missing owners', () => {
  const {store,sources,dash}=fixture();const markdown=functionalSystemsMarkdown(store,sources);
  for(const phrase of ['管理技能释放及冷却','位移和碰撞交给移动系统','K 新按下','已解锁；冷却结束','保存纵速并水平位移','开始/结束事件','碰墙提前结束；受击打断','就绪、冲刺中、冷却','空中一次，落地恢复','##### 依赖谁','##### 谁使用它','完成试炼后解锁','当前水平速度','待开发']) assert.ok(markdown.includes(phrase),phrase);
  assert.equal(markdown.split('#### 玩家冲刺\n').length-1,1);store.systems=store.systems.slice(1);assert.ok(functionalSystemsMarkdown(store,sources).includes('### 所属系统已失效的功能'));
  store.dependencies.push({id:'lost',fromId:'missing-a',toId:'missing-b',kind:'event',note:'保留未修复的事件说明'});assert.ok(functionalSystemsMarkdown(store,sources).includes('保留未修复的事件说明'));
  store.capabilities=store.capabilities.filter(c=>c.id!==dash.id);assert.ok(functionalSystemsMarkdown(store,sources).includes('功能已失效的玩法引用'));assert.ok(gameplayFunctionalMarkdown(sources.designs[0].id,store,sources).includes('功能已失效'));
});
