import {createArtAsset,createArtRequirement,type ArtAsset,type ArtRequirement,type ArtStore} from './art-assets.ts';
import {artLibrary,artCategoryId,assignArtCategory,type ArtItemKind} from './art-library.ts';
export type MaterialTarget={kind:ArtItemKind;id:string};
export type MaterialItem=MaterialTarget&{key:string;name:string;description:string;categoryId:string;archived:boolean;status:string;owner:string;dueDate:string;requirement?:ArtRequirement;assets:ArtAsset[];files:number;versions:number;searchText:string};
/** A view over the original IDs and links. Opening an old project never rewrites it. */
export function materialItems(store:ArtStore):MaterialItem[] {
  const library=artLibrary(store);
  const build=(kind:ArtItemKind,source:ArtRequirement|ArtAsset,assets:ArtAsset[],requirement?:ArtRequirement):MaterialItem=>({
    kind,id:source.id,key:kind+':'+source.id,name:source.name,description:source.description,categoryId:artCategoryId(library,kind,source.id),archived:source.archived,
    status:requirement?.status||(source as ArtAsset).productionStatus||'待制作',owner:requirement?.owner||'',dueDate:requirement?.dueDate||'',requirement,assets,
    files:assets.reduce((n,a)=>n+a.versions.reduce((s,v)=>s+v.files.length,0),0),versions:assets.reduce((n,a)=>n+a.versions.length,0),
    searchText:[source.name,source.description,source.styleException?.requirements,source.styleException?.reason,source.delivery?.path,source.delivery?.notes,requirement?.owner,requirement?.specification,requirement?.generationPrompt?.prompt,...assets.flatMap(a=>[a.name,a.description,a.delivery?.path,a.delivery?.notes,...a.versions.flatMap(v=>[v.name,...v.files.map(f=>f.name)])])].join(' ').toLocaleLowerCase(),
  });
  const items=store.requirements.map(r=>build('requirement',r,store.assets.filter(a=>store.links.some(l=>l.requirementId===r.id&&l.assetId===a.id)).sort((a,b)=>Number(artCategoryId(library,'asset',b.id)===artCategoryId(library,'requirement',r.id))-Number(artCategoryId(library,'asset',a.id)===artCategoryId(library,'requirement',r.id))),r));
  // A differently classified standalone resource keeps its original category. Shared deliveries stay in each using item.
  for(const a of store.assets)if(!items.some(i=>i.categoryId===artCategoryId(library,'asset',a.id)&&i.assets.some(asset=>asset.id===a.id)))items.push(build('asset',a,[a]));
  return items;
}
export function materialForTarget(store:ArtStore,target:MaterialTarget|null) {
  if(!target)return undefined;
  const items=materialItems(store);
  return items.find(i=>i.kind===target.kind&&i.id===target.id)||items.find(i=>!i.archived&&target.kind==='asset'&&i.assets.some(a=>a.id===target.id))||items.find(i=>target.kind==='asset'&&i.assets.some(a=>a.id===target.id));
}
export function newMaterialItem(store:ArtStore,name:string,categoryId:string) {
  const r=createArtRequirement(name),category=artLibrary(store).categories.find(c=>c.id===categoryId)?.name;
  if(['角色','场景','动画','特效','UI','图标','其他'].includes(category||''))r.category=category as ArtRequirement['category'];
  return {store:assignArtCategory({...store,requirements:[...store.requirements,r]},'requirement',r.id,categoryId),target:{kind:'requirement' as const,id:r.id}};
}
export function addMaterialDelivery(store:ArtStore,requirementId:string,name?:string) {
  const r=store.requirements.find(r=>r.id===requirementId);if(!r||r.archived)throw new Error('素材条目不存在或已归档');
  const asset=createArtAsset(name?.trim()||r.name),category=artCategoryId(artLibrary(store),'requirement',r.id);
  return {store:assignArtCategory({...store,assets:[...store.assets,asset],links:[...store.links,{id:crypto.randomUUID(),requirementId:r.id,assetId:asset.id,note:''}]},'asset',asset.id,category),assetId:asset.id};
}
export function addMaterialRequirements(store:ArtStore,assetId:string) {
  const asset=store.assets.find(a=>a.id===assetId);if(!asset||asset.archived)throw new Error('素材条目不存在或已归档');
  const created=newMaterialItem(store,asset.name,artCategoryId(artLibrary(store),'asset',asset.id));
  const requirement=created.store.requirements.find(r=>r.id===created.target.id)!;requirement.description=asset.description;requirement.status=asset.productionStatus||'待制作';if(asset.delivery)requirement.delivery={...asset.delivery};if(asset.styleException)requirement.styleException=structuredClone(asset.styleException);if(asset.styleReview)requirement.styleReview=structuredClone(asset.styleReview);
  return {...created,store:{...created.store,links:[...created.store.links,{id:crypto.randomUUID(),requirementId:requirement.id,assetId:asset.id,note:''}]}};
}
export function assignMaterialCategory(store:ArtStore,target:MaterialTarget,categoryId:string) {
  let next=assignArtCategory(store,target.kind,target.id,categoryId);
  if(target.kind==='requirement')for(const a of store.assets)if(store.links.some(l=>l.requirementId===target.id&&l.assetId===a.id)&&!store.links.some(l=>l.assetId===a.id&&l.requirementId!==target.id))next=assignArtCategory(next,'asset',a.id,categoryId);
  return next;
}
