import {readGameplay} from './gameplay.ts';
import {readLocalStories} from './story-import.ts';
import {readFunctionalSystems} from './functional-systems.ts';
import {readArtAssets} from './art-assets.ts';
import {normalizeGameplayPublication,type GameplaySourceReference} from './team-gameplay-model.ts';
import type {SavedProject} from './project-catalog.ts';

export function readLocalGameplay(storage:Pick<Storage,'getItem'>,project:SavedProject){
  const prefix=`gamecreator.workspace.v1:${project.id}:`,store=readGameplay(storage,prefix+'gameplay').store;
  const references:GameplaySourceReference[]=[];
  if(store.designs.length){
    const stories=store.designs.some(d=>d.links.some(l=>l.kind==='story'))?readLocalStories(storage,project):[];
    let definitions:{key:string;label:string}[]=[];
    if(store.designs.some(d=>d.links.some(l=>l.kind==='dataset'))){
      const raw=storage.getItem(prefix+'definitions');definitions=raw===null?[]:JSON.parse(raw);
      if(!Array.isArray(definitions)||definitions.some(d=>!d||typeof d.key!=='string'||typeof d.label!=='string'))throw new Error('配置表名称存档无效，无法读取玩法引用');
    }
    for(const d of store.designs)for(const l of d.links)references.push({designId:d.id,kind:l.kind,targetId:l.targetId,title:(l.kind==='story'?stories.find(s=>s.id===l.targetId)?.title:definitions.find(s=>s.key===l.targetId)?.label)??l.targetId});
    const functional=readFunctionalSystems(storage,prefix+'functional-systems').store;
    for(const u of functional.usages.filter(u=>store.designs.some(d=>d.id===u.gameplayId))){
      const c=functional.capabilities.find(c=>c.id===u.capabilityId),system=functional.systems.find(s=>s.id===c?.systemId);
      references.push({designId:u.gameplayId,kind:'function',targetId:u.capabilityId,title:[system?.name,c?.name??u.capabilityId,u.note].filter(Boolean).join(' / ')});
    }
    const art=readArtAssets(storage,prefix+'art-assets').store;
    for(const r of art.requirements)for(const designId of new Set(r.sources.filter(s=>s.kind==='gameplay'&&store.designs.some(d=>d.id===s.targetId)).map(s=>s.targetId)))references.push({designId,kind:'art',targetId:r.id,title:r.name});
  }
  const gameplay=normalizeGameplayPublication({store,references});return{gameplay,signature:JSON.stringify(gameplay)};
}
