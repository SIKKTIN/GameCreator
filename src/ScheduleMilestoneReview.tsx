import {useState} from 'react';
import {CheckCircle2,Flag} from 'lucide-react';
import {milestoneAcceptance} from './schedule-acceptance';
import {compareMilestoneDatesDescending} from './overview-model';
import type {ProjectScheduleStore,ProductionMilestone} from './project-schedule';

export function MilestoneCards({store,disabled,onOpen,onReview,onReopen}:{store:ProjectScheduleStore;disabled:boolean;onOpen:(id:string)=>void;onReview:(id:string)=>void;onReopen:(id:string)=>void}) {
  return <div className="sch-milestones">{[...store.milestones].sort((a,b)=>compareMilestoneDatesDescending(a.due,b.due)).map(m=>{
    const state=milestoneAcceptance(store,m.id),accepted=m.status==='已验收',label=accepted?(state.ready?'已验收':'需重新验收'):state.ready?'待确认验收':m.status;
    return <article key={m.id} className={'sch-milestone-card'+(state.ready&&!accepted?' ready':'')} aria-label={'里程碑：'+m.title}>
      <div><Flag size={20}/><span>{label}</span></div>
      <button className="sch-milestone-open" aria-label={'打开里程碑：'+m.title} onClick={()=>onOpen(m.id)}><h3>{m.title||'未命名里程碑'}</h3></button>
      <p>{m.description||'填写本阶段需要交付的成果'}</p><small>{m.owner||'未分配负责人'} · {m.due||'目标日期未定'}</small>
      <div className="sch-progress"><i style={{width:(state.total?state.completed/state.total*100:0)+'%'}}/></div>
      <small>制作任务完成 {state.completed}/{state.total}</small><p className="sch-acceptance">{m.acceptance||'待填写验收条件'}</p>
      {accepted?<><p className="sch-review-hint">{state.ready?'已记录阶段验收。':'仍有未完成任务或尚未关联任务，请重新核验。'}</p><button disabled={disabled} aria-label={'重新打开里程碑验收：'+m.title} onClick={()=>onReopen(m.id)}>重新打开验收</button></>:<><p className="sch-review-hint">{state.ready?'任务已全部完成，等待管理者确认验收。':state.total?`还剩 ${state.total-state.completed} 项任务未完成。`:'关联制作任务后，才能进行阶段验收。'}</p><button className={state.ready?'primary':''} disabled={disabled||!state.ready} aria-label={'验收里程碑：'+m.title} onClick={()=>onReview(m.id)}><CheckCircle2 size={16}/>确认阶段验收</button></>}
    </article>;
  })}</div>;
}

export function MilestoneReview({store,milestone,disabled,onConfirm}:{store:ProjectScheduleStore;milestone:ProductionMilestone;disabled:boolean;onConfirm:(note:string)=>void}) {
  const [note,setNote]=useState(''),state=milestoneAcceptance(store,milestone.id);
  return <form onSubmit={e=>{e.preventDefault();if(!disabled&&state.ready&&milestone.status!=='已验收')onConfirm(note);}}>
    <h4>{milestone.title}</h4><p className="sch-review-hint" role="status">{state.ready?`全部 ${state.total} 项制作任务已完成，请核对成果后确认。`:'任务状态已变化，完成全部制作任务后才能验收。'}</p>
    <p className="sch-acceptance">验收条件：{milestone.acceptance||'尚未填写'}</p>
    <div className="sch-review-tasks">{state.tasks.map(t=><details key={t.id}><summary>{t.title} · {t.status}</summary><p>{t.result||'尚未填写任务验收结果'}</p></details>)}</div>
    <label className="sch-field">本次验收说明<textarea aria-label="本次验收说明" value={note} maxLength={2000} onChange={e=>setNote(e.target.value)} placeholder="补充实测结果或遗留事项（可选），确认时会追加日期与验收记录。"/></label>
    <div className="sch-dialog-actions"><button className="primary" disabled={disabled||!state.ready||milestone.status==='已验收'}>确认验收通过</button></div>
  </form>;
}
