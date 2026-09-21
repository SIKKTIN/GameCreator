import {usePublishSearch} from './GlobalSearch';
import {useEffect,useRef,useState} from 'react';
import {beforeLogoutEvent} from './auth';
import {ProjectSchedule} from './ProjectSchedule';
import {validateProjectSchedule,type ScheduleSources} from './project-schedule';
import {applyScheduleChanges,emptyScheduleSnapshot,reconcileSchedule,scheduleChanges,scheduleDiff,scheduleRecords,scheduleStructureErrors,validateScheduleDraft,type ScheduleDraft,type ScheduleSnapshot} from './team-schedule-model';
import {canEditModule,leaveTeamEvent,teamRequest,TeamError,type TeamCapabilities,type TeamRole,type TeamSession} from './team-api';
import {workspaceStorage} from './workspace-storage';
import type {ProjectScheduleController} from './useProjectSchedule';
import type {GameplayDesign} from './gameplay';

type Response=ScheduleSnapshot&{role:TeamRole;capabilities:TeamCapabilities};
export function TeamProjectSchedule({session,projectId,blocked,designs=[],onOpenGameplay,onDenied}:{session:TeamSession;projectId:string;blocked:boolean;designs?:GameplayDesign[];onOpenGameplay:(id:string)=>void;onDenied:(status?:number)=>void}) {
  const key=`gamecreator.team-draft.v1:${session.serverId}:${session.user.id}:${projectId}:project-schedule`,route=`/projects/${encodeURIComponent(projectId)}/schedule`;
  const [initial]=useState(()=>{try{const raw=workspaceStorage.getItem(key),value=raw?JSON.parse(raw):null;return {draft:value?validateScheduleDraft(value):{base:emptyScheduleSnapshot(),store:emptyScheduleSnapshot().store},restored:!!value,error:''};}catch(e){return {draft:{base:emptyScheduleSnapshot(),store:emptyScheduleSnapshot().store},restored:false,error:'排期草稿读取失败，已停止写入：'+String(e)};}});
  const [draft,setDraft]=useState<ScheduleDraft>(initial.draft),current=useRef(draft);
  const [response,setResponse]=useState<Response>(),[loaded,setLoaded]=useState(false),[saving,setSaving]=useState(false);
  const [error,setError]=useState(''),[diskError,setDiskError]=useState(initial.error),[syncError,setSyncError]=useState('');
  const [conflict,setConflict]=useState<{remote:ScheduleSnapshot;ids:string[]}|null>(null);
  const [history,setHistory]=useState<{id:string;kind:string;fields:unknown;revision:number;updatedAt:string;updatedBy:string}[]|null>(null),[historyBusy,setHistoryBusy]=useState(false);
  const alive=useRef(true),savingRef=useRef(false),generation=useRef(0),request=useRef<{signature:string;id:string}|null>(null),deniedCallback=useRef(onDenied);deniedCallback.current=onDenied;
  const dirty=scheduleChanges(draft.base,draft.store).length>0,readOnly=blocked||!loaded||!response||!canEditModule(session,response.role,response.capabilities,'schedule');
  const persist=(next:ScheduleDraft)=>{if(initial.error)return false;try{const raw=JSON.stringify(scheduleChanges(next.base,next.store).length?next:null);if(workspaceStorage.getItem(key)!==raw)workspaceStorage.setItem(key,raw);setDiskError('');return true;}catch(e){setDiskError('草稿尚未写入本机，请保持窗口打开：'+String(e));return false;}};
  const change=(next:ScheduleDraft)=>{current.current=next;setDraft(next);persist(next);};
  const receive=(remote:Response)=>{
    setResponse(remote);setLoaded(true);if(initial.error)return;
    const result=reconcileSchedule(current.current,remote);
    if(result.conflicts.length)setConflict({remote,ids:result.conflicts});
    else {change(result.draft);setConflict(null);if(!scheduleChanges(result.draft.base,result.draft.store).length)setError('');}
  };
  useEffect(()=>{
    alive.current=true;let active=true,timer:number;
    const poll=async()=>{const started=generation.current;try{if(!savingRef.current){const value=await teamRequest<Response>(session.url,route,session.token);if(active&&started===generation.current&&!savingRef.current){receive(value);setSyncError('');}}}catch(e){if(active){setSyncError((e as Error).message);if(e instanceof TeamError&&[401,403,410].includes(e.status)){setResponse(undefined);setHistory(null);deniedCallback.current(e.status);}}}finally{if(active)timer=window.setTimeout(poll,2000);}};
    void poll();return()=>{active=false;alive.current=false;window.clearTimeout(timer);};
  },[session,projectId]);
  useEffect(()=>{
    const mustStay=saving||!!diskError&&!initial.error,guard=(e:Event)=>{if(mustStay)e.preventDefault();},unload=(e:BeforeUnloadEvent)=>{if(mustStay){e.preventDefault();e.returnValue='';}};
    window.addEventListener(leaveTeamEvent,guard);window.addEventListener(beforeLogoutEvent,guard);window.addEventListener('beforeunload',unload);
    return()=>{window.removeEventListener(leaveTeamEvent,guard);window.removeEventListener(beforeLogoutEvent,guard);window.removeEventListener('beforeunload',unload);};
  },[saving,diskError]);
  const save=async()=>{
    if(readOnly||savingRef.current||conflict||initial.error||!dirty)return;
    savingRef.current=true;++generation.current;setSaving(true);setError('');
    const changes=scheduleChanges(current.current.base,current.current.store),signature=JSON.stringify(changes);
    if(request.current?.signature!==signature)request.current={signature,id:crypto.randomUUID()};
    try{const value=await teamRequest<Response>(session.url,route,session.token,'PUT',{changes,requestId:request.current.id});if(alive.current){change({base:value,store:value.store});setResponse(value);setConflict(null);setHistory(null);}}
    catch(e){if(alive.current){setError((e as Error).message);if(e instanceof TeamError){if(e.status===409&&e.currentRecord)receive({...e.currentRecord as ScheduleSnapshot,role:response!.role,capabilities:response!.capabilities});if([401,403,410].includes(e.status))setResponse(undefined);}}}
    finally{savingRef.current=false;++generation.current;if(alive.current)setSaving(false);}
  };
  usePublishSearch('schedule',response?.store,'schedule',syncError||(!loaded?'项目排期正在加载':''),!blocked&&loaded&&!!response);
  const controller:ProjectScheduleController={store:draft.store,pending:dirty,blocked:readOnly||saving||!!initial.error,error:'',reload:()=>false,retry:()=>persist(current.current),update:operation=>{if(readOnly||savingRef.current||initial.error)return false;try{const next=validateProjectSchedule(operation(structuredClone(current.current.store)));change({...current.current,store:next});setError('');return true;}catch(e){setError((e as Error).message);return false;}}};
  const sources:ScheduleSources={gameplay:designs.map(d=>({id:d.id,name:d.title,status:d.status,unavailable:d.archived})),capability:[],requirement:[],asset:[],map:[],prototype:[]};
  for(const r of draft.base.references)if(!sources[r.kind].some(s=>s.id===r.targetId))sources[r.kind].push({id:r.targetId,name:r.name,unavailable:true,status:r.kind==='gameplay'?'团队来源已删除':'来源模块尚未接入协作'});
  const exportDraft=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(current.current,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='project-schedule-team-draft.json';link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const row=(store:ScheduleDraft['store'],id:string)=>scheduleRecords(store).find(r=>r.id===id);
  return <section className="team-schedule" aria-label="团队项目排期">
    <div className="team-editor-heading"><p>按任务和里程碑分别检查版本 · 每 2 秒同步团队更新</p><div className="team-actions">{dirty&&<button onClick={exportDraft}>导出团队排期草稿</button>}<button disabled={blocked||historyBusy} onClick={async()=>{setHistoryBusy(true);try{const r=await teamRequest<{history:NonNullable<typeof history>}>(session.url,route+'/history',session.token);if(alive.current)setHistory(r.history);}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setHistoryBusy(false);}}}>排期修改历史</button><button className="team-primary" disabled={readOnly||saving||!dirty||!!conflict||!!initial.error} onClick={()=>void save()}>{saving?'正在提交…':'保存排期到团队'}</button></div></div>
    <p role="status" data-testid="schedule-save-state" className={'team-schedule-state'+(dirty?' pending':'')}>{!loaded?'正在读取项目排期…':readOnly?'项目排期只读':dirty?'排期草稿已保存在本机 · 尚未提交到团队':'项目排期已与团队同步'}</p>
    {readOnly&&dirty&&<p>这里保留了你的未提交草稿，恢复编辑权限后可以继续处理。</p>}
    {(error||diskError||syncError)&&<div className="team-message" role="alert">{error||diskError||syncError}{diskError&&!initial.error&&<button onClick={()=>persist(current.current)}>重试保存排期草稿</button>}</div>}
    {conflict&&!blocked&&<section className="team-conflict" aria-label="排期冲突"><h2>任务或里程碑已有团队修改</h2><p>你的草稿已保留。核对差异后继续编辑并提交；新增依赖可能需要一并调整。</p>{conflict.ids.map(id=><details key={id} open><summary>{row(draft.store,id)?.title||row(conflict.remote.store,id)?.title||row(draft.base.store,id)?.title||id} · 团队版本 {conflict.remote.versions[id]??0}</summary><div className="team-core-diff"><div><strong>我的修改</strong>{scheduleDiff(row(draft.base.store,id),row(draft.store,id)).map((s,i)=><p key={i}>{s}</p>)}</div><div><strong>团队修改</strong>{scheduleDiff(row(draft.base.store,id),row(conflict.remote.store,id)).map((s,i)=><p key={i}>{s}</p>)}</div></div></details>)}<div className="team-actions"><button disabled={readOnly||saving} onClick={()=>{try{const store=applyScheduleChanges(conflict.remote.store,scheduleChanges(current.current.base,current.current.store)),old=new Set(scheduleStructureErrors(conflict.remote.store));if(scheduleStructureErrors(store).some(e=>!old.has(e)))throw new Error('请先处理已失效的前置任务、里程碑或循环依赖。');change({base:conflict.remote,store});setConflict(null);setError('');}catch(e){setError((e as Error).message);}}}>已对照合并，准备提交排期</button><button disabled={saving||!!initial.error} onClick={()=>{if(window.confirm('确定丢弃本机排期草稿，采用团队最新内容？')){change({base:conflict.remote,store:conflict.remote.store});setConflict(null);setError('');}}}>采用团队排期并丢弃草稿</button></div></section>}
    {history&&!blocked&&<section className="overview-panel" aria-label="排期历史"><div className="team-overview-heading"><h3>最近排期修改</h3><button onClick={()=>setHistory(null)}>关闭排期历史</button></div>{!history.length&&<p>暂无排期历史</p>}{history.map(h=><details key={h.id+':'+h.revision}><summary>{(h.fields as {title:string}|null)?.title||'已删除的'+(h.kind==='task'?'任务':'里程碑')} · 版本 {h.revision} · {h.updatedBy} · {new Date(h.updatedAt).toLocaleString('zh-CN')}</summary><div>{scheduleDiff(undefined,h.fields as ReturnType<typeof row>).map((line,i)=><p key={i}>{line}</p>)}</div></details>)}</section>}
    {!blocked&&(loaded||initial.restored)&&<ProjectSchedule controller={controller} sources={sources} onOpenReference={r=>{if(r.kind==='gameplay')onOpenGameplay(r.targetId);}} statusLabel={dirty?'草稿在本机，等待提交到团队':readOnly?'只读':'已与团队同步'}/>}
  </section>;
}
