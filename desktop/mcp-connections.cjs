const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {randomUUID,randomBytes,createHash,timingSafeEqual,createPublicKey,verify}=require('node:crypto');
const {atomicWrite}=require('./storage.cjs');
const {canonical,tools}=require('../shared/workflow-mcp.cjs');
const digest=value=>createHash('sha256').update(value).digest('hex');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,label)=>{if(typeof value!=='string'||!value.trim()||value.length>200)throw new Error(label+'无效');return value.trim();};
async function createMcpConnections({directory,storage,folders,developers,workflow,adapterSource=path.join(__dirname,'../shared')}){
 fs.mkdirSync(directory,{recursive:true});
 const settingsFile=path.join(directory,'connections.json'),discoveryFile=path.join(directory,'service.json');
 let data=fs.existsSync(settingsFile)?JSON.parse(fs.readFileSync(settingsFile,'utf8')):{schema:1,enabled:true,connections:[],clients:[]};
 if(data.schema!==1||typeof data.enabled!=='boolean'||!Array.isArray(data.connections)||!Array.isArray(data.clients))throw new Error('MCP 连接设置损坏，已保留原文件');
 if(data.connections.length>100||data.clients.length>100||new Set(data.connections.map(c=>c.id)).size!==data.connections.length||new Set(data.clients.map(c=>c.id)).size!==data.clients.length||data.connections.some(c=>!c||typeof c.id!=='string'||typeof c.name!=='string'||typeof c.projectId!=='string'||typeof c.memberId!=='string'||typeof c.credentialId!=='string'||typeof c.enabled!=='boolean')||data.clients.some(c=>!c||typeof c.id!=='string'||typeof c.name!=='string'||!/^[a-f0-9]{64}$/.test(c.tokenHash)||typeof c.revoked!=='boolean'||!Array.isArray(c.connectionIds)||c.connectionIds.some(id=>typeof id!=='string')))throw new Error('MCP 连接或会话记录格式无效，已保留原文件');
 data.policy??='credential';if(!['credential','approval'].includes(data.policy))throw new Error('MCP 接入策略无效');
 for(const c of data.clients){c.boundConnectionIds??=[];if(!Array.isArray(c.boundConnectionIds)||c.boundConnectionIds.some(id=>typeof id!=='string'))throw new Error('MCP 绑定记录无效');}
 const save=()=>atomicWrite(settingsFile,JSON.stringify(data,null,2));
 for(const file of ['workflow-global-mcp.cjs','workflow-mcp.cjs'])atomicWrite(path.join(directory,file),fs.readFileSync(path.join(adapterSource,file),'utf8'));
 const activity=new Map(),events=[],previews=new Map(),challenges=new Map();let inFlight=0;
 const catalog=()=>JSON.parse(storage.getItem('gamecreator.projects.v1')||'{"projects":[]}').projects||[];
 function identity(connection){
  const registered=catalog().find(p=>p.id===connection.projectId);if(!registered?.folderPath)throw new Error('项目未登记或未保存');
  const project=folders.verify(connection.projectId);
  const team=JSON.parse(storage.getItem('gamecreator.workspace.v1:'+project.id+':project-schedule')||'{}').personnel;
  const key=team?.credentials?.find(k=>k.id===connection.credentialId&&k.memberId===connection.memberId&&k.projectId===project.id);
  const member=team?.members?.find(m=>m.id===connection.memberId);
  if(!key?.persistent)throw new Error('项目、成员与长期令牌不匹配');
  if(key.revokedAt)throw new Error('身份令牌已撤销');
  if(!member?.active)throw new Error('开发者已停用');
  if(!Number.isFinite(Date.parse(key.createdAt))||Date.parse(key.createdAt)>Date.now())throw new Error('令牌创建时间无效');
  if(member.developer?.expiresAt&&(!Number.isFinite(Date.parse(member.developer.expiresAt))||Date.parse(member.developer.expiresAt)<=Date.now()))throw new Error('身份令牌已过期');
  if(!team.positions?.some(p=>p.active&&member.developer?.positionIds.includes(p.id)))throw new Error('开发者岗位未启用');
  return {project,member,key};
 }
 function publicConnection(c){try{const {project,member}=identity(c);return {...c,projectName:project.name,projectDirectory:project.folderPath,engineDirectory:project.config.projectPath,memberName:member.name,permissions:member.permissions,roles:member.roles,status:c.enabled?'available':'disabled',error:''};}catch(error){return {...c,status:'unavailable',error:error.message};}}
 function authenticate(input){
  if(typeof input.sessionId!=='string'||!/^[-a-f0-9]{36}$/.test(input.sessionId)||typeof input.token!=='string'||! /^[a-f0-9]{64}$/.test(input.token))throw new Error('无效 MCP 会话');
  const client=data.clients.find(c=>c.id===input.sessionId);
  if(!client||!timingSafeEqual(Buffer.from(client.tokenHash,'hex'),Buffer.from(digest(input.token),'hex')))throw new Error('MCP 会话未登记');
  if(client.revoked)throw new Error('MCP 会话已撤销，请重新建立连接并授权');
  activity.set(client.id,Date.now());return client;
 }
 function allowed(clientId,connectionId){
  if(!data.enabled)throw new Error('软件级 MCP 服务已停止');
  const client=data.clients.find(c=>c.id===clientId),connection=data.connections.find(c=>c.id===connectionId);
  if(!client||client.revoked||!client.boundConnectionIds.includes(connectionId)||!connection?.enabled)throw new Error('此会话未获准使用该连接，或连接已停用');
  if(data.policy==='approval'&&!client.connectionIds.includes(connectionId))throw new Error('凭证已验证；当前启用了附加会话审批，请在 MCP 连接页面批准此连接');
  return connection;
 }
 function config(){const command=process.env.GAMECREATOR_NODE_PATH||'node',args=[path.join(directory,'workflow-global-mcp.cjs')];return {json:JSON.stringify({mcpServers:{gamecreator:{command,args}}},null,2),toml:'[mcp_servers.gamecreator]\ncommand = '+JSON.stringify(command)+'\nargs = '+JSON.stringify(args)+'\n'};}
 function status(){
  const projects=catalog().map(p=>{let members=[],error='';try{const team=JSON.parse(storage.getItem('gamecreator.workspace.v1:'+p.id+':project-schedule')||'{}').personnel;members=(team?.credentials||[]).filter(k=>k.persistent&&!k.revokedAt).flatMap(k=>{const m=team.members.find(m=>m.id===k.memberId);if(!m?.active)return[];const c=publicConnection({projectId:p.id,memberId:m.id,credentialId:k.id,enabled:true});return [{id:m.id,name:m.name,credentialId:k.id,available:c.status==='available',error:c.error}];});}catch(e){error=e.message;}return{id:p.id,name:p.name,folderPath:p.folderPath||'',engineDirectory:p.config.projectPath,members,error};});
  return {enabled:data.enabled,policy:data.policy,version:'3.0.0',endpoint:'http://127.0.0.1:'+server.address().port+'/mcp',inFlight,config:config(),projects,connections:data.connections.map(publicConnection),sessions:data.clients.map(c=>({id:c.id,name:c.name,code:c.tokenHash.slice(0,8).toUpperCase(),connectionIds:c.connectionIds,boundConnectionIds:c.boundConnectionIds,revoked:c.revoked,online:Date.now()-(activity.get(c.id)||0)<60000,lastSeen:activity.has(c.id)?new Date(activity.get(c.id)).toISOString():null,createdAt:c.createdAt})),events:[...events]};
 }
 function change(operation,input){
  if(operation==='enabled'){if(typeof input.enabled!=='boolean')throw new Error('服务状态无效');data.enabled=input.enabled;}
  else if(operation==='policy'){if(!['credential','approval'].includes(input.policy))throw new Error('接入策略无效');data.policy=input.policy;}
  else if(operation==='add'){
   if(data.connections.length>=100)throw new Error('连接过多，请先删除未使用的连接');
   const candidate={id:randomUUID(),name:text(input.name,'连接名称'),projectId:text(input.projectId,'项目'),memberId:text(input.memberId,'成员'),credentialId:text(input.credentialId,'令牌'),enabled:true};identity(candidate);
   if(data.connections.some(c=>c.name===candidate.name||c.projectId===candidate.projectId&&c.memberId===candidate.memberId&&c.credentialId===candidate.credentialId))throw new Error('连接名称或项目身份已存在');data.connections.push(candidate);
  }else if(operation==='connection'){
   const c=data.connections.find(c=>c.id===input.id);if(!c)throw new Error('连接不存在');
   if(input.remove===true){data.connections=data.connections.filter(c=>c.id!==input.id);data.clients.forEach(s=>{s.connectionIds=s.connectionIds.filter(id=>id!==input.id);s.boundConnectionIds=s.boundConnectionIds.filter(id=>id!==input.id);});}
   else{if(typeof input.enabled!=='boolean')throw new Error('连接状态无效');if(input.enabled)identity(c);c.enabled=input.enabled;}
  }else if(operation==='session'){
   const c=data.clients.find(c=>c.id===input.id);if(!c)throw new Error('会话不存在');
   if(input.revoke===true){c.revoked=true;c.connectionIds=[];}
   else{
    if(c.revoked)throw new Error('已撤销会话不能恢复，请重新接入');
    if(!Array.isArray(input.connectionIds)||input.connectionIds.length>100||new Set(input.connectionIds).size!==input.connectionIds.length)throw new Error('连接授权无效');
    for(const id of input.connectionIds){const connection=data.connections.find(c=>c.id===id&&c.enabled);if(!connection)throw new Error('连接未启用');identity(connection);}c.connectionIds=input.connectionIds;
   }
  }else if(operation==='remove-session'){
   const c=data.clients.find(c=>c.id===input.id);if(!c?.revoked)throw new Error('请先撤销会话');data.clients=data.clients.filter(c=>c.id!==input.id);
  }else throw new Error('未知 MCP 管理操作');
  save();
 }
 function manage(operation,input={}){
  if(operation==='status')return status();
  const previous=structuredClone(data);try{change(operation,input);}catch(error){data=previous;throw error;}return status();
 }
 function verifyProof(proof,client,purpose,connectionId){
  const nonce=proof?.accessContext?.nonce,c=challenges.get(nonce);challenges.delete(nonce);
  if(!c||c.expiresAt<Date.now()||c.clientId!==client.id||c.purpose!==purpose||c.connectionId!==connectionId)throw new Error('凭证挑战无效、已使用或已过期，请重试');
  if(!object(proof)||proof.schema!==1||proof.session!==workflow.session||proof.accessContext.sessionId!==client.id||proof.accessContext.connectionId!==connectionId||!Number.isFinite(Date.parse(proof.at))||Math.abs(Date.now()-Date.parse(proof.at))>120000||['projectId','memberId','credentialId'].some(k=>proof[k]!==c.identity[k])||purpose==='bind'&&proof.operation!=='credential_bind')throw new Error('凭证证明的项目、身份或请求上下文不匹配');
  const context=identity(proof),{signature,...body}=proof;let valid=false;
  try{valid=verify(null,Buffer.from(canonical(body)),createPublicKey({key:Buffer.from(context.key.publicKey,'base64'),type:'spki',format:'der'}),Buffer.from(signature,'base64'));}catch{}
  if(!valid)throw new Error('凭证签名无效，无法证明持有当前身份令牌');
  return context;
 }
 async function request(input){
  if(!object(input))throw new Error('MCP 请求格式无效');
  if(!data.enabled)throw new Error('软件级 MCP 服务已停止');
  if(input.operation==='connect'&&!data.clients.some(c=>c.id===input.sessionId)){
   if(typeof input.sessionId!=='string'||!/^[-a-f0-9]{36}$/.test(input.sessionId)||typeof input.token!=='string'||!/^[a-f0-9]{64}$/.test(input.token))throw new Error('无效 MCP 会话');
   if(data.clients.length>=100)throw new Error('MCP 会话已达上限，请在连接页清理旧会话');
   data.clients.push({id:input.sessionId,name:text(input.name,'客户端名称'),tokenHash:digest(input.token),connectionIds:[],boundConnectionIds:[],revoked:false,createdAt:new Date().toISOString()});save();
  }
  const client=authenticate(input);
  if(input.operation==='disconnect'){activity.delete(client.id);return{disconnected:true};}
  if(['connect','heartbeat'].includes(input.operation))return{sessionId:client.id,verificationCode:client.tokenHash.slice(0,8).toUpperCase(),policy:data.policy,authorized:client.boundConnectionIds.length>0};
  if(input.operation==='list')return{sessionId:client.id,verificationCode:client.tokenHash.slice(0,8).toUpperCase(),policy:data.policy,connections:data.connections.filter(c=>client.boundConnectionIds.includes(c.id)).map(c=>({...publicConnection(c),access:data.policy==='credential'||client.connectionIds.includes(c.id)?'credential_required':'pending_approval'})),hint:'调用 gc_connect_credential 并提供用户交付的凭证路径；每次操作都需 credentialFile 和 connectionId。'};
  if(input.operation==='challenge'){
   if(!['bind','call'].includes(input.purpose)||!object(input.identity)||['projectId','memberId','credentialId'].some(k=>typeof input.identity[k]!=='string'||input.identity[k].length>200))throw new Error('凭证挑战参数无效');
   for(const [id,c]of challenges)if(c.expiresAt<Date.now())challenges.delete(id);
   if(challenges.size>=1024||[...challenges.values()].filter(c=>c.clientId===client.id).length>=32)throw new Error('待处理的凭证挑战过多，请稍后重试');
   const nonce=randomBytes(32).toString('hex'),expiresAt=Date.now()+60000;
   challenges.set(nonce,{clientId:client.id,purpose:input.purpose,identity:input.identity,connectionId:input.connectionId,expiresAt});
   return{nonce,serviceSession:workflow.session,expiresAt:new Date(expiresAt).toISOString()};
  }
  if(!['bind','signed-call'].includes(input.operation))throw new Error('需要逐次凭证签名，请重启 MCP 适配器以加载 3.0 版本');
  const proof=input.proof,purpose=input.operation==='bind'?'bind':'call';
  const context=verifyProof(proof,client,purpose,input.connectionId);
  if(purpose==='bind'){
   const previous=structuredClone(data);let connection;
   try{
    connection=data.connections.find(c=>c.projectId===proof.projectId&&c.memberId===proof.memberId&&c.credentialId===proof.credentialId);
    if(connection&&!connection.enabled)throw new Error('此身份连接已停用，请由管理者启用');
    if(!connection){if(data.connections.length>=100)throw new Error('连接过多，请清理未使用连接');connection={id:randomUUID(),name:context.project.name+' · '+context.member.name,projectId:proof.projectId,memberId:proof.memberId,credentialId:proof.credentialId,enabled:true};data.connections.push(connection);}
    if(!client.boundConnectionIds.includes(connection.id))client.boundConnectionIds.push(connection.id);save();
   }catch(error){data=previous;throw error;}
   return{connection:publicConnection(connection),policy:data.policy,access:data.policy==='credential'||client.connectionIds.includes(connection.id)?'ready':'pending_approval',verificationCode:client.tokenHash.slice(0,8).toUpperCase(),hint:'每次调用同时提供 connectionId 和 credentialFile；连接编号不提供身份授权。'};
  }
  const connection=allowed(client.id,input.connectionId),guard=()=>{allowed(client.id,connection.id);};
  if(connection.projectId!==proof.projectId||connection.memberId!==proof.memberId||connection.credentialId!==proof.credentialId)throw new Error('当前凭证身份与目标连接不匹配');
  const tool='gc_'+proof.operation;if(!tools.some(t=>t.name===tool))throw new Error('未知工作流操作');
  if(proof.input?.proposal&&proof.input.proposal.projectId!==connection.projectId)throw new Error('设计草稿不属于此连接的项目');
  const previewKey=token=>client.id+':'+connection.id+':'+token;
  for(const [key,time]of previews)if(Date.now()-time>600000)previews.delete(key);
  if(tool==='gc_engine_apply'&&!previews.has(previewKey(proof.input?.token)))throw new Error('同步预览不属于此会话与连接，或已过期；请重新预览');
  const event={id:randomUUID(),at:new Date().toISOString(),sessionId:client.id,clientName:client.name,connectionId:connection.id,connectionName:connection.name,tool,status:'running'};events.unshift(event);if(events.length>100)events.pop();inFlight++;
  try{const result=await workflow.run(proof,guard);if(tool==='gc_engine_preview'&&result.token)previews.set(previewKey(result.token),Date.now());event.status='succeeded';return result;}
  catch(error){event.status='failed';event.error=error.message;throw error;}finally{inFlight--;}
 }
 const server=http.createServer(async(req,res)=>{
  const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  if(req.method!=='POST'||req.url!=='/mcp'||req.headers.origin||req.headers.host!=='127.0.0.1:'+server.address().port)return send(403,{error:'只接受本机 MCP 会话请求'});
  try{let length=0;const chunks=[];for await(const chunk of req){length+=chunk.length;if(length>3*1024*1024)throw new Error('请求过大');chunks.push(chunk);}send(200,await request(JSON.parse(Buffer.concat(chunks).toString('utf8'))));}catch(error){send(400,{error:error.message,diagnostics:error.diagnostics||[]});}
 });
 server.requestTimeout=30000;server.headersTimeout=10000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 try{atomicWrite(discoveryFile,JSON.stringify({schema:1,endpoint:'http://127.0.0.1:'+server.address().port+'/mcp'},null,2));}catch(error){server.close();throw error;}
 return {manage,server,discoveryFile,close(){server.close();},request};
}
module.exports={createMcpConnections};
