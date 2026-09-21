const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

function createAiDocuments({defaultDirectory, io = fs}) {
  const outputs = new Map();
  const same = (a,b) => a.dev === b.dev && a.ino === b.ino;
  async function cleanup(folder, identity, parent) {
    if (!folder || !identity || path.dirname(folder) !== parent) return;
    const stat = await io.lstat(folder).catch(() => null);
    if (stat?.isDirectory() && !stat.isSymbolicLink() && same(stat,identity)) await io.rm(folder,{recursive:true,force:true});
  }
  async function exportFolder(input) {
    // Copy and validate the complete batch before any filesystem operation.
    const snapshot=structuredClone(input);
    const {validateDocumentFiles} = await import('../shared/ai-document-files.mjs');
    const bundle = validateDocumentFiles(snapshot);
    const requested = snapshot?.directory === undefined || snapshot.directory === '' ? defaultDirectory : snapshot.directory;
    if (typeof requested !== 'string' || !path.isAbsolute(requested)) throw new Error('请选择完整的保存路径');
    if (path.resolve(requested) === path.resolve(defaultDirectory)) await io.mkdir(requested,{recursive:true});
    const parent = await io.realpath(requested);
    if (!(await io.stat(parent)).isDirectory()) throw new Error('保存位置不是文件夹');
    let staging, stagingIdentity, destination, destinationIdentity;
    try {
      staging = path.join(parent,'.gamecreator-ai-tmp-'+randomUUID());
      await io.mkdir(staging); stagingIdentity = await io.lstat(staging);
      await io.mkdir(path.join(staging,'模块'));
      for (const file of bundle.files) await io.writeFile(path.join(staging,...file.path.split('/')),file.content,{encoding:'utf8',flag:'wx'});
      // Reserve a new directory exclusively, including across concurrent exports.
      for (let suffix=0;suffix<10000;suffix++) {
        const candidate = path.join(parent,bundle.folderName+(suffix?` (${suffix})`:''));
        try { await io.mkdir(candidate);destination=candidate;destinationIdentity=await io.lstat(candidate);break; }
        catch(error) { if(error.code!=='EEXIST')throw error; }
      }
      if(!destination)throw new Error('同名导出过多，请更换输出文件夹名称');
      for (const name of await io.readdir(staging)) await io.rename(path.join(staging,name),path.join(destination,name));
      await io.rmdir(staging); staging=undefined;
      const token=randomUUID();outputs.set(token,{directory:destination,identity:destinationIdentity});
      return {directory:destination,fileCount:bundle.files.length,token};
    } catch(error) {
      const results=await Promise.allSettled([cleanup(staging,stagingIdentity,parent),cleanup(destination,destinationIdentity,parent)]);
      if(results.some(r=>r.status==='rejected'))throw new Error('文档生成失败：'+error.message+'；临时目录未能清理，请检查保存位置。');
      throw new Error('文档生成失败：'+error.message);
    }
  }
  async function resolveDirectory(token) {
    const output=outputs.get(token);if(!output)throw new Error('找不到本次导出的文件夹，请重新生成');
    const stat=await io.lstat(output.directory);
    if(!stat.isDirectory()||stat.isSymbolicLink()||!same(stat,output.identity))throw new Error('导出文件夹已移动或被替换');
    return output.directory;
  }
  return {exportFolder,resolveDirectory};
}
module.exports={createAiDocuments};
