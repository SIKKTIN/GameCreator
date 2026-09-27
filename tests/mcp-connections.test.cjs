const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID,randomBytes,createPrivateKey,sign}=require('node:crypto'),{spawn}=require('node:child_process'),readline=require('node:readline');
const {fixture}=require('./authoring-fixture.cjs');
const {createWorkflowService}=require('../desktop/workflow-service.cjs');
const {createMcpConnections}=require('../desktop/mcp-connections.cjs');
const {createGlobalClient}=require('../shared/workflow-global-mcp.cjs');
const {canonical}=require('../shared/workflow-mcp.cjs');
async function setup(t,options={}){
 const a=await fixture(),b=await fixture();a.project.name='项目 A';b.project.name='项目 B';
 for(const f of [a,b]){f.file=path.join(f.root,'credential.json');fs.writeFileSync(f.file,JSON.stringify(f.secret));const engine=path.join(f.root,'engine');fs.mkdirSync(engine);fs.writeFileSync(path.join(engine,'project.godot'),'config_version=5');f.project.config.projectPath=engine;const cat=JSON.parse(f.storage.getItem('gamecreator.projects.v1'));cat.projects[0]=f.project;f.storage.setItem('gamecreator.projects.v1',JSON.stringify(cat));}
 const select=id=>{const f=[a,b].find(f=>f.project.id===id);if(!f)throw new Error('项目未登记');return f;};
 const storeFor=key=>{const f=[a,b].find(f=>key.includes(f.project.id));if(!f)throw new Error('未绑定的项目存档');return f.storage;};
 const storage={directory:a.storage.directory,getItem:key=>key==='gamecreator.projects.v1'?JSON.stringify({schema:2,activeId:a.project.id,mode:'project',projects:[a.project,b.project]}):storeFor(key).getItem(key),setItem:(key,value)=>storeFor(key).setItem(key,value),info:key=>storeFor(key).info(key)};
 const folders={verify:id=>select(id).folders.verify(id)},developers={read(){throw new Error('不得从软件凭证库代签');}};
 const makeWorkflow=()=>createWorkflowService({storage,folders,developers,artFiles:{},...options});let workflow=makeWorkflow();
 const directory=path.join(a.root,'global-mcp');let broker=await createMcpConnections({directory,storage,folders,developers,workflow});
 const clients=[],client=()=>{const c=createGlobalClient({discoveryFile:broker.discoveryFile});clients.push(c);return c;};
 const bind=(c,f=a)=>c.call('gc_connect_credential',{credentialFile:f.file});
 const call=(c,f,connectionId,tool,args={})=>c.call(tool,{connectionId,credentialFile:f.file,...args});
 t.after(async()=>{await Promise.all(clients.map(c=>c.close()));broker.close();a.close();b.close();});
 return {a,b,client,bind,call,directory,get broker(){return broker;},get workflow(){return workflow;},async restart(){await new Promise(resolve=>broker.server.close(resolve));workflow=makeWorkflow();broker=await createMcpConnections({directory,storage,folders,developers,workflow});},approve(c,ids){broker.manage('session',{id:c.sessionId,connectionIds:ids});}};
}

test('valid credential self-binds without UI or vault; every call requires matching proof and targets one project',async t=>{
 const f=await setup(t),c=f.client(),other=f.client();assert.equal(f.broker.manage('status').connections.length,0);
 assert.deepEqual((await c.call('gc_connections')).connections,[]);
 const bound=await f.bind(c),ca=bound.connection.id,cb=(await f.bind(other,f.b)).connection.id;assert.equal(bound.access,'ready');assert.equal(bound.policy,'credential');assert.equal((await f.bind(c)).connection.id,ca);
 assert.deepEqual((await c.call('gc_connections')).connections.map(x=>x.id),[ca]);
 await assert.rejects(c.call('gc_project_read',{connectionId:ca}),/credentialFile/);
 await assert.rejects(f.call(c,f.b,ca,'gc_project_read'),/不匹配/);
 const [a,b]=await Promise.all([f.call(c,f.a,ca,'gc_project_read'),f.call(other,f.b,cb,'gc_project_read')]);assert.equal(a.projectId,f.a.project.id);assert.equal(b.projectId,f.b.project.id);
 const requestId=randomUUID();const exports=await Promise.all([f.call(c,f.a,ca,'gc_collaboration_export',{requestId}),f.call(other,f.b,cb,'gc_collaboration_export',{requestId})]);assert.ok(exports.every(r=>r.status==='succeeded'&&!r.replayed));assert.equal((await f.call(c,f.a,ca,'gc_collaboration_export',{requestId})).replayed,true);
 const draft=f.a.draft([{id:'desc',module:'project',op:'set',path:'/description',value:'项目 A 独立更新'}]);await f.call(c,f.a,ca,'gc_content_submit',{draft,requestId:randomUUID()});const item=(await f.call(c,f.a,ca,'gc_content_scan')).items[0];await f.call(c,f.a,ca,'gc_content_apply',{id:item.id,digest:item.digest,reviewId:item.reviewId,requestId:randomUUID()});
 assert.equal((await f.call(c,f.a,ca,'gc_project_read',{modules:['project']})).content.project.description,'项目 A 独立更新');assert.equal((await f.call(other,f.b,cb,'gc_project_read',{modules:['project']})).content.project.description,'');
 await assert.rejects(f.call(other,f.b,cb,'gc_content_submit',{draft,requestId:randomUUID()}),/项目/);
 const publicData=JSON.stringify([f.broker.manage('status'),await c.call('gc_connections')]);assert.ok(!publicData.includes(f.a.secret.privateKey));assert.ok(!publicData.includes('tokenHash'));assert.ok(!fs.readFileSync(path.join(f.directory,'connections.json'),'utf8').includes(f.a.file));
});
test('credential is reread per call; program permissions, malformed files and invalid identities fail without leaking keys',async t=>{
 const f=await setup(t),c=f.client(),ca=(await f.bind(c)).connection.id;
 fs.writeFileSync(f.a.file,JSON.stringify(f.b.secret));await assert.rejects(f.call(c,f.a,ca,'gc_project_read'),/不匹配/);
 fs.writeFileSync(f.a.file,'{"privateKey":"'+f.a.secret.privateKey+'",invalid');await assert.rejects(f.call(c,f.a,ca,'gc_project_read'),e=>e.message.includes('格式无效')&&!e.message.includes(f.a.secret.privateKey));fs.writeFileSync(f.a.file,JSON.stringify(f.a.secret));
 await assert.rejects(c.call('gc_connect_credential',{credentialFile:path.join(f.a.root,'missing')}),/无法读取/);
 const created=await f.a.developers.change('create',{projectId:f.a.project.id,schedule:JSON.parse(f.a.storage.getItem(f.a.sk)),name:'程序',duties:'实现已分配任务',permissions:['progress'],profile:{positionIds:['program'],taskIds:[],scope:'positions',expiresAt:'',projectModules:[]}});
 const secret=f.a.developers.read({projectId:f.a.project.id,credentialId:created.credential.id}),file=path.join(f.a.root,'program.json');fs.writeFileSync(file,JSON.stringify(secret));const program=(await c.call('gc_connect_credential',{credentialFile:file})).connection.id;
 await assert.rejects(c.call('gc_collaboration_export',{connectionId:program,credentialFile:file,requestId:randomUUID()}),/project_write/);
 const invalid=path.join(f.a.root,'invalid.json');fs.writeFileSync(invalid,JSON.stringify({...f.a.secret,projectId:'unregistered'}));await assert.rejects(c.call('gc_connect_credential',{credentialFile:invalid}),/未登记/);
 const schedule=JSON.parse(f.a.storage.getItem(f.a.sk));schedule.personnel.members[0].developer.expiresAt='2020-01-01T00:00:00.000Z';f.a.storage.setItem(f.a.sk,JSON.stringify(schedule));await assert.rejects(f.call(c,f.a,ca,'gc_project_read'),/过期/);
});
test('optional approval supplements proof, takes effect immediately, and restart needs no client config change',async t=>{
 const f=await setup(t),c=f.client();f.broker.manage('policy',{policy:'approval'});const bound=await f.bind(c),ca=bound.connection.id;assert.equal(bound.access,'pending_approval');await assert.rejects(f.call(c,f.a,ca,'gc_project_read'),/附加会话审批/);
 f.approve(c,[ca]);assert.equal((await f.call(c,f.a,ca,'gc_project_read')).projectId,f.a.project.id);
 const config=f.broker.manage('status').config;await f.restart();assert.deepEqual(f.broker.manage('status').config,config);assert.equal((await f.call(c,f.a,ca,'gc_project_read')).projectId,f.a.project.id);
 f.broker.manage('policy',{policy:'credential'});const newClient=f.client();assert.equal((await f.bind(newClient)).access,'ready');
 f.broker.manage('connection',{id:ca,enabled:false});await assert.rejects(f.call(c,f.a,ca,'gc_project_read'),/停用/);f.broker.manage('connection',{id:ca,enabled:true});
 f.broker.manage('enabled',{enabled:false});await assert.rejects(c.call('gc_connections'),/已停止/);f.broker.manage('enabled',{enabled:true});f.broker.manage('session',{id:c.sessionId,revoke:true});await assert.rejects(f.call(c,f.a,ca,'gc_project_read'),/已撤销/);
});
test('engine previews stay scoped to session and identity; revoked credentials cannot reuse bindings',async t=>{
 const f=await setup(t),c=f.client(),other=f.client(),ca=(await f.bind(c)).connection.id,cb=(await f.bind(c,f.b)).connection.id;await f.bind(other);
 const plan=await f.call(c,f.a,ca,'gc_engine_preview');await assert.rejects(f.call(other,f.a,ca,'gc_engine_apply',{token:plan.token,requestId:randomUUID()}),/不属于此会话/);await assert.rejects(f.call(c,f.b,cb,'gc_engine_apply',{token:plan.token,requestId:randomUUID()}),/不属于此会话/);
 const requestId=randomUUID();assert.equal((await f.call(c,f.a,ca,'gc_engine_apply',{token:plan.token,requestId})).status,'succeeded');assert.equal((await f.call(c,f.a,ca,'gc_engine_apply',{token:plan.token,requestId})).replayed,true);
 f.a.developers.revoke({projectId:f.a.project.id,credentialId:f.a.credential.id,schedule:JSON.parse(f.a.storage.getItem(f.a.sk))});await assert.rejects(f.call(c,f.a,ca,'gc_project_read'),/撤销/);assert.equal((await f.call(c,f.b,cb,'gc_project_read')).projectId,f.b.project.id);
});
test('queued signed writes recheck connection policy and live identity after editor preparation',async t=>{
 let entered,release;const ready=new Promise(resolve=>entered=resolve),wait=new Promise(resolve=>release=resolve);const f=await setup(t,{beforeMutation:async()=>{entered();await wait;}}),c=f.client(),ca=(await f.bind(c)).connection.id;
 const work=f.call(c,f.a,ca,'gc_collaboration_export',{requestId:randomUUID()}),rejection=assert.rejects(work,/审批/);await ready;f.broker.manage('policy',{policy:'approval'});release();await rejection;assert.equal(JSON.parse(f.a.storage.getItem('gamecreator.workspace.v1:'+f.a.project.id+':workflow-operations')||'[]').length,0);
});
test('one-use challenge binds signature to session, purpose and payload; no vault-backed unsigned fallback',async t=>{
 const f=await setup(t),sessionId=randomUUID(),token=randomBytes(32).toString('hex'),request=input=>f.broker.request({sessionId,token,...input});await request({operation:'connect',name:'proof-test'});
 const identity={projectId:f.a.project.id,memberId:f.a.memberId,credentialId:f.a.credential.id};
 const make=async()=>{const challenge=await request({operation:'challenge',purpose:'bind',identity});const proof={schema:1,session:challenge.serviceSession,id:randomUUID(),at:new Date().toISOString(),...identity,operation:'credential_bind',input:{},accessContext:{sessionId,nonce:challenge.nonce}};proof.signature=sign(null,Buffer.from(canonical(proof)),createPrivateKey({key:Buffer.from(f.a.secret.privateKey,'base64'),type:'pkcs8',format:'der'})).toString('base64');return proof;};
 const proof=await make();await request({operation:'bind',proof});await assert.rejects(request({operation:'bind',proof}),/已使用|挑战/);
 const tampered=await make();tampered.input={modules:['project']};await assert.rejects(request({operation:'bind',proof:tampered}),/签名无效/);
 const switched=await make();switched.memberId=randomUUID();await assert.rejects(request({operation:'bind',proof:switched}),/不匹配/);
 await assert.rejects(request({operation:'call',connectionId:f.broker.manage('status').connections[0].id,tool:'gc_project_read',args:{}}),/逐次凭证签名/);
 const endpoint=f.broker.manage('status').endpoint;assert.equal((await fetch(endpoint,{method:'POST',headers:{Origin:'https://example.com'},body:'{}'})).status,403);
});
test('revocation while a signed write is waiting prevents any operation record or content write',async t=>{
 let entered,release;const ready=new Promise(resolve=>entered=resolve),wait=new Promise(resolve=>release=resolve);
 const f=await setup(t,{beforeMutation:async()=>{entered();await wait;}}),c=f.client(),ca=(await f.bind(c)).connection.id;
 const work=f.call(c,f.a,ca,'gc_collaboration_export',{requestId:randomUUID()}),rejected=assert.rejects(work,/有效|凭证|撤销/);
 await ready;f.a.developers.revoke({projectId:f.a.project.id,credentialId:f.a.credential.id,schedule:JSON.parse(f.a.storage.getItem(f.a.sk))});release();await rejected;
 assert.equal(JSON.parse(f.a.storage.getItem('gamecreator.workspace.v1:'+f.a.project.id+':workflow-operations')||'[]').length,0);
});
test('old global settings migrate without treating prior approvals as possession of a credential',async t=>{
 const f=await setup(t),c=f.client(),ca=(await f.bind(c)).connection.id;f.approve(c,[ca]);
 const file=path.join(f.directory,'connections.json'),data=JSON.parse(fs.readFileSync(file,'utf8'));delete data.policy;data.clients.forEach(s=>delete s.boundConnectionIds);fs.writeFileSync(file,JSON.stringify(data));
 await f.restart();assert.equal(f.broker.manage('status').policy,'credential');assert.deepEqual((await c.call('gc_connections')).connections,[]);
 await assert.rejects(f.call(c,f.a,ca,'gc_project_read'),/未获准/);assert.equal((await f.bind(c)).access,'ready');
 assert.equal((await f.call(c,f.a,ca,'gc_project_read')).identity.id,f.a.memberId);
});
test('installed global stdio exposes credential binding and requires per-operation credential paths',async t=>{
 const f=await setup(t),child=spawn(process.execPath,[path.join(f.directory,'workflow-global-mcp.cjs')],{stdio:['pipe','pipe','pipe'],windowsHide:true});t.after(()=>child.kill());let id=0;const pending=new Map(),lines=[];readline.createInterface({input:child.stdout}).on('line',line=>{lines.push(line);const r=JSON.parse(line);pending.get(r.id)?.(r);});
 const rpc=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>reject(new Error('MCP timeout')),10000);pending.set(n,r=>{clearTimeout(timer);resolve(r);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:n,method,params})+'\n');});
 await rpc('initialize',{protocolVersion:'2025-06-18',clientInfo:{name:'stdio-test'}});const tools=(await rpc('tools/list')).result.tools;assert.equal(tools.length,13);assert.ok(tools.find(x=>x.name==='gc_project_read').inputSchema.required.includes('credentialFile'));
 const bound=(await rpc('tools/call',{name:'gc_connect_credential',arguments:{credentialFile:f.a.file}})).result.structuredContent;assert.equal(bound.access,'ready');const read=await rpc('tools/call',{name:'gc_project_read',arguments:{connectionId:bound.connection.id,credentialFile:f.a.file}});assert.equal(read.result.structuredContent.projectId,f.a.project.id);assert.ok(!lines.join('').includes(f.a.secret.privateKey));child.stdin.end();
});
