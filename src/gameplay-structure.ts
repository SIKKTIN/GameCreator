import {ContentChecks} from './content-validation.ts';
export const gameplayStateKinds=['normal','outcome'] as const;
import type { GameplayDesign } from './gameplay';
export const dependencyKinds = { depends: '依赖', contains: '包含', collaborates: '协作' } as const;
export type GameplayDependency = { id: string; targetId: string; kind: keyof typeof dependencyKinds; note: string };
export const conditionOperators = { eq: '等于', neq: '不等于', gt: '大于', gte: '大于等于', lt: '小于', lte: '小于等于', contains: '包含', exists: '存在', missing: '不存在' } as const;
export type RuleCondition = { id: string; subject: string; operator: keyof typeof conditionOperators; value: string };
export type RuleAction = { id: string; text: string };
export type GameplayRule = { id: string; name: string; trigger: string; mode: 'all' | 'any'; conditions: RuleCondition[]; actions: RuleAction[]; otherwise: RuleAction[] };
export type GameplayState = { id: string; name: string; description: string; kind: 'normal' | 'outcome' };
export type GameplayTransition = { id: string; fromId: string; toId: string; event: string; condition: string; action: string; priority: number };
export type GameplayFlow = { initialStateId: string; states: GameplayState[]; transitions: GameplayTransition[] };
export type GameplayStructure = { dependencies: GameplayDependency[]; conditionRules: GameplayRule[]; stateFlow: GameplayFlow };
export const emptyStructure = (): GameplayStructure => ({ dependencies: [], conditionRules: [], stateFlow: { initialStateId: '', states: [], transitions: [] } });
export const createRule = (): GameplayRule => ({ id: crypto.randomUUID(), name: '', trigger: '', mode: 'all', conditions: [], actions: [], otherwise: [] });
export const createState = (): GameplayState => ({ id: crypto.randomUUID(), name: '', description: '', kind: 'normal' });
export const createTransition = (): GameplayTransition => ({ id: crypto.randomUUID(), fromId: '', toId: '', event: '', condition: '', action: '', priority: 100 });
export function validateStructure(value: GameplayStructure) {
  const c=new ContentChecks();
  if(!c.object(value,'')){c.finish('玩法关系、规则或状态存档格式异常，已停止写入');return value;}
  c.list(value.dependencies,'/dependencies',(x,p)=>{c.strings(x,['targetId','note'],p);c.enum(x.kind,Object.keys(dependencyKinds),p+'/kind');});
  c.list(value.conditionRules,'/conditionRules',(x,p)=>{
    c.strings(x,['name','trigger'],p);c.enum(x.mode,['all','any'],p+'/mode');
    c.list(x.conditions,p+'/conditions',(v,q)=>{c.strings(v,['subject','value'],q);c.enum(v.operator,Object.keys(conditionOperators),q+'/operator');});
    for(const key of ['actions','otherwise'])c.list(x[key],p+'/'+key,(v,q)=>c.strings(v,['text'],q));
  });
  if(c.object(value.stateFlow,'/stateFlow')){
    c.strings(value.stateFlow,['initialStateId'],'/stateFlow');
    c.list(value.stateFlow.states,'/stateFlow/states',(s,p)=>{c.strings(s,['name','description'],p);c.enum(s.kind,gameplayStateKinds,p+'/kind');});
    c.list(value.stateFlow.transitions,'/stateFlow/transitions',(s,p)=>{c.strings(s,['fromId','toId','event','condition','action'],p);c.number(s.priority,p+'/priority',0,Infinity,true);});
  }
  c.finish('玩法关系、规则或状态存档格式异常，已停止写入');return value;
}
export function copyStructure(source: GameplayStructure): GameplayStructure {
  const ids = new Map(source.stateFlow.states.map(s => [s.id, crypto.randomUUID()]));
  return {
    dependencies: source.dependencies.map(d => ({ ...d, id: crypto.randomUUID() })),
    conditionRules: source.conditionRules.map(r => ({ ...r, id: crypto.randomUUID(), conditions: r.conditions.map(c => ({ ...c, id: crypto.randomUUID() })), actions: r.actions.map(a => ({ ...a, id: crypto.randomUUID() })), otherwise: r.otherwise.map(a => ({ ...a, id: crypto.randomUUID() })) })),
    stateFlow: { initialStateId: ids.get(source.stateFlow.initialStateId) ?? source.stateFlow.initialStateId,
      states: source.stateFlow.states.map(s => ({ ...s, id: ids.get(s.id)! })),
      transitions: source.stateFlow.transitions.map(t => ({ ...t, id: crypto.randomUUID(), fromId: ids.get(t.fromId) ?? t.fromId, toId: ids.get(t.toId) ?? t.toId })) }
  };
}
export function dependencyIssues(design: GameplayDesign, designs: GameplayDesign[]): string[] {
  const issues: string[] = []; const seen = new Set<string>();
  const reaches = (id: string, goal: string, kind: string, visited = new Set<string>()): boolean => {
    if (id === goal) return true; if (visited.has(id)) return false; visited.add(id);
    return !!designs.find(d => d.id === id)?.dependencies.some(edge => edge.kind === kind && reaches(edge.targetId, goal, kind, visited));
  };
  for (const link of design.dependencies) {
    const target = designs.find(d => d.id === link.targetId); const key = link.kind + ':' + link.targetId;
    if (seen.has(key)) issues.push('重复关系：' + (target?.title || link.targetId)); seen.add(key);
    if (link.targetId === design.id) issues.push('玩法不能关联自身');
    else if (!target) issues.push('关联玩法已失效：' + (link.targetId || '尚未选择'));
    else {
      if (target.archived) issues.push('关联玩法已归档：' + (target.title || '未命名玩法'));
      if (link.kind !== 'collaborates' && reaches(target.id, design.id, link.kind)) issues.push(dependencyKinds[link.kind] + '存在循环：' + (target.title || '未命名玩法'));
    }
  }
  return [...new Set(issues)];
}
export function ruleIssues(rule: GameplayRule): string[] {
  const issues: string[] = [];
  if (!rule.name.trim()) issues.push('补充规则名称'); if (!rule.trigger.trim()) issues.push('补充触发事件');
  if (rule.mode === 'any' && !rule.conditions.length) issues.push('“任一条件”至少需要一个条件');
  rule.conditions.forEach((c, i) => {
    if (!c.subject.trim() || (!['exists', 'missing'].includes(c.operator) && !c.value.trim())) issues.push(`条件 ${i + 1} 尚未填写完整`);
  });
  if (!rule.actions.length || rule.actions.some(a => !a.text.trim())) issues.push('补充条件满足时的动作');
  if (rule.otherwise.some(a => !a.text.trim())) issues.push('补充条件不满足时的动作');
  return issues;
}
export function stateFlowIssues(flow: GameplayFlow): string[] {
  if (!flow.states.length && !flow.transitions.length && !flow.initialStateId) return [];
  const issues: string[] = [], ids = new Set(flow.states.map(s => s.id)), names = new Set<string>();
  if (!ids.has(flow.initialStateId)) issues.push('请选择有效的起始状态');
  for (const s of flow.states) {
    const name = s.name.trim(); if (!name) issues.push('有状态尚未命名');
    else if (names.has(name)) issues.push('状态名称重复：' + name); names.add(name);
  }
  for (const [index, t] of flow.transitions.entries()) {
    if (!ids.has(t.fromId) || !ids.has(t.toId)) issues.push(`转移 ${index + 1} 的起点或终点未选择或已失效`);
    if (!t.event.trim()) issues.push(`转移 ${index + 1} 尚未填写触发事件`);
  }
  if (ids.has(flow.initialStateId)) {
    const visited = new Set([flow.initialStateId]); let changed = true;
    while (changed) { changed = false; for (const t of flow.transitions) if (visited.has(t.fromId) && ids.has(t.toId) && !visited.has(t.toId)) { visited.add(t.toId); changed = true; } }
    for (const s of flow.states) if (!visited.has(s.id)) issues.push('从起始状态无法到达：' + (s.name || '未命名状态'));
  }
  return [...new Set(issues)];
}
export function removeFlowState(flow: GameplayFlow, id: string): GameplayFlow {
  if (flow.transitions.some(t => t.fromId === id || t.toId === id)) throw new Error('此状态仍被转移引用，请先移除或调整相关转移');
  return { ...flow, initialStateId: flow.initialStateId === id ? '' : flow.initialStateId, states: flow.states.filter(s => s.id !== id) };
}
export const conditionText = (c: RuleCondition) => `${c.subject.trim() || '待填对象'} ${conditionOperators[c.operator]}${['exists', 'missing'].includes(c.operator) ? '' : ' ' + (c.value.trim() || '待填值')}`;
export function structureMarkdown(design: GameplayDesign, designs: GameplayDesign[]): string {
  const lines = ['#### 玩法依赖关联', ''];
  for (const edge of design.dependencies) {
    const target = designs.find(d => d.id === edge.targetId);
    lines.push(`- ${dependencyKinds[edge.kind]}：${target?.title || '关联已失效（' + edge.targetId + '）'}${target?.archived ? '（已归档）' : ''}${edge.note ? ' — ' + edge.note : ''}`);
  }
  if (!design.dependencies.length) lines.push('暂无玩法关联。');
  const incoming = designs.flatMap(d => d.dependencies.filter(e => e.targetId === design.id).map(e => `- ${d.title || '未命名玩法'} → ${dependencyKinds[e.kind]} → 当前玩法`));
  if (incoming.length) lines.push('', '反向引用：', ...incoming);
  lines.push('', '#### 条件规则', '', '> 以下是设计规则，不执行代码；规则按列表顺序描述，动作按列出顺序执行。', '');
  if (!design.conditionRules.length) lines.push('暂无结构化条件规则。', '');
  design.conditionRules.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.name || '未命名规则'}`, '', `触发：${r.trigger || '待补充'}`, `条件组合：${r.mode === 'all' ? '全部满足（AND）' : '任一满足（OR）'}`);
    lines.push(...(r.conditions.length ? r.conditions.map(c => '- ' + conditionText(c)) : [r.mode === 'all' ? '- 无附加条件（触发后直接进入满足分支）' : '- 缺少条件，无法判断任一满足']), '', '满足时：');
    lines.push(...(r.actions.length ? r.actions.map((a, n) => `${n + 1}. ${a.text || '待补充'}`) : ['待补充']), '', '不满足时：');
    lines.push(...(r.otherwise.length ? r.otherwise.map((a, n) => `${n + 1}. ${a.text || '待补充'}`) : ['不执行动作']), '');
    if (ruleIssues(r).length) lines.push('规则检查：' + ruleIssues(r).join('；'), '');
  });
  const flow = design.stateFlow, name = (id: string) => flow.states.find(s => s.id === id)?.name || '未选择/已失效';
  lines.push('#### 状态流程', '', `起始状态：${flow.states.length ? name(flow.initialStateId) : '暂无'}`, '', '状态：');
  for (const state of flow.states) lines.push(`- ${state.name || '未命名状态'}${state.kind === 'outcome' ? '（结算状态，允许重开转移）' : ''}：${state.description || '待补充'}`);
  lines.push('', '转移（优先级数值越小越先判断，同优先级按列表顺序）：');
  for (const t of flow.transitions) lines.push(`- ${name(t.fromId)} → ${name(t.toId)}｜事件：${t.event || '待补充'}｜条件：${t.condition || '无附加条件'}｜动作：${t.action || '无'}｜优先级：${t.priority}`);
  const issues = [...dependencyIssues(design, designs), ...stateFlowIssues(flow)];
  if (issues.length) lines.push('', '关系/流程检查：', ...issues.map(s => '- ' + s));
  return lines.join('\n') + '\n';
}
