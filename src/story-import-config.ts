import { always, validateStoryOrchestration, type Narrative, type NarrativeNode, type StoryChoice, type StoryEffect, type StoryPredicate } from './story-orchestration.ts';
type Data = { datasets: Record<string, { id: string; [key: string]: string }[]> };
export function canImportStoryConfig(data: Data): boolean {
  return ['de_dialogue_nodes','de_dialogue_options','de_checks','de_world_state','de_people','de_locations','de_skills','de_schedules'].every(key => Array.isArray(data.datasets[key]) && data.datasets[key].length > 0);
}
/** One-time, explicit conversion. Original configuration tables remain untouched. */
export function importDiscoStory(data: Data, taskIds: string[] = []): Narrative {
  if (!canImportStoryConfig(data)) throw new Error('当前项目没有完整的港区疑案对白配置');
  const table = (name: string) => data.datasets['de_' + name];
  const pred = (raw: string): StoryPredicate => ({ groups: [JSON.parse(raw).map((c: { state?: string; skill?: string; op: string; value: number }) => {
    if (!!c.state === !!c.skill) throw new Error('对白条件必须引用一个状态或技能');
    return { variableId: c.state || 'skill:' + c.skill, op: c.op, value: c.value };
  })] });
  const effects = (raw: string): StoryEffect[] => JSON.parse(raw).map((e: { state: string; op: string; value: number }) => ({ variableId: e.state, op: e.op, value: e.value }));
  const condition = (variableId: string, op: 'eq' | 'gte' | 'lt' | 'lte', value: number) => ({ variableId, op, value });
  const all = (...items: ReturnType<typeof condition>[]): StoryPredicate => ({ groups: [items] });
  const task = (id: string) => taskIds.includes(id) ? [id] : [];
  const story: Narrative = {
    id: crypto.randomUUID(), title: '港区疑案 · 完整故事链', summary: '从旅馆开场，经现场取证、人物对话、检定与支线，读到查明真相、误判结案或暂缓调查。', archived: false,
    entryId: 'opening', source: '港区疑案对白配置导入快照；后续在故事编排中维护，原配置保留。', taskIds: ['de-task-case','de-task-rent','de-task-letter'].filter(id => taskIds.includes(id)),
    scenes: table('locations').map(r => ({ id: r.id, title: r.name, chapter: '港区疑案', description: r.purpose + '；' + r.access })),
    actors: [...table('people').map(r => ({ id: r.id, name: r.name, description: r.motive })), ...table('skills').map(r => ({ id: 'voice:' + r.id, name: r.name + ' · 内心声音', description: r.voice + '；' + r.risk }))],
    variables: [...table('world_state').map(r => ({ id: r.id, name: r.name, category: r.kind, initial: Number(r.initial), minimum: r.id === 'partner_trust' ? null : 0, maximum: ['health','morale'].includes(r.id) ? 3 : ['事实','证据','支线','假说','思想','阶段'].includes(r.kind) || r.id === 'witness_scared' ? 1 : null })),
      ...table('skills').map(r => ({ id: 'skill:' + r.id, name: r.name + '等级', category: '技能', initial: Number(r.base), minimum: 0, maximum: null })),
      { id: 'scarf_equipped', name: '围巾已装备', category: '装备', initial: 0, minimum: 0, maximum: 1 }],
    nodes: [], choices: [], checks: [], clockId: 'elapsed', timeLimit: 165600, interrupts: [],
  };
  for (const variable of story.variables) if (variable.minimum === 0 && variable.maximum === 1) variable.kind = 'flag';
  story.scenes.push({ id: 'investigation', title: '调查行动', chapter: '港区疑案', description: '在场人物、主动等待、整理装备与返回报告。' });
  story.nodes = table('dialogue_nodes').map(r => ({ id: r.id, sceneId: r.id === 'exit_dialogue' ? 'investigation' : r.location, title: (r.id === 'opening' ? '旅馆开场' : r.id === 'exit_dialogue' ? '返回港区调查' : r.id.startsWith('report_') ? ({report_hub:'案情汇报',report_true:'查明真相',report_wrong:'误判结案',report_pause:'暂缓调查'}[r.id] || r.id) : r.text.slice(0,18)),
    kind: r.id === 'exit_dialogue' ? 'hub' : ['report_true','report_wrong','report_pause'].includes(r.id) ? 'ending' : r.voice ? 'inner' : 'dialogue',
    speakerId: r.voice ? 'voice:' + r.voice : r.speaker, text: r.text,
    outcome: ({ report_true: '查明真相', report_wrong: '误判结案', report_pause: '暂缓调查' } as Record<string,string>)[r.id] || '',
    taskStatus: r.id === 'report_pause' ? 'suspended' : ['report_true','report_wrong'].includes(r.id) ? 'completed' : 'unchanged', taskIds: r.id.startsWith('report_') && r.id !== 'report_hub' ? task('de-task-case') : [],
  } as NarrativeNode));
  for (const n of story.nodes) { if (n.id === 'rent_done' || n.id === 'parcel_done') { n.taskStatus = 'completed'; n.taskIds = [...task('de-task-rent'), ...(n.id === 'parcel_done' ? task('de-task-letter') : [])]; } }
  story.choices = table('dialogue_options').map(r => ({ id:r.id, fromId:r.source, toId:r.target, label:r.label, condition:pred(r.condition), effects:effects(r.effects), once:r.once==='1', passive:r.kind==='passive', cost:Number(r.costSeconds), checkId:r.check }));
  // Node conditions also guard entry; option-only exports previously hid this fact.
  for (const n of table('dialogue_nodes')) {
    const gate = pred(n.condition).groups[0];
    if (gate.length) for (const c of story.choices.filter(c => !c.checkId && c.toId === n.id)) c.condition.groups = (c.condition.groups.length ? c.condition.groups : [[]]).map(g => [...g,...gate]);
  }
  const sleep = story.choices.find(c => c.id === 'sleep');
  if (sleep) sleep.effects = [{ variableId:'elapsed',op:'set',value:115200 },{ variableId:'health',op:'set',value:3 },{ variableId:'morale',op:'set',value:3 }];
  const retrySources: Record<string,string[]> = { rope:['skill:endurance','scarf_equipped'], testimony:['skill:empathy','ledger_found','copy_found'], ledger:['skill:logic','timeline_found'] };
  story.checks = table('checks').map(r => ({ id:r.id, name:r.name, variableId:'skill:'+r.skill, difficulty:Number(r.difficulty), retry:r.kind==='white'?'on-change':'once', retryVariableIds:retrySources[r.id] || [], successId:r.successNode, failureId:r.failureNode, successEffects:effects(r.successEffects), failureEffects:effects(r.failureEffects), modifiers:[], notes:r.modifiers + '；重试来源：' + r.retrySources }));
  const modifier = (id:string, condition:StoryPredicate, value:number) => story.checks.find(c=>c.id===id)?.modifiers.push({condition,value});
  modifier('rope',all(condition('scarf_equipped','eq',1)),1);
  modifier('testimony',{groups:[[condition('ledger_found','eq',1)],[condition('copy_found','eq',1)]]},2);
  modifier('testimony',all(condition('thought_worker_done','eq',1)),1); modifier('testimony',all(condition('witness_scared','eq',1)),-2);
  modifier('pressure',all(condition('thought_doubt_done','eq',1)),-1); modifier('ledger',all(condition('timeline_found','eq',1)),2);
  const addChoice = (id:string, fromId:string, toId:string, label:string, gate=always(), changes:StoryEffect[]=[], cost=0) => story.choices.push({id,fromId,toId,label,condition:gate,effects:changes,cost,once:false,passive:false,checkId:''});
  const exploring = condition('elapsed','lt',165600), open = condition('case_closed','eq',0);
  addChoice('visit-yard','exit_dialogue','yard_hub','前往卸货后院',all(open,exploring));
  for (const person of table('people')) {
    const windows = table('schedules').filter(w=>w.person===person.id);
    const gate:StoryPredicate = {groups:windows.map(w=>[open,exploring,condition('elapsed','gte',Number(w.startSeconds)),condition('elapsed','lt',Number(w.endSeconds))])};
    addChoice('visit-'+person.id,'exit_dialogue',person.rootNode,'拜访'+person.name,gate);
  }
  addChoice('return-report','exit_dialogue','report_hub','返回旅馆汇报案情',all(open));
  addChoice('wait-half-hour','exit_dialogue','exit_dialogue','等待半小时',all(open,exploring),[],1800);
  addChoice('equip-scarf','exit_dialogue','exit_dialogue','装备旧围巾',all(open,exploring,condition('scarf_equipped','eq',0)),[{variableId:'scarf_equipped',op:'set',value:1}]);
  const node = (id:string,title:string,text:string,kind:NarrativeNode['kind']='narration'):NarrativeNode => ({id,sceneId:'investigation',title,text,kind,speakerId:'',outcome:'',taskStatus:'unchanged',taskIds:[]});
  story.nodes.push(node('recovery','紧急恢复','你已无法继续行动。可以消耗恢复物，或明确暂缓本次调查。'),node('resume-investigation','恢复后继续','恢复完成，继续阅读原先的结果。','return'));
  addChoice('recover-health','recovery','resume-investigation','使用恢复物恢复健康',all(condition('health','lte',0),condition('meds','gte',1)),[{variableId:'meds',op:'add',value:-1},{variableId:'health',op:'add',value:2}]);
  addChoice('recover-morale','recovery','resume-investigation','使用恢复物恢复士气',all(condition('morale','lte',0),condition('meds','gte',1)),[{variableId:'meds',op:'add',value:-1},{variableId:'morale',op:'add',value:2}]);
  addChoice('abandon-recovery','recovery','report_pause','放弃恢复并暂缓调查',always(),[{variableId:'case_closed',op:'set',value:1}]);
  story.interrupts = [{id:'critical-resources',name:'健康或士气归零',condition:{groups:[[condition('health','lte',0)],[condition('morale','lte',0)]]},nodeId:'recovery'},
    {id:'case-deadline',name:'两日调查期限结束',condition:all(condition('elapsed','gte',165600),open),nodeId:'report_hub'}];
  // At the deadline the report hub must remain usable, with no route back to exploration.
  for (const c of story.choices.filter(c=>c.fromId==='report_hub' && c.toId==='exit_dialogue')) c.condition=all(exploring);
  validateStoryOrchestration({schema:1,enabled:true,stories:[story]});
  return story;
}
