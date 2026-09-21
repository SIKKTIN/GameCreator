import {validName} from './ai-document-files.mjs';

export const defaultSyncSettings = {documents:true, assets:true, includePlaceholders:true, docsDirectory:'docs/gamecreator', assetsDirectory:'assets/gamecreator', modules:[]};
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
  return {documents:input.documents,assets:input.assets,includePlaceholders:input.includePlaceholders,docsDirectory,assetsDirectory,modules:[...new Set(input.modules)]};
}

// Deterministic output: checking changes must not rewrite every file because the clock changed.
export function syncDocuments(document, modules) {
  if(!document||typeof document.projectName!=='string'||typeof document.version!=='string'||!Array.isArray(document.sections))throw new Error('项目文档无效');
  const sections=document.sections.filter(s=>modules.includes(s.id));
  const seen=new Set();
  for(const s of sections) {
    if(!/^[a-z][a-z-]*$/.test(s.id)||typeof s.body!=='string'||typeof s.label!=='string'||seen.has(s.id))throw new Error('模块文档无效');
    seen.add(s.id);
  }
  const header=`# ${document.projectName}\n\n> 项目版本：${document.version || '未填写'}\n> 由 GameCreator 同步，供开发查阅。\n\n`;
  return [
    {id:'document:index',path:'README.md',content:header+'## 模块目录\n\n'+sections.map(s=>`- [${s.label}](modules/${s.id}.md)`).join('\n')+'\n'},
    ...sections.map(s=>({id:'document:'+s.id,path:'modules/'+s.id+'.md',content:header+'[返回目录](../README.md)\n\n'+s.body+'\n'})),
  ];
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
