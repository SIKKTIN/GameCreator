const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {validateProjectScheduleArchive}=require('./project-package.cjs');
const ROOT='gamecreator',LIMIT=2*1024*1024;

// All engine paths use the same no-link checks and exclusive lock as outbound sync.
function createEngineFeedback({storage,context,manifest,read,writeMeta,checked,locked,hash,beforeFeedbackCommit=async()=>{}}) {
  const plans=new Map();
  const model=()=>import('../shared/engine-feedback.mjs');
  const key=(ctx,kind)=>'gamecreator.workspace.v1:'+ctx.projectId+':'+(kind==='task'?'project-schedule':'development-tools');
  const records=(store,kind)=>kind==='task'?store.tasks:store.tools;
  function active(ctx) {
    if(!storage)throw new Error('当前客户端不支持开发反馈');
    const catalog=JSON.parse(storage.getItem('gamecreator.projects.v1')||'null'),project=catalog?.projects?.find(p=>p.id===ctx.projectId);
    const comparable=p=>process.platform==='win32'?path.resolve(p.trim()).toLowerCase():path.resolve(p.trim());
    if(!project||catalog.activeId!==ctx.projectId||project.config.engine!==ctx.engine||comparable(project.config.projectPath)!==comparable(ctx.root))throw new Error('项目或已保存的工程连接已变化，请返回当前项目重新读取');
  }
  async function load(ctx,kind) {
    const raw=storage.getItem(key(ctx,kind)),value=raw?JSON.parse(raw):kind==='task'?{schema:1,tasks:[],milestones:[]}:{schema:1,tools:[]};
    if(kind==='task')validateProjectScheduleArchive(value);else (await import('../shared/development-tools.mjs')).validateDevelopmentTools(value);
    const {validateFeedbackHistory}=await model();validateFeedbackHistory(value.feedbackHistory,kind);
    return {raw,value};
  }
  async function sources(ctx,input) {
    active(ctx);
    const {stableFeedbackJson}=await model();
    const schedule=structuredClone(input?.schedule),tools=structuredClone(input?.tools);
    validateProjectScheduleArchive(schedule);(await import('../shared/development-tools.mjs')).validateDevelopmentTools(tools);
    const strip=v=>{const {feedbackHistory,...rest}=v;return rest;};
    for(const [kind,source] of [['task',schedule],['tool',tools]]) {
      const stored=await load(ctx,kind);
      if(stored.raw?stableFeedbackJson(strip(stored.value))!==stableFeedbackJson(strip(source)):records(source,kind).length)throw new Error('项目内容已变化，请重新读取排期和开发工具再同步');
    }
    return {schedule:strip(schedule),tools:strip(tools)};
  }
  async function documents(ctx,input,settings) {
    const source=await sources(ctx,input.collaboration),{stableFeedbackJson,collaborationReadme}=await model();
    const snapshot={schema:1,projectId:ctx.projectId,engine:ctx.engine,...source};
    const bytes=Buffer.from(stableFeedbackJson(snapshot)),snapshotId=hash(bytes);
    const project={schema:1,projectId:ctx.projectId,projectName:input.document.projectName,engine:ctx.engine,snapshotId,documents:settings.docsDirectory,assets:settings.assetsDirectory};
    const json=v=>JSON.stringify(v,null,2)+'\n';
    const files=[
      ['project.json','开发协作项目',json(project)],
      ['context/tasks.json','排期开发上下文',json({schema:1,projectId:ctx.projectId,snapshotId,...source.schedule})],
      ['context/tools.json','工具开发上下文',json({schema:1,projectId:ctx.projectId,snapshotId,...source.tools})],
      ['context/snapshots/'+snapshotId+'.json','开发反馈比较基准',bytes],
      ['README.md','开发协作说明',collaborationReadme(project)],
      ['feedback/README.md','反馈提交目录','# 开发反馈\n\n将 UTF-8 JSON 反馈放在本目录。每个文件一项任务或工具，每次使用新的 UUID。格式见 [协作说明](../README.md)。\n'],
      ['receipts/README.md','反馈处理回执目录','# 处理回执\n\nGameCreator 应用或忽略反馈后在此写入回执。回执可重新生成，请勿手动修改。\n'],
    ];
    return files.map(([file,label,content])=>({id:'collaboration:'+file,path:ROOT+'/'+file,bytes:Buffer.isBuffer(content)?content:Buffer.from(content),kind:'collaboration',label,version:''}));
  }
  async function established(ctx) {
    const m=await manifest(ctx);
    if(await read(ctx,'.gamecreator-sync/pending.json'))throw new Error('请先恢复中断的工程同步');
    const file=m.value.files.find(f=>f.id==='collaboration:project.json');
    if(!file)throw new Error('请先在同步配置中开启开发协作，并同步到工程');
    const bytes=await read(ctx,ROOT+'/project.json');
    if(!bytes||hash(bytes)!==file.hash)throw new Error('协作项目文件已改变，请重新同步开发上下文');
    const p=JSON.parse(bytes);
    if(p.schema!==1||p.projectId!==ctx.projectId||p.engine!==ctx.engine)throw new Error('开发协作目录属于其他项目或引擎，请重新同步');
    return m;
  }
  async function smallRead(ctx,file) {
    const filename=await checked(ctx,file),stat=await fs.lstat(filename).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(stat?.size>LIMIT)throw new Error('单个反馈超过 2 MB');
    const bytes=await read(ctx,file);if(bytes&&bytes.length>LIMIT)throw new Error('单个反馈超过 2 MB');return bytes;
  }
  async function baseline(ctx,m,feedback) {
    const file=ROOT+'/context/snapshots/'+feedback.snapshotId+'.json',entry=m.value.files.find(f=>f.path===file&&f.kind==='collaboration');
    if(!entry)throw new Error('找不到已交付的开发快照，请同步后重新提交反馈');
    const bytes=await read(ctx,file);
    if(!bytes||hash(bytes)!==feedback.snapshotId||hash(bytes)!==entry.hash)throw new Error('反馈比较基准缺失或已被修改');
    const base=JSON.parse(bytes);
    if(base.projectId!==ctx.projectId||base.engine!==ctx.engine)throw new Error('反馈快照属于其他项目或引擎');
    return records(feedback.target.kind==='task'?base.schedule:base.tools,feedback.target.kind).find(t=>t.id===feedback.target.id);
  }
  function receiptOf(states,ctx,id) {return states.flatMap(s=>s.value.feedbackHistory||[]).find(r=>r.projectId===ctx.projectId&&r.id===id);}
  const titleOf=(record,feedback)=>record?.title||record?.name||feedback.target.id;
  async function feedbackScan(input) {
    const ctx=await context(input);active(ctx);const m=await established(ctx),{validateFeedback,feedbackDiff,stableFeedbackJson,feedbackIdPattern}=await model();
    // Compare with the mounted editor, so a background write cannot silently discard a draft.
    await sources(ctx,input.collaboration);
    const states=[await load(ctx,'task'),await load(ctx,'tool')];
    const dir=path.dirname(await checked(ctx,ROOT+'/feedback/.probe'));
    const names=(await fs.readdir(dir)).filter(n=>n.toLowerCase().endsWith('.json')).sort();
    if(names.length>500)throw new Error('反馈文件超过 500 个，请先归档已处理的反馈文件');
    const entries=[];
    for(const name of names) {
      const file=ROOT+'/feedback/'+name;
      try {
        const bytes=await smallRead(ctx,file);if(!bytes)continue;
        const feedback=validateFeedback(JSON.parse(bytes.toString('utf8'))),digest=hash(bytes);
        if(feedback.projectId!==ctx.projectId||feedback.engine!==ctx.engine)throw new Error('反馈属于其他项目或引擎');
        if(name!==feedback.id+'.json')throw new Error('文件名必须为反馈更新编号加 .json');
        const receipt=receiptOf(states,ctx,feedback.id);
        if(receipt){if(receipt.digest!==digest)throw new Error('此更新编号已处理，但文件内容被修改；请使用新的更新编号');entries.push({path:file,feedback,title:receipt.title,rows:[],state:'processed',receipt});continue;}
        const state=states[feedback.target.kind==='task'?0:1],current=records(state.value,feedback.target.kind).find(t=>t.id===feedback.target.id),base=await baseline(ctx,m,feedback);
        const rows=feedbackDiff(feedback,base,current);
        const omitProgress=v=>Object.fromEntries(Object.entries(v).filter(([k])=>!Object.hasOwn(feedback.changes,k)));
        const designChanged=stableFeedbackJson(omitProgress(base))!==stableFeedbackJson(omitProgress(current));
        const token=randomUUID();plans.set(token,{ctx,m,feedback,digest,path:file,raw:state.raw,rows,base,current,created:Date.now()});
        entries.push({path:file,feedback,title:titleOf(current,feedback),rows,state:'pending',token,designChanged});
      }catch(e){entries.push({path:file,state:'invalid',error:e.message,rows:[]});}
    }
    const now=Date.now();for(const [token,p] of plans)if(now-p.created>600000)plans.delete(token);
    while(plans.size>1000)plans.delete(plans.keys().next().value);
    const history=states.flatMap(s=>s.value.feedbackHistory||[]).filter(r=>r.projectId===ctx.projectId&&r.engine===ctx.engine).sort((a,b)=>b.at.localeCompare(a.at));
    // Mirrors are repaired explicitly; the atomic project archive is authoritative.
    const missingReceipts=[];
    for(const receipt of history) {
      if(!feedbackIdPattern.test(receipt.id))continue;
      try{const bytes=await smallRead(ctx,ROOT+'/receipts/'+receipt.id+'.json');if(!bytes||stableFeedbackJson(JSON.parse(bytes))!==stableFeedbackJson(receipt))missingReceipts.push(receipt.id);}catch{missingReceipts.push(receipt.id);}
    }
    return {root:ctx.root,entries,history,missingReceipts};
  }
  async function feedbackApply({token,decisions={},dismiss=false,acceptCompletion=false}) {
    const p=plans.get(token);if(!p||Date.now()-p.created>600000)throw new Error('反馈预览已过期，请重新读取');
    if(!decisions||typeof decisions!=='object'||Array.isArray(decisions)||Object.entries(decisions).some(([k,v])=>!p.rows.some(r=>r.field===k)||!['keep','feedback'].includes(v))||typeof dismiss!=='boolean'||typeof acceptCompletion!=='boolean')throw new Error('反馈处理选择无效');
    const {ctx,feedback}=p,{mergeFeedback,validateFeedbackHistory}=await model();
    return locked(ctx,async()=>{
      active(ctx);
      if((await established(ctx)).hash!==p.m.hash)throw new Error('工程同步记录已变化，请重新读取反馈');
      const bytes=await smallRead(ctx,p.path);if(!bytes||hash(bytes)!==p.digest)throw new Error('反馈文件在预览后发生变化，请重新读取');
      await baseline(ctx,p.m,feedback);
      const other=await load(ctx,feedback.target.kind==='task'?'tool':'task'),state=await load(ctx,feedback.target.kind);
      if(receiptOf([state,other],ctx,feedback.id))throw new Error('此反馈已经处理，请重新读取');
      if(state.raw!==p.raw)throw new Error('项目内容在预览后发生变化，请重新读取反馈');
      const next=structuredClone(state.value),list=records(next,feedback.target.kind),index=list.findIndex(t=>t.id===feedback.target.id);
      if(index<0)throw new Error('反馈目标已删除');
      if(!dismiss)list[index]=mergeFeedback(list[index],p.rows,decisions,acceptCompletion);
      const receipt={schema:1,id:feedback.id,projectId:ctx.projectId,engine:ctx.engine,digest:p.digest,snapshotId:feedback.snapshotId,target:feedback.target,title:titleOf(p.current,feedback),at:new Date().toISOString(),outcome:dismiss?'dismissed':'applied',author:feedback.author,summary:feedback.summary,evidence:feedback.evidence,rows:p.rows,decisions:Object.fromEntries(p.rows.map(r=>[r.field,dismiss?'keep':decisions[r.field]||'feedback']))};
      if((next.feedbackHistory?.length||0)>=10000)throw new Error('此模块已有 10000 条反馈记录，请整理项目后再接收');
      next.feedbackHistory=[...(next.feedbackHistory||[]),receipt];
      validateFeedbackHistory(next.feedbackHistory,feedback.target.kind);
      if(feedback.target.kind==='task')validateProjectScheduleArchive(next);else (await import('../shared/development-tools.mjs')).validateDevelopmentTools(next);
      const serialized=JSON.stringify(next);
      if(Buffer.byteLength(JSON.stringify(receipt,null,2)+'\n')>LIMIT||Buffer.byteLength(serialized)>20*1024*1024)throw new Error('反馈处理记录超过单条 2 MB 或模块存档 20 MB 的限制，未写入项目');
      await beforeFeedbackCommit();
      active(ctx);
      const latest=await smallRead(ctx,p.path);if(!latest||hash(latest)!==p.digest)throw new Error('反馈文件在应用前发生变化，请重新读取');
      // No await between comparison and atomic write: editor writes cannot interleave here.
      active(ctx);
      if(storage.getItem(key(ctx,feedback.target.kind))!==p.raw)throw new Error('项目内容在应用前发生变化，请重新读取反馈');
      storage.setItem(key(ctx,feedback.target.kind),serialized);
      plans.delete(token);
      let warning='';
      try{await writeMeta(ctx,ROOT+'/receipts/'+feedback.id+'.json',JSON.stringify(receipt,null,2)+'\n');}
      catch(e){warning='项目已保存，工程回执写入失败；请点击“补写回执”。'+e.message;}
      return {receipt,warning};
    });
  }
  async function feedbackRepair(input) {
    const ctx=await context(input);active(ctx);await established(ctx);
    return locked(ctx,async()=>{
      active(ctx);await established(ctx);
      const states=[await load(ctx,'task'),await load(ctx,'tool')];let count=0;
      for(const receipt of states.flatMap(s=>s.value.feedbackHistory||[]).filter(r=>r.projectId===ctx.projectId&&r.engine===ctx.engine)) {
        await writeMeta(ctx,ROOT+'/receipts/'+receipt.id+'.json',JSON.stringify(receipt,null,2)+'\n');count++;
      }
      return {count};
    });
  }
  return {documents,feedbackScan,feedbackApply,feedbackRepair,release:token=>plans.delete(token)};
}
module.exports={createEngineFeedback};
