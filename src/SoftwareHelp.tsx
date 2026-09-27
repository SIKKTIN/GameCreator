import {createElement,useState} from 'react';
import {createPortal} from 'react-dom';
import {Copy,Download,X} from 'lucide-react';
import {gamecreatorGuide,guideVersion} from '../shared/gamecreator-guide.mjs';
import {builtinStandardsMarkdown,projectStandardRules,standardModules,updateSteps,type StandardScope} from './project-standards';
import {storyBlocks} from './story-library';
import './usage-guide.css';
import './project-standards.css';
import './software-help.css';

export type HelpPage='操作说明'|'通用规范';
export function SoftwareHelp({page,onPage,onClose}:{page:HelpPage;onPage:(page:HelpPage)=>void;onClose:()=>void}){
 const [scope,setScope]=useState<StandardScope>('general'),[notice,setNotice]=useState('');
 const text=page==='操作说明'?gamecreatorGuide():builtinStandardsMarkdown();
 const download=()=>{const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=page==='操作说明'?'GAMECREATOR_GUIDE.md':'GAMECREATOR_RULES.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return createPortal(<dialog className="software-help usage-guide" aria-label="使用帮助" ref={node=>{if(node&&!node.open)node.showModal();}} onCancel={e=>{e.preventDefault();onClose();}}>
  <header className="help-heading"><div><small>GAMECREATOR HELP</small><h2>使用帮助</h2><p>固定的操作说明与通用协作规则，适用于所有项目。</p></div><button aria-label="关闭使用帮助" onClick={onClose}><X/></button></header>
  <div className="ps-tabs" role="tablist" aria-label="使用帮助文档">{(['操作说明','通用规范'] as const).map(p=><button key={p} role="tab" aria-selected={page===p} onClick={()=>{setNotice('');onPage(p);}}>{p}</button>)}</div>
  <div className="ug-toolbar"><span>内置文档 · {guideVersion}</span><button onClick={()=>void navigator.clipboard.writeText(text).then(()=>setNotice('文档已复制')).catch(()=>setNotice('复制失败，请下载文档'))}><Copy size={16}/>复制文档</button><button onClick={download}><Download size={16}/>下载文档</button></div>{notice&&<p role="status">{notice}</p>}
  {page==='操作说明'?<article className="ug-reader">{storyBlocks(text).map(b=>b.kind==='heading'?createElement('h'+b.level,{key:b.line},b.text):b.kind==='code'?<pre key={b.line}>{b.text}</pre>:<p key={b.line}>{b.text}</p>)}</article>:<section className="ps-standards"><label className="ps-module-picker">规则范围<select aria-label="通用规范范围" value={scope} onChange={e=>setScope(e.target.value as StandardScope)}>{Object.entries(standardModules).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><div className="ps-rules">{projectStandardRules.filter(r=>r.scope===scope).map(r=><article key={r.id}><span className="ps-badge">内置规范 · {standardModules[r.scope]}</span><h3>{r.title}</h3><p>{r.body}</p><div className="ps-example">例如：{r.example}</div></article>)}</div><h3>每次更新的通用步骤</h3><div className="ps-steps">{updateSteps.map(([title,body],i)=><article key={title}><b>{i+1}</b><div><h4>{title}</h4><p>{body}</p></div></article>)}</div></section>}
 </dialog>,document.body);
}
