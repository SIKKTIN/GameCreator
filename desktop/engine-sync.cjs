const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {constants}=require('node:fs');
const {validateProjectLocation}=require('./project-locations.cjs');
const {validateWorkspaceId}=require('./art-files.cjs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const identity=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const META='.gamecreator-sync';
const MAX_BYTES=256*1024*1024;
const MEDIA=/\.(png|jpe?g|webp|gif|svg|bmp|tga|exr|hdr|dds|ktx|wav|ogg|mp3|flac|mp4|webm|ogv|glb|gltf|bin|fbx|obj|mtl|blend|ttf|otf|woff2?|psd|aseprite|ase|atlas|json)$/i;
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9-]{36}$/;

function createEngineSync({artFiles,beforeWrite=async()=>{}}) {
  const plans=new Map();
  const modules=()=>import('../shared/engine-sync.mjs');
  async function targetPath(value) {
    const {syncPath}=await modules();
    if(value.endsWith('/.gdignore'))return syncPath(value.slice(0,-10))+'/.gdignore';
    return syncPath(value);
  }
  async function context(input) {
    if(typeof input?.projectId!=='string'||!['godot-gdscript','oasis-lua'].includes(input?.config?.engine))throw new Error('同步项目或引擎标识无效');
    validateWorkspaceId('project:'+input.projectId);
    const location=await validateProjectLocation(input?.config?.projectPath,'.',input?.config?.engine);
    const root=location.projectPath,stat=await fs.lstat(root);
    if(stat.isSymbolicLink())throw new Error('工程目录不能是符号链接');
    return {root,stat,projectId:input.projectId,engine:input.config.engine};
  }
  async function checkRoot(ctx) {
    const now=await fs.lstat(ctx.root);
    if(now.isSymbolicLink()||!now.isDirectory()||!identity(now,ctx.stat))throw new Error('工程目录已被替换，请重新预览');
  }
  // All components are checked, including metadata and backup paths. No linked directories/files.
  async function checked(ctx,relative,createParents=false,allowHardlink=false) {
    await checkRoot(ctx);
    const parts=relative.split('/');
    if(parts.some(p=>!p||p==='.'||p==='..'||p.includes('\\')||p.includes(':')))throw new Error('同步路径无效');
    let current=ctx.root;
    for(let i=0;i<parts.length;i++) {
      current=path.join(current,parts[i]);
      let stat=await fs.lstat(current).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
      if(!stat&&createParents&&i<parts.length-1){await fs.mkdir(current).catch(e=>{if(e.code!=='EEXIST')throw e;});stat=await fs.lstat(current);}
      if(stat&&(stat.isSymbolicLink()||(i<parts.length-1?!stat.isDirectory():!stat.isFile()||stat.nlink>1&&!allowHardlink)))throw new Error('同步路径包含链接或非普通文件：'+relative);
    }
    return current;
  }
  async function read(ctx,relative,allowHardlink=false) {
    const filename=await checked(ctx,relative,false,allowHardlink);
    let handle;
    try {
      handle=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
      const a=await handle.stat();
      if(!a.isFile()||a.nlink>1&&!allowHardlink||a.size>MAX_BYTES)throw new Error('文件过大或不是普通文件：'+relative);
      const bytes=await handle.readFile(),b=await handle.stat(),c=await fs.lstat(filename);
      await checked(ctx,relative,false,allowHardlink);
      if(!identity(a,c)||a.size!==b.size||a.mtimeMs!==b.mtimeMs)throw new Error('文件读取期间发生变化：'+relative);
      return bytes;
    }catch(e){if(e.code==='ENOENT')return null;throw e;}finally{await handle?.close();}
  }
  async function writeMeta(ctx,relative,value) {
    const filename=await checked(ctx,relative,true),temp=await checked(ctx,relative+'.'+randomUUID()+'.tmp',true);
    const handle=await fs.open(temp,'wx');try{await handle.writeFile(value);await handle.sync();}finally{await handle.close();}
    await checked(ctx,relative);await fs.rename(temp,filename);
  }
  async function validateManifest(m,ctx) {
    if(m?.schema!==1||m.projectId!==ctx.projectId||m.engine!==ctx.engine||!Array.isArray(m.files)||!Array.isArray(m.history))throw new Error('工程同步清单不兼容或属于另一个项目/引擎，已停止写入');
    const paths=new Set();
    for(const f of m.files){await targetPath(f.path);const key=f.path.normalize('NFC').toLowerCase();if(!HASH.test(f.hash)||typeof f.id!=='string'||!['asset','document'].includes(f.kind)||paths.has(key))throw new Error('工程同步清单损坏');paths.add(key);}
    for(const h of m.history)if(!UUID.test(h.id)||typeof h.at!=='string'||!['success','failed'].includes(h.status)||typeof h.message!=='string'||!Array.isArray(h.files))throw new Error('同步历史损坏');
    return m;
  }
  async function manifest(ctx) {
    const bytes=await read(ctx,META+'/manifest.json');
    const value=bytes?await validateManifest(JSON.parse(bytes),ctx):{schema:1,projectId:ctx.projectId,engine:ctx.engine,files:[],history:[]};
    return {value,hash:bytes?hash(bytes):null};
  }
  async function locked(ctx,fn) {
    const filename=await checked(ctx,META+'/lock',true);
    let handle;
    try {handle=await fs.open(filename,'wx');}catch(e){if(e.code==='EEXIST')throw new Error('工程正在同步，或上次同步意外中断。确认其他客户端已关闭后，使用“恢复中断的同步”。');throw e;}
    const stat=await handle.stat();await handle.writeFile(JSON.stringify({pid:process.pid}));await handle.close();
    try{return await fn();}finally{const now=await fs.lstat(filename).catch(()=>null);if(now&&identity(stat,now))await fs.unlink(filename);}
  }
  async function history(input) {
    const ctx=await context(input),m=await manifest(ctx);
    return {entries:m.value.history,interrupted:!!await read(ctx,META+'/pending.json')};
  }
  async function preview(input) {
    // A plan owns an immutable snapshot, and is valid for ten minutes.
    input=structuredClone(input);
    const ctx=await context(input),{syncSettings,adoptedSyncAssets,syncDocuments}=await modules(),settings=syncSettings(input.settings);
    if(await read(ctx,META+'/pending.json'))throw new Error('存在未完成的同步，请先恢复中断的同步');
    const m=await manifest(ctx),desired=[],warnings=[];
    if(settings.documents) {
      for(const d of syncDocuments(input.document,settings.modules))desired.push({id:d.id,path:settings.docsDirectory+'/'+d.path,bytes:Buffer.from(d.content),kind:'document',label:d.id==='document:index'?'项目文档目录':input.document.sections.find(s=>'document:'+s.id===d.id)?.label||d.path,version:input.document.version});
      if(ctx.engine==='godot-gdscript')desired.push({id:'document:ignore',path:settings.docsDirectory+'/.gdignore',bytes:Buffer.from('# Development documentation; not a runtime resource.\n'),kind:'document',label:'文档不参与 Godot 资源导入',version:''});
    }
    let totalBytes=desired.reduce((n,f)=>n+f.bytes.length,0);
    if(totalBytes>MAX_BYTES)throw new Error('文档超过 256 MB，请缩小同步范围');
    if(settings.assets) {
      const selected=adoptedSyncAssets(input.art,settings.includePlaceholders);warnings.push(...selected.warnings);
      for(const asset of selected.assets)for(const file of asset.files) {
        const {validName}=await import('../shared/ai-document-files.mjs');validName(file.name,'素材文件名');
        if(!MEDIA.test(file.name))throw new Error('暂不支持同步此素材格式：'+asset.name+' / '+file.name);
        const id='asset:'+asset.id+':'+(asset.files.length===1?'primary':file.name.normalize('NFC').toLowerCase());
        const previous=m.value.files.find(f=>f.id===id&&f.directory===settings.assetsDirectory);
        let target=settings.assetsDirectory+'/'+hash(asset.id).slice(0,16)+'/'+file.name;
        if(previous&&previous.directory===settings.assetsDirectory&&path.extname(previous.path).toLowerCase()===path.extname(target).toLowerCase())target=previous.path;
        const bytes=await artFiles.readBytes('project:'+ctx.projectId,file.storagePath);
        totalBytes+=bytes.length;if(totalBytes>MAX_BYTES||desired.length>=4000)throw new Error('本次同步超过 4000 个文件或 256 MB，请缩小同步范围');
        if(bytes.length!==file.size)throw new Error('素材文件大小与交付记录不一致：'+file.name);
        desired.push({id,path:target,bytes,kind:'asset',label:asset.name+' / '+file.name,version:asset.versionName,versionId:asset.versionId,placeholder:asset.placeholder,directory:settings.assetsDirectory});
      }
    }
    if(desired.length>4000||desired.reduce((n,f)=>n+f.bytes.length,0)>MAX_BYTES)throw new Error('本次同步超过 4000 个文件或 256 MB，请缩小同步范围');
    const paths=new Set(),ids=new Set(),rows=[];
    for(const f of desired) {
      await targetPath(f.path);const key=f.path.normalize('NFC').toLowerCase();
      if(paths.has(key))throw new Error('同步目标或素材身份重复：'+f.path);
      paths.add(key);ids.add(f.id);f.hash=hash(f.bytes);
      const old=m.value.files.find(p=>p.path.toLowerCase()===f.path.toLowerCase());
      const current=await read(ctx,f.path),currentHash=current?hash(current):null;
      const conflict=current!==null&&(!old||old.hash!==currentHash||old.id!==f.id);
      rows.push({...f,currentHash,status:conflict?'conflict':currentHash===f.hash&&old?.versionId===f.versionId?'unchanged':old?'updated':'added',reason:conflict?(old?'工程文件在同步后被修改':'目标存在非本项目管理的文件'):''});
    }
    // Disabling a scope does not remove its previous output. Within an enabled scope, removals are opt-in.
    for(const old of m.value.files)if(!paths.has(old.path.normalize('NFC').toLowerCase())&&(old.kind==='document'?settings.documents:settings.assets)) {
      const current=await read(ctx,old.path),currentHash=current?hash(current):null;
      rows.push({...old,remove:true,currentHash,status:currentHash!==null&&currentHash!==old.hash?'conflict':'removed',reason:currentHash!==null&&currentHash!==old.hash?'待移除文件在工程中被修改':'不再属于当前同步范围'});
    }
    const token=randomUUID(),now=Date.now();for(const [key,p] of plans)if(now-p.created>600000)plans.delete(key);
    if(plans.size>=4)plans.delete(plans.keys().next().value);
    plans.set(token,{ctx,m,rows,created:now});
    return {token,root:ctx.root,rows:rows.map(({bytes,...f})=>f),warnings,history:m.value.history};
  }
  async function assertCurrent(ctx,row) {
    const current=await read(ctx,row.path);
    if((current?hash(current):null)!==row.currentHash)throw new Error('预览后工程文件发生变化，请重新预览：'+row.path);
    return current;
  }
  async function rollback(ctx,journal) {
    if(journal?.schema!==1||!UUID.test(journal.id)||!Array.isArray(journal.ops))throw new Error('恢复日志损坏，请保留备份并人工检查');
    for(const op of [...journal.ops].reverse()) {
      await targetPath(op.path);
      if(!Number.isSafeInteger(op.index)||op.index<0||op.before!==null&&!HASH.test(op.before)||op.after!==null&&!HASH.test(op.after))throw new Error('恢复日志损坏');
      // A crash between an exclusive new-file link and staging unlink leaves two owned links.
      // Only detach that exact staging inode; unrelated hardlinks remain rejected.
      if(op.before===null) {
        const staged=META+'/history/'+journal.id+'/next/'+op.index;
        const source=await checked(ctx,staged,false,true),target=await checked(ctx,op.path,false,true);
        const a=await fs.lstat(source).catch(e=>{if(e.code==='ENOENT')return null;throw e;}),b=await fs.lstat(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
        if(a&&b&&identity(a,b)&&a.nlink===2) {
          const bytes=await read(ctx,staged,true);if(!bytes||hash(bytes)!==op.after)throw new Error('中断的写入内容已变化，请人工检查');
          await fs.unlink(source);
        }
      }
      const current=await read(ctx,op.path),digest=current?hash(current):null;
      if(digest===op.before)continue;
      if(digest!==op.after)throw new Error('恢复时发现外部改动，未覆盖：'+op.path+'；请检查 '+META+'/history/'+journal.id);
      const filename=await checked(ctx,op.path,true);
      if(op.before===null){if(current)await fs.unlink(filename);}
      else {
        const bytes=await read(ctx,META+'/history/'+journal.id+'/files/'+op.index);
        if(!bytes||hash(bytes)!==op.before)throw new Error('恢复备份校验失败：'+op.path);
        const temp=await checked(ctx,META+'/history/'+journal.id+'/restore-'+op.index,true);await fs.writeFile(temp,bytes);await checked(ctx,op.path);await fs.rename(temp,filename);
      }
    }
  }
  async function recover(input) {
    const ctx=await context(input);await manifest(ctx);
    const lock=await read(ctx,META+'/lock');
    if(lock) {
      const owner=JSON.parse(lock);if(!Number.isSafeInteger(owner.pid)||owner.pid<1)throw new Error('锁文件损坏，请人工检查');
      try{process.kill(owner.pid,0);throw new Error('原同步进程仍在运行，请先关闭该客户端');}catch(e){if(e.code!=='ESRCH')throw e;}
      await fs.unlink(await checked(ctx,META+'/lock'));
    }
    return locked(ctx,async()=>{
      const raw=await read(ctx,META+'/pending.json');if(!raw)return {message:'没有需要恢复的同步'};
      const journal=JSON.parse(raw),m=await manifest(ctx);
      if(!m.value.history.some(h=>h.id===journal.id&&h.status==='success')) {
        await rollback(ctx,journal);
        m.value.history=m.value.history.filter(h=>h.id!==journal.id);m.value.history.unshift({id:journal.id,at:new Date().toISOString(),status:'failed',message:'中断的同步已恢复到写入前',files:[]});
        await writeMeta(ctx,META+'/manifest.json',JSON.stringify(m.value,null,2));
      }
      await fs.unlink(await checked(ctx,META+'/pending.json'));return {message:'同步恢复完成，请重新预览'};
    });
  }
  async function apply({token,decisions={},removals=[]}) {
    const plan=plans.get(token);if(!plan||Date.now()-plan.created>600000)throw new Error('预览已过期，请重新预览');
    const {ctx,m,rows}=plan;
    if(!decisions||typeof decisions!=='object'||!Array.isArray(removals))throw new Error('同步决定无效');
    for(const r of rows.filter(r=>r.status==='conflict'))if(!['keep','replace'].includes(decisions[r.path]))throw new Error('请处理所有冲突后再同步');
    const chosen=rows.filter(r=>r.status!=='unchanged'&&(r.status!=='conflict'||decisions[r.path]==='replace')&&(!r.remove||removals.includes(r.path)));
    if(!chosen.length)throw new Error('没有需要写入的变更');
    return locked(ctx,async()=>{
      if(await read(ctx,META+'/pending.json'))throw new Error('存在未完成的同步，请先恢复');
      if((await manifest(ctx)).hash!==m.hash)throw new Error('同步记录已改变，请重新预览');
      for(const r of rows)await assertCurrent(ctx,r);
      const id=randomUUID(),folder=META+'/history/'+id;
      await writeMeta(ctx,META+'/.gdignore','# GameCreator sync history.\n');
      await writeMeta(ctx,folder+'/before-manifest.json',JSON.stringify(m.value,null,2));
      const journal={schema:1,id,ops:[]};
      for(const [index,r] of chosen.entries()) {
        const old=await assertCurrent(ctx,r);
        if(old)await writeMeta(ctx,folder+'/files/'+index,old);
        if(!r.remove)await writeMeta(ctx,folder+'/next/'+index,r.bytes);
        journal.ops.push({index,path:r.path,before:r.currentHash,after:r.remove?null:r.hash});
      }
      await writeMeta(ctx,META+'/pending.json',JSON.stringify(journal));
      let committed=false;
      try {
        for(const [index,r] of chosen.entries()) {
          await beforeWrite(index,r);await assertCurrent(ctx,r);
          const filename=await checked(ctx,r.path,true);
          if(r.remove){if(r.currentHash!==null)await fs.unlink(filename);}
          else {
            const stage=await checked(ctx,folder+'/next/'+index);
            const bytes=await read(ctx,folder+'/next/'+index);if(!bytes||hash(bytes)!==r.hash)throw new Error('待写入文件校验失败：'+r.path);
            if(r.currentHash===null){await fs.link(stage,filename);await fs.unlink(stage);}
            else await fs.rename(stage,filename);
          }
        }
        const next=structuredClone(m.value);
        for(const r of chosen) {
          next.files=next.files.filter(f=>f.path.toLowerCase()!==r.path.toLowerCase());
          if(!r.remove){const {bytes,currentHash,status,reason,...record}=r;next.files.push(record);}
        }
        // A renamed target may coexist with a kept old file; identities track both until removal.
        const entry={id,at:new Date().toISOString(),status:'success',message:'文件已同步；引擎导入状态未检测',files:chosen.map(r=>({path:r.path,action:r.remove?'removed':r.status,version:r.version||'',versionId:r.versionId||''})),backupDirectory:path.join(ctx.root,folder)};
        next.history=[entry,...next.history].slice(0,100);
        await writeMeta(ctx,META+'/manifest.json',JSON.stringify(next,null,2));committed=true;plans.delete(token);
        await fs.unlink(await checked(ctx,META+'/pending.json'));
        return entry;
      }catch(e) {
        plans.delete(token);
        if(committed)throw new Error('文件已同步，记录已提交，但临时日志未清理；请恢复中断的同步。'+e.message);
        try {
          await rollback(ctx,journal);
          const failed={...m.value,history:[{id,at:new Date().toISOString(),status:'failed',message:e.message+'；已恢复写入前文件',files:[],backupDirectory:path.join(ctx.root,folder)},...m.value.history].slice(0,100)};
          await writeMeta(ctx,META+'/manifest.json',JSON.stringify(failed,null,2));await fs.unlink(await checked(ctx,META+'/pending.json'));
        }catch(recoveryError){throw new Error('同步失败：'+e.message+'；恢复未完成：'+recoveryError.message);}
        throw new Error('同步失败，已恢复写入前文件：'+e.message);
      }
    });
  }
  function release(token){plans.delete(token);}
  return {preview,apply,history,recover,release};
}
module.exports={createEngineSync};
