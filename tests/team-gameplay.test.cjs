const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {randomUUID}=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const {createCollaborationServer}=require('../server/collaboration.cjs');
const {gameplayPatch,withGameplayLayout}=require('../src/team-gameplay-model.ts');
const {sample}=require('./gameplay-fixture.cjs');
const body=(base,store)=>({...gameplayPatch(base,store),requestId:randomUUID()});
async function fixture(run){
  const prefix=path.join(os.tmpdir(),'gc-team-gameplay-'),directory=fs.mkdtempSync(prefix);let service=await createCollaborationServer({directory,port:0});
  const req=async(route,token,method='GET',body)=>{const res=await fetch(service.url+'/api/team'+route,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+(token||'')},body:body===undefined?undefined:JSON.stringify(body)});return{status:res.status,data:await res.json()};};
  const login=async(user='admin')=>(await req('/login','','POST',{username:user,password:user+'123'})).data.token;
  const admin=await login(),alice=await login('alice'),bob=await login('bob'),viewer=await login('viewer'),route='/projects/team-demo/gameplay';
  const save=(token,input)=>req(route,token,'PUT',input),read=async(token=admin)=>(await req(route,token)).data;
  const seed=async()=>{const r=await save(admin,body(await read(),sample()));assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
  const restart=async(edit)=>{await service.close();const db=new DatabaseSync(path.join(directory,'team.sqlite'));try{edit(db);}finally{db.close();}service=await createCollaborationServer({directory,port:0});};
  try{await run({req,admin,alice,bob,viewer,read,save,seed,login,restart,directory,get service(){return service;}});}finally{await service.close();assert.ok(path.resolve(directory).startsWith(path.resolve(prefix)));fs.rmSync(directory,{recursive:true,force:true});}
}
test('independent gameplay documents save concurrently; same document conflicts across tabs; retries and history are durable',()=>fixture(async({seed,read,save,req,admin,alice,bob})=>{
  const base=await seed(),a=structuredClone(base.store),b=structuredClone(base.store);a.designs.find(d=>d.id==='combat').rules='Alice规则';b.designs.find(d=>d.id==='growth').timeline.events[0].start=12;
  const first=body(base,a);assert.equal((await save(alice,first)).status,200);assert.equal((await save(bob,body(base,b))).status,200);
  const latest=await read();assert.equal(latest.versions.combat,2);assert.equal(latest.versions.growth,2);assert.equal(latest.store.designs.find(d=>d.id==='combat').rules,'Alice规则');
  const activity=(await req('/projects/team-demo/overview',admin)).data.activity;assert.equal((await save(alice,first)).status,200);assert.deepEqual((await req('/projects/team-demo/overview',admin)).data.activity,activity);
  a.designs.find(d=>d.id==='combat').stateFlow.states[0].description='stale state';assert.equal((await save(bob,body(base,a))).status,409);assert.deepEqual(await read(),latest);
  const history=(await req('/projects/team-demo/gameplay/combat/history',alice)).data.history;assert.deepEqual(history.map(h=>h.revision),[2,1]);assert.equal(history[0].updatedBy,'alice');assert.equal(history[0].design.rules,'Alice规则');
}));
test('room layouts and view changes produce no shared revision; real spatial changes are shared; viewer writes are forbidden',()=>fixture(async({seed,read,save,req,admin,alice,viewer})=>{
  const base=await seed(),before=(await req('/projects/team-demo/overview',admin)).data.activity,moved=withGameplayLayout(structuredClone(base.store),{combat:{'room-a':{x:900,y:600}}});moved.designs.find(d=>d.id==='combat').space.spatial.view='rooms';
  assert.equal((await save(alice,{requestId:randomUUID(),changes:[{id:'combat',revision:1,design:moved.designs.find(d=>d.id==='combat')}]})).status,200);assert.deepEqual(await read(),base);assert.deepEqual((await req('/projects/team-demo/overview',admin)).data.activity,before);
  moved.designs.find(d=>d.id==='combat').space.objects[0].column=4;assert.equal((await save(viewer,body(base,moved))).status,403);assert.equal((await save(alice,body(base,moved))).status,200);
  const after=await read();assert.equal(after.versions.combat,2);assert.equal(after.store.designs.find(d=>d.id==='combat').space.objects[0].column,4);assert.notEqual(after.store.designs.find(d=>d.id==='combat').space.spatial.rooms[0].x,900);
}));
test('server validates cross-document references against latest data and category/doc updates are atomic',()=>fixture(async({seed,read,save,admin,alice,bob})=>{
  const base=await seed(),bad=structuredClone(base.store);bad.designs.find(d=>d.id==='combat').space.objects=[];assert.equal((await save(alice,body(base,bad))).status,409);assert.deepEqual(await read(),base);
  bad.designs.find(d=>d.id==='growth').timeline.events[0].objectId='';assert.equal((await save(alice,body(base,bad))).status,200);
  const latest=await read(),rename=structuredClone(latest.store);rename.categories[0].name='分类一';assert.equal((await save(bob,body(latest,rename))).status,200);
  const stale=structuredClone(latest.store);stale.categories=[];stale.designs.find(d=>d.id==='combat').categoryId='';stale.designs.find(d=>d.id==='growth').summary='atomic';assert.equal((await save(alice,body(latest,stale))).status,409);assert.notEqual((await read()).store.designs.find(d=>d.id==='growth').summary,'atomic');
  const final=await read(),remove=structuredClone(final.store);remove.categories=[];remove.designs.find(d=>d.id==='combat').categoryId='';assert.equal((await save(admin,body(final,remove))).status,200);
}));
test('module permission is independent, survives legacy member configuration, and reauthorizes streamed writes',()=>fixture(async ctx=>{
  const {seed,req,read,save,admin,bob,login,restart}=ctx,base=await seed();
  const set=async permission=>{const current=(await req('/projects/team-demo/members',admin)).data;return req('/projects/team-demo/members',admin,'PUT',{revision:current.revision,members:current.members.map(m=>({userId:m.userId,role:m.role,...(m.userId==='bob'?{permissions:permission}:{})}))});};
  assert.equal((await set({overview:'edit',stories:'edit',core:'edit',gameplay:'view'})).status,200);await set({overview:'edit',stories:'edit',core:'edit'});assert.equal((await read(bob)).capabilities.gameplay,'view');assert.equal((await save(bob,body(base,base.store))).status,403);
  await set({overview:'edit',stories:'edit',core:'view',gameplay:'edit'});const next=structuredClone(base.store);next.designs[0].summary='in flight';const payload=JSON.stringify(body(base,next));let ready;const waiting=new Promise(r=>ready=r),notice=r=>{if(r.url.endsWith('/gameplay'))ready();};ctx.service.server.on('request',notice);
  let client;const result=new Promise((resolve,reject)=>{client=http.request(ctx.service.url+'/api/team/projects/team-demo/gameplay',{method:'PUT',headers:{Authorization:'Bearer '+bob,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});client.on('error',reject);client.write(payload.slice(0,1));});
  await waiting;ctx.service.server.off('request',notice);await set({overview:'edit',stories:'edit',core:'view',gameplay:'view'});client.end(payload.slice(1));assert.equal(await result,403);assert.equal((await read()).versions.combat,1);
  await restart(db=>db.exec('ALTER TABLE member_permissions DROP COLUMN gameplay'));const migrated=await read(await login('bob'));assert.equal(migrated.capabilities.gameplay,'edit');assert.equal(migrated.capabilities.core,'view');
}));
test('publication and supplement preserve stable gameplay IDs, map story IDs, are atomic and prevent overwriting team edits',()=>fixture(async({req,admin,directory})=>{
  const source={sourceInstanceId:'gameplay-source',sourceProjectId:'local'},store=sample();store.designs[0].links=[{kind:'story',targetId:'story-local'},{kind:'dataset',targetId:'items'}];
  const gameplay={store,references:[{designId:'combat',kind:'story',targetId:'story-local',title:'世界背景'},{designId:'combat',kind:'dataset',targetId:'items',title:'物品'}]},story={id:'story-local',title:'世界背景',category:'世界观',status:'草稿',summary:'',content:'团队故事',tags:[],outlines:[],relations:{characters:[],locations:[],systems:[]}};
  const publication={...source,name:'发布玩法',members:[{userId:'admin',role:'admin'}],stories:[story],gameplay};
  const bad=structuredClone(publication);bad.gameplay.store.designs[0].space.rows=-1;assert.equal((await req('/publications',admin,'POST',bad)).status,400);assert.equal((await req('/publications/lookup',admin,'POST',source)).data.publication,null);
  const result=await req('/publications',admin,'POST',publication);assert.equal(result.status,201,JSON.stringify(result.data));assert.equal(result.data.gameplayInitialized,true);const id=result.data.project.id,stored=(await req(`/projects/${id}/gameplay`,admin)).data,stories=(await req(`/projects/${id}/stories`,admin)).data.stories;
  assert.equal(stored.store.designs.find(d=>d.id==='combat').links[0].targetId,stories[0].id);assert.notEqual(stories[0].id,'story-local');assert.equal(stored.references.find(r=>r.kind==='story').targetId,stories[0].id);assert.equal(stored.store.designs.find(d=>d.id==='growth').timeline.events[0].objectId,'actor');
  assert.equal((await req('/publications/gameplay',admin,'POST',{...source,gameplay})).status,409);
  const old={...publication,sourceProjectId:'old'};delete old.gameplay;const previous=await req('/publications',admin,'POST',old);assert.equal(previous.data.gameplayInitialized,false);const supplement={...source,sourceProjectId:'old',gameplay};const races=await Promise.all([req('/publications/gameplay',admin,'POST',supplement),req('/publications/gameplay',admin,'POST',supplement)]);assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
  const db=new DatabaseSync(path.join(directory,'team.sqlite'));assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();
}));
test('core links require existing team designs; project deletion fingerprints gameplay changes and cleans all gameplay data',()=>fixture(async({seed,req,read,save,admin,directory})=>{
  const base=await seed(),node={id:'node',title:'节点',kind:'activity',description:'',x:0,y:0,childGraphId:'',gameplayIds:['combat']},graph={id:'root',title:'根',summary:'',nodes:[node],edges:[]};
  const core={requestId:randomUUID(),rootId:'root',changes:[{id:'root',revision:0,graph}]};assert.equal((await req('/projects/team-demo/core',admin,'PUT',core)).status,200);node.gameplayIds=['unknown'];core.changes[0].revision=1;core.requestId=randomUUID();assert.equal((await req('/projects/team-demo/core',admin,'PUT',core)).status,409);
  const preview=(await req('/admin/projects/team-demo',admin)).data;assert.equal(preview.counts.gameplays,2);assert.equal(preview.counts.gameplayHistory,2);
  const edited=structuredClone(base.store);edited.designs[0].summary='after preview';await save(admin,body(base,edited));assert.equal((await req('/admin/projects/team-demo',admin,'DELETE',{confirmName:preview.project.name,version:preview.version})).status,409);
  const latest=(await req('/admin/projects/team-demo',admin)).data;assert.equal((await req('/admin/projects/team-demo',admin,'DELETE',{confirmName:latest.project.name,version:latest.version})).status,200);assert.equal((await req('/projects/team-demo/gameplay',admin)).status,410);
  const db=new DatabaseSync(path.join(directory,'team.sqlite'));for(const table of ['gameplay_projects','gameplay_documents','gameplay_history','gameplay_operations'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table} WHERE project_id='team-demo'`).get().n,0);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();
}));
