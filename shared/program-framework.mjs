import {frameworkLibrary} from './program-framework-library.mjs';

export const frameworkExtensions=[
  {id:'save',label:'存档与数据迁移',description:'保存与恢复业务快照，不要求统一数据后端。'},
  {id:'state',label:'数据注册与集中管理',description:'有统一观察、追踪或提交需求时采用。'},
  {id:'assembly',label:'模块声明与自动装配',description:'模块组合增多后，按需增加声明、检查或生成。'},
  {id:'network',label:'联机与状态同步',description:'多人项目按实际需要明确执行端和同步规则。'},
];
export function emptyProgramFramework(){return {schema:1,enabled:false,templateVersion:'1.0',runtime:'singleplayer',extensions:[],oasisSupplement:false,notes:''};}
export function validateProgramFramework(value){
  const fail=()=>{throw new Error('程序框架存档格式或版本无效');};
  if(!value||typeof value!=='object'||Array.isArray(value)||value.schema!==1||typeof value.enabled!=='boolean'||value.templateVersion!=='1.0'||!['singleplayer','multiplayer'].includes(value.runtime)||typeof value.oasisSupplement!=='boolean'||typeof value.notes!=='string'||value.notes.length>30000||!Array.isArray(value.extensions)||value.extensions.length>4||new Set(value.extensions).size!==value.extensions.length||value.extensions.some(id=>!frameworkExtensions.some(e=>e.id===id))||value.runtime==='singleplayer'&&value.extensions.includes('network'))fail();
  if(Object.keys(value).some(k=>!['schema','enabled','templateVersion','runtime','extensions','oasisSupplement','notes'].includes(k)))fail();
  return value;
}
export function adoptedFrameworkDocuments(store,engine){
  validateProgramFramework(store);
  return !store.enabled?[]:frameworkLibrary.documents.filter(d=>d.kind==='base'||d.kind==='extension'&&store.extensions.includes(d.id)||d.id==='oasis'&&store.oasisSupplement&&engine==='oasis-lua');
}
export function resolveFrameworkLink(fromPath,href){
  if(!href||/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(href))return undefined;
  let decoded;try{decoded=decodeURIComponent(href.split('#')[0]);}catch{return undefined;}
  const parts=fromPath.split('/');parts.pop();
  for(const part of decoded.split('/')){if(part==='..'){if(!parts.length)return undefined;parts.pop();}else if(part&&part!=='.')parts.push(part);}
  return frameworkLibrary.documents.find(d=>d.path===parts.join('/'));
}
// Export a self-contained adopted specification. Reference-only navigation must
// not silently include disabled extensions or links to missing Markdown files.
export function frameworkDocumentBody(doc,selected){
  let code=false;
  return doc.content.split('\n').filter(line=>line!=='[返回目录](../README.md)'&&line!=='[返回目录](README.md)').map(line=>{
    if(/^```/.test(line)){code=!code;return line;}
    if(code)return line;
    return line.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,(all,label,href)=>{
      if(/^https?:\/\//i.test(href))return all;
      const target=resolveFrameworkLink(doc.path,href);
      return target?label+(selected.some(d=>d.id===target.id)?'（见本模块对应规范）':'（规范库参考，未纳入本项目）'):label;
    }).replace(/^(#{1,6}) /,(_,marks)=>'#'.repeat(Math.min(6,marks.length+2))+' ');
  }).join('\n').trim();
}
export function programFrameworkMarkdown(store,engine){
  const docs=adoptedFrameworkDocuments(store,engine);
  const lines=['## 程序框架','',`- 内置规范：${frameworkLibrary.title} ${store.templateVersion}`,`- 采用状态：${store.enabled?'已采用':'未采用'}`,`- 运行模式：${store.runtime==='singleplayer'?'单机':'多人 / 联机'}`,''];
  if(!store.enabled)lines.push('当前项目尚未采用内置规范，下方项目约定仅为设计记录。未启用任何内置扩展。','');
  else {
    lines.push('Package / Core 为基础；以下仅包含本项目采用的规范。未选扩展和示例不作为实现要求。', '', '- 可选扩展：'+(store.extensions.map(id=>frameworkExtensions.find(e=>e.id===id).label).join('、')||'无'));
    if(store.oasisSupplement&&engine!=='oasis-lua')lines.push('- 绿洲补充因当前引擎不匹配而未纳入。');
    lines.push('');
  }
  lines.push('### 项目约定与例外','',store.notes.trim()||'尚未补充。','');
  for(const doc of docs)lines.push(frameworkDocumentBody(doc,docs),'');
  return lines.join('\n').trim();
}
