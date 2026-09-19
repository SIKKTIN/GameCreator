import { validateSpatial, spatialIssues, spatialObjectReferences, spatialMarkdown, spatialObjectLocation, objectGeometry, type SpatialGeometry, type SpatialLayout } from './spatial-layout.ts';
import type { GameplayDesign } from './gameplay';
export const stageKinds = { actor: '单位', obstacle: '障碍', spawn: '入口', goal: '目标', zone: '区域', note: '标记' } as const;
export const stageColors = { green: '#65c49e', violet: '#b19be9', blue: '#7db4e9', amber: '#e3b565', red: '#df8b89' } as const;
export type StageObject = { id: string; name: string; kind: keyof typeof stageKinds; color: keyof typeof stageColors; anchor: 'cell' | 'left' | 'right'; row: number; column: number; width: number; height: number; direction: 'left' | 'right' | 'up' | 'down'; rangeShape: 'none' | 'line' | 'radius' | 'ring' | 'sector'; geometry?: SpatialGeometry; roomId?: string; range: number; notes: string };
export type StageLayout = { spatial?: SpatialLayout; rows: number; columns: number; cellSize: number; unit: string; description: string; objects: StageObject[] };
export type TimelineTrack = { id: string; name: string; color: keyof typeof stageColors };
export type TimelineEvent = { id: string; trackId: string; name: string; start: number; duration: number; repeat: number; interval: number; quantity: number; objectId: string; condition: string; notes: string };
export type GameplayTimeline = { duration: number; clock: string; spaceOwnerId: string; tracks: TimelineTrack[]; events: TimelineEvent[] };
export type GameplayStage = { space: StageLayout; timeline: GameplayTimeline };
export const emptyStage = (): GameplayStage => ({ space: { rows: 8, columns: 12, cellSize: 1, unit: '格', description: '', objects: [] }, timeline: { duration: 180, clock: '累计游戏时间（暂停冻结）', spaceOwnerId: '', tracks: [], events: [] } });
export const createStageObject = (kind: StageObject['kind'], row: number, column: number): StageObject => ({ id: crypto.randomUUID(), name: stageKinds[kind], kind, color: kind === 'spawn' ? 'red' : kind === 'goal' ? 'blue' : kind === 'obstacle' ? 'amber' : 'green', anchor: 'cell', row, column, width: 1, height: 1, direction: 'right', rangeShape: 'none', range: 3, notes: '' });
export const createTrack = (): TimelineTrack => ({ id: crypto.randomUUID(), name: '', color: 'violet' });
export const createTimelineEvent = (trackId: string): TimelineEvent => ({ id: crypto.randomUUID(), trackId, name: '', start: 0, duration: 0, repeat: 1, interval: 1, quantity: 1, objectId: '', condition: '', notes: '' });
const has = (o: object, k: unknown) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const num = (n: unknown, min: number, max: number, integer = false) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n));
export function validateStage(value: GameplayStage) {
  const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
  const strings = (o: Record<string, unknown>, keys: string[]) => keys.every(k => typeof o[k] === 'string');
  const list = (xs: unknown, check: (x: Record<string, unknown>) => boolean, max: number) => { if (!Array.isArray(xs) || xs.length > max) return false; const seen = new Set(); return xs.every(x => { if (!object(x) || typeof x.id !== 'string' || !x.id || seen.has(x.id) || !check(x)) return false; seen.add(x.id); return true; }); };
  const s = value.space, t = value.timeline;
  if (!object(s) || !num(s.rows, 1, 30, true) || !num(s.columns, 1, 40, true) || !num(s.cellSize, .001, 10000) || !strings(s, ['unit', 'description']) ||
      !list(s.objects, o => strings(o, ['name', 'notes']) && has(stageKinds, o.kind) && has(stageColors, o.color) && ['cell', 'left', 'right'].includes(o.anchor as string) && ['left', 'right', 'up', 'down'].includes(o.direction as string) && ['none', 'line', 'radius', 'ring', 'sector'].includes(o.rangeShape as string) && num(o.row, 1, 30, true) && num(o.column, 1, 40, true) && num(o.width, 1, 40, true) && num(o.height, 1, 30, true) && num(o.range, 0, 100), 300) ||
      !object(t) || !num(t.duration, 1, 86400) || !strings(t, ['clock', 'spaceOwnerId']) || !list(t.tracks, r => strings(r, ['name']) && has(stageColors, r.color), 30) ||
      !list(t.events, e => strings(e, ['trackId', 'name', 'objectId', 'condition', 'notes']) && num(e.start, 0, 86400) && num(e.duration, 0, 86400) && num(e.interval, 0, 86400) && num(e.repeat, 1, 100, true) && num(e.quantity, 1, 10000, true), 200)) throw new Error('空间布局或时间轴存档格式异常，已停止写入');
  validateSpatial(s); return value;
}
export function copyStage(source: GameplayDesign, newDesignId: string, ruleIds = new Map<string, string>()): GameplayStage {
  const objectIds = new Map(source.space.objects.map(o => [o.id, crypto.randomUUID()])), trackIds = new Map(source.timeline.tracks.map(t => [t.id, crypto.randomUUID()]));
  const roomIds = new Map((source.space.spatial?.rooms ?? []).map(r => [r.id, crypto.randomUUID()]));
  const local = !source.timeline.spaceOwnerId || source.timeline.spaceOwnerId === source.id;
  return { space: { ...structuredClone(source.space), ...(source.space.spatial ? { spatial: { ...structuredClone(source.space.spatial), rooms: source.space.spatial.rooms.map(r => ({ ...r, id: roomIds.get(r.id)! })), connections: source.space.spatial.connections.map(c => { const from = source.space.spatial!.rooms.find(r => r.id === c.from), to = source.space.spatial!.rooms.find(r => r.id === c.to); return { ...c, id: crypto.randomUUID(), ruleId: ruleIds.get(c.ruleId) ?? c.ruleId, from: roomIds.get(c.from) ?? c.from, to: roomIds.get(c.to) ?? c.to, fromObjectId: from?.sourceDesignId ? c.fromObjectId : objectIds.get(c.fromObjectId) ?? c.fromObjectId, toObjectId: to?.sourceDesignId ? c.toObjectId : objectIds.get(c.toObjectId) ?? c.toObjectId }; }) } } : {}), objects: source.space.objects.map(o => ({ ...structuredClone(o), id: objectIds.get(o.id)!, ...(o.roomId ? { roomId: roomIds.get(o.roomId) ?? o.roomId } : {}) })) }, timeline: { ...source.timeline,
    spaceOwnerId: source.timeline.spaceOwnerId === source.id ? newDesignId : source.timeline.spaceOwnerId,
    tracks: source.timeline.tracks.map(t => ({ ...t, id: trackIds.get(t.id)! })),
    events: source.timeline.events.map(e => ({ ...e, id: crypto.randomUUID(), trackId: trackIds.get(e.trackId) ?? e.trackId, objectId: local ? objectIds.get(e.objectId) ?? e.objectId : e.objectId })) } };
}
export function spaceOwner(design: GameplayDesign, designs: GameplayDesign[]) { return !design.timeline.spaceOwnerId || design.timeline.spaceOwnerId === design.id ? design : designs.find(d => d.id === design.timeline.spaceOwnerId); }
export function stageColumn(o: StageObject, s: StageLayout) { return o.anchor === 'left' ? 0 : o.anchor === 'right' ? s.columns + 1 : o.column; }
export function objectFits(o: StageObject, s: StageLayout) { return !!o.geometry || o.row + o.height - 1 <= s.rows && (o.anchor === 'cell' ? o.column + o.width - 1 <= s.columns : o.width === 1 && o.height === 1); }
export function resizeSpace(s: StageLayout, rows: number, columns: number) {
  const next = { ...s, rows, columns }; const outside = s.objects.filter(o => !objectFits(o, next));
  if (outside.length) throw new Error('缩小后会超出边界：' + outside.map(o => o.name || '未命名对象').join('、') + '。请先移动或调整这些对象。'); return next;
}
export function removeStageObject(design: GameplayDesign, designs: GameplayDesign[], id: string) {
  const references = designs.filter(d => spaceOwner(d, designs)?.id === design.id).flatMap(d => d.timeline.events.filter(e => e.objectId === id).map(e => `${d.title} / ${e.name || '未命名事件'}`));
  references.push(...spatialObjectReferences(design, designs, id));
  if (references.length) throw new Error('对象被时间事件引用：' + references.join('、') + '。请先调整关联。');
  return { ...design.space, objects: design.space.objects.filter(o => o.id !== id) };
}
const rounded = (n: number) => Math.round(n * 1e6) / 1e6;
export function eventLastStart(e: TimelineEvent) { return rounded(e.start + (e.repeat - 1) * e.interval); }
export function eventEnd(e: TimelineEvent) { return rounded(eventLastStart(e) + e.duration); }
export function dueOccurrences(e: TimelineEvent, time: number) { return time + 1e-7 < e.start ? 0 : e.interval === 0 ? e.repeat : Math.min(e.repeat, Math.floor((time - e.start + 1e-7) / e.interval) + 1); }
export function activeOccurrences(e: TimelineEvent, time: number) { if (!e.duration) return 0; return dueOccurrences(e, time) - dueOccurrences(e, time - e.duration); }
export function timelineStats(t: GameplayTimeline, time = t.duration) { return { occurrences: t.events.reduce((n, e) => n + e.repeat, 0), quantity: t.events.reduce((n, e) => n + e.repeat * e.quantity, 0), due: t.events.reduce((n, e) => n + dueOccurrences(e, time), 0), dueQuantity: t.events.reduce((n, e) => n + dueOccurrences(e, time) * e.quantity, 0), active: t.events.reduce((n, e) => n + activeOccurrences(e, time), 0), last: Math.max(0, ...t.events.map(eventEnd)) }; }
export function timelineBuckets(t: GameplayTimeline, width: number) { if (!Number.isFinite(width) || width <= 0) throw new Error('统计窗口必须为正数'); const result: { start: number; end: number; quantity: number }[] = []; const end = Math.max(t.duration, timelineStats(t).last); if (Math.floor(end / width) + 1 > 200) throw new Error('统计窗口过小，请增大每段时间（最多200段）'); for (let index = 0; index <= Math.floor(end / width); index++) { const start = rounded(index * width); result.push({ start, end: rounded(start + width), quantity: 0 }); } for (const e of t.events) for (let i = 0; i < e.repeat; i++) { const index = Math.floor(rounded(e.start + i * e.interval) / width); if (result[index]) result[index].quantity += e.quantity; } return result; }
export function stageIssues(design: GameplayDesign, designs: GameplayDesign[]) {
  const issues: string[] = spatialIssues(design, designs); const s = design.space, t = design.timeline, owner = spaceOwner(design, designs);
  for (const o of s.objects) { if (!o.name.trim()) issues.push('有空间对象尚未命名'); if (!objectFits(o, s)) issues.push('对象超出布局边界：' + (o.name || '未命名')); }
  if (t.spaceOwnerId && !owner) issues.push('空间来源玩法已失效'); else if (owner?.archived && owner.id !== design.id) issues.push('空间来源玩法已归档：' + owner.title);
  if (!t.clock.trim() && t.events.length) issues.push('补充计时基准');
  for (const track of t.tracks) if (!track.name.trim()) issues.push('有时间轨道尚未命名');
  for (const e of t.events) { if (!e.name.trim()) issues.push('有时间事件尚未命名'); if (!t.tracks.some(x => x.id === e.trackId)) issues.push('事件轨道已失效：' + (e.name || '未命名')); if (eventEnd(e) > t.duration) issues.push('事件超出计划时长：' + (e.name || '未命名')); if (e.objectId && !owner?.space.objects.some(o => o.id === e.objectId)) issues.push('事件的空间对象已失效：' + (e.name || '未命名')); }
  return [...new Set(issues)];
}
export function stageMarkdown(d: GameplayDesign, designs: GameplayDesign[]) {
  const s = d.space, t = d.timeline, owner = spaceOwner(d, designs), lines = ['#### 空间布局', '', `${s.rows} 行 × ${s.columns} 列；每格 ${s.cellSize} ${s.unit || '单位'}。行从上到下，列从左到右。`, s.description, ...spatialMarkdown(s), ''];
  if (!s.objects.length) lines.push('暂无空间对象。');
  for (const o of s.objects) { if (o.geometry || o.roomId) { const g = objectGeometry(o, s); lines.push(`- ${o.name}（${stageKinds[o.kind]}）：${spatialObjectLocation(o, s)}；尺寸 ${g.width}×${g.height} ${s.unit}；角度 ${g.rotation}°；形状 ${g.shape}；范围 ${o.rangeShape} ${g.innerRange}–${g.range} ${s.unit}，夹角 ${g.arc}°。${o.notes}`); continue; } lines.push(`- ${o.name || '未命名'}（${stageKinds[o.kind]}）：${o.anchor === 'cell' ? `R${o.row} C${o.column}，占 ${o.width}×${o.height} 格` : `第 ${o.row} 行${o.anchor === 'left' ? '左' : '右'}侧边界外`}；朝向 ${o.direction}；范围 ${o.rangeShape === 'none' ? '无' : (o.rangeShape === 'line' ? '直线 ' : '圆形半径 ') + o.range + ' 格'}。${o.notes}`); }
  const stats = timelineStats(t); lines.push('', '#### 时间轴', '', `计时基准：${t.clock || '待补充'}；计划时长：${t.duration} 秒。`, `空间来源：${owner?.title || '已失效'}。`, `计划触发 ${stats.occurrences} 次，计划数量 ${stats.quantity}（按事件数量累加）；最后事件结束于 ${stats.last} 秒。`, '> 时间预览只计算计划触发，不执行条件，不模拟战斗或推算存活数量。', '');
  if (!t.events.length) lines.push('暂无时间事件。');
  for (const track of t.tracks) { lines.push('', `轨道：${track.name || '未命名'}`); for (const e of t.events.filter(e => e.trackId === track.id)) lines.push(`- ${e.name || '未命名'}：${e.start} 秒开始，持续 ${e.duration} 秒，每 ${e.interval} 秒重复，共 ${e.repeat} 次，每次 ${e.quantity}；最后触发 ${eventLastStart(e)} 秒；位置 ${e.objectId ? owner?.space.objects.find(o => o.id === e.objectId)?.name || '关联已失效' : '未指定'}；条件 ${e.condition || '无附加条件'}。${e.notes}`); }
  for (const e of t.events.filter(e => !t.tracks.some(x => x.id === e.trackId))) lines.push(`- 未分配轨道事件：${e.name || '未命名'}（轨道已失效），${e.start} 秒开始，持续 ${e.duration} 秒，共 ${e.repeat} 次，间隔 ${e.interval} 秒，每次 ${e.quantity}。`);
  const issues = stageIssues(d, designs); if (issues.length) lines.push('', '空间/时间检查：', ...issues.map(i => '- ' + i)); return lines.join('\n');
}
