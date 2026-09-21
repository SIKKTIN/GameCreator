import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {ArrowLeft,ArrowUpRight,FileSearch,Search,X} from 'lucide-react';
import {buildSearchIndex,relatedEntries,searchEntries,searchTerms,type SearchEntry,type SearchSources,type SearchTarget} from './global-search';
import './global-search.css';
type Published = {sources:SearchSources;warning:string};
type Context = {entries:SearchEntry[];warnings:string[];query:string;setQuery:(v:string)=>void;launch:()=>void;open:(e:SearchEntry)=>void;request?:SearchTarget;reject:(message:string)=>void;error:string;returnVisible:boolean;publish:(key:string,value:Published|null)=>void};
const SearchContext=createContext<Context|null>(null);
export function GlobalSearchProvider({children,sources,warning='',blocked=false,activeModule,onNavigate,onOpen}:{children:ReactNode;activeModule:string;sources?:SearchSources;warning?:string;blocked?:boolean;onNavigate:()=>void;onOpen:(target:SearchTarget)=>boolean|void}) {
  const [published,setPublished]=useState<Record<string,Published>>({}),[query,setQuery]=useState(''),[request,setRequest]=useState<SearchTarget>(),[error,setError]=useState(''),[returnVisible,setReturnVisible]=useState(false);
  useEffect(()=>{if(blocked||request&&request.module!==activeModule)setRequest(undefined);},[activeModule,blocked]);
  const publish=useCallback((key:string,value:Published|null)=>setPublished(current=>{const next={...current};if(value)next[key]=value;else delete next[key];return next;}),[]);
  const entries=useMemo(()=>blocked?[]:buildSearchIndex(Object.assign({},sources,...Object.values(published).map(p=>p.sources))),[sources,published,blocked]);
  const warnings=blocked?['当前项目不可访问，搜索结果已清除。']:[warning,...Object.values(published).map(p=>p.warning)].filter(Boolean);
  const launch=()=>{onNavigate();setError('');};
  const open=(entry:SearchEntry)=>{const fresh=entries.find(e=>e.key===entry.key);if(!fresh){setError('此内容已删除或不可访问，请重新搜索。');return;}if(fresh.unavailable){setError(fresh.unavailable);return;}if(onOpen(fresh.target)===false)return;setRequest({...fresh.target});setReturnVisible(true);setError('');};
  const reject=(message:string)=>{setRequest(undefined);setError(message);onNavigate();};
  return <SearchContext.Provider value={{entries,warnings,query,setQuery,launch,open,request,reject,error,returnVisible,publish}}>{children}</SearchContext.Provider>;
}
/** Team publishers use only data returned by an authorized module request. */
export function usePublishSearch(key:string,value:unknown,source:keyof SearchSources,warning='',allowed=true) {
  const publish=useContext(SearchContext)?.publish;
  useEffect(()=>{publish?.(key,{sources:allowed?{[source]:value}:{},warning});return()=>publish?.(key,null);},[publish,key,value,source,warning,allowed]);
}
export function useSearchRequest(module:string,exists?:(target:SearchTarget)=>boolean) {
  const c=useContext(SearchContext),request=c?.request?.module===module?c.request:undefined;
  const missing=!!request&&!!exists&&!exists(request);
  useEffect(()=>{if(missing)c?.reject('当前编辑内容中已找不到此条目。若团队有未提交草稿，请先处理草稿与共享版本的差异。');},[request,missing]);
  return missing?undefined:request;
}
export function GlobalSearchInput() {
  const c=useContext(SearchContext),input=useRef<HTMLInputElement>(null);
  useEffect(()=>{const handler=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'&&!e.altKey&&!document.querySelector('dialog[open]')){e.preventDefault();c?.launch();requestAnimationFrame(()=>document.querySelector<HTMLInputElement>('[aria-label="搜索当前项目"]')?.focus());}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);},[c?.launch]);
  if(!c)return null;
  return <form className="search global-search-launcher" role="search" onSubmit={e=>{e.preventDefault();c.launch();}}><Search size={16}/><input ref={input} aria-label="全局搜索入口" placeholder="搜索当前项目…" value={c.query} onChange={e=>c.setQuery(e.target.value)}/><button type="submit" aria-label="打开全局搜索"><kbd>Ctrl K</kbd></button></form>;
}
function Highlight({text,query}:{text:string;query:string}) {
  const terms=searchTerms(query);if(!terms.length)return <>{text}</>;
  const escaped=terms.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
  const regex=new RegExp('('+escaped.join('|')+')','gi');
  return <>{text.split(regex).map((part,i)=>terms.includes(part.toLocaleLowerCase())?<mark key={i}>{part}</mark>:part)}</>;
}
export function SearchReturn({active}:{active:boolean}) {const c=useContext(SearchContext);return c?.returnVisible&&!active?<button className="gsearch-return" onClick={c.launch}><ArrowLeft size={15}/>返回搜索结果{c.query&&<span>“{c.query}”</span>}</button>:null;}
export function GlobalSearchPanel({active}:{active:boolean}) {
  const c=useContext(SearchContext)!,[module,setModule]=useState(''),[archived,setArchived]=useState(false),[query,setQuery]=useState(''),[selected,setSelected]=useState(''),[limit,setLimit]=useState(40);
  useEffect(()=>{const timer=setTimeout(()=>setQuery(c.query),160);return()=>clearTimeout(timer);},[c.query]);
  useEffect(()=>{setLimit(40);setSelected('');},[query,module,archived]);
  const all=useMemo(()=>searchEntries(c.entries,query,'',archived),[c.entries,query,archived]);
  const results=module?all.filter(r=>r.entry.target.module===module):all, preview=results.find(r=>r.entry.key===selected)?.entry;
  const modules=[...new Set(c.entries.map(e=>e.target.module))],related=preview?relatedEntries(preview,c.entries).filter(e=>archived||!e.archived):[];
  return <section hidden={!active} className="gsearch-page" aria-label="全局搜索工作区">
    <div className="gsearch-heading"><FileSearch size={30}/><div><h2>在项目中找到你需要的内容</h2><p>搜索文档、功能、素材、地图与任务，直接打开对应条目。</p></div></div>
    <div className="gsearch-query"><Search size={22}/><input aria-label="搜索当前项目" placeholder="输入名称、关键词或 ID，例如：冲刺" value={c.query} onChange={e=>c.setQuery(e.target.value)}/>{c.query&&<button aria-label="清空全局搜索" onClick={()=>c.setQuery('')}><X size={18}/></button>}</div>
    {c.warnings.length>0&&<div className="gsearch-warning" role="status">搜索范围提示：{c.warnings.join('；')}</div>}
    {c.error&&<p className="gsearch-warning" role="alert">{c.error}</p>}
    <div className="gsearch-filters"><button className={!module?'active':''} onClick={()=>setModule('')}>全部 {all.length||''}</button>{modules.map(m=><button key={m} className={module===m?'active':''} onClick={()=>setModule(m)}>{m}<small>{all.filter(r=>r.entry.target.module===m).length}</small></button>)}<label><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>包含已归档内容</label></div>
    {!query.trim()?<div className="gsearch-empty"><FileSearch size={42}/><h3>从一个关键词开始</h3><p>可以搜索名称、正文、配置内容和素材生成提示词。</p><small>仅搜索当前项目 · 不读取素材文件正文</small></div>:<><p className="gsearch-count" role="status">{c.query!==query?'正在搜索…':`找到 ${results.length} 条结果`}</p><div className={'gsearch-content'+(preview?' has-preview':'')}><div className="gsearch-results">{results.slice(0,limit).map(({entry,snippet})=><article key={entry.key} className={'gsearch-result'+(selected===entry.key?' selected':'')}><div className="gsearch-result-meta"><span>{entry.path}</span>{entry.archived&&<b>已归档</b>}{entry.status&&<span>{entry.status}</span>}</div><button className="gsearch-title" aria-label={'打开搜索结果：'+entry.title} onClick={()=>c.open(entry)}><Highlight text={entry.title} query={query}/><ArrowUpRight size={17}/></button><p><Highlight text={snippet} query={query}/></p><div className="gsearch-result-actions"><small>ID：{entry.target.id}</small><button aria-label={'预览搜索结果：'+entry.title} onClick={()=>setSelected(entry.key)}>预览与关联</button></div></article>)}{!results.length&&<div className="gsearch-empty"><h3>未找到匹配内容</h3><p>试试更短的关键词，或调整模块和归档筛选。</p></div>}{results.length>limit&&<button className="gp-secondary gsearch-more" onClick={()=>setLimit(n=>n+40)}>显示更多结果（{limit} / {results.length}）</button>}</div>{preview&&<aside className="gsearch-preview" aria-label="搜索结果预览"><div className="gsearch-preview-heading"><strong>{preview.title}</strong><button aria-label="关闭搜索预览" onClick={()=>setSelected('')}><X size={18}/></button></div><small>{preview.path}</small><pre><Highlight text={preview.body} query={query}/></pre><button className="gp-secondary" onClick={()=>c.open(preview)}>打开内容 <ArrowUpRight size={16}/></button><h4>已有直接关联 · {related.length}</h4>{related.length?related.map(e=><button className="gsearch-related" key={e.key} onClick={()=>c.open(e)}><small>{e.path}</small>{e.title}</button>):<p>暂无已登记的直接关联。</p>}</aside>}</div></>}
  </section>;
}
