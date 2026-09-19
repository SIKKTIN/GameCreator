import { emptyGameplayCore, validateGameplayCore, type CoreGraph, type GameplayCoreStore, type CoreDesignReference } from './gameplay-core.ts';

export type CorePublication = { store: GameplayCoreStore; references: CoreDesignReference[] };
export type CoreSnapshot = CorePublication & { initialized: boolean; versions: Record<string, number>; stamps: Record<string, { updatedAt: string; updatedBy: string }> };
export type CoreChange = { id: string; revision: number; graph: CoreGraph | null };
export type CoreDraft = { base: CoreSnapshot; store: GameplayCoreStore };
export type CoreLayout = Record<string, { x: number; y: number }>;
export const emptyCoreSnapshot = (): CoreSnapshot => ({ store: emptyGameplayCore(), references: [], initialized: false, versions: {}, stamps: {} });
// Node order and coordinates describe presentation, not gameplay content.
export function graphContent(graph?: CoreGraph | null) {
  if (!graph) return null;
  return { id: graph.id, title: graph.title, summary: graph.summary,
    nodes: graph.nodes.map(n => ({ id: n.id, kind: n.kind, title: n.title, description: n.description, childGraphId: n.childGraphId, gameplayIds: [...n.gameplayIds].sort() })).sort((a,b) => a.id.localeCompare(b.id)),
    edges: graph.edges.map(e => ({ id: e.id, fromId: e.fromId, toId: e.toId, label: e.label, condition: e.condition })).sort((a,b) => a.id.localeCompare(b.id)) };
}
export const sameGraph = (a?: CoreGraph | null, b?: CoreGraph | null) => JSON.stringify(graphContent(a)) === JSON.stringify(graphContent(b));
export function coreChanges(base: CoreSnapshot, store: GameplayCoreStore): CoreChange[] {
  const previous = new Map(base.store.graphs.map(g => [g.id,g])), next = new Map(store.graphs.map(g => [g.id,g]));
  return [...new Set([...previous.keys(),...next.keys()])].filter(id => !sameGraph(previous.get(id),next.get(id)))
    .map(id => ({ id, revision: base.versions[id] ?? 0, graph: next.get(id) ?? null }));
}
export function applyCoreChanges(store: GameplayCoreStore, changes: CoreChange[]): GameplayCoreStore {
  const graphs = new Map(store.graphs.map(g => [g.id,g]));
  changes.forEach(change => { if (change.graph) graphs.set(change.id,change.graph); else graphs.delete(change.id); });
  return validateGameplayCore({ ...store, graphs: [...graphs.values()] });
}
export function reconcileCore(draft: CoreDraft, remote: CoreSnapshot): { draft: CoreDraft; conflicts: string[] } {
  const changes = coreChanges(draft.base,draft.store);
  const conflicts = changes.filter(c => c.revision !== (remote.versions[c.id] ?? 0) && !sameGraph(c.graph,remote.store.graphs.find(g => g.id === c.id))).map(c => c.id);
  // A changed subtree may invalidate a locally deleted parent, even if its own version did not change.
  try {
    const store = applyCoreChanges(remote.store,changes);
    if (conflicts.length) return { draft, conflicts };
    return { draft: { base: remote, store }, conflicts: [] };
  } catch { return { draft, conflicts: [...new Set([...conflicts,...changes.map(c => c.id)])] }; }
}
export function withCoreLayout(store: GameplayCoreStore, layout: CoreLayout): GameplayCoreStore {
  return { ...store, graphs: store.graphs.map(g => ({ ...g, nodes: g.nodes.map(n => ({ ...n, ...(layout[n.id] ?? {}) })) })) };
}
export function validateCoreLayout(value: unknown): CoreLayout {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('个人布局存档异常');
  return value as CoreLayout;
}
export function validateCoreDraft(value: unknown): CoreDraft {
  const draft = value as CoreDraft;
  validateGameplayCore(draft?.store); normalizeCorePublication(draft?.base);
  if (!draft.base.versions || Array.isArray(draft.base.versions) || Object.values(draft.base.versions).some(v => !Number.isSafeInteger(v) || v < 0) ||
    !draft.base.stamps || Array.isArray(draft.base.stamps) || Object.values(draft.base.stamps).some(v => !v || typeof v.updatedAt !== 'string' || typeof v.updatedBy !== 'string') ||
    typeof draft.base.initialized !== 'boolean') throw new Error('玩法核心草稿版本无效');
  return draft;
}
export function normalizeCorePublication(value: unknown): CorePublication {
  const publication = value as CorePublication;
  const store = validateGameplayCore(publication?.store);
  if (store.graphs.length > 500 || store.graphs.reduce((n,g) => n + g.nodes.length + g.edges.length,0) > 10000) throw new Error('玩法核心最多 500 个流程、10000 个节点和连线');
  const limited = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
  for (const g of store.graphs) {
    if (!limited(g.id,200) || !limited(g.title,200) || !limited(g.summary,10000)) throw new Error('流程名称或说明过长');
    for (const n of g.nodes) if (!limited(n.id,200) || !limited(n.title,200) || !limited(n.description,10000) || n.gameplayIds.length > 200 || n.gameplayIds.some(id => !limited(id,200))) throw new Error('节点字段过长');
    for (const e of g.edges) if (!limited(e.id,200) || !limited(e.label,2000) || !limited(e.condition,10000)) throw new Error('连线字段过长');
  }
  if (!Array.isArray(publication.references) || publication.references.length > 10000 || publication.references.some(r => !r || !limited(r.id,200) || !r.id.trim() || !limited(r.title,200))) throw new Error('来源玩法引用无效');
  const refs = new Map(publication.references.map(r => [r.id,{ id: r.id, title: r.title }]));
  const used = new Set(store.graphs.flatMap(g => g.nodes.flatMap(n => n.gameplayIds)));
  return { store: structuredClone(store), references: [...used].map(id => refs.get(id) ?? { id, title: '来源玩法 ' + id }) };
}
export function coreDiff(before: CoreGraph | undefined, after: CoreGraph | undefined): string[] {
  if (!after) return ['删除流程及其内容'];
  const result: string[] = [];
  if (!before) { result.push('新增流程'); before = { id: after.id, title: '', summary: '', nodes: [], edges: [] }; }
  if (before.title !== after.title) result.push(`流程名称：${before.title} → ${after.title}`);
  if (before.summary !== after.summary) result.push(`流程说明：${after.summary || '（空）'}`);
  for (const [label, left, right] of [['节点',before.nodes,after.nodes],['连线',before.edges,after.edges]] as const) {
    for (const item of left) if (!right.some(r => r.id === item.id)) result.push(`删除${label}：${'title' in item ? item.title : item.label || item.id}`);
    for (const item of right) {
      const previous = left.find(r => r.id === item.id);
      const content = (v: typeof item) => 'x' in v ? { ...v, x: 0, y: 0 } : v;
      if (!previous || JSON.stringify(content(previous)) !== JSON.stringify(content(item))) result.push(`${previous ? '修改' : '新增'}${label}：${'title' in item ? item.title + ' · ' + item.description + ' · 类型：' + item.kind + (item.childGraphId ? ' · 内部流程：' + item.childGraphId : '') + (item.gameplayIds.length ? ' · 来源玩法：' + item.gameplayIds.join('、') : '') : item.fromId + ' → ' + item.toId + ' · ' + item.label + ' · ' + item.condition}`);
    }
  }
  return result;
}
