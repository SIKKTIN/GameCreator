import {jsonContract,schemaDocument,checkStructure} from '../shared/data-schema.mjs';
import {restoreDataRelease,validateDataReleases} from '../shared/data-releases.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {parseJson,toData,toJson,canonical,diffJson,resolveDiff,fromCanonical,dataDirectory,validateDataSync} from '../shared/data-sync.mjs';
import {readVersions} from '../src/enum-storage.ts';
import {compareDataFile,chooseDifferences,choiceFor,pendingDifference} from '../src/data-sync-comparison.ts';
const require=createRequire(import.meta.url),{createEngineSync}=require('../desktop/engine-sync.cjs'),{createStorage}=require('../desktop/storage.cjs');
const empty=()=>({schema:1,revision:0,activeId:null,candidateId:null,snapshots:[],reviews:{},releases:[],data:{datasets:{},columns:{}}});
const plants={schema_version:1,author:'test',rows:[{id:'001',name:'sunflower',cost:50,enabled:true,tags:['sun'],extra:{n:null},optional:null},{id:'002',name:'pea',cost:100,enabled:false,tags:[],extra:{}}]};
const manifest={schema_version:1,project_version:'0.1.0',source:'docs/gamecreator/modules/data-engine/data.md',source_sha256:'0486e81565e769fc5c4594313c5f74c8195a621446b295b6ba156002246dfe8e',wave_counts:[3,5,8],spawn_count:16};
async function fixture(t,options={}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-data-sync-'));t.after(async()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('gc-data-sync-'));await fs.rm(dir,{recursive:true,force:true});});
  const engine=path.join(dir,'engine');await fs.mkdir(path.join(engine,'data/generated'),{recursive:true});await fs.writeFile(path.join(engine,'project.godot'),'config_version=5');
  const storage=createStorage(path.join(dir,'store')),projectId='data-test',config={engine:'godot-gdscript',projectPath:engine,enumPath:'.',dataPath:'data/generated',outputFormat:'json',autoSync:false,backupBeforeSync:true};
  storage.setItem('gamecreator.projects.v1',JSON.stringify({activeId:projectId,projects:[{id:projectId,config}]}));
  const key='gamecreator.enum-versions.v1:'+projectId;storage.setItem(key,JSON.stringify(empty()));
  const api=createEngineSync({storage,artFiles:{},...options}),store=()=>JSON.parse(storage.getItem(key)),set=v=>storage.setItem(key,JSON.stringify(v));
  const input=()=>({projectId,config,store:store()});
  const put=(name,v)=>fs.writeFile(path.join(engine,'data/generated',name+'.json'),JSON.stringify(v));
  const get=async name=>JSON.parse(await fs.readFile(path.join(engine,'data/generated',name+'.json'),'utf8'));
  const preview=(direction='import',extra={})=>api.dataPreview({...input(),direction,...extra});
  const apply=(p,other={})=>api.dataApply({token:p.token,selections:p.rows.filter(r=>!r.error).map(r=>({table:r.table})),...other});
  return {dir,engine,storage,key,api,config,projectId,store,set,input,put,get,preview,apply};
}
test('records preserve wrapper metadata, heterogeneous fields, null, arrays, bools and string IDs',()=>{
  const data=toData(empty().data,'pvz_plants',plants);assert.equal(data.datasets.pvz_plants[0].id,'001');assert.equal(typeof data.datasets.pvz_plants[0].cost,'string');assert.deepEqual(toJson(data,'pvz_plants'),plants);assert.ok(!Object.hasOwn(data.datasets.pvz_plants[1],'optional'));
  data.datasets.pvz_plants[0].cost='75';assert.equal(toJson(data,'pvz_plants').rows[0].cost,75);data.datasets.pvz_plants[0].cost='true';assert.throws(()=>toJson(data,'pvz_plants'),/number/);
});
test('manifest imports as editable object fields and never gains an id or rows wrapper',()=>{
  const data=toData(empty().data,'manifest',manifest);assert.equal(data.jsonFormats.manifest.shape,'object');assert.deepEqual(data.datasets.manifest.find(r=>r.id==='wave_counts'),{id:'wave_counts',type:'array',value:'[3,5,8]'});assert.deepEqual(toJson(data,'manifest'),manifest);
  data.datasets.manifest.find(r=>r.id==='wave_counts').value='[4,5,8]';assert.deepEqual(toJson(data,'manifest').wave_counts,[4,5,8]);
});
test('plain arrays and bidirectional aliases roundtrip without changing table identity',()=>{
  const mapping={cols:'columns',gap_s:'interval_s'},json=[{id:'x',columns:9,interval_s:2}];let data=toData(empty().data,'pvz_level',json,mapping);assert.equal(data.datasets.pvz_level[0].cols,'9');assert.deepEqual(toJson(data,'pvz_level'),json);
  data.datasets.pvz_level[0].cols='10';assert.equal(toJson(data,'pvz_level')[0].columns,10);assert.throws(()=>canonical(json,{cols:'columns',rows:'columns'}),/一一对应/);
});
test('strict JSON rejects duplicate keys, unsafe numbers, hostile keys and invalid ID records',()=>{
  for(const text of ['{"a":1,"a":2}','{"x":{"a":1,"a":2}}','{"__proto__":{}}','{"n":9007199254740993}','{"n":1e999}'])assert.throws(()=>parseJson(text));
  assert.throws(()=>canonical([{id:1}]),/字符串 id/);assert.throws(()=>canonical([{id:'x'},{id:'x'}]),/唯一/);
  assert.deepEqual(parseJson('{"quoted":"a, \\"b\\": {}", "list":[null,true]}'),{quoted:'a, "b": {}',list:[null,true]});
});
test('field three-way conflicts preserve independent edits; record deletes require explicit confirmation',()=>{
  const base=canonical([{id:'a',hp:10,name:'A'},{id:'b',hp:20}]),local=structuredClone(base),remote=structuredClone(base);local.rows.a.hp=15;remote.rows.a.hp=12;remote.rows.a.name='B';delete remote.rows.b;
  const diffs=diffJson(local,remote,{local:base,remote:base},'import');assert.equal(diffs.filter(d=>d.conflict).length,1);assert.throws(()=>resolveDiff(local,diffs),/冲突/);
  const decisions=Object.fromEntries(diffs.map(d=>[d.id,{choice:d.conflict?'custom':d.choice,value:'18',allowDelete:true}]));const out=fromCanonical(resolveDiff(local,diffs,decisions));assert.deepEqual(out,[{id:'a',hp:18,name:'B'}]);
  assert.throws(()=>resolveDiff(local,diffs,{...decisions,[diffs.find(d=>d.deletion).id]:{choice:'remote'}}),/删除/);
});
test('first import uses filename stems, repeated import matches tables and archive survives restart',async t=>{
  const f=await fixture(t);await f.put('pvz_plants',plants);await declarePlants(f);await f.put('manifest',manifest);const p=await f.preview();assert.deepEqual(p.rows.map(r=>r.table),['manifest','pvz_plants']);await f.apply(p);
  const store=f.store();assert.deepEqual(Object.keys(store.data.datasets),['manifest','pvz_plants']);validateDataSync(store);readVersions(f.storage,f.key,empty().data);assert.deepEqual(toJson(store.data,'manifest'),manifest);assert.equal((await f.preview()).rows.every(r=>r.differences.length===0),true);
  const again=createEngineSync({storage:f.storage,artFiles:{}});assert.equal((await again.dataPreview({...f.input(),direction:'import'})).history.length,1);
});
async function declarePlants(f) {
  const contract=jsonContract(plants);contract.record.properties.extra.properties.n={type:'null'};contract.record.properties.optional={type:'null'};
  await fs.mkdir(path.join(f.engine,'data/generated/_gamecreator'),{recursive:true});
  await fs.writeFile(path.join(f.engine,'data/generated/_gamecreator/engine-schema.json'),JSON.stringify({schema:1,kind:'gamecreator-engine-schema',tables:{pvz_plants:{contract}}}));
}
test('export modifies selected file only, preserves types, creates backups and undo restores both sides',async t=>{
  const f=await fixture(t);await f.put('pvz_plants',plants);await declarePlants(f);await f.put('manifest',manifest);await f.apply(await f.preview());const s=f.store();s.data.datasets.pvz_plants[0].cost='60';s.revision++;f.set(s);
  const p=await f.preview('export'),entry=await f.apply(p,{selections:[{table:'pvz_plants'}]});assert.equal((await f.get('pvz_plants')).rows[0].cost,60);assert.deepEqual(await f.get('manifest'),manifest);assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.engine,'.gamecreator-sync/data-history',entry.id,'pvz_plants.json'),'utf8')),plants);
  await f.api.dataUndo(f.input());assert.deepEqual(await f.get('pvz_plants'),plants);assert.equal(f.store().data.datasets.pvz_plants[0].cost,'60');
});
test('new local tables require engine creation, then same-structure foreign values require review',async t=>{
  const f=await fixture(t),s=f.store();s.data={datasets:{stats:[{id:'hero',hp:'20'}]},columns:{stats:[{key:'id',label:'id'},{key:'hp',label:'hp',jsonType:'number'}]}};f.set(s);
  assert.match((await f.preview('export')).rows[0].error,/字段不符/);await assert.rejects(()=>f.api.dataApply({token:'invalid',selections:[]}));
  await f.put('stats',{rows:[{id:'hero',hp:80}]});const p=await f.preview('export');assert.ok(p.rows[0].differences.some(d=>d.conflict));await assert.rejects(()=>f.apply(p),/冲突/);
});
test('changed engine files, config, project and local archives invalidate previews',async t=>{
  const f=await fixture(t);await f.put('manifest',manifest);let p=await f.preview();await f.put('manifest',{...manifest,spawn_count:20});await assert.rejects(()=>f.apply(p),/文件已改变/);
  p=await f.preview();const s=f.store();s.revision++;f.set(s);await assert.rejects(()=>f.apply(p),/配置已改变/);
  p=await f.preview();f.storage.setItem('gamecreator.projects.v1',JSON.stringify({activeId:'other',projects:[]}));await assert.rejects(()=>f.apply(p),/项目/);
});
test('one broken file is isolated, missing remote files do not delete tables, invalid paths refused',async t=>{
  const f=await fixture(t);await f.put('manifest',manifest);await fs.writeFile(path.join(f.engine,'data/generated/broken.json'),'{');const p=await f.preview();assert.match(p.rows.find(r=>r.table==='broken').error,/JSON/);await f.apply(p);await fs.unlink(path.join(f.engine,'data/generated/manifest.json'));assert.match((await f.preview()).rows.find(r=>r.table==='manifest').error,/保留本地/);assert.ok(f.store().data.datasets.manifest);
  for(const p of ['../data','/data','C:/data','res://../data','gamecreator/data','.gamecreator-sync/data','x/NUL'])assert.throws(()=>dataDirectory(p));assert.equal(dataDirectory('res://data/generated/'),'data/generated');
});
test('file failure rolls back previous writes; post-sync edits block destructive undo',async t=>{
  let fail=false,count=0;const f=await fixture(t,{beforeDataWrite:async()=>{if(fail&&++count===2)throw new Error('injected failure');}});await f.put('a',manifest);await f.put('b',manifest);await f.apply(await f.preview());let s=f.store();for(const name of ['a','b'])s.data.datasets[name].find(r=>r.id==='spawn_count').value='20';s.revision++;f.set(s);const before=f.storage.getItem(f.key);fail=true;await assert.rejects(async()=>f.apply(await f.preview('export')),/injected/);assert.deepEqual(await f.get('a'),manifest);assert.deepEqual(await f.get('b'),manifest);assert.equal(f.storage.getItem(f.key),before);
  fail=false;await f.apply(await f.preview('export'));s=f.store();s.revision++;f.set(s);await assert.rejects(()=>f.api.dataUndo(f.input()),/配置已编辑/);
});
test('automatic export refuses unbound files, conflicts, engine changes and deletions',async t=>{
  const f=await fixture(t);f.config.autoSync=true;f.storage.setItem('gamecreator.projects.v1',JSON.stringify({activeId:f.projectId,projects:[{id:f.projectId,config:f.config}]}));await f.put('pvz_plants',plants);await declarePlants(f);await f.apply(await f.preview());let s=f.store();s.data.datasets.pvz_plants[0].cost='51';s.revision++;f.set(s);await f.apply(await f.preview('export'),{automatic:true});assert.equal((await f.get('pvz_plants')).rows[0].cost,51);
  await f.put('pvz_plants',{...plants,rows:[{...plants.rows[0],cost:60},plants.rows[1]]});await assert.rejects(async()=>f.apply(await f.preview('export'),{automatic:true}),/自动导出/);
});
test('references and enums cannot be exported with missing values or targets',()=>{
  const data={datasets:{a:[{id:'x',target:'missing'}]},columns:{a:[{key:'id',label:'id'},{key:'target',label:'target',type:'reference',reference:'b'}]}};assert.throws(()=>toJson(data,'a'),/引用/);data.columns.a[1]={key:'target',label:'target',type:'enum',enumId:'missing'};assert.throws(()=>toJson(data,'a'),/枚举/);
});
test('data-only ownership prevents cross-project writes and case-only filenames cannot alias a table',async t=>{
  const f=await fixture(t);await f.put('manifest',manifest);await f.apply(await f.preview());
  const input={...f.input(),projectId:'other'};f.storage.setItem('gamecreator.projects.v1',JSON.stringify({activeId:'other',projects:[{id:'other',config:f.config}]}));await assert.rejects(()=>f.api.dataPreview({...input,direction:'import'}),/另一个项目/);
  f.storage.setItem('gamecreator.projects.v1',JSON.stringify({activeId:f.projectId,projects:[{id:f.projectId,config:f.config}]}));const s=f.store();s.data.datasets.Manifest=[];s.data.columns.Manifest=[{key:'id',label:'id'}];f.set(s);await assert.rejects(()=>f.preview(),/大小写/);
});
test('recovery finishes committed journals and rolls back interrupted writes without overwriting later edits',async t=>{
  const f=await fixture(t);await f.put('manifest',manifest);await f.apply(await f.preview());let s=f.store();s.data.datasets.manifest.find(r=>r.id==='spawn_count').value='20';s.revision++;f.set(s);const entry=await f.apply(await f.preview('export'));
  const transaction=JSON.parse(await fs.readFile(path.join(f.engine,'.gamecreator-sync/data-history',entry.id,'transaction.json'),'utf8')),pending=path.join(f.engine,'.gamecreator-sync/data-pending.json');
  await fs.writeFile(pending,JSON.stringify(transaction));await f.api.dataRecover(f.input());assert.equal((await f.get('manifest')).spawn_count,20);
  f.storage.setItem(f.key,transaction.oldRaw);await fs.writeFile(pending,JSON.stringify(transaction));await f.api.dataRecover(f.input());assert.deepEqual(await f.get('manifest'),manifest);assert.equal(f.storage.getItem(f.key),transaction.oldRaw);
  await fs.writeFile(pending,JSON.stringify(transaction));await f.put('manifest',{...manifest,spawn_count:90});await assert.rejects(()=>f.api.dataRecover(f.input()),/被编辑/);assert.equal((await f.get('manifest')).spawn_count,90);
  await assert.rejects(()=>f.api.recover(f.input()),/数据同步/);await assert.rejects(()=>f.preview(),/中断/);
});
test('linked files are rejected before importing or writing outside the data directory',async t=>{
  const f=await fixture(t),outside=path.join(f.dir,'outside.json');await fs.writeFile(outside,JSON.stringify(manifest));await fs.link(outside,path.join(f.engine,'data/generated/manifest.json'));const p=await f.preview();assert.match(p.rows[0].error,/链接/);await assert.rejects(()=>f.apply(p),/请选择/);assert.deepEqual(JSON.parse(await fs.readFile(outside,'utf8')),manifest);
});
test('simultaneously importing referenced tables validates against the complete merged snapshot',async t=>{
  const f=await fixture(t),s=f.store();s.data={datasets:{a:[],b:[]},columns:{a:[{key:'id',label:'id'},{key:'target',label:'target',type:'reference',reference:'b'}],b:[{key:'id',label:'id'}]}};f.set(s);await f.put('a',[{id:'a1',target:'b1'}]);await f.put('b',[{id:'b1'}]);
  const p=await f.preview();await f.apply(p,{selections:p.rows.map(r=>({table:r.table,decisions:Object.fromEntries(r.differences.map(d=>[d.id,{choice:'remote',allowDelete:true}]))}))});assert.equal(f.store().data.datasets.a[0].target,'b1');
});

function comparisonFile(localJson,remoteJson,mapping={},baseline) {
  const local=canonical(localJson,mapping),remote=canonical(remoteJson,mapping);
  return {table:'level',file:'level.json',shape:(local||remote).shape,local,remote,mapping,differences:diffJson(local,remote,baseline,'import')};
}
test('comparison aligns header keys once and only compares values in shared columns and records',()=>{
  const local=[{id:'a',hp:10,cols:9},{id:'b',hp:20,cols:9}],remote=[{id:'a',hp:12,columns:10},{id:'b',hp:20,columns:10}];
  const f=comparisonFile(local,remote),view=compareDataFile(f);
  assert.deepEqual(view.shared.map(h=>h.key),['id','hp']);assert.deepEqual(view.structuralFields.map(h=>h.key),['cols','columns']);
  assert.deepEqual(view.structuralFields.map(h=>h.group.differences.length),[2,2]);assert.deepEqual(view.valueHeaders.map(h=>h.key),['hp']);assert.deepEqual(view.valueRows.map(r=>r.id),['a']);
  assert.equal(view.valueRows[0].cells[0].local,10);assert.equal(view.valueRows[0].cells[0].remote,12);
  let choices={};for(const h of view.structuralFields)choices=chooseDifferences(h.group.differences,choices,'remote');
  const removals=view.structuralFields.find(h=>h.key==='cols').group.differences;
  assert.ok(removals.every(d=>pendingDifference(d,choices)));assert.throws(()=>resolveDiff(f.local,removals,choices),/删除/);
  for(const d of removals)choices[d.id].allowDelete=true;
  choices=chooseDifferences(view.valueRows.flatMap(r=>r.cells.flatMap(c=>c.differences)),choices,'remote');
  assert.deepEqual(fromCanonical(resolveDiff(f.local,f.differences,choices)),remote);
});
test('alias keys align using canonical names while preserving the engine header label',()=>{
  const mapping={cols:'columns'};
  const local=canonical([{id:'a',columns:9}],mapping),remote=canonical([{id:'a',columns:10}],mapping);
  const f={table:'level',file:'level.json',mapping,local,remote,differences:diffJson(local,remote,undefined,'import')},view=compareDataFile(f);
  assert.equal(view.structuralFields.length,0);assert.equal(view.valueHeaders[0].key,'cols');assert.equal(view.valueHeaders[0].remoteKey,'columns');
  const choices=chooseDifferences(f.differences,{},'remote');assert.deepEqual(fromCanonical(resolveDiff(local,f.differences,choices),mapping),[{id:'a',columns:10}]);
});
test('added files and missing records are structural operations with no repeated value comparisons',()=>{
  const added=compareDataFile(comparisonFile(undefined,[{id:'a',hp:10},{id:'b',hp:20}]));assert.equal(added.files.length,1);assert.equal(added.valueRows.length,0);
  const f=comparisonFile([{id:'a',hp:10},{id:'b',hp:20}],[{id:'a',hp:10},{id:'c',hp:30}]),view=compareDataFile(f);
  assert.deepEqual(view.records.map(r=>r.label),['b','c']);assert.equal(view.valueRows.length,0);assert.equal(view.records[0].differences.length,1);
});
test('objects group nested changes under their header and preserve independent three-way choices',()=>{
  const baseline={local:canonical({settings:{speed:1,hp:10},old:1}),remote:canonical({settings:{speed:1,hp:10},old:1})};
  const f=comparisonFile({settings:{speed:2,hp:10},old:1},{settings:{speed:1,hp:12},new:true},{},baseline),view=compareDataFile(f);
  assert.deepEqual(view.structuralFields.map(h=>h.key),['old','new']);assert.deepEqual(view.valueHeaders.map(h=>h.key),['settings']);assert.equal(view.valueRows[0].cells[0].differences.length,2);
  assert.equal(choiceFor(view.valueRows[0].cells[0].differences,{}),'mixed');
  const decisions=Object.fromEntries(f.differences.map(d=>[d.id,{choice:d.choice,allowDelete:true}]));
  assert.deepEqual(fromCanonical(resolveDiff(f.local,f.differences,decisions)),{settings:{speed:2,hp:12},new:true});
});
test('sparse values and metadata are not dropped when building the comparison view',()=>{
  const f=comparisonFile({schema_version:1,rows:[{id:'a',optional:null},{id:'b',optional:false}]},{schema_version:2,rows:[{id:'a'},{id:'b',optional:true}]}),view=compareDataFile(f);
  assert.equal(view.structuralFields.length,0);assert.equal(view.valueRows[0].cells[0].local,null);assert.equal(view.valueRows[0].cells[0].remoteExists,false);
  const grouped=[...view.files.flatMap(g=>g.differences),...view.structuralFields.flatMap(h=>h.group.differences),...view.records.flatMap(g=>g.differences),...view.valueRows.flatMap(r=>r.cells.flatMap(c=>c.differences)),...view.other];
  assert.deepEqual(grouped.map(d=>d.id).sort(),f.differences.map(d=>d.id).sort());
  const choices=chooseDifferences(f.differences,{},'remote');assert.equal(choiceFor(f.differences,{}),'');
  const d=f.differences[0];assert.ok(pendingDifference(d,{[d.id]:{choice:'custom',value:'{'}}));assert.equal(pendingDifference(d,{[d.id]:{choice:'custom',value:'null'}}),false);
  assert.ok(choices[d.id]);
});
test('preview offers original engine names for mappings and grouped choices apply to the stored table',async t=>{
  const f=await fixture(t);await f.put('level',[{id:'a',columns:9,hp:10},{id:'b',columns:9,hp:20}]);await f.apply(await f.preview('import',{mappings:{level:{cols:'columns'}}}));
  await f.put('level',[{id:'a',columns:10,hp:11},{id:'b',columns:10,hp:22}]);const p=await f.preview(),entry=p.rows[0],view=compareDataFile(entry);
  assert.deepEqual(entry.fields.remote,['id','columns','hp']);assert.equal(view.structuralFields.length,0);assert.ok(entry.fields.local.includes('cols'));
  const decisions=chooseDifferences(view.valueRows.flatMap(r=>r.cells.flatMap(c=>c.differences)),{},'remote');await f.apply(p,{selections:[{table:'level',decisions}]});assert.equal(f.store().data.datasets.level[1].cols,'10');
});


test('schema export covers every development table and stays outside the import scan',async t=>{
  const f=await fixture(t);await f.put('stats',[{id:'a',hp:10}]);await f.apply(await f.preview());
  const result=await f.api.dataSchemaExport(f.input()),doc=JSON.parse(await fs.readFile(result.path,'utf8'));
  assert.equal(doc.kind,'gamecreator-development-schema');assert.equal(doc.tables.stats.contract.record.properties.hp.type,'number');assert.equal((await f.preview()).rows.length,1);
  await f.api.dataSchemaExport(f.input());assert.equal((await fs.readdir(path.join(f.engine,'.gamecreator-sync/schema-history'))).length,1);
});
test('field mismatch blocks writes including automatic sync; imports may still update the development structure',async t=>{
  const f=await fixture(t);await f.put('stats',[{id:'a',hp:10}]);await f.apply(await f.preview());const s=f.store();s.data.columns.stats.push({key:'speed',label:'speed',jsonType:'number'});s.data.datasets.stats[0].speed='3';s.revision++;f.set(s);
  const p=await f.preview('export');assert.match(p.rows[0].error,/字段不符.*speed/);await assert.rejects(()=>f.apply(p,{selections:[{table:'stats'}],automatic:true}));assert.deepEqual(await f.get('stats'),[{id:'a',hp:10}]);
  await f.put('stats',[{id:'a',hp:10,speed:4}]);const incoming=await f.preview();await f.apply(incoming,{selections:[{table:'stats',decisions:Object.fromEntries(incoming.rows[0].differences.map(d=>[d.id,{choice:'remote',allowDelete:true}]))}]});assert.equal(f.store().data.datasets.stats[0].speed,'4');assert.equal((await f.preview('export')).rows[0].error,undefined);
});
test('empty arrays and null require an explicit engine declaration, never the development export',async t=>{
  const f=await fixture(t);await f.put('stats',[{id:'a',tags:[],hint:null}]);await f.apply(await f.preview());await f.api.dataSchemaExport(f.input());assert.match((await f.preview('export')).rows[0].error,/结构无法确认/);
  const contract=jsonContract([{id:'a',tags:['x'],hint:null}]);contract.record.properties.hint={type:'null'};
  await fs.writeFile(path.join(f.engine,'data/generated/_gamecreator/engine-schema.json'),JSON.stringify({schema:1,kind:'gamecreator-engine-schema',tables:{stats:{contract}}}));
  const p=await f.preview('export');assert.equal(p.rows[0].error,undefined);await f.apply(p);
  await f.put('stats',[{id:'a',tags:[12],hint:null}]);assert.match((await f.preview('export')).rows[0].error,/不符/);
});
test('custom conflict values cannot change field structure or types after preview',async t=>{
  const f=await fixture(t);await f.put('stats',[{id:'a',hp:10}]);await f.apply(await f.preview());let s=f.store();s.data.datasets.stats[0].hp='11';s.revision++;f.set(s);await f.put('stats',[{id:'a',hp:12}]);const p=await f.preview('export'),d=p.rows[0].differences.find(d=>d.path.at(-1)==='hp');
  await assert.rejects(()=>f.apply(p,{selections:[{table:'stats',decisions:{[d.id]:{choice:'custom',value:'"wrong"'}}}]}),/类型/);assert.equal((await f.get('stats'))[0].hp,12);
});
test('publish requires all files aligned and human verification, preserves frozen history across imports and restore',async t=>{
  const f=await fixture(t);await f.put('stats',[{id:'a',hp:10}]);await f.apply(await f.preview());const p=await f.preview('export');
  await assert.rejects(()=>f.api.dataPublish({token:p.token,version:'1',note:'first',verified:false}),/验证/);
  await f.api.dataPublish({token:p.token,version:'1',note:'first',verified:true});let s=f.store();const first=s.dataReleases.releases[0];assert.equal(first.data.datasets.stats[0].hp,'10');
  await f.put('stats',[{id:'a',hp:20,newField:'yes'}]);await f.apply(await f.preview());s=f.store();assert.equal(s.dataReleases.releases[0].data.datasets.stats[0].hp,'10');assert.equal(s.data.datasets.stats[0].hp,'20');
  let p2=await f.preview('export');await assert.rejects(()=>f.api.dataPublish({token:p2.token,version:'1',note:'duplicate',verified:true}),/版本号/);
  await f.api.dataPublish({token:p2.token,version:'2',note:'second',verified:true});s=f.store();assert.equal(s.dataReleases.releases.length,2);
  const restored=restoreDataRelease(s,first.id);assert.equal(restored.data.datasets.stats[0].hp,'10');assert.equal(restored.dataReleases.releases[0].version,'2');assert.deepEqual(restored.dataSync.bindings,{});
  assert.equal(readVersions({getItem:()=>JSON.stringify(restored)},'',empty().data).dataReleases.releases.length,2);
  const broken=structuredClone(restored);broken.dataReleases.releases[0].data.columns={};assert.throws(()=>validateDataReleases(broken),/完整/);
});
test('publish rejects changed preview data, missing engine tables and unresolved differences',async t=>{
  const f=await fixture(t);await f.put('stats',[{id:'a',hp:10}]);await f.apply(await f.preview());let p=await f.preview('export');await f.put('stats',[{id:'a',hp:12}]);
  const pub=token=>f.api.dataPublish({token,version:'1',note:'test',verified:true});await assert.rejects(()=>pub(p.token),/已变化/);
  p=await f.preview('export');await assert.rejects(()=>pub(p.token),/尚未完全一致/);await fs.unlink(path.join(f.engine,'data/generated/stats.json'));p=await f.preview('export');await assert.rejects(()=>pub(p.token),/尚未完全一致/);assert.equal(f.store().dataReleases,undefined);
});
test('changing the engine contract after preview invalidates sync and publication',async t=>{
  const f=await fixture(t);await f.put('stats',[{id:'a',hp:10}]);await f.apply(await f.preview());const p=await f.preview('export');await fs.mkdir(path.join(f.engine,'data/generated/_gamecreator'),{recursive:true});await fs.writeFile(path.join(f.engine,'data/generated/_gamecreator/engine-schema.json'),'{}');
  await assert.rejects(()=>f.apply(p),/结构声明已改变/);await assert.rejects(()=>f.api.dataPublish({token:p.token,version:'1',note:'test',verified:true}),/结构声明已改变/);
});
test('schemas compare nested keys and array element types, ignoring field order and record values',()=>{
  const data=toData(empty().data,'a',[{id:'x',obj:{hp:3},tags:['a']}]);
  assert.deepEqual(checkStructure(data,'a',[{tags:['b'],obj:{hp:9},id:'y'}]).issues,[]);
  assert.ok(checkStructure(data,'a',[{id:'x',obj:{health:3},tags:['a']}]).issues.length);
  assert.ok(checkStructure(data,'a',[{id:'x',obj:{hp:3},tags:[1]}]).issues.length);
  data.columns.a.push({key:'pending',label:'pending',jsonType:'number'});data.datasets.a[0].pending='invalid';assert.ok(schemaDocument({...empty(),data}).tables.a.warning);
});


test('reviewed imports upgrade declared primitive types without mutating stable history',async t=>{
  const f=await fixture(t);await f.put('stats',[{id:'a',hp:10}]);await f.apply(await f.preview());let s=f.store();s.data.columns.stats[1].jsonType='number';s.revision++;f.set(s);
  await f.put('stats',[{id:'a',hp:'ten'}]);const p=await f.preview();await f.apply(p,{selections:[{table:'stats',decisions:Object.fromEntries(p.rows[0].differences.map(d=>[d.id,{choice:'remote',allowDelete:true}]))}]});
  assert.equal(f.store().data.columns.stats[1].jsonType,'string');assert.equal(f.store().data.datasets.stats[0].hp,'ten');assert.equal((await f.preview('export')).rows[0].error,undefined);
});
test('inferred JSON does not invent constraints, explicit conflicting declarations and remapping remain blocked',async t=>{
  const f=await fixture(t);await f.put('stats',[{id:'a',kind:'normal'}]);await f.apply(await f.preview());let s=f.store();s.data.columns.stats[1]={key:'kind',label:'类别',type:'enum',options:['normal','elite']};s.revision++;f.set(s);
  assert.equal((await f.preview('export')).rows[0].error,undefined);
  const contract=schemaDocument(s).tables.stats.contract;await fs.mkdir(path.join(f.engine,'data/generated/_gamecreator'),{recursive:true});await fs.writeFile(path.join(f.engine,'data/generated/_gamecreator/engine-schema.json'),JSON.stringify({schema:1,kind:'gamecreator-engine-schema',tables:{stats:{contract}}}));
  assert.equal((await f.preview('export')).rows[0].error,undefined);assert.match((await f.preview('export',{mappings:{stats:{kind:'type'}}})).rows[0].error,/不能修改字段映射/);
  contract.constraints.kind.options=['normal'];await fs.writeFile(path.join(f.engine,'data/generated/_gamecreator/engine-schema.json'),JSON.stringify({schema:1,kind:'gamecreator-engine-schema',tables:{stats:{contract}}}));
  const mismatch=(await f.preview('export')).rows[0];assert.match(mismatch.error,/已声明.*kind/);assert.equal(mismatch.bound,true);
  delete contract.constraints;await fs.writeFile(path.join(f.engine,'data/generated/_gamecreator/engine-schema.json'),JSON.stringify({schema:1,kind:'gamecreator-engine-schema',tables:{stats:{contract}}}));assert.equal((await f.preview('export')).rows[0].error,undefined);

});
test('failed snapshot writes preserve the previous stable version and development data',async t=>{
  const f=await fixture(t);await f.put('stats',[{id:'a',hp:10}]);await f.apply(await f.preview());let p=await f.preview('export');await f.api.dataPublish({token:p.token,version:'1',note:'first',verified:true});
  p=await f.preview('export');const before=f.storage.getItem(f.key),set=f.storage.setItem;f.storage.setItem=(key,value)=>{if(key===f.key)throw new Error('storage full');return set(key,value);};
  await assert.rejects(()=>f.api.dataPublish({token:p.token,version:'2',note:'second',verified:true}),/storage full/);assert.equal(f.storage.getItem(f.key),before);assert.equal((await f.get('stats'))[0].hp,10);
});


test('matching referenced data can sync and publish without a sidecar, while broken references still block writes',async t=>{
  const f=await fixture(t);await f.put('targets',[{id:'t1',label:'target'}]);await f.put('events',[{id:'e1',target:'t1'}]);await f.apply(await f.preview());
  let s=f.store();s.data.columns.events[1]={key:'target',label:'目标',type:'reference',reference:'targets'};s.revision++;f.set(s);
  let p=await f.preview('export');assert.ok(p.rows.every(r=>!r.error&&!r.differences.length));await f.apply(p);
  p=await f.preview('export');await f.api.dataPublish({token:p.token,version:'1',note:'references validated',verified:true});assert.equal(f.store().dataReleases.releases[0].version,'1');
  await f.put('events',[{id:'e1',target:'missing'}]);p=await f.preview('export');const row=p.rows.find(r=>r.table==='events');
  await assert.rejects(()=>f.apply(p,{selections:[{table:'events',decisions:Object.fromEntries(row.differences.map(d=>[d.id,{choice:'remote'}]))}]}),/引用/);assert.equal(f.store().data.datasets.events[0].target,'t1');
});
