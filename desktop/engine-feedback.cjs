const {readContent,commitContent,recoverContent,assertNoPendingContent,validateContentArchive}=require('./project-changes.cjs');
const {verifyAiFeedback}=require('./ai-credentials.cjs');
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
    const {projectContentModules}=await import('../shared/project-changes.mjs'),content={};for(const module of Object.keys(projectContentModules)){const state=readContent(storage,ctx.projectId,module);content[module]=structuredClone(state.value);if(module==='project-schedule'){delete content[module].personnel;delete content[module].feedbackHistory;}if(module==='development-tools')delete content[module].feedbackHistory;} const snapshot={schema:1,projectId:ctx.projectId,engine:ctx.engine,...source,content};
    const bytes=Buffer.from(stableFeedbackJson(snapshot)),snapshotId=hash(bytes);
    const project={schema:1,projectId:ctx.projectId,projectName:input.document.projectName,engine:ctx.engine,snapshotId,documents:settings.docsDirectory,assets:settings.assetsDirectory};
    const json=v=>JSON.stringify(v,null,2)+'\n';
    const files=[
      ['project.json','开发协作项目',json(project)],
      ['context/tasks.json','排期开发上下文',json({schema:1,projectId:ctx.projectId,snapshotId,...source.schedule})],
      ['context/tools.json','工具开发上下文',json({schema:1,projectId:ctx.projectId,snapshotId,...source.tools})],
      ['context/snapshots/'+snapshotId+'.json','开发反馈比较基准',bytes],
      ['README.md','开发协作说明',collaborationReadme(project)],
      ['project-changes.md','需求与项目修改说明',(await import('../shared/project-feedback-guide.mjs')).projectFeedbackGuide(project)],
      ['feedback/README.md','反馈提交目录','# 开发反馈\n\n将 UTF-8 JSON 反馈放在本目录。每个文件一项任务、工具或项目模块，每次使用新的 UUID。格式见 [协作说明](../README.md)。\n'],
      ['receipts/README.md','反馈处理回执目录','# 处理回执\n\nGameCreator 应用或忽略反馈后在此写入回执。回执可重新生成，请勿手动修改。\n'],
    ];
    for(const [module,value] of Object.entries(content))files.push(['context/content/'+module+'.json',projectContentModules[module]+'可修改内容',json({module,value})]);
    if(source.schedule.personnel){
      const {personnelMarkdown,positionsOf,credentialMarkdown}=await import('../shared/ai-personnel.mjs');
      const team=source.schedule.personnel;
      files.push(['context/team.json','AI 团队与授权',json({schema:1,projectId:ctx.projectId,positions:positionsOf(source.schedule),members:team.members,credentials:team.credentials.map(({publicKey,...c})=>c)})],['context/assignments.json','任务分配清单',json({schema:1,projectId:ctx.projectId,tasks:source.schedule.tasks.map(t=>({id:t.id,title:t.title,owner:t.owner,positionIds:t.positionIds||null,assignment:t.assignment||null,workCredentials:team.credentials.filter(k=>k.positionIds&&k.taskIds.includes(t.id)).map(k=>({credentialId:k.id,memberId:k.memberId,revokedAt:k.revokedAt,expiresAt:k.expiresAt}))}))})],['submit-feedback.cjs','AI 反馈签名工具',await fs.readFile(path.join(__dirname,'../shared/ai-feedback-client.cjs'))]);
      for(const key of team.credentials.filter(k=>k.positionIds&&k.projectId===ctx.projectId))files.push(['assignments/'+encodeURIComponent(key.id)+'.md',key.name+'工作分配',credentialMarkdown(source.schedule,key)]);
      for(const member of team.members.filter(m=>m.active))files.push(['members/'+encodeURIComponent(member.id)+'.md',member.name+'工作说明',personnelMarkdown(source.schedule,member.id)+'\n\n先阅读 ../README.md 和 ../context/tasks.json。完成任务后使用私有协作凭证签名反馈；凭证由管理者单独交付，不在此目录中。\n']);
    }
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
    if(feedback.target.kind==='module'){if(!base.content||!Object.hasOwn(base.content,feedback.target.id))throw new Error('此快照没有项目内容，请重新同步后提交');return base.content[feedback.target.id];}return records(feedback.target.kind==='task'?base.schedule:base.tools,feedback.target.kind).find(t=>t.id===feedback.target.id);
  }
  function receiptOf(states,ctx,id) {return states.flatMap(s=>s.value.feedbackHistory||[]).find(r=>r.projectId===ctx.projectId&&r.id===id);}
  const titleOf=(record,feedback)=>record?.title||record?.name||feedback.target.id;
  async function feedbackScan(input) {
    const ctx=await context(input);active(ctx);const m=await established(ctx),{validateFeedback,feedbackDiff,stableFeedbackJson,feedbackIdPattern}=await model();
    if(recoverContent(storage,ctx.projectId))return{root:ctx.root,entries:[],history:[],missingReceipts:[],contentReload:true};
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
        const state=feedback.target.kind==='module'?readContent(storage,ctx.projectId,feedback.target.id):states[feedback.target.kind==='task'?0:1],current=feedback.target.kind==='module'?state.value:records(state.value,feedback.target.kind).find(t=>t.id===feedback.target.id),base=await baseline(ctx,m,feedback);
        const identity=verifyAiFeedback(feedback,states[0].value);
        const {projectChangeRows,applyProjectRows}=await import('../shared/project-changes.mjs');const rows=feedback.target.kind==='module'?projectChangeRows(feedback,base,current):feedback.intent==='propose'?[{field:'result',label:'排期与分配建议',base:'',current:'',incoming:feedback.changes.result,state:'updated'}]:feedbackDiff(feedback,base,current);
        if(feedback.target.kind==='module'){const candidate=applyProjectRows(feedback.target.id,current,rows,Object.fromEntries(rows.map(r=>[r.field,'feedback'])));validateContentArchive(feedback.target.id,candidate);} const omitProgress=v=>Object.fromEntries(Object.entries(v).filter(([k])=>!Object.hasOwn(feedback.changes,k)));
        const designChanged=stableFeedbackJson(omitProgress(base))!==stableFeedbackJson(omitProgress(current));
        const token=randomUUID();plans.set(token,{ctx,m,feedback,digest,path:file,raw:state.raw,rows,base,current,authorityRaw:states[0].raw,legacy:!!identity?.legacy,created:Date.now()});
        entries.push({path:file,feedback,title:titleOf(current,feedback),rows,state:'pending',token,designChanged,legacy:!!identity?.legacy,identity:identity?.verified?identity:undefined});
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
  function review(token) {
    const p=plans.get(token);if(!p||Date.now()-p.created>600000)throw new Error('反馈预览已过期，请重新读取');
    return p;
  }
  async function commitFeedback(token,p,{decisions={},dismiss=false,acceptCompletion=false,acceptLegacy=false,acceptProjectChange=false},expectedRaw=p.raw) {
    review(token);
    assertNoPendingContent(storage,p.ctx.projectId);
    if(!decisions||typeof decisions!=='object'||Array.isArray(decisions)||Object.entries(decisions).some(([k,v])=>!p.rows.some(r=>r.field===k)||!['keep','feedback'].includes(v))||typeof dismiss!=='boolean'||typeof acceptCompletion!=='boolean'||typeof acceptLegacy!=='boolean'||typeof acceptProjectChange!=='boolean')throw new Error('反馈处理选择无效');
    const {ctx,feedback}=p,{mergeFeedback,validateFeedbackHistory}=await model();
    active(ctx);
    if((await established(ctx)).hash!==p.m.hash)throw new Error('工程同步记录已变化，请重新读取反馈');
    const bytes=await smallRead(ctx,p.path);if(!bytes||hash(bytes)!==p.digest)throw new Error('反馈文件在预览后发生变化，请重新读取');
    await baseline(ctx,p.m,feedback);
    if(feedback.target.kind==='module'){const result=await commitProjectChange(p,{decisions,dismiss,acceptProjectChange});plans.delete(token);return result;}
    const other=await load(ctx,feedback.target.kind==='task'?'tool':'task'),state=await load(ctx,feedback.target.kind);
    if(receiptOf([state,other],ctx,feedback.id))throw new Error('此反馈已经处理，请重新读取');
    if(state.raw!==expectedRaw)throw new Error('项目内容在预览后发生变化，请重新读取反馈');
    const authority=feedback.target.kind==='task'?state:other;
    const identity=verifyAiFeedback(feedback,authority.value);
    if(identity?.legacy&&!dismiss&&!acceptLegacy)throw new Error('旧版未签名反馈需要逐条确认来源');
    if(feedback.intent==='spec_change'&&!dismiss&&!acceptProjectChange)throw new Error('请先评估需求与验收变更影响，再采纳建议');
    const next=structuredClone(state.value),list=records(next,feedback.target.kind),index=list.findIndex(t=>t.id===feedback.target.id);
    if(index<0)throw new Error('反馈目标已删除');
    if(!dismiss){if(feedback.intent==='propose'){if(decisions.result!=='keep')list[index]={...list[index],proposals:[...(list[index].proposals||[]),{id:feedback.id,memberId:identity.memberId,text:feedback.changes.result,at:new Date().toISOString()}]};}else list[index]=mergeFeedback(list[index],p.rows,decisions,acceptCompletion);}
    const receipt={schema:1,id:feedback.id,projectId:ctx.projectId,engine:ctx.engine,digest:p.digest,snapshotId:feedback.snapshotId,target:feedback.target,title:titleOf(p.current,feedback),at:new Date().toISOString(),outcome:dismiss?'dismissed':'applied',author:identity?.verified?identity.memberName:feedback.author,...(identity?.verified?{identity}:{}),summary:feedback.summary,evidence:feedback.evidence,...(feedback.reason?{reason:feedback.reason,impact:feedback.impact}:{}),rows:p.rows,decisions:Object.fromEntries(p.rows.map(r=>[r.field,dismiss?'keep':decisions[r.field]||'feedback']))};
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
    if(storage.getItem(key(ctx,feedback.target.kind))!==expectedRaw)throw new Error('项目内容在应用前发生变化，请重新读取反馈');
    const freshAuthority=JSON.parse(storage.getItem(key(ctx,'task'))||'{"schema":1,"tasks":[],"milestones":[]}');validateProjectScheduleArchive(freshAuthority);const freshIdentity=verifyAiFeedback(feedback,freshAuthority);
    if(freshIdentity?.legacy&&!dismiss&&!acceptLegacy)throw new Error('当前项目要求逐条核实未签名反馈');
    storage.setItem(key(ctx,feedback.target.kind),serialized);
    plans.delete(token);
    let warning='';
    try{await writeMeta(ctx,ROOT+'/receipts/'+feedback.id+'.json',JSON.stringify(receipt,null,2)+'\n');}
    catch(e){warning='项目已保存，工程回执写入失败；请点击“补写回执”。'+e.message;}
    return {receipt,warning,serialized};
  }
  async function commitProjectChange(p,{decisions,dismiss,acceptProjectChange}){
    const {ctx,feedback}=p,{applyProjectRows,projectContentModules}=await import('../shared/project-changes.mjs'),{validateFeedbackHistory}=await model();
    if(!dismiss&&!acceptProjectChange)throw new Error('请核对项目修改的内容与影响后确认应用');
    const authority=await load(ctx,'task'),state=readContent(storage,ctx.projectId,feedback.target.id);
    if(authority.raw!==p.authorityRaw||state.raw!==p.raw)throw new Error('项目内容或授权在预览后已变化，请重新读取');
    const identity=verifyAiFeedback(feedback,authority.value),candidate=dismiss?state.value:applyProjectRows(feedback.target.id,state.value,p.rows,decisions);
    if(feedback.target.id==='enum-versions'&&!dismiss&&JSON.stringify(candidate)!==JSON.stringify(state.value))candidate.revision=state.value.revision+1;validateContentArchive(feedback.target.id,candidate);
    const receipt={schema:1,id:feedback.id,projectId:ctx.projectId,engine:ctx.engine,digest:p.digest,snapshotId:feedback.snapshotId,target:feedback.target,title:projectContentModules[feedback.target.id],at:new Date().toISOString(),outcome:dismiss?'dismissed':'applied',author:identity.memberName,identity,summary:feedback.summary,evidence:feedback.evidence,reason:feedback.reason,impact:feedback.impact,rows:p.rows,decisions:Object.fromEntries(p.rows.map(r=>[r.field,dismiss?'keep':decisions[r.field]||'feedback']))};
    const schedule=structuredClone(feedback.target.id==='project-schedule'?candidate:authority.value);
    schedule.feedbackHistory=[...(schedule.feedbackHistory||[]),receipt];validateFeedbackHistory(schedule.feedbackHistory,'task');validateProjectScheduleArchive(schedule);
    const scheduleRaw=JSON.stringify(schedule),contentRaw=JSON.stringify(candidate);
    if(Buffer.byteLength(JSON.stringify(receipt))>LIMIT||Buffer.byteLength(scheduleRaw)>20*1024*1024||Buffer.byteLength(contentRaw)>20*1024*1024)throw new Error('项目修改或处理记录超过大小限制');
    await beforeFeedbackCommit();active(ctx);
    const bytes=await smallRead(ctx,p.path);if(!bytes||hash(bytes)!==p.digest)throw new Error('项目修改反馈在应用前发生变化');
    active(ctx);
    if(storage.getItem(key(ctx,'task'))!==authority.raw||storage.getItem(state.key)!==state.raw)throw new Error('项目内容或授权在应用前已变化');
    verifyAiFeedback(feedback,JSON.parse(storage.getItem(key(ctx,'task'))));
    const entries=feedback.target.id==='project-schedule'||dismiss?[{module:'project-schedule',before:authority.raw,after:scheduleRaw}]:[{module:feedback.target.id,before:state.raw,after:contentRaw},{module:'project-schedule',before:authority.raw,after:scheduleRaw}];
    commitContent(storage,ctx.projectId,entries);
    let warning='';try{await writeMeta(ctx,ROOT+'/receipts/'+feedback.id+'.json',JSON.stringify(receipt,null,2)+'\n');}catch(error){warning='项目已保存，工程回执待补写。'+error.message;}
    return{receipt,warning,serialized:scheduleRaw};
  }
  async function feedbackApply(input) {
    const p=review(input?.token);
    const {serialized,...result}=await locked(p.ctx,()=>commitFeedback(input.token,p,input));return result;
  }
  async function feedbackApplyBatch({tokens,acceptCompletion=false}) {
    if(!Array.isArray(tokens)||!tokens.length||tokens.length>500||tokens.some(t=>typeof t!=='string')||new Set(tokens).size!==tokens.length||typeof acceptCompletion!=='boolean')throw new Error('批量反馈选择无效');
    const items=tokens.map(token=>({token,p:review(token)})),first=items[0].p,expected=new Map();
    // Every token must come from the same reviewed project and archive generation.
    for(const {p} of items) {
      if(p.ctx.root!==first.ctx.root||p.ctx.projectId!==first.ctx.projectId||p.ctx.engine!==first.ctx.engine||p.m.hash!==first.m.hash)throw new Error('批量反馈不属于同一项目或同步版本，请重新读取');
      const kind=p.feedback.target.kind==='module'?'task':p.feedback.target.kind;
      if(p.feedback.target.kind==='module')continue;
      if(expected.has(kind)&&expected.get(kind)!==p.raw)throw new Error('批量反馈的项目快照不一致，请重新读取');
      expected.set(kind,p.raw);
    }
    const {feedbackBatchItems}=await model();
    const entries=items.map(({token,p})=>({token,state:'pending',feedback:p.feedback,rows:p.rows,path:p.path,legacy:p.legacy}));
    const selection=feedbackBatchItems(entries,acceptCompletion),applied=[],failed=[],skipped=selection.skipped.map(({entry,reason})=>({path:entry.path,reason}));
    return locked(first.ctx,async()=>{
      active(first.ctx);
      for(const [kind,raw] of expected)if(storage.getItem(key(first.ctx,kind))!==raw)throw new Error('项目内容在预览后发生变化，请重新读取反馈');
      for(const [index,entry] of selection.ready.entries()) {
        try {
          const p=review(entry.token),kind=p.feedback.target.kind;
          const {serialized,...result}=await commitFeedback(entry.token,p,{acceptCompletion},expected.get(kind));
          // Rebase only on bytes written by this batch. Outside edits must still fail CAS.
          expected.set(kind,serialized);applied.push(result);
        }catch(e){
          failed.push({path:entry.path,reason:e.message});
          skipped.push(...selection.ready.slice(index+1).map(e=>({path:e.path,reason:'前一条处理失败，本次未尝试'})));
          break;
        }
      }
      return {applied,skipped,failed};
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
  return {documents,feedbackScan,feedbackApply,feedbackApplyBatch,feedbackRepair,release:token=>plans.delete(token)};
}
module.exports={createEngineFeedback};
