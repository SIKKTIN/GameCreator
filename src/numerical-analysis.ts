import type { ProjectData } from './data-model.ts';
import type { Narrative, StoryOrchestrationStore } from './story-orchestration.ts';
import { parseExpression, evaluateExpression, type Expression } from './analysis-expression.ts';
import { diceChance, narrativeCheckChance } from './story-check.ts';
import { isStoryFlag } from './story-characters.ts';

export type AnalysisBinding = { kind: 'constant' } | { kind: 'cell'; table: string; rowId: string; field: string } | { kind: 'variable'; storyId: string; variableId: string };
export type AnalysisParameter = { id: string; name: string; unit: string; type: 'number' | 'integer' | 'percent'; value: number; minimum: number | null; maximum: number | null; binding: AnalysisBinding };
export type AnalysisMetric = { id: string; name: string; unit: string; formula: string; minimum: number | null; maximum: number | null };
export type AnalysisVariant = { id: string; name: string; overrides: Record<string, number> };
export type AnalysisRow = { key: string; label: string; x: number; inputs: Record<string, number>; origins: Record<string, string>; values: Record<string, number>; errors: string[]; outside: string[] };
export type AnalysisSnapshot = { id: string; name: string; createdAt: string; signature: string; variantId: string; metrics: AnalysisMetric[]; rows: AnalysisRow[] };
export type AnalysisPlan = { id: string; name: string; notes: string; gameplayId: string; parameters: AnalysisParameter[]; metrics: AnalysisMetric[]; variants: AnalysisVariant[]; snapshots: AnalysisSnapshot[];
  batch: { table: string; rowIds: string[] } | null; sweep: { parameterId: string; start: number; end: number; step: number } | null; check: { storyId: string; checkId: string } | null };
export type NumericalAnalysisStore = { schema: 1; plans: AnalysisPlan[] };
export type AnalysisSources = { data: ProjectData; narrative: StoryOrchestrationStore };
export const emptyNumericalAnalysis = (): NumericalAnalysisStore => ({ schema: 1, plans: [] });
export const newAnalysisPlan = (name = '新建分析'): AnalysisPlan => ({ id: crypto.randomUUID(), name, notes: '', gameplayId: '', parameters: [], metrics: [], variants: [], snapshots: [], batch: null, sweep: null, check: null });

// Self-contained so the desktop folder boundary uses the exact same validator.
export function validateNumericalAnalysis(value: unknown): NumericalAnalysisStore {
  const fail = (): never => { throw new Error('数值分析存档格式异常，已停止写入'); };
  const rec = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
  const str = (x: unknown): x is string => typeof x === 'string' && x.length <= 10000;
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  const safe = (x: string) => !['__proto__','constructor','prototype'].includes(x);
  const numericMap = (x: unknown) => rec(x) && Object.keys(x).length <= 300 && Object.entries(x).every(([k,v]) => safe(k) && num(v));
  const list = (x: unknown, max: number): any[] => { if (!Array.isArray(x) || x.length > max) return fail(); return x; };
  const ids = (x: unknown, max: number): any[] => { const a = list(x,max); const used = new Set(); for (const v of a) { if (!rec(v) || !str(v.id) || !v.id || !safe(v.id) || used.has(v.id)) fail(); used.add(v.id); } return a; };
  const range = (x: any) => (x.minimum === null || num(x.minimum)) && (x.maximum === null || num(x.maximum)) && (x.minimum === null || x.maximum === null || x.minimum <= x.maximum);
  const metric = (m: any) => str(m.name) && str(m.unit) && str(m.formula) && m.formula.length <= 1000 && range(m);
  if (!rec(value) || value.schema !== 1) return fail();
  for (const p of ids(value.plans, 100)) {
    if (!str(p.name) || !str(p.notes) || !str(p.gameplayId)) fail();
    const symbols = new Set();
    for (const item of [...ids(p.parameters,100), ...ids(p.metrics,50)]) {
      if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(item.id) || symbols.has(item.id)) fail(); symbols.add(item.id);
    }
    for (const param of p.parameters) {
      if (!str(param.name) || !str(param.unit) || !num(param.value) || !['number','integer','percent'].includes(param.type) || !range(param) || !rec(param.binding)) fail();
      const b = param.binding;
      if (b.kind === 'cell') { if (!str(b.table) || !str(b.rowId) || !str(b.field) || !safe(b.table) || !safe(b.field)) fail(); }
      else if (b.kind === 'variable') { if (!str(b.storyId) || !str(b.variableId) || !safe(b.variableId)) fail(); }
      else if (b.kind !== 'constant') fail();
    }
    if (!p.metrics.every(metric)) fail();
    for (const v of ids(p.variants,20)) if (!str(v.name) || !numericMap(v.overrides)) fail();
    if (p.batch !== null && (!rec(p.batch) || !str(p.batch.table) || !safe(p.batch.table) || !list(p.batch.rowIds,100).every(str) || new Set(p.batch.rowIds).size !== p.batch.rowIds.length)) fail();
    if (p.sweep !== null && (!rec(p.sweep) || !str(p.sweep.parameterId) || !num(p.sweep.start) || !num(p.sweep.end) || !num(p.sweep.step))) fail();
    if (p.check !== null && (!rec(p.check) || !str(p.check.storyId) || !str(p.check.checkId))) fail();
    for (const s of ids(p.snapshots,10)) {
      if (!str(s.name) || !str(s.createdAt) || !Number.isFinite(Date.parse(s.createdAt)) || typeof s.signature !== 'string' || s.signature.length > 2000000 || !str(s.variantId) || !ids(s.metrics,50).every(metric)) fail();
      for (const r of list(s.rows,1000)) if (!rec(r) || !str(r.key) || !str(r.label) || !num(r.x) || !numericMap(r.inputs) || !numericMap(r.values) || !rec(r.origins) || !Object.entries(r.origins).every(([k,v]) => safe(k) && str(v)) || !list(r.errors,200).every(str) || !list(r.outside,50).every(str)) fail();
    }
  }
  return value as NumericalAnalysisStore;
}
export function readNumericalAnalysis(storage: Pick<Storage,'getItem'>, key: string) {
  const raw = storage.getItem(key); return { raw, store: raw === null ? emptyNumericalAnalysis() : validateNumericalAnalysis(JSON.parse(raw)) };
}
export function writeNumericalAnalysis(storage: Pick<Storage,'getItem'|'setItem'>, key: string, expected: string | null, store: NumericalAnalysisStore): string {
  const raw = storage.getItem(key); if (raw !== null) validateNumericalAnalysis(JSON.parse(raw));
  if (raw !== expected) throw new Error('其他窗口已更新数值分析，当前草稿已保留');
  const next = JSON.stringify(validateNumericalAnalysis(store)); storage.setItem(key,next); return next;
}
export function numericCell(raw: unknown, type: AnalysisParameter['type']): number {
  if (typeof raw !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?%?$/.test(raw.trim())) throw new Error('不是有效数字：' + String(raw ?? '缺失'));
  const percent = raw.trim().endsWith('%'); if (percent && type !== 'percent') throw new Error('百分比字段需选择百分比类型');
  const n = Number(percent ? raw.trim().slice(0,-1) : raw.trim()) / (percent ? 100 : 1);
  if (!Number.isFinite(n)) throw new Error('数值超出范围'); return n;
}
function parameterInput(p: AnalysisParameter, sources: AnalysisSources, batchId: string, batchTable = ''): { value: number; origin: string } {
  const b = p.binding;
  if (b.kind === 'constant') return { value:p.value, origin:'试算常量' };
  if (b.kind === 'variable') {
    if (!sources.narrative.enabled) throw new Error('故事编排未启用');
    const story = sources.narrative.stories.find(s => s.id === b.storyId), v = story?.variables.find(v => v.id === b.variableId);
    if (!v) throw new Error('故事状态已失效：' + b.variableId);
    return { value:v.initial, origin:story!.title + ' / ' + v.name };
  }
  const rowId = b.rowId === '$row' ? batchId : b.rowId.startsWith('$row.') ? sources.data.datasets[batchTable]?.find(r=>r.id===batchId)?.[b.rowId.slice(5)] : b.rowId, rows = sources.data.datasets[b.table];
  if (!sources.data.columns[b.table]?.some(c => c.key === b.field)) throw new Error('字段已失效：' + b.table + '.' + b.field);
  const matches = rows?.filter(r => r.id === rowId);
  if (!matches?.length) throw new Error('记录已失效：' + b.table + '/' + rowId);
  if (matches.length !== 1) throw new Error('记录 ID 重复：' + rowId);
  const row = matches[0];
  if (b.field === 'value' && row.unit?.trim() && p.unit.trim() && row.unit.trim() !== p.unit.trim()) throw new Error('单位不匹配：来源为 ' + row.unit + '，参数为 ' + p.unit);
  return { value:numericCell(row[b.field], p.type), origin:b.table + ' / ' + rowId + ' / ' + b.field };
}
function validParameter(p: AnalysisParameter, value: number, sources: AnalysisSources) {
  if (!Number.isFinite(value) || p.type === 'integer' && !Number.isInteger(value) || p.minimum !== null && value < p.minimum || p.maximum !== null && value > p.maximum) throw new Error('不满足参数类型或有效范围');
  if (p.binding.kind === 'variable') {
    const b = p.binding, v = sources.narrative.stories.find(s=>s.id===b.storyId)?.variables.find(v=>v.id===b.variableId);
    if (v && ((isStoryFlag(v) && ![0,1].includes(value)) || v.minimum !== null && value < v.minimum || v.maximum !== null && value > v.maximum)) throw new Error('超出故事状态范围');
  }
}
export function runAnalysis(plan: AnalysisPlan, sources: AnalysisSources, variantId = ''): { rows: AnalysisRow[]; signature: string; errors: string[] } {
  const errors: string[] = [], rows: AnalysisRow[] = [], variant = plan.variants.find(v=>v.id===variantId);
  if (variantId && !variant) errors.push('试算方案已失效');
  for (const key of Object.keys(variant?.overrides ?? {})) if (!plan.parameters.some(p=>p.id===key)) errors.push('试算参数已失效：' + key);
  let cases = [{id:'',label:'当前值'}]; let sweep: number[] = [0];
  if (plan.batch) {
    const records = sources.data.datasets[plan.batch.table];
    if (!records) errors.push('批量来源表已失效');
    cases = (plan.batch.rowIds.length ? plan.batch.rowIds : (records ?? []).map(r=>r.id)).map(id => ({id,label:records?.find(r=>r.id===id)?.name || id}));
    if (!cases.length) errors.push('批量来源没有记录');
    if (cases.length > 100) errors.push('一次最多比较 100 条记录，请选择记录范围');
    if (new Set(cases.map(c=>c.id)).size !== cases.length) errors.push('批量来源存在重复 ID');
  }
  if (plan.sweep) {
    const s = plan.sweep;
    if (!plan.parameters.some(p=>p.id===s.parameterId)) errors.push('曲线参数已失效');
    if (s.step <= 0 || s.end < s.start || !Number.isFinite((s.end-s.start)/s.step) || (s.end-s.start)/s.step > 100) errors.push('曲线范围无效：步长须大于 0，最多 101 个采样点');
    else sweep = Array.from({length:Math.floor((s.end-s.start)/s.step+1e-9)+1},(_,i)=>Number((s.start+i*s.step).toPrecision(12)));
  }
  if (cases.length*sweep.length > 1000) errors.push('一次最多计算 1000 组结果，请缩小范围');
  const parsed = new Map<string,Expression>();
  for (const m of plan.metrics) { try { parsed.set(m.id,parseExpression(m.formula)); } catch(e) { errors.push(m.name+'：'+(e as Error).message); } }
  if (!plan.metrics.length) errors.push('请添加至少一个计算指标');
  const story = plan.check ? sources.narrative.stories.find(s=>s.id===plan.check!.storyId) : undefined;
  const check = story?.checks.find(c=>c.id===plan.check?.checkId);
  if (plan.check && (!sources.narrative.enabled || !check)) errors.push('关联故事检定已失效或模块未启用');
  const checkVariables=new Set(check?[check.variableId,...check.modifiers.flatMap(m=>m.condition.groups.flatMap(g=>g.map(c=>c.variableId)))]:[]);
  if(story)for(const id of checkVariables)if(!story.variables.some(v=>v.id===id))errors.push('检定状态引用已失效：'+id);
  if (!errors.length) for (const c of cases) for (const x of sweep) {
    const r: AnalysisRow = {key:JSON.stringify([c.id,plan.sweep?x:null]),label:plan.sweep ? (plan.batch?c.label+' · ':'')+x : c.label,x:plan.sweep?x:rows.length,inputs:{},origins:{},values:{},errors:[],outside:[]};
    for (const p of plan.parameters) try {
      const source = parameterInput(p,sources,c.id,plan.batch?.table); let value = source.value, origin = source.origin;
      if (variant && Object.prototype.hasOwnProperty.call(variant.overrides,p.id)) { value = variant.overrides[p.id]; origin += ' → 试算覆盖'; }
      if (plan.sweep?.parameterId===p.id) { value=x; origin+=' → 曲线采样'; }
      validParameter(p,value,sources); r.inputs[p.id]=value; r.origins[p.id]=origin;
    } catch(e) { r.errors.push(p.name+'：'+(e as Error).message); }
    const visiting = new Set<string>();
    const resolve = (name:string):number => {
      if (Object.prototype.hasOwnProperty.call(r.inputs,name)) return r.inputs[name];
      if (Object.prototype.hasOwnProperty.call(r.values,name)) return r.values[name];
      const ast = parsed.get(name); if (!ast) throw new Error('未知参数或指标：'+name);
      if (visiting.has(name)) throw new Error('指标循环依赖：'+[...visiting,name].join(' → '));
      visiting.add(name);
      try { const result=evaluateExpression(ast,resolve,(fn,args)=>{
        if (fn==='diceChance') return diceChance(args[0],args[1],args[2],args[3],args[4]);
        if (!story || !check) throw new Error('请关联故事检定');
        const state=Object.fromEntries(story.variables.map(v=>[v.id,v.initial]));
        const assigned=new Set<string>();
        for(const p of plan.parameters) if(p.binding.kind==='variable' && p.binding.storyId===story.id) {
          if(assigned.has(p.binding.variableId)&&state[p.binding.variableId]!==r.inputs[p.id])throw new Error('同一故事状态有不同试算值：'+p.binding.variableId);
          state[p.binding.variableId]=r.inputs[p.id];assigned.add(p.binding.variableId);
        }
        return narrativeCheckChance(check,state);
      }); r.values[name]=result; return result; } finally { visiting.delete(name); }
    };
    if (!r.errors.length) for (const m of plan.metrics) try { const value=resolve(m.id); if(m.minimum!==null&&value<m.minimum || m.maximum!==null&&value>m.maximum) r.outside.push(m.id); } catch(e) { r.errors.push(m.name+'：'+(e as Error).message); }
    rows.push(r);
  }
  // Includes resolved inputs and calculation rules; unrelated source edits do not stale a baseline.
  const signature=JSON.stringify({parameters:plan.parameters,metrics:plan.metrics,batch:plan.batch,sweep:plan.sweep,check,storyVariables:story?.variables.filter(v=>checkVariables.has(v.id)),variants:variant?.overrides,rows:rows.map(r=>({key:r.key,inputs:r.inputs,errors:r.errors})),errors});
  return {rows,signature,errors};
}
export function snapshotAnalysis(plan: AnalysisPlan, sources: AnalysisSources, variantId = '', name = '基准结果'): AnalysisSnapshot {
  const run=runAnalysis(plan,sources,variantId);
  if(run.errors.length || run.rows.some(r=>r.errors.length)) throw new Error('请先修正计算错误，再保存结果');
  return {id:crypto.randomUUID(),name,createdAt:new Date().toISOString(),signature:run.signature,variantId,metrics:structuredClone(plan.metrics),rows:run.rows};
}
export function planFromStoryCheck(story: Narrative, checkId: string): AnalysisPlan {
  const check=story.checks.find(c=>c.id===checkId); if(!check) throw new Error('检定已失效');
  const p=newAnalysisPlan(check.name+' · 成功率'); p.check={storyId:story.id,checkId}; p.notes='按所选状态计算单次检定成功率；重试次数与剧情路径不在此概率中。';
  const variables=new Set([check.variableId,...check.modifiers.flatMap(m=>m.condition.groups.flatMap(g=>g.map(c=>c.variableId)))]);
  p.parameters=story.variables.filter(v=>variables.has(v.id)).map((v,i)=>({id:'state_'+i,name:v.name,unit:'',type:'number',value:v.initial,minimum:v.minimum,maximum:v.maximum,binding:{kind:'variable',storyId:story.id,variableId:v.id}}));
  p.metrics=[{id:'chance',name:'单次成功率',unit:'%',formula:'storyChance() * 100',minimum:0,maximum:100}]; return p;
}
export function analysisCsv(plan: AnalysisPlan, rows: AnalysisRow[]): string {
  const cell=(v:unknown)=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s)&&!/^[-+]?\d+(\.\d+)?$/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  return '\ufeff'+[['记录',...plan.parameters.map(p=>p.name+(p.unit?' ('+p.unit+')':'')),...plan.metrics.map(m=>m.name+(m.unit?' ('+m.unit+')':'')),'异常','超出目标'].map(cell).join(','),...rows.map(r=>[r.label,...plan.parameters.map(p=>r.inputs[p.id]),...plan.metrics.map(m=>r.values[m.id]),r.errors.join('；'),r.outside.map(id=>plan.metrics.find(m=>m.id===id)?.name).join('；')].map(cell).join(','))].join('\r\n');
}
export function numericalAnalysisMarkdown(store: NumericalAnalysisStore, sources: AnalysisSources): string {
  const lines=['## 数值分析',''];
  for(const p of store.plans) {
    lines.push('### '+p.name,'',p.notes,'','- 关联玩法：'+(p.gameplayId||'无'));
    for(const v of p.parameters) lines.push('- 参数 '+v.id+'（'+v.name+'）：'+JSON.stringify(v.binding)+'；单位 '+v.unit+'；范围 '+v.minimum+'～'+v.maximum);
    for(const m of p.metrics) lines.push('- '+m.name+'：`'+m.formula+'`；单位 '+m.unit+'；目标 '+m.minimum+'～'+m.maximum);
    for(const v of [{id:'',name:'当前配置'},...p.variants]) { const result=runAnalysis(p,sources,v.id);lines.push('','#### '+v.name,...result.errors.map(e=>'- 错误：'+e),...result.rows.slice(0,100).map(r=>'- '+r.label+'：'+JSON.stringify(r.values)+(r.errors.length?'；错误 '+r.errors.join('；'):'')+(r.outside.length?'；超出目标 '+r.outside.join('、'):''))); if(result.rows.length>100)lines.push('- 其余结果请从分析界面导出 CSV。'); }
    for(const s of p.snapshots)lines.push('- 已保存结果：'+s.name+'，'+s.createdAt+'，'+(runAnalysis(p,sources,s.variantId).signature===s.signature?'与当前输入一致':'输入或规则已变化'));
    lines.push('');
  }
  if(!store.plans.length)lines.push('暂无分析方案。'); return lines.join('\n');
}
