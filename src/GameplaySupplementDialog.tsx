import { useEffect, useRef, useState } from 'react';
import { beforeLogoutEvent } from './auth';
import type { SavedProject } from './project-catalog';
import { gameplaySections, type GameplayPublication } from './team-gameplay-model';
import { readLocalGameplay } from './team-gameplay-publish';
import { leaveTeamEvent, teamRequest, type TeamProject, type TeamPublication, type TeamSession } from './team-api';
import { checkPublicationSize, type PublicationSource } from './team-publish';
import { workspaceStorage } from './workspace-storage';

export function GameplayPublicationPreview({gameplay}:{gameplay:GameplayPublication}) {
  return <details className="team-publication-preview"><summary>查看玩法设计（{gameplay.store.designs.length} 份文档）</summary><div>
    <p>包含设计说明、玩法关联、条件规则、状态流程、空间布局、时间轴，以及分类、标签和验证记录。房间初始排布保留，发布后各自调整。</p>
    {gameplay.store.designs.map(d=><details key={d.id}><summary>{d.title} · {d.status}{d.archived?' · 已归档':''}</summary>{gameplaySections(d,gameplay.store).map(s=><details key={s.label}><summary>{s.label}</summary><pre>{s.text}</pre></details>)}</details>)}
    {gameplay.references.some(r=>r.kind!=='story')&&<p>功能、素材和配置的引用保留名称与标识，对应模块尚未接入协作。</p>}
  </div></details>;
}
export function GameplaySupplementDialog({session,project,source,target,onClose,onDone}:{session:TeamSession;project:SavedProject;source:PublicationSource;target:TeamProject;onClose:()=>void;onDone:(p:TeamProject)=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),operating=useRef(false),alive=useRef(true);
  const read=()=>{try{return {preview:readLocalGameplay(workspaceStorage,project),error:''};}catch(reason){return {preview:null,error:(reason as Error).message};}};
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
      if(publication.gameplayInitialized){setAlready(true);throw new Error('团队玩法设计已开始编辑，不能再用本地内容覆盖。');}
      if(readLocalGameplay(workspaceStorage,project).signature!==snapshot.preview.signature)throw new Error('本地玩法设计已变化，请重新读取预览后提交。');
      const body={...source,gameplay:snapshot.preview.gameplay};checkPublicationSize(JSON.stringify(body));
      const value=await teamRequest<TeamPublication>(session.url,'/publications/gameplay',session.token,'POST',body);
      if(alive.current)onDone(value.project);
    }catch(reason){if(alive.current)setError((reason as Error).message);}finally{operating.current=false;if(alive.current)setBusy(false);}
  };
  return <dialog ref={dialog} className="team-dialog team-project-dialog team-publish-dialog" aria-label="补充玩法设计" onCancel={event=>{event.preventDefault();if(!operating.current)onClose();}}>
    <div className="team-publish-content"><h2>补充玩法设计</h2><p>来源：{project.name} → 协作项目：{target.name}</p><p>向尚未启用玩法设计的协作项目一次性补充。开始编辑后将关闭此入口。</p>
    {snapshot.preview&&<GameplayPublicationPreview gameplay={snapshot.preview.gameplay}/>}
    {(error||snapshot.error)&&<p className="team-message" role="alert">{error||snapshot.error}</p>}
    {!already&&(error||snapshot.error)&&<button disabled={busy} onClick={()=>{setSnapshot(read());setError('');}}>重新读取玩法设计预览</button>}</div>
    <div className="team-dialog-actions"><button disabled={busy} onClick={onClose}>取消</button>{already?<button className="primary" onClick={()=>onDone(target)}>进入协作项目</button>
      :<button className="primary" disabled={busy||!snapshot.preview} onClick={()=>void submit()}>{busy?'正在补充…':'确认补充玩法设计'}</button>}</div>
  </dialog>;
}
