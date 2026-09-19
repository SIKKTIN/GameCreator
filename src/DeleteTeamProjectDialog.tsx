import { useCallback, useEffect, useRef, useState } from 'react';
import { beforeLogoutEvent } from './auth';
import { leaveTeamEvent, teamRequest, TeamError, type TeamSession } from './team-api';

type Preview = {project:{id:string;name:string};deleted:boolean;deletedAt?:string;version?:string;counts?:{members:number;stories:number;history:number;overview:number;milestones:number;graphs:number}};
export function DeleteTeamProjectDialog({session,project,onClose,onDeleted}:{session:TeamSession;project:{id:string;name:string};onClose:()=>void;onDeleted:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),alive=useRef(true),operating=useRef(false);
  const [preview,setPreview]=useState<Preview|null>(null),[confirmation,setConfirmation]=useState('');
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[stale,setStale]=useState(false);
  const route=`/admin/projects/${encodeURIComponent(project.id)}`;
  const load=useCallback(async()=>{
    setLoading(true);setError('');setConfirmation('');
    try{const value=await teamRequest<Preview>(session.url,route,session.token);if(alive.current){setPreview(value);setStale(false);}}
    catch(reason){if(alive.current){setError((reason as Error).message);setStale(true);}}
    finally{if(alive.current)setLoading(false);}
  },[session.url,session.token,route]);
  useEffect(()=>{alive.current=true;dialog.current?.showModal();void load();return()=>{alive.current=false;};},[load]);
  useEffect(()=>{
    const guard=(event:Event)=>{if(operating.current)event.preventDefault();};
    const unload=(event:BeforeUnloadEvent)=>{if(operating.current){event.preventDefault();event.returnValue='';}};
    window.addEventListener(beforeLogoutEvent,guard);window.addEventListener(leaveTeamEvent,guard);window.addEventListener('beforeunload',unload);
    return()=>{window.removeEventListener(beforeLogoutEvent,guard);window.removeEventListener(leaveTeamEvent,guard);window.removeEventListener('beforeunload',unload);};
  },[]);
  const remove=async()=>{
    if(operating.current||loading||stale||!preview||preview.deleted||!preview.version||confirmation!==preview.project.name)return;
    operating.current=true;setBusy(true);setError('');
    try{
      await teamRequest(session.url,route,session.token,'DELETE',{confirmName:confirmation,version:preview.version});
      if(alive.current)onDeleted();
    }catch(reason){if(alive.current){setError(reason instanceof TeamError&&reason.status===0?'删除结果尚未确认。请重新核对项目状态，避免误操作。':(reason as Error).message);setStale(true);setConfirmation('');}}
    finally{operating.current=false;if(alive.current)setBusy(false);}
  };
  const counts=preview?.counts;
  return <dialog ref={dialog} className="team-dialog team-project-dialog delete-team-project-dialog" aria-label="删除协作项目" onCancel={event=>{event.preventDefault();if(!operating.current)onClose();}}>
    <form onSubmit={event=>{event.preventDefault();void remove();}}><h2>删除协作项目</h2>
      <p>服务器：{session.url}</p><p>项目：<strong>{preview?.project.name??project.name}</strong></p><p className="delete-project-id">项目标识：<code>{project.id}</code></p>
      {loading?<p role="status">正在核对删除范围…</p>:preview?.deleted?<p role="status">此协作项目已删除，删除时间：{new Date(preview.deletedAt!).toLocaleString('zh-CN')}。</p>:counts&&<>
        <p className="team-message">将永久删除此项目的团队内容及成员配置，所有协作者将无法继续访问。此操作不能撤销。</p>
        <ul><li>{counts.stories} 篇故事文档、{counts.history} 条文档历史</li><li>{counts.graphs} 个玩法核心流程</li><li>{counts.overview} 份项目概览、{counts.milestones} 个里程碑</li><li>{counts.members} 位成员的项目配置及项目动态</li></ul>
        <p>原本地项目、各客户端未提交草稿和个人布局保留；账号及其他协作项目不受影响。</p>
        <label>输入完整项目名称确认<input aria-label="删除确认项目名称" value={confirmation} disabled={busy||stale} autoComplete="off" onChange={event=>setConfirmation(event.target.value)}/></label>
      </>}
      {error&&<p className="team-message" role="alert">{error}</p>}
      {stale&&<button type="button" disabled={busy||loading} onClick={()=>void load()}>重新核对删除范围</button>}
      <div className="team-dialog-actions"><button type="button" disabled={busy} onClick={onClose}>取消</button>{preview?.deleted?<button type="button" onClick={onDeleted}>完成并刷新列表</button>:
        <button className="delete-project-button" disabled={busy||loading||stale||!preview||confirmation!==preview.project.name}>{busy?'正在删除…':'确认删除协作项目'}</button>}</div>
    </form>
  </dialog>;
}
