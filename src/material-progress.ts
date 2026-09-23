import type {ArtStore,ArtRequirement,MaterialDocumentFields} from './art-assets.ts';
import type {ProjectScheduleStore,ProductionTask} from './project-schedule.ts';
import type {MaterialTarget} from './material-items.ts';

/** Resolve explicit art-task references only; integration/code work cannot gate art production. */
export function materialProductionTasks(store:ArtStore,schedule:ProjectScheduleStore,target:MaterialTarget):ProductionTask[] {
  const requirements=new Set(target.kind==='requirement'?[target.id]:store.links.filter(l=>l.assetId===target.id).map(l=>l.requirementId));
  const assets=new Set(target.kind==='asset'?[target.id]:store.links.filter(l=>l.requirementId===target.id).map(l=>l.assetId));
  return schedule.tasks.filter(t=>t.kind==='美术'&&t.references.some(r=>r.kind==='requirement'&&requirements.has(r.targetId)||r.kind==='asset'&&assets.has(r.targetId)));
}
export function materialTaskStatus(tasks:ProductionTask[]):ArtRequirement['status'] {
  if(!tasks.length)return '待制作';
  if(tasks.every(t=>t.status==='已完成'))return '已通过';
  if(tasks.some(t=>t.status==='受阻'))return '需修改';
  if(tasks.every(t=>t.status==='已完成'||t.status==='待验收'))return '待审核';
  return tasks.some(t=>t.status!=='待开始')?'制作中':'待制作';
}
export const materialStatusLabel=(status:string)=>status==='已通过'?'已完成':status==='待审核'?'待验收':status;

export function reconcileMaterialProgress(store:ArtStore,schedule:ProjectScheduleStore,at=new Date().toISOString()):ArtStore {
  let changed=false;
  const patch=(item:MaterialDocumentFields&{id:string;archived:boolean},kind:MaterialTarget['kind'],status:string)=>{
    if(item.archived)return null;
    const tasks=materialProductionTasks(store,schedule,{kind,id:item.id});
    // Removing all references returns the item to manual management; keep its last production result.
    if(!tasks.length){if(!item.scheduleProgress)return null;changed=true;return {scheduleProgress:undefined};}
    const next=materialTaskStatus(tasks),taskIds=tasks.map(t=>t.id).sort();
    if(status===next&&JSON.stringify(item.scheduleProgress?.taskIds)===JSON.stringify(taskIds))return null;
    changed=true;return {...(kind==='requirement'?{status:next}:{productionStatus:next}),scheduleProgress:{taskIds},updatedAt:at};
  };
  const requirements=store.requirements.map(r=>{const fields=patch(r,'requirement',r.status);return fields?{...r,...fields}:r;});
  const assets=store.assets.map(a=>{const fields=patch(a,'asset',a.productionStatus||'待制作');return fields?{...a,...fields}:a;});
  return changed?{...store,requirements,assets}:store;
}
