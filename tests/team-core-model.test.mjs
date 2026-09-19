import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGameplay} from '../src/gameplay.ts';
import {emptyGameplayCore,createCoreNode} from '../src/gameplay-core.ts';
import {readPublicationPreview,assertPublicationCurrent} from '../src/team-publish.ts';
import {readLocalCore} from '../src/team-core-publish.ts';
import {validateCoreDraft,emptyCoreSnapshot,validateCoreLayout,graphContent} from '../src/team-core-model.ts';

test('local core publication preserves stable IDs, names and layout; changed core or reference invalidates the preview without writing local data',()=>{
  const project={id:'local',name:'Local',initialContent:'empty'},store=emptyGameplayCore(),design=createGameplay('来源玩法');
  const node=createCoreNode('activity','来源节点',450,300);node.gameplayIds=[design.id];store.graphs[0].nodes.push(node);
  const map=new Map([['gamecreator.workspace.v1:local:gameplay-core',JSON.stringify(store)],['gamecreator.workspace.v1:local:gameplay',JSON.stringify({schema:3,designs:[design]})]]);
  const storage={getItem:key=>map.get(key)??null},before=[...map],preview=readPublicationPreview(storage,project);
  assert.deepEqual(preview.core.store,store);assert.deepEqual(preview.core.references,[{id:design.id,title:design.title}]);assert.deepEqual([...map],before);
  node.description='changed';map.set('gamecreator.workspace.v1:local:gameplay-core',JSON.stringify(store));assert.throws(()=>assertPublicationCurrent(storage,project,preview),/本地项目已变化/);
  const second=readPublicationPreview(storage,project);design.title='新来源名称';map.set('gamecreator.workspace.v1:local:gameplay',JSON.stringify({schema:3,designs:[design]}));assert.throws(()=>assertPublicationCurrent(storage,project,second),/本地项目已变化/);
  map.set('gamecreator.workspace.v1:local:gameplay-core','broken');assert.throws(()=>readLocalCore(storage,project.id));assert.equal(map.get('gamecreator.workspace.v1:local:gameplay-core'),'broken');
});
test('malformed draft bases and layouts cannot enter the shared editor; a valid offline draft remains recoverable',()=>{
  const draft={base:emptyCoreSnapshot(),store:emptyGameplayCore()};draft.store.graphs[0].summary='offline';assert.deepEqual(validateCoreDraft(draft),draft);
  for(const mutation of [d=>delete d.base.stamps,d=>delete d.base.references,d=>d.base.versions.root=-1,d=>d.base.stamps.root={updatedAt:4,updatedBy:null}]){const bad=structuredClone(draft);mutation(bad);assert.throws(()=>validateCoreDraft(bad));}
  assert.throws(()=>validateCoreLayout({node:{x:null,y:2}}));assert.throws(()=>validateCoreLayout([]));assert.deepEqual(validateCoreLayout({node:{x:0,y:100}}),{node:{x:0,y:100}});
});
test('content comparison ignores ordering and coordinates while retaining hierarchy, references and edge conditions',()=>{
  const graph=emptyGameplayCore().graphs[0];graph.nodes.push(createCoreNode('activity','A'),createCoreNode('activity','B'));
  graph.edges.push({id:'edge',fromId:graph.nodes[0].id,toId:graph.nodes[1].id,label:'transition',condition:'won'});
  const changed=structuredClone(graph);changed.nodes.reverse();changed.nodes[0].x=99;assert.deepEqual(graphContent(changed),graphContent(graph));
  changed.edges[0].condition='lost';assert.notDeepEqual(graphContent(changed),graphContent(graph));
});
