import {useEffect,useRef,useState} from 'react';
import {CheckCircle2,Flag,ChevronDown,ChevronRight,LayoutGrid,List,Plus,Pencil} from 'lucide-react';
import {milestoneAcceptance} from './schedule-acceptance';
import {compareMilestoneDatesDescending} from './overview-model';
import type {ProjectScheduleStore,ProductionMilestone,ProductionRelease} from './project-schedule';
import {milestoneDisplayTitle,removeScheduleRelease,scheduleReleaseGroups} from './schedule-releases';
import './schedule-releases.css';

export function MilestoneCards({store,disabled,editingDisabled,releasesEnabled=true,onUpdate,onOpen,onReview,onReopen}:{store:ProjectScheduleStore;disabled:boolean;editingDisabled:boolean;releasesEnabled?:boolean;onUpdate:(operation:(s:ProjectScheduleStore)=>ProjectScheduleStore)=>boolean;onOpen:(id:string)=>void;onReview:(id:string)=>void;onReopen:(id:string)=>void}) {
  const [view,setView]=useState<'cards'|'list'>('cards'),[collapsed,setCollapsed]=useState<string[]>([]),[editing,setEditing]=useState<ProductionRelease|null>(null);
  const groups=scheduleReleaseGroups(store);
  const toggle=(id:string)=>setCollapsed(old=>old.includes(id)?old.filter(v=>v!==id):[...old,id]);
  return <div className="sch-release-board"><div className="sch-release-toolbar"><p>按版本查看阶段成果 · 日期从晚到早</p><div className="sch-actions"><div className="sch-view-switch" role="group" aria-label="里程碑显示方式"><button aria-pressed={view==='cards'} onClick={()=>setView('cards')}><LayoutGrid size={15}/>卡片视图</button><button aria-pressed={view==='list'} onClick={()=>setView('list')}><List size={15}/>紧凑列表</button></div>{releasesEnabled&&<button disabled={editingDisabled||(store.releases?.length??0)>=200} onClick={()=>setEditing({id:crypto.randomUUID(),title:'',description:''})}><Plus size={15}/>新建版本</button>}</div></div>
    {!releasesEnabled&&<p className="sch-muted">升级协作服务器并重新连接后，可管理版本分组。</p>}
    {groups.map(({release,milestones})=>{const id=release?.id??'ungrouped',closed=collapsed.includes(id),accepted=milestones.filter(m=>m.status==='已验收').length;
      return <section className="sch-release-group" key={id} aria-label={'版本分组：'+(release?.title??'未分组')}>
        <div className="sch-release-heading"><button className="sch-release-toggle" aria-label={(closed?'展开版本：':'收起版本：')+(release?.title??'未分组')} aria-expanded={!closed} onClick={()=>toggle(id)}>{closed?<ChevronRight size={18}/>:<ChevronDown size={18}/>}<strong>{release?.title??'未分组'}</strong><span>{milestones.length} 个里程碑 · {accepted} 个已验收</span></button>{release&&releasesEnabled&&<button disabled={editingDisabled} aria-label={'编辑版本：'+release.title} onClick={()=>setEditing(release)}><Pencil size={14}/>编辑版本</button>}</div>
        {!closed&&<>
          {release?.description&&<details className="sch-release-description"><summary><span>版本背景与目标</span><p>{release.description}</p></summary><div>{release.description}</div></details>}
          {!milestones.length&&<p className="sch-muted">此版本还没有里程碑。新建或编辑里程碑时选择此版本。</p>}
          <div className={'sch-milestones sch-milestones-'+view}>{[...milestones].sort((a,b)=>compareMilestoneDatesDescending(a.due,b.due)).map(m=>{
    const state=milestoneAcceptance(store,m.id),accepted=m.status==='已验收',label=accepted?(state.ready?'已验收':'需重新验收'):state.ready?'待确认验收':m.status;
    return <article key={m.id} className={'sch-milestone-card'+(state.ready&&!accepted?' ready':'')} aria-label={'里程碑：'+m.title}>
      <div className="sch-milestone-top"><Flag size={16}/><span>{label}</span></div>
      <button className="sch-milestone-open" aria-label={'打开里程碑：'+m.title} onClick={()=>onOpen(m.id)}><h3>{milestoneDisplayTitle(m,release)||'未命名里程碑'}</h3></button>
      <small className="sch-milestone-meta"><time>{m.due||'目标日期未定'}</time><span>{m.owner||'未分配负责人'}</span></small>
      <div className="sch-milestone-progress"><div className="sch-progress"><i style={{width:(state.total?state.completed/state.total*100:0)+'%'}}/></div><small>制作任务完成 {state.completed}/{state.total}</small></div>
      <p className="sch-milestone-summary">{m.description||m.acceptance||'待填写阶段目标'}</p>
      <details className="sch-milestone-details"><summary>查看目标与验收条件</summary><p>{m.description||(release?.description?'阶段目标见上方版本背景':'尚未填写阶段目标')}</p><strong>验收条件</strong><p>{m.acceptance||'待填写验收条件'}</p>{m.review&&<><strong>验收记录</strong><p>{m.review}</p></>}<button onClick={()=>onOpen(m.id)}>查看完整详情与任务</button></details>
      <div className="sch-milestone-action">{accepted?<button disabled={disabled} aria-label={'重新打开里程碑验收：'+m.title} onClick={()=>onReopen(m.id)}>重新打开验收</button>:<button className={state.ready?'primary':''} disabled={disabled||!state.ready} title={state.ready?'任务已全部完成，可以确认验收':state.total?`还有 ${state.total-state.completed} 项任务未完成`:'至少关联并完成一项任务后可验收'} aria-label={'验收里程碑：'+m.title} onClick={()=>onReview(m.id)}><CheckCircle2 size={16}/>确认阶段验收</button>}</div>
    </article>;
  })}</div></>}
      </section>;
    })}
    {editing&&<ReleaseEditor key={editing.id} release={editing} existing={!!store.releases?.some(r=>r.id===editing.id)} disabled={editingDisabled} store={store} onClose={()=>setEditing(null)} onUpdate={onUpdate}/>}
  </div>;
}

function ReleaseEditor({release,existing,disabled,store,onClose,onUpdate}:{release:ProductionRelease;existing:boolean;disabled:boolean;store:ProjectScheduleStore;onClose:()=>void;onUpdate:(operation:(s:ProjectScheduleStore)=>ProjectScheduleStore)=>boolean}) {
  const dialog=useRef<HTMLDialogElement>(null),[title,setTitle]=useState(release.title),[description,setDescription]=useState(release.description),[error,setError]=useState('');
  useEffect(()=>{dialog.current?.showModal();},[]);
  const submit=()=>{
    if(disabled||!title.trim())return;
    if(store.releases?.some(r=>r.id!==release.id&&r.title.trim().toLowerCase()===title.trim().toLowerCase())){setError('已有同名版本，请使用不同的名称。');return;}
    const changed=onUpdate(s=>{const current=s.releases?.find(r=>r.id===release.id);if(existing&&(!current||current.title!==release.title||current.description!==release.description))throw new Error('版本已被修改或删除，请关闭窗口后重新编辑。');const next={...release,title:title.trim(),description};return {...s,releases:existing?(s.releases??[]).map(r=>r.id===release.id?next:r):[...(s.releases??[]),next]};});
    if(changed)onClose();else setError('版本未能保存，请查看排期保存提示并重试。');
  };
  return <dialog ref={dialog} className="sch-dialog" aria-label={existing?'编辑版本':'新建版本'} onCancel={e=>{e.preventDefault();onClose();}}><form onSubmit={e=>{e.preventDefault();submit();}}><div className="sch-dialog-heading"><h3>{existing?'编辑版本':'新建版本'}</h3><button type="button" onClick={onClose}>关闭</button></div><label className="sch-field">版本名称<input aria-label="版本名称" autoFocus required maxLength={160} disabled={disabled} value={title} onChange={e=>setTitle(e.target.value)} placeholder="例如：v0.3.0 · 奶龙来袭"/></label><label className="sch-field">版本背景与目标<textarea aria-label="版本背景与目标" maxLength={10000} disabled={disabled} value={description} onChange={e=>setDescription(e.target.value)} placeholder="填写这个版本的公共背景、范围与交付目标，各里程碑无需重复填写。"/></label>{error&&<p role="alert">{error}</p>}<div className="sch-dialog-actions">{existing&&<button className="sch-danger" type="button" disabled={disabled} onClick={()=>{if(window.confirm('删除版本“'+release.title+'”？其中的里程碑和任务会保留，里程碑将移入未分组。')&&onUpdate(s=>removeScheduleRelease(s,release.id)))onClose();}}>删除版本</button>}<button type="button" onClick={onClose}>取消</button><button className="primary" disabled={disabled||!title.trim()}>保存版本</button></div></form></dialog>;
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
