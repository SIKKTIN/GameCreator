import { mapStage, type DesignMap, type MapConnection, type MapDesignStore, type PortalSide, type TravelRule, type WorldPlacement, type WorldSettings } from './map-design.ts';
import type { GameplayDesign } from './gameplay';
import { objectGeometry } from './spatial-layout.ts';

export const worldTypes = { top: '俯视平面', side: '横版高度空间' } as const;
export const portalSides = { auto: '最近的房间边缘', left: '左侧', right: '右侧', top: '顶部', bottom: '底部', center: '对象中心（室内通路）' } as const;
export const travelModes = { auto: '根据空间提示，待确认', walk: '步行衔接', jump: '跳跃', climb: '攀爬 / 梯子', drop: '下落', transport: '传送 / 场景门' } as const;
export const defaultTravel = (): TravelRule => ({ forward:'auto',reverse:'auto',maxRise:4,maxGap:6,maxDrop:20 });
export function worldSettings(store:MapDesignStore):WorldSettings {
  return store.world??{perspective:store.maps.length>0&&store.maps.every(m=>m.perspective==='side')?'side':'top',unit:'世界单位',snap:1};
}
// Legacy x/y are diagram positions. Convert them to a distinct, editable world
// placement; keep the original fields and all local geometry intact. No writes.
export function withWorldLayout(store:MapDesignStore):MapDesignStore {
  const preferred=Math.max(.01,...store.maps.map(m=>Math.max(m.columns*m.cellSize/220,m.rows*m.cellSize/100)));
  const largest=Math.max(1,...store.maps.filter(m=>!m.placement).flatMap(m=>[Math.abs(m.x),Math.abs(m.y)]));
  const factor=Math.min(preferred,1e6/largest);
  return {...store,world:worldSettings(store),maps:store.maps.map(m=>m.placement?m:{...m,placement:{x:Math.round(m.x*factor*1000)/1000,y:Math.round(m.y*factor*1000)/1000,scale:1}})};
}
export function worldPlacement(store:MapDesignStore,m:DesignMap):WorldPlacement { return m.placement??withWorldLayout(store).maps.find(x=>x.id===m.id)!.placement!; }
export function worldRoom(store:MapDesignStore,m:DesignMap,designs:GameplayDesign[]) {
  const placement=worldPlacement(store,m),space=mapStage(m,designs),scale=placement.scale;
  const objects=space.objects.map(o=>{const g=objectGeometry(o,space);return {...g,id:o.id,name:o.name,color:o.color,kind:o.kind,x:placement.x+g.x*scale,y:placement.y+g.y*scale,width:g.width*scale,height:g.height*scale};});
  return {id:m.id,name:m.name,...placement,width:space.columns*space.cellSize*scale,height:space.rows*space.cellSize*scale,objects,space};
}
export function worldPortal(store:MapDesignStore,mapId:string,objectId:string,side:PortalSide='auto',designs:GameplayDesign[]) {
  const map=store.maps.find(m=>m.id===mapId);if(!map)return null;
  const room=worldRoom(store,map,designs),object=room.objects.find(o=>o.id===objectId);if(!object)return null;
  let x=object.x+object.width/2,y=object.y+object.height/2;
  if(side==='auto')side=([['left',Math.abs(x-room.x)],['right',Math.abs(x-room.x-room.width)],['top',Math.abs(y-room.y)],['bottom',Math.abs(y-room.y-room.height)]] as [PortalSide,number][]).sort((a,b)=>a[1]-b[1])[0][0];
  if(side==='left'||side==='right')x=room.x+(side==='right'?room.width:0);
  if(side==='top'||side==='bottom')y=room.y+(side==='bottom'?room.height:0);
  return {x,y,side,object,room};
}
export function connectionSpatial(store:MapDesignStore,c:MapConnection,designs:GameplayDesign[],reverse=false) {
  const a=worldPortal(store,reverse?c.to:c.from,reverse?c.toObjectId:c.fromObjectId,reverse?c.toSide:c.fromSide,designs);
  const b=worldPortal(store,reverse?c.from:c.to,reverse?c.fromObjectId:c.toObjectId,reverse?c.fromSide:c.toSide,designs);
  const settings=worldSettings(store),rule=c.travel??defaultTravel(),mode=c.kind==='transport'?'transport':reverse?rule.reverse:rule.forward;
  const fail=(reason:string)=>({a,b,dx:0,dy:0,rise:0,distance:0,direction:'未连接',description:reason,reason,mode,allowed:false});
  if(reverse&&c.direction!=='both')return fail('此通路只允许正向通行');
  if(!a||!b)return fail('地图或出入口未指定／已失效');
  const dx=b.x-a.x,dy=b.y-a.y,rise=-dy||0,distance=Math.hypot(dx,dy),tolerance=Math.max(.000001,Math.min(.05,settings.snap*.05));
  // Touching portals still have an orientation: an upward seam is not horizontal walking.
  const direction=Math.abs(dx)>tolerance||Math.abs(dy)>tolerance
    ? (Math.abs(dx)>tolerance?(dx>0?'右':'左'):'')+(Math.abs(dy)>tolerance?(dy>0?(settings.perspective==='side'?'下':'南'):(settings.perspective==='side'?'上':'北')):'')
    : ({left:'左',right:'右',top:settings.perspective==='side'?'上':'北',bottom:settings.perspective==='side'?'下':'南',center:'原位',auto:'原位'}[a.side]);
  const vertical=settings.perspective==='side'&&(Math.abs(dy)>tolerance||distance<=tolerance&&(a.side==='top'||a.side==='bottom'));
  const up=vertical&&(rise>tolerance||distance<=tolerance&&a.side==='top');
  let reason='';
  if(mode!=='transport') {
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
  return {a,b,dx,dy,rise,distance,direction,description,reason,mode,allowed:!reason};
}
export function alignWorldConnection(store:MapDesignStore,c:MapConnection,designs:GameplayDesign[]):MapDesignStore {
  if(c.from===c.to)throw new Error('同一房间的内部通路不能通过移动房间对齐');
  const {a,b}=connectionSpatial(store,c,designs);if(!a||!b)throw new Error('先选择有效的出入口');
  const normalized=withWorldLayout(store);
  return {...normalized,maps:normalized.maps.map(m=>m.id===c.to?{...m,placement:{...m.placement!,x:m.placement!.x+a.x-b.x,y:m.placement!.y+a.y-b.y}}:m)};
}
export function worldLayoutIssues(store:MapDesignStore,designs:GameplayDesign[]) {
  const issues:string[]=[],rooms=store.maps.map(m=>worldRoom(store,m,designs));
  for(let i=0;i<rooms.length;i++)for(let j=i+1;j<rooms.length;j++){const a=rooms[i],b=rooms[j];if(Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>.05&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>.05)issues.push(`${a.name} 与 ${b.name} 的世界范围重叠`);}
  for(const c of store.connections)for(const reverse of c.direction==='both'?[false,true]:[false]){const route=connectionSpatial(store,c,designs,reverse);if(route.reason)issues.push(`${c.name}${reverse?'（反向）':''}：${route.reason}`);}
  return issues;
}
