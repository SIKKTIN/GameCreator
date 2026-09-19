const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {randomUUID}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {createCollaborationServer}=require('../server/collaboration.cjs');
const overview={name:'权限验收',genre:'',platform:'',version:'',status:'',description:'受限概览'};
const milestone={title:'受限里程碑',owner:'',due:'',status:'planned'};
const member=(userId,role,permissions)=>({userId,role,...(permissions?{permissions}:{})});
const defaults={overview:'inherit',stories:'inherit'};
async function fixture(run){
  const prefix=path.join(os.tmpdir(),'gc-access-'),directory=fs.mkdtempSync(prefix);let service=await createCollaborationServer({directory,port:0});
  const request=async(route,token,method='GET',body)=>{const response=await fetch(service.url+'/api/team'+route,{method,headers:{Authorization:'Bearer '+(token||''),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  const login=async(username,password=username+'123')=>{const result=await request('/login','','POST',{username,password});assert.equal(result.status,200);return result.data.token;};
  const restart=async(change)=>{const id=service.serverId;await service.close();if(change){const db=new DatabaseSync(path.join(directory,'team.sqlite'));try{change(db);}finally{db.close();}}service=await createCollaborationServer({directory,port:0});assert.equal(service.serverId,id);};
  const members=async(token,project,list)=>{const current=await request('/projects/'+project+'/members',token);assert.equal(current.status,200);return request('/projects/'+project+'/members',token,'PUT',{revision:current.data.revision,members:list});};
  const account=async(token,id)=>{const result=await request('/admin/users',token);assert.equal(result.status,200);return result.data.accounts.find(item=>item.id===id);};
  const create=async(token,username='new-user',serverRole='member')=>{const result=await request('/admin/users',token,'POST',{username,password:'UserPass-123',serverRole});assert.equal(result.status,201);return result.data.account;};
  const slowWrite=async(route,token,method,body,during)=>{
    const payload=JSON.stringify(body);let resolveReady;const ready=new Promise(resolve=>resolveReady=resolve);
    const notice=request=>{if(request.url==='/api/team'+route){service.server.off('request',notice);resolveReady();}};service.server.on('request',notice);
    let client;const response=new Promise((resolve,reject)=>{client=http.request(service.url+'/api/team'+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,data:JSON.parse(Buffer.concat(chunks))}));});client.on('error',reject);client.setTimeout(5000,()=>client.destroy(new Error('Slow request timeout')));client.write(payload.slice(0,1));});
    try{await ready;await during();client.end(payload.slice(1));return await response;}finally{service.server.off('request',notice);client.destroy();}
  };
  try{await run({request,login,restart,members,account,create,slowWrite,directory});}finally{await service.close();assert.ok(path.resolve(directory).startsWith(path.resolve(prefix)));fs.rmSync(directory,{recursive:true,force:true});}
}

test('default overview is admin-only; module grants are per project, revocable, persistent and cannot bypass viewer roles',()=>fixture(async({request,login,members,restart})=>{
  let admin=await login('admin');const bob=await login('bob'),alice=await login('alice'),viewer=await login('viewer');
  for(const token of [bob,alice,viewer]){
    assert.equal((await request('/projects/team-demo/overview',token)).status,200);
    assert.equal((await request('/projects/team-demo/overview',token,'PUT',{revision:0,fields:overview,role:'admin',capabilities:{overview:'edit'}})).status,403);
    assert.equal((await request('/projects/team-demo/milestones/'+randomUUID(),token,'PUT',{revision:0,fields:milestone})).status,403);
    assert.equal((await request('/admin/users',token)).status,403);assert.equal((await request('/admin/audit',token)).status,403);
  }
  const original=(await request('/projects/team-demo/stories/world',bob)).data.story;
  assert.equal((await request('/projects/team-demo/stories/world',bob,'PUT',{...original,content:'默认故事可编辑'})).status,200);
  const grant=[member('admin','admin'),member('bob','editor',{overview:'edit',stories:'view'}),member('alice','editor'),member('viewer','viewer')];
  assert.equal((await members(admin,'team-demo',grant)).status,200);
  assert.equal((await request('/projects/team-demo/overview',bob,'PUT',{revision:0,fields:overview})).status,200);
  assert.equal((await request('/projects/team-demo/milestones/'+randomUUID(),bob,'PUT',{revision:0,fields:milestone})).status,200);
  assert.equal((await request('/projects/team-demo/stories/world',bob,'PUT',{...original,revision:2})).status,403);
  assert.equal((await request('/projects/team-demo/stories',bob,'POST',original)).status,403);
  assert.equal((await request('/projects/team-demo/stories/import',bob,'POST',{})).status,403);
  const second=await request('/projects',admin,'POST',{name:'另一项目',requestId:randomUUID(),members:[member('admin','admin'),member('bob','editor')]});assert.equal(second.status,201);
  assert.deepEqual((await request('/projects/'+second.data.project.id+'/overview',bob)).data.capabilities,{overview:'view',stories:'edit'});
  assert.equal((await request('/projects/'+second.data.project.id+'/overview',bob,'PUT',{revision:0,fields:overview})).status,403);
  const invalid=await members(admin,'team-demo',[member('admin','admin'),member('viewer','viewer',{overview:'edit',stories:'inherit'})]);assert.equal(invalid.status,400);
  // Legacy role-only updates retain the explicitly assigned module restrictions.
  assert.equal((await members(admin,'team-demo',grant.map(({userId,role})=>({userId,role})))).status,200);
  assert.deepEqual((await request('/projects/team-demo/stories',bob)).data.capabilities,{overview:'edit',stories:'view'});
  const stale=(await request('/projects/team-demo/members',admin)).data;
  const competing=await Promise.all([request('/projects/team-demo/members',admin,'PUT',{revision:stale.revision,members:grant}),request('/projects/team-demo/members',admin,'PUT',{revision:stale.revision,members:grant})]);assert.deepEqual(competing.map(item=>item.status).sort(),[200,409]);
  await restart();admin=await login('admin');const newBob=await login('bob');assert.deepEqual((await request('/projects/team-demo/overview',newBob)).data.capabilities,{overview:'edit',stories:'view'});
  assert.equal((await members(admin,'team-demo',grant.map(item=>item.userId==='bob'?{...item,permissions:defaults}:item))).status,200);
  assert.equal((await request('/projects/team-demo/overview',newBob,'PUT',{revision:1,fields:overview})).status,403);
  assert.equal((await request('/projects/team-demo/stories/world',newBob,'PUT',{...original,revision:2})).status,200);
}));

test('account creation, password reset, disable and enable preserve identity/history and invalidate old sessions',()=>fixture(async({request,login,create,account,members,restart,directory})=>{
  let admin=await login('admin');const bob=await login('bob');
  const input={username:' Writer.New ',password:'UserPass-123',serverRole:'member'};
  assert.equal((await request('/admin/users',bob,'POST',input)).status,403);
  for(const invalid of [{...input,username:'x'},{...input,password:'short'},{...input,serverRole:'owner'}])assert.equal((await request('/admin/users',admin,'POST',invalid)).status,400);
  const created=(await request('/admin/users',admin,'POST',input));assert.equal(created.status,201);const user=created.data.account;assert.equal(user.username,'writer.new');assert.notEqual(user.id,user.username);
  assert.equal((await request('/admin/users',admin,'POST',input)).status,409);
  assert.deepEqual(Object.keys(user).sort(),['enabled','id','revision','serverRole','username']);
  let writer=await login('writer.new','UserPass-123');assert.deepEqual((await request('/projects',writer)).data.projects,[]);
  await members(admin,'team-demo',[member('admin','admin'),member(user.id,'editor')]);
  const original=(await request('/projects/team-demo/stories/world',writer)).data.story;await request('/projects/team-demo/stories/world',writer,'PUT',{...original,content:'新账号的贡献'});
  const reset=await request('/admin/users/'+user.id+'/password',admin,'POST',{revision:1,password:'NextPass-123'});assert.equal(reset.status,200);
  assert.equal((await request('/projects',writer)).status,401);assert.equal((await request('/login','','POST',{username:user.username,password:'UserPass-123'})).status,401);
  writer=await login(user.username,'NextPass-123');
  let current=await account(admin,user.id);assert.equal((await request('/admin/users/'+user.id,admin,'PUT',{revision:current.revision,enabled:false,serverRole:'member'})).status,200);
  assert.equal((await request('/projects/team-demo/stories/world',writer)).status,401);assert.equal((await request('/login','','POST',{username:user.username,password:'NextPass-123'})).status,401);
  current=await account(admin,user.id);assert.equal((await request('/admin/users/'+user.id,admin,'PUT',{revision:current.revision,enabled:true,serverRole:'member'})).status,200);
  assert.equal((await request('/projects',writer)).status,401,'Re-enabling must not revive an old token');
  const db=new DatabaseSync(path.join(directory,'team.sqlite'));try{const row=db.prepare('SELECT salt,hash FROM users WHERE id=?').get(user.id);assert.notEqual(row.hash,'NextPass-123');assert.equal(row.hash.length,128);}finally{db.close();}
  const events=(await request('/admin/audit',admin)).data.audit;assert.equal(events.length,5);assert.ok(!JSON.stringify(events).includes('NextPass-123'));assert.ok(!JSON.stringify(events).includes('UserPass-123'));
  await restart();admin=await login('admin');writer=await login(user.username,'NextPass-123');
  assert.equal((await request('/projects/team-demo/stories/world',writer)).data.story.updatedBy,user.username);
  assert.equal((await request('/projects/team-demo/stories/world/history',writer)).data.history.length,2);
  assert.equal((await account(admin,user.id)).id,user.id);
}));

test('administrator protection, account revisions and server role changes apply to existing sessions',()=>fixture(async({request,login,create,account,members})=>{
  const admin=await login('admin'),bob=await login('bob');
  assert.equal((await request('/admin/users/admin',admin,'PUT',{revision:1,enabled:true,serverRole:'member'})).status,400);
  const backup=await create(admin,'backup-admin','admin'),backupToken=await login(backup.username,'UserPass-123');
  assert.equal((await request('/projects/team-demo/overview',backupToken)).status,403,'Server admin does not implicitly become a project member');
  assert.equal((await request('/admin/users/admin',admin,'PUT',{revision:1,enabled:false,serverRole:'admin'})).status,400,'Last active project admin is protected even with another server admin');
  const race=await Promise.all([request('/admin/users/bob',admin,'PUT',{revision:1,enabled:true,serverRole:'admin'}),request('/admin/users/bob',backupToken,'PUT',{revision:1,enabled:true,serverRole:'member'})]);assert.deepEqual(race.map(item=>item.status).sort(),[200,409]);
  let current=await account(admin,'bob');
  if(current.serverRole!=='admin'){await request('/admin/users/bob',admin,'PUT',{revision:current.revision,enabled:true,serverRole:'admin'});current=await account(admin,'bob');}
  assert.equal((await request('/admin/users',bob)).status,200,'Promotion affects the current session');
  await request('/admin/users/bob',admin,'PUT',{revision:current.revision,enabled:true,serverRole:'member'});
  assert.equal((await request('/admin/users',bob)).status,403,'Demotion affects the current session');
  assert.equal((await request('/admin/users/'+backup.id,bob,'PUT',{revision:1,enabled:false,serverRole:'member'})).status,403);
  await members(admin,'team-demo',[member('admin','admin'),member('bob','admin')]);
  assert.equal((await request('/admin/users/admin',backupToken,'PUT',{revision:1,enabled:false,serverRole:'admin'})).status,200);
  assert.equal((await request('/admin/users',admin)).status,401);
  const last=await account(backupToken,backup.id);assert.equal((await request('/admin/users/'+backup.id,backupToken,'PUT',{revision:last.revision,enabled:false,serverRole:'admin'})).status,400);
}));

test('credentials and module permissions are rechecked after a slow request body before any write',()=>fixture(async({request,login,slowWrite,account,members})=>{
  const admin=await login('admin');let bob=await login('bob');const route='/projects/team-demo/stories/world';
  const story=(await request(route,bob)).data.story;
  const result=await slowWrite(route,bob,'PUT',{...story,content:'不能写入'},async()=>{const current=await account(admin,'bob');assert.equal((await request('/admin/users/bob/password',admin,'POST',{revision:current.revision,password:'NewBob-123'})).status,200);});
  assert.equal(result.status,401);assert.equal((await request(route,admin)).data.story.revision,1);
  bob=await login('bob','NewBob-123');
  const revoked=await slowWrite(route,bob,'PUT',{...story,content:'撤权后不能写入'},async()=>{assert.equal((await members(admin,'team-demo',[member('admin','admin'),member('bob','editor',{overview:'inherit',stories:'view'})])).status,200);});
  assert.equal(revoked.status,403);assert.equal((await request(route,admin)).data.story.revision,1);
}));

test('a demoted server administrator cannot finish a previously authorized slow account-creation request',()=>fixture(async({request,login,create,slowWrite})=>{
  const admin=await login('admin'),backup=await create(admin,'another-admin','admin'),other=await login(backup.username,'UserPass-123');
  const result=await slowWrite('/admin/users',admin,'POST',{username:'must-not-exist',password:'NeverSaved-123',serverRole:'admin'},async()=>{
    assert.equal((await request('/admin/users/admin',other,'PUT',{revision:1,enabled:true,serverRole:'member'})).status,200);
  });
  assert.equal(result.status,403);assert.equal((await request('/admin/users',other)).data.accounts.some(item=>item.username==='must-not-exist'),false);
}));

test('API 5 migration preserves old columns, content, memberships and legacy creation retry signatures',()=>fixture(async({request,login,restart,directory})=>{
  let admin=await login('admin');const creation={name:'旧创建记录',requestId:randomUUID(),members:[member('admin','admin'),member('bob','editor')]};
  const created=await request('/projects',admin,'POST',creation);assert.equal(created.status,201);
  let before,users;
  await restart(db=>{
    db.prepare('UPDATE project_creations SET signature=?').run(JSON.stringify({name:creation.name,members:creation.members}));
    db.exec('DROP TABLE member_permissions; DROP TABLE access_audit; ALTER TABLE users DROP COLUMN enabled; ALTER TABLE users DROP COLUMN revision; ALTER TABLE users DROP COLUMN auth_revision;');
    before=Object.fromEntries(['projects','members','stories','history','project_publications','project_overviews','project_milestones'].map(table=>[table,db.prepare('SELECT * FROM '+table).all()]));users=db.prepare('SELECT * FROM users').all();
  });
  admin=await login('admin');const bob=await login('bob');assert.equal((await request('/projects',admin,'POST',creation)).data.project.id,created.data.project.id);
  assert.equal((await request('/projects/team-demo/overview',bob)).data.capabilities.overview,'view');
  const db=new DatabaseSync(path.join(directory,'team.sqlite'));try{for(const [table,rows]of Object.entries(before))assert.deepEqual(db.prepare('SELECT * FROM '+table).all(),rows);
    assert.deepEqual(db.prepare('SELECT id,username,salt,hash,server_role FROM users').all(),users);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM access_audit').get().n,0);
  }finally{db.close();}
}));

test('a failure recording a permission change rolls back credentials, membership versions and module overrides together',t=>fixture(async({request,login,directory})=>{
  const admin=await login('admin'),bob=await login('bob'),db=new DatabaseSync(path.join(directory,'team.sqlite'));
  const before=db.prepare('SELECT * FROM users WHERE id=?').get('bob'),members=(await request('/projects/team-demo/members',admin)).data;
  db.exec("CREATE TRIGGER reject_access_audit BEFORE INSERT ON access_audit BEGIN SELECT RAISE(ABORT,'injected audit failure'); END;");const logs=t.mock.method(console,'error',()=>{});
  try{
    assert.equal((await request('/admin/users/bob/password',admin,'POST',{revision:1,password:'NotSaved-123'})).status,500);assert.deepEqual(db.prepare('SELECT * FROM users WHERE id=?').get('bob'),before);assert.equal((await request('/projects',bob)).status,200);
    assert.equal((await request('/projects/team-demo/members',admin,'PUT',{revision:members.revision,members:[member('admin','admin'),member('bob','editor',{overview:'edit',stories:'view'})]})).status,500);
    assert.deepEqual((await request('/projects/team-demo/members',admin)).data,members);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project_activity').get().n,0);
  }finally{logs.mock.restore();db.close();}
}));
