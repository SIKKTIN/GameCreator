const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const model=require('./project-content-model.cjs');
const {archiveKey}=require('./project-package.cjs');
const {atomicWrite}=require('./storage.cjs');
const {commitContent,recoverContent}=require('./project-changes.cjs');
const {verifyAiFeedback}=require('./ai-credentials.cjs');
const hash=s=>createHash('sha256').update(s).digest('hex');
const contextKey=id=>'gamecreator.workspace.v1:'+id+':authoring-context';
const marker='<!-- GameCreator managed collaboration files -->';
function file(root,relative,create=false){
 if(!relative||relative.split('/').some(x=>!x||x==='.'||x==='..')||relative.includes('\\')||path.isAbsolute(relative))throw new Error('协作路径无效');
 let current=root;const segments=relative.split('/');
 for(let i=0;i<segments.length;i++){current=path.join(current,segments[i]);if(fs.existsSync(current)){const stat=fs.lstatSync(current);if(stat.isSymbolicLink()||(i<segments.length-1?!stat.isDirectory():!stat.isFile()))throw new Error('协作目录包含链接或无效文件：'+relative);}else if(i<segments.length-1){if(!create)throw new Error('协作文件不存在，请更新协作文件');fs.mkdirSync(current);}}
 return current;
}
function read(root,relative,max=20*1024*1024){const p=file(root,relative);if(fs.statSync(p).size>max)throw new Error('协作文件过大');return fs.readFileSync(p,'utf8');}
function write(root,relative,content){const p=file(root,relative,true);if(fs.existsSync(p)){const backup=file(root,relative+'.bak',true);atomicWrite(backup,fs.readFileSync(p,'utf8'));}atomicWrite(p,content);}
function context(storage,project){try{return model.captureProjectPackage(storage,project);}catch(e){throw model.authoringError(e,'current');}}
function template(projectId,snapshotId){return {format:'gamecreator-content-change',schema:1,id:'替换为新的唯一提交编号',projectId,snapshotId,intent:'project_change',target:{kind:'module',id:'project'},summary:'说明设计目标、范围和影响',compatibility:{reuse:'复用现有结构，无则写无',modify:'说明原有内容如何兼容',add:'列出新增内容及所属模块',archive:'无'},operations:[{id:'overview',module:'project',op:'set',path:'/description',value:'填写项目目标与原型范围'}]};}
function writeCollaborationFiles(root,project,storage,allowUnvalidated=false){
 let captured;
 try{captured=context(storage,project);}catch(error){
  if(!allowUnvalidated)throw error;
  // Folder preservation must not become a destructive migration for older/unknown archives.
  write(root,'GAMECREATOR_GUIDE.md',marker+'\n'+model.gamecreatorGuide());
  write(root,'README.md',read(root,'README.md')+'\n\n[GameCreator 使用说明](GAMECREATOR_GUIDE.md)\n');
  write(root,'ai/context-status.txt','上下文尚未生成。请在客户端检查项目存档，再到使用说明更新协作文件。\n'+error.message);
  return {directory:root};
 }
 const archives=captured.document.archives,raw=JSON.stringify({schema:1,projectId:project.id,archives}),snapshotId=hash(raw),guide=marker+'\n'+model.gamecreatorGuide();
 const guidePath=file(root,'GAMECREATOR_GUIDE.md',true);if(fs.existsSync(guidePath)&&!read(root,'GAMECREATOR_GUIDE.md').startsWith(marker))throw new Error('已有自定义 GAMECREATOR_GUIDE.md，请先另存为其他名称，避免覆盖');
 const schedule=archives['project-schedule'];
 const developers=(schedule.personnel?.members||[]).map(m=>({id:m.id,name:m.name,active:m.active,permissions:m.permissions,profile:m.developer,projectModules:model.moduleGrants(m),credentials:(schedule.personnel?.credentials||[]).filter(k=>k.memberId===m.id).map(k=>({id:k.id,projectId:k.projectId,persistent:!!k.persistent,revoked:!!k.revokedAt,expiresAt:k.persistent?m.developer?.expiresAt:k.expiresAt}))}));
 // Baselines are registered in app storage, never trusted solely because a file names a hash.
 write(root,'ai/context/snapshots/'+snapshotId+'.json',raw);
 for(const [module,value]of Object.entries(archives))write(root,'ai/context/content/'+module+'.json',JSON.stringify(value,null,2));
 write(root,'ai/context/templates.json',JSON.stringify(model.authoringTemplates(),null,2));
 write(root,'ai/context/template-options.json',JSON.stringify(model.authoringTemplateOptions(),null,2));
 const validator=fs.readFileSync(path.join(__dirname,'project-content-model.cjs'),'utf8');
 write(root,'ai/validator.cjs',validator);
 write(root,'ai/project.json',JSON.stringify({schema:1,projectId:project.id,name:project.name,snapshotId,guideVersion:model.guideVersion,validator:{version:model.contentModelVersion,sha256:hash(validator)},modules:model.authoringModules,developers},null,2));
 write(root,'ai/change-template.json',JSON.stringify(template(project.id,snapshotId),null,2));
 write(root,'ai/submit-change.cjs',fs.readFileSync(path.join(__dirname,'../shared/submit-content-change.cjs'),'utf8'));
 write(root,'ai/changes/README.md','将签名提交放在本目录，由客户端读取并预览。不要直接修改项目存档。\n');
 write(root,'ai/receipts/README.md','客户端成功应用后写入回执。权威处理记录保存在项目存档中。\n');
 write(root,'GAMECREATOR_GUIDE.md',guide);
 const readme=file(root,'README.md',true),old=fs.existsSync(readme)?read(root,'README.md'): '# '+project.name+'\n';
 if(!old.includes('[GameCreator 使用说明](GAMECREATOR_GUIDE.md)'))write(root,'README.md',old+'\n\n'+marker+'\n开始编写前请阅读 [GameCreator 使用说明](GAMECREATOR_GUIDE.md)。\n');
 for(const e of captured.expectedEntries)if(storage.getItem(e.key)!==e.value)throw new Error('生成期间项目已变化，请重新生成');
 const registered=JSON.parse(storage.getItem(contextKey(project.id))||'{"snapshotIds":[]}');
 storage.setItem(contextKey(project.id),JSON.stringify({schema:1,projectId:project.id,snapshotIds:[...new Set([...registered.snapshotIds,snapshotId])].slice(-100)}));
 return {directory:root};
}
function createProjectAuthoring({storage,folders}){
 function active(input){const catalog=JSON.parse(storage.getItem('gamecreator.projects.v1')||'null');if(!input||catalog?.activeId!==input.projectId)throw new Error('请在当前本地项目操作');const project=folders.verify(input.projectId);if(!project.folderPath)throw new Error('请先保存为项目文件夹');return project;}
 function clean(input){if(!Array.isArray(input.expectedEntries)||!input.expectedEntries.length)throw new Error('缺少当前编辑器快照');for(const e of input.expectedEntries)if(storage.getItem(e.key)!==e.value)throw new Error('项目已变化，请等待保存完成并重新读取');}
 function loadProposal(project,id){if(typeof id!=='string'||!/^\w[\w-]{7,99}$/.test(id))throw new Error('提交编号无效');const raw=read(project.folderPath,'ai/changes/'+id+'.json',2*1024*1024),p=JSON.parse(raw);model.validateAuthoringProposal(p);if(p.id!==id||p.projectId!==project.id)throw new Error('提交属于另一个项目或文件名不匹配');return{p,digest:hash(raw)};}
 function preview(project,id,decisions){
  const {p,digest}=loadProposal(project,id),captured=context(storage,project),current=captured.document.archives,schedule=current['project-schedule'];
  const history=schedule.authoringHistory||[],previous=history.find(r=>r.id===p.id);
  if(previous){if(previous.digest!==digest)throw new Error('已处理编号的内容发生变化，不允许重放');return {processed:true,receipt:previous};}
  const identity=verifyAiFeedback(p,schedule);if(!identity?.verified)throw new Error('内容编写需要有效的长期开发者签名');
  const member=schedule.personnel.members.find(m=>m.id===identity.memberId),grants=model.moduleGrants(member);for(const op of p.operations)if(!grants.includes(op.module))throw new Error('此开发者没有模块修改权限：'+op.module);
  const registered=JSON.parse(storage.getItem(contextKey(project.id))||'null');if(registered?.projectId!==project.id||!registered.snapshotIds.includes(p.snapshotId))throw new Error('设计基准未由当前项目生成或已过期，请更新协作文件');
  const raw=read(project.folderPath,'ai/context/snapshots/'+p.snapshotId+'.json');if(hash(raw)!==p.snapshotId)throw new Error('上下文快照已被修改，请恢复或更新协作文件');
  const base=JSON.parse(raw);if(base.projectId!==project.id)throw new Error('基准属于其他项目');
  const result=model.validateContentChange(p,base.archives,current,decisions);
  return {p,digest,captured,reviewId:hash(model.canonical(captured.expectedEntries)),...result,summary:p.summary,memberName:identity.memberName,compatibility:p.compatibility,id:p.id};
 }
 function receipt(root,r){write(root,'ai/receipts/'+r.id+'.json',JSON.stringify(r,null,2));}
 function run(operation,input){
  const project=active(input),root=project.folderPath;
  if(operation==='recover'){const recovered=recoverContent(storage,project.id);return {recovered};}
  clean(input);
  if(operation==='export')return writeCollaborationFiles(root,project,storage);
  if(operation==='scan'){
   const current=context(storage,project),history=current.document.archives['project-schedule'].authoringHistory||[],items=[];
   const directory=file(root,'ai/changes/README.md');const files=fs.readdirSync(path.dirname(directory)).filter(n=>n.endsWith('.json'));if(files.length>500)throw new Error('待扫描文件超过 500 个，请归档已处理文件');
   for(const name of files){const id=name.slice(0,-5);try{const result=preview(project,id,{});if(result.processed){receipt(root,result.receipt);continue;}const {id:pid,digest,reviewId,summary,memberName,compatibility,rows,unresolved}=result;items.push({id:pid,digest,reviewId,summary,memberName,compatibility,rows,unresolved});}catch(e){items.push({id,summary:name,error:e.message,diagnostics:e.diagnostics||[],errorScope:e.scope||'proposal',rows:[],unresolved:0});}}
   return {items,history};
  }
  if(!['preview','apply'].includes(operation))throw new Error('未知项目编写操作');
  const result=preview(project,input.id,input.decisions||{});if(result.processed)return {applied:true,history:[result.receipt]};
  if(input.digest!==result.digest)throw new Error('提交在预览后已变化，请重新读取');
  if(input.reviewId!==result.reviewId)throw new Error('项目在预览后已变化，请重新读取提交并确认差异');
  const {rows,unresolved,id,digest,reviewId,summary,memberName,compatibility}=result;
  if(operation==='preview')return {items:[{id,digest,reviewId,summary,memberName,compatibility,rows,unresolved}]};
  if(unresolved)throw new Error('请先解决全部冲突');
  const current=result.captured.document.archives,next=result.next;
  const r={id,digest,summary,memberName,at:new Date().toISOString(),modules:[...new Set(result.p.operations.map(o=>o.module))]};
  next['project-schedule'].authoringHistory=[...(current['project-schedule'].authoringHistory||[]),r];
  if(model.canonical(current['enum-versions'].data)!==model.canonical(next['enum-versions'].data))next['enum-versions'].revision=current['enum-versions'].revision+1;
  model.validateContentBatch(next);
  active(input);clean(input);for(const e of result.captured.expectedEntries)if(storage.getItem(e.key)!==e.value)throw new Error('应用前项目已变化，请重新读取');
  if(loadProposal(project,id).digest!==digest)throw new Error('应用前提交已变化');
  const entries=Object.entries(next).filter(([module,value])=>model.canonical(value)!==model.canonical(current[module])).map(([module,value])=>({module,before:storage.getItem(archiveKey(project.id,module)),after:JSON.stringify(value)}));
  let catalog;
  if(next.project.name!==current.project.name){const before=storage.getItem('gamecreator.projects.v1'),value=JSON.parse(before);catalog={before,after:JSON.stringify({...value,projects:value.projects.map(p=>p.id===project.id?{...p,name:next.project.name}:p)})};}
  commitContent(storage,project.id,entries,catalog);
  // Reconstructible from committed history if writing the human-readable receipt is interrupted.
  try{receipt(root,r);}catch{}return {applied:true,history:next['project-schedule'].authoringHistory};
 }
 return {run};
}
module.exports={createProjectAuthoring,writeCollaborationFiles};
