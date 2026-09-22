import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedGroupDifferences,chooseDifferences,confirmDifferenceDeletions,pendingDifference} from '../src/data-sync-comparison.ts';
const diff=(id,local,remote)=>({id,path:['rows',id],local,remote,choice:'remote'});
test('batch decisions affect only selected differences, deduplicate groups and reset deletion approval',()=>{
 const a=diff('a',undefined,{id:'a'}),b=diff('b',{id:'b'},undefined),c=diff('c',1,2);
 const groups=[{id:'first',differences:[a,c]},{id:'second',differences:[a]},{id:'other',differences:[b]}];
 const subset=selectedGroupDifferences(groups,['first','second','expired']);assert.deepEqual(subset,[a,c]);
 const decisions={b:{choice:'custom',value:'42'},a:{choice:'local',allowDelete:true}};
 const next=chooseDifferences(subset,decisions,'local');assert.deepEqual(next.b,decisions.b);assert.equal(next.a.allowDelete,false);assert.equal(pendingDifference(a,next),true);
 const approved=confirmDifferenceDeletions(subset,next,true);assert.equal(approved.a.allowDelete,true);assert.equal(approved.c.allowDelete,false);assert.equal(pendingDifference(a,approved),false);
 assert.equal(decisions.a.allowDelete,true);assert.equal(next.a.allowDelete,false);assert.deepEqual(confirmDifferenceDeletions([],approved,true),approved);
 const switched=chooseDifferences(subset,approved,'remote');assert.equal(switched.a.allowDelete,false);assert.equal(pendingDifference(a,switched),false);
});
test('confirming a selected deletion does not approve a different unselected removal',()=>{
 const a=diff('a',undefined,1),b=diff('b',undefined,2);const decisions={a:{choice:'local'},b:{choice:'local'}};
 const next=confirmDifferenceDeletions([a],decisions,true);assert.equal(pendingDifference(a,next),false);assert.equal(pendingDifference(b,next),true);
 assert.equal(pendingDifference(a,confirmDifferenceDeletions([a],next,false)),true);
});
