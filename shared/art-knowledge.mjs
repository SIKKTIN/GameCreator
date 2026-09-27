export const knowledgeTags={
 'medium:pixel':'媒介 · 像素','medium:handdrawn':'媒介 · 手绘','medium:3d':'媒介 · 三维',
 'rendering:flat':'表现 · 平面','rendering:painterly':'表现 · 绘画感','rendering:cel':'表现 · 卡通渲染',
 'perspective:side':'视角 · 侧视','perspective:top':'视角 · 俯视','perspective:isometric':'视角 · 等距',
 'subject:character':'主体 · 角色','subject:environment':'主体 · 场景','subject:ui':'主体 · UI','subject:vfx':'主体 · 特效',
 'theme:fantasy':'题材 · 奇幻','theme:scifi':'题材 · 科幻','theme:rural':'题材 · 田园',
 'mood:cozy':'氛围 · 温馨','mood:dark':'氛围 · 阴郁','mood:playful':'氛围 · 活泼',
 'color:warm':'色彩 · 暖色','color:cool':'色彩 · 冷色','color:muted':'色彩 · 低饱和',
 'shape:round':'造型 · 圆润','shape:angular':'造型 · 棱角','shape:organic':'造型 · 有机',
 'lighting:bright':'光照 · 明亮','lighting:contrast':'光照 · 强对比','production:bone':'制作 · 骨骼动画',
 'production:tiles':'制作 · 瓦片','production:lowpoly':'制作 · 低多边形'};
export const referenceSourceTypes={unknown:'未登记',screenshot:'游戏截图',artwork:'美术作品',internal:'内部创作',generated:'生成图片'};
export const referenceUsages={unknown:'尚未确认',reference:'仅供参考',permitted:'已登记使用许可'};
const text=(v,n=4000)=>typeof v==='string'&&v.length<=n;
export function validateKnowledgeMetadata(v){if(!v||!text(v.name,200)||!v.name.trim()||!text(v.description)||!text(v.source,2000)||!text(v.creator,200)||!text(v.work,200)||!text(v.usageNotes)||!Object.hasOwn(referenceSourceTypes,v.sourceType)||!Object.hasOwn(referenceUsages,v.usage)||!Array.isArray(v.tags)||v.tags.length>30||new Set(v.tags).size!==v.tags.length||v.tags.some(t=>!Object.hasOwn(knowledgeTags,t)))throw new Error('参考资料名称、来源或标签无效');return v;}
export function validateReferenceBoards(value){
 if(value===undefined)return [];if(!Array.isArray(value)||value.length>50)throw new Error('项目参考板格式无效');const ids=new Set();
 for(const b of value){if(!b||!text(b.id,200)||!b.id||ids.has(b.id)||!text(b.name,200)||!b.name.trim()||!text(b.categoryId,200)||!Array.isArray(b.references)||b.references.length>100)throw new Error('参考板名称或内容无效');ids.add(b.id);const refs=new Set();
  for(const r of b.references){validateKnowledgeMetadata(r.metadata);const f=r.image;if(!text(r.id,200)||!r.id||refs.has(r.id)||!text(r.libraryId,200)||!text(r.referenceId,200)||!Number.isSafeInteger(r.revision)||r.revision<1||!(/^[a-f0-9]{64}$/).test(r.hash)||!text(r.at,50)||!Number.isFinite(Date.parse(r.at))||!text(r.use,200)||!text(r.take,2000)||!text(r.avoid,2000)||!['required','inspiration'].includes(r.strength)||typeof r.active!=='boolean'||typeof r.deliverImage!=='boolean'||!f||!text(f.id,200)||!text(f.name,300)||!(/^[a-f0-9-]{36}\.[a-z0-9]{1,12}$/).test(f.storagePath)||!Number.isSafeInteger(f.size)||f.size<1||f.size>20*1024*1024||!['image/png','image/jpeg','image/webp'].includes(f.mime))throw new Error('参考图快照无效');refs.add(r.id);}
 }return value;
}
export function referenceBoardsMarkdown(boards){validateReferenceBoards(boards);return (boards||[]).flatMap(b=>['### 参考板：'+b.name,'适用范围：'+(b.categoryId||'整体项目'),'参考板是制作参考；是否纳入正式标准，以已确认美术风格为准。',...b.references.filter(r=>r.active).flatMap(r=>['#### '+r.metadata.name,'- 用途：'+(r.use||'待填写')+' · '+(r.strength==='required'?'必须遵守':'仅供启发'),'- 借鉴：'+(r.take||'待填写'),'- 排除：'+(r.avoid||'无'),'- 来源：'+(r.metadata.source||'未登记')+' · '+r.metadata.creator,'- 使用说明：'+referenceUsages[r.metadata.usage]+'；'+r.metadata.usageNotes,'- 资料快照：'+r.libraryId+'/'+r.referenceId+' @'+r.revision,r.deliverImage?'![参考图片](material-image:'+r.image.storagePath+')':'参考图片保存在项目中，未选择随开发文档同步。',''])]).join('\n');}
