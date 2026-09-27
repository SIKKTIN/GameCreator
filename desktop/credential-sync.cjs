// Credentials are previewed as metadata, never passed to the public backup pipeline.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const digest=text=>text===null?null:createHash('sha256').update(text).digest('hex');
const pathKey=value=>process.platform==='win32'?value.toLowerCase():value;
function credentialPlan({root,entryDirectory,members,projectId,saved,developers,readFile}){
 const sameRoot=saved?.engineDirectory&&path.resolve(saved.engineDirectory).toLowerCase()===path.resolve(root).toLowerCase();
 const tracked=sameRoot?saved.files||{}:{},rows=[],state=[];
 for(const m of members.filter(m=>!m.error&&m.credentialId)){
  if(state.some(r=>pathKey(r.path)===pathKey(m.path)))throw new Error('成员凭证文件名冲突，请检查成员 ID');
  const previousPaths=Object.keys(tracked).filter(p=>pathKey(p)===pathKey(m.path)),previousHash=tracked[previousPaths[0]];
  const text=JSON.stringify(developers.read({projectId,credentialId:m.credentialId}),null,2)+'\n',old=readFile(root,m.path),before=digest(old),after=digest(text);
  const status=old===null?'added':before===after?(tracked[m.path]===after?'unchanged':'updated'):previousHash===before?'updated':'conflict';
  rows.push({id:'credential:'+m.id,path:m.path,kind:'credential',label:m.name+' · 私有凭证',version:'',status,reason:status==='conflict'?'凭证文件已被修改或不是本次同步管理的文件；替换不保留私钥备份。':'沿用现有身份与令牌，仅导出到引擎 personal 目录，不进入公共备份。'});
  state.push({path:m.path,before,after,previousPaths,memberId:m.id,credentialId:m.credentialId});
 }
 for(const [relative,oldHash] of Object.entries(tracked)){
  if(state.some(r=>pathKey(r.path)===pathKey(relative)))continue;
  // Cleanup is confined to previously managed credential files, in the same engine.
  if(![saved.entryDirectory,...saved.credentialDirectories||[]].some(dir=>relative.startsWith(dir+'/personal/')&&/^[\w-]+\.json$/.test(relative.slice((dir+'/personal/').length))))continue;
  const before=digest(readFile(root,relative));
  rows.push({id:'credential:retired:'+relative,path:relative,kind:'credential',label:'旧成员凭证',version:'',remove:true,status:before===null?'unchanged':before===oldHash?'removed':'conflict',reason:'成员已停用、令牌已失效或导出位置改变；确认后移除旧凭证，不备份私钥。'});
  state.push({path:relative,before,remove:true,previousPaths:Object.keys(tracked).filter(p=>pathKey(p)===pathKey(relative))});
 }
 return {rows,state,tracked};
}
function applyCredentials({root,entryDirectory,projectId,engine,members,plan,decisions,removals,developers,readFile,writeFile,safeFile}){
 const files={...plan.tracked},changes=[];
 // Preflight the complete private batch before touching a file.
 for(const item of plan.state)if(digest(readFile(root,item.path))!==item.before)throw new Error('凭证文件在预览后发生变化，请重新检查：'+item.path);
 const secrets=new Map();
 for(const item of plan.state.filter(r=>!r.remove)){
  const text=JSON.stringify(developers.read({projectId,credentialId:item.credentialId}),null,2)+'\n';
  if(digest(text)!==item.after)throw new Error('成员凭证在预览后发生变化，请重新检查');secrets.set(item.path,text);
 }
 for(const rel of ['.gitignore',entryDirectory+'/personal/.gitignore',entryDirectory+'/personal/.gdignore',entryDirectory+'/personal/README.md'])readFile(root,rel);
 const ignore=readFile(root,'.gitignore')||'',line='/'+entryDirectory+'/personal/';
 if(!ignore.split(/\r?\n/).includes(line))writeFile(root,'.gitignore',ignore+(ignore.endsWith('\n')||!ignore?'':'\n')+'\n# GameCreator local developer credentials\n'+line+'\n');
 const pi=entryDirectory+'/personal/.gitignore',oldIgnore=readFile(root,pi)||'';if(!oldIgnore.split(/\r?\n/).includes('*'))writeFile(root,pi,oldIgnore+'\n*\n');
 if(engine==='godot-gdscript'&&readFile(root,entryDirectory+'/personal/.gdignore')===null)writeFile(root,entryDirectory+'/personal/.gdignore','# Local credentials, not game resources.\n');
 for(const item of plan.state){
  const row=plan.rows.find(r=>r.path===item.path);
  if(row.status==='conflict'&&decisions[item.path]!=='replace'){changes.push({path:item.path,action:'kept',version:'',versionId:''});continue;}
  if(item.remove){
   if(item.before===null){for(const p of item.previousPaths)delete files[p];continue;}
   if(!removals.includes(item.path))continue;
   // Recheck the exact file immediately before a non-recursive removal.
   if(digest(readFile(root,item.path))!==item.before)throw new Error('旧凭证文件已变化：'+item.path);
   fs.unlinkSync(safeFile(root,item.path));for(const p of item.previousPaths)delete files[p];changes.push({path:item.path,action:'removed',version:'',versionId:''});
  }else{
   if(digest(readFile(root,item.path))!==item.before)throw new Error('凭证文件已变化：'+item.path);
   if(item.before!==item.after){writeFile(root,item.path,secrets.get(item.path));changes.push({path:item.path,action:'written',version:'',versionId:''});}
   if(item.before===item.after&&files[item.path]!==item.after)changes.push({path:item.path,action:'registered',version:'',versionId:''});
   for(const p of item.previousPaths)delete files[p];
   files[item.path]=item.after;
  }
 }
 const rel=entryDirectory+'/personal/README.md',marker='<!-- GameCreator personal credentials -->',old=readFile(root,rel);
 if(old===null||old.startsWith(marker))writeFile(root,rel,marker+'\n# 本机开发者凭证\n\n私有凭证不提交到 Git，不写入公共文档或反馈。Godot 会忽略此目录，请通过文件资源管理器查看。实际权限以 GameCreator 当前授权为准；目录不提供成员间的访问隔离。\n\n'+members.filter(m=>!m.error&&m.credentialId).map(m=>'- '+m.name+'：'+m.id+'.json').join('\n')+'\n');
 return {files,changes};
}
module.exports={credentialPlan,applyCredentials};
