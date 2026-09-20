import type { GameplayDesign } from './gameplay';
import { mapStage, type MapConnection, type MapDesignStore, type MapOpening } from './map-design.ts';
import { defaultTravel, worldPlacement, worldRoom, withWorldLayout } from './map-world.ts';
import type { SpatialGeometry } from './spatial-layout';

export function mergePassages(store:MapDesignStore,id:string,returnId:string):MapDesignStore {
  const a=store.connections.find(c=>c.id===id),b=store.connections.find(c=>c.id===returnId);
  if(!a||!b||a.id===b.id||a.direction!=='one'||b.direction!=='one'||a.from!==b.to||a.to!==b.from||a.kind!==b.kind||a.structure&&b.structure&&a.structure!==b.structure)throw new Error('请选择相同类型、相反方向的两条单向通路');
  if(a.fromOpeningId&&b.toOpeningId&&a.fromOpeningId!==b.toOpeningId||a.toOpeningId&&b.fromOpeningId&&a.toOpeningId!==b.fromOpeningId)throw new Error('两条通路使用不同的物理开口，不能合并');
  const rule=a.travel??defaultTravel(),back=b.travel??defaultTravel();
  const merged:MapConnection={...a,direction:'both',fromOpeningId:a.fromOpeningId??b.toOpeningId,toOpeningId:a.toOpeningId??b.fromOpeningId,
    reverseFromObjectId:b.fromObjectId,reverseToObjectId:b.toObjectId,reverseCondition:b.condition,travel:{...rule,reverse:back.forward},reverseLimits:{maxRise:back.maxRise,maxGap:back.maxGap,maxDrop:back.maxDrop},
    aliases:[...(a.aliases??[]),{id:b.id,reverse:true},...(b.aliases??[]).map(v=>({...v,reverse:!v.reverse}))]};
  return {...store,connections:store.connections.filter(c=>c.id!==b.id).map(c=>c.id===a.id?merged:c)};
}

// Only unambiguous exact endpoint reversals can be consolidated automatically.
// Distinct doors/shortcuts require the user's explicit choice in the inspector.
export function consolidatePassages(store:MapDesignStore):MapDesignStore {
  let next=store;
  for(const c of store.connections){if(c.direction!=='one'||!next.connections.some(x=>x.id===c.id))continue;
    const peers=next.connections.filter(b=>b.id!==c.id&&b.direction==='one'&&b.from===c.to&&b.to===c.from&&b.kind===c.kind&&b.fromObjectId===c.toObjectId&&b.toObjectId===c.fromObjectId&&(!c.fromOpeningId||!b.toOpeningId||c.fromOpeningId===b.toOpeningId)&&(!c.toOpeningId||!b.fromOpeningId||c.toOpeningId===b.fromOpeningId));
    const parallel=next.connections.filter(v=>v.direction==='one'&&v.from===c.from&&v.to===c.to&&v.kind===c.kind&&v.fromObjectId===c.fromObjectId&&v.toObjectId===c.toObjectId);
    if(peers.length===1&&parallel.length===1&&(!c.structure||!peers[0].structure||c.structure===peers[0].structure))next=mergePassages(next,c.id,peers[0].id);
  }return next;
}

export function createPassageOpenings(store:MapDesignStore,c:MapConnection,designs:GameplayDesign[]):MapDesignStore {
  let next=withWorldLayout(store,designs);const current=next.connections.find(v=>v.id===c.id)!;
  const patch:Partial<MapConnection>={};
  for(const end of ['from','to'] as const){
    const m=next.maps.find(m=>m.id===c[end]);if(!m)throw new Error('先指定两端地图');
    const field=end==='from'?'fromOpeningId':'toOpeningId',side=current[end==='from'?'fromSide':'toSide'];
    if(m.openings?.some(o=>o.id===c[field]))continue;
    if(!side||side==='auto'||side==='center')throw new Error('先指定左、右、顶部或底部朝向');
    const room=worldRoom(next,m,designs),extent=(side==='top'||side==='bottom'?room.width:room.height)/room.scale;
    const opening:MapOpening={id:crypto.randomUUID(),name:c.name+' · '+(end==='from'?'起点开口':'终点开口'),side,offset:extent/2,width:Math.min(2,extent)};
    next={...next,maps:next.maps.map(v=>v.id===m.id?{...v,openings:[...(v.openings??[]),opening]}:v)};patch[field]=opening.id;
  }
  return {...next,connections:next.connections.map(v=>v.id===c.id?{...v,...patch}:v)};
}

export function alignPassageOpening(store:MapDesignStore,c:MapConnection,designs:GameplayDesign[]):MapDesignStore {
  const a=store.maps.find(m=>m.id===c.from),b=store.maps.find(m=>m.id===c.to),from=a?.openings?.find(o=>o.id===c.fromOpeningId),to=b?.openings?.find(o=>o.id===c.toOpeningId);
  if(!a||!b||!from||!to)throw new Error('先创建并选择两端物理开口');
  const horizontal=from.side==='left'||from.side==='right';
  if(!({left:'right',right:'left',top:'bottom',bottom:'top'}[from.side]===to.side))throw new Error('开口需要左右或上下相对');
  const ap=worldPlacement(store,a),bp=worldPlacement(store,b),offset=((horizontal?ap.y-bp.y:ap.x-bp.x)+from.offset*ap.scale)/bp.scale;
  const stage=mapStage(b,designs),extent=(horizontal?stage.rows:stage.columns)*stage.cellSize;
  if(offset-to.width/2<0||offset+to.width/2>extent)throw new Error('对齐后开口超出目标边缘，请先移动房间');
  return {...store,maps:store.maps.map(m=>m.id===b.id?{...m,openings:m.openings!.map(o=>o.id===to.id?{...o,offset}:o)}:m)};
}

/** Split the actual rectangle, retaining material on both sides of the opening. */
export function splitTerrainAtOpening(g:SpatialGeometry,opening:MapOpening):SpatialGeometry[] {
  if(g.shape!=='rect'||Math.abs(g.rotation%360)>1e-6)throw new Error('开口工具支持未旋转的矩形地形；其他形状请手动编辑');
  const vertical=opening.side==='top'||opening.side==='bottom',low=opening.offset-opening.width/2,high=opening.offset+opening.width/2,start=vertical?g.x:g.y,end=start+(vertical?g.width:g.height);
  if(high<=start||low>=end)throw new Error('开口与选中的地形不相交');
  const parts:SpatialGeometry[]=[];
  if(low>start)parts.push({...g,...(vertical?{width:low-start}:{height:low-start})});
  if(high<end)parts.push({...g,...(vertical?{x:high,width:end-high}:{y:high,height:end-high})});
  if(!parts.length)throw new Error('开口会移除整块地形，请使用删除对象并处理其引用');
  return parts;
}
