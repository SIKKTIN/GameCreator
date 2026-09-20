import { validateGameplay, emptyGameplay, type GameplayDesign, type GameplayStore } from './gameplay.ts';
import { structureMarkdown } from './gameplay-structure.ts';
import { stageMarkdown } from './gameplay-stage.ts';
import type { GameplayCategory } from './gameplay-library.ts';

export type GameplaySourceReference = { designId: string; kind: 'story'|'dataset'|'function'|'art'; targetId: string; title: string };
export type GameplayPublication = { store: GameplayStore; references: GameplaySourceReference[] };
export type GameplaySnapshot = GameplayPublication & { initialized: boolean; categoryRevision: number; versions: Record<string,number>; stamps: Record<string,{updatedAt:string;updatedBy:string}> };
export type GameplayDraft = { base: GameplaySnapshot; store: GameplayStore };
export type GameplayChange = { id:string; revision:number; design:GameplayDesign };
export type GameplayPatch = { changes:GameplayChange[]; categories?:{revision:number;items:GameplayCategory[]} };
export type GameplayLayout = Record<string,Record<string,{x:number;y:number}>>;
export const emptyGameplaySnapshot = (): GameplaySnapshot => ({store:emptyGameplay(),references:[],initialized:false,categoryRevision:0,versions:{},stamps:{}});
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])) : value;
export const equalGameplayValue = (a:unknown,b:unknown) => JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export function gameplayContent(design?: GameplayDesign) {
  if (!design) return null;
  const copy=structuredClone(design) as Partial<GameplayDesign>;delete copy.createdAt;delete copy.updatedAt;
  copy.categoryId ??= '';copy.tags ??= [];
  if (copy.space?.spatial) {
    copy.space.spatial.view='grid';
    copy.space.spatial.rooms=copy.space.spatial.rooms.map(r=>({...r,x:0,y:0,view:'grid'}));
    if (!copy.space.spatial.rooms.length && !copy.space.spatial.connections.length) delete copy.space.spatial;
  }
  return copy;
}
export const sameGameplay = (a?:GameplayDesign,b?:GameplayDesign) => equalGameplayValue(gameplayContent(a),gameplayContent(b));
export function gameplayPatch(base:GameplaySnapshot,store:GameplayStore):GameplayPatch {
  return { changes:store.designs.filter(d=>!sameGameplay(base.store.designs.find(old=>old.id===d.id),d)).map(d=>({id:d.id,revision:base.versions[d.id]??0,design:d})),
    ...(!equalGameplayValue(base.store.categories??[],store.categories??[])?{categories:{revision:base.categoryRevision,items:store.categories??[]}}:{}) };
}
export const gameplayDirty = (draft:GameplayDraft) => {const patch=gameplayPatch(draft.base,draft.store);return !!(patch.changes.length||patch.categories);};
export function applyGameplayPatch(store:GameplayStore,patch:GameplayPatch):GameplayStore {
  const designs=new Map(store.designs.map(d=>[d.id,d]));patch.changes.forEach(c=>designs.set(c.id,c.design));
  return validateGameplay({...store,designs:[...designs.values()],categories:patch.categories?.items??store.categories??[]});
}
export function reconcileGameplay(draft:GameplayDraft,remote:GameplaySnapshot):{draft:GameplayDraft;conflicts:string[]} {
  const patch=gameplayPatch(draft.base,draft.store);
  const conflicts=patch.changes.filter(c=>c.revision!==(remote.versions[c.id]??0)&&!sameGameplay(c.design,remote.store.designs.find(d=>d.id===c.id))).map(c=>c.id);
  if(patch.categories&&patch.categories.revision!==remote.categoryRevision&&!equalGameplayValue(patch.categories.items,remote.store.categories??[]))conflicts.push('$categories');
  const store=applyGameplayPatch(remote.store,{...patch,changes:patch.changes.filter(c=>!sameGameplay(c.design,remote.store.designs.find(d=>d.id===c.id)))});
  const storyIds=[...remote.store.designs,...store.designs].flatMap(d=>d.links.filter(l=>l.kind==='story').map(l=>l.targetId));
  const before=gameplayReferenceErrors(remote.store,storyIds,remote.references),after=gameplayReferenceErrors(store,storyIds,remote.references);
  if([...after.keys()].some(k=>!before.has(k)))conflicts.push(...patch.changes.map(c=>c.id),...(patch.categories?['$categories']:[]));
  if(conflicts.length)return{draft,conflicts:[...new Set(conflicts)]};
  return{draft:{base:remote,store},conflicts:[]};
}
export function withGameplayLayout(store:GameplayStore,layout:GameplayLayout):GameplayStore {
  return {...store,designs:store.designs.map(d=>!d.space.spatial?d:{...d,space:{...d.space,spatial:{...d.space.spatial,rooms:d.space.spatial.rooms.map(r=>({...r,...(layout[d.id]?.[r.id]??{})}))}}})};
}
export function validateGameplayLayout(value:unknown):GameplayLayout {
  const object=(v:unknown)=>!!v&&typeof v==='object'&&!Array.isArray(v);
  if(!object(value)||Object.values(value as object).some(rooms=>!object(rooms)||Object.values(rooms).some((p:any)=>!object(p)||!Number.isFinite(p.x)||!Number.isFinite(p.y))))throw new Error('玩法个人布局存档无效');
  return value as GameplayLayout;
}
export function normalizeGameplayPublication(value:unknown):GameplayPublication {
  const input=value as GameplayPublication,store=structuredClone(validateGameplay(input?.store));
  if(store.designs.length>500||(store.categories?.length??0)>100)throw new Error('最多共享 500 份玩法设计和 100 个分类');
  const inspect=(v:unknown,depth=0):void=>{
    if(depth>30)throw new Error('玩法内容嵌套过深');
    if(typeof v==='string'&&v.length>100000)throw new Error('玩法文本过长');
    if(Array.isArray(v)){if(v.length>2000)throw new Error('玩法列表过长');v.forEach(x=>inspect(x,depth+1));}
    else if(v&&typeof v==='object')Object.values(v).forEach(x=>inspect(x,depth+1));
  };
  inspect(store);
  for(const d of store.designs)if(d.id.length>200||d.title.length>200||new TextEncoder().encode(JSON.stringify(d)).length>2*1024*1024)throw new Error('玩法标识、名称或单份文档内容过长');
  if(!Array.isArray(input.references)||input.references.length>10000||input.references.some(r=>!r||!['story','dataset','function','art'].includes(r.kind)||[r.designId,r.targetId,r.title].some(v=>typeof v!=='string'||v.length>1000)))throw new Error('玩法来源引用无效');
  return{store,references:structuredClone(input.references)};
}
export function validateGameplayDraft(value:unknown):GameplayDraft {
  const d=value as GameplayDraft;validateGameplay(d?.store);normalizeGameplayPublication(d?.base);
  if(!d.base.versions||Object.values(d.base.versions).some(v=>!Number.isSafeInteger(v)||v<0)||!d.base.stamps||Object.values(d.base.stamps).some(v=>!v||typeof v.updatedAt!=='string'||typeof v.updatedBy!=='string')||!Number.isSafeInteger(d.base.categoryRevision)||d.base.categoryRevision<0||typeof d.base.initialized!=='boolean')throw new Error('玩法草稿版本无效');
  return d;
}
// Compare stable reference identities, so an incomplete imported draft is retained,
// while removing an object another current document uses cannot introduce a new break.
export function gameplayReferenceErrors(store:GameplayStore,storyIds:string[]=[],references:GameplaySourceReference[]=[]):Map<string,string> {
  const errors=new Map<string,string>(),byId=new Map(store.designs.map(d=>[d.id,d])),categories=new Set(store.categories?.map(c=>c.id));
  for(const d of store.designs){
    const check=(path:string,id:string|undefined,valid:boolean,label:string)=>{if(id&&!valid)errors.set(JSON.stringify([d.id,path,id]),`${d.title}：${label}`);};
    check('category',d.categoryId,categories.has(d.categoryId??''),'所属分类已不存在');
    d.dependencies.forEach(r=>check('dependency:'+r.id,r.targetId,byId.has(r.targetId),'关联玩法已不存在'));
    const states=new Set(d.stateFlow.states.map(s=>s.id));check('initial',d.stateFlow.initialStateId,states.has(d.stateFlow.initialStateId),'起始状态已不存在');
    d.stateFlow.transitions.forEach(t=>{check('from:'+t.id,t.fromId,states.has(t.fromId),'转移起点已不存在');check('to:'+t.id,t.toId,states.has(t.toId),'转移终点已不存在');});
    const a=d.space.spatial,rooms=new Map(a?.rooms.map(r=>[r.id,r]));
    d.space.objects.forEach(o=>check('room:'+o.id,o.roomId,rooms.has(o.roomId??''),'对象所属房间已不存在'));
    a?.rooms.forEach(r=>check('room-source:'+r.id,r.sourceDesignId,byId.has(r.sourceDesignId),'房间来源玩法已不存在'));
    a?.connections.forEach(c=>{
      check('connection-from:'+c.id,c.from,rooms.has(c.from),'房间连接起点已不存在');check('connection-to:'+c.id,c.to,rooms.has(c.to),'房间连接终点已不存在');
      check('connection-rule:'+c.id,c.ruleId,d.conditionRules.some(r=>r.id===c.ruleId),'房间连接引用的条件规则已不存在');
      for(const [side,roomId,objectId]of[['from',c.from,c.fromObjectId],['to',c.to,c.toObjectId]]){const room=rooms.get(roomId),owner=room?.sourceDesignId?byId.get(room.sourceDesignId):d;
        check('connection-object:'+c.id+':'+side,objectId,!!owner?.space.objects.some(o=>o.id===objectId),'房间连接引用的空间对象已不存在');}
    });
    const owner=d.timeline.spaceOwnerId?byId.get(d.timeline.spaceOwnerId):d;
    check('space-owner',d.timeline.spaceOwnerId,!!owner,'时间轴空间来源已不存在');
    d.timeline.events.forEach(e=>{check('event-track:'+e.id,e.trackId,d.timeline.tracks.some(t=>t.id===e.trackId),'事件轨道已不存在');check('event-object:'+e.id,e.objectId,!!owner?.space.objects.some(o=>o.id===e.objectId),'时间事件引用的空间对象已不存在');});
    d.links.forEach(l=>check('link:'+l.kind,l.targetId,l.kind==='story'?storyIds.includes(l.targetId)||references.some(r=>r.kind==='story'&&r.targetId===l.targetId):references.some(r=>r.kind==='dataset'&&r.targetId===l.targetId),'关联内容不存在或尚未接入协作'));
  }
  return errors;
}
export function gameplaySections(d:GameplayDesign,store:GameplayStore):{label:string;text:string}[] {
  const structure=structureMarkdown(d,store.designs),stage=stageMarkdown(d,store.designs);
  return[
    {label:'设计说明',text:[d.title,`分类：${store.categories?.find(c=>c.id===d.categoryId)?.name??'未分类'}；标签：${d.tags?.join('、')??''}`,`${d.status}${d.archived?' · 已归档':''}`,d.summary,d.experience,d.rules,`胜利：${d.winCondition}；失败：${d.loseCondition}`,...d.loop.map((x,i)=>`${i+1}. ${x.text}`),...d.prototype.map(x=>`${x.done?'已完成':'未完成'}：${x.text}`),d.deferred,...d.checks.map(c=>[c.question,c.steps,c.expected,c.actual,c.result].join('\n')),...d.links.map(l=>`${l.kind==='story'?'故事文档':'配置表'}：${l.targetId}`)].join('\n')},
    {label:'玩法关联',text:structure.split('#### 条件规则')[0]},
    {label:'条件规则',text:structure.split('#### 条件规则')[1]?.split('#### 状态流程')[0]??''},
    {label:'状态流程',text:structure.split('#### 状态流程')[1]??''},
    {label:'空间布局',text:stage.split('#### 时间轴')[0]},
    {label:'时间轴',text:stage.split('#### 时间轴')[1]??''},
  ];
}
