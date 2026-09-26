import {policySyncPath} from './config-data-policy.mjs';
import {validName} from './ai-document-files.mjs';
import {documentGroups,moduleDocumentPath,relativeDocumentPath,projectWorkflowMarkdown} from './engine-document-layout.mjs';

export const defaultSyncSettings = {documents:true, assets:false, collaboration:true, includePlaceholders:true, docsDirectory:'docs/gamecreator', assetsDirectory:'assets/gamecreator', modules:[]};
export function syncPath(value) {
  if(typeof value!=='string')throw new Error('同步目录必须是工程内的相对路径');
  const result=value.trim().replace(/^res:\/\//,'').replaceAll('\\','/');
  if(!result||result.length>220)throw new Error('同步路径不能为空或过长');
  for(const part of result.split('/')) {
    validName(part,'同步路径');
    if(part.startsWith('.') || ['node_modules','addons'].includes(part.toLowerCase()))throw new Error('不能同步到隐藏目录、引擎缓存或插件目录');
  }
  return result;
}
export function syncSettings(input) {
  if(!input||['documents','assets','includePlaceholders'].some(k=>typeof input[k]!=='boolean')||!Array.isArray(input.modules)||input.modules.some(m=>typeof m!=='string')||input.modules.length>64)throw new Error('同步配置无效');
  const docsDirectory=syncPath(input.docsDirectory),assetsDirectory=syncPath(input.assetsDirectory);
  const a=docsDirectory.toLowerCase(),b=assetsDirectory.toLowerCase();
  if(a===b||a.startsWith(b+'/')||b.startsWith(a+'/'))throw new Error('文档目录和素材目录不能相同或互相包含');
  if(input.collaboration!==undefined&&typeof input.collaboration!=='boolean')throw new Error('开发协作配置无效');
  const collaboration=input.collaboration??false;
  if(collaboration&&[a,b].some(p=>p==='gamecreator'||p.startsWith('gamecreator/')))throw new Error('gamecreator 目录保留给开发协作，请调整文档或素材目录');
  return {documents:input.documents,assets:input.assets,collaboration,includePlaceholders:input.includePlaceholders,docsDirectory,assetsDirectory,modules:[...new Set(input.modules)]};
}

// Deterministic output: checking changes must not rewrite every file because the clock changed.
export function syncDocuments(document, modules, context={}) {
  if(!document||typeof document.projectName!=='string'||typeof document.version!=='string'||!Array.isArray(document.sections))throw new Error('项目文档无效');
  if(document.configDataPolicy!==undefined&&typeof document.configDataPolicy!=='string')throw new Error('配置数据规范格式无效');
  const sections=document.sections.filter(s=>s.id==='standards'||modules.includes(s.id));
  const seen=new Set();
  for(const s of sections) {
    if(!/^[a-z][a-z-]*$/.test(s.id)||typeof s.body!=='string'||typeof s.label!=='string'||seen.has(s.id))throw new Error('模块文档无效');
    seen.add(s.id);
  }
  const header=`# ${document.projectName}\n\n> 项目版本：${document.version || '未填写'}\n> 由 GameCreator 同步，供开发查阅。\n\n`;
  const workflow=projectWorkflowMarkdown({...context,projectName:document.projectName});
  const docs=[...sections,{id:'usage-guide',label:'协作流程与 GameCreator 写入入口',body:workflow},...(document.configDataPolicy?[{id:'config-data-policy',label:'配置数据管理与同步规范',body:document.configDataPolicy}]:[])];
  const docPath=id=>id==='overview'?'modules/overview.md':id==='config-data-policy'?policySyncPath:moduleDocumentPath(id);
  const list=items=>items.map(s=>`- [${s.label}](${docPath(s.id)})`).join('\n');
  const groups=documentGroups.map(g=>{const items=docs.filter(s=>g.modules.includes(s.id));return items.length?'### '+g.label+'\n\n'+list(items)+'\n':'';}).filter(Boolean);
  const others=docs.filter(s=>s.id!=='overview'&&!documentGroups.some(g=>g.modules.includes(s.id)));
  const feedback=context.collaboration?'\n开发进度与验收反馈见 [引擎协作入口]('+relativeDocumentPath((context.docsDirectory||'docs/gamecreator')+'/README.md','gamecreator/README.md')+')。\n':'';
  return [{id:'document:index',path:'README.md',content:header+workflow+feedback+'\n## 文档目录\n\n'+list(docs.filter(s=>s.id==='overview'))+'\n\n'+groups.join('\n')+(others.length?'\n### 其他模块\n\n'+list(others):'')},
    ...docs.map(s=>{const p=docPath(s.id);return {id:'document:'+s.id,path:p,content:header+'[返回目录]('+relativeDocumentPath(p,'README.md')+')\n\n'+(s.id!=='standards'&&seen.has('standards')?'更新项目前先读 [项目规范]('+relativeDocumentPath(p,docPath('standards'))+')。\n\n':'')+(s.id==='art'?s.body.replace(/\.\.\/media\/([a-f0-9-]{36}\.[a-z0-9]{1,12})/g,(_,name)=>relativeDocumentPath(p,'media/'+name)):s.body)+'\n'};})];
}

export function adoptedSyncAssets(store,includePlaceholders) {
  if(!store||!Array.isArray(store.assets))throw new Error('素材存档无效');
  const assets=[],warnings=[];
  for(const asset of store.assets) {
    if(asset.archived)continue;
    const version=asset.versions.find(v=>v.id===asset.adoptedVersionId);
    if(!version){warnings.push(asset.name+'：尚未采用交付版本');continue;}
    if(!version.files.length){warnings.push(asset.name+'：采用版本没有文件');continue;}
    if(version.placeholder&&!includePlaceholders){warnings.push(asset.name+'：占位版本未纳入同步');continue;}
    if(!version.placeholder&&version.review!=='已通过')throw new Error(asset.name+'：采用版本尚未审核通过');
    assets.push({id:asset.id,name:asset.name,versionId:version.id,versionName:version.name,placeholder:version.placeholder,files:version.files});
  }
  return {assets,warnings};
}
