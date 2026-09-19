import { useEffect, useRef, useState } from 'react';
import { beforeLogoutEvent } from './auth';
import type { SavedProject } from './project-catalog';
import type { CorePublication } from './team-core-model';
import { readLocalCore } from './team-core-publish';
import { leaveTeamEvent, teamRequest, type TeamProject, type TeamPublication, type TeamSession } from './team-api';
import { checkPublicationSize, type PublicationSource } from './team-publish';
import { workspaceStorage } from './workspace-storage';

export function CorePublicationPreview({core}:{core:CorePublication}) {
  return <details className="team-publication-preview"><summary>查看玩法核心（{core.store.graphs.length} 个流程）</summary><div>
    {core.store.graphs.map(g => <details key={g.id}><summary>{g.title} · {g.nodes.length} 个节点 · {g.edges.length} 条连线</summary><p>{g.summary}</p>
      {g.nodes.map(n => <p key={n.id}>{n.title} · {n.description}{n.gameplayIds.length > 0 && ' · 来源玩法：' + n.gameplayIds.map(id => core.references.find(r => r.id === id)?.title || id).join('、')}</p>)}</details>)}
    <p>保留模块层级、连线、说明和初始布局。发布后每位成员独立调整布局；来源玩法设计保留名称与标识。</p>
  </div></details>;
}
export function CoreSupplementDialog({session,project,source,target,onClose,onDone}:{session:TeamSession;project:SavedProject;source:PublicationSource;target:TeamProject;onClose:()=>void;onDone:(p:TeamProject)=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),operating=useRef(false),alive=useRef(true);
  const read=()=>{try{return {preview:readLocalCore(workspaceStorage,project.id),error:''};}catch(reason){return {preview:null,error:(reason as Error).message};}};
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
      if(publication.coreInitialized){setAlready(true);throw new Error('团队玩法核心已开始编辑，不能再用本地内容覆盖。');}
      if(readLocalCore(workspaceStorage,project.id).signature!==snapshot.preview.signature)throw new Error('本地玩法核心已变化，请重新读取预览后提交。');
      const body={...source,core:snapshot.preview.core};checkPublicationSize(JSON.stringify(body));
      const value=await teamRequest<TeamPublication>(session.url,'/publications/core',session.token,'POST',body);
      if(alive.current)onDone(value.project);
    }catch(reason){if(alive.current)setError((reason as Error).message);}finally{operating.current=false;if(alive.current)setBusy(false);}
  };
  return <dialog ref={dialog} className="team-dialog team-project-dialog team-publish-dialog" aria-label="补充玩法核心" onCancel={event=>{event.preventDefault();if(!operating.current)onClose();}}>
    <div className="team-publish-content"><h2>补充玩法核心</h2><p>来源：{project.name} → 协作项目：{target.name}</p><p>向尚未启用玩法核心的协作项目一次性补充。开始编辑后将关闭此入口。</p>
    {snapshot.preview&&<CorePublicationPreview core={snapshot.preview.core}/>}
    {(error||snapshot.error)&&<p className="team-message" role="alert">{error||snapshot.error}</p>}
    {!already&&(error||snapshot.error)&&<button disabled={busy} onClick={()=>{setSnapshot(read());setError('');}}>重新读取玩法核心预览</button>}</div>
    <div className="team-dialog-actions"><button disabled={busy} onClick={onClose}>取消</button>{already?<button className="primary" onClick={()=>onDone(target)}>进入协作项目</button>
      :<button className="primary" disabled={busy||!snapshot.preview} onClick={()=>void submit()}>{busy?'正在补充…':'确认补充玩法核心'}</button>}</div>
  </dialog>;
}
