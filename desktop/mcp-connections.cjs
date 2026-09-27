const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {randomUUID,createHash,timingSafeEqual}=require('node:crypto');
const {atomicWrite}=require('./storage.cjs');
const {createClient,tools}=require('../shared/workflow-mcp.cjs');
const digest=value=>createHash('sha256').update(value).digest('hex');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,label)=>{if(typeof value!=='string'||!value.trim()||value.length>200)throw new Error(label+'无效');return value.trim();};
async function createMcpConnections({directory,storage,folders,developers,workflow,adapterSource=path.join(__dirname,'../shared')}){
 fs.mkdirSync(directory,{recursive:true});
 const settingsFile=path.join(directory,'connections.json'),discoveryFile=path.join(directory,'service.json');
 let data=fs.existsSync(settingsFile)?JSON.parse(fs.readFileSync(settingsFile,'utf8')):{schema:1,enabled:true,connections:[],clients:[]};
 if(data.schema!==1||typeof data.enabled!=='boolean'||!Array.isArray(data.connections)||!Array.isArray(data.clients))throw new Error('MCP 连接设置损坏，已保留原文件');
 if(data.connections.length>100||data.clients.length>100||new Set(data.connections.map(c=>c.id)).size!==data.connections.length||new Set(data.clients.map(c=>c.id)).size!==data.clients.length||data.connections.some(c=>!c||typeof c.id!=='string'||typeof c.name!=='string'||typeof c.projectId!=='string'||typeof c.memberId!=='string'||typeof c.credentialId!=='string'||typeof c.enabled!=='boolean')||data.clients.some(c=>!c||typeof c.id!=='string'||typeof c.name!=='string'||!/^[a-f0-9]{64}$/.test(c.tokenHash)||typeof c.revoked!=='boolean'||!Array.isArray(c.connectionIds)||c.connectionIds.some(id=>typeof id!=='string')))throw new Error('MCP 连接或会话记录格式无效，已保留原文件');
 const save=()=>atomicWrite(settingsFile,JSON.stringify(data,null,2));
 for(const file of ['workflow-global-mcp.cjs','workflow-mcp.cjs'])atomicWrite(path.join(directory,file),fs.readFileSync(path.join(adapterSource,file),'utf8'));
 const activity=new Map(),events=[],previews=new Map();let inFlight=0;
 const catalog=()=>JSON.parse(storage.getItem('gamecreator.projects.v1')||'{"projects":[]}').projects||[];
 function identity(connection){
  const registered=catalog().find(p=>p.id===connection.projectId);if(!registered?.folderPath)throw new Error('项目未登记或未保存');
  const project=folders.verify(connection.projectId);
  const team=JSON.parse(storage.getItem('gamecreator.workspace.v1:'+project.id+':project-schedule')||'{}').personnel;
  const key=team?.credentials?.find(k=>k.id===connection.credentialId&&k.memberId===connection.memberId&&k.projectId===project.id);
  const member=team?.members?.find(m=>m.id===connection.memberId);
  if(!key?.persistent||key.revokedAt||!member?.active||member.developer?.expiresAt&&Date.parse(member.developer.expiresAt)<=Date.now()||!team.positions?.some(p=>p.active&&member.developer?.positionIds.includes(p.id)))throw new Error('开发者已停用、令牌失效或岗位未启用');
  // Verify the protected local credential exists and still matches this public identity.
  const secret=developers.read({projectId:project.id,credentialId:key.id});
  return {project,member,key,secret};
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
  if(!client||client.revoked||!client.connectionIds.includes(connectionId)||!connection?.enabled)throw new Error('此会话未获准使用该连接，或连接已停用');
  return connection;
 }
 function config(){const command=process.env.GAMECREATOR_NODE_PATH||'node',args=[path.join(directory,'workflow-global-mcp.cjs')];return {json:JSON.stringify({mcpServers:{gamecreator:{command,args}}},null,2),toml:'[mcp_servers.gamecreator]\ncommand = '+JSON.stringify(command)+'\nargs = '+JSON.stringify(args)+'\n'};}
 function status(){
  const projects=catalog().map(p=>{let members=[],error='';try{const team=JSON.parse(storage.getItem('gamecreator.workspace.v1:'+p.id+':project-schedule')||'{}').personnel;members=(team?.credentials||[]).filter(k=>k.persistent&&!k.revokedAt).flatMap(k=>{const m=team.members.find(m=>m.id===k.memberId);if(!m?.active)return[];const c=publicConnection({projectId:p.id,memberId:m.id,credentialId:k.id,enabled:true});return [{id:m.id,name:m.name,credentialId:k.id,available:c.status==='available',error:c.error}];});}catch(e){error=e.message;}return{id:p.id,name:p.name,folderPath:p.folderPath||'',engineDirectory:p.config.projectPath,members,error};});
  return {enabled:data.enabled,version:'2.0.0',endpoint:'http://127.0.0.1:'+server.address().port+'/mcp',inFlight,config:config(),projects,connections:data.connections.map(publicConnection),sessions:data.clients.map(c=>({id:c.id,name:c.name,code:c.tokenHash.slice(0,8).toUpperCase(),connectionIds:c.connectionIds,revoked:c.revoked,online:Date.now()-(activity.get(c.id)||0)<60000,lastSeen:activity.has(c.id)?new Date(activity.get(c.id)).toISOString():null,createdAt:c.createdAt})),events:[...events]};
 }
 function change(operation,input){
  if(operation==='enabled'){if(typeof input.enabled!=='boolean')throw new Error('服务状态无效');data.enabled=input.enabled;}
  else if(operation==='add'){
   if(data.connections.length>=100)throw new Error('连接过多，请先删除未使用的连接');
   const candidate={id:randomUUID(),name:text(input.name,'连接名称'),projectId:text(input.projectId,'项目'),memberId:text(input.memberId,'成员'),credentialId:text(input.credentialId,'令牌'),enabled:true};identity(candidate);
   if(data.connections.some(c=>c.name===candidate.name||c.projectId===candidate.projectId&&c.memberId===candidate.memberId&&c.credentialId===candidate.credentialId))throw new Error('连接名称或项目身份已存在');data.connections.push(candidate);
  }else if(operation==='connection'){
   const c=data.connections.find(c=>c.id===input.id);if(!c)throw new Error('连接不存在');
   if(input.remove===true){data.connections=data.connections.filter(c=>c.id!==input.id);data.clients.forEach(s=>s.connectionIds=s.connectionIds.filter(id=>id!==input.id));}
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
 async function request(input){
  if(!object(input))throw new Error('MCP 请求格式无效');
  if(!data.enabled)throw new Error('软件级 MCP 服务已停止');
  if(input.operation==='connect'&&!data.clients.some(c=>c.id===input.sessionId)){
   if(typeof input.sessionId!=='string'||!/^[-a-f0-9]{36}$/.test(input.sessionId)||typeof input.token!=='string'||!/^[a-f0-9]{64}$/.test(input.token))throw new Error('无效 MCP 会话');
   if(data.clients.length>=100)throw new Error('MCP 会话已达上限，请在连接页清理旧会话');
   data.clients.push({id:input.sessionId,name:text(input.name,'客户端名称'),tokenHash:digest(input.token),connectionIds:[],revoked:false,createdAt:new Date().toISOString()});save();
  }
  const client=authenticate(input);
  if(input.operation==='disconnect'){activity.delete(client.id);return{disconnected:true};}
  if(['connect','heartbeat'].includes(input.operation))return{sessionId:client.id,verificationCode:client.tokenHash.slice(0,8).toUpperCase(),authorized:client.connectionIds.length>0};
  if(input.operation==='list')return{sessionId:client.id,verificationCode:client.tokenHash.slice(0,8).toUpperCase(),connections:data.connections.filter(c=>client.connectionIds.includes(c.id)).map(publicConnection),hint:client.connectionIds.length?'每次调用明确指定 connectionId，并核对项目和身份。':'在 GameCreator → MCP 连接核对接入码，为此会话授权所需连接。'};
  if(input.operation!=='call'||typeof input.connectionId!=='string'||!tools.some(t=>t.name===input.tool)||!object(input.args))throw new Error('必须指定有效工具与 connectionId');
  const connection=allowed(client.id,input.connectionId),context=identity(connection),guard=()=>{allowed(client.id,connection.id);};
  if(input.args.draft&&input.args.draft.projectId!==connection.projectId)throw new Error('设计草稿不属于此连接的项目');
  const previewKey=token=>client.id+':'+connection.id+':'+token;
  for(const [key,time]of previews)if(Date.now()-time>600000)previews.delete(key);
  if(input.tool==='gc_engine_apply'&&!previews.has(previewKey(input.args.token)))throw new Error('同步预览不属于此会话与连接，或已过期；请重新预览');
  const adapter=createClient({readSecret:()=>context.secret,readEndpoint:()=>({projectId:connection.projectId,session:workflow.session}),accessContext:{sessionId:client.id,connectionId:connection.id},dispatch:r=>workflow.run(r,guard)});
  const event={id:randomUUID(),at:new Date().toISOString(),sessionId:client.id,clientName:client.name,connectionId:connection.id,connectionName:connection.name,tool:input.tool,status:'running'};events.unshift(event);if(events.length>100)events.pop();inFlight++;
  try{const result=await adapter.call(input.tool,input.args);if(input.tool==='gc_engine_preview'&&result.token)previews.set(previewKey(result.token),Date.now());event.status='succeeded';return result;}
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
