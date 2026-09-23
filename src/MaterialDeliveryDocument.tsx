import {useState} from 'react';
import {ArrowRight,Check,Link2,Plus} from 'lucide-react';
import {artRequirementStatuses,type ArtStore,type MaterialDocumentFields} from './art-assets';
import {materialProductionTasks,materialStatusLabel} from './material-progress';
import {createProductionTask} from './project-schedule';
import type {ProjectScheduleController} from './useProjectSchedule';
import type {ArtController} from './useArtAssets';
import type {MaterialItem} from './material-items';

export function MaterialDeliveryDocument({item,controller,schedule,apply,onOpenTask}:{item:MaterialItem;controller:ArtController;schedule:ProjectScheduleController;apply:(f:(s:ArtStore)=>ArtStore)=>boolean;onOpenTask:(id:string)=>void}) {
  const source=item.requirement||item.assets[0],delivery=source.delivery||{path:'',notes:''};
  const tasks=materialProductionTasks(controller.store,schedule.store,item),completed=tasks.filter(t=>t.status==='已完成').length;
  const [taskId,setTaskId]=useState('');
  const disabled=controller.blocked||controller.pending||item.archived,linkDisabled=disabled||schedule.blocked||schedule.pending;
  const direct=(t:typeof tasks[number])=>t.references.some(r=>r.kind===item.kind&&r.targetId===item.id);
  const available=schedule.store.tasks.filter(t=>t.kind==='美术'&&!direct(t));
  const patch=(fields:MaterialDocumentFields&{productionStatus?:typeof artRequirementStatuses[number]})=>apply(s=>item.requirement?{...s,requirements:s.requirements.map(r=>r.id===item.id?{...r,...fields,updatedAt:new Date().toISOString()}:r)}:{...s,assets:s.assets.map(a=>a.id===item.id?{...a,...fields,updatedAt:new Date().toISOString()}:a)});
  const bind=()=>{if(!available.some(t=>t.id===taskId))return;if(schedule.update(s=>({...s,tasks:s.tasks.map(t=>t.id===taskId?{...t,references:[...t.references,{kind:item.kind,targetId:item.id}]}:t)})))setTaskId('');};
  const create=()=>{const task={...createProductionTask('制作'+item.name),kind:'美术' as const,owner:item.owner||'',description:item.description,acceptance:item.requirement?.acceptance||'',references:[{kind:item.kind,targetId:item.id}]};if(schedule.update(s=>({...s,tasks:[...s.tasks,task]})))onOpenTask(task.id);};
  return <>
    <section className="gp-card mi-project-delivery"><div className="gp-card-heading"><div><h3>工程交付说明</h3><p className="gp-muted">素材直接制作在游戏工程中。这份文档记录交付位置与验收要求，无需导入图片。</p></div><span className="gp-badge">{materialStatusLabel(item.status)}</span></div>
      <fieldset className="ar-fields" disabled={disabled}>
        {!item.requirement&&<><label className="gp-field">资源名称<input aria-label="资源名称" value={source.name} onChange={e=>apply(s=>({...s,assets:s.assets.map(a=>a.id===item.id?{...a,name:e.target.value,updatedAt:new Date().toISOString()}:a)}))}/></label><label className="gp-field">资源说明<textarea aria-label="资源说明" value={source.description} onChange={e=>apply(s=>({...s,assets:s.assets.map(a=>a.id===item.id?{...a,description:e.target.value,updatedAt:new Date().toISOString()}:a)}))}/></label><label className="gp-field">制作状态<select aria-label="资源制作状态" disabled={linkDisabled||tasks.length>0} value={item.status} onChange={e=>patch({productionStatus:e.target.value as typeof artRequirementStatuses[number]})}>{artRequirementStatuses.map(s=><option value={s} key={s}>{materialStatusLabel(s)}</option>)}</select></label></>}
        <label className="gp-field">工程内交付路径<input aria-label="素材工程交付路径" maxLength={2000} value={delivery.path} placeholder="例如：assets/characters/sunflower/" onChange={e=>patch({delivery:{...delivery,path:e.target.value}})}/><small className="gp-muted">相对于已连接的游戏工程，填写文件或目录位置。</small></label>
        <label className="gp-field">交付与验证说明<textarea aria-label="素材工程交付说明" maxLength={30000} rows={5} value={delivery.notes} placeholder="记录源文件、导入方式、场景验证步骤和最终交付结果。" onChange={e=>patch({delivery:{...delivery,notes:e.target.value}})}/></label>
      </fieldset>
    </section>
    <section className="gp-card mi-task-progress" aria-label="素材关联任务进度"><div className="gp-card-heading"><div><h3>美术制作进度</h3><p className="gp-muted">任务进度与已应用的开发反馈会同步到这里。关联的美术任务全部完成后，素材标记为已完成。</p></div><strong>{completed}/{tasks.length}</strong></div>
      {schedule.blocked?<p className="ar-error">排期暂不可读，请恢复后查看关联任务。</p>:tasks.length?<><progress value={completed} max={tasks.length} aria-label="素材任务完成进度"/><div className="mi-task-list">{tasks.map(t=><article key={t.id}><div className="gp-card-heading"><button className="gp-link-name" onClick={()=>onOpenTask(t.id)}>{t.status==='已完成'&&<Check size={15}/>} {t.title}<ArrowRight size={14}/></button><span className="gp-badge">{t.status}</span></div><small className="gp-muted">{t.owner||'待分配负责人'}{direct(t)?' · 直接关联':' · 通过共用资源关联'}</small>{t.result&&<p className="mi-task-result">{t.result}</p>}{direct(t)&&<button className="gp-secondary" disabled={linkDisabled} onClick={()=>schedule.update(s=>({...s,tasks:s.tasks.map(v=>v.id===t.id?{...v,references:v.references.filter(r=>!(r.kind===item.kind&&r.targetId===item.id))}:v)}))}>解除此任务关联</button>}</article>)}</div></>:<p className="gp-muted">尚未关联美术制作任务，可关联已有任务或新建。未关联时，制作状态由你维护。</p>}
      <fieldset className="ar-fields ar-add-box" disabled={linkDisabled}><label className="gp-field">关联美术任务<select aria-label="关联美术任务" value={taskId} onChange={e=>setTaskId(e.target.value)}><option value="">选择已有美术任务</option>{available.map(t=><option key={t.id} value={t.id}>{t.title} · {t.status}</option>)}</select></label><div className="gp-actions"><button className="gp-secondary" disabled={!taskId} onClick={bind}><Link2 size={14}/>关联任务</button><button className="gp-secondary" onClick={create}><Plus size={14}/>新建美术任务</button></div></fieldset>
    </section>
    {item.assets.some(a=>a.versions.length>0)&&<details className="mi-reuse mi-legacy-files"><summary>历史导入文件（只读）</summary><p className="gp-muted">旧版本与原文件保留在项目存档中，不再作为素材完成的前提。</p>{item.assets.filter(a=>a.versions.length).map(a=><div key={a.id}><h4>{a.name}</h4>{a.versions.map(v=><div key={v.id}><strong>{v.name}</strong><small> · {v.createdAt.slice(0,10)} · {v.review}</small>{v.notes&&<p>{v.notes}</p>}<ul>{v.files.map(f=><li key={f.id}>{f.name} · {f.size} 字节</li>)}</ul></div>)}</div>)}</details>}
  </>;
}
