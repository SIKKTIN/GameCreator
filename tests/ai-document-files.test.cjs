const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createAiDocuments}=require('../desktop/ai-documents.cjs');
const bundle={folderName:'中文导出',files:[{path:'项目完整文档.md',content:'# 所有内容\n'},{path:'模块/玩法.md',content:'## 玩法\n中文'}]};
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-ai-files-'));t.after(async()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));await fs.rm(dir,{recursive:true,force:true});});return dir;}
test('custom folders, existing files and concurrent exports remain isolated',async t=>{
  const dir=await fixture(t),api=createAiDocuments({defaultDirectory:path.join(dir,'generate')});
  await fs.mkdir(path.join(dir,'中文导出'));await fs.writeFile(path.join(dir,'中文导出','user.txt'),'保留');
  const results=await Promise.all([1,2].map(()=>api.exportFolder({...bundle,directory:dir})));
  assert.equal(new Set(results.map(r=>r.directory)).size,2);
  for(const result of results){assert.equal(result.fileCount,2);for(const f of bundle.files)assert.equal(await fs.readFile(path.join(result.directory,f.path),'utf8'),f.content);assert.equal(await api.resolveDirectory(result.token),result.directory);}
  assert.equal(await fs.readFile(path.join(dir,'中文导出','user.txt'),'utf8'),'保留');
  assert.ok(!(await fs.readdir(dir)).some(n=>n.startsWith('.gamecreator')));
  const defaultResult=await api.exportFolder(bundle);assert.equal(path.dirname(defaultResult.directory),path.join(dir,'generate'));
  await assert.rejects(api.resolveDirectory('unknown'));
});
test('write and publish failures clean only directories created by the export',async t=>{
  const dir=await fixture(t);await fs.writeFile(path.join(dir,'user.txt'),'保留');
  for(const failOn of ['writeFile','rename']) {
    let calls=0;const io={...fs,[failOn]:async(...args)=>{if(++calls===2)throw new Error('模拟磁盘写入失败');return fs[failOn](...args);}};
    const api=createAiDocuments({defaultDirectory:dir,io});await assert.rejects(api.exportFolder(bundle),/模拟磁盘写入失败/);
    assert.deepEqual(await fs.readdir(dir),['user.txt']);
  }
});
test('invalid paths cannot write outside the selected parent; batch detaches before awaiting',async t=>{
  const dir=await fixture(t),api=createAiDocuments({defaultDirectory:dir});
  await assert.rejects(api.exportFolder({...bundle,folderName:'../escape'}));
  await assert.rejects(api.exportFolder({...bundle,files:[bundle.files[0],{path:'../escape.md',content:'bad'}]}));
  await assert.rejects(api.exportFolder({...bundle,directory:'relative'}));
  assert.deepEqual(await fs.readdir(dir),[]);
  const input=structuredClone(bundle),promise=api.exportFolder(input);input.files[0].content='篡改';input.folderName='另外目录';
  const result=await promise;assert.equal(path.basename(result.directory),bundle.folderName);assert.equal(await fs.readFile(path.join(result.directory,bundle.files[0].path),'utf8'),bundle.files[0].content);
});
