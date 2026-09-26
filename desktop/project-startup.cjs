const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const model=require('./project-content-model.cjs');
const {writeCollaborationFiles}=require('./project-authoring.cjs');
const hash=v=>createHash('sha256').update(v).digest('hex');
const key=id=>'gamecreator.workspace.v1:'+id+':project-startup';
function safeFile(root,relative,create=false){
 const parts=relative.split('/');if(parts.some(p=>!p||p==='.'||p==='..'||/[\\:]/.test(p)))throw new Error('初始化路径无效');
 const base=fs.lstatSync(root);if(!base.isDirectory()||base.isSymbolicLink())throw new Error('工程根目录无效');
 let current=root;for(let i=0;i<parts.length;i++){current=path.join(current,parts[i]);if(!fs.existsSync(current)&&create&&i<parts.length-1)fs.mkdirSync(current);if(fs.existsSync(current)){const stat=fs.lstatSync(current);if(stat.isSymbolicLink()||(i<parts.length-1?!stat.isDirectory():!stat.isFile()||stat.nlink!==1))throw new Error('初始化路径包含链接或非普通文件：'+relative);}}
 return current;
}
function readFile(root,relative){const p=safeFile(root,relative);if(!fs.existsSync(p))return null;if(fs.statSync(p).size>1024*1024)throw new Error('初始化文件过大：'+relative);return fs.readFileSync(p,'utf8');}
function writeFile(root,relative,text){const p=safeFile(root,relative,true),tmp=safeFile(root,relative+'.'+randomUUID()+'.tmp',true);try{fs.writeFileSync(tmp,text,{flag:'wx',mode:0o600});safeFile(root,relative);fs.renameSync(tmp,p);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}

function createProjectStartup({storage,folders,developers,engineSync}){
 const plans=new Map();
 function project(input){const c=JSON.parse(storage.getItem('gamecreator.projects.v1')||'null');if(!input||c?.activeId!==input.projectId)throw new Error('请在当前本地项目启动');return folders.verify(input.projectId);}
 function clean(entries){if(!Array.isArray(entries)||!entries.length)throw new Error('缺少当前项目快照');for(const e of entries)if(storage.getItem(e.key)!==e.value)throw new Error('项目内容已变化，请等待保存完成后重新检查');}
 async function inspect(input){
  const p=project(input),saved=JSON.parse(storage.getItem(key(p.id))||'null'),{syncPath,defaultSyncSettings,syncSettings}=await import('../shared/engine-sync.mjs');
  let entryDirectory=syncPath(input.entryDirectory||saved?.entryDirectory||'gamecreator');
  if(entryDirectory.toLowerCase()==='gamecreator')entryDirectory='gamecreator';
  const entryLower=entryDirectory.toLowerCase();
  if(entryLower!=='gamecreator'&&(entryLower.startsWith('gamecreator/')||'gamecreator'.startsWith(entryLower+'/')))throw new Error('协作入口不能放在现有反馈、上下文或凭证子目录内');
  const settingsKey='gamecreator.workspace.v1:'+p.id+':engine-sync-'+p.config.engine;
  const previous=JSON.parse(storage.getItem(settingsKey)||'null')||defaultSyncSettings;
  const settings=syncSettings({...previous,documents:true,collaboration:true,assets:false,docsDirectory:input.docsDirectory||previous.docsDirectory,modules:input.document?.sections.map(s=>s.id)||previous.modules});
  if([settings.docsDirectory,settings.assetsDirectory].map(v=>v.toLowerCase()).some(v=>entryLower===v||entryLower.startsWith(v+'/')||v.startsWith(entryLower+'/')))throw new Error('协作入口目录不能与设计文档或素材目录重叠');
  const blockers=[];if(!p.folderPath)blockers.push('先将 GameCreator 项目保存到独立文件夹');if(!p.config.projectPath)blockers.push('先在工程连接中指定并保存引擎工程目录');
  let binding; if(p.config.projectPath){try{binding=await engineSync.binding({projectId:p.id,config:p.config});if(binding.token)engineSync.release(binding.token);if(!['unbound','current'].includes(binding.status))blockers.push('工程归属与当前项目不一致，请到工程同步检查并绑定');}catch(e){blockers.push(e.message);}}
  const scheduleRaw=storage.getItem('gamecreator.workspace.v1:'+p.id+':project-schedule'),schedule=scheduleRaw?JSON.parse(scheduleRaw):{schema:1,tasks:[],milestones:[]};
  const {positionsOf,credentialExpiry}=await import('../shared/ai-personnel.mjs'),positions=positionsOf(schedule),team=schedule.personnel,members=[];
  for(const m of team?.members.filter(m=>m.active)||[]){
   const activePositions=positions.filter(p=>p.active&&m.developer?.positionIds.includes(p.id));
   const producer=activePositions.some(p=>p.id==='producer'||p.roles?.includes('制作管理'))&&m.developer?.scope==='project'&&m.permissions.includes('project_write')&&model.moduleGrants(m).length>0;
   const keys=(team.credentials||[]).filter(k=>k.projectId===p.id&&k.memberId===m.id&&k.persistent&&!k.revokedAt&&(!credentialExpiry(schedule,k)||credentialExpiry(schedule,k)>=new Date().toISOString().slice(0,10)));
   let error='',credentialId=keys[0]?.id;if(!activePositions.length)error='没有启用的岗位';else if(keys.length!==1)error=keys.length?'存在多个有效长期令牌，请先整理':'尚无有效长期令牌';else try{developers.read({projectId:p.id,credentialId});}catch(e){error=e.message;}
   members.push({id:m.id,name:m.name,producer,credentialId,error,path:entryDirectory+'/personal/'+m.id+'.json'});
  }
  if(!members.some(m=>m.producer&&!m.error))blockers.push('至少需要一名有效制作人：启用制作人岗位、项目范围、项目写入权限和可导出的长期令牌');
  for(const m of members.filter(m=>m.error))blockers.push(m.name+'：'+m.error);
  return {p,saved,settings,settingsKey,binding,entryDirectory,members,blockers};
 }
 const publicStatus=s=>({engineDirectory:s.binding?.root||s.p.config.projectPath,projectDirectory:s.p.folderPath||'',entryDirectory:s.entryDirectory,docsDirectory:s.settings.docsDirectory,members:s.members,blockers:s.blockers,initializedAt:s.saved?.at||'',initializedEntry:s.saved?.engineDirectory?s.saved.engineDirectory+'/'+s.saved.entryDirectory+'/README.md':''});
 async function run(operation,input){
  if(operation==='release'){const plan=plans.get(input.token);if(plan)engineSync.release(plan.sync.token);plans.delete(input.token);return {};}
  if(operation==='status')return publicStatus(await inspect(input));
  if(operation==='preview'){
   const s=await inspect(input);if(s.blockers.length)throw new Error(s.blockers.join('\n'));clean(input.expectedEntries);
   const sync=await engineSync.preview({projectId:s.p.id,config:s.p.config,document:input.document,art:input.art,collaboration:input.collaboration,settings:s.settings},s.entryDirectory);
   const token=randomUUID();for(const [id,p]of plans)if(Date.now()-p.at>600000){engineSync.release(p.sync.token);plans.delete(id);}if(plans.size>=4){const id=plans.keys().next().value;engineSync.release(plans.get(id).sync.token);plans.delete(id);}
   plans.set(token,{s,sync,at:Date.now(),expectedEntries:input.expectedEntries,source:JSON.stringify({config:s.p.config,folder:s.p.folderPath}),settingsRaw:storage.getItem(s.settingsKey)});
   return {...publicStatus(s),plan:{...sync,token}};
  }
  if(operation!=='initialize')throw new Error('未知项目启动操作');
  const plan=plans.get(input.token);if(!plan||Date.now()-plan.at>600000)throw new Error('初始化预览已过期，请重新检查');
  const {s,sync}=plan;
  const current=await inspect({projectId:s.p.id,entryDirectory:s.entryDirectory,docsDirectory:s.settings.docsDirectory});
  if(current.blockers.length)throw new Error(current.blockers.join('\n'));
  if(plan.source!==JSON.stringify({config:current.p.config,folder:current.p.folderPath})||storage.getItem(s.settingsKey)!==plan.settingsRaw)throw new Error('工程连接或同步配置已变化，请重新检查');
  clean(plan.expectedEntries);
  const root=s.binding.root,secrets=current.members.map(m=>({...m,secret:developers.read({projectId:s.p.id,credentialId:m.credentialId})}));
  // Preflight private files before any engine writes. Private bytes are never put into sync previews, history, or logs.
  const privateBefore=new Map();
  for(const m of secrets){const old=readFile(root,m.path);privateBefore.set(m.path,old);if(old!==null){let existing;try{existing=JSON.parse(old);}catch{throw new Error('凭证目标有其他内容，请先整理：'+m.path);}const same=existing.projectId===s.p.id&&existing.memberId===m.id&&existing.credentialId===m.secret.credentialId&&existing.privateKey===m.secret.privateKey;if(!same&&s.saved?.files?.[m.path]!==hash(old))throw new Error('凭证目标存在未管理或被修改的文件：'+m.path);}}
  for(const relative of ['.gitignore',s.entryDirectory+'/personal/.gitignore',s.entryDirectory+'/personal/.gdignore',s.entryDirectory+'/personal/README.md'])readFile(root,relative);
  for(const row of sync.rows.filter(r=>r.status==='conflict'))if(!['keep','replace'].includes(input.decisions?.[row.path]))throw new Error('请处理所有初始化文档冲突');
  writeCollaborationFiles(s.p.folderPath,s.p,storage);
  const changed=sync.rows.some(r=>r.status!=='unchanged'&&(r.status!=='conflict'||input.decisions?.[r.path]==='replace')&&(!r.remove||input.removals?.includes(r.path)));
  if(changed)await engineSync.apply({token:sync.token,decisions:input.decisions||{},removals:input.removals||[]});else engineSync.release(sync.token);
  clean(plan.expectedEntries);
  const ignorePath='.gitignore',ignore=readFile(root,ignorePath)||'',line='/'+s.entryDirectory+'/personal/';
  if(!ignore.split(/\r?\n/).includes(line))writeFile(root,ignorePath,ignore+(ignore.endsWith('\n')||!ignore?'':'\n')+'\n# GameCreator local developer credentials\n'+line+'\n');
  const personalIgnore=s.entryDirectory+'/personal/.gitignore',oldIgnore=readFile(root,personalIgnore)||'';
  if(!oldIgnore.split(/\r?\n/).includes('*'))writeFile(root,personalIgnore,oldIgnore+'\n*\n');
  if(s.p.config.engine==='godot-gdscript'&&readFile(root,s.entryDirectory+'/personal/.gdignore')===null)writeFile(root,s.entryDirectory+'/personal/.gdignore','# Local credentials, not game resources.\n');
  const files={};for(const m of secrets){project({projectId:s.p.id});const secret=developers.read({projectId:s.p.id,credentialId:m.credentialId});const text=JSON.stringify(secret,null,2)+'\n',old=readFile(root,m.path);if(old!==privateBefore.get(m.path))throw new Error('初始化期间凭证文件已变化，请重新检查：'+m.path);if(old!==text)writeFile(root,m.path,text);files[m.path]=hash(text);}
  const personalReadme=s.entryDirectory+'/personal/README.md',personalMarker='<!-- GameCreator personal credentials -->';
  const personalText=personalMarker+'\n# 本机开发者凭证\n\n凭证包含私钥，不提交到 Git，不写入公共文档或反馈。每位开发者只使用分配给自己的凭证；目录本身不提供成员之间的访问隔离。实际权限以 GameCreator 当前授权为准。\n\n'+current.members.map(m=>'- '+m.name+'：'+m.id+'.json').join('\n')+'\n';
  const previousReadme=readFile(root,personalReadme);if(previousReadme===null||previousReadme.startsWith(personalMarker))writeFile(root,personalReadme,personalText);
  const at=new Date().toISOString();storage.setItem(s.settingsKey,JSON.stringify(s.settings));storage.setItem(key(s.p.id),JSON.stringify({schema:1,at,engineDirectory:root,entryDirectory:s.entryDirectory,docsDirectory:s.settings.docsDirectory,files}));plans.delete(input.token);
  return {...publicStatus({...s,saved:{at,engineDirectory:root,entryDirectory:s.entryDirectory}}),message:'项目协作环境已初始化；实际运行与验收仍在引擎完成。',files:[s.entryDirectory+'/README.md',...current.members.map(m=>m.path)]};
 }
 return {run};
}
module.exports={createProjectStartup};
