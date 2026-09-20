import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionRectangle,nodesInRectangle,moveCoreGroup} from '../src/core-selection.ts';
const nodes=[{id:'a',x:100,y:100},{id:'b',x:430,y:150},{id:'c',x:800,y:400}];
test('marquee normalizes either direction and selects intersecting nodes without changing positions',()=>{
 const copy=structuredClone(nodes),a=selectionRectangle({x:90,y:90},{x:660,y:280}),b=selectionRectangle({x:660,y:280},{x:90,y:90});
 assert.deepEqual(a,b);assert.deepEqual(nodesInRectangle(nodes,a),['a','b']);assert.deepEqual(nodes,copy);
 assert.deepEqual(nodesInRectangle(nodes,{x:318,y:100,width:10,height:100}),[]);assert.deepEqual(nodesInRectangle(nodes,{x:0,y:0,width:0,height:1000}),[]);
});
test('group drag applies one rounded delta, preserves spacing and clamps the whole group at each boundary',()=>{
 for(const [dx,dy] of [[125.4,72.7],[-500,-500],[20000,20000]]){const moved=moveCoreGroup(nodes,dx,dy);for(let i=1;i<nodes.length;i++){assert.equal(moved[i].x-moved[0].x,nodes[i].x-nodes[0].x);assert.equal(moved[i].y-moved[0].y,nodes[i].y-nodes[0].y);}assert.ok(moved.every(n=>n.x>=35&&n.y>=65&&n.x<=15000&&n.y<=15000));}
 assert.deepEqual(moveCoreGroup(nodes.slice(0,2),40,25),[{id:'a',x:140,y:125},{id:'b',x:470,y:175}]);assert.equal(nodes[0].x,100);
});
test('invalid deltas cannot corrupt layout and preexisting large/negative coordinates never jump during a zero move',()=>{
 assert.deepEqual(moveCoreGroup(nodes,NaN,0),[]);assert.deepEqual(moveCoreGroup([],1,1),[]);
 const unusual=[{id:'a',x:-100,y:0},{id:'b',x:19000,y:18000}];assert.deepEqual(moveCoreGroup(unusual,0,0),unusual);
 const decimals=[{id:'a',x:100.25,y:90.5},{id:'b',x:430.75,y:151.25}],next=moveCoreGroup(decimals,1.2,2.8);assert.equal(next[1].x-next[0].x,330.5);assert.equal(next[1].y-next[0].y,60.75);
});
