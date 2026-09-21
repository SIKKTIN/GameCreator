import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {buildSearchIndex,searchEntries,relatedEntries} from '../src/global-search.ts';
const sources=e=>({gameplay:e.gameplay,core:e.gameplayCore,functional:e.functionalSystems,art:e.artAssets,prototype:e.prototypeDesign,maps:e.mapDesign,stories:e.stories,narrative:e.storyOrchestration,schedule:e.projectSchedule,tasks:e.taskFlows,data:e.data,definitions:e.definitions});
for(const slug of ['plants-vs-zombies','stardew-valley','hollow-knight','disco-elysium','vampire-survivors'])test(slug+' indexes searchable content without mutation',async()=>{
 const e=JSON.parse(await fs.readFile(new URL('../examples/prototypes/'+slug+'.json',import.meta.url))),raw=JSON.stringify(e),entries=buildSearchIndex(sources(e));
 assert.ok(entries.length>50);assert.equal(new Set(entries.map(x=>x.key)).size,entries.length);
 for(const [key,module,field] of [['gameplay','玩法设计','designs'],['artAssets','素材资产','requirements'],['functionalSystems','功能系统','capabilities'],['projectSchedule','项目排期','tasks'],['prototypeDesign','原型设计','scenes']])for(const v of e[key]?.[field]||[]){const hits=searchEntries(entries,v.title||v.name,module,true);assert.ok(hits.some(h=>h.entry.target.id===v.id),module+': '+v.id);}
 for(const r of e.artAssets.requirements){const token=r.generationPrompt.prompt.slice(-60);assert.ok(searchEntries(entries,token,'素材资产').some(h=>h.entry.target.id===r.id),'prompt body');}
 for(const d of e.gameplay.designs)for(const state of d.stateFlow.states)assert.ok(entries.some(x=>x.target.kind==='state'&&x.target.id===state.id&&x.target.parent===d.id));
 assert.equal(JSON.stringify(e),raw);
});
test('ranking, literal queries, AND terms, archived parents, duplicate-field merging and fresh index',()=>{
 const source={functional:{systems:[{id:'system',name:'移动',archived:true}],capabilities:[{id:'archived',systemId:'system',name:'冲刺'}]},stories:[{id:'one',title:'冲刺',summary:'冲刺 冷却',content:'冲刺'},{id:'two',title:'说明',content:'冲刺 冷却 [a+b]\n<script>alert(1)</script>'},{id:'three',title:'冲刺升级',content:'解锁'}]};
 const entries=buildSearchIndex(source);assert.deepEqual(searchEntries(entries,'冲刺').map(x=>x.entry.target.id),['one','three','two']);assert.equal(searchEntries(entries,'冲刺 冷却').length,2);assert.equal(searchEntries(entries,'[a+b]').length,1);assert.equal(searchEntries(entries,'ARCHIVED').length,0);assert.equal(searchEntries(entries,'ARCHIVED','',true).length,1);assert.equal(searchEntries(entries,'   ').length,0);assert.equal(searchEntries(entries,'冲刺','素材资产').length,0);
 source.stories[0].title='奔跑';source.stories[0].content='';source.stories[0].summary='';source.stories.splice(1,1);assert.equal(searchEntries(buildSearchIndex(source),'冲刺').length,1);
 assert.equal(buildSearchIndex({}).length,0);assert.equal(searchEntries(buildSearchIndex({stories:[{id:'else',title:'另一项目'}]}),'冲刺').length,0);
});
test('disabled modules, enum member keys and file-name metadata',()=>{
 const entries=buildSearchIndex({maps:{enabled:false,maps:[{id:'m',name:'地图',objects:[{id:'o',name:'出口'}]}]},enums:{groups:[{name:'Enum.State',members:[{key:'RUN',value:12345,comment:'运行'}]}]},art:{assets:[{id:'asset',name:'交付',versions:[{id:'v',name:'V1',files:[{id:'f',name:'sprite.png',storagePath:'private-secret'}]}]}]}});
 assert.ok(searchEntries(entries,'出口')[0].entry.unavailable);assert.equal(searchEntries(entries,'RUN')[0].entry.target.parent,'Enum.State');assert.equal(searchEntries(entries,'12345').length,0);assert.equal(searchEntries(entries,'sprite.png').length,1);assert.equal(searchEntries(entries,'private-secret').length,0);
});
test('large data tables retain records and show a bounded matching excerpt',()=>{
 const data={datasets:{table:Array.from({length:12000},(_,i)=>({id:'row-'+i,name:'记录'+i,description:i===11000?'前'.repeat(4000)+'唯一匹配词'+ '后'.repeat(4000):'普通内容'}))},columns:{table:[]}},entries=buildSearchIndex({data});
 const hit=searchEntries(entries,'唯一匹配词');assert.equal(hit.length,1);assert.equal(hit[0].entry.target.id,'row-11000');assert.ok(hit[0].snippet.includes('唯一匹配词'));assert.ok(hit[0].snippet.length<270);
});

test('relationships use explicit bindings and avoid ambiguous record IDs',()=>{
 const entries=buildSearchIndex({functional:{capabilities:[{id:'c',name:'冲刺'}],usages:[{id:'u',capabilityId:'c',gameplayId:'g',sourceKind:'design',sourceId:''}]},gameplay:{designs:[{id:'g',title:'跑跳'}]},art:{requirements:[{id:'r',name:'角色'}],assets:[{id:'a',name:'角色图'}],links:[{id:'link',requirementId:'r',assetId:'a'}]},data:{datasets:{one:[{id:'shared',name:'甲'}],two:[{id:'shared',name:'乙'}]},columns:{}}});
 assert.ok(relatedEntries(entries.find(e=>e.target.id==='c'),entries).some(e=>e.target.id==='g'));assert.ok(relatedEntries(entries.find(e=>e.target.id==='r'),entries).some(e=>e.target.id==='a'));
 assert.equal(relatedEntries(entries.find(e=>e.target.parent==='one'),entries).length,0);
});

test('same enum name in separate source files has distinct result identities',()=>{
 const entries=buildSearchIndex({enums:{groups:['A.lua','B.lua'].map(source=>({name:'Const.State',source,members:[{key:'READY',comment:'就绪'}]}))}});
 assert.equal(entries.length,4);assert.equal(new Set(entries.map(e=>e.key)).size,4);assert.deepEqual(searchEntries(entries,'READY').map(e=>e.entry.target.scope),['A.lua','B.lua']);
});
