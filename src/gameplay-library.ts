import type { GameplayDesign, GameplayStore } from './gameplay.ts';
export const categoryIcons = { folder: '文件夹', character: '角色', map: '地图', combat: '战斗', exploration: '探索', growth: '成长', rules: '规则', book: '文档' } as const;
export type GameplayCategory = { id: string; name: string; description: string; icon: keyof typeof categoryIcons };
export function validateGameplayLibrary(value: unknown): void {
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const fail = (): never => { throw new Error('玩法分类存档格式异常，已停止写入'); };
  if (!record(value) || !Array.isArray(value.designs)) return fail();
  if (value.categories !== undefined) {
    if (!Array.isArray(value.categories)) return fail();
    const ids = new Set(), names = new Set();
    for (const c of value.categories) {
      if (!record(c) || typeof c.id !== 'string' || !c.id.trim() || ids.has(c.id) || typeof c.name !== 'string' || !c.name.trim() || names.has(c.name.trim().toLocaleLowerCase()) || typeof c.description !== 'string' || typeof c.icon !== 'string' || !Object.prototype.hasOwnProperty.call(categoryIcons, c.icon)) return fail();
      ids.add(c.id); names.add(c.name.trim().toLocaleLowerCase());
    }
  }
  for (const d of value.designs) if (!record(d) || (d.categoryId !== undefined && typeof d.categoryId !== 'string') || (d.tags !== undefined && (!Array.isArray(d.tags) || d.tags.some(t => typeof t !== 'string' || !t.trim()) || new Set(d.tags).size !== d.tags.length))) return fail();
}
export const categoryOf = (design: GameplayDesign, categories: GameplayCategory[]) => categories.some(c => c.id === design.categoryId) ? design.categoryId! : '';
export const categoryName = (design: GameplayDesign, categories: GameplayCategory[]) => categories.find(c => c.id === design.categoryId)?.name || '未分类';
export function saveGameplayCategory(store: GameplayStore, input: Omit<GameplayCategory, 'id'>, id?: string): GameplayStore {
  const name = input.name.trim(), categories = store.categories || [];
  if (!name) throw new Error('请输入分类名称');
  if (name === '未分类') throw new Error('“未分类”用于存放尚未归类的文档，请使用其他名称');
  if (categories.some(c => c.id !== id && c.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('分类名称已存在');
  if (id && !categories.some(c => c.id === id)) throw new Error('分类已不存在');
  const category = { ...input, name, id: id || crypto.randomUUID() };
  const next = { ...store, categories: id ? categories.map(c => c.id === id ? category : c) : [...categories, category] };
  validateGameplayLibrary(next); return next;
}
export function moveGameplayDocuments(store: GameplayStore, ids: string[], targetId: string): GameplayStore {
  if (targetId && !store.categories?.some(c => c.id === targetId)) throw new Error('目标分类已不存在');
  return { ...store, designs: store.designs.map(d => ids.includes(d.id) ? { ...d, categoryId: targetId, updatedAt: new Date().toISOString() } : d) };
}
export function removeGameplayCategory(store: GameplayStore, id: string): GameplayStore {
  return { ...moveGameplayDocuments(store, store.designs.filter(d => d.categoryId === id).map(d => d.id), ''), categories: (store.categories || []).filter(c => c.id !== id) };
}
export function gameplayMatches(design: GameplayDesign, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  return !q || [design.title, design.summary, design.experience, design.rules, design.winCondition, design.loseCondition, design.deferred, ...(design.tags || []), ...design.loop.map(s => s.text), ...design.conditionRules.map(r => r.name), ...design.stateFlow.states.map(s => s.name), ...design.timeline.events.map(e => e.name)].join(' ').toLocaleLowerCase().includes(q);
}
