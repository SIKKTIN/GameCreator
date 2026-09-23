export * from '../shared/art-style.mjs';
import {currentArtStyle,styleDefinitionMarkdown,styleDraftChanged,styleExceptionOf,styleReviewState,styleReviewLabels} from '../shared/art-style.mjs';
import {artLibrary,artCategoryId,artCategoryName,type ArtItemKind} from './art-library.ts';
import type {ArtStore} from './art-assets';
import type {ProductionDoc} from '../shared/material-production.mjs';
export function itemStyleContext(store:ArtStore,kind:ArtItemKind,id:string){
 const item=store[kind==='requirement'?'requirements':'assets'].find(v=>v.id===id),library=artLibrary(store),categoryId=artCategoryId(library,kind,id),version=currentArtStyle(store.style);
 return{item,library,categoryId,version,state:styleReviewState(store.style,item||{},categoryId)};
}
export function itemStyleMarkdown(store:ArtStore,kind:ArtItemKind,id:string){
 const {item,library,categoryId,version,state}=itemStyleContext(store,kind,id);if(!item)return '素材引用已失效，无法确定适用风格。';
 const exception=styleExceptionOf(item);
 return ['适用美术风格 · '+item.name,version?'项目基准 V'+version.revision+' · '+styleReviewLabels[state]:'项目美术风格待确定，请先明确基准，不自行猜测像素、卡通或写实。','所属分类：'+artCategoryName(library,categoryId),version?styleDefinitionMarkdown(version.definition,library.categories,categoryId):'',exception.requirements?'单项特殊要求：'+exception.requirements+'\n原因：'+(exception.reason||'待补充，不能作为已确认例外'):'单项无特殊要求，继承项目与分类规则。'].filter(Boolean).join('\n\n');
}
export function artStyleMarkdown(store:ArtStore){
 const version=currentArtStyle(store.style),categories=artLibrary(store).categories,lines=['### 美术风格','',version?'当前已确认基准：V'+version.revision+' · '+version.at+'\n\n确认说明：'+version.note:'美术风格待确定。请明确整体方向后确认基准，不由 AI 自行选择。'];
 if(version)lines.push('',styleDefinitionMarkdown(version.definition,categories));
 if(styleDraftChanged(store.style))lines.push('','#### 待确认草稿（不作为当前制作标准）','',styleDefinitionMarkdown(store.style!.draft,categories));
 if(store.style?.versions.length)lines.push('','#### 风格变更记录','',...store.style.versions.map(v=>`- V${v.revision} · ${v.at} · ${v.note}`));
 return lines.join('\n');
}
export function productionStyleMarkdown(store:ArtStore,doc:ProductionDoc){
 // A legacy asset can be the delivery behind several visible material requirements.
 // Include each using requirement so its exceptions are not lost in the production brief.
 const requirementIds=new Set(doc.requirementIds),assetIds:string[]=[];
 for(const id of doc.assetIds){const asset=store.assets.find(a=>a.id===id),users=store.links.filter(l=>l.assetId===id).map(l=>store.requirements.find(r=>r.id===l.requirementId)).filter(r=>r&&!r.archived);
  users.forEach(r=>requirementIds.add(r!.id));if(!users.length||asset?.styleException?.requirements.trim())assetIds.push(id);
 }
 const targets=[...[...requirementIds].map(id=>({kind:'requirement' as const,id})),...[...new Set(assetIds)].map(id=>({kind:'asset' as const,id}))];
 return targets.length?targets.map(t=>itemStyleMarkdown(store,t.kind,t.id)).join('\n\n'):artStyleMarkdown(store)+'\n\n此方案尚未关联具体素材，分类与单项要求需在关联后核对。';
}
