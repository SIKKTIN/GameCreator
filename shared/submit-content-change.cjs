#!/usr/bin/env node
// Exported with a self-contained, editor-generated validator. No network or dependencies.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const argv=process.argv.slice(2),json=argv.includes('--json'),args=argv.filter(a=>a!=='--json');
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const read=(p,max=2*1024*1024)=>{const stat=fs.lstatSync(p);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)throw new Error('文件无效或过大：'+p);return fs.readFileSync(p,'utf8');};
const parse=s=>JSON.parse(s.replace(/^\uFEFF/,''));
const report=v=>console.log(json?JSON.stringify(v):v.message);
function main(){
 const [command,source,credentialPath]=args;
 if(!['validate','submit'].includes(command)||!source||args.length>(command==='submit'?3:2))throw new Error('用法：node ai/submit-change.cjs validate|submit change.json [credential.json] [--json]');
 const project=parse(read(path.join(__dirname,'project.json'))),p=parse(read(path.resolve(source)));
 if(p.projectId!==project.projectId||p.snapshotId!==project.snapshotId||!/^\w[\w-]{7,99}$/.test(p.id)||!/^[a-f0-9]{64}$/.test(p.snapshotId))throw new Error('项目、提交编号或基准不匹配，请更新协作文件后重新编写');
 if(!project.validator?.version||!/^[a-f0-9]{64}$/.test(project.validator.sha256))throw new Error('缺少完整校验包，请在客户端“使用说明 → 项目编写”更新协作文件');
 const validatorPath=path.join(__dirname,'validator.cjs'),bundle=read(validatorPath,10*1024*1024);
 if(hash(bundle)!==project.validator.sha256)throw new Error('校验包与导出上下文不匹配，请更新协作文件');
 const model=require(validatorPath);
 if(model.contentModelVersion!==project.validator.version||typeof model.validateContentChange!=='function')throw new Error('内容模型版本不匹配，请更新协作文件');
 const snapshot=read(path.join(__dirname,'context','snapshots',p.snapshotId+'.json'),20*1024*1024);
 if(hash(snapshot)!==p.snapshotId)throw new Error('上下文快照损坏，请更新协作文件');
 const base=parse(snapshot);if(base.schema!==1||base.projectId!==p.projectId)throw new Error('快照属于其他项目或格式不受支持');
 // Always validate content before reading a private credential or creating a signed file.
 const checked=model.validateContentChange(p,base.archives);
 if(command==='validate'){report({ok:true,modelVersion:model.contentModelVersion,operations:checked.rows.length,scope:'exported-baseline',message:'内容结构、工作流字段及跨模块引用检查通过（基于导出快照）。最新权限、并发冲突与事务状态仍由客户端复核。'});return;}
 if(!credentialPath)throw new Error('请提供私有凭证文件');
 const secret=parse(read(path.resolve(credentialPath)));if(secret.schema!==2||secret.projectId!==p.projectId||!secret.memberId||!secret.credentialId)throw new Error('需要本项目的长期开发者凭证');
 p.identity={memberId:secret.memberId,credentialId:secret.credentialId};
 const key=crypto.createPrivateKey({key:Buffer.from(secret.privateKey,'base64'),type:'pkcs8',format:'der'});if(key.asymmetricKeyType!=='ed25519')throw new Error('凭证类型无效');
 p.identity.signature=crypto.sign(null,Buffer.from(model.canonical(p)),key).toString('base64');
 const directory=path.join(__dirname,'changes');if(fs.lstatSync(directory).isSymbolicLink())throw new Error('提交目录不能是链接');
 fs.writeFileSync(path.join(directory,p.id+'.json'),JSON.stringify(p,null,2)+'\n',{flag:'wx'});
 report({ok:true,id:p.id,message:'完整离线校验通过，签名提交已保存。请在 GameCreator 使用说明 → 项目编写读取并预览。'});
}
try{main();}catch(e){const result={ok:false,code:e.code||'AUTHORING_INPUT',scope:e.scope||'input',message:e.message,diagnostics:e.diagnostics||[]};if(json)console.log(JSON.stringify(result));else console.error(result.message);process.exitCode=1;}
