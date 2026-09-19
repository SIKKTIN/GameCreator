import type { StageLayout, StageObject } from './gameplay-stage';
import type { GameplayDesign } from './gameplay';

export const spatialViews = { grid: '网格布局', free: '自由二维', rooms: '房间连接' } as const;
export type SpatialView = keyof typeof spatialViews;
export type SpatialGeometry = { x: number; y: number; width: number; height: number; rotation: number; shape: 'rect' | 'circle'; range: number; innerRange: number; arc: number };
export type SpatialRoom = { id: string; name: string; x: number; y: number; view: 'grid' | 'free'; sourceDesignId: string; notes: string };
export type SpatialConnection = { id: string; name: string; from: string; to: string; fromObjectId: string; toObjectId: string; direction: 'one' | 'both'; condition: string; ruleId: string };
export type SpatialLayout = { version: 1; view: SpatialView; rooms: SpatialRoom[]; connections: SpatialConnection[] };
export const spatialLayout = (s: StageLayout): SpatialLayout => s.spatial ?? { version: 1, view: 'grid', rooms: [], connections: [] };
const finite = (n: unknown, min = -1e6, max = 1e6): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
export function validateSpatial(s: StageLayout) {
  const fail = () => { throw new Error('空间视图存档格式异常，已停止写入'); };
  const list = (xs: unknown, check: (x: Record<string, unknown>) => boolean, max: number) => {
    if (!Array.isArray(xs) || xs.length > max) return false;
    const seen = new Set();
    return xs.every(x => { if (!record(x) || typeof x.id !== 'string' || !x.id || seen.has(x.id) || !check(x)) return false; seen.add(x.id); return true; });
  };
  for (const o of s.objects) {
    if (o.roomId !== undefined && typeof o.roomId !== 'string') fail();
    const g = o.geometry;
    if (g !== undefined && (!record(g) || !finite(g.x) || !finite(g.y) || !finite(g.width, .001) || !finite(g.height, .001) || !finite(g.rotation, -360, 360) || !['rect', 'circle'].includes(g.shape) || !finite(g.range, 0) || !finite(g.innerRange, 0, g.range) || !finite(g.arc, 1, 360))) fail();
  }
  if (s.spatial === undefined) return;
  const a = s.spatial;
  const strings = (x: Record<string, unknown>, keys: string[]) => keys.every(k => typeof x[k] === 'string');
  if (!record(a) || a.version !== 1 || !['grid', 'free', 'rooms'].includes(a.view) ||
    !list(a.rooms, r => strings(r, ['name', 'sourceDesignId', 'notes']) && finite(r.x) && finite(r.y) && ['grid', 'free'].includes(r.view as string), 100) ||
    !list(a.connections, c => strings(c, ['name', 'from', 'to', 'fromObjectId', 'toObjectId', 'condition', 'ruleId']) && ['one', 'both'].includes(c.direction as string), 500)) fail();
}
// Legacy grid coordinates stay intact until an object is moved in continuous space.
// The optional geometry is then authoritative in both physical views. Merely viewing never rounds or writes coordinates.
export function objectGeometry(o: StageObject, s: StageLayout): SpatialGeometry {
  if (o.geometry) return o.geometry;
  return { x: (o.anchor === 'left' ? -1 : o.anchor === 'right' ? s.columns : o.column - 1) * s.cellSize, y: (o.row - 1) * s.cellSize,
    width: (o.anchor === 'cell' ? o.width : 1) * s.cellSize, height: (o.anchor === 'cell' ? o.height : 1) * s.cellSize,
    rotation: { right: 0, down: 90, left: 180, up: -90 }[o.direction], shape: 'rect', range: o.range * s.cellSize, innerRange: 0, arc: 90 };
}
export function moveSpatialObject(o: StageObject, s: StageLayout, x: number, y: number, grid: boolean): StageObject {
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  if (grid) { x = Math.round(x / s.cellSize) * s.cellSize; y = Math.round(y / s.cellSize) * s.cellSize; }
  if (!o.geometry && grid) {
    const row = Math.round(y / s.cellSize) + 1, column = Math.round(x / s.cellSize) + 1;
    if (row < 1 || column < 1 || row + o.height - 1 > s.rows || column + o.width - 1 > s.columns) throw new Error('移动后超出格子边界，请选择可以容纳对象的位置');
    return { ...o, row, column, anchor: 'cell' };
  }
  if (!finite(x) || !finite(y)) throw new Error('坐标超出支持范围');
  return { ...o, geometry: { ...objectGeometry(o, s), x: round(x), y: round(y) } };
}
export function spatialObjectLocation(o: StageObject, s: StageLayout) {
  const room = spatialLayout(s).rooms.find(r => r.id === o.roomId);
  const g = objectGeometry(o, s);
  return (room ? room.name + ' / ' : '') + (o.geometry ? `(${g.x}, ${g.y}) ${s.unit}` : o.anchor === 'cell' ? `R${o.row} C${o.column}` : `第 ${o.row} 行${o.anchor === 'left' ? '左' : '右'}侧边界外`);
}
export function createSpatialRoom(index: number): SpatialRoom {
  return { id: crypto.randomUUID(), name: '房间 ' + (index + 1), x: (index % 3) * 400, y: Math.floor(index / 3) * 240, view: 'free', sourceDesignId: '', notes: '' };
}
export function roomSource(room: SpatialRoom, design: GameplayDesign, designs: GameplayDesign[]) { return room.sourceDesignId ? designs.find(d => d.id === room.sourceDesignId) : design; }
export function roomObjects(room: SpatialRoom, design: GameplayDesign, designs: GameplayDesign[]) {
  const source = roomSource(room, design, designs);
  return source ? source.space.objects.filter(o => room.sourceDesignId ? !o.roomId : o.roomId === room.id) : [];
}
export function removeSpatialRoom(s: StageLayout, id: string) {
  const a = spatialLayout(s);
  const items = s.objects.filter(o => o.roomId === id).map(o => o.name);
  const links = a.connections.filter(c => c.from === id || c.to === id).map(c => c.name || '未命名连接');
  if (items.length || links.length) throw new Error('房间仍被使用：' + [...items, ...links].join('、') + '。请先移动对象或调整连接。');
  return { ...s, spatial: { ...a, rooms: a.rooms.filter(r => r.id !== id) } };
}
export function spatialIssues(d: GameplayDesign, designs: GameplayDesign[]) {
  const s = d.space, a = spatialLayout(s), issues: string[] = [];
  for (const o of s.objects) {
    const room = a.rooms.find(r => r.id === o.roomId);
    if (o.roomId && !room) issues.push('对象所属房间已失效：' + o.name);
    if (room?.sourceDesignId) issues.push('引用房间不能包含本地对象：' + o.name);
  }
  for (const r of a.rooms) {
    if (!r.name.trim()) issues.push('有房间尚未命名');
    if (r.sourceDesignId === d.id) issues.push('房间不能引用自身玩法：' + r.name);
    const source = roomSource(r, d, designs);
    if (!source) issues.push('房间来源玩法已失效：' + r.name);
    else if (source.archived && source.id !== d.id) issues.push('房间来源玩法已归档：' + r.name);
  }
  for (const c of a.connections) {
    const from = a.rooms.find(r => r.id === c.from), to = a.rooms.find(r => r.id === c.to);
    if (!from || !to) issues.push('房间连接端点已失效：' + (c.name || '未命名'));
    if (c.fromObjectId && from && !roomObjects(from, d, designs).some(o => o.id === c.fromObjectId)) issues.push('连接出口已失效：' + c.name);
    if (c.toObjectId && to && !roomObjects(to, d, designs).some(o => o.id === c.toObjectId)) issues.push('连接入口已失效：' + c.name);
    if (c.ruleId && !d.conditionRules.some(r => r.id === c.ruleId)) issues.push('连接条件规则已失效：' + c.name);
  }
  return issues;
}
export function spatialObjectReferences(d: GameplayDesign, designs: GameplayDesign[], id: string): string[] {
  return designs.flatMap(owner => spatialLayout(owner.space).connections.flatMap(c => {
    const a = spatialLayout(owner.space);
    return (['from', 'to'] as const).flatMap(side => {
      const room = a.rooms.find(r => r.id === c[side]);
      return room && roomSource(room, owner, designs)?.id === d.id && c[side === 'from' ? 'fromObjectId' : 'toObjectId'] === id ? [`${owner.title} / ${c.name || '房间连接'}`] : [];
    });
  }));
}
export function spatialMarkdown(s: StageLayout) {
  const a = spatialLayout(s), lines = [`空间视图：${spatialViews[a.view]}`];
  for (const r of a.rooms) lines.push(`- 房间：${r.name} [${r.id}]；内部视图：${spatialViews[r.view]}；来源：${r.sourceDesignId || '本地房间'}；${r.notes}`);
  for (const c of a.connections) lines.push(`- 连接：${a.rooms.find(r => r.id === c.from)?.name || c.from} ${c.direction === 'both' ? '↔' : '→'} ${a.rooms.find(r => r.id === c.to)?.name || c.to}；${c.name}；出口：${c.fromObjectId || '未指定'}；入口：${c.toObjectId || '未指定'}；条件：${c.condition || '无'}；规则：${c.ruleId || '无'}`);
  return lines;
}
