import type { ActorProfile, MapConnection, MapDesignStore, TravelMode, TravelRule } from './map-design';
import type { worldPortal } from './map-world';

export const defaultActor=():ActorProfile=>({width:.6,height:1,stepHeight:.5,jumpRise:4,jumpGap:6,maxDrop:20});
export type RoutePoint={x:number;y:number};
export type PassageCheck={state:'ready'|'blocked'|'pending';reason:string;path:RoutePoint[];blockers:string[]};
type Portal=NonNullable<ReturnType<typeof worldPortal>>;
type Box={x:number;y:number;width:number;height:number;id:string;kind:'solid'|'one-way'|'ladder'|'decoration';virtual?:boolean};
const eps=.00001;
const overlap=(a:Box,b:Box)=>a.x<b.x+b.width-eps&&a.x+a.width>b.x+eps&&a.y<b.y+b.height-eps&&a.y+a.height>b.y+eps;
const inside=(p:RoutePoint,r:{x:number;y:number;width:number;height:number})=>p.x>=r.x-eps&&p.x<=r.x+r.width+eps&&p.y>=r.y-eps&&p.y<=r.y+r.height+eps;
const result=(state:PassageCheck['state'],reason='',blockers:string[]=[],path:RoutePoint[]=[]):PassageCheck=>({state,reason,blockers,path});

export function checkPhysicalPassage(store:MapDesignStore,c:MapConnection,reverse:boolean,a:Portal,b:Portal,mode:TravelMode,rule:TravelRule,startObjectId?:string,approachOnly=false):PassageCheck {
  if(mode==='transport')return result('ready','',[],[{x:a.object.x+a.object.width/2,y:a.object.y+a.object.height/2},{x:b.object.x+b.object.width/2,y:b.object.y+b.object.height/2}]);
  if(startObjectId&&startObjectId!==a.object.id&&!approachOnly){
    const approach=checkPhysicalPassage(store,c,reverse,a,b,mode,rule,startObjectId,true);
    if(approach.state!=='ready')return {...approach,reason:'无法到达通路出发点：'+approach.reason};
    const passage=checkPhysicalPassage(store,c,reverse,a,b,mode,rule);
    return passage.state==='ready'?{...passage,path:[...approach.path,...passage.path.slice(1)]}:passage;
  }
  if(!a.opening||!b.opening)return result('pending','待完善：请选择两端物理开口；室内到达点不能代替开口');
  const actor=store.world?.actor??defaultActor(),side=(store.world?.perspective??(store.maps.every(m=>m.perspective==='side')?'side':'top'))==='side';
  const vertical=a.side==='top'||a.side==='bottom',needed=vertical?actor.width:actor.height;
  if(a.openingWidth<needed-eps||b.openingWidth<needed-eps)return result('blocked','开口宽度不足，角色无法通过');
  if(Math.abs(vertical?a.x-b.x:a.y-b.y)>.02)return result('blocked',vertical?'上下开口横向错位；请对齐开口或布置实际中间通道':'左右开口高度错位；请对齐开口或布置实际中间通道');
  for(const p of [a,b]){const extent=(p.side==='left'||p.side==='right')?p.room.height:p.room.width,offset=p.opening!.offset*p.room.scale;if(offset-p.openingWidth/2< -eps||offset+p.openingWidth/2>extent+eps)return result('blocked','物理开口超出房间边缘');}
  const rooms=a.room.id===b.room.id?[a.room]:[a.room,b.room];
  const unknown=rooms.flatMap(r=>r.objects.filter(o=>o.collision!=='decoration'&&(o.shape!=='rect'||Math.abs(o.rotation%360)>eps)));
  if(unknown.length)return result('pending','待完善：旋转或曲面通行地形需要转换为矩形通行区',unknown.map(o=>o.id));
  const boxes:Box[]=rooms.flatMap(r=>r.objects.map(o=>({...o,kind:o.collision}))),real=boxes.filter(o=>o.kind!=='decoration');
  const span=Math.min(a.openingWidth,b.openingWidth),gap=Math.hypot(a.x-b.x,a.y-b.y);
  const corridor={x:vertical?a.x-span/2:Math.min(a.x,b.x),y:vertical?Math.min(a.y,b.y):a.y-span/2,width:vertical?span:Math.max(gap,eps),height:vertical?Math.max(gap,eps):span};
  if(c.structure==='ladder')real.push({...corridor,id:'passage-ladder',kind:'ladder'});
  if(c.structure==='bridge'&&!vertical)real.push({x:corridor.x,y:corridor.y+corridor.height,width:corridor.width,height:.1,id:'passage-bridge',kind:'solid'});
  // Closed room boundaries are collision geometry, except the selected aperture.
  for(const r of rooms){const ports=[a,b].filter(p=>p.room.id===r.id);for(const edge of ['left','right','top','bottom'] as const){
    const horizontal=edge==='top'||edge==='bottom',extent=horizontal?r.width:r.height,holes=ports.filter(p=>p.side===edge).map(p=>({low:p.opening!.offset*r.scale-p.openingWidth/2,high:p.opening!.offset*r.scale+p.openingWidth/2})).sort((x,y)=>x.low-y.low);
    let start=0;for(const hole of [...holes,{low:extent,high:extent}]){if(hole.low>start+eps)real.push({id:'boundary:'+r.id+':'+edge,kind:'solid',virtual:true,x:r.x+(horizontal?start:edge==='right'?r.width:0)-(!horizontal?.01:0),y:r.y+(!horizontal?start:edge==='bottom'?r.height:0)-(horizontal?.01:0),width:horizontal?hole.low-start:.02,height:horizontal?.02:hole.low-start});start=Math.max(start,hole.high);}
  }}
  const solid=real.filter(o=>o.kind==='solid'),platforms=real.filter(o=>o.kind==='solid'||o.kind==='one-way'),ladders=real.filter(o=>o.kind==='ladder');
  const body=(p:RoutePoint):Box=>({x:p.x-actor.width/2,y:p.y-actor.height/2,width:actor.width,height:actor.height,id:'actor',kind:'solid'});
  const blockers=(p:RoutePoint)=>solid.filter(o=>overlap(body(p),o));
  const domain=(p:RoutePoint)=>[...rooms,corridor].some(r=>inside(p,r));
  const free=(p:RoutePoint)=>domain(p)&&[-1,1].every(x=>[-1,1].every(y=>domain({x:p.x+x*actor.width/2,y:p.y+y*actor.height/2})))&&!blockers(p).length;
  const ladder=(p:RoutePoint)=>ladders.some(o=>overlap(body(p),o));
  const supported=(p:RoutePoint)=>platforms.some(o=>Math.abs(p.y+actor.height/2-o.y)<.06&&p.x+actor.width/2>o.x+eps&&p.x-actor.width/2<o.x+o.width-eps);
  const anchor=(o:Portal['object'])=>({x:o.x+o.width/2,y:o.y+o.height/2});
  const startObject=startObjectId?a.room.objects.find(o=>o.id===startObjectId):a.object;
  if(!startObject)return result('pending','待完善：当前室内到达点已失效');
  const start=anchor(startObject),end=anchor(approachOnly?a.object:b.object);
  for(const [name,p] of [['出发点',start],['目标落点',end],['起点开口',a],['终点开口',b]] as const){const hit=blockers(p);if(hit.length)return result('blocked',name+'被地形封堵：'+hit.map(o=>o.virtual?'房间边界':rooms.flatMap(r=>r.objects).find(v=>v.id===o.id)?.name??o.id).join('、'),hit.map(o=>o.id));}
  if(!free(start)||!free(end))return result('blocked','出发点或目标落点位于可行走空间之外');
  if(side&&(!supported(start)&&!ladder(start)||!supported(end)&&!ladder(end)))return result('blocked','出发点或目标落点没有地面支撑或梯子');
  const swept=(p:RoutePoint,q:RoutePoint,o:Box)=>{
    let low=0,high=1;
    for(const [v,d,min,max] of [[p.x,q.x-p.x,o.x-actor.width/2+eps,o.x+o.width+actor.width/2-eps],[p.y,q.y-p.y,o.y-actor.height/2+eps,o.y+o.height+actor.height/2-eps]]){
      if(Math.abs(d)<eps){if(v<=min||v>=max)return false;}else{let t1=(min-v)/d,t2=(max-v)/d;if(t1>t2)[t1,t2]=[t2,t1];low=Math.max(low,t1);high=Math.min(high,t2);if(high<low)return false;}
    }return high>=low&&high>=0&&low<=1;
  };
  let evaluations=0;
  const segment=(p:RoutePoint,q:RoutePoint,walk=false,climb=false,arc=0)=>{
    const length=Math.hypot(q.x-p.x,q.y-p.y)+arc*2,steps=Math.max(2,Math.ceil(length/Math.max(.05,Math.min(actor.width,actor.height)/3)));
    if(steps>2000)return false;
    let prev=p;
    for(let i=1;i<=steps;i++){if(++evaluations>250000)return false;const t=i/steps,next={x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t-4*arc*t*(1-t)};
      if(!free(next)||solid.some(o=>swept(prev,next,o))||walk&&!supported(next)&&!((mode==='climb'||mode==='auto')&&ladder(next))||climb&&!ladder(next))return false;
      if(side&&next.y>prev.y+eps&&platforms.some(o=>o.kind==='one-way'&&prev.y+actor.height/2<=o.y+eps&&next.y+actor.height/2>o.y+eps&&next.x+actor.width/2>o.x+eps&&next.x-actor.width/2<o.x+o.width-eps))return false;
      prev=next;
    }return true;
  };
  const spacing=Math.max(.15,Math.min(actor.width/2,.5));
  if(!side){
    const left=Math.min(...rooms.map(r=>r.x)),top=Math.min(...rooms.map(r=>r.y)),right=Math.max(...rooms.map(r=>r.x+r.width)),bottom=Math.max(...rooms.map(r=>r.y+r.height));
    if((right-left)*(bottom-top)/spacing**2>40000)return result('pending','待完善：空间过大，请拆分地图或调整角色尺寸后检查');
    const queue=[start],parents=[-1],seen=new Set<string>();let found=-1;
    for(let i=0;i<queue.length&&i<40000;i++){const p=queue[i];if(Math.hypot(end.x-p.x,end.y-p.y)<=spacing*1.6&&segment(p,end)){found=i;break;}
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const q={x:p.x+dx*spacing,y:p.y+dy*spacing},key=Math.round((q.x-start.x)/spacing)+','+Math.round((q.y-start.y)/spacing);if(seen.has(key))continue;seen.add(key);if(segment(p,q)){queue.push(q);parents.push(i);}}
    }
    if(found>=0){const path=[end];for(let i=found;i>=0;i=parents[i])path.unshift(queue[i]);return result('ready','',[],path);}
    return result(evaluations>250000?'pending':'blocked',evaluations>250000?'待完善：路径检查超出计算范围':'室内到开口的道路被阻断，未找到连续可走路径',solid.filter(o=>!o.virtual).map(o=>o.id));
  }
  const nodes:RoutePoint[]=[start,end],keys=new Set<string>(),add=(p:RoutePoint)=>{const key=p.x.toFixed(3)+','+p.y.toFixed(3);if(!keys.has(key)&&free(p)){keys.add(key);nodes.push(p);}};
  for(const o of platforms.filter(o=>!o.virtual)){if(o.width/spacing>1500)return result('pending','待完善：地形过长，请拆分地图后检查');const y=o.y-actor.height/2;for(let x=o.x+actor.width/2;x<=o.x+o.width-actor.width/2+eps;x+=spacing)add({x,y});add({x:o.x+actor.width/2,y});add({x:o.x+o.width-actor.width/2,y});for(const p of [start,end,a,b,...[a,b].flatMap(p=>[{x:p.x-p.openingWidth/2+actor.width/2},{x:p.x+p.openingWidth/2-actor.width/2}]),...ladders.map(l=>({x:l.x+l.width/2}))])if(p.x>=o.x&&p.x<=o.x+o.width)add({x:p.x,y});}
  for(const l of ladders){if(l.height/spacing>1500)return result('pending','待完善：梯子过长，请拆分地图后检查');for(let y=l.y;y<=l.y+l.height+eps;y+=spacing)add({x:l.x+l.width/2,y});for(const p of [...nodes,a,b])if(p.y>=l.y&&p.y<=l.y+l.height)add({x:l.x+l.width/2,y:p.y});}
  if(nodes.length>2000)return result('pending','待完善：通行节点过多，请拆分地图后检查');
  const parent=new Map<number,{from:number;arc:number;corner?:RoutePoint}>(),open=[0],visited=new Set<number>();let found=false;
  const rise=Math.min(actor.jumpRise,rule.maxRise),gapLimit=Math.min(actor.jumpGap,rule.maxGap),drop=Math.min(actor.maxDrop,rule.maxDrop);
  while(open.length&&evaluations<=250000){open.sort((i,j)=>Math.hypot(nodes[j].x-end.x,nodes[j].y-end.y)-Math.hypot(nodes[i].x-end.x,nodes[i].y-end.y));const i=open.pop()!;if(i===1){found=true;break;}if(visited.has(i))continue;visited.add(i);const p=nodes[i];
    for(let j=1;j<nodes.length;j++){if(j===i||visited.has(j)||parent.has(j))continue;const q=nodes[j],dx=Math.abs(q.x-p.x),dy=q.y-p.y;let allowed=false,arc=0,corner:RoutePoint|undefined;
      if(dx<=Math.max(spacing*2,actor.width*3)&&Math.abs(dy)<eps)allowed=segment(p,q,true);
      if(!allowed&&dx<=actor.width&&Math.abs(dy)<=spacing*2&&(mode==='climb'||mode==='auto'))allowed=segment(p,q,false,true);
      if(!allowed&&dx<=actor.width&&Math.abs(dy)<=actor.stepHeight&&supported(p)&&supported(q)){const stepCorner={x:dy<0?p.x:q.x,y:Math.min(p.y,q.y)};allowed=segment(p,stepCorner)&&segment(stepCorner,q);if(allowed)corner=stepCorner;}
      if(!allowed&&mode==='jump'&&supported(p)&&supported(q)&&dx<=gapLimit&&-dy<=rise&&dy<=drop){arc=Math.min(Math.max(.2,(rise+dy/2)/2),rise);const peakRise=arc>eps?Math.max(0,4*arc*(.5-dy/(8*arc))**2):0;if(peakRise<=rise+eps)allowed=segment(p,q,false,false,arc);}
      if(!allowed&&mode!=='walk'&&dy>eps&&dy<=drop&&dx<=gapLimit&&(supported(p)||ladder(p))&&supported(q)){arc=0;allowed=segment(p,q);if(!allowed&&dx<=actor.width+eps){const ledge={x:q.x,y:p.y};allowed=segment(p,ledge)&&segment(ledge,q);if(allowed)corner=ledge;}}
      if(allowed){parent.set(j,{from:i,arc,corner});open.push(j);}
    }
  }
  if(found){const edges:{p:RoutePoint;q:RoutePoint;arc:number}[]=[];for(let i=1;i!==0;){const e=parent.get(i)!;if(e.corner){edges.unshift({p:e.corner,q:nodes[i],arc:0});edges.unshift({p:nodes[e.from],q:e.corner,arc:0});}else edges.unshift({p:nodes[e.from],q:nodes[i],arc:e.arc});i=e.from;}const path=[start];for(const e of edges)for(let k=1;k<=8;k++){const t=k/8;path.push({x:e.p.x+(e.q.x-e.p.x)*t,y:e.p.y+(e.q.y-e.p.y)*t-4*e.arc*t*(1-t)});}return result('ready','',[],path);}
  return result(evaluations>250000?'pending':'blocked',evaluations>250000?'待完善：路径检查超出计算范围':'未找到可达路径；请补充平台、梯子或安全落点，检查途中净空',solid.filter(o=>!o.virtual).map(o=>o.id));
}
