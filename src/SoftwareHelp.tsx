import {createElement,useEffect,useState} from 'react';
import workflowOverview from '../docs/workflow-overview.md?raw';
import artWorkflow from '../docs/art-workflow.md?raw';
import {Copy,Download} from 'lucide-react';
import {gamecreatorGuide,guideVersion} from '../shared/gamecreator-guide.mjs';
import {builtinStandardsMarkdown,projectStandardRules,standardModules,updateSteps,type StandardScope} from './project-standards';
import {storyBlocks} from './story-library';
import './usage-guide.css';
import './project-standards.css';
import './software-help.css';

export const helpPages=['工作流总览','美术工作流','操作说明','通用规范'] as const;
export type HelpPage=typeof helpPages[number];
export function isHelpPage(page:string):page is HelpPage{return helpPages.some(p=>p===page);}
export function SoftwareHelp({page,onPage}:{page:HelpPage;onPage:(page:HelpPage)=>void}){
 const [scope,setScope]=useState<StandardScope>('general'),[notice,setNotice]=useState('');
 useEffect(()=>setNotice(''),[page]);
 const text=page==='工作流总览'?workflowOverview:page==='美术工作流'?artWorkflow:page==='操作说明'?gamecreatorGuide():builtinStandardsMarkdown();
 const download=()=>{const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=page==='工作流总览'?'GAMECREATOR_WORKFLOW.md':page==='美术工作流'?'GAMECREATOR_ART_WORKFLOW.md':page==='操作说明'?'GAMECREATOR_GUIDE.md':'GAMECREATOR_RULES.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return <section className="software-help usage-guide" aria-label="使用帮助">
  <div className="help-heading"><small>GAMECREATOR HELP</small><h2>使用帮助</h2><p>从工作流总览了解全程，再查阅操作说明与通用规范。</p></div>
  <div className="ps-tabs" role="tablist" aria-label="使用帮助文档">{helpPages.map(p=><button key={p} role="tab" aria-selected={page===p} onClick={()=>{setNotice('');onPage(p);}}>{p}</button>)}</div>
  <div className="ug-toolbar"><span>内置文档 · {guideVersion}</span><button onClick={()=>void navigator.clipboard.writeText(text).then(()=>setNotice('文档已复制')).catch(()=>setNotice('复制失败，请下载文档'))}><Copy size={16}/>复制文档</button><button onClick={download}><Download size={16}/>下载文档</button></div>{notice&&<p role="status">{notice}</p>}
  {page!=='通用规范'?<article className="ug-reader">{storyBlocks(text).map(b=>b.kind==='heading'?createElement('h'+b.level,{key:b.line},b.text):b.kind==='code'?<pre key={b.line}>{b.text}</pre>:<p key={b.line}>{b.text}</p>)}</article>:<section className="ps-standards"><label className="ps-module-picker">规则范围<select aria-label="通用规范范围" value={scope} onChange={e=>setScope(e.target.value as StandardScope)}>{Object.entries(standardModules).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><div className="ps-rules">{projectStandardRules.filter(r=>r.scope===scope).map(r=><article key={r.id}><span className="ps-badge">内置规范 · {standardModules[r.scope]}</span><h3>{r.title}</h3><p>{r.body}</p><div className="ps-example">例如：{r.example}</div></article>)}</div><h3>每次更新的通用步骤</h3><div className="ps-steps">{updateSteps.map(([title,body],i)=><article key={title}><b>{i+1}</b><div><h4>{title}</h4><p>{body}</p></div></article>)}</div></section>}
 </section>;
}
