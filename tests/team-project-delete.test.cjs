const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {randomUUID}=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const {createCollaborationServer}=require('../server/collaboration.cjs');
const {emptyGameplayCore}=require('../src/gameplay-core.ts');
async function fixture(run){
  const prefix=path.join(os.tmpdir(),'gc-delete-project-'),directory=fs.mkdtempSync(prefix);let service=await createCollaborationServer({directory,port:0});
  const request=async(route,token,method='GET',body)=>{const response=await fetch(service.url+'/api/team'+route,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+(token||'')},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,data:await response.json()};};
  const login=async(user='admin')=>(await request('/login','','POST',{username:user,password:user+'123'})).data.token;
  const admin=await login(),bob=await login('bob'),viewer=await login('viewer');
  const preview=async(id='team-demo',token=admin)=>(await request('/admin/projects/'+id,token)).data;
  const remove=(id,base,token=admin)=>request('/admin/projects/'+id,token,'DELETE',{confirmName:base.project.name,version:base.version});
  const dbop=operation=>{const db=new DatabaseSync(path.join(directory,'team.sqlite'));try{return operation(db);}finally{db.close();}};
  const restart=async()=>{await service.close();service=await createCollaborationServer({directory,port:0});};
  const slow=async(route,token,method,body,during)=>{
    const payload=JSON.stringify(body);let ready;const started=new Promise(r=>ready=r),notice=r=>{if(r.url==='/api/team'+route)ready();};service.server.on('request',notice);
    let client;const done=new Promise((resolve,reject)=>{client=http.request(service.url+'/api/team'+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});client.on('error',reject);client.setTimeout(10000,()=>client.destroy(new Error('timeout')));client.write(payload.slice(0,1));});
    try{await started;await during();client.end(payload.slice(1));return await done;}finally{service.server.off('request',notice);client.destroy();}
  };
  try{await run({request,login,admin,bob,viewer,preview,remove,dbop,restart,slow,url:()=>service.url});}finally{await service.close();assert.ok(path.resolve(directory).startsWith(path.resolve(prefix)));fs.rmSync(directory,{recursive:true,force:true});}
}
const publication=()=>({sourceInstanceId:'delete-source',sourceProjectId:'source-project',name:'同名项目',members:[{userId:'admin',role:'admin'},{userId:'bob',role:'editor'}],
  stories:[{id:'local-story',title:'要删除的故事',category:'世界观',summary:'',content:'团队内容'}],
  overview:{info:{name:'同名项目',genre:'',platform:'PC',version:'',status:'',description:'共享简介'},milestones:[{title:'计划',owner:'',due:'',status:'planned'}]},
  core:{store:emptyGameplayCore(),references:[]}});
test('only server admins can list or delete projects, including those they do not belong to',()=>fixture(async({request,admin,bob,viewer,preview,remove,dbop})=>{
  for(const token of [bob,viewer])for(const [route,method,body]of [['/admin/projects','GET'],['/admin/projects/team-demo','GET'],['/admin/projects/team-demo','DELETE',{}]])assert.equal((await request(route,token,method,body)).status,403);
  dbop(db=>{db.prepare("UPDATE members SET role='admin' WHERE project_id='team-demo' AND user_id='bob'").run();db.prepare("DELETE FROM members WHERE project_id='team-demo' AND user_id='admin'").run();});
  const list=await request('/admin/projects',admin);assert.equal(list.status,200);assert.equal(list.data.projects[0].role,null);
  assert.equal((await request('/admin/projects/team-demo',bob,'DELETE',{})).status,403,'Project administrator alone cannot delete');
  assert.equal((await request('/projects/team-demo/stories',admin)).status,403,'Global deletion privilege does not grant content membership');
  assert.equal((await remove('team-demo',await preview())).status,200);
}));
test('deletion validates exact name, binds preview to project ID and rechecks content and membership versions',()=>fixture(async({request,admin,bob,preview,remove})=>{
  const first=await preview();assert.equal((await request('/admin/projects/team-demo',admin,'DELETE',{version:first.version,confirmName:'wrong'})).status,400);
  const story=(await request('/projects/team-demo/stories/world',bob)).data.story;await request('/projects/team-demo/stories/world',bob,'PUT',{...story,content:'New content'});
  assert.equal((await remove('team-demo',first)).status,409);
  const second=await preview(),members=(await request('/projects/team-demo/members',admin)).data;
  await request('/projects/team-demo/members',admin,'PUT',{revision:members.revision,members:members.members.map(m=>({userId:m.userId,role:m.role,permissions:m.permissions}))});
  assert.equal((await remove('team-demo',second)).status,409);
  const ids=[];for(let i=0;i<2;i++)ids.push((await request('/projects',admin,'POST',{name:'同名项目',members:[{userId:'admin',role:'admin'}],requestId:randomUUID()})).data.project.id);
  assert.equal((await remove(ids[1],await preview(ids[0]))).status,409,'An identical same-name project needs its own preview');
  assert.equal((await preview(ids[1])).deleted,false);
}));
test('deletion removes every shared module, history and membership atomically while preserving accounts and other projects; retry is durable',()=>fixture(async({request,admin,preview,remove,dbop,restart,login})=>{
  const source=publication(),published=await request('/publications',admin,'POST',source),id=published.data.project.id;
  const counts=(await preview(id)).counts;assert.deepEqual(counts,{members:2,stories:1,history:1,overview:1,milestones:1,graphs:1,gameplays:0,gameplayHistory:0});
  const original=dbop(db=>({users:db.prepare('SELECT * FROM users ORDER BY id').all(),stories:db.prepare("SELECT * FROM stories WHERE project_id='team-demo' ORDER BY id").all(),history:db.prepare("SELECT * FROM history WHERE story_id IN (SELECT id FROM stories WHERE project_id='team-demo') ORDER BY story_id,revision").all()}));
  const base=await preview(id),deleted=await remove(id,base);assert.equal(deleted.status,200);assert.equal((await remove(id,base)).data.reused,true);
  assert.equal((await request('/admin/projects',admin)).data.projects.some(p=>p.id===id),false);assert.equal((await request('/projects',admin)).data.projects.some(p=>p.id===id),false);
  for(const endpoint of ['stories','overview','core','members'])assert.equal((await request(`/projects/${id}/${endpoint}`,admin)).status,410);
  dbop(db=>{
    for(const table of ['stories','story_imports','project_overviews','project_milestones','project_activity','core_projects','core_graphs','core_operations','member_permissions','members'])assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id=?`).get(id).n,0,table);
    assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(),original.users);assert.deepEqual(db.prepare("SELECT * FROM stories WHERE project_id='team-demo' ORDER BY id").all(),original.stories);assert.deepEqual(db.prepare('SELECT * FROM history ORDER BY story_id,revision').all(),original.history);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM access_audit WHERE action='删除协作项目'").get().n,1);
  });
  await restart();const again=await login();assert.equal((await remove(id,base,again)).data.reused,true);assert.equal((await preview(id,again)).deleted,true);
}));
test('failure during cleanup rolls back every deleted row and leaves no deletion audit',()=>fixture(async({preview,remove,dbop,request,admin})=>{
  const id=(await request('/publications',admin,'POST',publication())).data.project.id;
  const snapshot=()=>dbop(db=>Object.fromEntries(['projects','stories','history','members','core_graphs','project_overviews','project_milestones','access_audit'].map(t=>[t,db.prepare('SELECT * FROM '+t).all()])));
  const before=snapshot(),base=await preview(id);dbop(db=>db.exec("CREATE TRIGGER fail_deletion BEFORE DELETE ON core_graphs BEGIN SELECT RAISE(ABORT,'injected cleanup failure'); END"));
  assert.equal((await remove(id,base)).status,500);assert.deepEqual(snapshot(),before);dbop(db=>db.exec('DROP TRIGGER fail_deletion'));assert.equal((await remove(id,base)).status,200);
}));
test('old creation/publication retries cannot resurrect deleted projects; explicit re-publication creates a fresh identity',()=>fixture(async({request,admin,preview,remove})=>{
  const creation={name:'创建后删除',members:[{userId:'admin',role:'admin'}],requestId:randomUUID()},created=await request('/projects',admin,'POST',creation);await remove(created.data.project.id,await preview(created.data.project.id));assert.equal((await request('/projects',admin,'POST',creation)).status,410);
  const body=publication(),first=await request('/publications',admin,'POST',body),id=first.data.project.id;await remove(id,await preview(id));
  const lookup=await request('/publications/lookup',admin,'POST',body);assert.equal(lookup.data.publication,null);assert.equal(lookup.data.deletedPublication.projectId,id);
  assert.equal((await request('/publications',admin,'POST',body)).status,410);assert.equal((await request('/publications/core',admin,'POST',body)).status,404);
  const fresh=await request('/publications',admin,'POST',{...body,replacesProjectId:id});assert.equal(fresh.status,201);assert.notEqual(fresh.data.project.id,id);
  const repeat=await request('/publications',admin,'POST',{...body,replacesProjectId:id});assert.equal(repeat.data.project.id,fresh.data.project.id);assert.equal(repeat.data.reused,true);
}));
test('in-flight story saves fail after deletion, and deletion reauthenticates after a streamed body',()=>fixture(async({request,admin,bob,preview,remove,slow,dbop})=>{
  const story=(await request('/projects/team-demo/stories/world',bob)).data.story,base=await preview();
  const write=await slow('/projects/team-demo/stories/world',bob,'PUT',{...story,content:'Must not resurrect'},async()=>{assert.equal((await remove('team-demo',base)).status,200);});assert.equal(write,410);
  const project=(await request('/projects',admin,'POST',{name:'保留项目',members:[{userId:'admin',role:'admin'}],requestId:randomUUID()})).data.project;
  const current=await preview(project.id);
  const deleted=await slow('/admin/projects/'+project.id,admin,'DELETE',{confirmName:project.name,version:current.version},async()=>dbop(db=>db.prepare("UPDATE users SET server_role='member' WHERE id='admin'").run()));
  assert.equal(deleted,403);assert.equal((await request('/projects/'+project.id+'/stories',admin)).status,200);
}));
test('deletion detects overview, milestone and internal graph edits and permits CORS DELETE only for local origins',()=>fixture(async({request,admin,preview,remove,url})=>{
  const id=(await request('/publications',admin,'POST',publication())).data.project.id;
  const initial=await preview(id),overview=(await request('/projects/'+id+'/overview',admin)).data;
  await request('/projects/'+id+'/overview',admin,'PUT',{revision:overview.info.revision,fields:{...overview.info.fields,description:'New overview'}});assert.equal((await remove(id,initial)).status,409);
  const second=await preview(id),milestone=overview.milestones[0];await request(`/projects/${id}/milestones/${milestone.id}`,admin,'PUT',{revision:milestone.revision,fields:{...milestone.fields,title:'Changed milestone'}});assert.equal((await remove(id,second)).status,409);
  const allowed=await fetch(url()+'/api/team/admin/projects/'+id,{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:5188','Access-Control-Request-Method':'DELETE'}});assert.equal(allowed.status,204);assert.ok(allowed.headers.get('access-control-allow-methods').includes('DELETE'));
  const denied=await fetch(url()+'/api/team/admin/projects/'+id,{method:'OPTIONS',headers:{Origin:'https://untrusted.example','Access-Control-Request-Method':'DELETE'}});assert.equal(denied.status,403);
  const third=await preview(id),core=(await request('/projects/'+id+'/core',admin)).data,graph=core.store.graphs[0];
  await request('/projects/'+id+'/core',admin,'PUT',{rootId:core.store.rootId,requestId:randomUUID(),changes:[{id:graph.id,revision:core.versions[graph.id],graph:{...graph,summary:'Changed core'}}]});assert.equal((await remove(id,third)).status,409);
}));
