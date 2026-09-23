import type {ProjectScheduleStore} from './project-schedule.ts';
import type {DevelopmentToolsStore} from '../shared/development-tools.mjs';

export function milestoneAcceptance(store:ProjectScheduleStore,id:string) {
  const tasks=store.tasks.filter(t=>t.milestoneId===id),completed=tasks.filter(t=>t.status==='已完成').length;
  return {tasks,completed,total:tasks.length,ready:tasks.length>0&&completed===tasks.length};
}

export function acceptProductionMilestone(store:ProjectScheduleStore,id:string,note:string,date:string) {
  const milestone=store.milestones.find(m=>m.id===id),state=milestoneAcceptance(store,id);
  if(!milestone)throw new Error('里程碑已不存在，请重新读取排期');
  if(milestone.status==='已验收')throw new Error('此里程碑已经验收');
  if(!state.ready)throw new Error('里程碑内的制作任务尚未全部完成，不能验收');
  const record=`${date}：确认 ${state.total} 项制作任务全部完成，里程碑验收通过。${note.trim()?' '+note.trim():''}`;
  return {...store,milestones:store.milestones.map(m=>m.id===id?{...m,status:'已验收' as const,review:[m.review,record].filter(Boolean).join('\n')}:m)};
}

/** Keep old review evidence, but require a fresh decision when accepted work is reopened or regrouped. */
export function invalidateMilestoneAcceptance(before:ProjectScheduleStore,after:ProjectScheduleStore):ProjectScheduleStore {
  const members=(store:ProjectScheduleStore,id:string)=>store.tasks.filter(t=>t.milestoneId===id).map(t=>t.id).sort().join('\n');
  return {...after,milestones:after.milestones.map(m=>{
    if(m.status!=='已验收'||before.milestones.find(old=>old.id===m.id)?.status!=='已验收')return m;
    const reopened=before.tasks.some(t=>t.milestoneId===m.id&&t.status==='已完成'&&after.tasks.some(n=>n.id===t.id&&n.milestoneId===m.id&&n.status!=='已完成'));
    return reopened||members(before,m.id)!==members(after,m.id)?{...m,status:'进行中'}:m;
  })};
}

/** Task completion is authoritative only for active, linked tools. Never enable archived/disabled tools. */
export function reconcileToolAcceptance(store:DevelopmentToolsStore,schedule:ProjectScheduleStore):DevelopmentToolsStore {
  let changed=false;
  const tools=store.tools.map(tool=>{
    if(tool.archived||tool.status==='停用')return tool;
    const linked=schedule.tasks.filter(t=>t.references.some(r=>r.kind==='tool'&&r.targetId===tool.id));
    const taskIds=linked.map(t=>t.id).sort(),complete=linked.length>0&&linked.every(t=>t.status==='已完成');
    if(complete){
      if(tool.status==='可使用'&&(!tool.scheduleAcceptance||JSON.stringify(taskIds)===JSON.stringify(tool.scheduleAcceptance.taskIds)))return tool;
      changed=true;return {...tool,status:'可使用' as const,scheduleAcceptance:{taskIds}};
    }
    if(tool.scheduleAcceptance){
      changed=true;const {scheduleAcceptance:_,...rest}=tool;
      return {...rest,status:'待验收' as const};
    }
    return tool;
  });
  return changed?{...store,tools}:store;
}
