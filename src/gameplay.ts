import { validateGameplayLibrary, categoryName, type GameplayCategory } from './gameplay-library.ts';
import { emptyStage, copyStage, validateStage, stageMarkdown, type GameplayStage } from './gameplay-stage.ts';
import { emptyStructure, copyStructure, validateStructure, structureMarkdown, type GameplayStructure } from './gameplay-structure.ts';
export const gameplayStatuses = ['草稿', '待验证', '验证中', '已验证'] as const;
export const gameplayResults = ['未测试', '通过', '需要调整'] as const;
export type GameplayStatus = typeof gameplayStatuses[number];
export type GameplayLink = { kind: 'story' | 'dataset'; targetId: string };
export type LoopStep = { id: string; text: string };
export type PrototypeItem = LoopStep & { done: boolean };
export type GameplayCheck = { id: string; question: string; steps: string; expected: string; actual: string; result: typeof gameplayResults[number] };
export type GameplayDesign = GameplayStructure & GameplayStage & {
  categoryId?: string; tags?: string[];
  id: string; title: string; summary: string; experience: string; rules: string; winCondition: string; loseCondition: string;
  status: GameplayStatus; archived: boolean; loop: LoopStep[]; prototype: PrototypeItem[]; deferred: string;
  checks: GameplayCheck[]; links: GameplayLink[]; createdAt: string; updatedAt: string;
};
export type GameplayStore = { schema: 3; designs: GameplayDesign[]; categories?: GameplayCategory[] };
export type GameplaySources = { stories: { id: string; title: string; sourceOnly?: boolean }[]; datasets: { key: string; label: string }[] };
export const emptyGameplay = (): GameplayStore => ({ schema: 3, designs: [] });
export function createGameplay(title: string): GameplayDesign {
  if (!title.trim()) throw new Error('请输入玩法名称');
  const now = new Date().toISOString();
  return { ...emptyStructure(), ...emptyStage(), id: crypto.randomUUID(), title: title.trim(), summary: '', experience: '', rules: '', winCondition: '', loseCondition: '',
    status: '草稿', archived: false, loop: [], prototype: [], deferred: '', checks: [], links: [], createdAt: now, updatedAt: now };
}
export function duplicateGameplay(source: GameplayDesign): GameplayDesign {
  const base = createGameplay((source.title.trim() || '未命名玩法') + ' · 副本');
  const structure = copyStructure(source), ruleIds = new Map(source.conditionRules.map((rule, index) => [rule.id, structure.conditionRules[index].id]));
  return { ...structuredClone(source), ...base,
    summary: source.summary, experience: source.experience, rules: source.rules, winCondition: source.winCondition, loseCondition: source.loseCondition,
    loop: source.loop.map(step => ({ ...step, id: crypto.randomUUID() })),
    prototype: source.prototype.map(item => ({ ...item, id: crypto.randomUUID(), done: false })), deferred: source.deferred,
    checks: source.checks.map(check => ({ ...check, id: crypto.randomUUID(), actual: '', result: '未测试' })), links: structuredClone(source.links), ...structure, ...copyStage(source, base.id, ruleIds) };
}
export function moveGameplayItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
  const next = [...items]; [next[index], next[target]] = [next[target], next[index]]; return next;
}
export function validateGameplay(value: unknown): GameplayStore {
  const fail = (): never => { throw new Error('玩法存档格式异常，已停止写入'); };
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const strings = (v: Record<string, unknown>, keys: string[]) => keys.every(k => typeof v[k] === 'string');
  const ids = (list: unknown[], validate: (v: Record<string, unknown>) => boolean) => {
    const seen = new Set<string>();
    for (const item of list) {
      if (!record(item) || typeof item.id !== 'string' || !item.id || seen.has(item.id) || !validate(item)) fail();
      seen.add((item as Record<string, unknown>).id as string);
    }
  };
  if (!record(value) || ![1, 2, 3].includes(value.schema as number) || !Array.isArray(value.designs)) return fail();
  validateGameplayLibrary(value);
  ids(value.designs, d => {
    if (!strings(d, ['title', 'summary', 'experience', 'rules', 'winCondition', 'loseCondition', 'deferred', 'createdAt', 'updatedAt']) ||
        !gameplayStatuses.includes(d.status as GameplayStatus) || typeof d.archived !== 'boolean' ||
        !Number.isFinite(Date.parse(d.createdAt as string)) || !Number.isFinite(Date.parse(d.updatedAt as string)) ||
        !Array.isArray(d.loop) || !Array.isArray(d.prototype) || !Array.isArray(d.checks) || !Array.isArray(d.links)) return false;
    ids(d.loop, s => strings(s, ['text']));
    ids(d.prototype, s => strings(s, ['text']) && typeof s.done === 'boolean');
    ids(d.checks, s => strings(s, ['question', 'steps', 'expected', 'actual']) && gameplayResults.includes(s.result as typeof gameplayResults[number]));
    const links = new Set<string>();
    for (const link of d.links) {
      if (!record(link) || !['story', 'dataset'].includes(link.kind as string) || typeof link.targetId !== 'string' || !link.targetId) return false;
      const key = JSON.stringify([link.kind, link.targetId]); if (links.has(key)) return false; links.add(key);
    }
    return true;
  });
  const designs = (value.designs as GameplayDesign[]).map(design => {
    const structure = value.schema === 1 ? { ...emptyStructure(), ...design } : design;
    const upgraded = value.schema !== 3 ? { ...emptyStage(), ...structure } : structure;
    validateStructure(upgraded); validateStage(upgraded); return upgraded;
  });
  return { schema: 3, designs, ...(value.categories !== undefined ? { categories: value.categories as GameplayCategory[] } : {}) };
}
export function readGameplay(storage: Pick<Storage, 'getItem'>, key: string) {
  const raw = storage.getItem(key);
  return { raw, store: raw === null ? emptyGameplay() : validateGameplay(JSON.parse(raw)) };
}
export function writeGameplay(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, expected: string | null, store: GameplayStore): string {
  const current = storage.getItem(key);
  if (current !== null) validateGameplay(JSON.parse(current));
  if (current !== expected) throw new Error('其他窗口已更新玩法，当前草稿已保留，请先处理版本冲突');
  const raw = JSON.stringify(validateGameplay(store)); storage.setItem(key, raw); return raw;
}
export function gameplayLinkName(link: GameplayLink, sources: GameplaySources): string | undefined {
  return link.kind === 'story' ? sources.stories.find(s => s.id === link.targetId)?.title : sources.datasets.find(d => d.key === link.targetId)?.label;
}
export function gameplayMarkdown(designs: GameplayDesign[], sources: GameplaySources, implementation?: (design: GameplayDesign) => string, categories: GameplayCategory[] = []): string {
  const text = (s: string) => s.trim() || '待补充';
  const lines = ['## 玩法设计', ''];
  if (categories.length) lines.push('### 文档分类', '', ...categories.map(c => '- ' + c.name + (c.description ? '：' + c.description : '')), '');
  if (!designs.length) lines.push('暂无玩法设计。', '');
  for (const design of designs) {
    lines.push('### ' + text(design.title), '', '- 分类：' + categoryName(design, categories), ...(design.tags?.length ? ['- 标签：' + design.tags.join('、')] : []), '- 状态：' + design.status + (design.archived ? '（已归档）' : ''), '- 最后编辑：' + design.updatedAt, '',
      text(design.summary), '', structureMarkdown(design, designs), '', stageMarkdown(design, designs), '', '#### 体验目标', '', text(design.experience), '', '#### 核心循环', '');
    lines.push(...(design.loop.length ? design.loop.map((s, i) => `${i + 1}. ${text(s.text)}`) : ['待补充']), '', '#### 玩法规则', '', text(design.rules), '',
      '- 胜利条件：' + text(design.winCondition), '- 失败条件：' + text(design.loseCondition), '', '#### 原型范围', '');
    lines.push(...(design.prototype.length ? design.prototype.map(i => `- [${i.done ? 'x' : ' '}] ${text(i.text)}`) : ['待补充']), '', '暂缓内容：', '', text(design.deferred), '', '#### 验证记录', '');
    if (!design.checks.length) lines.push('尚未记录试玩验证。', '');
    for (const [i, check] of design.checks.entries()) lines.push(`${i + 1}. ${text(check.question)}（${check.result}）`, '', '试玩步骤：', text(check.steps), '', '预期结果：', text(check.expected), '', '实际结果：', text(check.actual), '');
    if (implementation) lines.push(implementation(design), '');
    lines.push('#### 关联内容', '');
    lines.push(...(design.links.length ? design.links.map(link => `- ${link.kind === 'story' ? '故事文档' : '配置表'}：${gameplayLinkName(link, sources) ?? '关联已失效（' + link.targetId + '）'}`) : ['暂无关联']), '');
  }
  return lines.join('\n');
}
