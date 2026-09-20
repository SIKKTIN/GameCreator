import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createDesignMap,validateMapDesign,writeMapDesign} from '../src/map-design.ts';
import {withWorldLayout,worldRoom,worldPortal,worldSettings,connectionSpatial,alignWorldConnection,worldLayoutIssues,defaultTravel} from '../src/map-world.ts';
import {prototypeFromMaps,applyPrototypeAction,startPrototype,prototypeMapRoute} from '../src/prototype-design.ts';
function fixture(type='side'){
 const a=createDesignMap('上层A'),c=createDesignMap('下层C');a.rows=c.rows=10;a.columns=c.columns=20;a.placement={x:0,y:0,scale:1};c.placement={x:0,y:14,scale:1};
 const port=(map,id,x,y)=>({id,name:id,kind:'portal',layerId:map.layers[0].id,x,y,width:1,height:1,color:'blue',notes:'',references:[]});
 a.objects=[port(a,'a-port',5,9)];c.objects=[port(c,'c-port',5,0)];
 const link={id:'link',name:'竖井',from:c.id,to:a.id,fromObjectId:'c-port',toObjectId:'a-port',fromSide:'top',toSide:'bottom',direction:'both',kind:'passage',condition:'',travel:{...defaultTravel(),forward:'jump',reverse:'drop'}};
 return {schema:1,enabled:true,world:{perspective:type,unit:'米',snap:1},maps:[a,c],connections:[link]};
}
test('world positions translate rooms and every local object; source coordinates remain unchanged',()=>{
 const s=fixture(),before=JSON.stringify(s.maps[1].objects),room=worldRoom(s,s.maps[1],[]);assert.equal(room.width,20);assert.equal(room.height,10);assert.equal(room.objects[0].y,14);
 s.maps[1].placement={x:8,y:25,scale:2};const moved=worldRoom(s,s.maps[1],[]);assert.equal(moved.width,40);assert.equal(moved.objects[0].x,18);assert.equal(moved.objects[0].y,25);assert.equal(JSON.stringify(s.maps[1].objects),before);
});
test('upward traversal needs appropriate movement and reach; dropping cannot move upward',()=>{
 const s=fixture(),c=s.connections[0];assert.equal(connectionSpatial(s,c,[]).rise,4);assert.equal(connectionSpatial(s,c,[]).direction,'上');assert.equal(connectionSpatial(s,c,[]).allowed,true);
 c.travel.maxRise=3;assert.match(connectionSpatial(s,c,[]).reason,/超出/);c.travel.forward='drop';assert.match(connectionSpatial(s,c,[]).reason,/不能到达上方/);c.travel.forward='walk';assert.match(connectionSpatial(s,c,[]).reason,/同高度/);c.travel.forward='auto';assert.match(connectionSpatial(s,c,[]).reason,/跳跃或攀爬/);
 assert.equal(connectionSpatial(s,c,[],true).allowed,true);c.direction='one';assert.match(connectionSpatial(s,c,[],true).reason,/正向/);
});
test('shared seam retains vertical direction; top-down north is not a height requirement',()=>{
 const s=fixture();s.maps[1].placement.y=10;const c=s.connections[0];c.travel.forward='walk';assert.equal(connectionSpatial(s,c,[]).rise,0);assert.equal(connectionSpatial(s,c,[]).allowed,false);
 const geometry=JSON.stringify(s.maps);s.world.perspective='top';const top=connectionSpatial(s,c,[]);assert.equal(top.direction,'北');assert.equal(top.allowed,true);assert.equal(JSON.stringify(s.maps),geometry);
 s.world.perspective='side';assert.equal(connectionSpatial(s,c,[]).allowed,false);
});
test('horizontal neighbors use left/right portals, gaps affect walking and jumping, transport bypasses distance',()=>{
 const s=fixture(),[a,c]=s.maps;c.placement={x:20,y:0,scale:1};a.objects[0].y=c.objects[0].y=5;const link={...s.connections[0],from:a.id,to:c.id,fromObjectId:'a-port',toObjectId:'c-port',fromSide:'right',toSide:'left',travel:{...defaultTravel(),forward:'walk'}};
 assert.equal(connectionSpatial(s,link,[]).direction,'右');assert.equal(connectionSpatial(s,link,[]).allowed,true);c.placement.x=24;assert.equal(connectionSpatial(s,link,[]).allowed,false);link.travel.forward='jump';assert.equal(connectionSpatial(s,link,[]).allowed,true);c.placement.x=30;assert.equal(connectionSpatial(s,link,[]).allowed,false);link.kind='transport';assert.equal(connectionSpatial(s,link,[]).allowed,true);
});
test('alignment moves only destination placement, reverse rules are independent, overlaps are reported',()=>{
 const s=fixture(),c=s.connections[0],before=JSON.stringify(s);const aligned=alignWorldConnection(s,c,[]);assert.equal(connectionSpatial(aligned,c,[]).distance,0);assert.deepEqual(aligned.maps[1],s.maps[1]);assert.deepEqual(aligned.maps[0].objects,s.maps[0].objects);assert.equal(JSON.stringify(s),before);
 s.maps[1].placement.y=5;assert.ok(worldLayoutIssues(s,[]).some(i=>i.includes('重叠')));assert.throws(()=>alignWorldConnection(s,{...c,to:c.from},[]));
});
test('legacy topology converts once into separate world placement, preserves original bytes and disabled modules',()=>{
 const s=fixture();delete s.world;for(const m of s.maps){delete m.placement;m.x=500;m.y=200;m.perspective='side';}s.enabled=false;const before=JSON.stringify(s),converted=withWorldLayout(s);
 assert.equal(worldSettings(converted).perspective,'side');assert.notEqual(converted.maps[0].placement.x,s.maps[0].x);assert.equal(converted.maps[0].x,500);assert.equal(converted.enabled,false);assert.deepEqual(withWorldLayout(converted),converted);assert.equal(JSON.stringify(s),before);
});
test('live source geometry, mixed scales and portal directions use the same world transform',async()=>{
 const e=JSON.parse(await fs.readFile(new URL('../examples/prototypes/hollow-knight.json',import.meta.url),'utf8')),s=e.mapDesign,m=s.maps[0],d=e.gameplay.designs.find(d=>d.id===m.sourceDesignId),id=d.space.objects[0].id;
 m.placement={x:-20,y:-10,scale:.5};d.space.objects[0].geometry={x:8,y:4,width:4,height:2,rotation:30,shape:'rect',range:0,innerRange:0,arc:90};const o=worldRoom(s,m,e.gameplay.designs).objects.find(o=>o.id===id);assert.equal(o.x,-16);assert.equal(o.y,-8);assert.equal(o.rotation,30);assert.equal(worldPortal(s,m.id,id,'right',e.gameplay.designs).x,-8);
});
test('generated prototype follows edited world positions, direction and live conditions without regeneration',()=>{
 const s=fixture(),scenes=prototypeFromMaps(s,[]),p={schema:1,entryId:scenes[1].id,scenes},runtime=startPrototype(p),button=scenes[1].elements[0],before=JSON.stringify(p);
 assert.equal(applyPrototypeAction(p,runtime,button.id,false,s,[]).sceneId,scenes[0].id);s.maps[1].placement.y=20;assert.throws(()=>applyPrototypeAction(p,runtime,button.id,true,s,[]),/超出/);
 s.maps[1].placement.y=14;s.connections[0].condition='新钥匙';assert.throws(()=>applyPrototypeAction(p,runtime,button.id,false,s,[]),/条件/);assert.equal(prototypeMapRoute(p,scenes[1],button,s,[]).condition,'新钥匙');assert.equal(applyPrototypeAction(p,runtime,button.id,true,s,[]).sceneId,scenes[0].id);assert.equal(JSON.stringify(p),before);
 s.connections=[];assert.throws(()=>applyPrototypeAction(p,runtime,button.id,true,s,[]),/已删除/);
});
test('world schema rejects malformed transforms and movement limits before any persistence',()=>{
 for(const mutate of [s=>s.world.perspective='3d',s=>s.world.snap=0,s=>s.maps[0].placement.scale=-1,s=>s.maps[0].placement.y=Infinity,s=>s.connections[0].fromSide='north',s=>s.connections[0].travel.maxRise=-1,s=>s.connections[0].travel.reverse='flight']){const s=fixture();mutate(s);let writes=0;assert.throws(()=>writeMapDesign({getItem:()=>null,setItem:()=>writes++},'test',null,s));assert.equal(writes,0);}
 const s=fixture();s.connections[0].toObjectId='missing';validateMapDesign(s);assert.equal(connectionSpatial(s,s.connections[0],[]).allowed,false);
});

test('large valid legacy layouts normalize to editable finite world placements',()=>{
 const s=fixture();delete s.world;for(const m of s.maps){delete m.placement;m.x=1e6;m.y=-1e6;m.cellSize=10000;}const next=withWorldLayout(s);validateMapDesign(next);assert.ok(next.maps.every(m=>Math.abs(m.placement.x)<=1e6&&Math.abs(m.placement.y)<=1e6));
});
