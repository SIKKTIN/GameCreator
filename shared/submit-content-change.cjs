#!/usr/bin/env node
// Standalone project helper. No dependencies, network requests, or private-key export.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
function main(){
 const [command,source,credentialPath]=process.argv.slice(2);if(!['validate','submit'].includes(command)||!source)throw new Error('用法：node ai/submit-change.cjs validate|submit change.json [credential.json]');
 const read=p=>{const stat=fs.lstatSync(p);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*1024*1024)throw new Error('文件无效或过大');return fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'');};
 const project=JSON.parse(read(path.join(__dirname,'project.json'))),p=JSON.parse(read(path.resolve(source)));
 if(p.format!=='gamecreator-content-change'||p.schema!==1||p.projectId!==project.projectId||p.snapshotId!==project.snapshotId||!/^\w[\w-]{7,99}$/.test(p.id)||p.intent!=='project_change'||p.target?.kind!=='module'||!Array.isArray(p.operations)||!p.operations.length||p.operations.length>500||p.operations.some(o=>!Object.hasOwn(project.modules,o.module)||!['add','set','remove'].includes(o.op)||typeof o.path!=='string'||!o.path.startsWith('/'))||!p.compatibility||['reuse','modify','add','archive'].some(k=>typeof p.compatibility[k]!=='string'||!p.compatibility[k].trim()))throw new Error('提交格式、项目或基准不匹配，请参考 change-template.json');
 const snapshot=read(path.join(__dirname,'context','snapshots',p.snapshotId+'.json'));if(crypto.createHash('sha256').update(snapshot).digest('hex')!==p.snapshotId)throw new Error('上下文快照损坏');
 if(command==='validate'){console.log('协议及本地基准检查通过。完整权限、引用和冲突检查在客户端执行。');return;}
 if(!credentialPath)throw new Error('请提供私有凭证文件');const secret=JSON.parse(read(path.resolve(credentialPath)));if(secret.schema!==2||secret.projectId!==p.projectId)throw new Error('需要本项目的长期开发者凭证');
 p.identity={memberId:secret.memberId,credentialId:secret.credentialId};
 const key=crypto.createPrivateKey({key:Buffer.from(secret.privateKey,'base64'),type:'pkcs8',format:'der'});if(key.asymmetricKeyType!=='ed25519')throw new Error('凭证类型无效');p.identity.signature=crypto.sign(null,Buffer.from(canonical(p)),key).toString('base64');
 const directory=path.join(__dirname,'changes');if(fs.lstatSync(directory).isSymbolicLink())throw new Error('提交目录不能是链接');
 fs.writeFileSync(path.join(directory,p.id+'.json'),JSON.stringify(p,null,2)+'\n',{flag:'wx'});console.log('提交已保存。请在 GameCreator 使用说明 → 项目编写读取并预览。');
}
try{main();}catch(e){console.error(e.message);process.exitCode=1;}
