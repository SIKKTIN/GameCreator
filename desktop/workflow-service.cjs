// Signed workflow gateway. Calls domain services; never drives a renderer or writes raw archives.
const fs=require('node:fs'),http=require('node:http');
const {randomUUID,createPublicKey,verify,createHash}=require('node:crypto');
const {canonical,hash}=require('./team-management.cjs');
const model=require('./project-content-model.cjs');
const {safeFile,writeFile,createProjectStartup}=require('./project-startup.cjs');
const {createProjectAuthoring}=require('./project-authoring.cjs');
const {createEngineSync}=require('./engine-sync.cjs');
const {verifyAiFeedback}=require('./ai-credentials.cjs');
const mutations=new Set(['content_submit','content_apply','collaboration_export','engine_apply']);
const operations=new Set(['project_read','content_validate','content_submit','content_scan','content_preview','content_apply','collaboration_export','engine_preview','engine_apply','operation_status','history']);
const key=(id,suffix)=>'gamecreator.workspace.v1:'+id+':'+suffix;
function createWorkflowService({storage,folders,developers,artFiles,session=randomUUID(),beforeMutation=async()=>{},afterMutation=()=>{}}){
 const authoring=createProjectAuthoring({storage,folders,allowBackground:true});
 const applying=new Map();
 const checkEngine=ctx=>{const active=applying.get(ctx.projectId);if(active){active.guard();const now=state(ctx.projectId);authenticate(active.request,now);if(now.revision!==active.revision)throw new Error('同步期间项目内容或授权已变化，请重新预览');}};
 const engine=createEngineSync({storage,artFiles,maxPlans:64,beforeWrite:(_index,_row,ctx)=>checkEngine(ctx),beforeCommit:checkEngine});
 const startup=createProjectStartup({storage,folders,developers,engineSync:engine,allowBackground:true,maxPlans:64});
 const queues=new Map(),plans=new Map();
 function state(projectId){
  const project=folders.verify(projectId);if(!project.folderPath)throw new Error('请先保存为独立 GameCreator 项目');
  const captured=model.captureProjectPackage(storage,project),settingsRaw=storage.getItem(key(projectId,'engine-sync-'+project.config.engine));
  // Only the requested project affects its revision; changing the visible project is not an edit.
  const entries=captured.expectedEntries.filter(e=>e.key!=='gamecreator.projects.v1');
  return {project,captured,archives:captured.document.archives,settingsRaw,revision:hash({project,entries,settingsRaw})};
 }
 function authenticate(r,s){
  if(r?.schema!==1||r.session!==session||typeof r.id!=='string'||!/^\w[\w-]{7,99}$/.test(r.id)||!Number.isFinite(Date.parse(r.at))||Math.abs(Date.now()-Date.parse(r.at))>120000)throw new Error('请求过期或服务重启，请重新连接并签名');
  const team=s.archives['project-schedule'].personnel,k=team?.credentials.find(k=>k.id===r.credentialId&&k.projectId===r.projectId&&k.memberId===r.memberId),m=team?.members.find(m=>m.id===r.memberId);
  if(!k?.persistent||k.revokedAt||Date.parse(k.createdAt)>Date.now()||!m?.active||!team.positions?.some(p=>p.active&&m.developer?.positionIds.includes(p.id))||m.developer?.expiresAt&&Date.parse(m.developer.expiresAt)<=Date.now())throw new Error('需要有效且启用的长期开发者凭证');
  const {signature,...body}=r;let valid=false;try{valid=verify(null,Buffer.from(canonical(body)),createPublicKey({key:Buffer.from(k.publicKey,'base64'),type:'spki',format:'der'}),Buffer.from(signature,'base64'));}catch{}
  if(!valid)throw new Error('工作流请求签名无效');return m;
 }
 function writer(m){if(m.developer?.scope!=='project'||!m.permissions.includes('project_write'))throw new Error('需要项目范围及 project_write 权限');}
 function fullWriter(m){writer(m);if(Object.keys(model.authoringModules).some(k=>!model.moduleGrants(m).includes(k)))throw new Error('导出整个项目需要全部项目模块的写入授权');}
 function proposalPermission(m,p){writer(m);if(p.identity?.memberId!==m.id&&!m.permissions.includes('review'))throw new Error('处理其他开发者的提交需要 review 权限');if(p.operations.some(op=>!model.moduleGrants(m).includes(op.module)))throw new Error('提交包含未授权模块');}
 function readProposal(s,id){if(typeof id!=='string'||!/^\w[\w-]{7,99}$/.test(id))throw new Error('提交编号无效');return JSON.parse(fs.readFileSync(safeFile(s.project.folderPath,'ai/changes/'+id+'.json'),'utf8'));}
 function journal(id){return JSON.parse(storage.getItem(key(id,'workflow-operations'))||'[]');}
 function record(id,value){const rows=journal(id),index=rows.findIndex(r=>r.id===value.id);if(index<0)rows.push(value);else rows[index]=value;storage.setItem(key(id,'workflow-operations'),JSON.stringify(rows));}
 function ownedPlan(r){const p=plans.get(r.input?.token);if(!p||p.projectId!==r.projectId||p.memberId!==r.memberId||p.credentialId!==r.credentialId||Date.now()-p.at>600000)throw new Error('同步预览不存在、已过期或属于其他开发者');return p;}
 async function execute(r,s,m,guard=()=>{}){
  const input=r.input||{},base={projectId:r.projectId,expectedEntries:s.captured.expectedEntries};
  if(r.operation==='project_read'){
   const modules=input.modules||[];if(!Array.isArray(modules)||modules.some(k=>!Object.hasOwn(s.archives,k)))throw new Error('未知内容模块');
   return {projectId:r.projectId,name:s.project.name,projectDirectory:s.project.folderPath,engineDirectory:s.project.config.projectPath,revision:s.revision,snapshotId:createHash('sha256').update(JSON.stringify({schema:1,projectId:r.projectId,archives:s.archives})).digest('hex'),identity:{id:m.id,name:m.name,permissions:m.permissions,profile:m.developer},modules:model.authoringModules,content:Object.fromEntries(modules.map(k=>[k,s.archives[k]])),settings:s.settingsRaw?JSON.parse(s.settingsRaw):null,guide:'GAMECREATOR_GUIDE.md',standards:'PROJECT_STANDARDS.md',templates:input.templates?model.authoringTemplates():undefined,templateOptions:input.templates?model.authoringTemplateOptions():undefined};
  }
  if(r.operation==='history')return {operations:journal(r.projectId).slice(-100),content:s.archives['project-schedule'].authoringHistory||[],engine:s.project.config.projectPath?(await engine.history({projectId:r.projectId,config:s.project.config})).entries:[],credentials:(await startup.run('history',base)).history};
  if(r.operation==='operation_status'){const found=journal(r.projectId).find(v=>v.id===input.requestId);if(found&&found.memberId!==m.id&&!m.permissions.includes('review'))throw new Error('不能读取其他开发者的操作结果');return found||{id:input.requestId,status:'not_found'};}
  if(['content_validate','content_submit'].includes(r.operation)){
   model.validateAuthoringProposal(input.proposal);proposalPermission(m,input.proposal);if(input.proposal.identity?.memberId!==m.id||input.proposal.identity?.credentialId!==r.credentialId)throw new Error('请使用当前开发者身份提交');
   return authoring.run(r.operation==='content_submit'?'submit':'validate',{...base,proposal:input.proposal});
  }
  if(r.operation==='content_scan')return authoring.run('scan',base);
  if(['content_preview','content_apply'].includes(r.operation)){
   proposalPermission(m,readProposal(s,input.id));
   return authoring.run(r.operation==='content_apply'?'apply':'preview',{...base,id:input.id,digest:input.digest,reviewId:input.reviewId,decisions:input.decisions||{}});
  }
  if(r.operation==='collaboration_export'){fullWriter(m);return authoring.run('export',base);}
  if(r.operation==='engine_preview'){
   fullWriter(m);const {syncSettings,defaultSyncSettings}=await import('../shared/engine-sync.mjs');
   const document=model.workflowDocument(s.archives,s.project.config);
   const settings=syncSettings(s.settingsRaw?JSON.parse(s.settingsRaw):{...defaultSyncSettings,modules:document.sections.map(s=>s.id)});
   if(settings.credentials&&!m.permissions.includes('team_manage'))throw new Error('同步成员凭证需要 team_manage 权限，可由管理者关闭凭证同步后仅同步文档');
   const payload={...base,config:s.project.config,settings,document,art:s.archives['art-assets'],collaboration:{schedule:s.archives['project-schedule'],tools:s.archives['development-tools']}};
   const plan=settings.credentials?(await startup.run('preview',{...payload,entryDirectory:settings.entryDirectory})).plan:await engine.preview(payload);
   for(const [token,p]of plans)if(Date.now()-p.at>600000){if(p.credentials)await startup.run('release',{token});else engine.release(token);plans.delete(token);}
   if(plans.size>=60){if(settings.credentials)await startup.run('release',{token:plan.token});else engine.release(plan.token);throw new Error('待处理预览过多，请完成现有预览或等待过期');}
   plans.set(plan.token,{projectId:r.projectId,memberId:r.memberId,credentialId:r.credentialId,revision:s.revision,credentials:settings.credentials,at:Date.now()});
   return {...plan,revision:s.revision};
  }
  if(r.operation==='engine_apply'){
   fullWriter(m);const plan=ownedPlan(r);if(plan.credentials&&!m.permissions.includes('team_manage'))throw new Error('同步成员凭证需要 team_manage 权限');
   if(plan.revision!==s.revision)throw new Error('项目内容、授权或同步配置已变化，请重新预览');
   const payload={token:input.token,decisions:input.decisions||{},removals:input.removals||[]};
   applying.set(r.projectId,{request:r,revision:s.revision,guard});try{const result=plan.credentials?await startup.run('initialize',payload):await engine.apply(payload);plans.delete(input.token);return result;}finally{applying.delete(r.projectId);}
  }
  throw new Error('未知工作流操作');
 }
 async function perform(r,guard){
  guard();
  if(!operations.has(r?.operation))throw new Error('未知工作流操作');
  let s=state(r.projectId),m=authenticate(r,s);
  const mutation=mutations.has(r.operation),digest=hash({operation:r.operation,input:r.input||{},projectId:r.projectId,memberId:r.memberId,credentialId:r.credentialId,...(r.accessContext?{accessContext:r.accessContext}:{})});
  if(!mutation)return execute(r,s,m,guard);
  const previous=journal(r.projectId).find(x=>x.id===r.id);
  if(previous){if(previous.digest!==digest)throw new Error('请求编号已用于不同内容');return {...previous,replayed:true};}
  if(journal(r.projectId).length>=10000)throw new Error('工作流记录已达上限，请先归档项目');
  // Authorize before acquiring the editor guard or creating any record.
  if(r.operation==='content_submit'){model.validateAuthoringProposal(r.input?.proposal);proposalPermission(m,r.input.proposal);verifyAiFeedback(r.input.proposal,s.archives['project-schedule']);}
  else if(r.operation==='content_apply')proposalPermission(m,readProposal(s,r.input?.id));else fullWriter(m);
  const finish=await beforeMutation(r.projectId);let entry;
  try{
   guard();s=state(r.projectId);m=authenticate(r,s);
   entry={id:r.id,digest,operation:r.operation,memberId:m.id,memberName:m.name,at:new Date().toISOString(),status:'running'};record(r.projectId,entry);
   const result=await execute(r,s,m,guard);entry={...entry,status:'succeeded',result};record(r.projectId,entry);return entry;
  }catch(error){if(entry)record(r.projectId,{...entry,status:'failed',error:error.message,diagnostics:error.diagnostics||[]});throw error;}
  finally{try{await afterMutation(r.projectId);}finally{await finish?.();}}
 }
 function run(r,guard=()=>{}){const id=r?.projectId,job=(queues.get(id)||Promise.resolve()).then(()=>perform(r,guard));const settled=job.catch(()=>{});queues.set(id,settled);void settled.then(()=>{if(queues.get(id)===settled)queues.delete(id);});return job;}
 return {run,session};
}
async function createWorkflowServer(options){
 const service=createWorkflowService(options);
 const server=http.createServer(async(req,res)=>{
  const send=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  if(req.method!=='POST'||req.url!=='/workflow'||req.headers.origin||req.headers.host!=='127.0.0.1:'+server.address().port)return send(403,{error:'只接受本机签名工作流请求'});
  try{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>3*1024*1024)throw new Error('请求过大');chunks.push(chunk);}send(200,await service.run(JSON.parse(Buffer.concat(chunks).toString('utf8'))));}
  catch(error){send(400,{error:error.message,diagnostics:error.diagnostics||[],scope:error.scope});}
 });
 server.requestTimeout=30000;server.headersTimeout=10000;
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const published=new Map();function publish(){
  const catalog=JSON.parse(options.storage.getItem('gamecreator.projects.v1')||'null');
  for(const p of catalog?.projects||[])try{
   if(!p.folderPath||!fs.existsSync(safeFile(p.folderPath,'ai/README.md')))continue;
   const text=JSON.stringify({schema:1,projectId:p.id,session:service.session,endpoint:'http://127.0.0.1:'+server.address().port+'/workflow'},null,2)+'\n';
   if(published.get(p.folderPath)!==text){options.folders.verify(p.id);writeFile(p.folderPath,'ai/workflow-service.json',text);published.set(p.folderPath,text);}
  }catch{/* Unavailable projects are not published. */}
 }
 publish();const timer=setInterval(publish,1500);timer.unref();
 return {service,server,publish,close(){clearInterval(timer);server.close();}};
}
module.exports={createWorkflowService,createWorkflowServer};
