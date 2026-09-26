// Explicit grants, independent of broad project authoring permissions.
export const artPermissionLabels={style:'修改整体美术风格',details:'修改已有素材详细内容',technical:'制定技术制作方案',propose:'提出素材新增、删除与关联建议',dispatch:'派发美术任务'};
export function validArtPermissions(value){return value===undefined||Array.isArray(value)&&new Set(value).size===value.length&&value.every(k=>Object.hasOwn(artPermissionLabels,k));}
export function recommendedArtPermissions(ids){return [...new Set(ids.flatMap(id=>id==='art-director'?['style','details','propose','dispatch']:id==='technical-art'?['details','technical','propose']:[]))];}
export function artGrants(member){return member?.active?member.developer?.artPermissions||[]:[];}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// Compare the resulting documents, so replacing a parent object cannot bypass field grants.
export function assertArtPermission(member,before,after){
 const grants=artGrants(member),requireGrant=k=>{if(!grants.includes(k))throw new Error('缺少素材权限：'+artPermissionLabels[k]);};
 const structural=()=>{throw new Error('新增、删除、归档、分类或关联变更请提出建议，由项目负责人审核处理');};
 const allowed={requirements:['name','description','specification','acceptance','generationPrompt','styleException','updatedAt'],assets:['name','description','styleException','updatedAt']};
 for(const list of ['requirements','assets']){
  const a=before[list]||[],b=after[list]||[];if(!same(a.map(x=>x.id),b.map(x=>x.id)))structural();
  for(const old of a){const next=b.find(x=>x.id===old.id);for(const key of new Set([...Object.keys(old),...Object.keys(next)]))if(!same(old[key],next[key])){if(!allowed[list].includes(key))structural();requireGrant('details');}}
 }
 for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
  if(['requirements','assets'].includes(key)||same(before[key],after[key]))continue;
  if(key==='style'){requireGrant('style');if(!same(before.style?.versions||[],after.style?.versions||[]))throw new Error('风格发布与历史由项目负责人确认，开发者仅修改风格草稿');}
  else if(key==='productionDocs'){
   requireGrant('technical');const a=before.productionDocs||[],b=after.productionDocs||[];
   for(const old of a){const next=b.find(x=>x.id===old.id);if(!next||next.archived!==old.archived)structural();}
  }else structural();
 }
}
export function artPermissionsMarkdown(member){const g=artGrants(member);return ['## 素材操作权限',...(g.length?g.map(k=>'- '+artPermissionLabels[k]):['- 未授予专项权限']),'- 新增、删除、归档或改变素材分类与关联：提交任务建议，不直接改写素材结构。','- 上传已有素材的交付版本属于制作交付，沿用版本与验收流程。','- 风格草稿和技术方案提交仍由客户端核对差异；签名不代表自动审批。'].join('\n');}
