const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{spawn}=require('node:child_process'),readline=require('node:readline');
const {fixture}=require('./authoring-fixture.cjs');
const {createWorkflowService}=require('../desktop/workflow-service.cjs');
const {createMcpConnections}=require('../desktop/mcp-connections.cjs');
const {createGlobalClient}=require('../shared/workflow-global-mcp.cjs');
async function setup(t,options={}){
 const a=await fixture(),b=await fixture();a.project.name='项目 A';b.project.name='项目 B';
 for(const f of [a,b]){const engine=path.join(f.root,'engine');fs.mkdirSync(engine);fs.writeFileSync(path.join(engine,'project.godot'),'config_version=5');f.project.config.projectPath=engine;const cat=JSON.parse(f.storage.getItem('gamecreator.projects.v1'));cat.projects[0]=f.project;f.storage.setItem('gamecreator.projects.v1',JSON.stringify(cat));}
 const select=id=>{const f=[a,b].find(f=>f.project.id===id);if(!f)throw new Error('项目未登记');return f;};
 const storeFor=key=>{const f=[a,b].find(f=>key.includes(f.project.id));if(!f)throw new Error('未绑定的项目存档');return f.storage;};
 const storage={directory:a.storage.directory,getItem:key=>key==='gamecreator.projects.v1'?JSON.stringify({schema:2,activeId:a.project.id,mode:'project',projects:[a.project,b.project]}):storeFor(key).getItem(key),setItem:(key,value)=>storeFor(key).setItem(key,value),info:key=>storeFor(key).info(key)};
 const folders={verify:id=>select(id).folders.verify(id)},developers={read:input=>select(input.projectId).developers.read(input)};
 const workflow=createWorkflowService({storage,folders,developers,artFiles:{},...options});
 const directory=path.join(a.root,'global-mcp');let broker=await createMcpConnections({directory,storage,folders,developers,workflow});
 const add=f=>broker.manage('add',{name:f.project.name,projectId:f.project.id,memberId:f.memberId,credentialId:f.credential.id}).connections.find(c=>c.projectId===f.project.id).id;
 const ca=add(a),cb=add(b),clients=[];
 const client=()=>{const c=createGlobalClient({discoveryFile:broker.discoveryFile});clients.push(c);return c;};
 t.after(async()=>{await Promise.all(clients.map(c=>c.close()));broker.close();a.close();b.close();});
 return {a,b,ca,cb,client,directory,get broker(){return broker;},async restart(){await new Promise(resolve=>broker.server.close(resolve));broker=await createMcpConnections({directory,storage,folders,developers,workflow});},approve(c,ids){broker.manage('session',{id:c.sessionId,connectionIds:ids});}};
}
test('global discovery exposes only explicitly granted project identities; A writes cannot target B',async t=>{
 const f=await setup(t),c=f.client(),other=f.client();
 const initial=await c.call('gc_connections');assert.deepEqual(initial.connections,[]);assert.equal(initial.verificationCode,c.verificationCode);
 await assert.rejects(c.call('gc_project_read',{connectionId:f.ca}),/未获准/);
 f.approve(c,[f.ca]);await other.call('gc_connections');f.approve(other,[f.cb]);
 assert.deepEqual((await c.call('gc_connections')).connections.map(x=>x.id),[f.ca]);
 await assert.rejects(c.call('gc_project_read',{}),/connectionId/);await assert.rejects(c.call('gc_project_read',{connectionId:f.cb}),/未获准/);
 const [a,b]=await Promise.all([c.call('gc_project_read',{connectionId:f.ca,modules:['project']}),other.call('gc_project_read',{connectionId:f.cb,modules:['project']})]);assert.equal(a.projectId,f.a.project.id);assert.equal(b.projectId,f.b.project.id);
 const sharedRequestId=randomUUID();const exports=await Promise.all([c.call('gc_collaboration_export',{connectionId:f.ca,requestId:sharedRequestId}),other.call('gc_collaboration_export',{connectionId:f.cb,requestId:sharedRequestId})]);assert.ok(exports.every(r=>r.status==='succeeded'&&!r.replayed));
 const draft=f.a.draft([{id:'desc',module:'project',op:'set',path:'/description',value:'项目 A 独立更新'}]);
 await c.call('gc_content_submit',{connectionId:f.ca,draft,requestId:randomUUID()});const item=(await c.call('gc_content_scan',{connectionId:f.ca})).items[0];
 await c.call('gc_content_apply',{connectionId:f.ca,id:item.id,digest:item.digest,reviewId:item.reviewId,requestId:randomUUID()});
 assert.equal((await c.call('gc_project_read',{connectionId:f.ca,modules:['project']})).content.project.description,'项目 A 独立更新');
 assert.equal((await other.call('gc_project_read',{connectionId:f.cb,modules:['project']})).content.project.description,'');
 await assert.rejects(other.call('gc_content_submit',{connectionId:f.cb,draft,requestId:randomUUID()}),/项目|身份|快照/);
 const publicData=JSON.stringify([f.broker.manage('status'),await c.call('gc_connections')]);assert.ok(!publicData.includes(f.a.secret.privateKey));assert.ok(!publicData.includes(f.b.secret.privateKey));assert.ok(!publicData.includes('tokenHash'));
});
test('restart rediscovers dynamic endpoint and preserves grants for the same adapter session',async t=>{
 const f=await setup(t),c=f.client();await c.call('gc_connections');f.approve(c,[f.ca]);const config=f.broker.manage('status').config;
 await f.restart();assert.deepEqual(f.broker.manage('status').config,config);assert.equal((await c.call('gc_project_read',{connectionId:f.ca})).projectId,f.a.project.id);
 const newClient=f.client();assert.equal((await newClient.call('gc_connections')).connections.length,0);
 f.broker.manage('connection',{id:f.ca,enabled:false});await assert.rejects(c.call('gc_project_read',{connectionId:f.ca}),/停用/);
 f.broker.manage('connection',{id:f.ca,enabled:true});f.broker.manage('enabled',{enabled:false});await assert.rejects(c.call('gc_connections'),/已停止/);f.broker.manage('enabled',{enabled:true});
 f.broker.manage('session',{id:c.sessionId,revoke:true});await assert.rejects(c.call('gc_connections'),/已撤销/);
});
test('engine previews are scoped to both session and connection; identity revocation is live',async t=>{
 const f=await setup(t),c=f.client(),other=f.client();await c.call('gc_connections');await other.call('gc_connections');f.approve(c,[f.ca,f.cb]);f.approve(other,[f.ca]);
 const plan=await c.call('gc_engine_preview',{connectionId:f.ca});
 await assert.rejects(other.call('gc_engine_apply',{connectionId:f.ca,token:plan.token,requestId:randomUUID()}),/不属于此会话/);
 await assert.rejects(c.call('gc_engine_apply',{connectionId:f.cb,token:plan.token,requestId:randomUUID()}),/不属于此会话/);
 const requestId=randomUUID();assert.equal((await c.call('gc_engine_apply',{connectionId:f.ca,token:plan.token,requestId})).status,'succeeded');assert.equal((await c.call('gc_engine_apply',{connectionId:f.ca,token:plan.token,requestId})).replayed,true);
 f.a.developers.revoke({projectId:f.a.project.id,credentialId:f.a.credential.id,schedule:JSON.parse(f.a.storage.getItem(f.a.sk))});await assert.rejects(c.call('gc_project_read',{connectionId:f.ca}),/失效|撤销/);assert.equal((await c.call('gc_project_read',{connectionId:f.cb})).projectId,f.b.project.id);
});
test('queued writes recheck connection authorization after editor preparation',async t=>{
 let entered,release;const ready=new Promise(resolve=>entered=resolve),wait=new Promise(resolve=>release=resolve);
 const f=await setup(t,{beforeMutation:async()=>{entered();await wait;}}),c=f.client();await c.call('gc_connections');f.approve(c,[f.ca]);
 const work=c.call('gc_collaboration_export',{connectionId:f.ca,requestId:randomUUID()});const rejection=assert.rejects(work,/未获准|停用/);await ready;f.broker.manage('session',{id:c.sessionId,connectionIds:[]});release();await rejection;
 assert.equal(JSON.parse(f.a.storage.getItem('gamecreator.workspace.v1:'+f.a.project.id+':workflow-operations')||'[]').length,0);
});
test('loopback enrollment rejects browser origins and session spoofing; installed stdio entry negotiates new tools',async t=>{
 const f=await setup(t),endpoint=f.broker.manage('status').endpoint;
 const response=await fetch(endpoint,{method:'POST',headers:{Origin:'https://example.com'},body:'{}'});assert.equal(response.status,403);
 const c=f.client();await c.call('gc_connections');await assert.rejects(f.broker.request({operation:'list',sessionId:c.sessionId,token:'0'.repeat(64)}),/未登记/);
 const child=spawn(process.execPath,[path.join(f.directory,'workflow-global-mcp.cjs')],{stdio:['pipe','pipe','pipe'],windowsHide:true});t.after(()=>child.kill());
 let id=0;const pending=new Map(),lines=[];readline.createInterface({input:child.stdout}).on('line',line=>{lines.push(line);const r=JSON.parse(line);pending.get(r.id)?.(r);});
 const rpc=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>reject(new Error('MCP timeout')),10000);pending.set(n,r=>{clearTimeout(timer);resolve(r);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:n,method,params})+'\n');});
 await rpc('initialize',{protocolVersion:'2025-06-18',clientInfo:{name:'stdio-test'}});const tools=(await rpc('tools/list')).result.tools;assert.equal(tools.length,12);assert.ok(tools.find(x=>x.name==='gc_project_read').inputSchema.required.includes('connectionId'));
 const result=(await rpc('tools/call',{name:'gc_connections',arguments:{}})).result;assert.deepEqual(result.structuredContent.connections,[]);assert.ok(f.broker.manage('status').sessions.some(s=>s.name==='stdio-test'));
 assert.ok(!lines.join('').includes(f.a.secret.privateKey));child.stdin.end();
});
