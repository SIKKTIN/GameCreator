const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {randomUUID}=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const {createCollaborationServer}=require('../server/collaboration.cjs');
const {createProductionTask,createProductionMilestone,removeProductionTask,removeProductionMilestone}=require('../src/project-schedule.ts');
const {scheduleChanges,reconcileSchedule,validateScheduleDraft}=require('../src/team-schedule-model.ts');
const {removeScheduleRelease}=require('../src/schedule-releases.ts');
const sample=()=>({schema:1,tasks:[{...createProductionTask('任务甲'),id:'task-a',start:'2026-10-01',end:'2026-10-02',milestoneId:'mile'},{...createProductionTask('任务乙'),id:'task-b',start:'2026-10-03',end:'2026-10-05',milestoneId:'mile',dependencyIds:['task-a']}],milestones:[{...createProductionMilestone('第一阶段'),id:'mile',due:'2026-10-10',acceptance:'形成可玩的闭环'}]});
const body=(base,store)=>({requestId:randomUUID(),changes:scheduleChanges(base,store)});
async function fixture(run){
  const prefix=path.join(os.tmpdir(),'gc-team-schedule-'),directory=fs.mkdtempSync(prefix);let service=await createCollaborationServer({directory,port:0});
  const req=async(route,token,method='GET',body)=>{const r=await fetch(service.url+'/api/team'+route,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+(token||'')},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json()};};
  const login=async(user='admin')=>(await req('/login','','POST',{username:user,password:user+'123'})).data.token;
  const admin=await login(),alice=await login('alice'),bob=await login('bob'),viewer=await login('viewer'),route='/projects/team-demo/schedule';
  const read=async(token=admin)=>(await req(route,token)).data,save=(token,input)=>req(route,token,'PUT',input);
  const grant=async(token=admin,changes={alice:'edit',bob:'edit'})=>{const members=(await req('/projects/team-demo/members',token)).data;return req('/projects/team-demo/members',token,'PUT',{revision:members.revision,members:members.members.map(m=>({userId:m.userId,role:m.role,permissions:{...m.permissions,...(changes[m.userId]?{schedule:changes[m.userId]}:{})}}))});};
  const seed=async()=>{const r=await save(admin,body(await read(),sample()));assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
  const dbop=fn=>{const db=new DatabaseSync(path.join(directory,'team.sqlite'));try{return fn(db);}finally{db.close();}};
  const restart=async edit=>{await service.close();if(edit)dbop(edit);service=await createCollaborationServer({directory,port:0});};
  try{await run({req,admin,alice,bob,viewer,read,save,seed,grant,login,restart,dbop,get service(){return service;}});}finally{await service.close();assert.ok(path.resolve(directory).startsWith(path.resolve(prefix)));fs.rmSync(directory,{recursive:true,force:true});}
}
test('milestone confirmation rechecks current tasks and reopening invalidates review atomically',()=>fixture(async({seed,admin,viewer,read,save,req})=>{
 let base=await seed(),next=structuredClone(base.store);next.milestones[0].status='已验收';next.milestones[0].review='不能提前验收';assert.equal((await save(admin,body(base,next))).status,409);
 next=structuredClone(base.store);next.tasks.forEach(t=>t.status='已完成');assert.equal((await save(admin,body(base,next))).status,200);base=await read();
 next=structuredClone(base.store);next.milestones[0].status='已验收';next.milestones[0].review='人工核验通过';assert.equal((await save(viewer,body(base,next))).status,403);assert.equal((await save(admin,body(base,next))).status,200);base=await read();
 next=structuredClone(base.store);next.tasks[0].status='进行中';assert.equal((await save(admin,body(base,next))).status,200);const reopened=await read();assert.equal(reopened.store.milestones[0].status,'进行中');assert.equal(reopened.store.milestones[0].review,'人工核验通过');assert.equal(reopened.versions.mile,base.versions.mile+1);
 assert.equal((await req('/projects/team-demo/overview',admin)).data.milestones[0].fields.status,'active');
 next=structuredClone(base.store);next.milestones[0].review='迟到的重复签收';assert.equal((await save(admin,body(base,next))).status,409);
}));

test('schedule defaults to view; grants are per-project and legacy permission updates retain them',()=>fixture(async({req,admin,alice,bob,viewer,read,save,grant,seed,restart,login})=>{
  const base=await seed();for(const token of [alice,bob,viewer]){assert.equal((await read(token)).capabilities.schedule,'view');assert.equal((await save(token,{...body(base,base.store),role:'admin',capabilities:{schedule:'edit'}})).status,403);}
  assert.equal((await grant()).status,200);assert.equal((await read(bob)).capabilities.schedule,'edit');
  const members=(await req('/projects/team-demo/members',admin)).data;
  const old=members.members.map(m=>{const p={...m.permissions};delete p.schedule;return{userId:m.userId,role:m.role,permissions:p};});
  assert.equal((await req('/projects/team-demo/members',admin,'PUT',{revision:members.revision,members:old})).status,200);assert.equal((await read(bob)).capabilities.schedule,'edit');
  const second=(await req('/projects',admin,'POST',{name:'另一项目',requestId:randomUUID(),members:[{userId:'admin',role:'admin'},{userId:'bob',role:'editor'}]})).data.project;
  assert.equal((await req('/projects/'+second.id+'/schedule',bob)).data.capabilities.schedule,'view');assert.equal((await req('/projects/'+second.id+'/schedule',alice)).status,403);
  assert.equal((await grant(admin,{bob:'view'})).status,200);assert.equal((await save(bob,body(base,base.store))).status,403);
  await restart(db=>db.exec('ALTER TABLE member_permissions DROP COLUMN schedule'));assert.equal((await read(await login('alice'))).capabilities.schedule,'view');
}));
test('different tasks merge, same record conflicts, date edits are content, no-op views create no history and retries are idempotent',()=>fixture(async({seed,grant,read,save,alice,bob,admin,req})=>{
  const base=await seed();await grant();const a=structuredClone(base.store),b=structuredClone(base.store);a.tasks.find(t=>t.id==='task-a').owner='Alice';b.tasks.find(t=>t.id==='task-b').result='Bob 验证';
  const first=body(base,a);assert.equal((await save(alice,first)).status,200);assert.equal((await save(bob,body(base,b))).status,200);
  const current=await read();assert.equal(current.versions['task-a'],2);assert.equal(current.versions['task-b'],2);assert.equal(current.versions.mile,1);
  assert.equal(reconcileSchedule({base,store:b},current).conflicts.length,0);assert.equal(reconcileSchedule({base,store:b},current).draft.store.tasks.find(t=>t.id==='task-a').owner,'Alice');
  const history=(await req('/projects/team-demo/schedule/history',admin)).data;
  assert.equal((await save(alice,first)).status,200);assert.deepEqual((await req('/projects/team-demo/schedule/history',admin)).data,history);
  const reordered={...current.store,tasks:[...current.store.tasks].reverse()};assert.deepEqual(scheduleChanges(current,reordered),[]);await save(alice,body(current,reordered));assert.deepEqual((await req('/projects/team-demo/schedule/history',admin)).data,history);
  a.tasks.find(t=>t.id==='task-a').end='2026-10-04';const conflict=await save(bob,body(base,a));assert.equal(conflict.status,409);assert.ok(reconcileSchedule({base,store:a},current).conflicts.includes('task-a'));
  const moved=structuredClone(current.store);moved.tasks.find(t=>t.id==='task-a').end='2026-10-04';assert.equal((await save(alice,body(current,moved))).status,200);assert.equal((await read()).versions['task-a'],3);
  assert.throws(()=>validateScheduleDraft({base:current,store:{...sample(),schema:99}}));
}));
test('concurrent dependencies block stale deletion, cleanup is atomic, tombstones block resurrection and cycles reject',()=>fixture(async({seed,grant,read,save,alice,bob,req,admin})=>{
  const base=await seed();await grant();const added=structuredClone(base.store);added.tasks.push({...createProductionTask('新依赖'),id:'new',dependencyIds:['task-a']});assert.equal((await save(bob,body(base,added))).status,200);
  assert.equal((await save(alice,body(base,removeProductionTask(base.store,'task-a')))).status,409);assert.equal((await read()).store.tasks.length,3);
  let current=await read();const cyclic=structuredClone(current.store);cyclic.tasks.find(t=>t.id==='task-a').dependencyIds=['task-b'];assert.equal((await save(alice,body(current,cyclic))).status,409);assert.deepEqual(await read(),current);
  assert.equal((await save(alice,body(current,removeProductionTask(current.store,'task-a')))).status,200);const deleted=await read();assert.equal(deleted.versions['task-a'],2);assert.ok(deleted.store.tasks.every(t=>!t.dependencyIds.length));
  const stale=structuredClone(base.store);stale.tasks[0].title='迟到的更改';assert.equal((await save(bob,body(base,stale))).status,409);
  current=await read();assert.equal((await save(alice,body(current,removeProductionMilestone(current.store,'mile')))).status,200);assert.ok((await read()).store.tasks.every(t=>!t.milestoneId));assert.equal((await req('/projects/team-demo/overview',admin)).data.milestones.length,0);
  const h=(await req('/projects/team-demo/schedule/history',admin)).data.history;assert.ok(h.some(r=>r.id==='task-a'&&r.fields===null));
}));
test('legacy milestones migrate with stable identity and rich fields; overview shares versions and schedule authorization',()=>fixture(async({req,admin,bob,grant,read,save,restart,login,dbop})=>{
  const id=randomUUID(),fields={title:'旧里程碑',owner:'admin',due:'日期待定',status:'active'};
  dbop(db=>db.prepare('INSERT INTO project_milestones VALUES(?,?,?,?,?,?)').run('team-demo',id,JSON.stringify(fields),7,'2026-09-01T00:00:00.000Z','admin'));
  const base=await read();assert.equal(base.versions[id],7);assert.equal(base.store.milestones[0].id,id);assert.ok(base.store.milestones[0].description.includes('日期待定'));
  await grant();const next=structuredClone(base.store);next.milestones[0].acceptance='完整验收标准';assert.equal((await save(bob,body(base,next))).status,200);
  const overview=(await req('/projects/team-demo/overview',admin)).data;assert.equal(overview.milestones[0].revision,8);
  assert.equal((await req('/projects/team-demo/milestones/'+id,bob,'PUT',{revision:8,fields:{...fields,due:'2026-10-20',title:'概览修改'}})).status,200);
  const updated=await read();assert.equal(updated.versions[id],9);assert.equal(updated.store.milestones[0].acceptance,'完整验收标准');assert.equal(updated.store.milestones[0].title,'概览修改');
  await grant(admin,{bob:'view'});assert.equal((await req('/projects/team-demo/milestones/'+id,bob,'PUT',{revision:9,fields})).status,403);
  await restart();const persisted=await read(await login());assert.deepEqual(persisted.store,updated.store);assert.deepEqual(persisted.versions,updated.versions);
}));
test('publication is complete and atomic; old publication supplement protects existing milestones; project deletion includes schedules',()=>fixture(async({req,admin,dbop})=>{
  const publication={sourceInstanceId:randomUUID(),sourceProjectId:'local',name:'完整排期',members:[{userId:'admin',role:'admin'}],stories:[],overview:{info:{name:'完整排期',genre:'',platform:'',version:'',status:'',description:''},milestones:[]},schedule:{store:sample(),references:[]}};
  publication.schedule.store.releases=[{id:'publish-release',title:'v0.3.0',description:'发布公共说明'}];publication.schedule.store.milestones[0].releaseId='publish-release';
  const bad=structuredClone(publication);bad.schedule.store.tasks[0].end='2026-02-31';assert.equal((await req('/publications',admin,'POST',bad)).status,400);assert.equal((await req('/publications/lookup',admin,'POST',bad)).data.publication,null);
  const first=await req('/publications',admin,'POST',publication);assert.equal(first.status,201,JSON.stringify(first.data));const id=first.data.project.id;
  const read=(await req('/projects/'+id+'/schedule',admin)).data;assert.equal(read.store.milestones.length,1);assert.deepEqual(read.store.releases,publication.schedule.store.releases);assert.equal(read.store.milestones[0].releaseId,'publish-release');assert.equal((await req('/projects/'+id+'/overview',admin)).data.milestones.length,1);
  assert.equal((await req('/publications',admin,'POST',publication)).data.project.id,id);assert.equal((await req('/publications/schedule',admin,'POST',publication)).status,409);
  const legacy={...publication,sourceProjectId:'old'};delete legacy.schedule;const old=(await req('/publications',admin,'POST',legacy)).data;
  assert.equal((await req('/publications/schedule',admin,'POST',{...publication,sourceProjectId:'old'})).status,200);assert.equal((await req('/projects/'+old.project.id+'/schedule',admin)).data.store.tasks.length,2);
  const before=(await req('/admin/projects/'+id,admin)).data;assert.equal(before.counts.scheduleTasks,2);assert.equal(before.counts.scheduleHistory,4);
  const changed=structuredClone(read.store);changed.tasks[0].description='删除确认期间更改';assert.equal((await req('/projects/'+id+'/schedule',admin,'PUT',body(read,changed))).status,200);
  assert.equal((await req('/admin/projects/'+id,admin,'DELETE',{confirmName:before.project.name,version:before.version})).status,409);
  const fresh=(await req('/admin/projects/'+id,admin)).data;assert.equal((await req('/admin/projects/'+id,admin,'DELETE',{confirmName:fresh.project.name,version:fresh.version})).status,200);
  for(const route of ['/schedule','/schedule/history'])assert.equal((await req('/projects/'+id+route,admin)).status,410);
  dbop(db=>{for(const table of ['schedule_history','schedule_records','schedule_operations','schedule_projects'])assert.equal(db.prepare('SELECT COUNT(*) AS n FROM '+table+' WHERE project_id=?').get(id).n,0);});
}));
test('streamed schedule write rechecks permission after body arrives',()=>fixture(async ctx=>{
  const {seed,grant,bob,admin,save,read}=ctx,base=await seed();await grant();const changed=structuredClone(base.store);changed.tasks[0].description='in flight';const payload=JSON.stringify(body(base,changed));
  let ready;const waiting=new Promise(r=>ready=r),notice=r=>{if(r.url.endsWith('/schedule'))ready();};ctx.service.server.on('request',notice);
  let client;const result=new Promise((resolve,reject)=>{client=http.request(ctx.service.url+'/api/team/projects/team-demo/schedule',{method:'PUT',headers:{Authorization:'Bearer '+bob,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},r=>{r.resume();r.on('end',()=>resolve(r.statusCode));});client.on('error',reject);client.write(payload.slice(0,1));});
  await waiting;ctx.service.server.off('request',notice);await grant(admin,{bob:'view'});client.end(payload.slice(1));assert.equal(await result,403);assert.deepEqual((await read()).store,base.store);assert.equal((await save(bob,body(base,changed))).status,403);
}));

test('failed history write rolls back all records, mirrored milestones and activity',()=>fixture(async({seed,admin,read,save,req,dbop})=>{
  const base=await seed(),before=(await req('/projects/team-demo/overview',admin)).data,next=structuredClone(base.store);next.tasks[0].owner='rollback';next.milestones[0].title='不能部分写入';
  dbop(db=>db.exec("CREATE TRIGGER reject_schedule_history BEFORE INSERT ON schedule_history WHEN NEW.revision > 1 BEGIN SELECT RAISE(ABORT,'QA history failure'); END"));
  assert.equal((await save(admin,body(base,next))).status,500);assert.deepEqual(await read(),base);assert.deepEqual((await req('/projects/team-demo/overview',admin)).data,before);
}));


test('release metadata shares schedule permissions, independent edits merge, and legacy clients retain membership',()=>fixture(async({seed,grant,read,save,admin,alice,bob,viewer,restart,login,req})=>{
  const base=await seed(),next={...base.store,releases:[{id:'release',title:'v0.3.0',description:'共享版本背景'}],milestones:base.store.milestones.map(m=>({...m,releaseId:'release'}))};
  assert.equal((await save(viewer,body(base,next))).status,403);assert.equal((await save(admin,body(base,next))).status,200);await grant();
  const shared=await read(),a=structuredClone(shared.store),b=structuredClone(shared.store);a.releases[0].description='Alice 版本目标';b.tasks[0].result='Bob 任务结果';
  assert.equal((await save(alice,body(shared,a))).status,200);assert.equal((await save(bob,body(shared,b))).status,200);
  b.releases[0].description='过期改动';assert.equal((await save(bob,body(shared,b))).status,409);
  const latest=await read(),legacy={...latest.store.milestones[0],owner:'旧客户端编辑'};delete legacy.releaseId;
  assert.equal((await save(admin,{requestId:randomUUID(),changes:[{id:legacy.id,kind:'milestone',revision:latest.versions[legacy.id],fields:legacy}]})).status,200);
  assert.equal((await read()).store.milestones[0].releaseId,'release');assert.equal((await read()).store.releases[0].description,'Alice 版本目标');
  assert.ok((await req('/projects/team-demo/schedule/history',admin)).data.history.some(h=>h.kind==='release'));
  await restart();const restored=await read(await login());assert.equal(restored.store.releases[0].description,'Alice 版本目标');assert.equal(restored.store.tasks.find(t=>t.id==='task-a').result,'Bob 任务结果');
}));

test('release deletion rejects concurrent membership, then detaches milestones atomically without removing tasks',()=>fixture(async({seed,grant,read,save,admin,alice,bob})=>{
  const base=await seed(),next={...base.store,releases:[{id:'release',title:'v0.3.0',description:'背景'}],milestones:base.store.milestones.map(m=>({...m,releaseId:'release'}))};
  await save(admin,body(base,next));await grant();const shared=await read();
  const b=structuredClone(shared.store);b.milestones.push({...createProductionMilestone('新增阶段'),id:'new-mile',releaseId:'release'});
  assert.equal((await save(bob,body(shared,b))).status,200);
  assert.equal((await save(alice,body(shared,removeScheduleRelease(shared.store,'release')))).status,409);
  const current=await read(),removed=removeScheduleRelease(current.store,'release');
  assert.equal((await save(alice,body(current,removed))).status,200);const after=await read();
  assert.deepEqual(after.store.releases,[]);assert.equal(after.store.milestones.length,2);assert.ok(after.store.milestones.every(m=>m.releaseId===''));assert.deepEqual(after.store.tasks,current.store.tasks);
  const stale={requestId:randomUUID(),changes:[{id:'release',kind:'release',revision:shared.versions.release,fields:next.releases[0]}]};assert.equal((await save(bob,stale)).status,409);
  assert.deepEqual(reconcileSchedule({base:shared,store:removeScheduleRelease(shared.store,'release')},current).conflicts.length>0,true);
}));
