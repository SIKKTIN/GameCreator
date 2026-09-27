// Local, signed team operations. The desktop remains the only archive/vault writer.
const http=require('node:http'),fs=require('node:fs');
const {createHash,randomUUID,createPublicKey,verify}=require('node:crypto');
const {validateProjectScheduleArchive}=require('./project-package.cjs');
const {safeFile,writeFile}=require('./project-startup.cjs');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
const scheduleKey=id=>'gamecreator.workspace.v1:'+id+':project-schedule';
const unsigned=r=>{const {signature,...body}=r;return body;};
function createTeamManagement({storage,folders,developers,session=randomUUID(),onChanged=()=>{}}){
 function current(projectId){
  const catalog=JSON.parse(storage.getItem('gamecreator.projects.v1')||'null');
  if(catalog?.mode!=='project'||catalog.activeId!==projectId)throw new Error('请在 GameCreator 打开对应本地项目');
  const project=folders.verify(projectId);if(!project.folderPath)throw new Error('先保存为独立 GameCreator 项目');
  require('./project-changes.cjs').assertNoPendingContent(storage,projectId);
  const raw=storage.getItem(scheduleKey(projectId)),schedule=validateProjectScheduleArchive(JSON.parse(raw||'null'));
  return {project,raw,schedule};
 }
 function authenticate(r,schedule){
  if(r?.schema!==1||r.session!==session||typeof r.id!=='string'||!/^\w[\w-]{7,99}$/.test(r.id)||!Number.isFinite(Date.parse(r.at))||Math.abs(Date.now()-Date.parse(r.at))>120000)throw new Error('请求已过期或本机服务已重启，请重新签名');
  const team=schedule.personnel,key=team?.credentials.find(k=>k.id===r.credentialId&&k.projectId===r.projectId&&k.memberId===r.memberId),m=team?.members.find(m=>m.id===r.memberId);
  if(!key?.persistent||key.revokedAt||!m?.active||!m.permissions.includes('team_manage')||m.developer?.scope!=='project'||!team.positions?.some(p=>p.active&&m.developer.positionIds.includes(p.id))||m.developer.expiresAt&&Date.parse(m.developer.expiresAt)<=Date.now())throw new Error('需要有效长期令牌、项目范围及 team_manage 权限');
  let valid=false;try{valid=verify(null,Buffer.from(canonical(unsigned(r))),createPublicKey({key:Buffer.from(key.publicKey,'base64'),type:'spki',format:'der'}),Buffer.from(r.signature,'base64'));}catch{}
  if(!valid)throw new Error('团队管理签名无效');return m;
 }
 function delegation(actor,target){
  const model=require('./project-content-model.cjs'),modules=model.moduleGrants(actor),targetModules=model.moduleGrants(target);
  if(target.permissions.some(p=>!actor.permissions.includes(p))||targetModules.some(p=>!modules.includes(p)))throw new Error('不能授予或管理超出自身权限的开发者');
  if((target.developer?.artPermissions||[]).some(p=>!modules.includes('art-assets')&&!(actor.developer.artPermissions||[]).includes(p)))throw new Error('素材授权超出自身权限');
  if(actor.developer.expiresAt&&(!target.developer?.expiresAt||Date.parse(target.developer.expiresAt)>Date.parse(actor.developer.expiresAt)))throw new Error('被授权有效期不能超过管理者');
 }
 async function run(r){
  const state=current(r.projectId),actor=authenticate(r,state.schedule),{schedule}=state;
  const digest=hash({projectId:r.projectId,memberId:r.memberId,credentialId:r.credentialId,id:r.id,operation:r.operation,input:r.input,revision:r.revision});
  const team=schedule.personnel,old=team.managementHistory?.find(h=>h.id===r.id);
  const target=id=>{const member=team.members.find(m=>m.id===id);if(!member)throw new Error('开发者不存在');delegation(actor,member);return member;};
  const deliver=result=>{
   if(result.credentialId&&['create','rotate','credential'].includes(r.operation)){
    const live=current(r.projectId),manager=authenticate(r,live.schedule),recipient=live.schedule.personnel.members.find(m=>m.id===result.memberId);if(!recipient)throw new Error('开发者不存在');delegation(manager,recipient);return {...result,secret:developers.read({projectId:r.projectId,credentialId:result.credentialId})};
   }return result;
  };
  if(old){if(old.digest!==digest)throw new Error('请求编号已被其他内容使用');return deliver({...old.result,replayed:true});}
  if(r.operation==='status')return {revision:hash(schedule),schedule};
  const input=r.input||{};
  if(r.operation==='credential'){
   const k=team.credentials.find(k=>k.id===input.credentialId);if(!k)throw new Error('令牌不存在');target(k.memberId);
   return deliver({memberId:k.memberId,credentialId:k.id});
  }
  if(r.revision!==hash(schedule))throw new Error('团队或排期已变化，请重新读取 status 并检查后更新 revision');
  if((team.managementHistory||[]).length>=10000)throw new Error('团队管理记录已达到上限');
  const commit=(next,result)=>{
   const latest=current(r.projectId);authenticate(r,latest.schedule);
   if(latest.raw!==state.raw)throw new Error('团队或排期已变化，请重新读取');
   next.personnel.managementHistory=[...(team.managementHistory||[]),{id:r.id,digest,memberId:actor.id,memberName:actor.name,operation:r.operation,at:new Date().toISOString(),result}];return next;
  };
  let result;
  if(['create','update','rotate'].includes(r.operation)){
   if(input.memberId){if(input.memberId===actor.id)throw new Error('请由本地管理者调整自己的授权');target(input.memberId);}
   delegation(actor,{permissions:input.permissions||[],developer:input.profile});
   if(input.permissions?.includes('team_manage')&&input.profile?.scope!=='project')throw new Error('团队管理权限需要项目范围');
   if(input.profile?.positionIds?.some(id=>!team.positions.some(p=>p.id===id&&p.active)))throw new Error('请先创建或启用所选岗位');
   const {developerAllowed}=require('./ai-developers.cjs');
   if(input.profile?.taskIds?.some(id=>{const t=schedule.tasks.find(t=>t.id===id);return !t||!developerAllowed(schedule,{developer:input.profile},t);}))throw new Error('分配任务不属于接收人的岗位范围');
   result=await developers.change(r.operation,{...input,projectId:r.projectId,schedule},commit);
   result={memberId:result.memberId,...(result.credential?{credentialId:result.credential.id}:{})};
  }else{
   const next=structuredClone(schedule);
   if(r.operation==='revoke'){
    const key=next.personnel.credentials.find(k=>k.id===input.credentialId);if(!key)throw new Error('令牌不存在');if(key.memberId===actor.id)throw new Error('请由本地管理者撤销自己的令牌');target(key.memberId);
    key.revokedAt=key.revokedAt||new Date().toISOString();result={memberId:key.memberId,credentialId:key.id};
   }else if(r.operation==='position'){
    // Explicitly add/update a role, never silently replace a preset or existing task membership.
    const p={id:input.id,name:input.name,duties:input.duties,active:input.active,taskKinds:input.taskKinds};
    if(p.id==='producer')throw new Error('制作人岗位由本地管理者维护');
    const existing=next.personnel.positions.findIndex(x=>x.id===p.id);
    if(existing<0)next.personnel.positions.push(p);else next.personnel.positions[existing]=p;
    const {taskPositionIds}=await import('../shared/ai-personnel.mjs');next.tasks=next.tasks.map(t=>({...t,positionIds:taskPositionIds(schedule,t)}));
    result={positionId:p.id};
   }else throw new Error('未知团队管理操作');
   commit(next,result);validateProjectScheduleArchive(next);storage.setItem(scheduleKey(r.projectId),JSON.stringify(next));
  }
  onChanged(r.projectId);
  return deliver(result);
 }
 return {run,session};
}
async function createTeamManagementServer(options){
 const service=createTeamManagement(options);let queued=Promise.resolve();
 const server=http.createServer(async(req,res)=>{
  const send=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  if(req.method!=='POST'||req.url!=='/team'||req.headers.origin||req.headers.host!=='127.0.0.1:'+server.address().port)return send(403,{error:'只接受本机签名命令'});
  try{
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>256*1024)throw new Error('请求过大');chunks.push(chunk);}
   const request=JSON.parse(Buffer.concat(chunks).toString('utf8')),job=queued.then(()=>service.run(request));queued=job.catch(()=>{});send(200,await job);
  }catch(e){send(400,{error:e.message});}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let published='';
 function publish(){try{
  const catalog=JSON.parse(options.storage.getItem('gamecreator.projects.v1')||'null');if(catalog?.mode!=='project')return;
  const project=options.folders.verify(catalog.activeId);if(!project.folderPath||!fs.existsSync(safeFile(project.folderPath,'ai/README.md')))return;
  const text=JSON.stringify({schema:1,projectId:project.id,session:service.session,endpoint:'http://127.0.0.1:'+server.address().port+'/team'},null,2)+'\n',key=project.folderPath+text;
  if(published!==key){writeFile(project.folderPath,'ai/team-service.json',text);published=key;}
 }catch{/* Closed or uninitialized projects never expose a writable endpoint. */}}
 publish();const timer=setInterval(publish,1500);timer.unref();
 return {server,publish,close(){clearInterval(timer);server.close();}};
}
module.exports={createTeamManagement,createTeamManagementServer,canonical,hash};
