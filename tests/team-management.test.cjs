const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID,sign,createPrivateKey}=require('node:crypto');
const {fixture}=require('./authoring-fixture.cjs');
const {createTeamManagement,createTeamManagementServer,canonical,hash}=require('../desktop/team-management.cjs');
async function setup(t){
 const f=await fixture();t.after(f.close);const read=()=>JSON.parse(f.storage.getItem(f.sk)),save=s=>f.storage.setItem(f.sk,JSON.stringify(s));
 const s=read();s.personnel.members[0].permissions=['progress','review','propose','spec_change','project_write','team_manage'];save(s);
 const changes=[],service=createTeamManagement({...f,onChanged:id=>changes.push(id)});
 const draft=(operation,input={},extra={})=>({schema:1,projectId:f.project.id,memberId:f.memberId,credentialId:f.credential.id,session:service.session,at:new Date().toISOString(),id:randomUUID(),operation,input,revision:hash(read()),...extra});
 const signed=(r,secret=f.secret)=>({...r,signature:sign(null,Buffer.from(canonical(r)),createPrivateKey({key:Buffer.from(secret.privateKey,'base64'),type:'pkcs8',format:'der'})).toString('base64')});
 const input=(extra={})=>({name:'程序',duties:'开发与测试',permissions:['progress'],active:true,profile:{positionIds:['program'],taskIds:[],scope:'positions',expiresAt:'',projectModules:[],artPermissions:[]},...extra});
 return {...f,read,save,service,draft,signed,input,changes,call:(op,i={},extra={})=>service.run(signed(draft(op,i,extra)))};
}
test('producer creates, assigns, reuses, rotates and revokes durable identities; retry is atomic and secret-free',async t=>{
 const f=await setup(t),before=f.read(),r=f.draft('create',f.input()),result=await f.service.run(f.signed(r));
 assert.ok(result.secret.privateKey);assert.equal(f.changes.length,1);assert.deepEqual(f.read().tasks,before.tasks);
 assert.equal(f.read().personnel.managementHistory.length,1);assert.ok(!JSON.stringify(f.read()).includes(result.secret.privateKey));
 const replay=await f.service.run(f.signed(r));assert.equal(replay.secret.privateKey,result.secret.privateKey);assert.equal(f.read().personnel.members.length,2);
 await assert.rejects(f.service.run(f.signed({...r,input:f.input({name:'重复'})})),/编号/);
 const update=f.input({memberId:result.memberId,name:'程序开发',duties:'持续负责开发'});await f.call('update',update);
 assert.equal((await f.call('credential',{credentialId:result.credentialId})).secret.privateKey,result.secret.privateKey);
 const rotated=await f.call('rotate',{...update,credentialId:result.credentialId});assert.notEqual(rotated.credentialId,result.credentialId);assert.equal(rotated.memberId,result.memberId);
 await assert.rejects(f.call('credential',{credentialId:result.credentialId}),/撤销/);
 await f.call('revoke',{credentialId:rotated.credentialId});await assert.rejects(f.call('credential',{credentialId:rotated.credentialId}),/撤销/);
 assert.equal(f.read().personnel.members.length,2);assert.equal(f.read().personnel.managementHistory.length,4);
 const {validateProjectSchedule}=await import('../src/project-schedule.ts');validateProjectSchedule(f.read());
});
test('live permission, signature, project, expiry, role and revision checks deny unauthorized mutations',async t=>{
 const f=await setup(t),r=f.draft('create',f.input()),valid=f.signed(r),before=f.read();
 await assert.rejects(f.service.run({...valid,input:f.input({name:'篡改'})}),/签名/);
 await assert.rejects(f.service.run(f.signed({...r,session:'old'})),/过期/);
 await assert.rejects(f.service.run(f.signed({...r,at:'2000-01-01'})),/过期/);
 await assert.rejects(f.service.run(f.signed({...r,projectId:'foreign'})),/对应本地项目/);
 await assert.rejects(f.service.run(f.signed({...r,revision:'stale'})),/已变化/);
 for(const mutate of [s=>s.personnel.members[0].permissions=['project_write'],s=>s.personnel.members[0].active=false,s=>s.personnel.credentials[0].revokedAt=new Date().toISOString(),s=>s.personnel.positions[0].active=false,s=>s.personnel.members[0].developer.expiresAt='2000-01-01']){
  const s=structuredClone(before);mutate(s);f.save(s);await assert.rejects(f.call('create',f.input()),/team_manage/);
 }f.save(before);assert.equal(f.read().personnel.members.length,1);
});
test('delegation cannot escalate, extend expiry, edit own grants, or disguise personnel writes as content',async t=>{
 const f=await setup(t),s=f.read();s.personnel.members[0].permissions=['team_manage','progress'];s.personnel.members[0].developer.expiresAt=new Date(Date.now()+86400000).toISOString();f.save(s);
 await assert.rejects(f.call('create',f.input({permissions:['project_write']})),/自身权限/);
 await assert.rejects(f.call('create',f.input()),/有效期/);
 await assert.rejects(f.call('create',f.input({profile:{...f.input().profile,artPermissions:['style']}})),/素材授权/);
 await assert.rejects(f.call('update',f.input({memberId:f.memberId})),/自己/);
 await assert.rejects(f.call('position',{id:'producer'}),/制作人岗位/);
 assert.equal(f.read().personnel.members.length,1);
});
test('role creation and multi-task assignment preserve production status; failed storage leaves no new identity',async t=>{
 const f=await setup(t);
 await f.call('position',{id:'art-director',name:'主美',duties:'统一风格',active:true,taskKinds:[]});
 const art=await f.call('create',f.input({name:'主美',permissions:['review'],profile:{positionIds:['art-director'],taskIds:[],scope:'positions',expiresAt:'',artPermissions:['style','details','dispatch']}}));assert.ok(art.secret);
 const {createProductionTask}=await import('../src/project-schedule.ts'),s=f.read();s.tasks=[createProductionTask('开发一'),createProductionTask('开发二'),{...createProductionTask('美术一'),kind:'美术'}];f.save(s);
 const p=f.input({profile:{...f.input().profile,taskIds:s.tasks.slice(0,2).map(t=>t.id)}}),result=await f.call('create',p);
 assert.deepEqual(f.read().personnel.members.find(m=>m.id===result.memberId).developer.taskIds,p.profile.taskIds);assert.deepEqual(f.read().tasks,s.tasks);
 await assert.rejects(f.call('update',{...p,memberId:result.memberId,profile:{...p.profile,taskIds:[s.tasks[2].id]}}),/岗位范围/);
 const raw=f.storage.getItem(f.sk),set=f.storage.setItem;f.storage.setItem=(key,value)=>{if(key===f.sk)throw new Error('disk full');return set(key,value);};
 await assert.rejects(f.call('create',f.input({name:'新程序'})),/disk full/);f.storage.setItem=set;assert.equal(f.storage.getItem(f.sk),raw);
});
test('standalone CLI discovers loopback service, creates private files, retries after restart, blocks browser requests',async t=>{
 const f=await setup(t),server=await createTeamManagementServer(f);t.after(()=>server.close());
 const exec=require('node:util').promisify(require('node:child_process').execFile),cli=path.join(f.project.folderPath,'ai/manage-team.cjs'),secretFile=path.join(f.root,'producer.json');fs.writeFileSync(secretFile,JSON.stringify(f.secret));
 const run=(...args)=>exec(process.execPath,[cli,...args]);
 const state=JSON.parse((await run('status',secretFile)).stdout);assert.equal(state.schedule.personnel.members.length,1);
 const draft={id:randomUUID(),operation:'create',revision:state.revision,input:f.input()},draftFile=path.join(f.root,'create.json'),out=path.join(f.root,'program.json');fs.writeFileSync(draftFile,JSON.stringify(draft));
 const created=await run('run',secretFile,draftFile,out),issued=JSON.parse(fs.readFileSync(out));assert.ok(!created.stdout.includes(issued.privateKey));assert.ok(JSON.parse(created.stdout).credentialId);
 await assert.rejects(run('run',secretFile,draftFile,out));assert.equal(f.read().personnel.members.length,2);
 server.close();const second=await createTeamManagementServer(f);t.after(()=>second.close());
 const duplicate=JSON.parse((await run('run',secretFile,draftFile,path.join(f.root,'retry.json'))).stdout);assert.equal(duplicate.replayed,true);assert.equal(f.read().personnel.members.length,2);
 const endpoint=JSON.parse(fs.readFileSync(path.join(f.project.folderPath,'ai/team-service.json'))).endpoint;
 assert.equal((await fetch(endpoint,{method:'POST',headers:{Origin:'http://example.com'},body:'{}'})).status,403);
 assert.equal((await fetch(endpoint,{method:'POST',body:'{}'})).status,400);
});
test('generated producer briefing is actionable at zero tasks and distinguishes docs, private tokens and full art grants',async t=>{
 const f=await setup(t),{credentialMarkdown}=await import('../shared/ai-personnel.mjs');
 const text=credentialMarkdown(f.read(),f.credential);assert.match(text,/零个人任务不等于等待/);assert.match(text,/TEAM_MANAGEMENT/);assert.match(text,/不是令牌/);assert.match(text,/完整编写权/);assert.doesNotMatch(text,/上传已有素材的交付版本/);assert.ok(!text.includes(f.secret.privateKey));
 const s=f.read();s.personnel.members[0].permissions=['project_write'];assert.match(credentialMarkdown(s,f.credential),/当前未授予可执行的团队管理权限/);
});
