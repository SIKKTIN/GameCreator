import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sample} from './gameplay-fixture.cjs';
import {emptyGameplaySnapshot,gameplayPatch,reconcileGameplay,sameGameplay,withGameplayLayout,gameplaySections,validateGameplayDraft,normalizeGameplayPublication} from '../src/team-gameplay-model.ts';
import {readLocalGameplay} from '../src/team-gameplay-publish.ts';
const snapshot=()=>({...emptyGameplaySnapshot(),initialized:true,categoryRevision:1,store:sample(),versions:{combat:1,growth:1}});
test('gameplay ignores room layouts and views, while all six sections and physical positions count as content',()=>{
  const base=snapshot(),moved=withGameplayLayout(base.store,{combat:{'room-a':{x:900,y:600}}});moved.designs[0].space.spatial.view='rooms';moved.designs[0].updatedAt=new Date(0).toISOString();assert.deepEqual(gameplayPatch(base,moved).changes,[]);
  for(const mutate of [d=>d.summary='new',d=>d.dependencies[0].note='new',d=>d.conditionRules[0].actions[0].text='heal',d=>d.stateFlow.transitions[0].priority=8,d=>d.space.objects[0].column=3,d=>d.timeline.duration=99,d=>d.archived=true,d=>d.tags.push('tag'),d=>d.prototype[0].done=false,d=>d.checks[0].actual='new']){
    const d=structuredClone(base.store.designs[0]);mutate(d);assert.equal(sameGameplay(d,base.store.designs[0]),false);
  }
  const sections=gameplaySections(base.store.designs[0],base.store);assert.equal(sections.length,6);assert.ok(sections.every(s=>s.text.trim()));assert.ok(sections[2].text.includes('攻击规则'));assert.ok(sections[3].text.includes('待机'));
});
test('reconciliation merges different documents, retains same-document conflicts and adopts committed timestamps after lost acknowledgement',()=>{
  const base=snapshot(),mine=structuredClone(base.store),remote=structuredClone(base);mine.designs[0].summary='mine';remote.store.designs[1].summary='other';remote.versions.growth++;
  const result=reconcileGameplay({base,store:mine},remote);assert.deepEqual(result.conflicts,[]);assert.equal(result.draft.store.designs[1].summary,'other');assert.equal(gameplayPatch(result.draft.base,result.draft.store).changes.length,1);
  remote.store.designs[0].summary='theirs';remote.versions.combat++;assert.deepEqual(reconcileGameplay({base,store:mine},remote).conflicts,['combat']);
  remote.store.designs[0].summary='mine';remote.store.designs[0].updatedAt='2026-09-20T11:00:00Z';const acknowledged=reconcileGameplay({base,store:mine},remote);assert.deepEqual(acknowledged.conflicts,[]);assert.deepEqual(gameplayPatch(acknowledged.draft.base,acknowledged.draft.store).changes,[]);assert.equal(acknowledged.draft.store.designs[0].updatedAt,'2026-09-20T11:00:00Z');
});
test('category conflicts and concurrent object-reference deletion preserve the original draft',()=>{
  const base=snapshot(),mine=structuredClone(base.store),remote=structuredClone(base);mine.categories[0].name='mine';remote.store.categories[0].name='theirs';remote.categoryRevision++;assert.ok(reconcileGameplay({base,store:mine},remote).conflicts.includes('$categories'));
  const initial=snapshot();initial.store.designs[1].timeline.events=[];const deletion=structuredClone(initial.store);deletion.designs[0].space.objects=[];const linked=snapshot();const result=reconcileGameplay({base:initial,store:deletion},linked);assert.ok(result.conflicts.includes('combat'));assert.deepEqual(result.draft.store,deletion);
  assert.throws(()=>validateGameplayDraft({base:{...base,versions:{combat:-1}},store:mine}));assert.throws(()=>normalizeGameplayPublication({store:{schema:3,designs:[...mine.designs,mine.designs[0]]},references:[]}));
});
test('publication reads complete archives without mutation, retains stable IDs and source references, and rejects corrupt content',()=>{
  const data=new Map([['gamecreator.workspace.v1:local:gameplay',JSON.stringify(sample())]]),storage={getItem:k=>data.get(k)??null},project={id:'local',name:'本地',initialContent:'empty'};
  const before=structuredClone(data),result=readLocalGameplay(storage,project);assert.equal(result.gameplay.store.designs[0].id,'combat');assert.deepEqual(data,before);
  data.set('gamecreator.workspace.v1:local:gameplay','broken');assert.throws(()=>readLocalGameplay(storage,project));
});
