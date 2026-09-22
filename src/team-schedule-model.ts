import { emptyProjectSchedule, validateProjectSchedule, scheduleFromMilestones, type ProductionTask, type ProductionMilestone, type ProjectScheduleStore, type ScheduleReference } from './project-schedule.ts';

export type ScheduleSource = ScheduleReference & { name: string };
export type SchedulePublication = { store: ProjectScheduleStore; references: ScheduleSource[] };
export type ScheduleSnapshot = SchedulePublication & { initialized: boolean; versions: Record<string, number>; stamps: Record<string, { updatedAt: string; updatedBy: string }> };
export type ScheduleChange = { id: string; kind: 'task' | 'milestone'; revision: number; fields: ProductionTask | ProductionMilestone | null };
export type ScheduleDraft = { base: ScheduleSnapshot; store: ProjectScheduleStore };
export const emptyScheduleSnapshot = (): ScheduleSnapshot => ({ store: emptyProjectSchedule(), references: [], initialized: false, versions: {}, stamps: {} });
export function scheduleContent(record?: ProductionTask | ProductionMilestone | null) {
  if (!record) return null;
  const fields = 'dependencyIds' in record ? { ...record, dependencyIds: [...record.dependencyIds].sort(), references: record.references.map(r=>({kind:r.kind,targetId:r.targetId})).sort((a,b) => (a.kind+':'+a.targetId).localeCompare(b.kind+':'+b.targetId)) } : record;
  return Object.fromEntries(Object.entries(fields).sort(([a],[b])=>a.localeCompare(b)));
}
export const sameScheduleRecord = (a?: ProductionTask | ProductionMilestone | null, b?: ProductionTask | ProductionMilestone | null) => JSON.stringify(scheduleContent(a)) === JSON.stringify(scheduleContent(b));
export const scheduleRecords = (store: ProjectScheduleStore) => [...store.tasks, ...store.milestones];
export function scheduleChanges(base: ScheduleSnapshot, store: ProjectScheduleStore): ScheduleChange[] {
  return (['task','milestone'] as const).flatMap(kind => {
    const list = kind === 'task' ? 'tasks' : 'milestones', previous = new Map(base.store[list].map(r => [r.id,r])), next = new Map(store[list].map(r => [r.id,r]));
    return [...new Set([...previous.keys(),...next.keys()])].filter(id => !sameScheduleRecord(previous.get(id),next.get(id))).map(id => ({ id, kind, revision:base.versions[id]??0, fields:next.get(id)??null }));
  });
}
export function applyScheduleChanges(store: ProjectScheduleStore, changes: ScheduleChange[]): ProjectScheduleStore {
  const tasks = new Map(store.tasks.map(t => [t.id,t])), milestones = new Map(store.milestones.map(m => [m.id,m]));
  for (const c of changes) {
    if (c.kind === 'task') { if(c.fields) tasks.set(c.id,c.fields as ProductionTask); else tasks.delete(c.id); }
    else { if(c.fields) milestones.set(c.id,c.fields as ProductionMilestone); else milestones.delete(c.id); }
  }
  return validateProjectSchedule({ schema:1, tasks:[...tasks.values()], milestones:[...milestones.values()] });
}
// Structural errors are compared before/after a commit so old incomplete plans remain editable.
export function scheduleStructureErrors(store: ProjectScheduleStore): string[] {
  const tasks = new Map(store.tasks.map(t => [t.id,t])), milestones = new Set(store.milestones.map(m => m.id)), errors:string[]=[];
  for (const t of store.tasks) {
    if (t.milestoneId && !milestones.has(t.milestoneId)) errors.push(t.id+':milestone:'+t.milestoneId);
    for (const id of t.dependencyIds) if (!tasks.has(id)) errors.push(t.id+':dependency:'+id);
    const seen=new Set<string>(), pending=[...t.dependencyIds];
    while(pending.length) { const id=pending.pop()!; if(id===t.id) { errors.push(t.id+':cycle'); break; } if(!seen.has(id)) { seen.add(id); pending.push(...(tasks.get(id)?.dependencyIds??[])); } }
  }
  return errors;
}
export function reconcileSchedule(draft: ScheduleDraft, remote: ScheduleSnapshot): { draft: ScheduleDraft; conflicts: string[] } {
  const changes=scheduleChanges(draft.base,draft.store), rows=new Map(scheduleRecords(remote.store).map(r=>[r.id,r]));
  const conflicts=changes.filter(c=>c.revision!==(remote.versions[c.id]??0)&&!sameScheduleRecord(c.fields,rows.get(c.id))).map(c=>c.id);
  try {
    const store=applyScheduleChanges(remote.store,changes), previous=new Set([...scheduleStructureErrors(remote.store),...scheduleStructureErrors(draft.store)]);
    if(scheduleStructureErrors(store).some(e=>!previous.has(e))) conflicts.push(...changes.map(c=>c.id));
    return conflicts.length?{draft,conflicts:[...new Set(conflicts)]}:{draft:{base:remote,store},conflicts:[]};
  } catch { return {draft,conflicts:changes.map(c=>c.id)}; }
}
export function normalizeSchedulePublication(value: unknown): SchedulePublication {
  const input=value as SchedulePublication, store=validateProjectSchedule(input?.store);
  if(store.tasks.length>2000||store.milestones.length>200)throw new Error('项目排期最多 2000 个任务、200 个里程碑');
  for(const r of scheduleRecords(store)) {
    if(r.id.length>200||!r.title.trim()||r.title.length>160||r.owner.length>80)throw new Error('排期名称、标识或负责人无效');
    for(const [key,v] of Object.entries(r))if(typeof v==='string'&&v.length>10000)throw new Error('排期字段过长：'+key);
    if('dependencyIds' in r&&(r.dependencyIds.length>2000||r.dependencyIds.some(id=>id.length>200)||r.references.length>200||r.references.some(ref=>ref.targetId.length>200)))throw new Error('排期依赖或关联内容过多');
  }
  if(!Array.isArray(input.references)||input.references.length>10000||input.references.some(r=>!r||!['gameplay','capability','requirement','asset','map','prototype','tool'].includes(r.kind)||typeof r.targetId!=='string'||!r.targetId.trim()||r.targetId.length>200||typeof r.name!=='string'||r.name.length>200))throw new Error('排期来源信息无效');
  const refs=new Map(input.references.map(r=>[r.kind+':'+r.targetId,{kind:r.kind,targetId:r.targetId,name:r.name}]));
  const used=new Map(store.tasks.flatMap(t=>t.references).map(r=>[r.kind+':'+r.targetId,r]));
  return {store:structuredClone(store),references:[...used].map(([k,r])=>refs.get(k)??{...r,name:'来源内容 '+r.targetId})};
}
export function validateScheduleDraft(value: unknown): ScheduleDraft {
  const draft=value as ScheduleDraft; validateProjectSchedule(draft?.store); normalizeSchedulePublication(draft?.base);
  if(typeof draft.base.initialized!=='boolean'||!draft.base.versions||Array.isArray(draft.base.versions)||Object.values(draft.base.versions).some(v=>!Number.isSafeInteger(v)||v<0)||!draft.base.stamps||Array.isArray(draft.base.stamps)||Object.values(draft.base.stamps).some(s=>!s||typeof s.updatedAt!=='string'||typeof s.updatedBy!=='string'))throw new Error('排期草稿版本无效');
  return draft;
}
export const legacyScheduleMilestone = (id:string,fields:unknown):ProductionMilestone => ({...scheduleFromMilestones([fields]).milestones[0],id});
export const overviewScheduleMilestone = (m:ProductionMilestone) => ({title:m.title,owner:m.owner,due:m.due,status:m.status==='已验收'?'done':m.status==='进行中'?'active':'planned'});
export const scheduleFieldLabels:Record<string,string>={title:'名称',description:'说明',kind:'制作方向',owner:'负责人',status:'状态',priority:'优先级',start:'计划开始',end:'计划结束',actualStart:'实际开始',actualEnd:'实际完成',milestoneId:'所属里程碑',acceptance:'验收条件',result:'验收结果',dependencyIds:'前置任务',references:'关联内容',due:'目标日期',review:'验收记录'};
export function scheduleDiff(before:ProductionTask|ProductionMilestone|undefined,after:ProductionTask|ProductionMilestone|undefined) {
  if(!after)return ['删除此项'];
  return Object.entries(after).filter(([key,value])=>key!=='id'&&JSON.stringify(value)!==JSON.stringify(before?.[key as keyof typeof before])).map(([key,value])=>(scheduleFieldLabels[key]??key)+'：'+(Array.isArray(value)?JSON.stringify(value):value||'（空）'));
}
