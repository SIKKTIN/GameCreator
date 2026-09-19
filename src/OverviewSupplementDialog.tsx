import { useEffect, useRef, useState } from 'react';
import { beforeLogoutEvent } from './auth';
import { readLocalOverview, overviewLabels, type OverviewPublication } from './overview-model';
import type { SavedProject } from './project-catalog';
import { leaveTeamEvent, teamRequest, type TeamProject, type TeamPublication, type TeamSession } from './team-api';
import type { PublicationSource } from './team-publish';
import { workspaceStorage } from './workspace-storage';

export function OverviewPublicationPreview({overview}:{overview:OverviewPublication}) {
  return <details className="team-publication-preview"><summary>查看项目概览（{overview.milestones.length} 个里程碑）</summary><div>
    <dl>{Object.entries(overview.info).map(([key,value])=><div key={key}><dt>{overviewLabels[key as keyof typeof overviewLabels]}</dt><dd>{value||'未填写'}</dd></div>)}</dl>
    {overview.milestones.map((item,index)=><p key={index}><strong>{item.title}</strong> · {item.owner||'未指定负责人'} · {item.due||'未指定日期'} · {{planned:'计划中',active:'进行中',done:'已完成'}[item.status]}</p>)}
  </div></details>;
}
export function OverviewSupplementDialog({session,project,source,target,onClose,onDone}:{
  session:TeamSession;project:SavedProject;source:PublicationSource;target:TeamProject;onClose:()=>void;onDone:(project:TeamProject)=>void;
}) {
  const dialog=useRef<HTMLDialogElement>(null),operating=useRef(false),alive=useRef(true);
  const read=()=>{try{return {preview:readLocalOverview(workspaceStorage,project),error:''};}catch(reason){return {preview:null,error:(reason as Error).message};}};
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
      if(publication.overviewInitialized){setAlready(true);throw new Error('团队概览已初始化，请进入协作项目查看，不能再用本地内容覆盖。');}
      if(readLocalOverview(workspaceStorage,project).signature!==snapshot.preview.signature)throw new Error('本地概览已变化，请重新读取预览后提交。');
      const value=await teamRequest<TeamPublication>(session.url,'/publications/overview',session.token,'POST',{...source,overview:{info:snapshot.preview.info,milestones:snapshot.preview.milestones}});
      if(alive.current)onDone(value.project);
    }catch(reason){if(alive.current)setError((reason as Error).message);}finally{operating.current=false;if(alive.current)setBusy(false);}
  };
  return <dialog ref={dialog} className="team-dialog team-project-dialog" aria-label="补充项目概览" onCancel={event=>{event.preventDefault();if(!operating.current)onClose();}}>
    <h2>补充项目概览</h2><p>来源：{project.name} → 协作项目：{target.name}</p><p>只补充基本信息和里程碑。保留协作项目当前名称、成员、故事及历史；团队概览一旦开始编辑，就不再允许补充。</p>
    {snapshot.preview&&<OverviewPublicationPreview overview={{info:{...snapshot.preview.info,name:target.name},milestones:snapshot.preview.milestones}}/>}
    {(error||snapshot.error)&&<p className="team-message" role="alert">{error||snapshot.error}</p>}
    {!already&&(error||snapshot.error)&&<button disabled={busy} onClick={()=>{setSnapshot(read());setError('');}}>重新读取概览预览</button>}
    <div className="team-dialog-actions"><button disabled={busy} onClick={onClose}>取消</button>{already?<button className="primary" onClick={()=>onDone(target)}>进入协作项目</button>
      :<button className="primary" disabled={busy||!snapshot.preview} onClick={()=>void submit()}>{busy?'正在补充…':'确认补充概览'}</button>}</div>
  </dialog>;
}
