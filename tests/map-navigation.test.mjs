import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesignMap,validateMapDesign,connectionEndpoints,resolveMapConnection} from '../src/map-design.ts';
import {connectionSpatial,defaultTravel} from '../src/map-world.ts';
import {consolidatePassages,mergePassages,splitTerrainAtOpening,alignPassageOpening} from '../src/map-passages.ts';
import {prototypeFromMaps,startPrototype,applyPrototypeAction} from '../src/prototype-design.ts';

import {physicalFixture} from './helpers/map-physical-fixture.mjs';

test('physical shaft validates ladder paths and sealed floor blocks both directions',()=>{
 const s=physicalFixture(),c=s.connections[0];for(const reverse of [false,true]){const r=connectionSpatial(s,c,[],reverse);assert.equal(r.state,'ready',r.reason);assert.ok(r.path.length>2);}
 s.maps[0].objects[1].width=12;s.maps[0].objects.splice(2,1);
 for(const reverse of [false,true]){const r=connectionSpatial(s,c,[],reverse);assert.equal(r.state,'blocked');assert.match(r.reason,/封堵/);assert.ok(r.blockers.includes('a-floor-left'));}
});
test('missing openings, clearance, misalignment and absent upward route never report passable',()=>{
 const s=physicalFixture(),c=s.connections[0];delete c.fromOpeningId;assert.equal(connectionSpatial(s,c,[]).state,'pending');c.fromOpeningId='a-hole';
 s.maps[0].openings[0].width=.2;assert.match(connectionSpatial(s,c,[]).reason,/宽度不足/);s.maps[0].openings[0].width=2;
 s.maps[1].openings[0].offset=6;assert.match(connectionSpatial(s,c,[]).reason,/错位/);const aligned=alignPassageOpening(s,c,[]);assert.equal(aligned.maps[1].openings[0].offset,5);assert.deepEqual(aligned.maps.map(m=>m.placement),s.maps.map(m=>m.placement));
 s.maps[1].openings[0].offset=5;s.maps[1].surfaces=[];assert.notEqual(connectionSpatial(s,c,[],true).state,'ready');
});
test('return merge keeps conditions, landing points, movement limits and old prototype identities',()=>{
 const s=physicalFixture(),c=s.connections[0];c.direction='one';delete c.reverseCondition;
 const back={...c,id:'back',name:'返程',from:c.to,to:c.from,fromObjectId:c.toObjectId,toObjectId:c.fromObjectId,fromOpeningId:c.toOpeningId,toOpeningId:c.fromOpeningId,fromSide:'top',toSide:'bottom',condition:'梯子展开',travel:{...c.travel,maxRise:22}};s.connections.push(back);
 const scenes=prototypeFromMaps(s,[]),p={schema:1,entryId:scenes[1].id,scenes},button=scenes[1].elements[0],raw=JSON.stringify(s),merged=mergePassages(s,c.id,back.id);
 assert.equal(JSON.stringify(s),raw);assert.equal(merged.connections.length,1);assert.equal(merged.connections[0].direction,'both');assert.equal(connectionEndpoints(merged.connections[0],true).condition,'梯子展开');assert.equal(merged.connections[0].reverseLimits.maxRise,22);assert.equal(resolveMapConnection(merged,'back').reverse,true);
 assert.throws(()=>applyPrototypeAction(p,startPrototype(p),button.id,false,merged,[]),/条件/);assert.equal(applyPrototypeAction(p,startPrototype(p),button.id,true,merged,[]).sceneId,scenes[0].id);validateMapDesign(merged);
});
test('terrain cut leaves physical material on either side and archive validates every new boundary',()=>{
 const s=physicalFixture(),o=s.maps[0].openings[0],g={x:0,y:8,width:12,height:2,rotation:0,shape:'rect',range:0,innerRange:0,arc:90};
 const parts=splitTerrainAtOpening(g,o);assert.deepEqual(parts.map(p=>[p.x,p.width]),[[0,4],[6,6]]);assert.equal(g.width,12);
 assert.throws(()=>splitTerrainAtOpening({...g,rotation:45},o));
 for(const mutate of [v=>v.maps[0].openings[0].width=0,v=>v.maps[0].openings[0].side='auto',v=>v.maps[0].surfaces[0].kind='ghost',v=>v.connections[0].aliases=[{id:v.connections[0].id,reverse:true}],v=>v.connections[0].reverseLimits={maxRise:-1,maxGap:3,maxDrop:10},v=>v.world.actor={width:0,height:1,stepHeight:0,jumpRise:3,jumpGap:4,maxDrop:10}]){const next=structuredClone(s);mutate(next);assert.throws(()=>validateMapDesign(next));}
});

test('top-down routes need a continuous road and respect body clearance',()=>{
 const s=physicalFixture('top'),[a,b]=s.maps,c=s.connections[0];b.placement={x:12,y:0,scale:1};a.openings[0].side='right';b.openings[0].side='left';a.openings[0].offset=b.openings[0].offset=5;c.structure='open';c.travel.forward=c.travel.reverse='walk';
 assert.equal(connectionSpatial(s,c,[]).state,'ready');
 a.objects.push({id:'wall',name:'堵路墙',kind:'obstacle',layerId:a.layers[0].id,x:6,y:0,width:1,height:10,color:'red',notes:'',references:[]});
 const blocked=connectionSpatial(s,c,[]);assert.equal(blocked.state,'blocked');assert.ok(blocked.blockers.includes('wall'));
 a.surfaces.push({objectId:'wall',kind:'decoration'});assert.equal(connectionSpatial(s,c,[]).state,'ready');
 s.world.actor={width:.6,height:3,stepHeight:.5,jumpRise:4,jumpGap:6,maxDrop:20};assert.match(connectionSpatial(s,c,[]).reason,/宽度不足/);
});

test('one-way falling never becomes an upward return route without a ladder',()=>{
 const s=physicalFixture(),c=s.connections[0];c.direction='one';c.travel.forward='drop';c.structure='open';s.maps[1].surfaces=[];
 const down=connectionSpatial(s,c,[]);assert.equal(down.state,'ready',down.reason);
 assert.equal(connectionSpatial(s,c,[],true).allowed,false);
 c.direction='both';c.travel.reverse='drop';assert.match(connectionSpatial(s,c,[],true).reason,/下落不能/);
 c.travel.reverse='climb';assert.notEqual(connectionSpatial(s,c,[],true).state,'ready');
});

test('a reachable entry cannot skip an interior obstruction by clicking another exit hotspot',()=>{
 const s=physicalFixture(),c=s.connections[0];s.maps[0].objects.push({id:'far-entry',name:'远端入口',kind:'portal',layerId:s.maps[0].layers[0].id,x:9,y:7,width:1,height:1,color:'blue',notes:'',references:[]},{id:'divider',name:'隔墙',kind:'obstacle',layerId:s.maps[0].layers[0].id,x:7,y:0,width:1,height:10,color:'red',notes:'',references:[]});
 assert.equal(connectionSpatial(s,c,[]).state,'ready');assert.equal(connectionSpatial(s,c,[],false,'far-entry').state,'blocked');c.fromObjectId='far-entry';assert.match(connectionSpatial(s,c,[],false,'a-start').reason,/无法到达通路出发点/);
});

test('automatic consolidation is pure and refuses ambiguous parallel routes',()=>{
 const s=physicalFixture(),c=s.connections[0];c.direction='one';s.connections.push({...c,id:'back',from:c.to,to:c.from,fromObjectId:c.toObjectId,toObjectId:c.fromObjectId,fromOpeningId:c.toOpeningId,toOpeningId:c.fromOpeningId,fromSide:'top',toSide:'bottom'});
 const before=JSON.stringify(s),merged=consolidatePassages(s);assert.equal(merged.connections.length,1);assert.equal(resolveMapConnection(merged,'back').reverse,true);assert.equal(JSON.stringify(s),before);
 s.connections.push({...c,id:'alternative',condition:'另一种解锁'});assert.equal(consolidatePassages(s).connections.length,3);
});

test('a corridor cannot silently pass through a third room; moving that room invalidates the cached result',()=>{
 const s=physicalFixture(),c=s.connections[0],middle=createDesignMap('中间房间');middle.rows=2;middle.columns=2;middle.placement={x:4,y:11,scale:1};
 assert.equal(connectionSpatial(s,c,[]).state,'ready');s.maps.push(middle);assert.match(connectionSpatial(s,c,[]).reason,/穿过其他房间/);
 middle.placement.x=20;assert.equal(connectionSpatial(s,c,[]).state,'ready');
});
