export const artStyleFields={direction:'整体风格',mood:'目标氛围',view:'视角与比例',rendering:'表现方式',shape:'轮廓与描边',lighting:'明暗与光照',texture:'材质与细节',ui:'字体与界面',motion:'动画与特效',avoid:'应避免的表现'};
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v,max=4000)=>typeof v==='string'&&v.length<=max;
const date=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const exact=(v,keys)=>object(v)&&Object.keys(v).every(k=>keys.includes(k));
const list=(xs,max,check)=>Array.isArray(xs)&&xs.length<=max&&new Set(xs.map(x=>x?.id)).size===xs.length&&xs.every(x=>object(x)&&text(x.id,200)&&!!x.id.trim()&&!['__proto__','constructor','prototype'].includes(x.id)&&check(x));
export const emptyStyleDefinition=()=>({...Object.fromEntries(Object.keys(artStyleFields).map(k=>[k,''])),palette:[],references:[],categories:[]});
export const emptyArtStyle=()=>({schema:1,draft:emptyStyleDefinition(),versions:[]});
export function validateStyleDefinition(v){
 if(!exact(v,[...Object.keys(artStyleFields),'palette','references','categories'])||Object.keys(artStyleFields).some(k=>!text(v[k]))||
 !list(v.palette,32,x=>exact(x,['id','name','color','usage'])&&text(x.name,200)&&text(x.usage,1000)&&(x.color===''||typeof x.color==='string'&&/^#[0-9a-f]{6}$/i.test(x.color)))||
 !list(v.references,30,x=>exact(x,['id','title','source','take','avoid'])&&text(x.title,200)&&['source','take','avoid'].every(k=>text(x[k],2000)))||
 !list(v.categories,100,x=>exact(x,['id','rules'])&&text(x.rules,6000)))throw new Error('美术风格定义无效，请检查字段、色值和分类补充');
 return v;
}
export function validateArtStyle(v){
 if(v===undefined)return;
 if(!exact(v,['schema','draft','versions'])||v.schema!==1||!Array.isArray(v.versions)||v.versions.length>50)throw new Error('美术风格存档格式无效');
 validateStyleDefinition(v.draft);
 for(const [i,version] of v.versions.entries()){
  if(!exact(version,['revision','at','note','definition'])||version.revision!==i+1||!date(version.at)||!text(version.note,2000)||!version.note.trim())throw new Error('美术风格版本记录无效');
  validateStyleDefinition(version.definition);if(!version.definition.direction.trim())throw new Error('已确认的风格必须明确整体方向');
 }
}
export function validateStyleItem(item){
 if(item.styleException!==undefined&&(!exact(item.styleException,['requirements','reason'])||!text(item.styleException.requirements,3000)||!text(item.styleException.reason,3000)))throw new Error('素材风格特殊要求格式无效');
 if(item.styleReview!==undefined){const r=item.styleReview;if(!exact(r,['revision','categoryId','at','exception'])||!Number.isSafeInteger(r.revision)||r.revision<1||!text(r.categoryId,200)||!date(r.at))throw new Error('素材风格复核记录无效');validateStyleItem({styleException:r.exception});if(!r.exception)throw new Error('风格复核缺少特殊要求快照');}
}
export const stableStyle=v=>Array.isArray(v)?'['+v.map(stableStyle).join(',')+']':object(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stableStyle(v[k])).join(',')+'}':JSON.stringify(v);
export const currentArtStyle=style=>style?.versions.at(-1);
export const styleDraftChanged=style=>!!style&&stableStyle(style.draft)!==stableStyle(currentArtStyle(style)?.definition||emptyStyleDefinition());
export function confirmArtStyle(style,note,at=new Date().toISOString()){
 validateArtStyle(style);if(!style.draft.direction.trim())throw new Error('请先填写整体风格，未确定的其他项目可以留空');if(!note.trim())throw new Error('请说明本次确认或调整的原因');if(!styleDraftChanged(style))throw new Error('风格草稿与已确认基准一致');
 const next={...style,versions:[...style.versions,{revision:style.versions.length+1,at,note:note.trim(),definition:structuredClone(style.draft)}]};validateArtStyle(next);return next;
}
export function validateStyleMutation(before,after){
 validateArtStyle(after);const old=before?.versions||[],next=after?.versions||[];
 if(next.length<old.length||next.length>old.length+1||old.some((v,i)=>stableStyle(v)!==stableStyle(next[i])))throw new Error('已确认的美术风格版本不能覆盖或删除');
 if(next.length>old.length&&stableStyle(next.at(-1).definition)!==stableStyle(after.draft))throw new Error('确认的美术风格必须与当前草稿一致');
}
export const styleExceptionOf=item=>item?.styleException||{requirements:'',reason:''};
const relevant=(definition,categoryId)=>({...definition,categories:definition.categories.filter(c=>c.id===categoryId)});
export function styleReviewState(style,item,categoryId){
 const current=currentArtStyle(style);if(!current)return 'unconfirmed';
 const review=item?.styleReview;if(!review)return 'pending';const previous=style.versions.find(v=>v.revision===review.revision);
 return previous&&review.categoryId===categoryId&&stableStyle(review.exception)===stableStyle(styleExceptionOf(item))&&stableStyle(relevant(previous.definition,categoryId))===stableStyle(relevant(current.definition,categoryId))?'reviewed':'changed';
}
export const styleReviewLabels={unconfirmed:'风格待确定',pending:'待风格复核',changed:'风格已更新 · 待复核',reviewed:'风格已复核'};
export function reviewArtStyle(style,item,categoryId,at=new Date().toISOString()){
 const version=currentArtStyle(style),exception=styleExceptionOf(item);if(!version)throw new Error('请先确认项目美术风格基准');if(exception.requirements.trim()&&!exception.reason.trim())throw new Error('请填写特殊要求的原因后再确认复核');return{revision:version.revision,categoryId,at,exception:structuredClone(exception)};
}
export function styleDefinitionMarkdown(definition,categories=[],categoryId){
 const lines=Object.entries(artStyleFields).map(([k,label])=>`- ${label}：${definition[k]||'待确定'}`);
 lines.push('', '色板：', ...definition.palette.map(c=>`- ${c.name||'未命名色'} · ${c.color||'色值待确定'}：${c.usage||'用途待确定'}`));if(!definition.palette.length)lines.push('- 待确定');
 for(const c of definition.categories.filter(c=>categoryId===undefined||c.id===categoryId))lines.push('',`分类补充 · ${categories.find(x=>x.id===c.id)?.name||'分类已移除（'+c.id+'）'}：`,c.rules||'无额外要求');
 if(definition.references.length)lines.push('','参考与反例：',...definition.references.map(r=>`- ${r.title||'未命名参考'}；来源：${r.source||'未填写'}\n  采用：${r.take||'待确定'}\n  避免：${r.avoid||'未填写'}`));
 return lines.join('\n');
}
