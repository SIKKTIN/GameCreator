const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {randomUUID}=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const {createCollaborationServer}=require('../server/collaboration.cjs');
const {emptyCoreSnapshot,coreChanges,reconcileCore,withCoreLayout,sameGraph,coreDiff}=require('../src/team-core-model.ts');
const {removeCoreNode}=require('../src/gameplay-core.ts');
const node=(id,childGraphId='')=>({id,kind:childGraphId?'module':'activity',title:id,description:'',x:120,y:130,childGraphId,gameplayIds:[]});
const graph=(id,nodes=[])=>({id,title:id,summary:'',nodes,edges:[]});
const sample=()=>({schema:1,rootId:'root',graphs:[graph('root',[node('module-a','a'),node('module-b','b')]),graph('a',[node('one')]),graph('b',[node('two')])]});
const body=(base,store)=>({rootId:store.rootId,requestId:randomUUID(),changes:coreChanges(base,store)});
async function fixture(run){
  const prefix=path.join(os.tmpdir(),'gc-team-core-'),directory=fs.mkdtempSync(prefix);let service=await createCollaborationServer({directory,port:0});
  const req=async(route,token,method='GET',body)=>{const res=await fetch(service.url+'/api/team'+route,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+(token||'')},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:await res.json()};};
  const login=async(user='admin')=>(await req('/login','','POST',{username:user,password:user+'123'})).data.token;
  const admin=await login(),alice=await login('alice'),bob=await login('bob'),viewer=await login('viewer'),route='/projects/team-demo/core';
  const save=(token,input)=>req(route,token,'PUT',input),read=async(token=admin)=>(await req(route,token)).data;
  const seed=async()=>{const result=await save(admin,body(await read(),sample()));assert.equal(result.status,200,JSON.stringify(result.data));return result.data;};
  const restart=async(edit)=>{await service.close();if(edit){const db=new DatabaseSync(path.join(directory,'team.sqlite'));try{edit(db);}finally{db.close();}}service=await createCollaborationServer({directory,port:0});};
  try{await run({req,login,admin,alice,bob,viewer,read,save,seed,directory,restart,get service(){return service;}});}finally{await service.close();assert.ok(path.resolve(directory).startsWith(path.resolve(prefix)));fs.rmSync(directory,{recursive:true,force:true});}
}
test('core graph versions allow independent edits and reject same-graph conflicts; retries create one activity',()=>fixture(async({seed,save,read,alice,bob,admin,req})=>{
  const base=await seed(),a=structuredClone(base.store),b=structuredClone(base.store);a.graphs.find(g=>g.id==='a').summary='Alice';b.graphs.find(g=>g.id==='b').summary='Bob';
  const first=body(base,a);assert.equal((await save(alice,first)).status,200);assert.equal((await save(bob,body(base,b))).status,200);
  const current=await read();assert.equal(current.store.graphs.find(g=>g.id==='a').summary,'Alice');assert.equal(current.store.graphs.find(g=>g.id==='b').summary,'Bob');assert.equal(current.versions.root,1);
  const activity=(await req('/projects/team-demo/overview',admin)).data.activity;
  assert.equal((await save(alice,first)).status,200);assert.deepEqual((await req('/projects/team-demo/overview',admin)).data.activity,activity);
  a.graphs.find(g=>g.id==='a').summary='late';const conflict=await save(bob,body(base,a));assert.equal(conflict.status,409);assert.equal(conflict.data.currentRecord.versions.a,2);
  assert.deepEqual(await read(),current);
}));
test('positions, array ordering and navigation create no shared versions or activity; viewers cannot write content',()=>fixture(async({seed,save,read,alice,viewer,admin,req})=>{
  const base=await seed(),before=(await req('/projects/team-demo/overview',admin)).data.activity;
  const moved=withCoreLayout(base.store,{'one':{x:999,y:777}});assert.deepEqual(coreChanges(base,moved),[]);
  const g=moved.graphs.find(g=>g.id==='a');assert.equal((await save(alice,{rootId:'root',requestId:randomUUID(),changes:[{id:'a',revision:1,graph:g}]})).status,200);
  assert.deepEqual(await read(),base);assert.deepEqual((await req('/projects/team-demo/overview',admin)).data.activity,before);
  g.summary='real edit';assert.equal((await save(viewer,body(base,moved))).status,403);
  assert.equal((await save(alice,body(base,moved))).status,200);assert.equal((await read()).store.graphs.find(g=>g.id==='a').nodes[0].x,120,'Existing initial position cannot be overwritten even with content edits');
}));
test('deleting parent validates all descendant revisions and atomically rejects new descendants; tombstones prevent stale resurrection',()=>fixture(async({seed,save,read,alice,bob})=>{
  const base=await seed(),removed=removeCoreNode(base.store,'root','module-a'),edited=structuredClone(base.store);edited.graphs.find(g=>g.id==='a').summary='child update';
  assert.equal((await save(bob,body(base,edited))).status,200);assert.equal((await save(alice,body(base,removed))).status,409);
  let current=await read();assert.equal(current.store.graphs.length,3);
  const added=structuredClone(current.store);added.graphs.find(g=>g.id==='a').nodes.push(node('nested','nested'));added.graphs.push(graph('nested',[node('deep')]));
  assert.equal((await save(bob,body(current,added))).status,200);
  const missing=body(current,removeCoreNode(current.store,'root','module-a'));missing.changes.find(c=>c.id==='a').revision=3;
  assert.equal((await save(alice,missing)).status,409,'Cannot omit a newly created descendant');
  current=await read();assert.equal((await save(alice,body(current,removeCoreNode(current.store,'root','module-a')))).status,200);
  const deleted=await read();assert.equal(deleted.store.graphs.length,2);assert.ok(deleted.versions.nested>0);
  assert.equal((await save(bob,body(base,edited))).status,409);assert.deepEqual(await read(),deleted);
}));
test('whole-tree validation rejects broken edges, duplicated node IDs and orphan graphs without partial writes',()=>fixture(async({seed,save,read,admin})=>{
  const base=await seed();
  for(const change of [s=>s.graphs.find(g=>g.id==='a').edges.push({id:'bad',fromId:'one',toId:'missing',label:'',condition:''}),s=>s.graphs.find(g=>g.id==='b').nodes.push(node('one')),s=>s.graphs.push(graph('orphan'))]){
    const bad=structuredClone(base.store);change(bad);assert.equal((await save(admin,body(base,bad))).status,409);assert.deepEqual(await read(),base);
  }
  const cyclic=structuredClone(base.store);cyclic.graphs.find(g=>g.id==='a').edges.push({id:'loop',fromId:'one',toId:'one',label:'again',condition:'keep playing'});assert.equal((await save(admin,body(base,cyclic))).status,200);
}));
test('core permission migration and legacy clients preserve overrides; streamed writes reauthorize after revocation',()=>fixture(async(ctx)=>{
  const {req,admin,bob,save,read,seed,restart,login}=ctx;const base=await seed();
  const members=[{userId:'admin',role:'admin'},{userId:'bob',role:'editor',permissions:{overview:'edit',stories:'view',core:'view'}}];
  let current=(await req('/projects/team-demo/members',admin)).data;
  assert.equal((await req('/projects/team-demo/members',admin,'PUT',{revision:current.revision,members})).status,200);
  current=(await req('/projects/team-demo/members',admin)).data;
  const legacy=members.map(m=>({...m,...(m.permissions?{permissions:{overview:'edit',stories:'view'}}:{})}));
  assert.equal((await req('/projects/team-demo/members',admin,'PUT',{revision:current.revision,members:legacy})).status,200);
  assert.equal((await read(bob)).capabilities.core,'view');assert.equal((await save(bob,body(base,base.store))).status,403);
  current=(await req('/projects/team-demo/members',admin)).data;members[1].permissions.core='edit';
  await req('/projects/team-demo/members',admin,'PUT',{revision:current.revision,members});
  const next=structuredClone(base.store);next.graphs[1].summary='in flight';const payload=JSON.stringify(body(base,next));
  let ready;const waiting=new Promise(r=>ready=r);const notice=r=>{if(r.url.endsWith('/core'))ready();};ctx.service.server.on('request',notice);
  let client;const result=new Promise((resolve,reject)=>{client=http.request(ctx.service.url+'/api/team/projects/team-demo/core',{method:'PUT',headers:{Authorization:'Bearer '+bob,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});client.on('error',reject);client.write(payload.slice(0,1));});
  await waiting;ctx.service.server.off('request',notice);current=(await req('/projects/team-demo/members',admin)).data;members[1].permissions.core='view';await req('/projects/team-demo/members',admin,'PUT',{revision:current.revision,members});client.end(payload.slice(1));assert.equal(await result,403);assert.equal((await read()).versions.a,1);
  await restart(db=>db.exec('ALTER TABLE member_permissions DROP COLUMN core'));const updated=await login('bob');const migrated=await read(updated);assert.deepEqual(migrated.capabilities,{overview:'edit',stories:'view',core:'edit',gameplay:'edit',schedule:'view'});
}));
test('publication preserves IDs, source references and initial layout; supplement is one-time and races safely with team edits',()=>fixture(async({req,admin,read,save,directory})=>{
  const source={sourceInstanceId:'core-source',sourceProjectId:'local'},core={store:sample(),references:[{id:'local-design',title:'来源战斗玩法'}]};core.store.graphs[1].nodes[0].gameplayIds=['local-design'];
  const publication={...source,name:'发布核心',members:[{userId:'admin',role:'admin'}],stories:[],core};
  const bad=structuredClone(publication);bad.core.store.graphs[0].nodes[0].childGraphId='missing';assert.equal((await req('/publications',admin,'POST',bad)).status,400);
  assert.equal((await req('/publications/lookup',admin,'POST',source)).data.publication,null);
  const result=await req('/publications',admin,'POST',publication);assert.equal(result.status,201);assert.equal(result.data.coreInitialized,true);
  const stored=(await req('/projects/'+result.data.project.id+'/core',admin)).data;assert.deepEqual(stored.references,core.references);assert.deepEqual(new Set(stored.store.graphs.map(g=>g.id)),new Set(core.store.graphs.map(g=>g.id)));assert.equal(stored.versions.a,1);
  assert.equal((await req('/publications/core',admin,'POST',{...source,core})).status,409);
  const old={...publication,sourceProjectId:'old'};delete old.core;const previous=await req('/publications',admin,'POST',old);assert.equal(previous.data.coreInitialized,false);
  const supplements=await Promise.all([req('/publications/core',admin,'POST',{...source,sourceProjectId:'old',core}),req('/publications/core',admin,'POST',{...source,sourceProjectId:'old',core})]);assert.deepEqual(supplements.map(r=>r.status).sort(),[200,409]);
  const third=await req('/publications',admin,'POST',{...old,sourceProjectId:'race'});const route='/projects/'+third.data.project.id+'/core',blank=(await req(route,admin)).data;
  const races=await Promise.all([req(route,admin,'PUT',body(blank,sample())),req('/publications/core',admin,'POST',{...source,sourceProjectId:'race',core})]);assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
  const db=new DatabaseSync(path.join(directory,'team.sqlite'));assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);db.close();
}));
test('draft reconciliation keeps independent remote work and personal layouts; hierarchy conflicts retain the original draft',()=>{
  const base={...emptyCoreSnapshot(),store:sample(),initialized:true,versions:{root:1,a:1,b:1}};
  const mine=structuredClone(base.store);mine.graphs[1].summary='mine';const remote=structuredClone(base);remote.store.graphs[2].summary='theirs';remote.versions.b++;
  const result=reconcileCore({base,store:mine},remote);assert.deepEqual(result.conflicts,[]);assert.equal(result.draft.store.graphs.find(g=>g.id==='b').summary,'theirs');assert.equal(coreChanges(result.draft.base,result.draft.store).length,1);
  const moved=withCoreLayout(result.draft.store,{one:{x:700,y:300}});assert.ok(sameGraph(moved.graphs[1],result.draft.store.graphs[1]));
  const removed=structuredClone(remote);removed.store=removeCoreNode(remote.store,'root','module-a');removed.versions.a++;removed.versions.root++;
  const retained=reconcileCore({base,store:mine},removed);assert.ok(retained.conflicts.includes('a'));assert.deepEqual(retained.draft.store,mine);
  assert.ok(coreDiff(base.store.graphs[1],mine.graphs[1]).some(v=>v.includes('mine')));
});
module.exports={sample};
