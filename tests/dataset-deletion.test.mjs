import test from 'node:test';
import assert from 'node:assert/strict';
import {datasetReferences,removeDataset} from '../src/dataset-deletion.ts';
import {toData} from '../shared/data-sync.mjs';
const sources=()=>({gameplay:{designs:[]},functional:{systems:[],capabilities:[]},tasks:{tasks:[]},analysis:{plans:[]}});
test('table deletion removes rows, columns and JSON shape without changing other tables',()=>{
 let data=toData({datasets:{},columns:{}},'manifest',{version:1,author:'test'});
 data=toData(data,'plants',[{id:'pea',cost:100}]);const before=structuredClone(data);
 const next=removeDataset(data,'manifest',[]);
 assert.deepEqual(data,before);assert.deepEqual(Object.keys(next.datasets),['plants']);
 assert.ok(!Object.hasOwn(next.columns,'manifest'));assert.ok(!Object.hasOwn(next.jsonFormats,'manifest'));
 assert.deepEqual(next.datasets.plants,before.datasets.plants);assert.deepEqual(next.jsonFormats.plants,before.jsonFormats.plants);
 assert.deepEqual(removeDataset(next,'plants',[]),{datasets:{},columns:{},jsonFormats:{}});
 assert.throws(()=>removeDataset(next,'missing',[]),/不存在/);
});
test('all live references, including archived content and empty reference columns, block deletion',()=>{
 const data={datasets:{target:[],other:[]},columns:{target:[{key:'self',type:'reference',reference:'target'}],other:[{key:'r',label:'目标',type:'reference',reference:'target'}]}};
 const s=sources();s.gameplay.designs=[{title:'归档玩法',archived:true,links:[{kind:'dataset',targetId:'target'}]}];
 s.functional.capabilities=[{name:'配置加载',archived:true,configRefs:[{datasetKey:'target'}]}];
 s.tasks.tasks=[{title:'旧任务',archived:true,references:[{kind:'table',targetId:'target'}]}];
 s.analysis.plans=[{name:'批量',batch:{table:'target'},parameters:[]},{name:'单值',parameters:[{binding:{kind:'cell',table:'target'}}]}];
 const refs=datasetReferences(data,'target',s);assert.equal(refs.length,6);assert.throws(()=>removeDataset(data,'target',refs),/归档玩法/);
 delete data.columns.other;assert.deepEqual(datasetReferences(data,'target',sources()),[]);
});
