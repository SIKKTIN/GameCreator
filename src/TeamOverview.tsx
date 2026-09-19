import { useEffect, useRef, useState } from 'react';
import { normalizeInfo, normalizeMilestone, overviewLabels, overviewLimits, milestoneLabels, type OverviewInfo, type MilestoneFields, type TeamRecord } from './overview-model';
import { canLeaveTeam, canEditModule, roleLabels, teamRequest, TeamError, type TeamCapabilities, type TeamRole, type TeamSession } from './team-api';
import { workspaceStorage } from './workspace-storage';
import { useTeamRecord } from './useTeamRecord';
import './team-overview.css';

type OverviewData = { info:TeamRecord<OverviewInfo>; milestones:TeamRecord<MilestoneFields>[]; role:TeamRole; capabilities?: TeamCapabilities;
  activity:{id:number;title:string;actor:string;createdAt:string}[] };
export function TeamOverview({ session,projectId,members,onMembers,onDenied,blocked=false }: {
  session:TeamSession;projectId:string;members:{username:string;role:TeamRole}[];onMembers:()=>void;onDenied:()=>void;blocked?:boolean;
}) {
  const [data,setData] = useState<OverviewData|null>(null),[error,setError] = useState(''),[denied,setDenied] = useState(false),[refresh,setRefresh] = useState(0);
  const writable = !blocked && !denied && !!data && canEditModule(session,data.role,data.capabilities,'overview');
  const prefix = `gamecreator.team-draft.v1:${session.serverId}:${session.user.id}:${projectId}:overview`, newKey=prefix+':new';
  const [initialNew] = useState(() => {
    try {
      const raw=workspaceStorage.getItem(newKey), value=raw ? JSON.parse(raw) : null;
      if(!value)return {record:null,error:''};
      if(!value.base||!Number.isSafeInteger(value.base.revision)||value.base.revision<0||typeof value.base.id!=='string'||!/^[0-9a-f-]{36}$/.test(value.base.id))throw new Error();
      normalizeMilestone(value.fields,true);
      return {record:{...value.base,fields:normalizeMilestone(value.base.fields,true)} as TeamRecord<MilestoneFields>,error:''};
    } catch { return {record:null,error:'新里程碑草稿格式异常，已保留原存档。请修复后重新进入。'}; }
  });
  const [pending,setPending] = useState<TeamRecord<MilestoneFields>|null>(initialNew.record);
  const [newError,setNewError] = useState(initialNew.error);
  const route=`/projects/${encodeURIComponent(projectId)}`;
  const deniedCallback = useRef(onDenied); deniedCallback.current=onDenied;
  useEffect(() => {
    let active=true,timer:number;
    const poll=async()=>{
      try {
        const next=await teamRequest<OverviewData>(session.url,route+'/overview',session.token);
        if (active) { setData(previous=>!previous ? next : {...next,
          info:previous.info.revision>next.info.revision?previous.info:next.info,
          milestones:next.milestones.map(record=>previous.milestones.find(old=>old.id===record.id && old.revision>record.revision)??record)});setError('');setDenied(false); }
      } catch(reason) { if(active) {setError((reason as Error).message); if(reason instanceof TeamError && [401,403].includes(reason.status)){setDenied(true);deniedCallback.current();}} }
      if(active)timer=window.setTimeout(poll,2000);
    };
    void poll();return()=>{active=false;window.clearTimeout(timer);};
  },[session,route,refresh]);
  const receiveInfo=(record:TeamRecord<OverviewInfo>)=>{setData(current=>current?{...current,info:record}:current);setRefresh(v=>v+1);};
  const receiveMilestone=(record:TeamRecord<MilestoneFields>)=>{
    setData(current=>current?{...current,milestones:[...current.milestones.filter(item=>item.id!==record.id),record]}:current);
    if(pending?.id===record.id)setPending(null);setRefresh(v=>v+1);
  };
  const add=()=>{
    if(!writable || pending || !canLeaveTeam())return;
    try {
      const raw=workspaceStorage.getItem(newKey);
      if(raw && JSON.parse(raw)!==null)throw new Error('新里程碑草稿尚未恢复，请重新进入概览或修复草稿存档。');
      const record:TeamRecord<MilestoneFields>={id:crypto.randomUUID(),fields:{title:'',owner:'',due:'',status:'planned'},revision:0,updatedAt:null,updatedBy:null};
      workspaceStorage.setItem(newKey,JSON.stringify({base:record,fields:record.fields}));setPending(record);setNewError('');
    }catch(reason){setNewError((reason as Error).message);}
  };
  const validPending=pending && typeof pending.id==='string' && /^[0-9a-f-]{36}$/.test(pending.id) && pending.fields && Number.isSafeInteger(pending.revision);
  const complete=data?.milestones.filter(item=>item.fields.status==='done').length??0,total=data?.milestones.length??0;
  return <section className="team-overview" aria-label="协作项目概览">
    {error && <p className="team-message" role="alert">{error}<button onClick={()=>setRefresh(v=>v+1)}>重试读取概览</button></p>}
    {!data && <p>正在读取项目概览…</p>}
    <div hidden={denied}>{data && <>
      <div className="overview-intro"><div><h2>项目概览</h2><p>基本信息和里程碑由团队共享，每 2 秒检查更新。</p></div>
        <div className="overview-progress"><div className="progress-label"><span>里程碑完成率</span><strong>{total?Math.round(complete/total*100):0}%</strong></div>
          <div className="progress-track"><span style={{width:`${total?complete/total*100:0}%`}} /></div><small>{total} 个里程碑 · {complete} 个已完成</small></div></div>
      {!writable && <p className="team-overview-notice">你可以查看项目概览。修改基本信息和里程碑需要项目管理员授权。</p>}
      {!data.info.initialized && <p className="team-overview-notice">团队概览尚未填写。具有概览编辑权限的成员可填写；管理员也可在原本地项目的发布入口补充概览。</p>}
      <div className="team-overview-grid">
        <InfoEditor record={data.info} session={session} route={route+'/overview'} draftKey={prefix+':info'} readOnly={!writable} onSaved={receiveInfo}/>
        <section className="overview-panel"><h3>项目成员</h3><div className="team-overview-members">{members.map(member=><p key={member.username}><strong>{member.username}</strong><span>{roleLabels[member.role]}</span></p>)}</div>
          {data.role==='admin' && <button onClick={()=>{if(canLeaveTeam())onMembers();}}>管理项目成员</button>}</section>
      </div>
      <section className="overview-panel"><div className="team-overview-heading"><h3>关键里程碑</h3>{writable&&<button onClick={add} disabled={!!pending||total>=200}>添加里程碑</button>}</div>
        {newError&&<p className="team-message" role="alert">{newError}</p>}
        {!total&&!pending&&<p>暂无里程碑</p>}
        {pending&&!validPending&&<p className="team-message" role="alert">新里程碑草稿格式异常，已保留原存档。请修复后重新进入。</p>}
        <div className="team-milestone-list">{validPending&&pending&&<MilestoneEditor key={'new:'+pending.id} record={data.milestones.find(item=>item.id===pending.id)??pending} session={session}
          route={route+'/milestones/'+pending.id} draftKey={newKey} readOnly={!writable} onSaved={receiveMilestone}
          onCancel={()=>{if(!canLeaveTeam())return;try{workspaceStorage.setItem(newKey,'null');setPending(null);}catch{setNewError('无法移除本机草稿，请重试。');}}}/>}
          {data.milestones.filter(item=>item.id!==pending?.id).map(record=><MilestoneEditor key={record.id} record={record} session={session} route={route+'/milestones/'+record.id}
            draftKey={prefix+':milestone:'+record.id} readOnly={!writable} onSaved={receiveMilestone}/>)}</div>
      </section>
      <section className="overview-panel"><h3>最近动态</h3>{!data.activity.length?<p>暂无项目动态</p>:<ol className="team-overview-activity">{data.activity.map(item=><li key={item.id}><strong>{item.title}</strong><span>{item.actor} · {new Date(item.createdAt).toLocaleString('zh-CN')}</span></li>)}</ol>}</section>
    </>}</div>
  </section>;
}

type EditorProps<F>={record:TeamRecord<F>;session:TeamSession;route:string;draftKey:string;readOnly:boolean;onSaved:(record:TeamRecord<F>)=>void};
function RecordMessages<F>({ state,labels,readOnly }: {state:ReturnType<typeof useTeamRecord<F>>;labels:Record<string,string>;readOnly:boolean}) {
  return <>
    <p className="team-record-state" role="status">{readOnly?'当前账号只有查看权限':state.saving?'等待服务器确认…':state.dirty?'草稿已保存在本机 · 尚未提交到团队':'与团队内容一致'} · 版本 {state.base.revision}</p>
    {readOnly&&state.dirty&&<p>这里保留了你的本机未提交草稿，尚未写入团队；恢复编辑权限后可以继续处理。</p>}
    {state.base.updatedBy&&<small>最后修改：{state.base.updatedBy} · {state.base.updatedAt&&new Date(state.base.updatedAt).toLocaleString('zh-CN')}</small>}
    {state.diskError&&<p className="team-message" role="alert">{state.diskError}{!state.blocked&&<button type="button" onClick={state.retry}>重试保存草稿</button>}</p>}
    {state.error&&<p className="team-message" role="alert">{state.error}</p>}
    {state.conflict&&<section className="team-conflict" aria-label="内容冲突"><h4>团队已有新版本，你的草稿仍保留</h4>
      <dl>{Object.entries(state.conflict.fields as Record<string,string>).map(([key,value])=><div key={key}><dt>{labels[key]??key}</dt><dd>{key==='status'&&labels===milestoneLabels?({planned:'计划中',active:'进行中',done:'已完成'}[value]??value):value||'未填写'}</dd></div>)}</dl>
      <div className="team-actions"><button type="button" disabled={state.saving||state.blocked||readOnly} onClick={()=>state.resolve(true)}>已合并，准备提交</button>
        <button type="button" disabled={state.saving||state.blocked} onClick={()=>state.resolve(false)}>采用最新版本并丢弃草稿</button></div></section>}
  </>;
}
function InfoEditor(props:EditorProps<OverviewInfo>) {
  const state=useTeamRecord({...props,normalize:normalizeInfo});
  return <form className="overview-panel team-info-editor" aria-label="项目基本信息" onSubmit={event=>{event.preventDefault();void state.save();}}><h3>项目基本信息</h3>
    <fieldset disabled={props.readOnly||state.saving||state.blocked}><div className="field-grid">{(Object.keys(overviewLabels) as (keyof OverviewInfo)[]).map(key=><label key={key} className={key==='description'?'team-field-full':undefined}>
      {overviewLabels[key]}{key==='description'?<textarea aria-label={overviewLabels[key]} maxLength={overviewLimits[key]} value={state.fields[key]} onChange={event=>state.update({...state.fields,[key]:event.target.value})}/>
        :<input required={key==='name'} maxLength={overviewLimits[key]} value={state.fields[key]} onChange={event=>state.update({...state.fields,[key]:event.target.value})}/>}</label>)}</div></fieldset>
    <RecordMessages state={state} labels={overviewLabels} readOnly={props.readOnly}/>
    {!props.readOnly&&<button className="team-primary" disabled={!state.dirty||state.saving||!!state.conflict||state.blocked}>保存基本信息到团队</button>}
  </form>;
}
function MilestoneEditor({onCancel,...props}:EditorProps<MilestoneFields>&{onCancel?:()=>void}) {
  const state=useTeamRecord({...props,normalize:normalizeMilestone});
  return <form className="team-milestone-editor" aria-label={props.record.revision===0?'新里程碑':'里程碑：'+props.record.fields.title} onSubmit={event=>{event.preventDefault();void state.save();}}>
    <fieldset disabled={props.readOnly||state.saving||state.blocked}><div className="field-grid">
      <label>里程碑名称<input required maxLength={160} value={state.fields.title} onChange={event=>state.update({...state.fields,title:event.target.value})}/></label>
      <label>负责人<input maxLength={80} value={state.fields.owner} onChange={event=>state.update({...state.fields,owner:event.target.value})}/></label>
      <label>日期<input maxLength={40} placeholder="例如：2026/10/20" value={state.fields.due} onChange={event=>state.update({...state.fields,due:event.target.value})}/></label>
      <label>里程碑状态<select aria-label="里程碑状态" value={state.fields.status} onChange={event=>state.update({...state.fields,status:event.target.value as MilestoneFields['status']})}><option value="planned">计划中</option><option value="active">进行中</option><option value="done">已完成</option></select></label>
    </div></fieldset><RecordMessages state={state} labels={milestoneLabels} readOnly={props.readOnly}/>
    <div className="team-actions">{!props.readOnly&&<button disabled={!state.dirty||state.saving||!!state.conflict||state.blocked}>保存里程碑到团队</button>}
      {onCancel&&<button type="button" disabled={state.saving} onClick={onCancel}>丢弃新里程碑草稿</button>}</div>
  </form>;
}
