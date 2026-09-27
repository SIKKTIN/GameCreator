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
export function artPermissionsMarkdown(member){const g=artGrants(member),full=member.permissions?.includes('project_write')&&member.developer?.scope==='project'&&(member.developer.projectModules===undefined||member.developer.projectModules.includes('art-assets'));return ['## 素材操作权限',...(g.length?g.map(k=>'- '+artPermissionLabels[k]):['- 未授予专项权限']),full?'- 已有素材模块完整编写权：可按项目编写协议提交新增、修改、归档及关联变更，由客户端核对应用。':'- 未获素材模块完整编写权时，结构调整需通过已授权的建议入口交由负责人处理；专项权限仅覆盖明确列出的操作。','- 美术资产直接在引擎工程制作与验证，按任务反馈交付路径、结果及待验收状态，不要求上传交付版本图片。','- 风格与制作方案的设计提交仍需核对差异，签名不代表已应用或已验收。'].join('\n');}
