#!/usr/bin/env node
// Standalone stdio MCP adapter, exported with each management project's collaboration files.
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const {randomUUID,createPrivateKey,sign}=require('node:crypto');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const str={type:'string'},obj={type:'object'},choices=values=>({type:'object',additionalProperties:{type:'string',enum:values}});
const specs=[
 ['project_read','读取绑定项目的当前版本、身份权限、同步配置及指定内容模块。templates=true 返回内容模板。',{modules:{type:'array',items:str},templates:{type:'boolean'}},[]],
 ['content_validate','校验设计草稿并返回字段差异和诊断，不写入提交文件。draft 使用已导出的 snapshotId。',{draft:obj},['draft']],
 ['content_submit','签名并保存设计提交，尚不应用。requestId 为本次操作唯一编号，重试沿用原编号。',{draft:obj,requestId:str},['draft','requestId']],
 ['content_scan','列出待处理设计提交及处理记录，返回 digest/reviewId 供后续预览与应用。',{},[]],
 ['content_preview','重新检查选定设计提交及冲突选择。使用 scan 返回的 id、digest、reviewId。',{id:str,digest:str,reviewId:str,decisions:choices(['keep','proposal'])},['id','digest','reviewId']],
 ['content_apply','按当前授权应用已检查的设计提交。冲突逐项指定 keep/proposal；过期版本会拒绝。',{id:str,digest:str,reviewId:str,decisions:choices(['keep','proposal']),requestId:str},['id','digest','reviewId','requestId']],
 ['collaboration_export','更新管理项目 ai/ 的协作快照、指南和编写工具。需要全部模块的项目写入授权。',{requestId:str},['requestId']],
 ['engine_preview','按已保存配置预览文档与成员凭证同步。返回独立 token、文件差异和冲突；不更换工程绑定。',{},[]],
 ['engine_apply','执行当前开发者的工程同步预览。decisions 按文件路径选择 keep/replace，removals 明确列出允许移除的路径。',{token:str,decisions:choices(['keep','replace']),removals:{type:'array',items:str},requestId:str},['token','requestId']],
 ['operation_status','根据 requestId 查询执行状态。超时后先查询，再决定重试；running 在服务重启后可能需要检查处理记录。',{requestId:str},['requestId']],
 ['history','读取内容应用、工程同步和最近工作流执行记录。',{},[]]
];
const tools=specs.map(([name,description,properties,required])=>({name:'gc_'+name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}}));
function read(file){return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
function createClient({projectDirectory,credentialFile,readSecret,readEndpoint,dispatch,accessContext}){
 async function call(name,args={}){
  const spec=specs.find(s=>'gc_'+s[0]===name);if(!spec)throw new Error('未知工作流工具');
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(spec[2],k))||spec[3].some(k=>!Object.hasOwn(args,k)))throw new Error('工具参数缺失或包含未知字段');
  const secret=readSecret?readSecret():read(credentialFile),endpoint=readEndpoint?readEndpoint():read(path.join(projectDirectory,'ai/workflow-service.json'));
  if(secret.schema!==2||secret.projectId!==endpoint.projectId||!dispatch&&!/^http:\/\/127\.0\.0\.1:\d+\/workflow$/.test(endpoint.endpoint))throw new Error('工作流端点与开发者凭证不匹配');
  const privateKey=createPrivateKey({key:Buffer.from(secret.privateKey,'base64'),type:'pkcs8',format:'der'});if(privateKey.asymmetricKeyType!=='ed25519')throw new Error('凭证密钥格式无效');
  const {requestId,...input}=args;
  if(spec[0]==='operation_status')input.requestId=requestId;
  if(input.draft){const {identity,...draft}=input.draft;const proposal={...draft,author:secret.memberName,identity:{memberId:secret.memberId,credentialId:secret.credentialId}};proposal.identity.signature=sign(null,Buffer.from(canonical(proposal)),privateKey).toString('base64');input.proposal=proposal;delete input.draft;}
  const body={schema:1,session:endpoint.session,id:spec[0]==='operation_status'?randomUUID():requestId||randomUUID(),at:new Date().toISOString(),projectId:secret.projectId,memberId:secret.memberId,credentialId:secret.credentialId,operation:spec[0],input};
  if(accessContext)body.accessContext=accessContext;
  body.signature=sign(null,Buffer.from(canonical(body)),privateKey).toString('base64');
  if(dispatch)return dispatch(body);
  const response=await fetch(endpoint.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000),redirect:'error'}),result=await response.json();
  if(!response.ok){const error=new Error(result.error||'工作流操作失败');error.diagnostics=result.diagnostics||[];throw error;}return result;
 }
 return {call};
}
function serve(client,options={}){
 let initialized=false;
 const output=v=>process.stdout.write(JSON.stringify(v)+'\n');
 const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
 rl.on('line',async line=>{
  let r;try{if(Buffer.byteLength(line)>3*1024*1024)throw new Error();r=JSON.parse(line);}catch{output({jsonrpc:'2.0',id:null,error:{code:-32700,message:'无效 JSON 或请求过大'}});return;}
  if(r.id===undefined)return;
  const respond=result=>output({jsonrpc:'2.0',id:r.id,result}),fail=(code,message)=>output({jsonrpc:'2.0',id:r.id,error:{code,message}});
  if(r.jsonrpc!=='2.0'||typeof r.method!=='string')return fail(-32600,'无效请求');
  if(r.method==='initialize'){initialized=true;options.onInitialize?.(r.params?.clientInfo);return respond({protocolVersion:['2024-11-05','2025-03-26','2025-06-18'].includes(r.params?.protocolVersion)?r.params.protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:options.name||'gamecreator-workflow',version:options.version||'1.0.0'},instructions:options.instructions||'先读取 gc_project_read。使用当前快照提交设计，查看差异再应用；工程同步使用独立预览 token。每项写入使用稳定的 requestId，超时先查询状态。'});}
  if(r.method==='ping')return respond({});if(!initialized)return fail(-32000,'请先初始化 MCP 连接');
  if(r.method==='tools/list')return respond({tools:options.tools||tools});
  if(r.method!=='tools/call')return fail(-32601,'未知 MCP 方法');
  try{const value=await client.call(r.params?.name,r.params?.arguments||{});respond({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,isError:false});}
  catch(error){respond({isError:true,content:[{type:'text',text:JSON.stringify({error:error.message,diagnostics:error.diagnostics||[],hint:'检查项目绑定和当前权限；超时后使用原 requestId 查询 gc_operation_status。'})}]});}
 });
 rl.on('close',()=>options.onClose?.());
}
if(require.main===module){
 const args=process.argv.slice(2),option=k=>args[args.indexOf(k)+1];
 const projectDirectory=args.includes('--project')?option('--project'):path.resolve(__dirname,'..'),credentialFile=args.includes('--credential')?option('--credential'):process.env.GAMECREATOR_CREDENTIAL_FILE;
 if(!credentialFile){process.stderr.write('请用 --credential 或 GAMECREATOR_CREDENTIAL_FILE 指定开发者凭证文件。\n');process.exitCode=1;}else serve(createClient({projectDirectory:path.resolve(projectDirectory),credentialFile:path.resolve(credentialFile)}));
}
module.exports={createClient,tools,serve};
