import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Archive,ArrowRight,FileText,FolderOpen,Palette,Plus,RotateCcw,Search,X} from 'lucide-react';
import {ArtStyleGuide,MaterialStyleRequirements} from './ArtStyleGuide';
import {useLeaveSearch} from './GlobalSearch';
import {MaterialProductionDocs} from './MaterialProductionDocs';
import {ArtCategoryHome,ArtCategoryManager} from './ArtCategories';
import {useArtCardDeletion} from './ArtCardDeletion';
import {RequirementEditor,RequirementSources,RequirementAssets} from './ArtEditors';
import {artLibrary,artCategoryName} from './art-library';
import {artIssues,artRequirementStatuses,type ArtRequirement,type ArtStore,type ArtSources} from './art-assets';
import {materialItems,materialForTarget,newMaterialItem,addMaterialRequirements,assignMaterialCategory,type MaterialItem} from './material-items';
import type {ArtItemTarget} from './art-deletion';
import {MaterialDeliveryDocument} from './MaterialDeliveryDocument';
import {materialProductionTasks,materialStatusLabel} from './material-progress';
import type {ProjectScheduleController} from './useProjectSchedule';
import type {ArtController} from './useArtAssets';
import './gameplay.css';
import './art-assets.css';
import './gameplay-library.css';
import './material-items.css';
export type ArtSelection=ArtItemTarget|null;
type Props={requestedStyle?:object;schedule:ProjectScheduleController;onOpenTask:(id:string)=>void;deletionReferences:(target:ArtItemTarget)=>string[];controller:ArtController;sources:ArtSources;selected:ArtSelection;onSelect:(v:ArtSelection)=>void;onOpenGameplay:(id:string,kind?:string,sourceId?:string)=>void;onOpenCapability:(id:string)=>void};
type Change=(f:(s:ArtStore)=>ArtStore)=>boolean;
const now=()=>new Date().toISOString();
const itemStatus=(item:MaterialItem)=>item.archived?'已归档':materialStatusLabel(item.status);
export function ArtAssets(props:Props) {
  const {controller,selected,onSelect}=props,{store,blocked}=controller,library=artLibrary(store),items=materialItems(store),current=materialForTarget(store,selected);
  const [category,setCategory]=useState<string|null>(()=>current?.categoryId??null),[query,setQuery]=useState(''),[range,setRange]=useState('active'),[status,setStatus]=useState('all');
  const [moduleTab,setModuleTab]=useState<'items'|'plans'|'style'>(props.requestedStyle?'style':'items'),[busy,setBusy]=useState(false),[managing,setManaging]=useState(false),[name,setName]=useState(''),[error,setError]=useState('');
  const [reviewingStyle,setReviewingStyle]=useState(false);
  const leaveSearch=useLeaveSearch('素材资产');
  useEffect(()=>{if(props.requestedStyle)setModuleTab('style');},[props.requestedStyle]);
  const dialog=useRef<HTMLDialogElement>(null),input=useRef<HTMLInputElement>(null);
  const deletion=useArtCardDeletion(controller,props.deletionReferences,target=>{if(current?.kind===target.kind&&current.id===target.id)onSelect(null);},true);
  useEffect(()=>{const item=materialForTarget(store,selected);if(item){setCategory(item.categoryId);setRange('all');setQuery('');setStatus('all');setModuleTab('items');}},[selected?.kind,selected?.id]);
  useEffect(()=>{if(category&&category!=='all'&&!library.categories.some(c=>c.id===category))setCategory('');},[library.categories,category]);
  const apply:Change=f=>{try{setError('');return controller.update(f);}catch(e){setError(String(e));return false;}};
  const visible=(item:MaterialItem)=>range==='all'||(range==='archived'?item.archived:!item.archived);
  const listed=items.filter(i=>visible(i)&&(category==='all'||i.categoryId===category)&&(status==='all'||i.status===status)&&i.searchText.includes(query.trim().toLocaleLowerCase()));
  const navigate=(target:ArtSelection)=>{if(busy)return;setReviewingStyle(false);setError('');setModuleTab('items');onSelect(target);};
  const enter=(id:string|null)=>{if(busy)return;setCategory(id);setQuery('');setStatus('all');onSelect(null);};
  const openCreate=()=>{setName('');setError('');dialog.current?.showModal();input.current?.focus();};
  const create=(e:FormEvent)=>{e.preventDefault();if(blocked)return;try{const result=newMaterialItem(store,name,category&&category!=='all'?category:'');if(apply(()=>result.store)){navigate(result.target);dialog.current?.close();}}catch(e){setError(String(e));}};
  const issues=artIssues(store,props.sources);
  return <section className="ar-module al-module mi-module" aria-label="素材资产工作区">
    <div className="ar-module-tabs ar-top-tabs" role="tablist" aria-label="素材模块分页"><button role="tab" aria-selected={moduleTab==='style'} disabled={busy} onClick={()=>{leaveSearch();setModuleTab('style');}}>美术风格</button><button role="tab" aria-selected={moduleTab==='items'} disabled={busy} onClick={()=>{leaveSearch();setModuleTab('items');}}><Palette size={16}/>素材条目<small>{items.filter(visible).length}</small></button><button role="tab" aria-selected={moduleTab==='plans'} disabled={busy} onClick={()=>{leaveSearch();setModuleTab('plans');}}>制作方案<small>{store.productionDocs?.length||0}</small></button></div>
    {controller.error&&<p className="ar-error" role="alert">{controller.error}</p>}
    {moduleTab==='style'?<ArtStyleGuide controller={controller} onOpen={target=>{navigate(target);setReviewingStyle(true);}}/>:moduleTab==='plans'?<MaterialProductionDocs controller={controller} onBusy={setBusy} onOpen={(kind,id)=>navigate({kind,id})}/>:<>
      <div className="gl-heading"><nav className="gl-breadcrumb" aria-label="素材分类路径"><button disabled={busy} onClick={()=>enter(null)}><FolderOpen size={16}/>素材分类</button>{category!==null&&<><ArrowRight size={14}/><span>{category==='all'?'全部分类':artCategoryName(library,category)}</span></>}</nav><div className="gp-actions"><button className="gp-secondary" disabled={blocked||busy} onClick={()=>setManaging(true)}>管理分类</button>{category===null&&<button className="primary" disabled={blocked||busy} onClick={openCreate}><Plus size={15}/>新建素材条目</button>}</div></div>
      {category===null?<><div className="gl-toolbar"><label className="gp-search"><Search size={16}/><input type="search" aria-label="搜索全部素材内容" placeholder="搜索素材、负责人或交付路径…" value={query} onChange={e=>setQuery(e.target.value)}/></label><label>显示范围<select aria-label="素材内容范围" value={range} onChange={e=>setRange(e.target.value)}><option value="active">有效条目</option><option value="archived">已归档</option><option value="all">全部条目</option></select></label><button className="gp-secondary" onClick={()=>enter('all')}>查看全部内容</button></div><ArtCategoryHome cardBindings={deletion.bind} store={store} query={query} range={range} onEnter={enter} onSelect={(kind,id)=>navigate({kind,id})} onManage={()=>setManaging(true)} blocked={blocked}/></>:<>
        <div className="ar-module-heading"><div><h2>{category==='all'?'全部素材条目':artCategoryName(library,category)}</h2><p className="gp-muted">管理制作文档、工程交付说明和美术任务进度。</p></div><span className="mi-count">{listed.length} 个条目</span></div>
        <div className="gp-workspace ar-workspace"><div className="gp-library ar-library"><div className="gp-library-heading"><h2>素材目录</h2><button className="gp-icon" aria-label="新建素材条目" disabled={blocked||busy} onClick={openCreate}><Plus size={18}/></button></div>
          <label className="gp-search"><Search size={16}/><input type="search" aria-label="搜索素材内容" placeholder="搜索名称、负责人或路径…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
          <div className="gp-filters"><label>显示范围<select aria-label="素材内容范围" value={range} onChange={e=>setRange(e.target.value)}><option value="active">有效条目</option><option value="archived">已归档</option><option value="all">全部条目</option></select></label><label>制作与交付<select aria-label="素材状态筛选" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">全部状态</option>{artRequirementStatuses.map(s=><option key={s} value={s}>{materialStatusLabel(s)}</option>)}</select></label></div>
          <label className="ar-category-filter">切换分类<select aria-label="素材分类筛选" value={category} disabled={busy} onChange={e=>enter(e.target.value)}><option value="all">全部分类</option>{library.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}<option value="">未分类</option></select></label>
          <div className="gp-list ar-list">{listed.map(item=><button key={item.key} {...deletion.bind(item)} disabled={busy} className={'gp-list-card ar-list-card'+(current?.key===item.key?' selected':'')} aria-label={'打开素材条目：'+item.name} aria-pressed={current?.key===item.key} onClick={()=>navigate(item)}><div className="ar-card-meta"><span className="gp-badge">{artCategoryName(library,item.categoryId)}</span><small>{itemStatus(item)}</small></div><strong>{item.name||'未命名素材'}</strong><p>{item.description||'补充制作要求，在游戏工程中完成素材。'}</p><small>{item.owner||'待分配'}{item.dueDate?' · '+item.dueDate:''}</small><div className="mi-card-delivery"><FileText size={14}/><span>{materialProductionTasks(store,props.schedule.store,item).length?'关联 '+materialProductionTasks(store,props.schedule.store,item).length+' 项美术任务':'制作文档 · 手动管理进度'}</span></div></button>)}</div>{!listed.length&&<p className="gp-muted gp-list-empty">没有匹配的素材条目。</p>}
        </div><div className="gp-detail ar-detail">{error&&!dialog.current?.open&&<p className="ar-error" role="alert">{error}</p>}{issues.length>0&&<details className="ar-issues"><summary>交付与引用检查 · {issues.length} 项</summary><ul>{issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul></details>}
          {current?<><label className="al-assignment">所属分类<select aria-label="所属素材分类" disabled={blocked||busy||current.archived} value={current.categoryId} onChange={e=>{const id=e.target.value;if(apply(s=>assignMaterialCategory(s,current,id)))setCategory(id);}}><option value="">未分类</option>{library.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><MaterialDetail focusStyle={reviewingStyle} key={current.key} {...props} item={current} apply={apply} onNavigate={navigate}/></>:<div className="gp-empty"><Palette size={36}/><span className="gp-kicker">MATERIAL LIBRARY</span><h2>选择或新建素材条目</h2><p>在一个条目中管理制作要求、工程交付说明和任务进度。</p><button className="primary" disabled={blocked} onClick={openCreate}><Plus size={16}/>创建第一项素材</button></div>}
        </div></div>
      </>}
    </>}
    {deletion.overlay}{managing&&<ArtCategoryManager store={store} blocked={blocked} apply={apply} onClose={()=>setManaging(false)}/>}
    <dialog className="gp-dialog" ref={dialog} aria-label="新建素材条目"><form onSubmit={create}><div className="gp-card-heading"><h2>新建素材条目</h2><button type="button" className="gp-icon" aria-label="关闭新建素材条目" onClick={()=>dialog.current?.close()}><X size={18}/></button></div><p className="gp-muted">填写素材名称，之后可补充制作要求、工程交付位置并关联美术任务。</p><label className="gp-field">素材名称<input ref={input} required aria-label="新素材名称" value={name} onChange={e=>setName(e.target.value)}/></label>{error&&<p className="ar-error" role="alert">{error}</p>}<div className="gp-dialog-actions"><button type="button" className="gp-secondary" onClick={()=>dialog.current?.close()}>取消</button><button className="primary" disabled={blocked}>创建条目</button></div></form></dialog>
  </section>;
}
function MaterialDetail({item,apply,onNavigate,focusStyle,...props}:Props&{focusStyle:boolean;item:MaterialItem;apply:Change;onNavigate:(v:ArtSelection)=>void}) {
  const {controller,sources,selected}=props,r=item.requirement;
  const external=[...new Set([...(r?props.deletionReferences({kind:'requirement',id:r.id}):[]),...item.assets.flatMap(a=>props.deletionReferences({kind:'asset',id:a.id}))])];
  const [tab,setTab]=useState<'requirements'|'deliveries'|'usage'>(!focusStyle&&selected?.kind==='asset'?'deliveries':'requirements');
  useEffect(()=>{if(!focusStyle&&selected?.kind==='asset')setTab('deliveries');else setTab('requirements');},[selected?.kind,selected?.id,focusStyle]);
  const patch=(changes:Partial<ArtRequirement>)=>{if(r)apply(s=>({...s,requirements:s.requirements.map(v=>v.id===r.id?{...v,...changes,updatedAt:now()}:v)}));};
  const archive=()=>apply(s=>({...s,[item.kind==='requirement'?'requirements':'assets']:s[item.kind==='requirement'?'requirements':'assets'].map(v=>v.id===item.id?{...v,archived:!v.archived,updatedAt:now()}:v)}));
  return <><div className="gp-editor-heading"><div><span className="gp-kicker">MATERIAL ITEM</span><h2>{item.name}</h2><div className="mi-summary"><span className="gp-badge">{itemStatus(item)}</span><span>{item.owner||'未分配负责人'}</span><span>工程内制作 · 文档交付</span></div></div><button className="gp-secondary" disabled={controller.blocked} onClick={archive}>{item.archived?<RotateCcw size={14}/>:<Archive size={14}/>} {item.archived?'恢复素材条目':'归档素材条目'}</button></div>
    {item.archived&&<p className="ar-notice">条目已归档，制作要求与历史交付保留；恢复后可继续编辑。</p>}
    <div className="ar-module-tabs mi-detail-tabs" role="tablist" aria-label="素材条目详情">{([['requirements','制作要求'],['deliveries','工程交付与进度'],['usage','使用位置']] as const).map(([key,label])=><button key={key} role="tab" aria-selected={tab===key} onClick={()=>setTab(key)}>{label}</button>)}</div>
    {tab==='requirements'&&<MaterialStyleRequirements controller={controller} target={item} apply={apply}/>}
    {tab==='requirements'&&(r?<div className="mi-requirements"><RequirementEditor requirement={r} controller={controller} sources={sources} apply={apply} onChange={patch} onOpenAsset={id=>onNavigate({kind:'asset',id})} onOpenGameplay={props.onOpenGameplay} onOpenCapability={props.onOpenCapability} progressManaged={props.schedule.blocked||props.schedule.pending||materialProductionTasks(controller.store,props.schedule.store,item).length>0} unified/></div>:<section className="gp-card"><h3>制作要求尚未补充</h3><p className="gp-muted">已有交付内容完整保留。补充制作要求后，可以设置负责人、进度、规格和验收标准。</p><button className="primary" disabled={controller.blocked||item.archived} onClick={()=>{const result=addMaterialRequirements(controller.store,item.id);if(apply(()=>result.store))onNavigate(result.target);}}><Plus size={15}/>补充制作要求</button></section>)}
    {tab==='deliveries'&&<MaterialDeliveryDocument controller={controller} item={item} schedule={props.schedule} apply={apply} onOpenTask={props.onOpenTask}/>}
    {tab==='usage'&&<>{r?<RequirementSources requirement={r} sources={sources} disabled={controller.blocked||r.archived} onChange={value=>patch({sources:value})} onOpenGameplay={props.onOpenGameplay} onOpenCapability={props.onOpenCapability}/>:<p className="gp-muted">补充制作要求后，可关联玩法和功能中的使用位置。</p>}{item.assets.map(asset=><section className="gp-card" key={asset.id}><h3>{asset.name} · 资源复用</h3>{controller.store.links.filter(l=>l.assetId===asset.id&&l.requirementId!==r?.id).map(link=>{const other=controller.store.requirements.find(v=>v.id===link.requirementId);return <button className="gp-secondary" key={link.id} disabled={!other} onClick={()=>onNavigate({kind:'requirement',id:link.requirementId})}>{other?.name||'关联条目已失效'}<ArrowRight size={14}/></button>;})}{!controller.store.links.some(l=>l.assetId===asset.id&&l.requirementId!==r?.id)&&<p className="gp-muted">当前没有其他素材条目复用此资源。</p>}</section>)}</>}
    {tab==='usage'&&r&&<details className="mi-reuse"><summary>管理共用资源关联</summary><RequirementAssets requirement={r} store={controller.store} disabled={controller.blocked||controller.pending||r.archived} apply={apply} onOpenAsset={id=>onNavigate({kind:'asset',id})}/></details>}
    {tab==='usage'&&external.length>0&&<section className="gp-card"><h3>其他使用位置</h3><ul>{external.map(text=><li key={text}>{text}</li>)}</ul></section>}
  </>;
}
