import { checkPhysicalPassage, type PassageCheck } from './map-navigation.ts';
import { connectionEndpoints, mapStage, type DesignMap, type MapConnection, type MapDesignStore, type PortalSide, type TravelRule, type WorldPlacement, type WorldSettings } from './map-design.ts';
import type { GameplayDesign } from './gameplay';
import { objectGeometry } from './spatial-layout.ts';

export const worldTypes = { top: '俯视平面', side: '横版高度空间' } as const;
export const portalSides = { auto: '未确定（请选择朝向）', left: '左侧', right: '右侧', top: '顶部', bottom: '底部', center: '对象中心（室内 / 传送）' } as const;
export const travelModes = { auto: '根据空间提示，待确认', walk: '步行衔接', jump: '跳跃', climb: '攀爬 / 梯子', drop: '下落', transport: '传送 / 场景门' } as const;
export const defaultTravel = (): TravelRule => ({ forward:'auto',reverse:'auto',maxRise:4,maxGap:6,maxDrop:20 });
export function worldSettings(store:MapDesignStore):WorldSettings {
  return store.world??{perspective:store.maps.length>0&&store.maps.every(m=>m.perspective==='side')?'side':'top',unit:'世界单位',snap:1};
}
// Legacy x/y are diagram positions. Convert them to a distinct, editable world
// placement; keep the original fields and all local geometry intact. No writes.
function withWorldPlacements(store:MapDesignStore):MapDesignStore {
  const preferred=Math.max(.01,...store.maps.map(m=>Math.max(m.columns*m.cellSize/220,m.rows*m.cellSize/100)));
  const largest=Math.max(1,...store.maps.filter(m=>!m.placement).flatMap(m=>[Math.abs(m.x),Math.abs(m.y)]));
  const factor=Math.min(preferred,1e6/largest);
  return {...store,world:worldSettings(store),maps:store.maps.map(m=>m.placement?m:{...m,placement:{x:Math.round(m.x*factor*1000)/1000,y:Math.round(m.y*factor*1000)/1000,scale:1}})};
}
export function withWorldLayout(store:MapDesignStore,designs:GameplayDesign[]=[]):MapDesignStore {
  const normalized=withWorldPlacements(store);
  // Resolve legacy/missing sides once, before any room movement. Explicit sides
  // are never changed by moving a room, switching perspective or reloading.
  return {...normalized,connections:normalized.connections.map(c=>({...c,...resolvedPortalSides(normalized,c,designs)}))};
}
export function worldPlacement(store:MapDesignStore,m:DesignMap):WorldPlacement { return m.placement??withWorldPlacements(store).maps.find(x=>x.id===m.id)!.placement!; }
export function worldRoom(store:MapDesignStore,m:DesignMap,designs:GameplayDesign[]) {
  const placement=worldPlacement(store,m),space=mapStage(m,designs),scale=placement.scale;
  const objects=space.objects.map(o=>{const g=objectGeometry(o,space);return {...g,id:o.id,name:o.name,color:o.color,kind:o.kind,collision:m.surfaces?.find(v=>v.objectId===o.id)?.kind??(o.kind==='obstacle'?'solid':'decoration'),x:placement.x+g.x*scale,y:placement.y+g.y*scale,width:g.width*scale,height:g.height*scale};});
  return {id:m.id,name:m.name,...placement,width:space.columns*space.cellSize*scale,height:space.rows*space.cellSize*scale,objects,space};
}
const oppositeSide:Record<PortalSide,PortalSide>={left:'right',right:'left',top:'bottom',bottom:'top',center:'center',auto:'auto'};
export const opposingPortalSides=(from:PortalSide,to:PortalSide)=>from!=='auto'&&from!=='center'&&oppositeSide[from]===to;
const hasSide=(side:PortalSide|undefined):side is Exclude<PortalSide,'auto'>=>!!side&&side!=='auto';
const transportOnly=(c:MapConnection)=>c.kind==='transport'||c.travel?.forward==='transport'&&(c.direction==='one'||c.travel.reverse==='transport');
export function suggestedPortalSides(store:MapDesignStore,c:MapConnection,designs:GameplayDesign[]) {
  const from=store.maps.find(m=>m.id===c.from),to=store.maps.find(m=>m.id===c.to);
  if(!from||!to)return null;
  if(from.id===to.id||transportOnly(c))return {fromSide:'center',toSide:'center'} as const;
  const a=worldRoom(store,from,designs),b=worldRoom(store,to,designs);
  const dx=b.x+b.width/2-a.x-a.width/2,dy=b.y+b.height/2-a.y-a.height/2;
  if(Math.abs(dx)<1e-9&&Math.abs(dy)<1e-9)return null;
  const separatedX=b.x>=a.x+a.width||a.x>=b.x+b.width,separatedY=b.y>=a.y+a.height||a.y>=b.y+b.height;
  // Prefer the separated axis when the rooms overlap on the other axis. For
  // diagonal layouts, compare relative separation, accounting for room sizes.
  const horizontal=separatedX!==separatedY?separatedX:Math.abs(dx)/(a.width+b.width)>=Math.abs(dy)/(a.height+b.height);
  const fromSide:PortalSide=horizontal?(dx>=0?'right':'left'):(dy>=0?'bottom':'top');
  return {fromSide,toSide:oppositeSide[fromSide]};
}
function resolvedPortalSides(store:MapDesignStore,c:MapConnection,designs:GameplayDesign[]) {
  if(hasSide(c.fromSide)&&hasSide(c.toSide))return {fromSide:c.fromSide,toSide:c.toSide};
  // A manually set endpoint takes precedence over layout suggestions.
  const suggestion=hasSide(c.fromSide)?{fromSide:c.fromSide,toSide:oppositeSide[c.fromSide]}
    :hasSide(c.toSide)?{fromSide:oppositeSide[c.toSide],toSide:c.toSide}:suggestedPortalSides(store,c,designs);
  return {fromSide:c.fromSide&&c.fromSide!=='auto'?c.fromSide:suggestion?.fromSide??'auto',toSide:c.toSide&&c.toSide!=='auto'?c.toSide:suggestion?.toSide??'auto'};
}
export function worldPortal(store:MapDesignStore,mapId:string,objectId:string,side:PortalSide='auto',designs:GameplayDesign[],openingId?:string) {
  const map=store.maps.find(m=>m.id===mapId);if(!map)return null;
  const room=worldRoom(store,map,designs),object=room.objects.find(o=>o.id===objectId);if(!object)return null;
  const opening=map.openings?.find(o=>o.id===openingId);if(openingId&&!opening)return null;if(opening)side=opening.side;
  let x=opening?room.x+opening.offset*room.scale:object.x+object.width/2,y=opening?room.y+opening.offset*room.scale:object.y+object.height/2;
  if(side==='left'||side==='right')x=room.x+(side==='right'?room.width:0);
  if(side==='top'||side==='bottom')y=room.y+(side==='bottom'?room.height:0);
  return {x,y,side,object,room,opening,openingWidth:(opening?.width??0)*room.scale};
}
export function connectionGeometry(store:MapDesignStore,c:MapConnection,designs:GameplayDesign[],reverse=false) {
  const sides=resolvedPortalSides(store,c,designs),ends=connectionEndpoints(c,reverse);
  const a=worldPortal(store,ends.from,ends.fromObjectId,reverse?sides.toSide:sides.fromSide,designs,ends.fromOpeningId);
  const b=worldPortal(store,ends.to,ends.toObjectId,reverse?sides.fromSide:sides.toSide,designs,ends.toOpeningId);
  const settings=worldSettings(store),rule={...(c.travel??defaultTravel()),...(reverse?c.reverseLimits:{})},mode=c.kind==='transport'?'transport':reverse?rule.reverse:rule.forward;
  const fail=(reason:string)=>({a,b,dx:0,dy:0,rise:0,distance:0,direction:'未连接',description:reason,reason,orientationReason:'',mode,allowed:false});
  if(reverse&&c.direction!=='both')return fail('此通路只允许正向通行');
  if(!a||!b)return fail('地图或出入口未指定／已失效');
  const dx=b.x-a.x,dy=b.y-a.y,rise=-dy||0,distance=Math.hypot(dx,dy),tolerance=Math.max(.000001,Math.min(.05,settings.snap*.05));
  // Touching portals still have an orientation: an upward seam is not horizontal walking.
  const direction=Math.abs(dx)>tolerance||Math.abs(dy)>tolerance
    ? (Math.abs(dx)>tolerance?(dx>0?'右':'左'):'')+(Math.abs(dy)>tolerance?(dy>0?(settings.perspective==='side'?'下':'南'):(settings.perspective==='side'?'上':'北')):'')
    : ({left:'左',right:'右',top:settings.perspective==='side'?'上':'北',bottom:settings.perspective==='side'?'下':'南',center:'原位',auto:'原位'}[a.side]);
  const vertical=settings.perspective==='side'&&(Math.abs(dy)>tolerance||distance<=tolerance&&(a.side==='top'||a.side==='bottom'));
  const up=vertical&&(rise>tolerance||distance<=tolerance&&a.side==='top');
  let orientationReason='';
  if(mode!=='transport'&&c.from!==c.to) {
    if(a.side==='auto'||b.side==='auto')orientationReason='出入口朝向未确定；请指定两端朝向，或按当前布局设置朝向';
    else if(a.side==='center'||b.side==='center')orientationReason='跨房间的普通通路需要边缘出入口；室内门跳转请明确设置传送 / 场景门';
    else if(oppositeSide[a.side]!==b.side)orientationReason=`出入口朝向不匹配：${portalSides[a.side]} → ${portalSides[b.side]}；普通通路需要左右或上下相对的两端`;
    else {
      const gap=a.side==='right'?b.room.x-a.room.x-a.room.width:a.side==='left'?a.room.x-b.room.x-b.room.width:a.side==='bottom'?b.room.y-a.room.y-a.room.height:a.room.y-b.room.y-b.room.height;
      if(gap < -tolerance)orientationReason='房间位置与固定出入口朝向冲突；通路会穿过房间，请移动房间或重新设置朝向';
      else if([a,b].some(p=>(p.side==='left'||p.side==='right')?(p.y<p.room.y-tolerance||p.y>p.room.y+p.room.height+tolerance):(p.x<p.room.x-tolerance||p.x>p.room.x+p.room.width+tolerance)))orientationReason='出入口位置超出所选房间边缘；请调整对应对象在地图内的位置';
    }
  }
  let reason=orientationReason;
  if(mode!=='transport'&&!reason) {
    if(settings.perspective==='top') { if(distance>tolerance)reason='出入口未对齐；请调整房间位置、补齐通道，或设置传送'; }
    else if(mode==='auto') {
      if(vertical)reason=up?'向上通路需要指定跳跃或攀爬方式':'向下通路需要指定下落、跳跃或攀爬方式';
      else if(distance>tolerance)reason='水平缺口需要指定跳跃方式或对齐出入口';
    } else if(mode==='walk'&&(vertical||distance>tolerance))reason='步行需要同高度、相接的出入口';
    else if(mode==='drop'&&(up||Math.abs(dx)>rule.maxGap+tolerance||-rise>rule.maxDrop+tolerance))reason=up?'下落不能到达上方入口':'超出设定的下落高度或水平跨度';
    else if((mode==='jump'||mode==='climb')&&(rise>rule.maxRise+tolerance||-rise>rule.maxDrop+tolerance||Math.abs(dx)>rule.maxGap+tolerance))reason='超出设定的上升高度、下落高度或水平跨度';
  }
  const n=(v:number)=>Number(v.toFixed(2));
  const description=`向${direction} · ${settings.perspective==='side'?`高差 ${rise>=0?'+':''}${n(rise)}`:`南北差 ${n(dy)}`} · 水平差 ${n(dx)} ${settings.unit} · ${travelModes[mode]}`;
  return {a,b,dx,dy,rise,distance,direction,description,reason,orientationReason,mode,allowed:!reason};
}
const navigationCache=new Map<string,PassageCheck>();
export function connectionSpatial(store:MapDesignStore,c:MapConnection,designs:GameplayDesign[],reverse=false,startObjectId?:string) {
  const route=connectionGeometry(store,c,designs,reverse);
  const crossed:string[]=[];
  if(route.a?.opening&&route.b?.opening&&route.mode!=='transport'&&route.distance>.00001){
    const a=route.a,b=route.b,vertical=a.side==='top'||a.side==='bottom',span=Math.min(a.openingWidth,b.openingWidth);
    const corridor={x:vertical?a.x-span/2:Math.min(a.x,b.x),y:vertical?Math.min(a.y,b.y):a.y-span/2,width:vertical?span:Math.abs(a.x-b.x),height:vertical?Math.abs(a.y-b.y):span};
    for(const m of store.maps.filter(m=>m.id!==c.from&&m.id!==c.to)){const r=worldRoom(store,m,designs);if(Math.min(corridor.x+corridor.width,r.x+r.width)-Math.max(corridor.x,r.x)>.00001&&Math.min(corridor.y+corridor.height,r.y+r.height)-Math.max(corridor.y,r.y)>.00001)crossed.push(r.name);}
  }
  // Cache by geometry and rules, not object identity: live source edits and
  // mutable callers must invalidate the result just as immutable UI edits do.
  const fingerprint=(p:typeof route.a)=>p&&[p.side,p.opening,p.openingWidth,p.object.id,p.room.id,p.room.x,p.room.y,p.room.width,p.room.height,p.room.scale,p.room.objects.map(o=>[o.id,o.name,o.x,o.y,o.width,o.height,o.rotation,o.shape,o.collision])];
  const key=JSON.stringify([c,worldSettings(store),route.reason,crossed,fingerprint(route.a),fingerprint(route.b),reverse,startObjectId]);
  let check=navigationCache.get(key);
  if(!check){check=!route.a||!route.b||route.orientationReason?{state:'blocked',reason:route.reason,path:[],blockers:[]}:
    route.mode!=='transport'&&(!route.a.opening||!route.b.opening)?{state:'pending',reason:'待完善：请选择两端物理开口；室内到达点不能代替开口',path:[],blockers:[]}:
    route.reason?{state:'blocked',reason:route.reason,path:[],blockers:[]}:crossed.length?{state:'blocked',reason:'连接段穿过其他房间：'+crossed.join('、')+'；请显式连接中间地图',path:[],blockers:[]}:checkPhysicalPassage(store,c,reverse,route.a,route.b,route.mode,{...(c.travel??defaultTravel()),...(reverse?c.reverseLimits:{})},startObjectId);
    if(navigationCache.size>=128)navigationCache.delete(navigationCache.keys().next().value!);navigationCache.set(key,check);
  }
  return {...route,...check,allowed:check.state==='ready'};
}
export function alignWorldConnection(store:MapDesignStore,c:MapConnection,designs:GameplayDesign[]):MapDesignStore {
  if(c.from===c.to)throw new Error('同一房间的内部通路不能通过移动房间对齐');
  const {a,b}=connectionGeometry(store,c,designs);if(!a||!b)throw new Error('先选择有效的出入口');
  if(!opposingPortalSides(a.side,b.side))throw new Error('先设置左右或上下相对的边缘出入口，再移动房间对齐');
  const normalized=withWorldLayout(store,designs);
  return {...normalized,maps:normalized.maps.map(m=>m.id===c.to?{...m,placement:{...m.placement!,x:m.placement!.x+a.x-b.x,y:m.placement!.y+a.y-b.y}}:m)};
}
export function worldLayoutIssues(store:MapDesignStore,designs:GameplayDesign[]) {
  const issues:string[]=[],rooms=store.maps.map(m=>worldRoom(store,m,designs));
  for(let i=0;i<rooms.length;i++)for(let j=i+1;j<rooms.length;j++){const a=rooms[i],b=rooms[j];if(Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>.05&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>.05)issues.push(`${a.name} 与 ${b.name} 的世界范围重叠`);}
  for(const c of store.connections)for(const reverse of c.direction==='both'?[false,true]:[false]){const route=connectionSpatial(store,c,designs,reverse);if(route.reason)issues.push(`${c.name}${reverse?'（反向）':''}：${route.reason}`);}
  return issues;
}
