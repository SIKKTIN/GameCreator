// Exported standalone client. Never prints private credentials.
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createPrivateKey,sign}=require('node:crypto');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
async function main(){
 const [operation,credentialPath,draftPath,outputPath]=process.argv.slice(2);
 if(!operation||!credentialPath)throw new Error('用法：node manage-team.cjs status <制作人凭证.json>；或 run <制作人凭证.json> <请求.json> [新凭证保存路径]');
 const endpoint=read(path.join(__dirname,'team-service.json')),secret=read(credentialPath),draft=operation==='status'?{id:randomUUID(),operation:'status',input:{}}:operation==='run'?read(draftPath):null;
 if(!draft)throw new Error('未知命令');
 if(endpoint.projectId!==secret.projectId||!/^http:\/\/127\.0\.0\.1:\d+\/team$/.test(endpoint.endpoint))throw new Error('本机服务与凭证项目不匹配');
 const needsOutput=['create','rotate','credential'].includes(draft.operation);
 if(needsOutput&&(!outputPath||fs.existsSync(outputPath)))throw new Error('请指定不存在的新凭证保存路径；如已保存，请先核对文件，避免重复签发');
 // Reserve the private destination before making any change. Fail locally for unwritable paths.
 const fd=needsOutput?fs.openSync(outputPath,'wx',0o600):undefined;let saved=false;
 try{
  const body={...draft,schema:1,projectId:secret.projectId,memberId:secret.memberId,credentialId:secret.credentialId,session:endpoint.session,at:new Date().toISOString()};
  delete body.signature;body.signature=sign(null,Buffer.from(canonical(body)),createPrivateKey({key:Buffer.from(secret.privateKey,'base64'),type:'pkcs8',format:'der'})).toString('base64');
  const response=await fetch(endpoint.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)}),result=await response.json();
  if(!response.ok)throw new Error(result.error||'团队管理失败');
  const {secret:issued,...publicResult}=result;
  if(issued){if(fd===undefined)throw new Error('缺少私有凭证保存位置');fs.writeFileSync(fd,JSON.stringify(issued,null,2)+'\n');fs.fsyncSync(fd);saved=true;publicResult.credentialFile=path.resolve(outputPath);}
  console.log(JSON.stringify(publicResult,null,2));
 }finally{if(fd!==undefined){fs.closeSync(fd);if(!saved)fs.unlinkSync(outputPath);}}
}
if(require.main===module)main().catch(e=>{console.error(e.message+'\n请保持 GameCreator 打开对应项目，并更新协作文件。请求可能已成功时，使用原请求编号重试，不要换编号重复创建。');process.exitCode=1;});
