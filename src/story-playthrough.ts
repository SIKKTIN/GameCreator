import { resolveNarrativeCheck } from './story-check.ts';
import { predicateMet, predicateText, type Narrative, type StoryChoice, type StoryEffect } from './story-orchestration.ts';
import { isStoryFlag } from './story-characters.ts';
export type CheckRecord = { result: 'success' | 'failure'; sources: Record<string, number> };
export type StoryFrame = { nodeId: string; state: Record<string, number>; used: string[]; checks: Record<string, CheckRecord>; resumeId: string; passives: string[]; tasks: Record<string, string>; visited: string[]; log: { text: string; changes: string[] }[] };
export type StoryPlaythrough = { current: StoryFrame; history: StoryFrame[] };
export function startStory(story: Narrative, initial: Record<string, number> = {}): StoryPlaythrough {
  if (!story.nodes.some(n => n.id === story.entryId)) throw new Error('请先设置有效的故事入口');
  const state: Record<string, number> = {};
  for (const v of story.variables) {
    const x = Object.prototype.hasOwnProperty.call(initial, v.id) ? initial[v.id] : v.initial;
    if (!Number.isFinite(x) || v.minimum !== null && x < v.minimum || v.maximum !== null && x > v.maximum || isStoryFlag(v) && x !== 0 && x !== 1) throw new Error('初始状态超出范围：' + v.name);
    state[v.id] = x;
  }
  const frame: StoryFrame = { nodeId: story.entryId, state, used: [], checks: {}, resumeId: '', passives: [], tasks: {}, visited: [], log: [] };
  settle(story, frame); return { current: frame, history: [] };
}
function applyEffects(story: Narrative, frame: StoryFrame, effects: StoryEffect[]) {
  for (const effect of effects) {
    const v = story.variables.find(v => v.id === effect.variableId);
    if (!v) throw new Error('后果引用了失效变量：' + effect.variableId);
    let next = effect.op === 'set' ? effect.value : frame.state[v.id] + effect.value;
    if (!Number.isFinite(next)) throw new Error('状态结果不是有限数值');
    if (v.minimum !== null && next < v.minimum) throw new Error('状态不足，未提交本次选择：' + v.name);
    if (v.maximum !== null) next = Math.min(v.maximum, next);
    if (isStoryFlag(v) && next !== 0 && next !== 1) throw new Error('是／否状态只能设为两种取值：' + v.name);
    frame.state[v.id] = next;
  }
}
/** Pure, bounded state normalization; automatic passages can never hang the editor. */
function settle(story: Narrative, frame: StoryFrame) {
  for (let step = 0; step < 100; step++) {
    const node = story.nodes.find(n => n.id === frame.nodeId);
    if (!node) throw new Error('片段已失效，未提交本次选择');
    if (frame.visited[frame.visited.length - 1] !== node.id) frame.visited.push(node.id);
    if (node.taskStatus !== 'unchanged') for (const id of node.taskIds) frame.tasks[id] = node.taskStatus;
    if (node.kind === 'ending') return;
    if (node.kind === 'return') {
      if (!frame.resumeId) throw new Error('没有可返回的中断前片段');
      frame.nodeId = frame.resumeId; frame.resumeId = ''; continue;
    }
    const interrupt = story.interrupts.find(i => predicateMet(i.condition, frame.state));
    if (interrupt && interrupt.nodeId !== frame.nodeId) { frame.resumeId ||= frame.nodeId; frame.nodeId = interrupt.nodeId; frame.log.push({ text: '中断：' + interrupt.name, changes: [] }); continue; }
    const passive = story.choices.find(c => c.fromId === frame.nodeId && c.passive && !frame.passives.includes(c.id) && !(c.once && frame.used.includes(c.id)) && predicateMet(c.condition, frame.state));
    if (passive) {
      if (passive.checkId || passive.cost || passive.effects.length) throw new Error('自动插话不能提交检定、时间或状态后果');
      frame.passives.push(passive.id); if (passive.once && !frame.used.includes(passive.id)) frame.used.push(passive.id); frame.nodeId = passive.toId; frame.log.push({ text: '自动插话：' + passive.label, changes: [] }); continue;
    }
    return;
  }
  throw new Error('自动跳转超过100步，请检查中断与插话循环');
}
export function choiceBlockReason(story: Narrative, frame: StoryFrame, choice: StoryChoice): string {
  if (choice.fromId !== frame.nodeId || story.nodes.find(n => n.id === frame.nodeId)?.kind === 'ending') return '不是当前片段的选项';
  if (choice.passive) return '自动插话';
  if (!predicateMet(choice.condition, frame.state)) return predicateText(choice.condition, story);
  if (choice.checkId) {
    const check = story.checks.find(c => c.id === choice.checkId); if (!check) return '检定已失效';
    const old = frame.checks[check.id];
    if (old?.result === 'failure' && check.retry === 'on-change' && !check.retryVariableIds.some(id => frame.state[id] > (old.sources[id] ?? frame.state[id]))) return '上次检定失败，尚未获得新的重试来源';
    if (!story.nodes.some(n => n.id === check.successId) || !story.nodes.some(n => n.id === check.failureId)) return '检定后继未设置';
  } else if (!story.nodes.some(n => n.id === choice.toId)) return '后继片段未设置';
  return '';
}
export function chooseStoryOption(story: Narrative, preview: StoryPlaythrough, choiceId: string, resolution: 'success' | 'failure' | number[] = [3, 3]): StoryPlaythrough {
  const choice = story.choices.find(c => c.id === choiceId); if (!choice) throw new Error('选项已失效');
  const reason = choiceBlockReason(story, preview.current, choice); if (reason) throw new Error(reason);
  const before = preview.current, next = structuredClone(before);
  let target = choice.toId, effects = choice.effects, replay = choice.once && next.used.includes(choice.id), description = choice.label;
  if (choice.checkId) {
    const check = story.checks.find(c => c.id === choice.checkId)!, old = next.checks[check.id];
    replay = !!old && (old.result === 'success' || check.retry === 'once');
    let result: 'success' | 'failure';
    if (replay) result = old.result;
    else if (typeof resolution === 'string') result = resolution;
    else {
      const threshold = check.mode === 'threshold';
      const resolved = resolveNarrativeCheck(check, next.state, resolution);
      const score = resolved.score;
      result = resolved.success ? 'success' : 'failure';
      description += `（${threshold ? '数值比较' : '骰点 '+resolution.join('+')}，合计 ${score} / ${check.difficulty}）`;
    }
    target = result === 'success' ? check.successId : check.failureId;
    effects = [...(result === 'success' ? check.successEffects : check.failureEffects), ...effects];
    description += replay ? '（回看已结算检定）' : result === 'success' ? '（检定成功）' : '（检定失败）';
    if (!replay) next.checks[check.id] = { result, sources: Object.fromEntries(check.retryVariableIds.map(id => [id, next.state[id]])) };
  }
  if (!replay) {
    applyEffects(story, next, effects);
    if (choice.cost && !story.clockId) throw new Error('选项有时间成本，但故事未设置时钟');
    if (story.clockId) {
      if (!Object.prototype.hasOwnProperty.call(next.state, story.clockId)) throw new Error('故事时钟已失效');
      const time = next.state[story.clockId] + choice.cost;
      if (time < before.state[story.clockId]) throw new Error('故事时间不能倒退');
      next.state[story.clockId] = story.timeLimit > 0 ? Math.min(time, story.timeLimit) : time;
    }
    if (!next.used.includes(choice.id)) next.used.push(choice.id);
  }
  next.nodeId = target;
  if (story.nodes.find(n => n.id === target)?.kind === 'hub') next.passives = [];
  const changes = story.variables.filter(v => before.state[v.id] !== next.state[v.id]).map(v => `${v.name}：${before.state[v.id]} → ${next.state[v.id]}`);
  next.log.push({ text: description + (replay && !choice.checkId ? '（已读，不重复提交后果）' : ''), changes });
  settle(story, next);
  return { current: next, history: [...preview.history, structuredClone(before)] };
}
export function visibleStoryChoices(story: Narrative, frame: StoryFrame): { choice: StoryChoice; reason: string }[] {
  const items = story.choices.filter(c => c.fromId === frame.nodeId && !c.passive).map(choice => ({ choice, reason: choiceBlockReason(story, frame, choice) }));
  // Equivalent authored OR routes appear once, preferring a currently available route.
  const groups = new Map<string, { choice: StoryChoice; reason: string }>();
  for (const item of items) {
    const c = item.choice, key = JSON.stringify([c.label,c.toId,c.checkId,c.effects,c.once,c.cost]);
    if (!groups.has(key) || groups.get(key)!.reason && !item.reason) groups.set(key,item);
  }
  return [...groups.values()];
}
export function rewindStory(preview: StoryPlaythrough): StoryPlaythrough {
  if (!preview.history.length) return preview;
  return { current: structuredClone(preview.history[preview.history.length - 1]), history: preview.history.slice(0, -1) };
}
