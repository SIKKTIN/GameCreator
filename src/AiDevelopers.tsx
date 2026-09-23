import {useEffect,useState} from 'react';
import {X,Copy,Download,Plus,KeyRound} from 'lucide-react';
import {beforeLogoutEvent} from './auth';
import {ScheduleRecovery} from './ProjectSchedule';
import {positionsOf,defaultWorkTeam,taskPositionIds,credentialTasks,credentialState,credentialExpiry,aiPermissionLabels,type AiMember,type AiCredential,type AiDeveloperProfile,type AiPermission,type DeveloperInput} from '../shared/ai-personnel.mjs';
import type {useProjectSchedule} from './useProjectSchedule';
import type {ProjectScheduleStore} from './project-schedule';
type Controller=ReturnType<typeof useProjectSchedule>;
type Props={controller:Controller;projectId:string;testMode:boolean;toolHistory?:import('../shared/engine-feedback.mjs').FeedbackReceipt[]};
const grants=Object.keys(aiPermissionLabels) as AiPermission[];
const scopes={assigned:'已分配任务',positions:'岗位范围（包含后续任务）',project:'项目范围'};
export function developerProfile(store:ProjectScheduleStore,member?:AiMember,key?:AiCredential):AiDeveloperProfile{
 if(member?.developer)return structuredClone(member.developer);
 const alias:Record<string,string>={'制作管理':'制作人','程序开发':'程序','动画':'美术','UI':'美术','音乐':'音效','开发工具':'程序','关卡设计':'策划'};
 const ids=key?.positionIds||positionsOf(store).filter(p=>member?.roles.some(r=>(alias[r]||r)===p.name)).map(p=>p.id);
 return {positionIds:ids,scope:key?'assigned':'assigned',taskIds:key?credentialTasks(store,key).map(t=>t.id):[],expiresAt:key?.expiresAt||''};
}
function useOperation(c:Controller){const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');useEffect(()=>{if(!busy)return;const guard=(e:Event)=>e.preventDefault();window.addEventListener(beforeLogoutEvent,guard);return()=>window.removeEventListener(beforeLogoutEvent,guard);},[busy]);return{busy,error,notice,setNotice,run:async(fn:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(String(e));}finally{c.reloadIfClean();setBusy(false);}}};}
function Dialog({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}){return <dialog className="gp-dialog ai-dialog" aria-label={title} ref={el=>{if(el&&!el.open)el.showModal();}} onCancel={e=>{e.preventDefault();close();}}><div className="gp-card-heading"><h3>{title}</h3><button className="gp-icon" aria-label={'关闭'+title} onClick={close}><X/></button></div>{children}</dialog>;}

export function AiDeveloperCreate({controller:c,projectId,testMode,onCreated}:Props&{onCreated:()=>void}){
 const op=useOperation(c),[memberId,setMemberId]=useState(''),members=c.store.personnel?.members||[],member=members.find(m=>m.id===memberId);
 const available=members.filter(m=>!(c.store.personnel?.credentials||[]).some(k=>k.projectId===projectId&&k.memberId===m.id&&!k.revokedAt));
 return <section className="ai-developer-create"><h3>创建长期参与项目的开发者</h3><p className="gp-muted">一个开发者可以兼任多个岗位。任务可以暂不指定，之后在开发者与令牌中持续维护。</p><ScheduleRecovery controller={c}/>{testMode&&<p>测试模式不签发正式凭证。</p>}
 <label className="gp-field">开发者来源<select aria-label="开发者来源" disabled={op.busy} value={memberId} onChange={e=>setMemberId(e.target.value)}><option value="">新建开发者</option>{available.map(m=><option key={m.id} value={m.id}>{m.name}（已有身份，无当前令牌）</option>)}</select></label>
 <DeveloperForm key={memberId||'new'} store={c.store} member={member} disabled={op.busy||c.blocked||c.pending||testMode} submit="创建开发者并生成令牌" onSave={input=>void op.run(async()=>{const api=window.desktopClient?.developerCredentials;if(!api)throw new Error('请在桌面客户端管理凭证');let schedule=c.store;if(!schedule.personnel){schedule={...schedule,personnel:defaultWorkTeam()};if(!c.update(()=>schedule))return;}await api('create',{...input,projectId,memberId:memberId||undefined,schedule});c.reloadIfClean();onCreated();})}/>
 {op.error&&<p role="alert" className="ar-error">{op.error}</p>}
 </section>;
}
function DeveloperForm({store,member,credential,disabled,submit,onSave}:{store:ProjectScheduleStore;member?:AiMember;credential?:AiCredential;disabled:boolean;submit:string;onSave:(v:Partial<DeveloperInput>)=>void}){
 const [name,setName]=useState(member?.name||''),[duties,setDuties]=useState(member?.duties||credential?.workDescription||''),[active,setActive]=useState(member?.active??true),[permissions,setPermissions]=useState<AiPermission[]>(member?.permissions||['progress']);
 const [profile,setProfile]=useState(()=>developerProfile(store,member,credential)),[assign,setAssign]=useState(!!developerProfile(store,member,credential).taskIds.length),[query,setQuery]=useState('');
 const positions=positionsOf(store),tasks=store.tasks.filter(t=>(profile.scope==='project'||taskPositionIds(store,t).some(id=>profile.positionIds.includes(id)))&&(t.title+t.description).toLowerCase().includes(query.toLowerCase()));
 const selected=store.tasks.filter(t=>profile.taskIds.includes(t.id)),invalid=!name.trim()||!profile.positionIds.length||!permissions.length;
 const patch=(p:Partial<AiDeveloperProfile>)=>setProfile(v=>({...v,...p}));
 return <form onSubmit={e=>{e.preventDefault();if(!invalid)onSave({name:name.trim(),duties,active,permissions,profile});}}><fieldset className="ar-fields ai-developer-form" disabled={disabled}>
 <label className="gp-field">开发者名称<input aria-label="开发者名称" required maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder="例如：制作人、程序助手、资源助手"/></label>
 <div className="ai-checks"><span>岗位（可多选）</span>{positions.map(p=><label key={p.id}><input type="checkbox" aria-label={'开发者岗位：'+p.name} checked={profile.positionIds.includes(p.id)} disabled={!p.active&&!profile.positionIds.includes(p.id)} onChange={e=>patch({positionIds:e.target.checked?[...profile.positionIds,p.id]:profile.positionIds.filter(id=>id!==p.id)})}/>{p.name}{!p.active?'（停用）':''}</label>)}</div>
 <label className="gp-field">职责说明<textarea aria-label="开发者职责" rows={3} maxLength={10000} value={duties} onChange={e=>setDuties(e.target.value)}/></label>
 <label className="gp-field">允许操作的范围<select aria-label="开发者权限范围" value={profile.scope} onChange={e=>patch({scope:e.target.value as AiDeveloperProfile['scope']})}>{Object.entries(scopes).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
 <p className="gp-muted">制作人可以选择项目范围，并保持零任务。范围决定能对哪些工作提交反馈；只有明确分配的任务计入个人工作量。</p>
 <div className="ai-checks"><span>反馈权限</span>{grants.map(p=><label key={p}><input type="checkbox" aria-label={'开发者权限：'+p} checked={permissions.includes(p)} onChange={e=>setPermissions(v=>e.target.checked?[...v,p]:v.filter(x=>x!==p))}/>{aiPermissionLabels[p]}</label>)}</div>
 <label className="ai-assign-toggle"><input type="checkbox" aria-label="现在分配具体任务" checked={assign} onChange={e=>{setAssign(e.target.checked);if(!e.target.checked)patch({taskIds:[]});}}/>现在分配具体任务（可选）</label>
 {!assign&&<p className="gp-muted">暂不指定任务，仍可创建开发者。后续增减任务不需要重新生成令牌。</p>}
 {assign&&<><h4>已选 {profile.taskIds.length} 项任务</h4><input type="search" aria-label="搜索开发者任务" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索任务"/><div className="ai-toolbar"><button type="button" onClick={()=>patch({taskIds:[...new Set([...profile.taskIds,...tasks.map(t=>t.id)])]})}>选择当前结果</button><button type="button" onClick={()=>patch({taskIds:[]})}>清空任务</button></div><div className="ai-work-selection">{tasks.map(t=><label key={t.id}><input type="checkbox" aria-label={'开发者任务：'+t.title} checked={profile.taskIds.includes(t.id)} onChange={e=>patch({taskIds:e.target.checked?[...profile.taskIds,t.id]:profile.taskIds.filter(id=>id!==t.id)})}/><span><strong>{t.title}</strong><small>{t.kind} · {t.status}</small></span></label>)}</div>{selected.filter(t=>!tasks.some(x=>x.id===t.id)).map(t=><label key={t.id}><input type="checkbox" checked onChange={()=>patch({taskIds:profile.taskIds.filter(id=>id!==t.id)})}/>{t.title}（已选，当前筛选外）</label>)}{!tasks.length&&<p className="gp-muted">没有匹配工作，可保持暂不分配。</p>}</>}
 <label><input type="checkbox" aria-label="令牌长期有效" checked={!profile.expiresAt} onChange={e=>patch({expiresAt:e.target.checked?'':new Date(Date.now()+30*86400000).toISOString()})}/>长期有效</label>
 {!!profile.expiresAt&&<label className="gp-field">有效期至<input aria-label="开发者有效期" type="date" required value={profile.expiresAt.slice(0,10)} onChange={e=>{if(e.target.value)patch({expiresAt:new Date(e.target.value+'T23:59:59').toISOString()});}}/></label>}
 <label><input type="checkbox" aria-label="启用开发者" checked={active} onChange={e=>setActive(e.target.checked)}/>启用开发者</label>
 <button className="primary" disabled={invalid||!window.desktopClient?.developerCredentials}><KeyRound size={16}/>{submit}</button>
 </fieldset></form>;
}

export function AiDeveloperList({controller:c,projectId,testMode,toolHistory=[]}:Props){
 const op=useOperation(c),[query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[editing,setEditing]=useState<{key:AiCredential;mode:'update'|'rotate'}>(),[availability,setAvailability]=useState<Record<string,boolean>>({}),[revision,setRevision]=useState(0);
 const team=c.store.personnel,keys=team?.credentials||[],members=team?.members||[],blocked=op.busy||c.blocked||c.pending||testMode,api=window.desktopClient?.developerCredentials;
 useEffect(()=>{let live=true;if(keys.length&&api)void api('available',{projectId}).then(value=>{if(live)setAvailability(value as Record<string,boolean>);}).catch(()=>{if(live)setAvailability({});});return()=>{live=false;};},[c.store,projectId,revision]);
 const run=(fn:()=>Promise<void>)=>void op.run(async()=>{await fn();setRevision(v=>v+1);});
 const action=(operation:'copy'|'download'|'import'|'revoke',key:AiCredential)=>run(async()=>{if(!api)throw new Error('请在桌面客户端管理凭证');if(operation==='revoke'&&!window.confirm('撤销此令牌？开发者资料与反馈记录保留，之后可以更换令牌。'))return;const result=await api(operation,{projectId,credentialId:key.id,schedule:c.store});if(result)op.setNotice(operation==='copy'?'完整令牌已复制。':operation==='download'?'凭证文件已保存。':operation==='import'?'凭证已验证并加密保存，现在可以重新复制。':'令牌已撤销，开发者与历史记录保留。');});
 const visible=keys.filter(k=>{const m=members.find(m=>m.id===k.memberId),state=credentialState(c.store,k,projectId);return(filter==='all'||state===filter)&&((m?.name||'')+k.name+k.id).toLowerCase().includes(query.toLowerCase());});
 const current=editing&&keys.find(k=>k.id===editing.key.id),member=current&&members.find(m=>m.id===current.memberId);
 return <section className="ai-developer-list"><div className="ai-heading"><div><h3>开发者与令牌</h3><p className="gp-muted">持续维护开发者的职责、权限和任务。完成一批工作后，继续使用同一身份和令牌。</p></div><span>{keys.length} 个令牌 · {members.length} 个开发者身份</span></div><ScheduleRecovery controller={c}/>
 <div className="ai-toolbar"><input type="search" aria-label="搜索开发者与令牌" placeholder="搜索名称或令牌编号" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="令牌状态筛选" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">全部状态</option>{['有效','已停用','已过期','已撤销','属于原项目'].map(v=><option key={v}>{v}</option>)}</select></div>
 {op.error&&<p className="ar-error" role="alert">{op.error}</p>}{op.notice&&<p className="ai-notice" role="status">{op.notice}</p>}
 {!keys.length&&<p className="ai-empty">还没有令牌。到“协作令牌”创建开发者，可暂不指定任务。</p>}
 <div className="ai-developer-grid">{visible.map(k=>{const m=members.find(m=>m.id===k.memberId),state=credentialState(c.store,k,projectId),profile=k.persistent?m?.developer:undefined,tasks=credentialTasks(c.store,k),expiry=credentialExpiry(c.store,k),history=[...(c.store.feedbackHistory||[]),...toolHistory].filter(r=>r.identity?.memberId===k.memberId).sort((a,b)=>b.at.localeCompare(a.at));return <article className="gp-card ai-developer-card" key={k.id} aria-label={'开发者令牌：'+(m?.name||k.name)}>
 <div className="gp-card-heading"><h3>{m?.name||k.name}</h3><span>{state}</span></div><p>{(profile?.positionIds||k.positionIds||[]).map(id=>positionsOf(c.store).find(p=>p.id===id)?.name||id).join('、')||m?.roles.join('、')}</p><p className="gp-muted">{m?.duties||k.workDescription||'尚未填写职责'}</p><p>{profile?scopes[profile.scope]:'旧版任务范围'} · {(k.persistent?m?.permissions||[]:k.permissions).map(p=>aiPermissionLabels[p]).join('、')}</p><p>{expiry?'有效期至 '+expiry.slice(0,10):'长期有效'}</p>
 <details><summary>已分配任务 · {tasks.length} 项 · 完成 {tasks.filter(t=>t.status==='已完成').length} 项</summary>{tasks.map(t=><p key={t.id}>{t.title} · {t.status}</p>)}{!tasks.length&&<p>暂无具体任务，开发者身份持续保留。</p>}</details>
 <code>{k.id}</code><small>{history.length?'最近反馈：'+new Date(history[0].at).toLocaleString():'尚无已处理反馈'}</small>
 {!availability[k.id]&&!k.revokedAt&&k.projectId===projectId&&<p className="gp-muted">本机未保存此凭证。旧令牌可导入之前下载的文件；没有备份时，为同一开发者更换令牌。</p>}
 <div className="ai-toolbar"><button disabled={blocked||!!k.revokedAt||k.projectId!==projectId||!availability[k.id]} onClick={()=>action('copy',k)}><Copy size={14}/>复制令牌</button><button disabled={blocked||!!k.revokedAt||k.projectId!==projectId||!availability[k.id]} onClick={()=>action('download',k)}><Download size={14}/>下载凭证</button><button disabled={blocked||k.projectId!==projectId} onClick={()=>setEditing({key:k,mode:'update'})}>编辑开发者</button></div>
 <div className="ai-toolbar">{!availability[k.id]&&<button disabled={blocked||!!k.revokedAt||k.projectId!==projectId} onClick={()=>action('import',k)}>导入已保存凭证</button>}<button disabled={blocked||k.projectId!==projectId} onClick={()=>setEditing({key:k,mode:'rotate'})}>更换令牌</button><button disabled={blocked||!!k.revokedAt||k.projectId!==projectId} onClick={()=>action('revoke',k)}>撤销令牌</button></div>
 {!k.persistent&&<small>旧版令牌保留原任务限制；编辑不自动扩展它的范围。更换后使用长期开发者模式。</small>}
 </article>;})}</div>
 {editing&&current&&member&&<Dialog title={editing.mode==='rotate'?'更换开发者令牌':'编辑开发者'} close={()=>{if(!op.busy)setEditing(undefined);}}><ScheduleRecovery controller={c}/>{op.error&&<p role="alert" className="ar-error">{op.error}</p>}{editing.mode==='rotate'&&<p>新令牌保存成功后撤销这枚旧令牌，开发者身份、任务与反馈历史保持不变。</p>}<DeveloperForm key={current.id+editing.mode} store={c.store} member={member} credential={current} disabled={blocked} submit={editing.mode==='rotate'?'确认更换令牌':'保存开发者'} onSave={input=>run(async()=>{if(!api)return;await api(editing.mode,{...input,projectId,memberId:member.id,credentialId:current.id,schedule:c.store});setEditing(undefined);op.setNotice(editing.mode==='rotate'?'新令牌已保存，可以随时复制。':'开发者资料已更新，原令牌继续使用。');})}/></Dialog>}
 </section>;
}
