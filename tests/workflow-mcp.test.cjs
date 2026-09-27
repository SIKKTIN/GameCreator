const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID,sign,createPrivateKey}=require('node:crypto'),{spawn}=require('node:child_process'),readline=require('node:readline');
const {fixture,initialOperations}=require('./authoring-fixture.cjs');
const {createWorkflowServer}=require('../desktop/workflow-service.cjs');
const {createClient}=require('../shared/workflow-mcp.cjs');
const {canonical}=require('../desktop/team-management.cjs');
async function setup(t,options={}){
 const f=await fixture(),engine=path.join(f.root,'engine');fs.mkdirSync(engine);fs.writeFileSync(path.join(engine,'project.godot'),'config_version=5');
 f.project.config.projectPath=engine;const catalog=JSON.parse(f.storage.getItem('gamecreator.projects.v1'));catalog.projects[0].config=f.project.config;f.storage.setItem('gamecreator.projects.v1',JSON.stringify(catalog));
 const credentialFile=path.join(f.root,'producer.json');fs.writeFileSync(credentialFile,JSON.stringify(f.secret));
 const server=await createWorkflowServer({...f,artFiles:{},...options});t.after(()=>{server.close();f.close();});
 const client=createClient({projectDirectory:f.project.folderPath,credentialFile}),call=(op,args={})=>client.call('gc_'+op,args);
 return {...f,engine,server,credentialFile,client,call,write:(op,args={})=>call(op,{...args,requestId:randomUUID()})};
}
test('MCP producer completes signed design, application, context export and engine delivery without UI',async t=>{
 const f=await setup(t);await f.write('collaboration_export');
 const context=await f.call('project_read',{modules:['project','project-schedule'],templates:true});assert.equal(context.projectId,f.project.id);assert.ok(context.templates.productionTask);assert.equal(context.snapshotId,f.read('ai/project.json').snapshotId);
 const draft=f.draft(initialOperations());const valid=await f.call('content_validate',{draft});assert.equal(valid.items[0].unresolved,0);assert.equal(fs.existsSync(path.join(f.project.folderPath,'ai/changes',draft.id+'.json')),false);
 const requestId=randomUUID(),submitted=await f.call('content_submit',{draft,requestId});assert.equal(submitted.status,'succeeded');assert.equal((await f.call('content_submit',{draft,requestId})).replayed,true);
 const item=(await f.call('content_scan')).items[0],args={id:item.id,digest:item.digest,reviewId:item.reviewId};await f.call('content_preview',args);
 const applied=await f.write('content_apply',args);assert.equal(applied.status,'succeeded');assert.equal((await f.call('operation_status',{requestId:applied.id})).status,'succeeded');
 await f.write('collaboration_export');const preview=await f.call('engine_preview');assert.ok(preview.rows.some(r=>r.path.endsWith('/modules/gameplay/gameplay.md')));
 const syncArgs={token:preview.token,requestId:randomUUID()},synced=await f.call('engine_apply',syncArgs);assert.equal(synced.status,'succeeded');assert.equal((await f.call('engine_apply',syncArgs)).replayed,true);
 assert.match(fs.readFileSync(path.join(f.engine,'docs/gamecreator/modules/overview.md'),'utf8'),/一个可验证玩法/);
 assert.equal(f.read('ai/context/content/project.json').description,'一个可验证玩法与交付的最小原型。');
 const history=await f.call('history');assert.equal(history.content.length,1);assert.ok(history.engine.length);assert.ok(!JSON.stringify(history).includes(f.secret.privateKey));
 await assert.rejects(f.call('content_submit',{draft:{...draft,summary:'different'},requestId}),/编号/);
});
test('parallel proposals reject stale reviews, expose conflicts and preserve explicit resolutions',async t=>{
 const f=await setup(t);await f.write('collaboration_export');
 const draft=value=>f.draft([{id:'description',module:'project',op:'set',path:'/description',value}]);
 const a=draft('first'),b=draft('second');await Promise.all([f.write('content_submit',{draft:a}),f.write('content_submit',{draft:b})]);
 let scan=await f.call('content_scan');const first=scan.items.find(i=>i.id===a.id),second=scan.items.find(i=>i.id===b.id);
 const input=i=>({id:i.id,digest:i.digest,reviewId:i.reviewId});
 const results=await Promise.allSettled([f.write('content_apply',input(first)),f.write('content_apply',input(second))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/已变化/);
 scan=await f.call('content_scan');const remaining=scan.items[0];assert.equal(remaining.unresolved,1);await f.write('content_apply',{...input(remaining),decisions:{description:'keep'}});
 assert.equal((await f.call('project_read',{modules:['project']})).content.project.description,'first');
});
test('live permissions, signatures, preview ownership and stale engine source are checked',async t=>{
 const f=await setup(t);const p=await f.call('engine_preview');
 const s=JSON.parse(f.storage.getItem(f.sk));s.personnel.members[0].permissions=[];f.storage.setItem(f.sk,JSON.stringify(s));await assert.rejects(f.write('engine_apply',{token:p.token}),/project_write/);
 s.personnel.members[0].permissions=['project_write'];s.personnel.members[0].duties='updated';f.storage.setItem(f.sk,JSON.stringify(s));await assert.rejects(f.write('engine_apply',{token:p.token}),/已变化/);
 const newer=await f.call('engine_preview');const other=await f.developers.change('create',{projectId:f.project.id,schedule:s,name:'第二制作人',duties:'并行策划',permissions:['project_write'],profile:{positionIds:['producer'],taskIds:[],scope:'project',expiresAt:'',projectModules:Object.keys(f.model.authoringModules)}});
 const file=path.join(f.root,'other.json');fs.writeFileSync(file,JSON.stringify(f.developers.read({projectId:f.project.id,credentialId:other.credential.id})));const client=createClient({projectDirectory:f.project.folderPath,credentialFile:file});await assert.rejects(client.call('gc_engine_apply',{token:newer.token,requestId:randomUUID()}),/其他开发者/);
 const endpoint=f.read('ai/workflow-service.json'),body={schema:1,session:endpoint.session,id:randomUUID(),at:new Date().toISOString(),projectId:f.project.id,memberId:f.memberId,credentialId:f.credential.id,operation:'project_read',input:{}};
 body.signature=sign(null,Buffer.from(canonical(body)),createPrivateKey({key:Buffer.from(f.secret.privateKey,'base64'),type:'pkcs8',format:'der'})).toString('base64');body.input={modules:['project']};const response=await fetch(endpoint.endpoint,{method:'POST',body:JSON.stringify(body)});assert.match((await response.json()).error,/签名/);
 const origin=await fetch(endpoint.endpoint,{method:'POST',headers:{Origin:'https://example.com'},body:'{}'});assert.equal(origin.status,403);
});
test('tools target the bound project when another project is visible; editor drafts can block writes',async t=>{
 let busy=true;const f=await setup(t,{beforeMutation:async()=>{if(busy)throw new Error('未保存草稿');}});
 await assert.rejects(f.write('collaboration_export'),/未保存草稿/);assert.equal((await f.call('history')).operations.length,0);busy=false;
 const second=f.folders.create(path.join(f.root,'second'),{...f.project,id:'project-'+randomUUID(),name:'另一项目'});const catalog=JSON.parse(f.storage.getItem('gamecreator.projects.v1'));catalog.projects.push(second);catalog.activeId=second.id;f.storage.setItem('gamecreator.projects.v1',JSON.stringify(catalog));
 assert.equal((await f.call('project_read')).projectId,f.project.id);await f.write('collaboration_export');
 const draft=f.draft([{id:'desc',module:'project',op:'set',path:'/description',value:'background'}]);await f.write('content_submit',{draft});const item=(await f.call('content_scan')).items[0];await f.write('content_apply',{id:item.id,digest:item.digest,reviewId:item.reviewId});
 assert.equal(JSON.parse(f.storage.getItem('gamecreator.projects.v1')).activeId,second.id);assert.equal((await f.call('project_read',{modules:['project']})).content.project.description,'background');
});
test('switching visible projects keeps reviewed content valid and credentials require separate authority',async t=>{
 const f=await setup(t);await f.write('collaboration_export');
 const draft=f.draft([{id:'desc',module:'project',op:'set',path:'/description',value:'view independent'}]);await f.write('content_submit',{draft});const item=(await f.call('content_scan')).items[0];
 const second=f.folders.create(path.join(f.root,'other'),{...f.project,id:'project-'+randomUUID(),name:'另一个工程'}),catalog=JSON.parse(f.storage.getItem('gamecreator.projects.v1'));catalog.projects.push(second);catalog.activeId=second.id;f.storage.setItem('gamecreator.projects.v1',JSON.stringify(catalog));
 await f.write('content_apply',{id:item.id,digest:item.digest,reviewId:item.reviewId});
 const settings={...(await import('../shared/engine-sync.mjs')).defaultSyncSettings,credentials:true};f.storage.setItem('gamecreator.workspace.v1:'+f.project.id+':engine-sync-'+f.project.config.engine,JSON.stringify(settings));
 await assert.rejects(f.call('engine_preview'),/team_manage/);
 assert.equal((await f.call('project_read',{modules:['project']})).content.project.description,'view independent');
});
test('authorized credential synchronization exports only to personal and never returns secrets',async t=>{
 const f=await setup(t),schedule=JSON.parse(f.storage.getItem(f.sk));schedule.personnel.members[0].permissions.push('team_manage');f.storage.setItem(f.sk,JSON.stringify(schedule));
 const settings={...(await import('../shared/engine-sync.mjs')).defaultSyncSettings,credentials:true,entryDirectory:'team'};f.storage.setItem('gamecreator.workspace.v1:'+f.project.id+':engine-sync-'+f.project.config.engine,JSON.stringify(settings));
 const preview=await f.call('engine_preview');assert.ok(preview.rows.some(r=>r.kind==='credential'));const result=await f.write('engine_apply',{token:preview.token});assert.equal(result.status,'succeeded');
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.engine,'team/personal',f.memberId+'.json'))).credentialId,f.credential.id);
 assert.ok(!JSON.stringify([preview,result,await f.call('history')]).includes(f.secret.privateKey));
});
test('exported stdio adapter negotiates MCP and discovers callable tools without exposing private keys',async t=>{
 const f=await setup(t);await f.write('collaboration_export');
 const child=spawn(process.execPath,[path.join(f.project.folderPath,'ai/workflow-mcp.cjs'),'--project',f.project.folderPath,'--credential',f.credentialFile],{stdio:['pipe','pipe','pipe'],windowsHide:true});t.after(()=>child.kill());
 const pending=new Map(),lines=[];let id=0;readline.createInterface({input:child.stdout}).on('line',line=>{lines.push(line);const r=JSON.parse(line);pending.get(r.id)?.(r);});
 const rpc=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>reject(new Error('MCP timeout')),10000);pending.set(n,r=>{clearTimeout(timer);resolve(r);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:n,method,params})+'\n');});
 assert.equal((await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}})).result.protocolVersion,'2025-06-18');
 assert.equal((await rpc('tools/list')).result.tools.length,11);
 const read=await rpc('tools/call',{name:'gc_project_read',arguments:{modules:['project']}});assert.equal(read.result.structuredContent.projectId,f.project.id);
 const error=await rpc('tools/call',{name:'unknown',arguments:{}});assert.equal(error.result.isError,true);assert.ok(!lines.join('').includes(f.secret.privateKey));child.stdin.end();
});
