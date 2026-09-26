import {AiDeveloperCreate,AiDeveloperList} from './AiDevelopers';

import {useId,useState} from 'react';
import {Users,Plus,KeyRound,Route,CheckCircle2,X,Minus} from 'lucide-react';
import {positionPresets,positionPresetState,previewPositionPreset,type PositionPresetId,aiPermissionLabels,defaultWorkTeam,positionsOf,positionTasks,taskPositionIds,workAssignees,credentialState,type AiPosition} from '../shared/ai-personnel.mjs';
import {ScheduleRecovery} from './ProjectSchedule';
import type {useProjectSchedule} from './useProjectSchedule';
import {scheduleProgressLayout} from './schedule-progress';
import {useProgressNavigation} from './useProgressNavigation';
import type {ProjectScheduleStore,ProductionTask} from './project-schedule';
import './ai-personnel.css';
type Controller=ReturnType<typeof useProjectSchedule>;
type History=import('../shared/engine-feedback.mjs').FeedbackReceipt[];


export function AiPersonnel({controller:c,projectId,onOpenTask,toolHistory=[],testMode=false}:{controller:Controller;projectId:string;onOpenTask:(id:string)=>void;toolHistory?:History;testMode?:boolean}){
 const [tab,setTab]=useState('positions'),[editing,setEditing]=useState<AiPosition>(),[query,setQuery]=useState(''),[taskId,setTaskId]=useState('');
 const [preset,setPreset]=useState<PositionPresetId>(),[showInactive,setShowInactive]=useState(false);
 const presetState=positionPresetState(c.store);
 const positions=positionsOf(c.store),team=c.store.personnel,blocked=c.blocked||c.pending,task=c.store.tasks.find(t=>t.id===taskId);
 const filtered=positions.filter(p=>(showInactive||p.active||!!query.trim())&&(p.name+p.duties).toLowerCase().includes(query.toLowerCase()));
 const savePosition=(position:AiPosition,taskIds:string[])=>c.update(s=>({...s,personnel:{...(s.personnel||defaultWorkTeam()),positions:positionsOf(s).some(p=>p.id===position.id)?positionsOf(s).map(p=>p.id===position.id?position:p):[...positionsOf(s),position]},tasks:s.tasks.map(t=>{const before=taskPositionIds(s,t),selected=taskIds.includes(t.id);return before.includes(position.id)===selected?t:{...t,positionIds:selected?[...before,position.id]:before.filter(id=>id!==position.id)};})}));
 return <section className="ai-personnel" aria-label="AI 人员分配">
  <div className="ai-heading"><div><span className="gp-kicker">ROLES & WORK</span><h2>先明确岗位工作，再分配给 AI。</h2><p>程序、美术、策划等岗位各有工作清单。创建开发者并签发长期令牌，任务可先留空，也可持续调整。</p></div><button className="primary" disabled={blocked} onClick={()=>setEditing({id:crypto.randomUUID(),name:'',duties:'',active:true,taskKinds:[]})}><Plus size={16}/>添加岗位</button></div>
  <div className="ai-preset-panel"><div><span className="gp-kicker">岗位预设</span><p>当前：{positionPresets.find(p=>p.id===presetState.id)?.name}{presetState.customized?' · 已自定义':''}。可以按项目调整岗位，同一开发者可兼任多个岗位。</p></div><div className="ai-preset-options">{positionPresets.map(p=><button key={p.id} className={presetState.id===p.id?'selected':''} aria-label={'选择岗位预设：'+p.name} disabled={blocked} onClick={()=>setPreset(p.id)}><strong>{p.name} · {p.count} 岗位</strong><span>{p.description}</span></button>)}</div></div>
  <ScheduleRecovery controller={c}/>
  <div className="ai-stats"><div><Users/><strong>{positions.filter(p=>p.active).length}</strong><span>工作岗位</span></div><div><Route/><strong>{c.store.tasks.filter(t=>workAssignees(c.store,t.id,projectId).length).length}/{c.store.tasks.length}</strong><span>任务已分配给 AI</span></div><div><CheckCircle2/><strong>{c.store.tasks.filter(t=>t.status==='待验收').length}</strong><span>待验收任务</span></div><div><KeyRound/><strong>{team?.credentials.filter(k=>credentialState(c.store,k,projectId)==='有效').length||0}</strong><span>有效协作令牌</span></div></div>
  <div className="ar-module-tabs" role="tablist" aria-label="人员分配视图">{[['positions','岗位总览'],['work','岗位任务'],['credentials','协作令牌'],['developers','开发者与令牌']].map(([id,label])=><button role="tab" aria-selected={tab===id} key={id} onClick={()=>setTab(id)}>{label}</button>)}</div>
  {tab==='positions'&&<><div className="ai-toolbar"><input type="search" aria-label="搜索岗位" placeholder="搜索岗位或职责" value={query} onChange={e=>setQuery(e.target.value)}/></div><label className="ai-inactive-toggle"><input type="checkbox" checked={showInactive} onChange={e=>setShowInactive(e.target.checked)}/>显示停用岗位（{positions.filter(p=>!p.active).length}）</label><div className="ai-member-grid">{filtered.map(p=>{const tasks=positionTasks(c.store,p.id),done=tasks.filter(t=>t.status==='已完成').length;return <button className={'ai-member-card'+(!p.active?' inactive':'')} key={p.id} aria-label={'编辑岗位：'+p.name} onClick={()=>setEditing(p)}><div className="ai-member-top"><span className="ai-avatar">{p.name.slice(0,1)}</span><span>{p.active?'启用':'已停用'}</span></div><h3>{p.name}</h3><p>{p.duties||'待补充职责'}</p><div className="ai-work-preview">{tasks.slice(0,3).map(t=><span key={t.id}>{t.title}</span>)}{tasks.length>3&&<small>还有 {tasks.length-3} 项工作</small>}{!tasks.length&&<span>点击岗位添加工作内容</span>}</div><progress max={Math.max(1,tasks.length)} value={done}/><small>{done}/{tasks.length} 已完成 · {tasks.filter(t=>t.status==='进行中').length} 进行中 · {tasks.filter(t=>t.status==='待验收').length} 待验收</small></button>;})}</div>{!filtered.length&&<p className="ai-empty">没有匹配岗位。</p>}</>}
  {tab==='work'&&<><p className="gp-muted">按岗位查看工作线路。点击任务查看内容与执行者；同一任务可属于多个岗位，汇总视图只显示一次。</p><AiWorkBoard store={c.store} projectId={projectId} onOpen={setTaskId}/></>}
  {tab==='credentials'&&<AiDeveloperCreate controller={c} projectId={projectId} testMode={testMode} onCreated={()=>setTab('developers')}/>}
  {tab==='developers'&&<AiDeveloperList controller={c} projectId={projectId} toolHistory={toolHistory} testMode={testMode}/>}
  {preset&&<AiDialog title="切换岗位预设" onClose={()=>setPreset(undefined)}><ScheduleRecovery controller={c}/><PresetPreview store={c.store} preset={preset} disabled={blocked} onCancel={()=>setPreset(undefined)} onApply={()=>{if(c.update(s=>{if(JSON.stringify(s)!==JSON.stringify(c.store))throw new Error('项目排期已变化，请重新查看切换预览');return previewPositionPreset(s,preset).next;}))setPreset(undefined);}}/></AiDialog>}
  {editing&&<AiDialog title={editing.name?'编辑岗位：'+editing.name:'新建岗位'} onClose={()=>setEditing(undefined)}><ScheduleRecovery controller={c}/><PositionEditor key={editing.id} position={editing} store={c.store} disabled={blocked} onSave={(p,ids)=>{if(savePosition(p,ids))setEditing(undefined);}}/></AiDialog>}
  {task&&<AiDialog title="岗位工作详情" onClose={()=>setTaskId('')}><h3>{task.title}</h3><p>{task.description||'尚未填写工作说明'}</p><p>岗位：{taskPositionIds(c.store,task).map(id=>positions.find(p=>p.id===id)?.name||'失效岗位').join('、')||'未归类'}</p><p>验收要求：{task.acceptance||'待填写'}</p><h4>当前执行者</h4>{workAssignees(c.store,task.id,projectId).map(k=><p key={k.id}>{team?.members.find(m=>m.id===k.memberId)?.name} · {k.permissions.map(p=>aiPermissionLabels[p]).join('、')}</p>)}{!workAssignees(c.store,task.id,projectId).length&&<p>尚未分配。到开发者与令牌中分配这项工作。</p>}<button className="gp-secondary" onClick={()=>{setTaskId('');onOpenTask(task.id);}}>查看排期与验收详情</button></AiDialog>}
 </section>;
}
function AiDialog({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}){return <dialog className="gp-dialog ai-dialog" aria-label={title} ref={node=>{if(node&&!node.open)node.showModal();}} onCancel={e=>{e.preventDefault();onClose();}}><div className="gp-card-heading"><h3>{title}</h3><button className="gp-icon" aria-label={'关闭'+title} onClick={onClose}><X/></button></div>{children}</dialog>;}

function PositionEditor({position,store,disabled,onSave}:{position:AiPosition;store:ProjectScheduleStore;disabled:boolean;onSave:(p:AiPosition,ids:string[])=>void}){
 const [draft,setDraft]=useState(position),[ids,setIds]=useState(positionTasks(store,position.id).map(t=>t.id)),[query,setQuery]=useState('');
 const invalid=!draft.name.trim()||positionsOf(store).some(p=>p.id!==position.id&&p.name.trim().toLowerCase()===draft.name.trim().toLowerCase());
 const tasks=store.tasks.filter(t=>(t.title+t.description).toLowerCase().includes(query.toLowerCase()));
 return <form onSubmit={e=>{e.preventDefault();if(!invalid)onSave({...draft,name:draft.name.trim()},ids);}}><fieldset className="ar-fields" disabled={disabled}>
  <label className="gp-field">岗位名称<input aria-label="岗位名称" maxLength={100} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} placeholder="例如：程序、美术、关卡设计"/></label>
  <label className="gp-field">岗位职责<textarea aria-label="岗位职责" rows={4} maxLength={10000} value={draft.duties} onChange={e=>setDraft({...draft,duties:e.target.value})}/></label>
  <label><input type="checkbox" checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked})}/>启用岗位</label>
  <p className="gp-muted">{draft.taskKinds.length?'默认归入'+draft.taskKinds.join('、')+'方向的排期任务，可在下面调整。':'选择该岗位负责的排期任务。'}调整岗位不更改任务完成状态，也不自动给令牌增加任务。</p>
  <h4>工作内容 · 已选 {ids.length} 项</h4><input type="search" aria-label="搜索岗位工作" placeholder="搜索任务" value={query} onChange={e=>setQuery(e.target.value)}/>
  <div className="ai-work-selection">{tasks.map(t=><label key={t.id}><input type="checkbox" aria-label={'岗位工作：'+t.title} checked={ids.includes(t.id)} onChange={e=>setIds(v=>e.target.checked?[...v,t.id]:v.filter(id=>id!==t.id))}/><span><strong>{t.title}</strong><small>{t.kind} · {t.status}</small></span></label>)}</div>
  {!tasks.length&&<p>暂无匹配任务，可在项目排期中新增。</p>}{invalid&&<p role="alert">请输入唯一的岗位名称。</p>}<button className="primary" disabled={invalid}>保存岗位</button>
 </fieldset></form>;
}

function AiWorkBoard({store,projectId,onOpen}:{store:ProjectScheduleStore;projectId:string;onOpen:(id:string)=>void}){
 const [positionId,setPositionId]=useState('all'),[status,setStatus]=useState('all'),[milestone,setMilestone]=useState('all'),positions=positionsOf(store),marker=useId().replace(/:/g,''),{scroll,zoom,setZoom,panning}=useProgressNavigation(!!store.tasks.length);
 const base=scheduleProgressLayout(store.tasks),ranks=new Map(base.nodes.map(n=>[n.task.id,n.column]));
 const visible=store.tasks.filter(t=>(positionId==='all'||(positionId==='none'?!taskPositionIds(store,t).length:taskPositionIds(store,t).includes(positionId)))&&(status==='all'||t.status===status)&&(milestone==='all'||t.milestoneId===milestone));
 const laneFor=(t:ProductionTask)=>positionId!=='all'&&positionId!=='none'?positionId:taskPositionIds(store,t)[0]||'';
 const laneIds=[...new Set([...positions.map(p=>p.id),'',...visible.map(laneFor)])];let y=48;const nodes:{task:ProductionTask;x:number;y:number}[]=[],lanes:{id:string;name:string;top:number;height:number}[]=[];
 for(const id of laneIds){const tasks=visible.filter(t=>laneFor(t)===id);if(!tasks.length)continue;const counts=new Map<number,number>(),top=y;for(const task of tasks){const column=ranks.get(task.id)||0,row=counts.get(column)||0;nodes.push({task,x:200+column*290,y:top+20+row*154});counts.set(column,row+1);}const height=Math.max(1,...counts.values())*154+35;lanes.push({id,name:positions.find(p=>p.id===id)?.name||(id?'失效岗位':'未归类'),top,height});y+=height;}
 const width=Math.max(800,base.columns*290+220),byId=new Map(nodes.map(n=>[n.task.id,n]));
 return <><div className="ai-toolbar"><select aria-label="岗位任务筛选" value={positionId} onChange={e=>setPositionId(e.target.value)}><option value="all">全部岗位</option><option value="none">未归类</option>{positions.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select><select aria-label="分配任务状态筛选" value={status} onChange={e=>setStatus(e.target.value)}>{['all','待开始','进行中','待验收','已完成','受阻'].map(s=><option value={s} key={s}>{s==='all'?'全部状态':s}</option>)}</select><select aria-label="分配里程碑筛选" value={milestone} onChange={e=>setMilestone(e.target.value)}><option value="all">全部里程碑</option>{store.milestones.map(m=><option value={m.id} key={m.id}>{m.title}</option>)}</select><span className="ai-grow"/><small>右键拖动 · 滚轮缩放</small><button aria-label="缩小岗位线路" onClick={()=>setZoom(zoom-.1)}><Minus size={14}/></button><span>{Math.round(zoom*100)}%</span><button aria-label="放大岗位线路" onClick={()=>setZoom(zoom+.1)}><Plus size={14}/></button></div>
 {!nodes.length?<p className="ai-empty">没有匹配任务。可在项目排期新建任务，或调整筛选条件。</p>:<div className={'ai-board'+(panning?' panning':'')} ref={scroll} tabIndex={0} aria-label="岗位任务线路画布"><div className="ai-board-canvas" style={{width,height:y,zoom}}><div className="ai-axis">工作岗位{Array.from({length:base.columns},(_,i)=><span key={i} style={{left:200+i*290}}>{i?'推进阶段 '+(i+1):'起步任务'}</span>)}</div>{lanes.map(l=><div className="ai-lane" key={l.id} style={{top:l.top,height:l.height,width}}><strong>{l.name}</strong></div>)}<svg width={width} height={y} className="ai-lines" aria-hidden="true"><defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#a58bc8"/></marker></defs>{nodes.flatMap(n=>n.task.dependencyIds.flatMap(id=>{const prev=byId.get(id);return prev?[<path key={id+n.task.id} d={`M ${prev.x+245} ${prev.y+62} C ${prev.x+275} ${prev.y+62},${n.x-30} ${n.y+62},${n.x} ${n.y+62}`} markerEnd={'url(#'+marker+')'}/>]:[];}))}</svg>{nodes.map(n=><button key={n.task.id} className={'ai-task-node status-'+n.task.status} aria-label={'岗位任务：'+n.task.title} style={{left:n.x,top:n.y}} onClick={()=>onOpen(n.task.id)}><span>{n.task.kind} · {n.task.status}</span><strong>{n.task.title}</strong><small>{workAssignees(store,n.task.id,projectId).map(k=>store.personnel?.members.find(m=>m.id===k.memberId)?.name).filter((v,i,a)=>a.indexOf(v)===i).join('、')||'待分配执行者'}</small></button>)}</div></div>}</>;
}

function PresetPreview({store,preset,disabled,onCancel,onApply}:{store:ProjectScheduleStore;preset:PositionPresetId;disabled:boolean;onCancel:()=>void;onApply:()=>void}){
 let preview:ReturnType<typeof previewPositionPreset>|undefined,error='';try{preview=previewPositionPreset(store,preset);}catch(e){error=String(e);}
 return <div className="ai-preset-preview"><h4>{positionPresets.find(p=>p.id===preset)?.name}</h4><p>保留任务内容、完成状态、交付记录与自定义岗位。共同岗位的自定义名称和职责保持不变。</p>{error&&<p role="alert">{error}</p>}{preview&&<>
 <ul>{preview.changes.map(c=><li key={c.id}>{!c.before?'新增：'+c.after.name:!c.after.active?'停用并保留记录：'+c.after.name:c.before.name!==c.after.name?c.before.name+' → '+c.after.name:'更新：'+c.after.name}<small>{c.after.duties}</small></li>)}</ul>{!preview.changes.length&&<p>岗位已符合当前预设，无需修改。</p>}
 {preset==='production'&&<p>现有美术工作保留在“美术开发”。主美与技术美术的审核、方案任务请按项目分配，不自动复制制作任务。</p>}
 {preset==='basic'&&<p>主美和技术美术的工作归入美术；两个岗位作为停用记录保留，后续可以重新启用。</p>}
 <details open={preview.taskChanges.length>0}><summary>任务归并预览 · {preview.taskChanges.length} 项</summary>{preview.taskChanges.map(t=><p key={t.taskId}><strong>{t.title}</strong><br/>{t.from.join('、')} → {t.to.join('、')}</p>)}</details>
 {(preview.affectedDevelopers.length>0||preview.affectedCredentials>0)&&<p className="ai-preset-notice">涉及开发者：{preview.affectedDevelopers.join('、')||'旧版任务凭证'}；涉及令牌 {preview.affectedCredentials} 个。原岗位授权保留，不自动转授到整个美术岗位。请在“开发者与令牌”核对岗位及任务范围。</p>}
 </>}<div className="ai-toolbar"><button onClick={onCancel}>取消</button><button className="primary" disabled={disabled||!preview||(!preview.changes.length&&!preview.taskChanges.length)} onClick={onApply}>确认应用岗位预设</button></div></div>;
}
