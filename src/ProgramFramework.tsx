import {createElement,Fragment,useEffect,useMemo,useRef,useState} from 'react';
import {BookOpen,Check,Copy,Download,FileCode2,Search,Settings2} from 'lucide-react';
import {storyBlocks,safeStoryLink} from './story-library';
import {useLeaveSearch,useSearchRequest} from './GlobalSearch';
import {buildDocumentZip} from './ai-document-zip';
import {frameworkLibrary,frameworkExtensions,adoptedFrameworkDocuments,resolveFrameworkLink,type FrameworkDocument} from './program-framework';
import type {ProgramFrameworkController} from './useProgramFramework';
import './program-framework.css';

function FrameworkMarkdown({doc,onOpen}:{doc:FrameworkDocument;onOpen:(id:string)=>void}) {
  const inline=(text:string)=>text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^\)\s]+\))/g).map((part,i)=>{
    if(part.startsWith('**'))return <strong key={i}>{part.slice(2,-2)}</strong>;
    if(part.startsWith('`'))return <code key={i}>{part.slice(1,-1)}</code>;
    const link=/^\[([^\]]+)\]\((.+)\)$/.exec(part);
    if(link){const target=resolveFrameworkLink(doc.path,link[2]),href=safeStoryLink(link[2]);return target?<button key={i} className="pf-inline-link" onClick={()=>onOpen(target.id)}>{link[1]}</button>:href?<a key={i} href={href} target="_blank" rel="noreferrer noopener">{link[1]}</a>:<Fragment key={i}>{link[1]}</Fragment>;}
    return <Fragment key={i}>{part}</Fragment>;
  });
  return <article className="pf-markdown" aria-label="框架规范正文">{storyBlocks(doc.content).map(block=>{
    const props={key:block.line,'data-framework-line':block.line};
    if(block.kind==='heading')return createElement('h'+block.level,props,inline(block.text));
    if(block.kind==='code')return <pre {...props}><code>{block.text}</code></pre>;
    if(block.kind==='rule')return <hr {...props}/>;
    if(block.kind==='quote')return <blockquote {...props}>{inline(block.text)}</blockquote>;
    if(block.kind==='list'){
      const ordered=/^\s*(\d+)\. /.exec(doc.content.split('\n')[block.line]);
      return ordered?<ol {...props} start={Number(ordered[1])}><li>{inline(block.text)}</li></ol>:<ul {...props}><li>{inline(block.text)}</li></ul>;
    }
    const lines=block.text.split('\n');
    if(lines.length>1&&/^\|/.test(lines[0])&&/^\|[\s:|\-]+\|$/.test(lines[1])) {
      const cells=(line:string)=>line.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
      return <div {...props} className="pf-table-wrap"><table><thead><tr>{cells(lines[0]).map((c,i)=><th key={i}>{inline(c)}</th>)}</tr></thead><tbody>{lines.slice(2).map((line,i)=><tr key={i}>{cells(line).map((c,j)=><td key={j}>{inline(c)}</td>)}</tr>)}</tbody></table></div>;
    }
    return <p {...props}>{inline(block.text)}</p>;
  })}</article>;
}

export function ProgramFramework({controller,engine,onOpenEngine}:{controller:ProgramFrameworkController;engine:string;onOpenEngine:()=>void}) {
  const {store,update}=controller;
  const [tab,setTab]=useState<'library'|'project'>('library'),[selected,setSelected]=useState('intro'),[query,setQuery]=useState(''),[notice,setNotice]=useState('');
  const reader=useRef<HTMLDivElement>(null),request=useSearchRequest('程序框架'),leaveSearch=useLeaveSearch('程序框架');
  useEffect(()=>{if(request){setTab(request.kind==='settings'?'project':'library');if(frameworkLibrary.documents.some(d=>d.id===request.id))setSelected(request.id);setQuery('');}},[request]);
  useEffect(()=>{reader.current?.scrollTo(0,0);setNotice('');},[selected,tab]);
  const open=(id:string)=>{leaveSearch();setSelected(id);setQuery('');setTab('library');};
  const doc=frameworkLibrary.documents.find(d=>d.id===selected)!;
  const adopted=useMemo(()=>adoptedFrameworkDocuments(store,engine),[store,engine]);
  const terms=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const filtered=frameworkLibrary.documents.filter(d=>terms.every(t=>(d.title+'\n'+d.content).toLocaleLowerCase().includes(t)));
  const download=(filename:string,bytes:BlobPart,type:string)=>{const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return <section className="pf-page" aria-label="程序框架工作区">
    <div className="pf-intro"><span className="pf-logo"><FileCode2 size={30}/></span><div><span className="pf-eyebrow">PROGRAM FRAMEWORK</span><h2>让项目有清晰的程序结构</h2><p>以 Package / Core 组织业务，按需要增加存档、装配与联机能力。</p></div><span className="pf-version">内置规范 v{frameworkLibrary.version}<small>{frameworkLibrary.documents.length} 份文档 · 离线可读</small></span></div>
    <div className="pf-tabs" role="tablist" aria-label="程序框架视图"><button role="tab" aria-selected={tab==='library'} onClick={()=>{leaveSearch();setTab('library');}}><BookOpen size={17}/>规范库</button><button role="tab" aria-selected={tab==='project'} onClick={()=>{leaveSearch();setTab('project');}}><Settings2 size={17}/>项目采用方案 <span>{store.enabled?'已采用':'未采用'}</span></button></div>
    {controller.error&&<div className="pf-warning" role="alert"><p>{controller.error}</p><div className="pf-actions"><button onClick={()=>download('程序框架草稿.json',JSON.stringify(store,null,2),'application/json')}>导出框架草稿</button>{controller.pending&&<button onClick={controller.retry}>重试保存程序框架</button>}<button onClick={()=>{if(!controller.pending||window.confirm('重新读取会放弃未保存的程序框架草稿。继续？'))controller.reload();}}>重新读取程序框架</button></div></div>}
    {tab==='library'?<div className="pf-library">
      <aside className="pf-catalog" aria-label="框架规范目录"><div className="pf-search"><Search size={17}/><input aria-label="搜索框架规范" placeholder="搜索标题或正文…" value={query} onChange={e=>{leaveSearch();setQuery(e.target.value);}}/></div><p className="pf-muted">{filtered.length} 份文档{query?'匹配当前搜索':''}</p><div className="pf-doc-list">{[...new Set(filtered.map(d=>d.group))].map(group=><div key={group}><h3>{group}</h3>{filtered.filter(d=>d.group===group).map(d=><button key={d.id} className={selected===d.id?'selected':''} aria-label={'阅读框架规范：'+d.title} aria-current={selected===d.id?'page':undefined} onClick={()=>{leaveSearch();setSelected(d.id);}}><span>{d.title.replace(/^可选扩展：/,'')}</span>{adopted.some(a=>a.id===d.id)&&<Check size={14} aria-label="本项目已采用"/>}</button>)}</div>)}{!filtered.length&&<p className="pf-empty">没有找到匹配文档，试试其他关键词。</p>}</div></aside>
      <div className="pf-document"><header className="pf-document-toolbar"><div><small>{doc.group} · 内置只读</small><strong>{doc.title}</strong></div><div className="pf-actions"><button title="复制当前文档的 Markdown" onClick={()=>{void navigator.clipboard.writeText(doc.content).then(()=>setNotice('已复制当前规范')).catch(()=>setNotice('复制失败，可下载规范包'));}}><Copy size={15}/>复制</button><button onClick={()=>{download('通用游戏项目框架-v1.0.zip',buildDocumentZip('通用游戏项目框架',frameworkLibrary.documents.map(d=>({path:d.path,content:d.content}))),'application/zip');setNotice('已开始下载完整规范包，包含全部 '+frameworkLibrary.documents.length+' 份参考文档');}}><Download size={15}/>下载规范包</button></div></header>
      {notice&&<p className="pf-notice" role="status">{notice}</p>}<div className="pf-reader" ref={reader}><FrameworkMarkdown doc={doc} onOpen={open}/></div><footer className="pf-document-footer"><span>{doc.id==='config-data-policy'?'独立于框架采用，随项目开发文档交付':adopted.some(d=>d.id===doc.id)?'已纳入本项目 AI 文档':doc.kind==='reference'?'阅读参考，完整内容可从规范包获取':'尚未纳入本项目 AI 文档'}</span><button onClick={()=>{leaveSearch();setTab('project');}}>管理采用方案 →</button></footer></div>
    </div>:<div className="pf-project"><fieldset disabled={controller.blocked} className="pf-adoption"><h3>采用通用游戏项目框架</h3><p>内置原文保持一致，项目自己的约定保存在这里。基础规范不会要求中央数据注册或客户端／服务端划分。</p><label className="pf-check pf-adopt"><input type="checkbox" aria-label="采用内置通用框架" checked={store.enabled} onChange={e=>update(s=>({...s,enabled:e.target.checked}))}/><span>本项目采用 Package / Core 通用规范<small>采用后，基础规范和选择的扩展会写入 AI 文档；取消采用会保留设置。</small></span></label>
      <label className="pf-field">运行模式<select aria-label="框架运行模式" value={store.runtime} onChange={e=>update(s=>({...s,runtime:e.target.value as typeof s.runtime,extensions:e.target.value==='singleplayer'?s.extensions.filter(id=>id!=='network'):s.extensions}))}><option value="singleplayer">单机</option><option value="multiplayer">多人 / 联机</option></select></label>
      <h3>按需采用扩展</h3><div className="pf-extension-grid">{frameworkExtensions.map(extension=><label key={extension.id} className={'pf-extension'+(store.extensions.includes(extension.id)?' selected':'')}><input type="checkbox" aria-label={'采用'+extension.label} disabled={extension.id==='network'&&store.runtime==='singleplayer'} checked={store.extensions.includes(extension.id)} onChange={e=>update(s=>({...s,extensions:e.target.checked?[...s.extensions,extension.id]:s.extensions.filter(id=>id!==extension.id)}))}/><span><strong>{extension.label}</strong><small>{extension.id==='network'&&store.runtime==='singleplayer'?'单机项目无需联机扩展；选择多人模式后可采用。':extension.description}</small></span></label>)}</div>
      <h3>引擎接入</h3><p>通用接入原则随基础规范提供，具体 API 以项目引擎为准。<button className="pf-inline-link" type="button" onClick={onOpenEngine}>查看引擎设置</button></p><label className="pf-check"><input type="checkbox" aria-label="采用绿洲启元补充" disabled={engine!=='oasis-lua'} checked={store.oasisSupplement} onChange={e=>update(s=>({...s,oasisSupplement:e.target.checked}))}/><span>采用绿洲启元专用补充<small>{engine==='oasis-lua'?'明确选择后才纳入绿洲数据宿主与平台接入说明。':'当前引擎不匹配，绿洲补充不会进入导出。'}</small></span></label>
      <label className="pf-field">项目约定与例外<textarea aria-label="程序框架项目约定" rows={9} maxLength={30000} value={store.notes} onChange={e=>update(s=>({...s,notes:e.target.value}))} placeholder="例如：业务包先采用 Planting 和 Inventory；使用手工装配；只在游戏日结算时推进生长。"/></label><p className="pf-muted">修改按项目自动保存 · 内置文档不会被改写</p></fieldset>
      <aside className="pf-export-plan"><h3>本项目导出范围</h3><p>{store.enabled?`${adopted.length} 份规范与项目约定会进入“程序框架”模块文档。`:'尚未采用内置规范，AI 文档只记录采用状态与项目约定。'}</p>{adopted.map(d=><button key={d.id} onClick={()=>open(d.id)}><Check size={14}/>{d.title}</button>)}<p className="pf-muted">总文档、模块文档与引擎文档同步共用这份采用方案。全部 18 份文档仍可在规范库阅读与下载。</p></aside>
    </div>}
  </section>;
}
