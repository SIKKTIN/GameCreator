import { withCharacterLibrary, resolveStoryActors, storyValueText, storyCharacterIssues, type StoryCharacter, type StoryRelationship } from './story-characters.ts';
export type StoryCondition = { variableId: string; op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'; value: number };
/** OR between groups; AND within each group. No groups means unconditional. */
export type StoryPredicate = { groups: StoryCondition[][] };
export type StoryEffect = { variableId: string; op: 'set' | 'add'; value: number };
export type StoryVariable = { id: string; name: string; category: string; initial: number; minimum: number | null; maximum: number | null; kind?: 'flag' | 'number'; trueLabel?: string; falseLabel?: string; characterId?: string };
export type StoryActor = { id: string; name: string; description: string; kind?: 'character' | 'voice'; characterId?: string; voiceType?: string };
export type StoryScene = { id: string; title: string; chapter: string; description: string };
export type NarrativeNode = { id: string; sceneId: string; title: string; kind: 'dialogue' | 'narration' | 'inner' | 'hub' | 'ending' | 'return'; speakerId: string; text: string; outcome: string; taskStatus: 'unchanged' | 'completed' | 'suspended' | 'failed'; taskIds: string[] };
export type StoryChoice = { id: string; fromId: string; toId: string; label: string; condition: StoryPredicate; effects: StoryEffect[]; once: boolean; passive: boolean; cost: number; checkId: string };
export type NarrativeCheck = { id: string; name: string; variableId: string; difficulty: number; retry: 'always' | 'once' | 'on-change'; retryVariableIds: string[]; successId: string; failureId: string; successEffects: StoryEffect[]; failureEffects: StoryEffect[]; modifiers: { condition: StoryPredicate; value: number }[]; notes: string; mode?: 'dice' | 'threshold'; diceCount?: number; diceSides?: number; criticals?: boolean };
export type Narrative = { id: string; title: string; summary: string; archived: boolean; entryId: string; source: string; taskIds: string[]; scenes: StoryScene[]; actors: StoryActor[]; variables: StoryVariable[]; nodes: NarrativeNode[]; choices: StoryChoice[]; checks: NarrativeCheck[]; clockId: string; timeLimit: number; interrupts: { id: string; name: string; condition: StoryPredicate; nodeId: string }[] };
export type StoryOrchestrationStore = { schema: 1; enabled: boolean; stories: Narrative[]; characters?: StoryCharacter[]; relationships?: StoryRelationship[] };
export const conditionOperators = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const;
export const nodeKindNames: Record<NarrativeNode['kind'], string> = { dialogue: '对白', narration: '旁白', inner: '叙事插话', hub: '互动入口', ending: '故事结果', return: '返回中断前内容' };
export const emptyStoryOrchestration = (): StoryOrchestrationStore => ({ schema: 1, enabled: false, stories: [] });
export const always = (): StoryPredicate => ({ groups: [] });
export function createNarrative(title: string): Narrative {
  if (!title.trim()) throw new Error('请填写故事名称');
  const sceneId = crypto.randomUUID(), nodeId = crypto.randomUUID();
  return { id: crypto.randomUUID(), title: title.trim(), summary: '', archived: false, entryId: nodeId, source: '', taskIds: [], scenes: [{ id: sceneId, title: '开场', chapter: '第一章', description: '' }], actors: [], variables: [], nodes: [{ id: nodeId, sceneId, title: '故事开场', kind: 'narration', speakerId: '', text: '', outcome: '', taskStatus: 'unchanged', taskIds: [] }], choices: [], checks: [], clockId: '', timeLimit: 0, interrupts: [] };
}

/** Shape validation is separate from design completeness. Broken draft references are retained for repair. */
export function validateStoryOrchestration(value: unknown): StoryOrchestrationStore {
  const fail = (): never => { throw new Error('故事编排存档格式异常，已停止写入'); };
  const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const fields = (v: Record<string, unknown>, names: string[]) => names.every(n => typeof v[n] === 'string');
  const safe = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && !['__proto__', 'constructor', 'prototype'].includes(v);
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const list = (v: unknown): v is string[] => Array.isArray(v) && v.every(safe) && new Set(v).size === v.length;
  const predicate = (v: unknown) => obj(v) && Array.isArray(v.groups) && v.groups.every(g => Array.isArray(g) && g.every(c => obj(c) && fields(c, ['variableId']) && ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'].includes(c.op as string) && finite(c.value)));
  const effects = (v: unknown) => Array.isArray(v) && v.every(e => obj(e) && fields(e, ['variableId']) && ['set', 'add'].includes(e.op as string) && finite(e.value));
  if (!obj(value) || value.schema !== 1 || typeof value.enabled !== 'boolean' || !Array.isArray(value.stories)) return fail();
  const entries = (xs: unknown, check: (item: Record<string, unknown>) => boolean) => Array.isArray(xs) && xs.every(x => obj(x) && safe(x.id) && check(x)) && new Set(xs.map(x => x.id)).size === xs.length;
  if (value.characters !== undefined && !entries(value.characters, c => fields(c, ['name','description','role','faction','background','motivation','personality','speech','color']) && /^#[0-9a-f]{6}$/i.test(c.color as string) && obj(c.position) && finite(c.position.x) && finite(c.position.y) && c.position.x >= 0 && c.position.y >= 0 && (c.portrait === null || obj(c.portrait) && fields(c.portrait, ['assetId','versionId','fileId'])))) return fail();
  if (value.relationships !== undefined && !entries(value.relationships, r => fields(r, ['fromId','toId','label','description','secret']) && typeof r.directed === 'boolean')) return fail();
  const storyIds = new Set<string>();
  for (const s of value.stories) {
    if (!obj(s) || !safe(s.id) || storyIds.has(s.id) || !fields(s, ['title', 'summary', 'entryId', 'source', 'clockId']) || typeof s.archived !== 'boolean' || !list(s.taskIds) || !finite(s.timeLimit) || s.timeLimit < 0 || !['scenes', 'actors', 'variables', 'nodes', 'choices', 'checks', 'interrupts'].every(k => Array.isArray(s[k]))) return fail();
    storyIds.add(s.id);
    for (const section of ['scenes', 'actors', 'variables', 'nodes', 'choices', 'checks', 'interrupts']) {
      const ids = new Set<string>();
      for (const item of s[section] as unknown[]) {
        if (!obj(item) || !safe(item.id) || ids.has(item.id)) return fail(); ids.add(item.id);
        if (section === 'scenes' && !fields(item, ['title', 'chapter', 'description'])) return fail();
        if (section === 'actors' && !fields(item, ['name', 'description'])) return fail();
        if (section === 'actors' && (item.kind !== undefined && !['character','voice'].includes(item.kind as string) || ['characterId','voiceType'].some(k => item[k] !== undefined && typeof item[k] !== 'string'))) return fail();
        if (section === 'variables' && (item.kind !== undefined && !['flag','number'].includes(item.kind as string) || ['trueLabel','falseLabel','characterId'].some(k => item[k] !== undefined && typeof item[k] !== 'string') || item.kind === 'flag' && (item.minimum !== 0 || item.maximum !== 1 || ![0,1].includes(item.initial as number)))) return fail();
        if (section === 'variables' && (!fields(item, ['name', 'category']) || !finite(item.initial) || !(item.minimum === null || finite(item.minimum)) || !(item.maximum === null || finite(item.maximum)) || item.minimum !== null && item.initial < (item.minimum as number) || item.maximum !== null && item.initial > (item.maximum as number))) return fail();
        if (section === 'nodes' && (!fields(item, ['sceneId', 'title', 'speakerId', 'text', 'outcome']) || !['dialogue', 'narration', 'inner', 'hub', 'ending', 'return'].includes(item.kind as string) || !['unchanged', 'completed', 'suspended', 'failed'].includes(item.taskStatus as string) || !list(item.taskIds))) return fail();
        if (section === 'choices' && (!fields(item, ['fromId', 'toId', 'label', 'checkId']) || !predicate(item.condition) || !effects(item.effects) || typeof item.once !== 'boolean' || typeof item.passive !== 'boolean' || !finite(item.cost) || item.cost < 0)) return fail();
        if (section === 'checks' && (!fields(item, ['name', 'variableId', 'successId', 'failureId', 'notes']) || !finite(item.difficulty) || !['always', 'once', 'on-change'].includes(item.retry as string) || !list(item.retryVariableIds) || !effects(item.successEffects) || !effects(item.failureEffects) || !Array.isArray(item.modifiers) || !item.modifiers.every(m => obj(m) && predicate(m.condition) && finite(m.value)))) return fail();
        if (section === 'checks' && (item.mode !== undefined && !['dice','threshold'].includes(item.mode as string) || item.criticals !== undefined && typeof item.criticals !== 'boolean' || item.diceCount !== undefined && (!Number.isInteger(item.diceCount) || (item.diceCount as number) < 1 || (item.diceCount as number) > 10) || item.diceSides !== undefined && (!Number.isInteger(item.diceSides) || (item.diceSides as number) < 2 || (item.diceSides as number) > 100))) return fail();
        if (section === 'interrupts' && (!fields(item, ['name', 'nodeId']) || !predicate(item.condition))) return fail();
      }
    }
  }
  return value as StoryOrchestrationStore;
}
export function predicateMet(predicate: StoryPredicate, state: Record<string, number>): boolean {
  return !predicate.groups.length || predicate.groups.some(group => group.every(c => {
    if (!Object.prototype.hasOwnProperty.call(state, c.variableId) || !Number.isFinite(state[c.variableId])) return false;
    const value = state[c.variableId];
    return { eq: value === c.value, neq: value !== c.value, gt: value > c.value, gte: value >= c.value, lt: value < c.value, lte: value <= c.value }[c.op];
  }));
}
export function predicateText(p: StoryPredicate, story: Narrative): string {
  const symbols = { eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤' };
  return p.groups.map(g => '(' + g.map(c => { const v = story.variables.find(v => v.id === c.variableId); return (v?.name || '失效变量：' + c.variableId) + ' ' + symbols[c.op] + ' ' + (v ? storyValueText(v, c.value) : c.value); }).join(' 且 ') + ')').join(' 或 ') || '无附加条件';
}
export function effectsText(effects: StoryEffect[], story: Narrative): string {
  return effects.map(e => { const v = story.variables.find(v => v.id === e.variableId); return (v?.name || '失效变量：' + e.variableId) + (e.op === 'set' ? ' 设为 ' : ' 增减 ') + (v && e.op === 'set' ? storyValueText(v, e.value) : e.value); }).join('；') || '无状态变化';
}
export function narrativeIssues(story: Narrative, tasks?: { id: string; title: string; archived?: boolean }[]): { nodeId?: string; message: string }[] {
  const issues: { nodeId?: string; message: string }[] = [], add = (message: string, nodeId?: string) => issues.push({ message, nodeId });
  const nodes = new Map(story.nodes.map(n => [n.id, n])), vars = new Set(story.variables.map(v => v.id)), checks = new Map(story.checks.map(c => [c.id, c]));
  if (!story.title.trim()) add('故事尚未命名');
  if (!nodes.has(story.entryId)) add('故事入口未设置或已失效');
  if (story.clockId && !vars.has(story.clockId)) add('故事时钟已失效');
  const conditions = (p: StoryPredicate, label: string, nodeId?: string) => { for (const g of p.groups) for (const c of g) if (!vars.has(c.variableId)) add(label + '引用了失效变量：' + c.variableId, nodeId); };
  const effects = (es: StoryEffect[], label: string, nodeId?: string) => { for (const e of es) if (!vars.has(e.variableId)) add(label + '引用了失效变量：' + e.variableId, nodeId); };
  const taskRefs = (ids: string[], nodeId?: string) => { if (tasks) for (const id of ids) { const t = tasks.find(t => t.id === id); if (!t || t.archived) add('关联任务已失效或归档：' + (t?.title || id), nodeId); } };
  taskRefs(story.taskIds);
  for (const c of story.checks) {
    if (!vars.has(c.variableId) || c.retryVariableIds.some(id => !vars.has(id))) add('检定的技能或重试来源已失效：' + c.name);
    if (!nodes.has(c.successId) || !nodes.has(c.failureId)) add('检定后继未设置或已失效：' + c.name);
    effects(c.successEffects, c.name); effects(c.failureEffects, c.name); c.modifiers.forEach(m => conditions(m.condition, c.name));
  }
  const outgoing = new Map<string, string[]>();
  for (const c of story.choices) {
    const check = checks.get(c.checkId), targets = c.checkId ? check ? [check.successId, check.failureId] : [] : [c.toId];
    if (!nodes.has(c.fromId) || !targets.length || targets.some(id => !nodes.has(id))) add('选项后继未设置或已失效：' + (c.label || c.id), c.fromId);
    if (!c.label.trim()) add('选项文本待补充', c.fromId);
    if (c.passive && (c.checkId || c.cost || c.effects.length)) add('自动插话只展示内容，请将检定、成本和后果放在玩家选项中', c.fromId);
    conditions(c.condition, c.label, c.fromId); effects(c.effects, c.label, c.fromId);
    if (nodes.get(c.fromId)?.kind !== 'ending') outgoing.set(c.fromId, [...(outgoing.get(c.fromId) || []), ...targets]);
  }
  for (const i of story.interrupts) { if (!nodes.has(i.nodeId)) add('中断入口已失效：' + i.name); conditions(i.condition, i.name); }
  const seen = new Set<string>(), pending = [story.entryId, ...story.interrupts.map(i => i.nodeId)];
  while (pending.length) { const id = pending.pop()!; if (seen.has(id)) continue; seen.add(id); pending.push(...(outgoing.get(id) || [])); }
  for (const n of story.nodes) {
    if (!n.title.trim() || !n.text.trim()) add('片段标题或正文待补充：' + (n.title || n.id), n.id);
    if (!story.scenes.some(s => s.id === n.sceneId)) add('所属场景已失效：' + n.title, n.id);
    if (n.speakerId && !story.actors.some(a => a.id === n.speakerId)) add('说话人已失效：' + n.title, n.id);
    if (!seen.has(n.id)) add('从入口无法到达：' + n.title, n.id);
    if (!['ending', 'return'].includes(n.kind) && !(outgoing.get(n.id)?.length)) add('片段没有后续选项：' + n.title, n.id);
    if (n.kind === 'ending' && story.choices.some(c => c.fromId === n.id)) add('故事结果不再推进，请调整后续选项', n.id);
    taskRefs(n.taskIds, n.id);
  }
  return issues;
}
export function removeNarrativeNode(story: Narrative, id: string): Narrative {
  if (story.entryId === id || story.choices.some(c => c.fromId === id || c.toId === id) || story.checks.some(c => c.successId === id || c.failureId === id) || story.interrupts.some(i => i.nodeId === id)) throw new Error('请先调整入口、选项、检定和中断引用，再删除片段');
  return { ...story, nodes: story.nodes.filter(n => n.id !== id) };
}
export function copyNarrative(story: Narrative): Narrative {
  // Internal IDs are scoped to a story; copied stories get an independent namespace.
  return { ...structuredClone(story), id: crypto.randomUUID(), title: story.title + '（副本）', archived: false };
}
export function readStoryOrchestration(storage: Pick<Storage, 'getItem'>, key: string) {
  const raw = storage.getItem(key); return { raw, store: withCharacterLibrary(raw === null ? emptyStoryOrchestration() : validateStoryOrchestration(JSON.parse(raw))) };
}
export function writeStoryOrchestration(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, expected: string | null, store: StoryOrchestrationStore): string {
  const raw = storage.getItem(key); if (raw !== null) validateStoryOrchestration(JSON.parse(raw));
  if (raw !== expected) throw new Error('其他窗口已更新故事编排，当前草稿已保留，请处理版本冲突');
  const next = JSON.stringify(validateStoryOrchestration(store)); storage.setItem(key, next); return next;
}
export function storyOrchestrationMarkdown(store: StoryOrchestrationStore): string {
  if (!store.enabled) return '';
  store = withCharacterLibrary(store);
  const out = ['## 故事编排', '', '> 条件、选项和后果是故事设计；独立试玩进度不保存到项目。', ''];
  for (const issue of storyCharacterIssues(store)) out.push('- 待修复：' + issue);
  for (const c of store.characters || []) out.push(`### 人物：${c.name} [${c.id}]`, c.description, `- 身份：${c.role}；阵营：${c.faction}`, `- 背景：${c.background}`, `- 动机：${c.motivation}`, `- 性格：${c.personality}`, `- 说话风格：${c.speech}`, `- 肖像引用：${c.portrait ? JSON.stringify(c.portrait) : '未指定'}`);
  for (const r of store.relationships || []) out.push(`- 人物关系：${store.characters?.find(c=>c.id===r.fromId)?.name || r.fromId} ${r.directed ? '→' : '↔'} ${store.characters?.find(c=>c.id===r.toId)?.name || r.toId}；${r.label}；${r.description}；隐情：${r.secret}`);
  for (const original of store.stories) {
    const s = resolveStoryActors(store, original);
    const title = (id: string) => s.nodes.find(n => n.id === id)?.title || '失效片段：' + id;
    out.push('### ' + s.title + (s.archived ? '（已归档）' : ''), s.summary, '- 入口：' + title(s.entryId), '- 关联任务：' + s.taskIds.join('、'));
    for (const actor of s.actors) out.push(`- ${actor.kind === 'voice' ? '叙事发言者（'+(actor.voiceType || '自定义')+'）' : '出场人物'}：${actor.name} [${actor.id}]；${actor.description}${actor.characterId ? '；人物库：'+actor.characterId : ''}`);
    for (const v of s.variables) out.push(`- 状态：${v.name} [${v.id}]；${v.category}；初值 ${storyValueText(v,v.initial)}；范围 ${v.minimum ?? '不限'} 至 ${v.maximum ?? '不限'}${v.characterId ? '；关联人物：'+v.characterId : ''}`);
    const orphanedSceneIds = [...new Set(s.nodes.filter(n => !s.scenes.some(scene => scene.id === n.sceneId)).map(n => n.sceneId))];
    const scenes = [...s.scenes, ...orphanedSceneIds.map(id => ({ id, title: '失效场景：' + id, chapter: '待修复', description: '以下片段保留完整正文，请重新指定所属场景。' }))];
    for (const scene of scenes) {
      out.push('', '#### ' + scene.chapter + ' / ' + scene.title, scene.description);
      for (const n of s.nodes.filter(n => n.sceneId === scene.id)) {
        out.push('', `##### ${n.title} [${n.id}]`, `${nodeKindNames[n.kind]} · ${s.actors.find(a => a.id === n.speakerId)?.name || '旁白'}`, n.text);
        if (n.outcome || n.kind === 'ending') out.push('- 叙事结果：' + n.outcome);
        if (n.taskStatus !== 'unchanged' || n.taskIds.length || n.kind === 'ending') out.push('- 任务状态：' + n.taskStatus + '；目标：' + n.taskIds.join('、'));
        for (const c of s.choices.filter(c => c.fromId === n.id)) out.push(`- ${c.passive ? '自动插话' : '选项'}：${c.label} → ${c.checkId ? '检定：' + c.checkId : title(c.toId)}；${predicateText(c.condition, s)}；后果：${effectsText(c.effects, s)}；时间 ${c.cost}；${c.once ? '仅首次提交后果' : '每次提交后果'}`);
      }
    }
    for (const c of s.checks) out.push(`- 检定 ${c.name} [${c.id}]：${c.variableId}；规则：${c.mode === 'threshold' ? '数值＋条件修正' : `${c.diceCount ?? 2}d${c.diceSides ?? 6}＋数值＋条件修正；极值成败${(c.criticals ?? true) ? '开启' : '关闭'}`}；难度 ${c.difficulty}；重试 ${c.retry}；来源 ${c.retryVariableIds.join('、')}；成功→${title(c.successId)}：${effectsText(c.successEffects,s)}；失败→${title(c.failureId)}：${effectsText(c.failureEffects,s)}`, ...c.modifiers.map(m => `  - 修正 ${m.value}：${predicateText(m.condition,s)}`), c.notes);
    if (s.clockId) out.push(`- 时钟：${s.clockId}；上限：${s.timeLimit || '无'}`);
    for (const i of s.interrupts) out.push(`- 中断：${i.name}；${predicateText(i.condition,s)} → ${title(i.nodeId)}`);
    for (const issue of narrativeIssues(s)) out.push('- 待完善：' + issue.message);
  }
  return out.join('\n');
}
