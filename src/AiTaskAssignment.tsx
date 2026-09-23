import {taskAssignment,type AiMember} from '../shared/ai-personnel.mjs';
import type {ProductionTask} from './project-schedule';
export function AiTaskAssignment({task,members,disabled,onChange}:{task:ProductionTask;members:AiMember[];disabled:boolean;onChange:(fields:Partial<ProductionTask>)=>void}){
 const a=taskAssignment(task),available=members.filter(m=>m.active||[a.primaryId,a.reviewerId,...a.collaboratorIds].includes(m.id));
 const options=(id:string)=>[...available.map(m=><option key={m.id} value={m.id} disabled={!m.active}>{m.name}{!m.active?'（停用）':''}</option>),...(id&&!members.some(m=>m.id===id)?[<option key={id} value={id}>成员已失效</option>]:[])];
 return <fieldset className="ai-assignment-fields" disabled={disabled}><legend>AI 任务分配</legend>
 <label>主负责人<select aria-label="AI 主负责人" value={a.primaryId} onChange={e=>onChange({assignment:{...a,primaryId:e.target.value,collaboratorIds:a.collaboratorIds.filter(id=>id!==e.target.value)},owner:members.find(m=>m.id===e.target.value)?.name||''})}><option value="">未分配{!a.primaryId&&task.owner?' · 原负责人：'+task.owner:''}</option>{options(a.primaryId)}</select></label>
 <label>验收负责人<select aria-label="AI 验收负责人" value={a.reviewerId} onChange={e=>onChange({assignment:{...a,reviewerId:e.target.value}})}><option value="">未指定</option>{options(a.reviewerId)}</select></label>
 <div className="ai-checks"><span>协作者</span>{available.filter(m=>m.id!==a.primaryId).map(m=><label key={m.id}><input type="checkbox" disabled={!m.active&&!a.collaboratorIds.includes(m.id)} checked={a.collaboratorIds.includes(m.id)} onChange={e=>onChange({assignment:{...a,collaboratorIds:e.target.checked?[...a.collaboratorIds,m.id]:a.collaboratorIds.filter(id=>id!==m.id)}})}/>{m.name}</label>)}</div>
 {a.reviewerId&&!members.find(m=>m.id===a.reviewerId)?.permissions.includes('review')&&<p className="sch-muted">该成员尚无提交验收结论的权限，请在人员分配中配置。</p>}
 </fieldset>;
}
