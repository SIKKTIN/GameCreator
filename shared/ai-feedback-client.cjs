// Engine-independent Node.js helper. Credentials stay outside the shared engine context.
const fs=require('node:fs'),path=require('node:path'),{createPrivateKey,sign,randomUUID}=require('node:crypto');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
function signFeedback(draft,credential){
 if(![1,2].includes(credential.schema)||!credential.memberId||!credential.credentialId||credential.projectId!==draft.projectId||credential.schema===1&&Date.parse(credential.expiresAt)<=Date.now())throw new Error('凭证属于其他项目、格式无效或已过期');
 const feedback={...draft,id:draft.id||randomUUID(),author:credential.memberName,intent:draft.intent||'progress',identity:{memberId:credential.memberId,credentialId:credential.credentialId}};
 const privateKey=createPrivateKey({key:Buffer.from(credential.privateKey,'base64'),type:'pkcs8',format:'der'});if(privateKey.asymmetricKeyType!=='ed25519')throw new Error('签名密钥格式无效');
 feedback.identity.signature=sign(null,Buffer.from(canonical(feedback)),privateKey).toString('base64');return feedback;
}
if(require.main===module){try{const [credentialFile,draftFile,outputDirectory]=process.argv.slice(2);if(!credentialFile||!draftFile||!outputDirectory)throw new Error('用法：node submit-feedback.cjs <私有凭证.json> <反馈草稿.json> <工程/gamecreator/feedback>');const feedback=signFeedback(JSON.parse(fs.readFileSync(draftFile,'utf8')),JSON.parse(fs.readFileSync(credentialFile,'utf8')));if(!/^[a-f0-9-]{36}$/.test(feedback.id))throw new Error('反馈 ID 必须是 UUID');const directory=path.resolve(outputDirectory);if(!fs.statSync(directory).isDirectory())throw new Error('反馈目录不存在，请先同步工程');const file=path.join(directory,feedback.id+'.json');const temporary=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(temporary,JSON.stringify(feedback,null,2)+'\n',{flag:'wx',mode:0o600});try{fs.linkSync(temporary,file);}finally{fs.unlinkSync(temporary);}process.stdout.write('已生成签名反馈：'+file+'\n');}catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}}
module.exports={signFeedback};
