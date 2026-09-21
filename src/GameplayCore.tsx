import {useSearchRequest} from './GlobalSearch';
import { CORE_NODE_WIDTH as NODE_WIDTH, CORE_NODE_HEIGHT as NODE_HEIGHT, selectionRectangle, nodesInRectangle, moveCoreGroup, type CorePosition, type CanvasPoint, type SelectionRectangle } from './core-selection';
import { useCallback, useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ArrowDownRight, ArrowLeft, ArrowRight, ChevronRight, Circle, CircleStop, CornerDownRight, GitBranch, Layers, Link2, Maximize2, Minus, MousePointer2, Play, Plus, RotateCcw, Trash2, Unlink, X } from 'lucide-react';
import { createCoreEdge, createCoreModule, createCoreNode, coreIssues, removeCoreNode, type CoreEdge, type CoreGraph, type CoreNode, type CoreNodeKind, type GameplayCoreStore, type CoreDesignReference } from './gameplay-core';
import type { GameplayCoreController } from './useGameplayCore';
import './gameplay-core.css';
import { useCoreCanvasViewport } from './useCoreCanvasViewport';

type Selection = { kind: 'node' | 'edge'; id: string; ids?: string[] } | null;
type GestureBase = { graphId: string; pointerId: number; element: HTMLElement; clientX: number; clientY: number; moved: boolean };
type Drag = GestureBase & ({ kind: 'nodes'; nodes: CorePosition[]; zoom: number } | { kind: 'marquee'; start: CanvasPoint; previous: Selection; additive: boolean });
const kindNames: Record<CoreNodeKind, string> = { entry: '入口', activity: '活动', module: '循环模块', decision: '条件分支', exit: '结束' };
const kindIcons = { entry: Play, activity: Circle, module: Layers, decision: GitBranch, exit: CircleStop };
const short = (text: string, length = 17) => text.length > length ? text.slice(0, length - 1) + '…' : text;
const graphName = (graph: CoreGraph) => graph.title.trim() || '未命名流程';
const nodeName = (node: CoreNode) => node.title.trim() || '未命名节点';

function graphPath(store: GameplayCoreStore, graphId: string): CoreGraph[] {
  const path: CoreGraph[] = [], seen = new Set<string>();
  let current = store.graphs.find(g => g.id === graphId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id); path.unshift(current);
    const id = current.id;
    current = store.graphs.find(g => g.nodes.some(n => n.childGraphId === id));
  }
  return path;
}

type Route = { path: string; x: number; y: number; right: number; bottom: number; outside?: boolean };
type Point = [number, number];
function cubicRoute(start: Point, first: Point, second: Point, end: Point): Pick<Route, 'path' | 'x' | 'y'> {
  // Derive the label from the same curve as the line (Bezier t = 0.5).
  // Independent offsets made labels jump away when nodes became nearly aligned.
  return {
    path: `M ${start[0]} ${start[1]} C ${first[0]} ${first[1]}, ${second[0]} ${second[1]}, ${end[0]} ${end[1]}`,
    x: (start[0] + 3 * first[0] + 3 * second[0] + end[0]) / 8,
    y: (start[1] + 3 * first[1] + 3 * second[1] + end[1]) / 8,
  };
}
function corridorRoute(start: Point, first: Point, second: Point, end: Point, a: CoreNode, b: CoreNode, labelWidth: number, lane: number, below = false) {
  let route = cubicRoute(start, first, second, end);
  const overlapsNode = [a, b].some(n => route.x + labelWidth / 2 > n.x && route.x - labelWidth / 2 < n.x + NODE_WIDTH && route.y + 22.5 > n.y && route.y - 22.5 < n.y + NODE_HEIGHT);
  if (overlapsNode) {
    // Compact prototype columns leave less room than the label width. Bend the
    // line itself into free space, keeping its label on the curve and clickable.
    const above = Math.min(a.y, b.y) - 35 - lane;
    const y = !below && above >= 24 ? above : Math.max(a.y, b.y) + NODE_HEIGHT + 35 + lane;
    const controlY = (8 * y - start[1] - end[1]) / 6;
    first = [first[0], controlY]; second = [second[0], controlY];
    route = cubicRoute(start, first, second, end);
  }
  return { ...route, bottom: Math.max(start[1], first[1], second[1], end[1], route.y + 22.5) + 35 };
}
const edgeCaptionWidth = (caption: string, condition: string) => Math.max(54, Math.min(184, Math.max(caption.length, condition.length) * 11 + 20));
function edgeRoute(edge: CoreEdge, nodes: CoreNode[], index: number, outsideIndex: number, parallelIndex: number): Route | null {
  const a = nodes.find(n => n.id === edge.fromId), b = nodes.find(n => n.id === edge.toId);
  if (!a || !b) return null;
  const lane = parallelIndex * 18;
  // Reserve expanded condition space too so selecting a line never reroutes it.
  const labelWidth = edgeCaptionWidth(short(edge.label || '继续', 12) + (edge.condition ? ' ◇' : ''), short(edge.condition));
  const ax = a.x + NODE_WIDTH, ay = a.y + NODE_HEIGHT / 2, bx = b.x, by = b.y + NODE_HEIGHT / 2;
  if (a.id === b.id) {
    const right = Math.max(ax + 104 + lane, (8 * (ax + labelWidth / 2 + 12) - ax - (a.x + NODE_WIDTH / 2)) / 6);
    return { ...cubicRoute([ax, ay], [right, ay], [right, a.y - 52 - lane], [a.x + NODE_WIDTH / 2, a.y - 2]), right: right + 65, bottom: a.y + NODE_HEIGHT };
  }
  // Even a narrow gap is a forward transition; templates deliberately use compact columns.
  if (bx > ax) {
    const bend = Math.max(16, Math.min(90, (bx - ax) / 2));
    const sy = ay - 10 - lane, ty = by - 10 - lane;
    return { ...corridorRoute([ax, sy], [ax + bend, sy], [bx - bend, ty], [bx - 3, ty], a, b, labelWidth, lane), right: Math.max(ax, bx) };
  }
  const returnGap = a.x - (b.x + NODE_WIDTH);
  // A return to the neighboring column can stay in the same corridor, on a separate port.
  if (returnGap > 0 && returnGap < 160) {
    const left = a.x, right = b.x + NODE_WIDTH, bend = Math.max(16, returnGap / 2);
    const sy = ay + 13 + lane, ty = by + 13 + lane;
    return { ...corridorRoute([left, sy], [left - bend, sy], [right + bend, ty], [right + 3, ty], a, b, labelWidth, lane, true), right: left + 95 };
  }
  if (Math.abs(a.x - b.x) < NODE_WIDTH * .6) {
    const right = Math.max(Math.max(ax, b.x + NODE_WIDTH) + 84 + (index % 5) * 16 + lane, (8 * (Math.max(ax, b.x + NODE_WIDTH) + labelWidth / 2 + 12) - ax - (b.x + NODE_WIDTH + 3)) / 6);
    return { ...cubicRoute([ax, ay], [right, ay], [right, by], [b.x + NODE_WIDTH + 3, by]), right: right + 95, bottom: Math.max(ay, by) + 35 };
  }
  const bottom = Math.max(...nodes.map(n => n.y + NODE_HEIGHT));
  const rail = bottom + 50 + outsideIndex * 36 + lane;
  const right = ax + 34 + outsideIndex * 9, target = b.x + NODE_WIDTH / 2;
  return { path: `M ${ax} ${ay} H ${right - 12} Q ${right} ${ay} ${right} ${ay + 12} V ${rail - 12} Q ${right} ${rail} ${right - 12} ${rail} H ${target + 12} Q ${target} ${rail} ${target} ${rail - 12} V ${b.y + NODE_HEIGHT + 3}`, x: (right + target) / 2, y: rail, right: right + 95, bottom: rail + 25, outside: true };
}

export function GameplayCore({ controller, designs, onOpenGameplay, team = false, teamDesignsReady = false, onMoveNodes, onGraphChange, statusLabel }: { controller: GameplayCoreController; designs: CoreDesignReference[]; onOpenGameplay: (id: string) => void;
  team?: boolean; teamDesignsReady?: boolean; onMoveNodes?: (positions: CorePosition[]) => void; onGraphChange?: (id: string) => void; statusLabel?: string }) {
  const { store, update, blocked } = controller;
  const searchRequest=useSearchRequest('玩法核心',t=>{const g=store.graphs.find(g=>g.id===(t.parent||t.id));return !!g&&(t.kind==='node'?g.nodes.some(n=>n.id===t.id):t.kind==='edge'?g.edges.some(e=>e.id===t.id):true);});
  useEffect(()=>{if(!searchRequest)return;setGraphId(searchRequest.parent||searchRequest.id);setSelected(searchRequest.kind==='node'||searchRequest.kind==='edge'?{kind:searchRequest.kind,id:searchRequest.id}:null);setLinking(false);setLinkFromId(null);},[searchRequest]);
  const [graphId, setGraphId] = useState(store.rootId), [selected, setSelected] = useState<Selection>(null);
  const [linking, setLinking] = useState(false), [linkFromId, setLinkFromId] = useState<string | null>(null);
  const [dragPositions, setDragPositions] = useState<CorePosition[] | null>(null), [marquee, setMarquee] = useState<SelectionRectangle | null>(null);
  const [deleteId, setDeleteId] = useState('');
  const scroll = useRef<HTMLDivElement>(null), drag = useRef<Drag | null>(null), suppressClick = useRef(false), dialog = useRef<HTMLDialogElement>(null);
  const viewport = useCoreCanvasViewport(scroll, drag);
  const { zoom, setZoom, resetView } = viewport;
  const suppressModuleDoubleClick = useRef(false), fittedGraphIds = useRef(new Set<string>());
  const markerId = 'gc-arrow-' + useId().replace(/:/g, '');
  const graph = store.graphs.find(g => g.id === graphId) ?? store.graphs.find(g => g.id === store.rootId);
  useEffect(() => { if (graph) onGraphChange?.(graph.id); }, [graph?.id,onGraphChange]);
  useEffect(()=>{
    if(!searchRequest||graph?.id!==(searchRequest.parent||searchRequest.id))return;
    const target=graph?.nodes.find(n=>n.id===searchRequest.id) || (searchRequest.kind==='edge'?graph?.nodes.find(n=>n.id===graph.edges.find(e=>e.id===searchRequest.id)?.fromId):undefined);
    if(!target)return;
    const frame=requestAnimationFrame(()=>viewport.focusPoint(target.x+NODE_WIDTH/2,target.y+NODE_HEIGHT/2));
    return()=>cancelAnimationFrame(frame);
  },[searchRequest,graph?.id,viewport.focusPoint]);
  const selectedIds = selected?.kind === 'node' ? selected.ids ?? [selected.id] : [];
  const selectedNodes = graph?.nodes.filter(n => selectedIds.includes(n.id)) ?? [];
  const node = selectedNodes.length === 1 ? selectedNodes[0] : undefined;
  const edge = selected?.kind === 'edge' ? graph?.edges.find(e => e.id === selected.id) : undefined;
  const path = graph ? graphPath(store, graph.id) : [];
  const linkSource = graph?.nodes.find(n => n.id === linkFromId);
  const issues = coreIssues(store, designs);
  const previewPositions = new Map(dragPositions?.map(p => [p.id, p]));
  const paintedNodes = (graph?.nodes ?? []).map(n => ({ ...n, ...previewPositions.get(n.id) }));
  let outsideIndex = 0;
  const parallelCounts = new Map<string, number>();
  const routedEdges = (graph?.edges ?? []).map((item, index) => {
    const key = item.fromId + '/' + item.toId, parallel = parallelCounts.get(key) ?? 0;
    parallelCounts.set(key, parallel + 1);
    const route = edgeRoute(item, paintedNodes, index, outsideIndex, parallel);
    if (route?.outside) outsideIndex++;
    return { item, route };
  });
  const width = Math.max(950, ...paintedNodes.map(n => n.x + NODE_WIDTH + 110), ...routedEdges.map(e => (e.route?.right ?? 0) + 35));
  const height = Math.max(570, ...paintedNodes.map(n => n.y + NODE_HEIGHT + 90), ...routedEdges.map(e => (e.route?.bottom ?? 0) + 35));

  useEffect(() => {
    if (!store.graphs.some(g => g.id === graphId)) {
      setGraphId(store.rootId); setSelected(null); setLinking(false); setLinkFromId(null);
      drag.current = null; setDragPositions(null); setMarquee(null); fittedGraphIds.current.delete(store.rootId); resetView(1);
    }
  }, [store.rootId, store.graphs, graphId, resetView]);

  useEffect(() => {
    if (linkFromId && !graph?.nodes.some(n => n.id === linkFromId)) { setLinkFromId(null); setLinking(false); }
    if (selected?.kind === 'node') {
      const ids = (selected.ids ?? [selected.id]).filter(id => graph?.nodes.some(n => n.id === id));
      if (ids.length !== (selected.ids ?? [selected.id]).length) setSelected(ids.length ? { kind: 'node', id: ids[0], ids } : null);
    } else if (selected && !graph?.edges.some(item => item.id === selected.id)) setSelected(null);
    if (deleteId && !graph?.nodes.some(n => n.id === deleteId)) { setDeleteId(''); dialog.current?.close(); }
  }, [graph, linkFromId, selected, deleteId]);

  useEffect(() => {
    const container = scroll.current;
    if (!container || !graph) return;
    const tryFit = () => {
      if (!container.clientWidth || fittedGraphIds.current.has(graph.id)) return;
      fittedGraphIds.current.add(graph.id);
      if (graph.nodes.length) {
        resetView(Math.max(.35, Math.min(1, (container.clientWidth - 24) / width, (container.clientHeight - 24) / height)));
        container.scrollLeft = 0; container.scrollTop = 0;
      }
    };
    const observer = new ResizeObserver(tryFit); observer.observe(container); tryFit();
    return () => observer.disconnect();
  }, [graph?.id, graph?.nodes.length, width, height, resetView]);

  const exportDraft = () => {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'gameplay-core-draft-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    anchor.style.display = 'none'; document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  };
  const reload = () => {
    if (controller.pending && !window.confirm('重新读取会用磁盘上的存档替换当前未保存的修改。建议先导出当前草稿。确定重新读取吗？')) return;
    controller.reload();
  };

  const navigate = (id: string) => {
    cancelGesture();
    setGraphId(id); setSelected(null); setLinking(false); setLinkFromId(null); setDragPositions(null); setMarquee(null); drag.current = null; resetView(zoom);
    if (scroll.current) { scroll.current.scrollLeft = 0; scroll.current.scrollTop = 0; }
  };
  const editGraph = (transform: (current: CoreGraph) => CoreGraph) => {
    if (!graph || blocked) return false;
    return update(current => ({ ...current, graphs: current.graphs.map(g => g.id === graph.id ? transform(g) : g) }));
  };
  const patchNode = (id: string, patch: Partial<CoreNode>) => {
    if (!graph || blocked) return;
    update(current => {
      const target = current.graphs.find(g => g.id === graph.id)?.nodes.find(n => n.id === id);
      return { ...current, graphs: current.graphs.map(g => {
        if (g.id === graph.id) return { ...g, nodes: g.nodes.map(n => n.id === id ? { ...n, ...patch } : n) };
        if (patch.title !== undefined && g.id === target?.childGraphId) return { ...g, title: patch.title };
        return g;
      }) };
    });
  };
  const patchEdge = (patch: Partial<CoreEdge>) => { if (edge) editGraph(g => ({ ...g, edges: g.edges.map(e => e.id === edge.id ? { ...e, ...patch } : e) })); };
  const renameGraph = (title: string) => {
    if (!graph) return;
    update(current => ({ ...current, graphs: current.graphs.map(g => ({ ...g, ...(g.id === graph.id ? { title } : {}), nodes: g.nodes.map(n => n.childGraphId === graph.id ? { ...n, title } : n) })) }));
  };
  const addNode = (kind: CoreNodeKind) => {
    if (!graph || blocked) return;
    const count = graph.nodes.length, x = 68 + count % 3 * 300, y = 86 + Math.floor(count / 3) * 220;
    const next = createCoreNode(kind, kind === 'entry' ? '开始' : kind === 'exit' ? '结束' : '新' + kindNames[kind], x, y);
    update(current => {
      let result = { ...current, graphs: current.graphs.map(g => g.id === graph.id ? { ...g, nodes: [...g.nodes, next] } : g) };
      if (kind === 'module') result = createCoreModule(result, graph.id, next.id);
      return result;
    });
    setSelected({ kind: 'node', id: next.id }); setLinking(false); setLinkFromId(null);
  };
  const addEdge = (fromId: string, toId: string) => {
    const next = createCoreEdge(fromId, toId);
    if (!graph || blocked) return;
    editGraph(g => ({ ...g, edges: [...g.edges, next] }));
    suppressModuleDoubleClick.current = true; setSelected({ kind: 'edge', id: next.id }); setLinking(false); setLinkFromId(null);
  };
  const chooseNode = (id: string, additive = false) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (linking && !blocked) { if (linkFromId) addEdge(linkFromId, id); else { setLinkFromId(id); setSelected({ kind: 'node', id }); } }
    else if (additive) { const ids = selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]; setSelected(ids.length ? { kind: 'node', id: ids[0], ids } : null); }
    else if (!selectedIds.includes(id)) setSelected({ kind: 'node', id });
  };
  const enterModule = (target: CoreNode, allowCreate = false) => {
    if (target.kind !== 'module' || linking) return;
    if (target.childGraphId && store.graphs.some(g => g.id === target.childGraphId)) { navigate(target.childGraphId); return; }
    if (blocked || !graph || (team && !allowCreate)) return;
    const result = createCoreModule(store, graph.id, target.id);
    const childId = result.graphs.find(g => g.id === graph.id)?.nodes.find(n => n.id === target.id)?.childGraphId;
    if (update(() => result) && childId) navigate(childId);
  };
  const cancelGesture = useCallback(() => {
    const current = drag.current; drag.current = null;
    if (current?.kind === 'marquee') setSelected(current.previous);
    if (current) { suppressClick.current = true; if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId); }
    setDragPositions(null); setMarquee(null);
  }, []);
  useEffect(() => {
    const hidden = () => { if (document.hidden) cancelGesture(); };
    window.addEventListener('blur', cancelGesture); document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('blur', cancelGesture); document.removeEventListener('visibilitychange', hidden); const current = drag.current; drag.current = null; if (current?.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId); };
  }, [cancelGesture]);
  useEffect(() => {
    const current = drag.current;
    if (current && (current.graphId !== graph?.id || current.kind === 'nodes' && current.nodes.some(n => !graph.nodes.some(item => item.id === n.id)))) cancelGesture();
  }, [graph, cancelGesture]);
  const canvasPoint = (clientX: number, clientY: number): CanvasPoint => {
    const bounds = scroll.current!.querySelector('.gc-canvas-surface')!.getBoundingClientRect();
    return { x: (clientX - bounds.left) / zoom, y: (clientY - bounds.top) / zoom };
  };
  const background = (target: EventTarget) => target instanceof Element && target.matches('.gc-canvas-scroll, .gc-canvas-sizer, .gc-canvas-surface, .gc-connections');
  const startMarquee = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!graph || linking || event.button !== 0 || event.buttons & 2 || drag.current || !background(event.target)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX >= bounds.left + event.currentTarget.clientWidth || event.clientY >= bounds.top + event.currentTarget.clientHeight) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true });
    suppressClick.current = false;
    drag.current = { kind: 'marquee', graphId: graph.id, pointerId: event.pointerId, element: event.currentTarget, clientX: event.clientX, clientY: event.clientY, moved: false, start: canvasPoint(event.clientX, event.clientY), previous: selected, additive: event.shiftKey || event.ctrlKey || event.metaKey };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveMarquee = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!graph || current?.kind !== 'marquee' || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (event.type === 'pointermove' && !(event.buttons & 1)) { cancelGesture(); return; }
    if (!current.moved && Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY) < 4) return;
    current.moved = true;
    const area = selectionRectangle(current.start, canvasPoint(event.clientX, event.clientY)); setMarquee(area);
    const previous = current.additive && current.previous?.kind === 'node' ? current.previous.ids ?? [current.previous.id] : [];
    const ids = [...new Set([...previous, ...nodesInRectangle(graph.nodes, area)])];
    setSelected(ids.length ? { kind: 'node', id: ids[0], ids } : null);
  };
  const finishMarquee = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const current = drag.current;
    if (current?.kind !== 'marquee' || current.pointerId !== event.pointerId) return;
    if (cancelled) { cancelGesture(); return; }
    if (current.moved) moveMarquee(event);
    else if (!current.additive) setSelected(null);
    drag.current = null; setMarquee(null); suppressClick.current = true;
    if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
  };
  const canvasClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!background(event.target)) return;
    event.stopPropagation();
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey) setSelected(null);
  };
  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, target: CoreNode) => {
    if (!linking) suppressModuleDoubleClick.current = false;
    if (drag.current || !graph || (team ? !onMoveNodes : blocked) || linking || event.button !== 0 || event.buttons & 2 || event.shiftKey || event.ctrlKey || event.metaKey) return;
    suppressClick.current = false;
    const nodes = (selectedIds.includes(target.id) ? selectedNodes : [target]).map(({ id, x, y }) => ({ id, x, y }));
    setSelected({ kind: 'node', id: target.id, ids: nodes.map(n => n.id) });
    drag.current = { kind: 'nodes', graphId: graph.id, pointerId: event.pointerId, element: event.currentTarget, nodes, zoom, clientX: event.clientX, clientY: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (current?.kind !== 'nodes' || current.pointerId !== event.pointerId) return;
    if (event.type === 'pointermove' && !(event.buttons & 1)) { cancelGesture(); return; }
    const dx = (event.clientX - current.clientX) / current.zoom, dy = (event.clientY - current.clientY) / current.zoom;
    if (!current.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    current.moved = true;
    setDragPositions(moveCoreGroup(current.nodes, dx, dy));
  };
  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) => {
    const current = drag.current;
    if (current?.kind !== 'nodes' || current.pointerId !== event.pointerId) return;
    if (cancelled) { cancelGesture(); return; }
    drag.current = null; setDragPositions(null);
    if (current.moved) {
      suppressClick.current = true; suppressModuleDoubleClick.current = true;
      const positions = moveCoreGroup(current.nodes, (event.clientX - current.clientX) / current.zoom, (event.clientY - current.clientY) / current.zoom);
      if (positions.some((p, i) => p.x !== current.nodes[i].x || p.y !== current.nodes[i].y)) {
        if (onMoveNodes) onMoveNodes(positions);
        else if (!team) { const changes = new Map(positions.map(p => [p.id, p])); editGraph(g => ({ ...g, nodes: g.nodes.map(n => ({ ...n, ...changes.get(n.id) })) })); }
      }
    }
    if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId);
  };
  const selectAll = () => { if (graph && !linking) { const ids = graph.nodes.map(n => n.id); setSelected(ids.length ? { kind: 'node', id: ids[0], ids } : null); } };
  const deleteNode = (id: string) => {
    if (!graph || blocked) return;
    update(current => removeCoreNode(current, graph.id, id));
    setSelected(null); setDeleteId(''); setLinking(false); setLinkFromId(null); dialog.current?.close();
  };
  const requestDelete = () => {
    if (!node) return;
    if (node.kind === 'module' && node.childGraphId) { setDeleteId(node.id); dialog.current?.showModal(); }
    else deleteNode(node.id);
  };
  const fit = () => {
    const container = scroll.current;
    if (!container || !container.clientWidth) return;
    resetView(Math.max(.35, Math.min(1.25, (container.clientWidth - 24) / width, (container.clientHeight - 24) / height)));
    container.scrollLeft = 0; container.scrollTop = 0;
  };
  const tree = (id: string, depth = 0, seen = new Set<string>()): ReactNode => {
    const item = store.graphs.find(g => g.id === id);
    if (!item || seen.has(id)) return null;
    const nextSeen = new Set(seen); nextSeen.add(id);
    return <div className="gc-tree-branch" key={id}>
      <button type="button" className={'gc-tree-item' + (graph?.id === id ? ' is-active' : '')} style={{ paddingLeft: 12 + Math.min(depth, 5) * 13 }} aria-label={'打开流程：' + graphName(item)} aria-current={graph?.id === id ? 'page' : undefined} title={graphName(item)} onClick={() => navigate(id)}>
        {depth ? <CornerDownRight size={15} /> : <Layers size={16} />}<span>{graphName(item)}</span><small>{item.nodes.length}</small>
      </button>
      {item.nodes.filter(n => n.kind === 'module' && n.childGraphId).map(n => tree(n.childGraphId, depth + 1, nextSeen))}
    </div>;
  };

  if (!graph) return <div className="gc-workspace"><p role="alert">玩法核心流程暂不可用。{controller.error}</p><button type="button" onClick={reload}>重新读取玩法核心</button></div>;

  return <section className="gc-workspace" aria-label="玩法核心编辑器" onKeyDown={event => {
    if (event.key === ' ') event.stopPropagation();
    if ((event.target as Element).closest('input, textarea, select, [contenteditable=true]')) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (drag.current) cancelGesture(); else if (linking) { setLinking(false); setLinkFromId(null); } else setSelected(null); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && (event.target as Element).closest('.gc-canvas-scroll')) { event.preventDefault(); selectAll(); }
  }}>
    <div className="gc-heading"><div><span className="gc-eyebrow">CORE GAMEPLAY</span><h2>从入口到循环，画出游戏的骨架。</h2><p>{team ? '内容保存到团队；拖动、缩放和浏览各自独立。' : '用模块组织玩法，双击进入内部循环，再关联具体的玩法设计。'}</p></div><span className={'gc-save-state' + (controller.pending || blocked ? ' is-warning' : '')}>{statusLabel ?? (controller.pending ? '有未保存修改' : blocked ? '写入已暂停' : '随编辑保存')}</span></div>
    {controller.error && <div className="gc-alert" role="alert"><span>{controller.error}</span><div className="gc-recovery-actions">{controller.pending && <button type="button" onClick={exportDraft}>导出当前草稿</button>}{!blocked && <button type="button" onClick={controller.retry}>重试保存</button>}<button type="button" onClick={reload}>重新读取存档</button></div></div>}
    <div className="gc-layout">
      <aside className="gc-directory" aria-label="玩法核心模块目录"><div className="gc-directory-title"><Layers size={17} /><strong>玩法模块</strong><small>{store.graphs.length}</small></div><div className="gc-tree">{tree(store.rootId)}</div><p className="gc-directory-help">每个循环模块都有自己的流程图。<br />从总览逐层进入，保持每层精简。</p>
        <details className="gc-checks"><summary>{issues.length ? `${issues.length} 项设计提示` : '流程与引用检查通过'}</summary>{issues.length ? <ul>{issues.map((issue, i) => <li key={i}><button type="button" onClick={() => { navigate(issue.graphId); if (issue.nodeId) setSelected({ kind: 'node', id: issue.nodeId }); }}>{issue.message}</button></li>)}</ul> : <p>循环可以持续运行，不必设置结束节点。</p>}</details>
      </aside>
      <div className="gc-main">
        <div className="gc-canvas-header"><nav className="gc-breadcrumbs" aria-label="玩法核心层级">{path.map((item, i) => <span key={item.id}>{i > 0 && <ChevronRight size={14} />}<button type="button" aria-label={'返回流程：' + graphName(item)} aria-current={item.id === graph.id ? 'page' : undefined} onClick={() => navigate(item.id)}>{graphName(item)}</button></span>)}</nav><button className="gc-button gc-small" type="button" onClick={() => setSelected(null)}>流程属性</button></div>
        <div className="gc-node-tools" aria-label="添加流程节点">{(Object.keys(kindNames) as CoreNodeKind[]).map(kind => { const Icon = kindIcons[kind]; return <button type="button" key={kind} className={'gc-button gc-add-' + kind} aria-label={'添加' + kindNames[kind]} disabled={blocked} onClick={() => addNode(kind)}><Icon size={15} /><span>{kindNames[kind]}</span><Plus size={12} /></button>; })}<span className="gc-tools-divider" /><button type="button" className={'gc-button' + (linking ? ' is-active' : '')} disabled={blocked || !graph.nodes.length} aria-pressed={linking} aria-label={linking ? '取消连线' : '连接节点'} onClick={() => { setLinking(value => !value); setLinkFromId(null); }}><Link2 size={15} />{linking ? '取消连线' : '连线'}</button><button type="button" className="gc-button" disabled={linking || !graph.nodes.length} onClick={selectAll}>全选节点</button>{selectedNodes.length > 1 && <span className="gc-selection-count" role="status">已选 {selectedNodes.length} 个节点</span>}</div>
        <div className={'gc-canvas-hint' + (linking ? ' is-linking' : '')} role="status">{linking ? <><Link2 size={14} /><span>{linkSource ? `从「${nodeName(linkSource)}」出发，点击目标节点（可连接自身）` : '点击起点，再点击终点，创建一条流转连线。'}</span><button type="button" className="gc-icon-button" aria-label="退出连线" onClick={() => { setLinking(false); setLinkFromId(null); }}><X size={14} /></button></> : <><MousePointer2 size={14} /><span>左键空白框选 · 拖动选中节点整组移动 · Shift 加选 · 滚轮缩放 · 右键平移 · 双击模块进入</span></>}</div>
        <div className={'gc-canvas-scroll' + (linking ? ' is-linking' : '') + (viewport.panning ? ' is-panning' : '')} ref={scroll} {...viewport.handlers} aria-label="玩法流程画布" tabIndex={0} onPointerDown={startMarquee} onPointerMove={moveMarquee} onPointerUp={finishMarquee} onPointerCancel={event => finishMarquee(event, true)} onLostPointerCapture={event => { viewport.handlers.onLostPointerCapture(event); if (drag.current?.pointerId === event.pointerId) cancelGesture(); }} onClick={canvasClick}>
          <div className="gc-canvas-sizer" style={{ width: width * zoom + Math.max(0, viewport.x), height: height * zoom + Math.max(0, viewport.y) }}><div className="gc-canvas-surface" style={{ width, height, transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${zoom})` }} onClick={canvasClick}>
            <svg className="gc-connections" width={width} height={height} aria-label="玩法流转连线"><defs><marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#a797df" /></marker><marker id={markerId + '-active'} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#d7caff" /></marker></defs>
              {routedEdges.map(({ item, route }) => { if (!route) return null; const active = edge?.id === item.id; const showCondition = active && !!item.condition; const caption = short(item.label || '继续', 12) + (item.condition && !active ? ' ◇' : ''), condition = short(item.condition); const captionWidth = edgeCaptionWidth(caption, showCondition ? condition : ''); const title = nodeName(paintedNodes.find(n => n.id === item.fromId)!) + ' → ' + nodeName(paintedNodes.find(n => n.id === item.toId)!) + (item.label ? ' · ' + item.label : '');
                return <g key={item.id} className={'gc-edge' + (active ? ' is-selected' : '')} tabIndex={0} role="button" aria-label={'选择连线：' + title} onClick={event => { event.stopPropagation(); setSelected({ kind: 'edge', id: item.id }); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); setSelected({ kind: 'edge', id: item.id }); } }}><title>{title + (item.condition ? '\n条件：' + item.condition : '')}</title><path className="gc-edge-hit" d={route.path} /><path className="gc-edge-line" d={route.path} markerEnd={`url(#${markerId + (active ? '-active' : '')})`} /><g transform={`translate(${route.x},${route.y})`}><rect x={-captionWidth / 2} y={showCondition ? -22.5 : -14.5} width={captionWidth} height={showCondition ? 45 : 29} rx={7} /><text textAnchor="middle" y={showCondition ? -4 : 3}>{caption}</text>{showCondition && <text className="gc-edge-condition" textAnchor="middle" y={12}>{condition}</text>}</g></g>;
              })}
            </svg>
            {paintedNodes.map(item => { const Icon = kindIcons[item.kind], child = store.graphs.find(g => g.id === item.childGraphId); return <div key={item.id} className={'gc-node gc-node-' + item.kind + (selectedIds.includes(item.id) ? ' is-selected' : '') + (linkFromId === item.id ? ' is-source' : '')} style={{ left: item.x, top: item.y, width: NODE_WIDTH, height: NODE_HEIGHT }}>
              <button type="button" className="gc-node-main" aria-label={'选择节点：' + nodeName(item)} title={item.description || nodeName(item)} aria-pressed={selectedIds.includes(item.id)} onClick={event => chooseNode(item.id, event.shiftKey || event.ctrlKey || event.metaKey)} onDoubleClick={() => { if (suppressModuleDoubleClick.current) { suppressModuleDoubleClick.current = false; return; } enterModule(item); }} onPointerDown={event => startDrag(event, item)} onPointerMove={moveDrag} onPointerUp={event => finishDrag(event)} onPointerCancel={event => finishDrag(event, true)}><span className="gc-node-kind"><Icon size={14} />{kindNames[item.kind]}</span><strong>{nodeName(item)}</strong></button>
              <div className="gc-node-footer">{item.kind === 'module' ? <button type="button" aria-label={'进入模块：' + nodeName(item)} onClick={() => enterModule(item)}><span>{child ? child.nodes.length + ' 个节点' : '内部循环'}</span><ArrowDownRight size={14} /></button> : <span>{item.gameplayIds.length ? item.gameplayIds.length + ' 项关联玩法' : item.kind === 'exit' ? '通关 / 退出 / 阶段完成' : item.kind === 'decision' ? '按条件进入不同分支' : item.kind === 'entry' ? '玩家从这里开始' : '玩家的一项行动'}</span>}<button type="button" className="gc-node-link" disabled={blocked} aria-label={'从此节点连线：' + nodeName(item)} title="从此节点连线" onClick={() => { setLinking(true); setLinkFromId(item.id); setSelected({ kind: 'node', id: item.id }); }}><Link2 size={13} /></button></div>
            </div>; })}
            {marquee && <div className="gc-marquee" aria-label="节点框选范围" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height, borderWidth: 1 / zoom }} />}
            {!graph.nodes.length && <div className="gc-empty-canvas"><div className="gc-empty-icon"><GitBranch size={28} /></div><h3>{graph.id === store.rootId ? '先画出游戏的主入口' : '设计这个模块的内部循环'}</h3><p>添加入口、活动或循环模块，再用连线表达玩家的选择与循环。</p><button type="button" className="gc-button gc-primary" disabled={blocked} onClick={() => addNode('entry')}><Plus size={16} />添加第一个入口</button><small>循环可以没有终点；不同分支可以随时返回。</small></div>}
          </div></div>
        </div>
        <div className="gc-canvas-footer"><span>{graph.nodes.length} 个节点 · {graph.edges.length} 条连线</span><div className="gc-zoom-tools"><button type="button" className="gc-icon-button" aria-label="缩小画布" disabled={zoom <= .35} onClick={() => setZoom(value => Math.max(.35, value - .15))}><Minus size={15} /></button><output>{Math.round(zoom * 100)}%</output><button type="button" className="gc-icon-button" aria-label="放大画布" disabled={zoom >= 1.75} onClick={() => setZoom(value => Math.min(1.75, value + .15))}><Plus size={15} /></button><button type="button" className="gc-icon-button" aria-label="适配画布" title="适配画布" onClick={fit}><Maximize2 size={15} /></button><button type="button" className="gc-icon-button" aria-label="还原缩放" title="还原缩放" onClick={() => resetView(1)}><RotateCcw size={15} /></button></div></div>
      </div>
      <aside className="gc-inspector" aria-label="流程属性编辑"><div className="gc-inspector-heading"><div><span className="gc-eyebrow">{selectedNodes.length > 1 ? 'SELECTION' : node ? 'NODE' : edge ? 'TRANSITION' : 'FLOW'}</span><h3>{selectedNodes.length > 1 ? `已选择 ${selectedNodes.length} 个节点` : node ? kindNames[node.kind] + '属性' : edge ? '流转连线' : '流程属性'}</h3></div>{(selectedNodes.length > 0 || edge) && <button type="button" className="gc-icon-button" aria-label="取消选择" onClick={() => setSelected(null)}><X size={16} /></button>}</div>
        {selectedNodes.length > 1 ? <div className="gc-properties gc-multi-selection"><p>拖动其中任意一个节点，整组移动并保持相对位置。</p><p>{team ? '仅保存到你的个人布局。' : '松开鼠标后一次保存全部位置。'}Shift 点击可加选或取消，Esc 清除选择。</p><div className="gc-selected-list">{selectedNodes.map(n => <button className="gc-button" key={n.id} type="button" aria-label={'单独选择：' + nodeName(n)} onClick={() => setSelected({ kind: 'node', id: n.id })}>{nodeName(n)}</button>)}</div></div> : node ? <div className="gc-properties"><label className="gc-field">节点名称<input aria-label="节点名称" value={node.title} disabled={blocked} onChange={event => patchNode(node.id, { title: event.target.value })} placeholder="用简短名称描述玩家正在做什么" /></label><label className="gc-field">节点说明<textarea aria-label="节点说明" rows={4} value={node.description} disabled={blocked} onChange={event => patchNode(node.id, { description: event.target.value })} placeholder="说明玩法目标、玩家行为或退出条件" /></label>
          {node.kind === 'module' && <button type="button" className="gc-button gc-primary gc-wide" disabled={blocked && !node.childGraphId} onClick={() => enterModule(node,true)}><Layers size={15} />{team && !node.childGraphId ? '创建内部循环' : '进入内部循环'}<ArrowRight size={15} /></button>}
          <div className="gc-reference-section"><h4>关联玩法设计 <small>{node.gameplayIds.length}</small></h4><p>{team ? (teamDesignsReady?'关联团队玩法设计，可打开查看最新内容。':'团队玩法设计尚未创建或补充，保留来源名称与标识。') : '引用具体规则与方案，细节在玩法设计中维护。'}</p><select aria-label="添加关联玩法" value="" disabled={blocked || (team && !teamDesignsReady)} onChange={event => { if (event.target.value) patchNode(node.id, { gameplayIds: [...node.gameplayIds, event.target.value] }); }}><option value="">选择一份玩法设计…</option>{designs.filter(d => !d.archived && !d.sourceOnly && !node.gameplayIds.includes(d.id)).map(d => <option value={d.id} key={d.id}>{d.title || '未命名玩法'}</option>)}</select>
            {!designs.some(d => !d.archived && !d.sourceOnly) && <p className="gc-muted">还没有可关联的玩法设计，可以稍后补充。</p>}
            <div className="gc-references">{node.gameplayIds.map(id => { const design = designs.find(d => d.id === id); return <div className={'gc-reference' + (!design || design.archived ? ' is-warning' : '')} key={id}><div>{team && (!design || design.sourceOnly) ? <span>{design?.title || id}<small>来源标识：{id} · 尚未补充到团队</small></span> : design ? <button type="button" className="gc-reference-open" aria-label={'打开关联玩法：' + design.title} onClick={() => onOpenGameplay(id)}><span>{design.title || '未命名玩法'}</span><ArrowRight size={14} /></button> : <span>已失效的玩法关联</span>}{(!design || design.archived) && <small>{design ? '玩法已归档，仍保留关联' : `原玩法已不存在 · ${id.slice(0, 8)}`}</small>}</div><button type="button" className="gc-icon-button" disabled={blocked || (team && !teamDesignsReady)} aria-label={'解除关联：' + (design?.title || id)} onClick={() => patchNode(node.id, { gameplayIds: node.gameplayIds.filter(value => value !== id) })}><Unlink size={14} /></button></div>; })}</div>
          </div><div className="gc-inspector-actions"><button type="button" className="gc-button" disabled={blocked} onClick={() => { setLinking(true); setLinkFromId(node.id); }}><Link2 size={15} />从此节点连线</button><button type="button" className="gc-button gc-danger" disabled={blocked} onClick={requestDelete}><Trash2 size={15} />删除节点</button></div>
        </div> : edge ? <div className="gc-properties"><label className="gc-field">起点<select aria-label="连线起点" value={edge.fromId} disabled={blocked} onChange={event => patchEdge({ fromId: event.target.value })}>{graph.nodes.map(n => <option key={n.id} value={n.id}>{nodeName(n)}</option>)}</select></label><label className="gc-field">终点<select aria-label="连线终点" value={edge.toId} disabled={blocked} onChange={event => patchEdge({ toId: event.target.value })}>{graph.nodes.map(n => <option key={n.id} value={n.id}>{nodeName(n)}</option>)}</select></label><label className="gc-field">连线说明<input aria-label="连线说明" value={edge.label} disabled={blocked} onChange={event => patchEdge({ label: event.target.value })} placeholder="如：开始游戏、领取奖励、进入下一天" /></label><label className="gc-field">流转条件<textarea aria-label="流转条件" rows={4} value={edge.condition} disabled={blocked} onChange={event => patchEdge({ condition: event.target.value })} placeholder="如：还有未完成关卡 / 击败最终 Boss" /></label><p className="gc-inspector-note">条件用于表达设计意图。连接自己或前面的节点，即可形成循环。</p><button type="button" className="gc-button gc-danger" disabled={blocked} onClick={() => { if (editGraph(g => ({ ...g, edges: g.edges.filter(e => e.id !== edge.id) }))) setSelected(null); }}><Trash2 size={15} />删除连线</button></div> : <div className="gc-properties"><label className="gc-field">流程图名称<input aria-label="流程图名称" value={graph.title} disabled={blocked} onChange={event => renameGraph(event.target.value)} /></label><label className="gc-field">流程图说明<textarea aria-label="流程图说明" rows={5} value={graph.summary} disabled={blocked} onChange={event => editGraph(g => ({ ...g, summary: event.target.value }))} placeholder="用一句话描述这层玩法的核心体验" /></label><div className="gc-flow-guide"><h4>保持这一层精简</h4><p><Play size={14} />入口：玩家从哪里开始。</p><p><Circle size={14} />活动：玩家正在做什么。</p><p><Layers size={14} />模块：双击进入一组玩法循环。</p><p><GitBranch size={14} />条件：选择或条件产生分支。</p><p><CircleStop size={14} />结束：通关、退出或阶段完成。</p></div><p className="gc-inspector-note">自由探索与日常经营可以持续循环，无需强行设置终点。</p>{path.length > 1 && <button type="button" className="gc-button" onClick={() => navigate(path[path.length - 2].id)}><ArrowLeft size={15} />返回上层流程</button>}</div>}
      </aside>
    </div>
    <dialog className="gc-dialog" ref={dialog} onCancel={() => setDeleteId('')} aria-labelledby={markerId + '-delete-title'}><div className="gc-dialog-body"><span className="gc-eyebrow">DELETE MODULE</span><h3 id={markerId + '-delete-title'}>删除循环模块？</h3><p>将删除「{graph.nodes.find(n => n.id === deleteId)?.title || '这个模块'}」、它的全部内部流程及相关连线。已关联的玩法设计会保留。</p><div className="gc-dialog-actions"><button type="button" className="gc-button" onClick={() => { dialog.current?.close(); setDeleteId(''); }}>取消</button><button type="button" className="gc-button gc-danger" disabled={blocked} onClick={() => deleteNode(deleteId)}>确认删除模块</button></div></div></dialog>
  </section>;
}
