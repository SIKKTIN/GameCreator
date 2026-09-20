import { useEffect, useRef, useState } from 'react';
import { beforeLogoutEvent } from './auth';
import type { SavedProject } from './project-catalog';
import type { SchedulePublication } from './team-schedule-model';
import { readLocalSchedule } from './team-schedule-publish';
import { leaveTeamEvent, teamRequest, type TeamProject, type TeamPublication, type TeamSession } from './team-api';
import { checkPublicationSize, type PublicationSource } from './team-publish';
import { workspaceStorage } from './workspace-storage';

export function SchedulePublicationPreview({schedule}:{schedule:SchedulePublication}) {
  return <details className="team-publication-preview"><summary>查看项目排期（{schedule.store.tasks.length} 个任务、{schedule.store.milestones.length} 个里程碑）</summary><div>
    <p>保留任务和里程碑标识、计划与实际日期、负责人、前置依赖和验收记录。未接入模块的关联仅保留来源说明。</p>
    {schedule.store.milestones.map(m=><details key={m.id}><summary>{m.title} · {m.owner||'未分配'} · {m.due||'未定'}</summary><p>{m.description}</p><p>验收：{m.acceptance||'待填写'} · {m.review}</p></details>)}
    {schedule.store.tasks.map(t=><details key={t.id}><summary>{t.title} · {t.owner||'未分配'} · {t.status}</summary><p>{t.start||'未定'} → {t.end||'未定'}</p><p>{t.description}</p><p>验收：{t.acceptance||'待填写'} · {t.result}</p><p>前置任务：{t.dependencyIds.map(id=>schedule.store.tasks.find(d=>d.id===id)?.title||id).join('、')||'无'}</p></details>)}
  </div></details>;
}
export function ScheduleSupplementDialog({session,project,source,target,onClose,onDone}:{session:TeamSession;project:SavedProject;source:PublicationSource;target:TeamProject;onClose:()=>void;onDone:(p:TeamProject)=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),operating=useRef(false),alive=useRef(true);
  const read=()=>{try{return {preview:readLocalSchedule(workspaceStorage,project),error:''};}catch(reason){return {preview:null,error:(reason as Error).message};}};
  const [snapshot,setSnapshot]=useState(read),[error,setError]=useState(''),[busy,setBusy]=useState(false),[already,setAlready]=useState(false);
  useEffect(()=>{alive.current=true;dialog.current?.showModal();return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    const guard=(event:Event)=>{if(operating.current)event.preventDefault();};
    const unload=(event:BeforeUnloadEvent)=>{if(operating.current){event.preventDefault();event.returnValue='';}};
    window.addEventListener(beforeLogoutEvent,guard);window.addEventListener(leaveTeamEvent,guard);window.addEventListener('beforeunload',unload);
    return()=>{window.removeEventListener(beforeLogoutEvent,guard);window.removeEventListener(leaveTeamEvent,guard);window.removeEventListener('beforeunload',unload);};
  },[]);
  const submit=async()=>{
    if(operating.current||!snapshot.preview)return;
    operating.current=true;setBusy(true);setError('');
    try{
      const {publication}=await teamRequest<{publication:TeamPublication|null}>(session.url,'/publications/lookup',session.token,'POST',source);
      if(!alive.current)return;
      if(!publication||publication.project.id!==target.id)throw new Error('发布记录已变化，请重新打开发布窗口。');
      if(publication.scheduleInitialized){setAlready(true);throw new Error('团队项目排期已开始编辑，不能再用本地内容覆盖。');}
      if(readLocalSchedule(workspaceStorage,project).signature!==snapshot.preview.signature)throw new Error('本地项目排期已变化，请重新读取预览后提交。');
      const body={...source,schedule:snapshot.preview.schedule};checkPublicationSize(JSON.stringify(body));
      const value=await teamRequest<TeamPublication>(session.url,'/publications/schedule',session.token,'POST',body);
      if(alive.current)onDone(value.project);
    }catch(reason){if(alive.current)setError((reason as Error).message);}finally{operating.current=false;if(alive.current)setBusy(false);}
  };
  return <dialog ref={dialog} className="team-dialog team-project-dialog team-publish-dialog" aria-label="补充项目排期" onCancel={event=>{event.preventDefault();if(!operating.current)onClose();}}>
    <div className="team-publish-content"><h2>补充项目排期</h2><p>来源：{project.name} → 协作项目：{target.name}</p><p>仅向没有团队里程碑和排期的项目一次性补充。已有的团队里程碑直接在排期中继续维护。</p>
    {snapshot.preview&&<SchedulePublicationPreview schedule={snapshot.preview.schedule}/>}
    {(error||snapshot.error)&&<p className="team-message" role="alert">{error||snapshot.error}</p>}
    {!already&&(error||snapshot.error)&&<button disabled={busy} onClick={()=>{setSnapshot(read());setError('');}}>重新读取项目排期预览</button>}</div>
    <div className="team-dialog-actions"><button disabled={busy} onClick={onClose}>取消</button>{already?<button className="primary" onClick={()=>onDone(target)}>进入协作项目</button>
      :<button className="primary" disabled={busy||!snapshot.preview} onClick={()=>void submit()}>{busy?'正在补充…':'确认补充项目排期'}</button>}</div>
  </dialog>;
}
