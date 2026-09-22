const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const META='.gamecreator-sync',PENDING=META+'/data-pending.json';
const LIMIT=8*1024*1024;
function createDataSync({storage,context,manifest,read,writeMeta,checked,locked,hash,beforeDataWrite=async()=>{}}) {
  const plans=new Map(),model=()=>import('../shared/data-sync.mjs');
  const key=ctx=>'gamecreator.enum-versions.v1:'+ctx.projectId;
  const digest=b=>b===null?null:hash(b);
  const comparable=p=>path.resolve(p).replace(/\\/g,'/').toLowerCase();
  function active(ctx) {
    const catalog=JSON.parse(storage?.getItem('gamecreator.projects.v1')||'null'),project=catalog?.projects?.find(p=>p.id===ctx.projectId);
    if(!project||catalog.activeId!==ctx.projectId||project.config.engine!==ctx.engine||comparable(project.config.projectPath)!==comparable(ctx.root)||JSON.stringify(project.config)!==ctx.configRaw)throw new Error('项目或已保存的同步配置已变化，请重新预览');
  }
  async function setup(input,allowPending=false) {
    const m=await model(),ctx=await context(input);ctx.configRaw=JSON.stringify(input.config);ctx.directory=m.dataDirectory(input.config.dataPath);
    if(input.config.outputFormat!=='json')throw new Error('数据同步当前仅支持 JSON，请在数据同步中保存 JSON 格式');
    active(ctx);const owner=await manifest(ctx);
    if(owner.value.files.some(f=>f.path.toLowerCase().startsWith(ctx.directory.toLowerCase()+'/')||ctx.directory.toLowerCase().startsWith(path.posix.dirname(f.path).toLowerCase()+'/')))throw new Error('数据目录与文档、素材或协作同步目录重叠，请使用独立目录');
    if(await read(ctx,META+'/pending.json'))throw new Error('请先恢复引擎设置中中断的同步');
    if(!allowPending&&await read(ctx,PENDING))throw new Error('有中断的数据同步，请先点击恢复中断同步');
    ctx.ownerHash=owner.hash;return ctx;
  }
  const scope=ctx=>ctx.projectId+'|'+ctx.engine+'|'+comparable(ctx.root)+'|'+ctx.directory.toLowerCase();
  async function smallRead(ctx,file) {
    const full=await checked(ctx,file),stat=await fs.lstat(full).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(stat?.size>LIMIT)throw new Error('单个 JSON 超过 8 MB：'+file);
    return read(ctx,file);
  }
  function load(ctx,inputStore) {
    const raw=storage.getItem(key(ctx)),store=raw?JSON.parse(raw):inputStore;
    if(!store||store.schema!==1||!Number.isSafeInteger(store.revision)||!store.data?.datasets||!store.data?.columns||!Array.isArray(store.snapshots))throw new Error('配置存档不可读');
    return {raw,store};
  }
  const scanOf=store=>store.snapshots.find(s=>s.id===store.activeId)?.scan||null;
  async function dataPreview(input) {
    const ctx=await setup(input),m=await model(),{raw,store}=load(ctx,input.store);
    if(m.stable(store)!==m.stable(input.store))throw new Error('配置已被其他操作更新，请重新读取配置后预览');
    m.validateDataSync(store);
    if(!['import','export'].includes(input.direction))throw new Error('同步方向无效');
    const directory=path.dirname(await checked(ctx,ctx.directory+'/.probe'));
    const names=(await fs.readdir(directory).catch(e=>{if(e.code==='ENOENT')return [];throw e;})).filter(n=>/\.json$/i.test(n)).sort();
    if(names.length>200)throw new Error('一次最多读取 200 个 JSON 文件');
    const files=new Map(),duplicate=new Set();
    for(const name of names){const table=m.tableName(name),lower=table.toLowerCase();if(duplicate.has(lower))throw new Error('同目录存在大小写重名 JSON：'+name);duplicate.add(lower);files.set(table,name);}
    for(const table of Object.keys(store.data.datasets)){const aliases=[...files.keys(),...Object.keys(store.data.datasets)].filter(n=>n!==table&&n.toLowerCase()===table.toLowerCase());if(aliases.length)throw new Error('表名或文件名只有大小写不同，请先统一名称：'+table+' / '+aliases[0]);}
    const tables=new Set(input.direction==='import'?files.keys():Object.keys(store.data.datasets));
    if(input.direction==='import')for(const [table,b] of Object.entries(store.dataSync?.bindings||{}))if(b.scope===scope(ctx))tables.add(table);
    if(tables.size>200)throw new Error('一次最多预览 200 张配置表');
    const rows=[];let total=0;
    for(const table of tables) {
      const filename=files.get(table)||table+'.json',file=ctx.directory+'/'+filename;
      try {
        m.tableName(filename);const bytes=await smallRead(ctx,file);total+=bytes?.length||0;if(total>32*1024*1024)throw new Error('本次 JSON 总量超过 32 MB');
        const remote=bytes?m.parseJson(bytes.toString('utf8')):undefined;
        if(remote===undefined&&input.direction==='import'){rows.push({table,file,error:'文件缺失，保留本地配置；不会自动删除'});continue;}
        const b=store.dataSync?.bindings?.[table],binding=b?.scope===scope(ctx)?b:undefined;
        const mapping=m.validateMapping(input.mappings?.[table]||binding?.mapping||store.data.jsonFormats?.[table]?.mapping||{});
        const local=m.toJson(store.data,table,mapping,scanOf(store),store.data.jsonFormats?.[table]?undefined:remote);
        const l=m.canonical(local,mapping),r=m.canonical(remote,mapping);
        if(l&&r&&l.shape!==r.shape)throw new Error('JSON 根结构已变化，请使用另一文件名导入并检查');
        const baseline=binding&&m.stable(binding.mapping)===m.stable(mapping)?binding.baseline:undefined;
        const differences=m.diffJson(l,r,baseline,input.direction);
        const fileCanonical=m.canonical(remote);
        rows.push({table,file,mapping,shape:(r||l).shape,local:l,remote:r,differences,hash:digest(bytes),bound:!!baseline,localChanged:!!baseline&&m.stable(l)!==m.stable(baseline.local),engineChanged:!!baseline&&m.stable(r)!==m.stable(baseline.remote),fields:{local:l?.shape==='object'?Object.keys(l.value):store.data.columns[table]?.map(c=>c.key)||[],remote:fileCanonical?.shape==='object'?Object.keys(fileCanonical.value):[...new Set(Object.values(fileCanonical?.rows||{}).flatMap(Object.keys))]}});
      } catch(e){rows.push({table,file,error:e.message});}
    }
    const token=randomUUID(),now=Date.now();for(const [id,p] of plans)if(now-p.at>600000)plans.delete(id);if(plans.size>=8)plans.delete(plans.keys().next().value);
    plans.set(token,{ctx,raw,store:structuredClone(store),direction:input.direction,rows,at:now});
    return {token,rows,history:store.dataSync?.history||[],directory:path.join(ctx.root,ctx.directory)};
  }
  async function assertPlan(plan) {
    active(plan.ctx);
    if(storage.getItem(key(plan.ctx))!==plan.raw)throw new Error('预览后配置已改变，请重新读取并预览');
    if((await manifest(plan.ctx)).hash!==plan.ctx.ownerHash)throw new Error('工程同步归属或文件清单已变化，请重新预览');
    if(await read(plan.ctx,PENDING)||await read(plan.ctx,META+'/pending.json'))throw new Error('存在中断的同步，请先恢复');
  }
  async function validateJournal(ctx,j) {
    if(j?.schema!==1||j.projectId!==ctx.projectId||j.engine!==ctx.engine||j.scope!==scope(ctx)||!/^[-a-f0-9]{36}$/.test(j.id)||!Array.isArray(j.ops)||!(j.oldRaw===null||typeof j.oldRaw==='string')||typeof j.newRaw!=='string')throw new Error('恢复记录无效或属于其他连接');
    const m=await model();m.validateDataSync(JSON.parse(j.newRaw));
    for(const op of j.ops){if(op.path!==ctx.directory+'/'+path.posix.basename(op.path)||!/\.json$/i.test(op.path)||op.backup!==META+'/data-history/'+j.id+'/'+path.posix.basename(op.path)||!(/^[a-f0-9]{64}$/.test(op.after))||!(op.before===null||/^[a-f0-9]{64}$/.test(op.before)))throw new Error('恢复文件路径或摘要无效');m.tableName(path.posix.basename(op.path));}
  }
  async function rollback(ctx,j) {
    await validateJournal(ctx,j);
    // Validate everything before restoring any file, including project edits made after a crash.
    const raw=storage.getItem(key(ctx));if(raw!==j.oldRaw&&raw!==j.newRaw)throw new Error('项目在同步后被编辑，不能覆盖；请保留备份人工核对');
    for(const op of j.ops){const current=digest(await read(ctx,op.path));if(current!==op.before&&current!==op.after)throw new Error('文件在同步后被编辑，停止恢复：'+op.path);if(op.before!==null&&digest(await read(ctx,op.backup))!==op.before)throw new Error('备份缺失或损坏：'+op.path);}
    for(const op of [...j.ops].reverse())if(digest(await read(ctx,op.path))!==op.before){if(op.before===null)await fs.unlink(await checked(ctx,op.path));else await writeMeta(ctx,op.path,await read(ctx,op.backup));}
    active(ctx);if(raw===j.newRaw){if(j.oldRaw===null)storage.removeItem(key(ctx));else storage.setItem(key(ctx),j.oldRaw);}
  }
  async function dataApply({token,selections,automatic=false}) {
    const p=plans.get(token);if(!p||Date.now()-p.at>600000)throw new Error('预览已过期，请重新预览');
    const {ctx}=p,m=await model();
    if(!Array.isArray(selections)||!selections.length||new Set(selections.map(s=>s.table)).size!==selections.length)throw new Error('请选择配置文件');
    return locked(ctx,async()=>{
      await assertPlan(p);
      if(automatic&&(p.direction!=='export'||!JSON.parse(ctx.configRaw).autoSync))throw new Error('自动导出尚未开启');
      let next=structuredClone(p.store);next.dataSync={schema:1,bindings:{...next.dataSync?.bindings},history:[...(next.dataSync?.history||[])]};
      const writes=[],chosen=[];
      for(const selection of selections){
        const row=p.rows.find(r=>r.table===selection.table);if(!row||row.error)throw new Error('所选配置不可同步');
        if(digest(await smallRead(ctx,row.file))!==row.hash)throw new Error('预览后文件已改变：'+row.file);
        if(automatic&&(!row.bound||row.engineChanged||row.differences.some(d=>d.conflict||d.deletion)||Object.keys(selection.decisions||{}).length))throw new Error('自动导出只处理已绑定且无冲突、无删除的本地修改');
        const decisions=structuredClone(selection.decisions||{});
        for(const d of row.differences)if(!d.path.length&&decisions[d.id]?.choice==='custom')decisions[d.id].value=JSON.stringify(m.canonical(m.parseJson(decisions[d.id].value),row.mapping));
        const value=m.resolveDiff(row.local,row.differences,decisions);
        if(!value)throw new Error('不支持删除整个配置文件；本地表与工程文件保持保留');
        const json=m.fromCanonical(value,row.mapping);
        next.data=m.toData(next.data,row.table,json,row.mapping,scanOf(next));
        next.dataSync.bindings[row.table]={scope:scope(ctx),mapping:row.mapping,baseline:{local:value,...(p.direction==='export'?{remote:value}:row.remote?{remote:row.remote}:{})}};
        if(p.direction==='export')writes.push({path:row.file,bytes:Buffer.from(JSON.stringify(json,null,2)+'\n'),before:row.hash});
        chosen.push(row);
      }
      for(const row of chosen)m.toJson(next.data,row.table,row.mapping,scanOf(next));
      const changedTables=new Set(chosen.map(r=>r.table));
      for(const [table,columns] of Object.entries(next.data.columns))for(const column of columns)if(column.type==='reference'&&changedTables.has(column.reference))for(const row of next.data.datasets[table])if(!next.data.datasets[column.reference]?.some(target=>target.id===row[column.key]))throw new Error('同步会使引用失效：'+table+'/'+row.id+'/'+column.key);
      if(writes.some(w=>w.bytes.length>LIMIT)||writes.reduce((n,w)=>n+w.bytes.length,0)>32*1024*1024)throw new Error('导出超过单文件 8 MB 或总量 32 MB 限制');
      const id=randomUUID(),folder=META+'/data-history/'+id,entry={id,at:new Date().toISOString(),direction:p.direction,tables:chosen.map(r=>r.table),directory:ctx.directory,scope:scope(ctx)};
      next.dataSync.history=[entry,...next.dataSync.history].slice(0,50);next.revision++;
      m.validateDataSync(next);
      await assertPlan(p);
      // Establish the same ownership used by document/asset sync, including JSON-only projects.
      if(ctx.ownerHash===null){const bytes=JSON.stringify({schema:1,projectId:ctx.projectId,engine:ctx.engine,files:[],history:[]},null,2);await writeMeta(ctx,META+'/manifest.json',bytes);ctx.ownerHash=hash(bytes);}
      if(await read(ctx,META+'/.gdignore')===null)await writeMeta(ctx,META+'/.gdignore','# GameCreator data sync backups.\n');
      const newRaw=JSON.stringify(next),ops=writes.filter(w=>hash(w.bytes)!==w.before).map(w=>({path:w.path,before:w.before,after:hash(w.bytes),backup:folder+'/'+path.posix.basename(w.path)}));
      for(const op of ops)if(op.before!==null)await writeMeta(ctx,op.backup,await read(ctx,op.path));
      const journal={schema:1,id,projectId:ctx.projectId,engine:ctx.engine,scope:scope(ctx),oldRaw:p.raw,newRaw,ops};
      await writeMeta(ctx,folder+'/transaction.json',JSON.stringify(journal));
      await assertPlan(p);await writeMeta(ctx,PENDING,JSON.stringify(journal));
      let committed=false;
      try {
        for(const w of writes){await beforeDataWrite(w.path);active(ctx);if(storage.getItem(key(ctx))!==p.raw)throw new Error('项目配置在同步期间被编辑');if(digest(await read(ctx,w.path))!==w.before)throw new Error('文件在同步期间被修改：'+w.path);if(hash(w.bytes)!==w.before)await writeMeta(ctx,w.path,w.bytes);}
        // Import is also guarded against changes made while backups were written.
        for(const row of chosen){const w=writes.find(w=>w.path===row.file);if(digest(await read(ctx,row.file))!==(w?hash(w.bytes):row.hash))throw new Error('文件在同步期间被修改：'+row.file);}
        active(ctx);if(storage.getItem(key(ctx))!==p.raw)throw new Error('配置在同步期间被编辑');
        storage.setItem(key(ctx),newRaw);committed=true;plans.delete(token);
        await fs.unlink(await checked(ctx,PENDING));return entry;
      } catch(e){plans.delete(token);if(committed)throw new Error('数据已提交，需恢复同步清理日志：'+e.message);try{await rollback(ctx,journal);await fs.unlink(await checked(ctx,PENDING));}catch(recovery){throw new Error(e.message+'；恢复未完成：'+recovery.message);}throw new Error('同步未完成，文件已恢复：'+e.message);}
    });
  }
  async function dataRecover(input) {
    const ctx=await setup(input,true),lock=await read(ctx,META+'/lock');
    if(lock){const pid=JSON.parse(lock).pid;if(!Number.isSafeInteger(pid)||pid<1)throw new Error('同步锁无效');try{process.kill(pid,0);throw new Error('同步进程仍在运行，请等待其完成');}catch(e){if(e.code!=='ESRCH')throw e;}await fs.unlink(await checked(ctx,META+'/lock'));}
    return locked(ctx,async()=>{const bytes=await read(ctx,PENDING);if(!bytes)return {message:'没有中断的数据同步'};const j=JSON.parse(bytes);await validateJournal(ctx,j);active(ctx);if(!j.undo&&storage.getItem(key(ctx))===j.newRaw){for(const op of j.ops)if(digest(await read(ctx,op.path))!==op.after)throw new Error('提交后的文件被修改，请人工检查');}else await rollback(ctx,j);await fs.unlink(await checked(ctx,PENDING));return {message:'中断的数据同步已恢复'};});
  }
  async function dataUndo(input) {
    const ctx=await setup(input);return locked(ctx,async()=>{const {store}=load(ctx);const entry=store.dataSync?.history?.[0];if(!entry||entry.scope!==scope(ctx))throw new Error('当前连接没有可恢复的记录');const bytes=await read(ctx,META+'/data-history/'+entry.id+'/transaction.json');if(!bytes)throw new Error('备份不存在');const j=JSON.parse(bytes);await validateJournal(ctx,j);if(storage.getItem(key(ctx))!==j.newRaw)throw new Error('同步后配置已编辑，不能一键回退；请使用备份人工比较');await writeMeta(ctx,PENDING,JSON.stringify({...j,undo:true}));try{await rollback(ctx,j);await fs.unlink(await checked(ctx,PENDING));return {message:'已恢复上次同步前的配置和工程文件'};}catch(e){throw new Error('回退未完成，请恢复中断同步：'+e.message);}});
  }
  return {dataPreview,dataApply,dataRecover,dataUndo,dataRelease:token=>plans.delete(token)};
}
module.exports={createDataSync};
