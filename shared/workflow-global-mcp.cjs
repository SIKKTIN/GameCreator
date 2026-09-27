#!/usr/bin/env node
// No credential binding is cached; every operation proves possession again.
const fs=require('node:fs'),path=require('node:path');
const {randomUUID,randomBytes,createHash,createPrivateKey,sign}=require('node:crypto');
const {serve,createClient,canonical,tools:legacyTools}=require('./workflow-mcp.cjs');
const credentialFile={type:'string',description:'用户交付给当前助手的凭证 JSON 绝对路径。每次调用重新读取并签名。'};
const tools=[{name:'gc_connections',description:'列出本进程已验证的身份连接。连接编号不能代替凭证。',inputSchema:{type:'object',properties:{},additionalProperties:false}},
{name:'gc_connect_credential',description:'用长期身份凭证签名绑定其所属项目。默认无需人工审批，不修改项目内容。',inputSchema:{type:'object',properties:{credentialFile},required:['credentialFile'],additionalProperties:false}},
...legacyTools.map(t=>({...t,inputSchema:{...t.inputSchema,properties:{connectionId:{type:'string',description:'凭证绑定返回的明确连接 ID'},credentialFile,...t.inputSchema.properties},required:['connectionId','credentialFile',...t.inputSchema.required]}}))];
function readCredential(filename){
 if(typeof filename!=='string'||!path.isAbsolute(filename))throw new Error('credentialFile 必须是用户交付的凭证文件绝对路径');
 let raw;try{const stat=fs.statSync(filename);if(!stat.isFile()||stat.size>32768)throw new Error();raw=fs.readFileSync(filename,'utf8');}catch{throw new Error('无法读取凭证文件：请检查文件是否存在、读取权限及文件大小');}
 try{const s=JSON.parse(raw.replace(/^\uFEFF/,''));if(s.schema!==2||['projectId','memberId','credentialId','memberName','privateKey'].some(k=>typeof s[k]!=='string'||!s[k])||s.privateKey.length>1000)throw new Error();const key=createPrivateKey({key:Buffer.from(s.privateKey,'base64'),type:'pkcs8',format:'der'});if(key.asymmetricKeyType!=='ed25519')throw new Error();return s;}catch{throw new Error('凭证格式无效：需要 schema 2 长期身份及有效 Ed25519 私钥');}
}
function createGlobalClient({discoveryFile=path.join(__dirname,'service.json'),name='AI 客户端',sessionId=randomUUID(),token=randomBytes(32).toString('hex')}={}){
 let timer,closed=false;
 async function request(operation,input={}){
  let d;try{d=JSON.parse(fs.readFileSync(discoveryFile,'utf8'));}catch{throw new Error('GameCreator MCP 服务未在线，请启动软件。');}
  if(d.schema!==1||!/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(d.endpoint))throw new Error('MCP 本机发现文件无效');
  let response;try{response=await fetch(d.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,sessionId,token,...input}),redirect:'error',signal:AbortSignal.timeout(operation==='signed-call'?65000:10000)});}catch{throw new Error('GameCreator MCP 服务无法连接；写入超时后用原 requestId 查询 gc_operation_status。');}
  const result=await response.json();if(!response.ok){const e=new Error(result.error||'MCP 请求失败');e.diagnostics=result.diagnostics||[];throw e;}return result;
 }
 async function connect(){const r=await request('connect',{name});if(!timer&&!closed){timer=setInterval(()=>request('heartbeat').catch(()=>{}),20000);timer.unref();}return r;}
 return {sessionId,verificationCode:createHash('sha256').update(token).digest('hex').slice(0,8).toUpperCase(),setName(v){if(typeof v==='string')name=v.slice(0,80);},async call(tool,args={}){
  if(closed)throw new Error('MCP 会话已关闭');const spec=tools.find(t=>t.name===tool);if(!spec||!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(spec.inputSchema.properties,k)))throw new Error('未知工具或参数');
  if(tool==='gc_connections'){await connect();return request('list');}
  const secret=readCredential(args.credentialFile),identity={projectId:secret.projectId,memberId:secret.memberId,credentialId:secret.credentialId},binding=tool==='gc_connect_credential';
  if(!binding&&(typeof args.connectionId!=='string'||!args.connectionId))throw new Error('必须明确指定 connectionId；先调用 gc_connect_credential。');
  await connect();const challenge=await request('challenge',{purpose:binding?'bind':'call',identity,...(!binding?{connectionId:args.connectionId}:{})});
  const accessContext={sessionId,nonce:challenge.nonce,...(!binding?{connectionId:args.connectionId}:{})};
  if(binding){const proof={schema:1,session:challenge.serviceSession,id:randomUUID(),at:new Date().toISOString(),...identity,operation:'credential_bind',input:{},accessContext};proof.signature=sign(null,Buffer.from(canonical(proof)),createPrivateKey({key:Buffer.from(secret.privateKey,'base64'),type:'pkcs8',format:'der'})).toString('base64');return request('bind',{proof});}
  const {connectionId,credentialFile:_,...input}=args;
  return createClient({readSecret:()=>secret,readEndpoint:()=>({projectId:secret.projectId,session:challenge.serviceSession}),accessContext,dispatch:proof=>request('signed-call',{connectionId,proof})}).call(tool,input);
 },async close(){closed=true;clearInterval(timer);await request('disconnect').catch(()=>{});}};
}
if(require.main===module){const client=createGlobalClient();serve(client,{tools,name:'gamecreator-global',version:'3.0.0',instructions:'用用户交付的凭证文件调用 gc_connect_credential。默认无需人工审批；每次工作流操作同时传 connectionId 和 credentialFile 并重新签名。编号不是授权，不读取其他成员凭证。只有软件启用附加审批时才核对接入码。写入使用唯一 requestId，超时先查询状态。',onInitialize:i=>client.setName(i?.name),onClose:()=>client.close()});}
module.exports={createGlobalClient,tools,readCredential};
