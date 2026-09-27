#!/usr/bin/env node
// Software-level adapter: no project credential or default project in client configuration.
const fs=require('node:fs'),path=require('node:path');
const {randomUUID,randomBytes,createHash}=require('node:crypto');
const {serve,tools:legacyTools}=require('./workflow-mcp.cjs');
const tools=[{name:'gc_connections',description:'列出此 MCP 会话获准使用的项目与身份连接。首次调用后，在 GameCreator 的 MCP 连接页面核对接入码并授权。',inputSchema:{type:'object',properties:{},additionalProperties:false}},...legacyTools.map(t=>({...t,inputSchema:{...t.inputSchema,properties:{connectionId:{type:'string',description:'gc_connections 返回的明确连接 ID；不使用当前项目。'},...t.inputSchema.properties},required:['connectionId',...t.inputSchema.required]}}))];
function createGlobalClient({discoveryFile=path.join(__dirname,'service.json'),name='AI 客户端',sessionId=randomUUID(),token=randomBytes(32).toString('hex')}={}){
 let timer,closed=false;
 async function request(operation,input={}){
  let discovery;try{discovery=JSON.parse(fs.readFileSync(discoveryFile,'utf8'));}catch{throw new Error('GameCreator MCP 服务未在线，请启动软件并检查 MCP 连接页面。');}
  if(discovery.schema!==1||!/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(discovery.endpoint))throw new Error('MCP 本机发现文件无效');
  let response;try{response=await fetch(discovery.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,sessionId,token,...input}),redirect:'error',signal:AbortSignal.timeout(operation==='call'?65000:10000)});}catch{throw new Error('GameCreator MCP 服务无法连接；检查软件运行状态。写入超时后用原 requestId 查询 gc_operation_status。');}
  const result=await response.json();if(!response.ok){const error=new Error(result.error||'MCP 请求失败');error.diagnostics=result.diagnostics||[];throw error;}return result;
 }
 async function connect(){const result=await request('connect',{name});if(!timer&&!closed){timer=setInterval(()=>request('heartbeat').catch(()=>{}),20000);timer.unref();}return result;}
 return {sessionId,verificationCode:createHash('sha256').update(token).digest('hex').slice(0,8).toUpperCase(),setName(value){if(typeof value==='string')name=value.slice(0,80);},async call(tool,args={}){
  if(closed)throw new Error('MCP 会话已关闭');
  const spec=tools.find(t=>t.name===tool);if(!spec||!args||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(spec.inputSchema.properties,k)))throw new Error('未知工具或参数');
  if(tool==='gc_connections'){await connect();return request('list');}
  if(typeof args.connectionId!=='string'||!args.connectionId)throw new Error('必须明确指定 connectionId；先调用 gc_connections。');
  await connect();const {connectionId,...input}=args;return request('call',{connectionId,tool,args:input});
 },async close(){closed=true;clearInterval(timer);await request('disconnect').catch(()=>{});}};
}
if(require.main===module){const client=createGlobalClient();serve(client,{tools,name:'gamecreator-global',version:'2.0.0',instructions:'先调用 gc_connections，并在 GameCreator 的 MCP 连接页面完成本会话授权。每次操作明确指定返回的 connectionId。只使用分配给自己的开发者身份；不得申请其他岗位身份代做。项目切换不会改变工具目标。写入使用唯一 requestId，超时后先查询。',onInitialize:info=>client.setName(info?.name),onClose:()=>client.close()});}
module.exports={createGlobalClient,tools};
