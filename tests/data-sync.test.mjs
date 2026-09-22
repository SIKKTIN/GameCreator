import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {parseJson,toData,toJson,canonical,diffJson,resolveDiff,fromCanonical,dataDirectory,validateDataSync} from '../shared/data-sync.mjs';
import {readVersions} from '../src/enum-storage.ts';
const require=createRequire(import.meta.url),{createEngineSync}=require('../desktop/engine-sync.cjs'),{createStorage}=require('../desktop/storage.cjs');
const empty=()=>({schema:1,revision:0,activeId:null,candidateId:null,snapshots:[],reviews:{},releases:[],data:{datasets:{},columns:{}}});
const plants={schema_version:1,author:'test',rows:[{id:'001',name:'sunflower',cost:50,enabled:true,tags:['sun'],extra:{n:null},optional:null},{id:'002',name:'pea',cost:100,enabled:false,tags:[],extra:{}}]};
const manifest={schema_version:1,project_version:'0.1.0',source:'docs/gamecreator/modules/data.md',source_sha256:'0486e81565e769fc5c4594313c5f74c8195a621446b295b6ba156002246dfe8e',wave_counts:[3,5,8],spawn_count:16};
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
  const f=await fixture(t);await f.put('pvz_plants',plants);await f.put('manifest',manifest);const p=await f.preview();assert.deepEqual(p.rows.map(r=>r.table),['manifest','pvz_plants']);await f.apply(p);
  const store=f.store();assert.deepEqual(Object.keys(store.data.datasets),['manifest','pvz_plants']);validateDataSync(store);readVersions(f.storage,f.key,empty().data);assert.deepEqual(toJson(store.data,'manifest'),manifest);assert.equal((await f.preview()).rows.every(r=>r.differences.length===0),true);
  const again=createEngineSync({storage:f.storage,artFiles:{}});assert.equal((await again.dataPreview({...f.input(),direction:'import'})).history.length,1);
});
test('export modifies selected file only, preserves types, creates backups and undo restores both sides',async t=>{
  const f=await fixture(t);await f.put('pvz_plants',plants);await f.put('manifest',manifest);await f.apply(await f.preview());const s=f.store();s.data.datasets.pvz_plants[0].cost='60';s.revision++;f.set(s);
  const p=await f.preview('export'),entry=await f.apply(p,{selections:[{table:'pvz_plants'}]});assert.equal((await f.get('pvz_plants')).rows[0].cost,60);assert.deepEqual(await f.get('manifest'),manifest);assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.engine,'.gamecreator-sync/data-history',entry.id,'pvz_plants.json'),'utf8')),plants);
  await f.api.dataUndo(f.input());assert.deepEqual(await f.get('pvz_plants'),plants);assert.equal(f.store().data.datasets.pvz_plants[0].cost,'60');
});
test('new local table exports with explicit number schema and existing foreign values require review',async t=>{
  const f=await fixture(t),s=f.store();s.data={datasets:{stats:[{id:'hero',hp:'20'}]},columns:{stats:[{key:'id',label:'id'},{key:'hp',label:'hp',jsonType:'number'}]}};f.set(s);await f.apply(await f.preview('export'));assert.equal((await f.get('stats')).rows[0].hp,20);
  const other={schema_version:1,rows:[{id:'hero',hp:80}]};await f.put('stats',other);const p=await f.preview('export');assert.ok(p.rows[0].differences.some(d=>d.conflict));await assert.rejects(()=>f.apply(p),/冲突/);
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
  const f=await fixture(t);f.config.autoSync=true;f.storage.setItem('gamecreator.projects.v1',JSON.stringify({activeId:f.projectId,projects:[{id:f.projectId,config:f.config}]}));await f.put('pvz_plants',plants);await f.apply(await f.preview());let s=f.store();s.data.datasets.pvz_plants[0].cost='51';s.revision++;f.set(s);await f.apply(await f.preview('export'),{automatic:true});assert.equal((await f.get('pvz_plants')).rows[0].cost,51);
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
