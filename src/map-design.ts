import type { GameplayDesign } from './gameplay';
import type { StageLayout, StageObject } from './gameplay-stage';
import { objectGeometry, roomObjects, roomSource, spatialLayout } from './spatial-layout.ts';

export const mapKinds = { terrain: '地形', obstacle: '障碍', decoration: '装饰', npc: '人物', building: '建筑', resource: '资源', enemy: '敌人', task: '任务点', portal: '出入口', note: '标记' } as const;
export type MapReference = { kind: 'gameplay' | 'task' | 'story' | 'character' | 'asset' | 'prototype'; targetId: string };
export type MapLayer = { id: string; name: string; visible: boolean; locked: boolean };
export type MapObject = { id: string; name: string; kind: keyof typeof mapKinds; layerId: string; x: number; y: number; width: number; height: number; color: 'green'|'violet'|'blue'|'amber'|'red'; notes: string; references: MapReference[] };
export type DesignMap = { id: string; name: string; region: string; description: string; perspective: 'side'|'top'; view: 'grid'|'free'; x: number; y: number; rows: number; columns: number; cellSize: number; unit: string; sourceDesignId: string; roomId: string; layers: MapLayer[]; objects: MapObject[]; sourceVisible: boolean; sourceLocked: boolean };
export type MapConnection = { id: string; name: string; from: string; to: string; fromObjectId: string; toObjectId: string; direction: 'one'|'both'; kind: 'passage'|'shortcut'|'door'|'transport'; condition: string };
export type MapDesignStore = { schema: 1; enabled: boolean; maps: DesignMap[]; connections: MapConnection[] };
export const emptyMapDesign = (): MapDesignStore => ({ schema: 1, enabled: false, maps: [], connections: [] });
export function createDesignMap(name = '新地图'): DesignMap {
  return { id: crypto.randomUUID(), name, region: '', description: '', perspective: 'top', view: 'grid', x: 0, y: 0, rows: 12, columns: 20, cellSize: 1, unit: '格', sourceDesignId: '', roomId: '', sourceVisible: true, sourceLocked: true, layers: ['地形','障碍','装饰','交互'].map(name => ({id:crypto.randomUUID(),name,visible:true,locked:false})), objects: [] };
}
// Self-contained so the desktop import boundary can use the exact same validator.
// Missing references are repairable drafts; invalid structure must never overwrite an archive.
export function validateMapDesign(value: unknown): MapDesignStore {
  const fail = (): never => { throw new Error('地图设计存档格式无效'); };
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const strings = (v: Record<string, unknown>, keys: string[]) => keys.every(k => typeof v[k] === 'string' && (v[k] as string).length <= 100000);
  const num = (v: unknown, min = -1e6, max = 1e6): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const ids = new Set<string>();
  const unique = (v: Record<string,unknown>) => { if(typeof v.id !== 'string' || !v.id.trim() || ids.has(v.id)) fail(); ids.add(v.id as string); };
  if (!record(value) || value.schema !== 1 || typeof value.enabled !== 'boolean' || !Array.isArray(value.maps) || value.maps.length > 100 || !Array.isArray(value.connections) || value.connections.length > 500) return fail();
  for (const m of value.maps) {
    if (!record(m) || !strings(m,['name','region','description','unit','sourceDesignId','roomId']) || !['side','top'].includes(m.perspective as string) || !['grid','free'].includes(m.view as string) || !num(m.x) || !num(m.y) || !num(m.rows,1,30) || !Number.isInteger(m.rows) || !num(m.columns,1,40) || !Number.isInteger(m.columns) || !num(m.cellSize,.001,10000) || typeof m.sourceVisible !== 'boolean' || typeof m.sourceLocked !== 'boolean' || !Array.isArray(m.layers) || m.layers.length < 1 || m.layers.length > 30 || !Array.isArray(m.objects) || m.objects.length > 300) return fail();
    unique(m);
    for(const l of m.layers) { if(!record(l) || !strings(l,['name']) || typeof l.visible !== 'boolean' || typeof l.locked !== 'boolean') return fail(); unique(l); }
    for(const o of m.objects) {
      if(!record(o) || !strings(o,['name','layerId','notes']) || !['terrain','obstacle','decoration','npc','building','resource','enemy','task','portal','note'].includes(o.kind as string) || !['green','violet','blue','amber','red'].includes(o.color as string) || !num(o.x) || !num(o.y) || !num(o.width,.001) || !num(o.height,.001) || !Array.isArray(o.references) || o.references.length > 100) return fail();
      unique(o);
      for(const r of o.references) if(!record(r) || !strings(r,['targetId']) || !['gameplay','task','story','character','asset','prototype'].includes(r.kind as string)) return fail();
    }
  }
  for(const c of value.connections) { if(!record(c) || !strings(c,['name','from','to','fromObjectId','toObjectId','condition']) || !['one','both'].includes(c.direction as string) || !['passage','shortcut','door','transport'].includes(c.kind as string)) return fail(); unique(c); }
  return value as MapDesignStore;
}
export function readMapDesign(storage: Pick<Storage,'getItem'>, key: string) { const raw=storage.getItem(key); return {raw,store:raw===null?emptyMapDesign():validateMapDesign(JSON.parse(raw))}; }
export function writeMapDesign(storage: Pick<Storage,'getItem'|'setItem'>, key: string, expected: string|null, store: MapDesignStore) { const raw=JSON.stringify(validateMapDesign(store)); if(storage.getItem(key)!==expected) throw new Error('其他窗口已修改地图设计，请备份草稿后重新读取'); storage.setItem(key,raw); return raw; }
export function mapSource(m: DesignMap, designs: GameplayDesign[]) {
  const owner=designs.find(d=>d.id===m.sourceDesignId), room=owner&&spatialLayout(owner.space).rooms.find(r=>r.id===m.roomId);
  const source=owner&&(m.roomId?(room?roomSource(room,owner,designs):undefined):owner);
  return { owner, room, source, objects: source ? room&&owner?roomObjects(room,owner,designs):source.space.objects.filter(o=>!o.roomId) : [] };
}
export function mapObjectStage(o: MapObject): StageObject {
  return {id:o.id,name:o.name,kind:o.kind==='portal'?'spawn':o.kind==='obstacle'||o.kind==='terrain'||o.kind==='building'?'obstacle':o.kind==='npc'||o.kind==='enemy'?'actor':o.kind==='task'?'goal':'note',color:o.color,anchor:'cell',row:1,column:1,width:1,height:1,direction:'right',rangeShape:'none',range:0,notes:o.notes,geometry:{x:o.x,y:o.y,width:o.width,height:o.height,rotation:0,shape:'rect',range:0,innerRange:0,arc:90}};
}
export function mapStage(m: DesignMap, designs: GameplayDesign[], visibleOnly=false): StageLayout {
  const {source,objects}=mapSource(m,designs);
  const inherited=(!visibleOnly||m.sourceVisible)?objects.map(o=>({...o,roomId:'',geometry:objectGeometry(o,source!.space)})):[];
  const local=m.layers.flatMap(l=>(!visibleOnly||l.visible)?m.objects.filter(o=>o.layerId===l.id).map(mapObjectStage):[]);
  return { rows:source?.space.rows??m.rows, columns:source?.space.columns??m.columns, cellSize:source?.space.cellSize??m.cellSize, unit:source?.space.unit??m.unit, description:m.description, objects:[...inherited,...local] };
}
export type MapTargets = Record<MapReference['kind'], {id:string;name:string}[]>;
export function mapIssues(store: MapDesignStore, designs: GameplayDesign[], targets?: MapTargets): string[] {
  const issues:string[]=[];
  for(const m of store.maps) {
    const {source}=mapSource(m,designs);
    if(!m.name.trim()) issues.push('有地图尚未命名');
    if(m.sourceDesignId&&!source) issues.push(m.name+'：来源空间已失效');
    if(source?.archived) issues.push(m.name+'：来源玩法已归档');
    for(const o of m.objects) { if(!m.layers.some(l=>l.id===o.layerId)) issues.push(m.name+' / '+o.name+'：所属图层已失效'); for(const r of o.references) if(targets&&!targets[r.kind].some(t=>t.id===r.targetId)) issues.push(m.name+' / '+o.name+'：关联内容已失效'); }
  }
  for(const c of store.connections) for(const side of ['from','to'] as const) {
    const m=store.maps.find(m=>m.id===c[side]), id=c[side==='from'?'fromObjectId':'toObjectId'];
    if(!m) issues.push(c.name+'：连接地图未指定或已失效'); else if(!id||!mapStage(m,designs).objects.some(o=>o.id===id)) issues.push(c.name+'：出入口未指定或已失效');
  }
  return issues;
}
export function removeDesignMap(store: MapDesignStore, id: string, prototypeRefs: string[]=[]) {
  if(store.connections.some(c=>c.from===id||c.to===id)||prototypeRefs.length) throw new Error('地图仍被连接或原型引用，请先解除引用');
  return {...store,maps:store.maps.filter(m=>m.id!==id)};
}
export function removeMapObject(store: MapDesignStore, mapId:string, id:string, prototypeRefs:string[]=[]) {
  if(store.connections.some(c=>c.from===mapId&&c.fromObjectId===id||c.to===mapId&&c.toObjectId===id)||prototypeRefs.length) throw new Error('对象仍被出入口连接或原型引用，请先解除引用');
  return {...store,maps:store.maps.map(m=>m.id===mapId?{...m,objects:m.objects.filter(o=>o.id!==id)}:m)};
}
export function mapObjectReferences(store:MapDesignStore, designs:GameplayDesign[], designId:string, objectId:string) {
  return store.maps.filter(m=>mapSource(m,designs).source?.id===designId).flatMap(m=>store.connections.filter(c=>c.from===m.id&&c.fromObjectId===objectId||c.to===m.id&&c.toObjectId===objectId).map(c=>'地图设计 / '+m.name+' / '+c.name));
}
export function mapMarkdown(store:MapDesignStore, designs:GameplayDesign[]) {
  if(!store.enabled) return '';
  const lines=['## 地图设计',''];
  for(const m of store.maps) { lines.push('### '+m.name,`区域：${m.region}；视角：${m.perspective==='side'?'横版':'俯视'}；来源玩法：${m.sourceDesignId||'独立地图'}；来源房间：${m.roomId||'无'}`,m.description); for(const l of m.layers) lines.push(`- 图层：${l.name}；${l.visible?'显示':'隐藏'}；${l.locked?'锁定':'可编辑'}`); for(const o of mapStage(m,designs).objects) { const g=objectGeometry(o,mapStage(m,designs)); lines.push(`- ${o.name} [${o.id}]：(${g.x}, ${g.y})，${g.width} × ${g.height}；${o.notes}`); } for(const o of m.objects) for(const r of o.references) lines.push(`- ${o.name} 关联 ${r.kind}：${r.targetId}`); }
  for(const c of store.connections) lines.push(`- ${store.maps.find(m=>m.id===c.from)?.name||c.from} ${c.direction==='both'?'↔':'→'} ${store.maps.find(m=>m.id===c.to)?.name||c.to}：${c.name}；出入口 ${c.fromObjectId} → ${c.toObjectId}；通行条件：${c.condition||'无'}`);
  return lines.join('\n');
}
