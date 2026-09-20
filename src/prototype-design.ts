import type { GameplayDesign } from './gameplay';
import type { GameplayCoreStore } from './gameplay-core';
import type { ArtStore } from './art-assets';
import { objectGeometry, spatialLayout, roomSource } from './spatial-layout.ts';

export const prototypeKinds = { text: '文字', button: '按钮', shape: '色块', image: '图片', hotspot: '交互热点' } as const;
export const prototypeActions = { none: '无动作', scene: '切换场景', show: '显示元素', hide: '隐藏元素', toggle: '切换元素显隐', restart: '重新开始' } as const;
export type PrototypeAction = { kind: keyof typeof prototypeActions; targetId: string; condition: string };
export type PrototypeElement = { id: string; kind: keyof typeof prototypeKinds; name: string; text: string; x: number; y: number; width: number; height: number; color: string; fontSize: number; visible: boolean; sourceObjectId: string; assetId: string; versionId: string; fileId: string; action: PrototypeAction };
export type PrototypeScene = { id: string; name: string; description: string; width: number; height: number; background: string; view: 'grid' | 'free'; sourceDesignId: string; roomId: string; coreNodeId: string; elements: PrototypeElement[] };
export type PrototypeDesignStore = { schema: 1; entryId: string; scenes: PrototypeScene[] };
export const emptyPrototypeDesign = (): PrototypeDesignStore => ({ schema: 1, entryId: '', scenes: [] });
export const createPrototypeScene = (name = '新场景'): PrototypeScene => ({ id: crypto.randomUUID(), name, description: '', width: 960, height: 540, background: '#151622', view: 'free', sourceDesignId: '', roomId: '', coreNodeId: '', elements: [] });
export const createPrototypeElement = (kind: PrototypeElement['kind'], index = 0): PrototypeElement => ({ id: crypto.randomUUID(), kind, name: prototypeKinds[kind], text: kind === 'button' ? '继续' : prototypeKinds[kind], x: 80 + index % 6 * 24, y: 80 + index % 6 * 24, width: kind === 'text' ? 320 : 180, height: kind === 'text' ? 60 : 52, color: kind === 'button' ? '#7258d9' : kind === 'text' ? '#e9e3f3' : '#597d93', fontSize: 22, visible: true, sourceObjectId: '', assetId: '', versionId: '', fileId: '', action: { kind: 'none', targetId: '', condition: '' } });
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: Record<string, unknown>, keys: string[]) => keys.every(k => typeof v[k] === 'string');
const number = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const color = (v: unknown) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const has = (v: object, k: unknown) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(v, k);
/** Broken references remain repairable drafts; malformed archives are never overwritten. */
export function validatePrototypeDesign(value: unknown): PrototypeDesignStore {
  const fail = () => { throw new Error('原型设计存档格式无效'); };
  if (!record(value) || value.schema !== 1 || typeof value.entryId !== 'string' || !Array.isArray(value.scenes) || value.scenes.length > 100) return fail();
  const ids = new Set<string>();
  const unique = (v: Record<string, unknown>) => { if (typeof v.id !== 'string' || !v.id.trim() || ids.has(v.id)) fail(); ids.add(v.id as string); };
  for (const s of value.scenes) {
    if (!record(s) || !strings(s, ['name', 'description', 'sourceDesignId', 'roomId', 'coreNodeId']) || !number(s.width, 320, 3840) || !number(s.height, 240, 2160) || !color(s.background) || !['grid', 'free'].includes(s.view as string) || !Array.isArray(s.elements) || s.elements.length > 300) return fail();
    unique(s);
    for (const e of s.elements) {
      if (!record(e) || !strings(e, ['name', 'text', 'sourceObjectId', 'assetId', 'versionId', 'fileId']) || !has(prototypeKinds, e.kind) || !number(e.x, -10000, 10000) || !number(e.y, -10000, 10000) || !number(e.width, 1, 10000) || !number(e.height, 1, 10000) || !number(e.fontSize, 8, 150) || !color(e.color) || typeof e.visible !== 'boolean' || !record(e.action) || !has(prototypeActions, e.action.kind) || !strings(e.action, ['targetId', 'condition'])) return fail();
      unique(e);
    }
  }
  return value as PrototypeDesignStore;
}
export function readPrototypeDesign(storage: Pick<Storage, 'getItem'>, key: string) { const raw = storage.getItem(key); return { raw, store: raw === null ? emptyPrototypeDesign() : validatePrototypeDesign(JSON.parse(raw)) }; }
export function writePrototypeDesign(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, expected: string | null, store: PrototypeDesignStore) {
  const raw = JSON.stringify(validatePrototypeDesign(store));
  if (storage.getItem(key) !== expected) throw new Error('其他窗口已修改原型设计，请备份草稿后重新读取');
  storage.setItem(key, raw); return raw;
}
export function prototypeSource(scene: PrototypeScene, designs: GameplayDesign[]) {
  const owner = designs.find(d => d.id === scene.sourceDesignId), room = owner && spatialLayout(owner.space).rooms.find(r => r.id === scene.roomId);
  const source = owner && (room ? roomSource(room, owner, designs) : owner);
  const objects = source && (!scene.roomId || room) ? source.space.objects.filter(o => (o.roomId || '') === (room && !room.sourceDesignId ? room.id : '')) : [];
  return { owner, room, source, objects };
}
export function prototypeIssues(store: PrototypeDesignStore, designs: GameplayDesign[], core: GameplayCoreStore, art: ArtStore) {
  const issues: string[] = [];
  if (store.scenes.length && !store.scenes.some(s => s.id === store.entryId)) issues.push('请选择启动场景');
  for (const s of store.scenes) {
    const { owner, room, source, objects } = prototypeSource(s, designs);
    const issue = (text: string) => issues.push(s.name + '：' + text);
    if (s.sourceDesignId && (!owner || !source)) issue('空间来源已失效');
    if (s.roomId && !room) issue('来源房间已失效');
    if (owner?.archived || source?.archived) issue('空间来源已归档');
    if (s.coreNodeId && !core.graphs.some(g => g.nodes.some(n => n.id === s.coreNodeId))) issue('玩法核心节点已失效');
    for (const e of s.elements) {
      if (e.sourceObjectId && !objects.some(o => o.id === e.sourceObjectId)) issue(e.name + '的空间对象已失效');
      if (e.action.kind === 'scene' && !store.scenes.some(t => t.id === e.action.targetId)) issue(e.name + '的跳转场景未指定或已失效');
      if (['show', 'hide', 'toggle'].includes(e.action.kind) && !s.elements.some(t => t.id === e.action.targetId)) issue(e.name + '的目标元素未指定或已失效');
      if (e.assetId && !art.assets.find(a => a.id === e.assetId)?.versions.find(v => v.id === e.versionId)?.files.some(f => f.id === e.fileId)) issue(e.name + '的美术文件已失效');
    }
  }
  return issues;
}
/** One fit transform is used for both visible objects and their linked interaction areas. */
export function prototypeGeometry(scene: PrototypeScene, designs: GameplayDesign[]) {
  const { source, objects } = prototypeSource(scene, designs);
  if (!source) return { objects: [], grid: null };
  const bounds = objects.map(o => { const g = objectGeometry(o, source.space), angle = g.rotation * Math.PI / 180, width = Math.abs(Math.cos(angle)) * g.width + Math.abs(Math.sin(angle)) * g.height, height = Math.abs(Math.sin(angle)) * g.width + Math.abs(Math.cos(angle)) * g.height; return { x: g.x + g.width / 2 - width / 2, y: g.y + g.height / 2 - height / 2, width, height }; });
  for (const o of objects) if (o.kind === 'zone' && o.rangeShape === 'ring') { const g = objectGeometry(o, source.space); bounds.push({ x: g.x + g.width / 2 - g.range, y: g.y + g.height / 2 - g.range, width: g.range * 2, height: g.range * 2 }); }
  if (scene.view === 'grid') bounds.push({ x: 0, y: 0, width: source.space.columns * source.space.cellSize, height: source.space.rows * source.space.cellSize });
  const left = Math.min(0, ...bounds.map(g => g.x)), top = Math.min(0, ...bounds.map(g => g.y)), right = Math.max(1, ...bounds.map(g => g.x + g.width)), bottom = Math.max(1, ...bounds.map(g => g.y + g.height));
  const scale = Math.min((scene.width - 80) / (right - left), (scene.height - 160) / (bottom - top));
  const x = (scene.width - (right - left) * scale) / 2 - left * scale, y = 80 + (scene.height - 160 - (bottom - top) * scale) / 2 - top * scale;
  return { objects: objects.map(o => { const g = objectGeometry(o, source.space); return { object: o, ...g, rangePixels: g.range * scale, innerRangePixels: g.innerRange * scale, x: x + g.x * scale, y: y + g.y * scale, width: g.width * scale, height: g.height * scale }; }), grid: scene.view === 'grid' ? { x, y, cell: source.space.cellSize * scale, rows: source.space.rows, columns: source.space.columns } : null };
}
export function removePrototypeScene(store: PrototypeDesignStore, id: string) {
  const refs = store.scenes.filter(s => s.id !== id).flatMap(s => s.elements.filter(e => e.action.kind === 'scene' && e.action.targetId === id).map(e => s.name + ' / ' + e.name));
  if (refs.length) throw new Error('场景仍被引用：' + refs.join('、') + '，请先调整跳转');
  const scenes = store.scenes.filter(s => s.id !== id); return { ...store, scenes, entryId: store.entryId === id ? scenes[0]?.id || '' : store.entryId };
}
export function removePrototypeElement(scene: PrototypeScene, id: string) {
  if (scene.elements.some(e => e.id !== id && ['show', 'hide', 'toggle'].includes(e.action.kind) && e.action.targetId === id)) throw new Error('元素仍被显隐动作引用，请先调整动作');
  return { ...scene, elements: scene.elements.filter(e => e.id !== id) };
}
export function duplicatePrototypeScene(scene: PrototypeScene): PrototypeScene {
  const id = crypto.randomUUID(), ids = new Map(scene.elements.map(e => [e.id, crypto.randomUUID()]));
  return { ...structuredClone(scene), id, name: scene.name + ' 副本', elements: scene.elements.map(e => ({ ...structuredClone(e), id: ids.get(e.id)!, action: { ...e.action, targetId: e.action.kind === 'scene' && e.action.targetId === scene.id ? id : ['show', 'hide', 'toggle'].includes(e.action.kind) ? ids.get(e.action.targetId) || e.action.targetId : e.action.targetId } })) };
}
export type PrototypeRuntime = { sceneId: string; visibility: Record<string, boolean> };
export const prototypeVisible = (runtime: PrototypeRuntime, element: PrototypeElement) => Object.prototype.hasOwnProperty.call(runtime.visibility, element.id) ? runtime.visibility[element.id] : element.visible;
export function startPrototype(store: PrototypeDesignStore, id = store.entryId): PrototypeRuntime { if (!store.scenes.some(s => s.id === id)) throw new Error('启动场景不存在'); return { sceneId: id, visibility: {} }; }
export function applyPrototypeAction(store: PrototypeDesignStore, runtime: PrototypeRuntime, elementId: string, confirmed = false): PrototypeRuntime {
  const scene = store.scenes.find(s => s.id === runtime.sceneId), element = scene?.elements.find(e => e.id === elementId);
  if (!scene || !element || !prototypeVisible(runtime, element)) throw new Error('交互元素不可用');
  const a = element.action;
  if (a.kind === 'none') return runtime;
  if (a.condition.trim() && !confirmed) throw new Error('请先确认通行条件');
  if (a.kind === 'scene') return startPrototype(store, a.targetId);
  if (a.kind === 'restart') return startPrototype(store);
  const target = scene.elements.find(e => e.id === a.targetId); if (!target) throw new Error('目标元素已失效');
  return { ...runtime, visibility: { ...runtime.visibility, [target.id]: a.kind === 'show' || a.kind === 'toggle' && !prototypeVisible(runtime, target) } };
}
/** Explicit authoring helper: creates scene references, never edits or copies gameplay objects. */
export function prototypeFromSpace(design: GameplayDesign, designs: GameplayDesign[]): PrototypeScene[] {
  const start = createPrototypeScene(design.title + ' · 开始'), rooms = spatialLayout(design.space).rooms;
  const content = (rooms.length ? rooms : [null]).map(room => ({ ...createPrototypeScene(room?.name || design.title), sourceDesignId: design.id, roomId: room?.id || '', view: room?.view || (spatialLayout(design.space).view === 'grid' ? 'grid' : 'free') } as PrototypeScene));
  const button = (text: string, targetId: string, x: number, y: number, sourceObjectId = '', condition = ''): PrototypeElement => ({ ...createPrototypeElement('button'), name: text, text, x, y, sourceObjectId, action: { kind: 'scene', targetId, condition } });
  start.elements = [{ ...createPrototypeElement('text'), name: '游戏标题', text: design.title, x: 130, y: 140, width: 700, height: 110, fontSize: 36 }, button('开始游戏', content[0].id, 390, 330)];
  for (const scene of content) {
    scene.elements.push({ ...createPrototypeElement('text'), name: '场景标题', text: scene.name, x: 40, y: 15, width: 650, height: 52 }, button('返回主界面', start.id, 740, 475));
    const connections = spatialLayout(design.space).connections.filter(c => c.from === scene.roomId || c.direction === 'both' && c.to === scene.roomId);
    connections.forEach((c, index) => { const forward = c.from === scene.roomId, target = content.find(s => s.roomId === (forward ? c.to : c.from)); if (!target) return;
      const port = forward ? c.fromObjectId : c.toObjectId, source = prototypeSource(scene, designs), validPort = source.objects.some(o => o.id === port);
      const condition = [c.condition, c.ruleId ? design.conditionRules.find(r => r.id === c.ruleId)?.name || '关联条件规则' : ''].filter(Boolean).join('；');
      scene.elements.push(button(c.name || '前往 ' + target.name, target.id, 40 + index % 4 * 220, 475 - Math.floor(index / 4) * 58, validPort ? port : '', condition));
    });
  }
  return [start, ...content];
}
export function prototypeMarkdown(store: PrototypeDesignStore) {
  return ['## 原型设计', '', '启动场景：' + (store.scenes.find(s => s.id === store.entryId)?.name || '未指定'), '点击预览用于验证界面与场景流转；条件由预览者确认。', ...store.scenes.flatMap(s => ['', '### ' + s.name, s.description, `画面：${s.width} × ${s.height}；空间来源：${s.sourceDesignId || '独立界面'}；房间：${s.roomId || '无'}；玩法核心：${s.coreNodeId || '未关联'}`, ...s.elements.map(e => `- ${e.name}：${e.text}；${prototypeKinds[e.kind]}；${prototypeActions[e.action.kind]} → ${e.action.targetId || '无'}；条件：${e.action.condition || '无'}；位置：${e.x}, ${e.y}；空间对象：${e.sourceObjectId || '无'}；美术文件：${[e.assetId, e.versionId, e.fileId].filter(Boolean).join('/') || '无'}`)])].join('\n');
}
