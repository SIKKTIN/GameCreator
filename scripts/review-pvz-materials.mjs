import {validateArtAssets,validateArtMutation} from '../src/art-assets.ts';
import {artLibrary} from '../src/art-library.ts';

// Explicit content revision for this prototype, never a global category heuristic.
export const pvzUnitDeliveries=[
 {key:'sunflower',name:'向日葵',folder:'角色',detail:'96×96 透明角色基准，沿用根锚点 (48,72)，标出产出挂点与统一色板；轮廓能与射手、坚果区分。供待机、产出动作和卡牌头像共同参考。'},
 {key:'peashooter',name:'豌豆射手',folder:'角色',detail:'96×96 透明角色基准，沿用根锚点 (48,72)，枪口明确朝右并附挂点坐标、轮廓及色板；供待机、发射动作和卡牌头像共同参考。'},
 {key:'wallnut',name:'坚果墙',folder:'角色',detail:'96×96 透明角色基准，标出固定根锚点与完整阻挡轮廓，保持子弹可见；供静态、轻待机、受压动作和卡牌头像参考，不增加护甲阶段。'},
 {key:'normal-zombie',name:'普通僵尸',folder:'敌人与首领',detail:'96×128 透明角色基准，沿用脚底锚点 (48,112)，朝左，附头部挂点与色板；是两类僵尸共用身体、步行和啃咬序列的唯一基底。'},
 {key:'cone-zombie',name:'路障僵尸',folder:'敌人与首领',detail:'96×128 透明组合定型图，复用普通僵尸身体，展示路障覆盖层与逐帧头部挂点的装配关系；是类别变体，不另画一套身体动画，不包含路障掉落或破甲状态。'},
];
const requirementFolders={
 overview:'制作规范',lawn:'场景',boundaries:'场景',sunflower:'角色',peashooter:'角色',wallnut:'角色','normal-zombie':'敌人与首领','cone-zombie':'敌人与首领',projectile:'特效','shared-feedback':'特效',cards:'UI','sun-entity':'图标','sun-feedback':'特效','sun-hud':'UI','plant-feedback':'UI',shovel:'图标',waves:'UI',ready:'UI',pause:'UI',outcome:'UI',
};
const assetFolders={
 'visual-guide':'制作规范','lawn-tiles':'场景','board-frame':'场景','home-marker':'场景','spawn-marker':'场景',
 'sunflower-motion':'动画','peashooter-motion':'动画','wallnut-motion':'动画','zombie-motion':'动画','cone-overlay':'敌人与首领',
 'sunflower-icon':'图标','peashooter-icon':'图标','wallnut-icon':'图标','sun-symbol':'图标',shovel:'图标',
 'pea-projectile':'特效','pea-impact':'特效','hit-flash':'特效','unit-remove':'特效','sun-feedback':'特效','cell-feedback':'特效','plant-commit':'特效',
 healthbar:'UI','card-frame':'UI','sun-counter':'UI','wave-banner':'UI','wave-counter':'UI','panel-buttons':'UI','operation-guide':'UI','pause-overlay':'UI','win-mark':'UI','lost-mark':'UI',
};
export function reviewPvzMaterials(value,now=new Date().toISOString()) {
 const store=structuredClone(validateArtAssets(value)),legacy=artLibrary({...store,library:undefined}),library=structuredClone(artLibrary(store));store.library=library;
 const report={added:[],updated:[],moved:[],preserved:[]};
 if(!store.requirements.some(r=>r.id==='pvz-art-req-overview'))throw new Error('不是可识别的植物大战僵尸原型素材存档');
 function folder(name){let c=library.categories.find(c=>c.name===name);if(!c){c={id:'pvz-material-'+name,name,description:'本原型的'+name+'制作需求与交付条目。'};library.categories.push(c);}return c.id;}
 function assign(kind,item,name){
   if(!item||item.archived)return;const map=kind==='requirements'?library.requirements:library.assets,id=item.id,desired=folder(name);
   // Respect explicit custom categories, including an intentionally unclassified item.
   if(value.library&&Object.hasOwn(value.library[kind],id)&&value.library[kind][id]!==legacy[kind][id]&&value.library[kind][id]!==desired){report.preserved.push(id);return;}
   if(map[id]!==desired){map[id]=desired;report.moved.push(id);}
 }
 for(const [key,name]of Object.entries(requirementFolders))assign('requirements',store.requirements.find(r=>r.id==='pvz-art-req-'+key),name);
 for(const [key,name]of Object.entries(assetFolders))assign('assets',store.assets.find(a=>a.id==='pvz-art-asset-'+key),name);
 for(const unit of pvzUnitDeliveries){
   const r=store.requirements.find(r=>r.id==='pvz-art-req-'+unit.key);if(!r)continue;
   if(r.archived||r.status==='已通过'){report.preserved.push(r.id);continue;}
   const id='pvz-art-asset-'+unit.key+'-design',name=unit.name+'角色定型与配色基准';let asset=store.assets.find(a=>a.id===id);
   if(!asset){asset={id,name,description:'待制作交付：'+unit.detail+'\n交付可编辑分层源文件、独立透明 PNG 和锚点说明；与当前局内视角一致，不要求背面或额外三视图。该条目是制作任务，尚无实际文件。',versions:[],adoptedVersionId:'',archived:false,createdAt:now,updatedAt:now};store.assets.push(asset);report.added.push(id);}
   if(asset.archived){report.preserved.push(id);continue;}
   assign('assets',asset,unit.folder);
   if(!store.links.some(l=>l.requirementId===r.id&&l.assetId===id))store.links.push({id:'pvz-art-link-'+unit.key+'-design',requirementId:r.id,assetId:id,note:'先确定本单位的轮廓、配色与锚点，再制作已关联的动作和头像；不增加新单位。'});
   const marker='【本版角色交付补充】';
   if(!r.specification.includes(marker)){
     r.specification+='\n\n'+marker+'\n'+name+'：'+unit.detail+'\n交付核对顺序：定型与配色 → 本需求已关联的动作/变体 → 独立头像（植物） → 共用受击、生命条与移除反馈。角色定型图需先保证局内尺寸下可辨认；动画时机和数值继续按原规则。';
     if(r.generationPrompt)r.generationPrompt.prompt+='\n\n'+marker+'\n补充交付资产：'+name+'。'+unit.detail+' 保持本项原有验收标准和所有关联交付，不把多个单位合并到一张不可拆分贴图。';
     r.updatedAt=now;report.updated.push(r.id);
   }
 }
 if(!value.library){
   const used=new Set([...Object.values(library.requirements),...Object.values(library.assets)]);
   library.categories=library.categories.filter(c=>used.has(c.id));
 }
 validateArtMutation(value,store);return {store,...report};
}
