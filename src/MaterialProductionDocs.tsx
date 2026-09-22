import {leaveTeamEvent} from './team-api';
import {beforeLogoutEvent} from './auth';
import {useEffect,useRef,useState} from 'react';
import {BookOpen,Plus,ImagePlus,Trash2,X,ArrowRight} from 'lucide-react';
import {productionTemplate,type ProductionDoc} from '../shared/material-production.mjs';
import type {ArtController} from './useArtAssets';
import {StoryMarkdown} from './StoryMarkdown';
import './story.css';
import './material-production.css';

function DocImage({url,alt,doc,workspaceId}:{url:string;alt:string;doc:ProductionDoc;workspaceId:string}){
  const [source,setSource]=useState('');
  const file=doc.images.find(f=>'material-image:'+f.storagePath===url);
  useEffect(()=>{let active=true;setSource('');if(file)void window.desktopClient?.artFiles?.readPreview(workspaceId,file.storagePath).then(v=>{if(active)setSource(v?.dataUrl||'');}).catch(()=>{});return()=>{active=false;};},[workspaceId,file?.storagePath]);
  if(file)return source?<img src={source} alt={alt}/>:<span>图片暂不可用：{file.name}</span>;
  try {const parsed=new URL(url);if(['https:','http:'].includes(parsed.protocol))return <img src={parsed.href} alt={alt} loading="lazy" referrerPolicy="no-referrer"/>;}catch{}
  return <span>图片链接无效：{alt}</span>;
}

export function MaterialProductionDocs({controller,onOpen,onBusy}:{controller:ArtController;onBusy:(busy:boolean)=>void;onOpen:(kind:'requirement'|'asset',id:string)=>void}){
  const docs=controller.store.productionDocs||[],[selected,setSelected]=useState(''),[query,setQuery]=useState(''),[category,setCategory]=useState('全部'),[mode,setMode]=useState('edit');
  const [title,setTitle]=useState(''),[template,setTemplate]=useState('blank'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[link,setLink]=useState('');
  const createDialog=useRef<HTMLDialogElement>(null),deleteDialog=useRef<HTMLDialogElement>(null),editor=useRef<HTMLTextAreaElement>(null),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{onBusy(busy);return()=>onBusy(false);},[busy,onBusy]);
  const filtered=docs.filter(d=>(category==='全部'||(d.category||'未分类')===category)&&[d.title,d.content].join('\n').toLowerCase().includes(query.toLowerCase()));
  const doc=filtered.find(d=>d.id===selected)||filtered[0];
  const disabled=controller.blocked||controller.pending||busy;
  const update=(id:string,patch:Partial<ProductionDoc>)=>controller.update(s=>({...s,productionDocs:(s.productionDocs||[]).map(d=>d.id===id?{...d,...patch,updatedAt:new Date().toISOString()}:d)}));
  function create(){const now=new Date().toISOString(),id=crypto.randomUUID();if(!title.trim())return;
    if(controller.update(s=>({...s,productionDocs:[...(s.productionDocs||[]),{id,title:title.trim(),category:category==='全部'?'':category,content:template==='blank'?'':productionTemplate,requirementIds:[],assetIds:[],images:[],createdAt:now,updatedAt:now}]}))){setSelected(id);setQuery('');setMode('edit');createDialog.current?.close();}}
  async function insertImages(){if(!doc||disabled)return;const api=window.desktopClient?.artFiles;if(!api)return;const id=doc.id,position=editor.current?.selectionStart??doc.content.length;
    setBusy(true);setError('');try{const files=await api.importFiles(controller.workspaceId);if(!files?.length||!alive.current)return;
      const images=files.filter(f=>/^image\/(png|jpeg|gif|webp|bmp|avif)$/.test(f.mime));if(images.length!==files.length)setError('仅图片可插入正文，其他文件未加入方案。');
      if(images.length)controller.update(s=>({...s,productionDocs:(s.productionDocs||[]).map(d=>d.id===id?{...d,images:[...d.images,...images],content:d.content.slice(0,position)+'\n\n'+images.map(f=>'!['+f.name.replace(/[\[\]\n]/g,'')+'](material-image:'+f.storagePath+')').join('\n\n')+'\n\n'+d.content.slice(position),updatedAt:new Date().toISOString()}:d)}));
    }catch(e){if(alive.current)setError(String(e));}finally{if(alive.current)setBusy(false);}}
  useEffect(()=>{if(!busy)return;const guard=(e:Event)=>e.preventDefault();const unload=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener(beforeLogoutEvent,guard);window.addEventListener(leaveTeamEvent,guard);window.addEventListener('beforeunload',unload);return()=>{window.removeEventListener(beforeLogoutEvent,guard);window.removeEventListener(leaveTeamEvent,guard);window.removeEventListener('beforeunload',unload);};},[busy]);
  return <section className="mp-docs" aria-label="素材制作方案">
    <header className="gp-editor-heading"><div><span className="gp-kicker">PRODUCTION NOTES</span><h2>制作方案</h2><p className="gp-muted">写下技术选择、制作方法和交付约定，按需要自由组织正文。</p></div><button className="primary" disabled={disabled} onClick={()=>{setTitle('');setTemplate('blank');createDialog.current?.showModal();}}><Plus size={16}/>新建方案</button></header>
    {error&&<p className="ar-error" role="alert">{error}</p>}
    <div className="mp-workspace"><aside className="gp-library"><label className="gp-search"><input aria-label="搜索制作方案" placeholder="搜索标题或正文…" value={query} onChange={e=>setQuery(e.target.value)}/></label><label className="gp-field">分类<select aria-label="制作方案分类筛选" value={category} onChange={e=>setCategory(e.target.value)}>{['全部',...new Set(docs.map(d=>d.category||'未分类'))].map(c=><option key={c}>{c}</option>)}</select></label>
      <div className="gp-list">{filtered.map(d=><button className={'gp-list-card'+(doc?.id===d.id?' selected':'')} key={d.id} aria-label={'打开制作方案：'+d.title} onClick={()=>{setSelected(d.id);setLink('');}}><small>{d.category||'未分类'}</small><strong>{d.title||'未命名方案'}</strong></button>)}</div>
    </aside>{doc?<article className="mp-editor" key={doc.id}>
      <div className="mp-meta"><label className="gp-field">方案名称<input aria-label="制作方案名称" disabled={disabled} value={doc.title} onChange={e=>update(doc.id,{title:e.target.value})}/></label><label className="gp-field">文档分类<input aria-label="制作方案分类" list="production-categories" disabled={disabled} value={doc.category} onChange={e=>{setCategory('全部');update(doc.id,{category:e.target.value});}} placeholder="例如：动画制作"/></label><datalist id="production-categories">{[...new Set(docs.map(d=>d.category).filter(Boolean))].map(c=><option key={c}>{c}</option>)}</datalist></div>
      <div className="sl-modebar"><button className={mode==='edit'?'active':''} onClick={()=>setMode('edit')}>编辑正文</button><button className={mode==='read'?'active':''} onClick={()=>setMode('read')}>阅读预览</button><button disabled={disabled||mode!=='edit'||!window.desktopClient?.artFiles} onClick={()=>void insertImages()}><ImagePlus size={16}/>插入图片</button><button disabled={disabled} onClick={()=>deleteDialog.current?.showModal()}><Trash2 size={16}/>删除方案</button></div>
      {mode==='edit'?<><p className="gp-muted">支持 Markdown：标题、列表、链接、图片和代码块。章节可自由增删。</p><textarea className="mp-content" ref={editor} aria-label="制作方案正文" disabled={disabled} value={doc.content} onChange={e=>update(doc.id,{content:e.target.value})} placeholder="从技术选择、使用工具或制作步骤开始写…"/></>:<StoryMarkdown content={doc.content} markdown renderImage={(url,alt)=><DocImage url={url} alt={alt} doc={doc} workspaceId={controller.workspaceId}/>}/>}
      <section className="mp-links"><h3>关联素材 <small>可选</small></h3>{(['requirement','asset'] as const).flatMap(kind=>(kind==='requirement'?doc.requirementIds:doc.assetIds).map(id=>{const target=(kind==='requirement'?controller.store.requirements:controller.store.assets).find(a=>a.id===id);return <div key={kind+id}><button className="gp-secondary" disabled={!target||busy} onClick={()=>onOpen(kind,id)}>{kind==='requirement'?'需求':'资产'} · {target?.name||'目标已失效'}<ArrowRight size={14}/></button><button className="gp-icon" disabled={disabled} aria-label={'解除方案关联：'+(target?.name||id)} onClick={()=>update(doc.id,kind==='requirement'?{requirementIds:doc.requirementIds.filter(x=>x!==id)}:{assetIds:doc.assetIds.filter(x=>x!==id)})}><X size={14}/></button></div>;}))}
        <div><select aria-label="选择方案关联素材" disabled={disabled} value={link} onChange={e=>setLink(e.target.value)}><option value="">选择需求或资产…</option>{(['requirement','asset'] as const).map(kind=><optgroup key={kind} label={kind==='requirement'?'制作需求':'资产文件'}>{(kind==='requirement'?controller.store.requirements:controller.store.assets).filter(a=>!a.archived&&!(kind==='requirement'?doc.requirementIds:doc.assetIds).includes(a.id)).map(a=><option value={JSON.stringify([kind,a.id])} key={a.id}>{a.name}</option>)}</optgroup>)}</select><button className="gp-secondary" disabled={disabled||!link} onClick={()=>{const [kind,id]=JSON.parse(link);if(update(doc.id,kind==='requirement'?{requirementIds:[...doc.requirementIds,id]}:{assetIds:[...doc.assetIds,id]}))setLink('');}}>添加关联</button></div>
      </section><small className="gp-muted">最后编辑：{new Date(doc.updatedAt).toLocaleString()} · 随编辑保存</small>
    </article>:<div className="gp-empty"><BookOpen size={36}/><h2>{docs.length?'没有匹配的制作方案':'写下第一份制作方案'}</h2><p>例如《僵尸骨骼动画制作方案》，记录工具选择、角色分件和引擎接入方法。</p></div>}</div>
    <dialog ref={createDialog} className="gp-dialog" aria-label="新建制作方案"><form onSubmit={e=>{e.preventDefault();create();}}><h2>新建制作方案</h2><label className="gp-field">名称<input aria-label="新制作方案名称" required value={title} onChange={e=>setTitle(e.target.value)}/></label><label className="gp-field">起始内容<select aria-label="制作方案模板" value={template} onChange={e=>setTemplate(e.target.value)}><option value="blank">空白文档</option><option value="template">制作方案模板</option></select></label><div className="gp-dialog-actions"><button type="button" className="gp-secondary" onClick={()=>createDialog.current?.close()}>取消</button><button className="primary" disabled={disabled}>创建方案</button></div></form></dialog>
    <dialog ref={deleteDialog} className="gp-dialog" aria-label="删除制作方案"><h2>删除“{doc?.title}”？</h2><p>删除此方案文档及其关联记录。关联的素材需求和资产文件会保留。</p><div className="gp-dialog-actions"><button className="gp-secondary" onClick={()=>deleteDialog.current?.close()}>取消</button><button className="primary" disabled={disabled} onClick={()=>{if(doc&&controller.update(s=>({...s,productionDocs:(s.productionDocs||[]).filter(d=>d.id!==doc.id)}))){deleteDialog.current?.close();setSelected('');}}}>确认删除方案</button></div></dialog>
  </section>;
}
