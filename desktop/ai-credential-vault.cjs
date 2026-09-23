const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');

// This vault is outside project archives and engine sync. The OS account encrypts every payload.
function createCredentialVault({directory,safeStorage}){
 const root=path.resolve(directory);
 const ready=()=>{if(!safeStorage?.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==='basic_text')throw new Error('本机加密存储不可用，未保存私有凭证');};
 const file=(projectId,id)=>path.join(root,createHash('sha256').update(JSON.stringify([projectId,id])).digest('hex')+'.bin');
 const check=filename=>{if(fs.existsSync(root)&&fs.lstatSync(root).isSymbolicLink())throw new Error('凭证库路径不能是链接');if(fs.existsSync(filename)){const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>65536)throw new Error('本机凭证文件异常');}};
 return {
  has(projectId,id){const filename=file(projectId,id);check(filename);return fs.existsSync(filename);},
  get(projectId,id){ready();const filename=file(projectId,id);check(filename);if(!fs.existsSync(filename))throw new Error('本机没有此凭证：请导入已保存的凭证文件，或为同一开发者更换令牌');try{return JSON.parse(safeStorage.decryptString(fs.readFileSync(filename)));}catch{throw new Error('无法解密本机凭证，请导入备份或更换令牌');}},
  put(secret){ready();const filename=file(secret.projectId,secret.credentialId);check(filename);const encrypted=safeStorage.encryptString(JSON.stringify(secret));fs.mkdirSync(root,{recursive:true});const temp=filename+'.'+randomUUID()+'.tmp';let fd;try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,encrypted);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,filename);}finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp);}},
  remove(projectId,id){const filename=file(projectId,id);check(filename);if(fs.existsSync(filename))fs.unlinkSync(filename);},
 };
}
module.exports={createCredentialVault};
