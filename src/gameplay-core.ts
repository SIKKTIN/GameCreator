export type CoreNodeKind = 'entry' | 'activity' | 'module' | 'decision' | 'exit';
export type CoreNode = { id: string; kind: CoreNodeKind; title: string; description: string; x: number; y: number; childGraphId: string; gameplayIds: string[] };
export type CoreEdge = { id: string; fromId: string; toId: string; label: string; condition: string };
export type CoreGraph = { id: string; title: string; summary: string; nodes: CoreNode[]; edges: CoreEdge[] };
export type GameplayCoreStore = { schema: 1; rootId: string; graphs: CoreGraph[] };
export type CoreDesignReference = { id: string; title: string; archived?: boolean; sourceOnly?: boolean };
export type CoreIssue = { graphId: string; nodeId?: string; message: string };

export const coreNodeKinds: CoreNodeKind[] = ['entry', 'activity', 'module', 'decision', 'exit'];
export const coreNodeLabels: Record<CoreNodeKind, string> = { entry: '入口', activity: '活动', module: '循环模块', decision: '分支判断', exit: '结束' };
export const emptyGameplayCore = (): GameplayCoreStore => ({ schema: 1, rootId: 'root', graphs: [{ id: 'root', title: '游戏入口', summary: '', nodes: [], edges: [] }] });

export function createCoreNode(kind: CoreNodeKind, title = coreNodeLabels[kind], x = 120, y = 120): CoreNode {
  if (!coreNodeKinds.includes(kind) || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error('玩法节点类型或位置无效');
  return { id: crypto.randomUUID(), kind, title: title.trim(), description: '', x, y, childGraphId: '', gameplayIds: [] };
}

export function createCoreEdge(fromId: string, toId: string): CoreEdge {
  if (!fromId.trim() || !toId.trim()) throw new Error('请选择流程连线的起点和终点');
  return { id: crypto.randomUUID(), fromId, toId, label: '', condition: '' };
}

// Graph nesting expresses ownership. Flow edges are deliberately allowed to cycle.
export function validateGameplayCore(value: unknown): GameplayCoreStore {
  const invalid = (): never => { throw new Error('玩法核心存档格式异常，已停止写入'); };
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const strings = (v: Record<string, unknown>, keys: string[]) => keys.every(k => typeof v[k] === 'string');
  const graphIds = new Set<string>(), nodeIds = new Set<string>(), edgeIds = new Set<string>();
  const uniqueId = (v: unknown, seen: Set<string>): v is string => {
    if (typeof v !== 'string' || !v.trim() || seen.has(v)) return false;
    seen.add(v); return true;
  };
  if (!record(value) || value.schema !== 1 || typeof value.rootId !== 'string' || !value.rootId.trim() || !Array.isArray(value.graphs) || !value.graphs.length) return invalid();
  for (const graph of value.graphs) {
    if (!record(graph) || !uniqueId(graph.id, graphIds) || !strings(graph, ['title', 'summary']) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return invalid();
    const localNodes = new Set<string>();
    for (const node of graph.nodes) {
      if (!record(node) || !uniqueId(node.id, nodeIds) || !strings(node, ['title', 'description', 'childGraphId']) || !coreNodeKinds.includes(node.kind as CoreNodeKind) ||
        typeof node.x !== 'number' || !Number.isFinite(node.x) || typeof node.y !== 'number' || !Number.isFinite(node.y) ||
        !Array.isArray(node.gameplayIds) || !node.gameplayIds.every(id => typeof id === 'string' && !!id.trim()) || new Set(node.gameplayIds).size !== node.gameplayIds.length ||
        (node.kind !== 'module' && node.childGraphId !== '')) return invalid();
      localNodes.add(node.id);
    }
    for (const edge of graph.edges) {
      if (!record(edge) || !uniqueId(edge.id, edgeIds) || !strings(edge, ['fromId', 'toId', 'label', 'condition']) ||
        !localNodes.has(edge.fromId as string) || !localNodes.has(edge.toId as string)) return invalid();
    }
  }
  const store = value as GameplayCoreStore;
  if (!graphIds.has(store.rootId)) return invalid();
  const ownerIds = new Set<string>();
  for (const graph of store.graphs) for (const node of graph.nodes) if (node.childGraphId) {
    if (!graphIds.has(node.childGraphId) || node.childGraphId === store.rootId || ownerIds.has(node.childGraphId)) return invalid();
    ownerIds.add(node.childGraphId);
  }
  const byId = new Map(store.graphs.map(graph => [graph.id, graph]));
  const seen = new Set<string>(), pending = [store.rootId];
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) return invalid();
    seen.add(id);
    for (const node of byId.get(id)!.nodes) if (node.childGraphId) pending.push(node.childGraphId);
  }
  if (seen.size !== store.graphs.length) return invalid();
  return store;
}

export function createCoreModule(store: GameplayCoreStore, graphId: string, nodeId: string): GameplayCoreStore {
  validateGameplayCore(store);
  const graph = store.graphs.find(g => g.id === graphId), node = graph?.nodes.find(n => n.id === nodeId);
  if (!node || node.kind !== 'module') throw new Error('请选择循环模块节点');
  if (node.childGraphId) return store;
  const childId = crypto.randomUUID();
  return { ...store, graphs: [...store.graphs.map(g => g.id !== graphId ? g : { ...g, nodes: g.nodes.map(n => n.id !== nodeId ? n : { ...n, childGraphId: childId }) }),
    { id: childId, title: node.title || '未命名循环', summary: '', nodes: [], edges: [] }] };
}

export function removeCoreNode(store: GameplayCoreStore, graphId: string, nodeId: string): GameplayCoreStore {
  validateGameplayCore(store);
  const graph = store.graphs.find(g => g.id === graphId), node = graph?.nodes.find(n => n.id === nodeId);
  if (!node) return store;
  const removedGraphs = new Set<string>(), pending = node.childGraphId ? [node.childGraphId] : [];
  const byId = new Map(store.graphs.map(g => [g.id, g]));
  while (pending.length) {
    const id = pending.pop()!; removedGraphs.add(id);
    for (const child of byId.get(id)!.nodes) if (child.childGraphId) pending.push(child.childGraphId);
  }
  return { ...store, graphs: store.graphs.filter(g => !removedGraphs.has(g.id)).map(g => g.id !== graphId ? g : {
    ...g, nodes: g.nodes.filter(n => n.id !== nodeId), edges: g.edges.filter(e => e.fromId !== nodeId && e.toId !== nodeId),
  }) };
}

export function readGameplayCore(storage: Pick<Storage, 'getItem'>, key: string): { raw: string | null; store: GameplayCoreStore } {
  const raw = storage.getItem(key);
  return { raw, store: raw === null ? emptyGameplayCore() : validateGameplayCore(JSON.parse(raw)) };
}

export function writeGameplayCore(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, expected: string | null, store: GameplayCoreStore): string {
  const current = storage.getItem(key);
  // A corrupt archive is never silently replaced by the controller's empty fallback.
  if (current !== null) validateGameplayCore(JSON.parse(current));
  if (current !== expected) throw new Error('其他窗口已更新玩法核心，当前草稿已保留，请先处理版本冲突');
  const raw = JSON.stringify(validateGameplayCore(store));
  storage.setItem(key, raw); return raw;
}

export function coreIssues(store: GameplayCoreStore, designs: CoreDesignReference[]): CoreIssue[] {
  const issues: CoreIssue[] = [], designsById = new Map(designs.map(d => [d.id, d]));
  for (const graph of store.graphs) {
    const add = (message: string, nodeId?: string) => issues.push({ graphId: graph.id, ...(nodeId ? { nodeId } : {}), message });
    if (!graph.title.trim()) add('循环图尚未命名');
    const entries = graph.nodes.filter(n => n.kind === 'entry');
    if (!entries.length) add('尚未放置入口节点');
    else if (entries.length > 1) add('存在多个入口，请明确此循环的主入口');
    const outgoing = new Map<string, string[]>();
    for (const edge of graph.edges) outgoing.set(edge.fromId, [...(outgoing.get(edge.fromId) || []), edge.toId]);
    const reached = new Set<string>(), pending = entries.map(n => n.id);
    while (pending.length) {
      const id = pending.pop()!; if (reached.has(id)) continue; reached.add(id);
      pending.push(...(outgoing.get(id) || []));
    }
    for (const node of graph.nodes) {
      const name = node.title.trim() || '未命名节点';
      if (!node.title.trim()) add('节点尚未命名', node.id);
      if (entries.length && !reached.has(node.id)) add('从入口无法到达：' + name, node.id);
      if (node.kind === 'module' && !node.childGraphId) add('循环模块尚未建立内部流程：' + name, node.id);
      for (const id of node.gameplayIds) {
        const design = designsById.get(id);
        if (!design) add('关联玩法已失效：' + id, node.id);
        else if (design.archived) add('关联玩法已归档：' + (design.title || id), node.id);
      }
    }
  }
  return issues;
}

export function gameplayCoreMarkdown(store: GameplayCoreStore, designs: CoreDesignReference[]): string {
  validateGameplayCore(store);
  const lines = ['## 玩法核心', '', '> 从游戏入口逐层展开玩法循环。流程允许回环与持续经营，不要求每个循环有结束节点。', ''];
  const byId = new Map(store.graphs.map(g => [g.id, g])), designsById = new Map(designs.map(d => [d.id, d]));
  const pending = [{ id: store.rootId, path: '' }];
  while (pending.length) {
    const { id, path } = pending.pop()!, graph = byId.get(id)!, title = graph.title.trim() || '未命名循环';
    const fullPath = path ? path + ' / ' + title : title;
    lines.push('### ' + fullPath, '', '- 循环图 ID：' + graph.id, '- 说明：' + (graph.summary.trim() || '待补充'), '', '节点：');
    if (!graph.nodes.length) lines.push('- 暂无节点。');
    const nodesById = new Map(graph.nodes.map(n => [n.id, n]));
    for (const node of graph.nodes) {
      lines.push('- ' + (node.title.trim() || '未命名节点') + ' [' + coreNodeLabels[node.kind] + '；节点 ID：' + node.id + ']');
      if (node.description.trim()) lines.push('  - 说明：' + node.description);
      if (node.kind === 'module') lines.push('  - 内部循环：' + (node.childGraphId ? (byId.get(node.childGraphId)?.title || '未命名循环') + ' [图 ID：' + node.childGraphId + ']' : '尚未建立'));
      for (const designId of node.gameplayIds) {
        const design = designsById.get(designId);
        lines.push('  - 关联玩法：' + (design ? (design.title || '未命名玩法') + (design.archived ? '（已归档）' : '') : '已失效') + ' [玩法 ID：' + designId + ']');
      }
    }
    lines.push('', '流程连线：');
    if (!graph.edges.length) lines.push('- 暂无连线。');
    for (const edge of graph.edges) lines.push('- ' + (nodesById.get(edge.fromId)?.title || '未命名节点') + ' → ' + (nodesById.get(edge.toId)?.title || '未命名节点') +
      (edge.label ? '；操作：' + edge.label : '') + (edge.condition ? '；条件：' + edge.condition : '') + ' [连线 ID：' + edge.id + ']');
    lines.push('');
    for (const node of [...graph.nodes].reverse()) if (node.childGraphId) pending.push({ id: node.childGraphId, path: fullPath });
  }
  const issues = coreIssues(store, designs);
  if (issues.length) {
    lines.push('### 待完善内容', '');
    for (const issue of issues) lines.push('- ' + (byId.get(issue.graphId)?.title || '未命名循环') + '：' + issue.message);
    lines.push('');
  }
  return lines.join('\n');
}
