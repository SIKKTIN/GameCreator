import {useEffect,useState} from 'react';
import {BookOpenCheck,GitCompareArrows,Layers,ShieldCheck} from 'lucide-react';
import {projectStandardRules,standardModules,updateSteps,type StandardScope} from './project-standards';
import type {ProjectStandardsController} from './useProjectStandards';
import {checkProjectStructure,type StandardsSources} from '../shared/project-standards-checks.mjs';
import './project-standards.css';
import {useLeaveSearch} from './GlobalSearch';

export function ProjectStandards({controller,sources,sourceError,requestedId,onNavigate}:{controller:ProjectStandardsController;sources:StandardsSources;sourceError:string;requestedId?:string;onNavigate:(name:string)=>void}){
  const [tab,setTab]=useState('general'),[scope,setScope]=useState<Exclude<StandardScope,'general'>>('core');
  const leaveSearch=useLeaveSearch('项目规范');
  const rule=projectStandardRules.find(r=>r.id===requestedId);
  useEffect(()=>{if(rule){setTab(rule.scope==='general'?'general':'modules');if(rule.scope!=='general')setScope(rule.scope);}else if(requestedId==='supplement')setTab('general');},[requestedId]);
  const visible=projectStandardRules.filter(r=>r.scope===(tab==='general'?'general':scope));
  const issues=checkProjectStructure(sources),errors=issues.filter(i=>i.severity==='error').length;
  const backup=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(controller.store,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='project-standards-draft.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return <section className="ps-standards" aria-label="项目规范">
    <div className="ps-hero"><div><small>PROJECT STANDARDS</small><h2>先兼容已有结构，再扩展新的内容。</h2><p>统一内容归属、更新方式与验收要求，供所有岗位和 AI 开发者共同遵循。</p></div><ShieldCheck size={38}/></div>
    <div className="ps-summary"><span><b>{projectStandardRules.length}</b> 条通用规范</span><span>适用于不同游戏类型与引擎</span><span>随 AI 文档与工程协作同步</span></div>
    {controller.error&&<div className="gp-save-error" role="alert"><p>{controller.error}</p>{controller.pending&&<button onClick={controller.retry}>重试保存规范</button>}<button onClick={backup}>下载规范草稿</button><button onClick={()=>{if(!controller.pending||window.confirm('重新读取会放弃未保存的规范补充，可先下载草稿。是否继续？'))controller.reload();}}>重新读取规范</button></div>}
    <div className="ps-tabs" role="tablist" aria-label="规范页签">{[['general','通用规则',BookOpenCheck],['modules','模块组织',Layers],['checks','更新检查',GitCompareArrows]].map(([id,label,Icon])=><button type="button" role="tab" aria-selected={tab===id} key={String(id)} onClick={()=>{if(tab!==id)leaveSearch();setTab(String(id));}}>{typeof Icon!=='string'&&<Icon size={17}/>} {String(label)}</button>)}</div>
    {tab==='checks'?<>
      <div className="ps-section-heading"><div><h3>当前结构检查</h3><p>检查玩法分类、核心流程、功能关联与排期依赖。只读检查，不移动、合并或删除内容。</p></div><b>{errors} 项结构问题 · {issues.length-errors} 项待复核</b></div>
      {sourceError&&<p className="ps-warning" role="alert">{sourceError}；当前结果不代表完整检查通过。</p>}
      {!issues.length?<p className="ps-clear">已读取的范围内未发现结构问题。是否重复实现、分类是否合理，仍需结合需求复核。</p>:<div className="ps-issues">{issues.map((issue,i)=><article key={issue.module+issue.id+i} className={issue.severity}><span>{issue.severity==='error'?'结构问题':'建议复核'} · {issue.module}</span><p>{issue.message}</p><button onClick={()=>onNavigate(issue.module)}>前往{issue.module}</button></article>)}</div>}
      <h3>每次更新都经过这六步</h3><div className="ps-steps">{updateSteps.map(([title,body],i)=><article key={title}><b>{String(i+1).padStart(2,'0')}</b><div><h4>{title}</h4><p>{body}</p></div></article>)}</div>
      <div className="ps-plan"><h3>提交前说明兼容方案</h3><p>复用哪些内容、修改哪些条目、为什么新增、哪些需要归档。标明归属和影响，没有则写“无”。需求与项目修改反馈会展示这四项供管理者核对。</p></div>
    </>:<>
      {tab==='modules'&&<label className="ps-module-picker">模块组织规则<select aria-label="模块组织规则" value={scope} onChange={e=>{leaveSearch();setScope(e.target.value as typeof scope);}}>{Object.entries(standardModules).filter(([id])=>id!=='general').map(([id,title])=><option key={id} value={id}>{title}</option>)}</select></label>}
      <div className="ps-rules">{visible.map(r=><article key={r.id} className={requestedId===r.id?'ps-highlight':''}><span className="ps-badge">内置规范 · {standardModules[r.scope]}</span><h3>{r.title}</h3><p>{r.body}</p><div className="ps-example">例如：{r.example}</div></article>)}</div>
      <label className="ps-supplement">{tab==='general'?'本项目通用补充':standardModules[scope]+' · 本项目补充'}<textarea aria-label={tab==='general'?'本项目通用补充':'本模块规范补充'} rows={5} maxLength={tab==='general'?30000:10000} disabled={controller.blocked} value={tab==='general'?controller.store.notes:controller.store.moduleNotes[scope]||''} onChange={e=>{const text=e.target.value;controller.update(s=>tab==='general'?{...s,notes:text}:{...s,moduleNotes:{...s.moduleNotes,[scope]:text}});}} placeholder="补充项目特有的命名、边界或兼容要求；与通用规则冲突时，先明确处理依据。"/><small>{controller.pending?'修改尚未保存':'补充内容自动保存，仅影响当前项目。内置通用规则由版本统一维护。'}</small></label>
    </>}
  </section>;
}
