import {useEffect,useRef,useState} from 'react';
import {CheckCircle2,FolderSync,RefreshCw,Rocket} from 'lucide-react';
import type {SavedProject} from './project-catalog';
import type {AiDocument} from './ai-export';
import type {ArtStore} from './art-assets';
import type {CollaborationSource,SyncPlan} from './engine-sync';
import type {AuthoringInput} from '../shared/project-authoring.mjs';
import {beforeLogoutEvent} from './auth';
import './project-startup.css';

type StartupStatus={engineDirectory:string;projectDirectory:string;entryDirectory:string;docsDirectory:string;initializedAt:string;initializedEntry:string;blockers:string[];members:{id:string;name:string;producer:boolean;credentialId?:string;error:string;path:string}[];plan?:SyncPlan;message?:string};
export type ProjectStartupAPI=(operation:'status'|'preview'|'initialize'|'release',input:{projectId?:string;entryDirectory?:string;docsDirectory?:string;expectedEntries?:AuthoringInput['expectedEntries'];document?:AiDocument;art?:ArtStore;collaboration?:CollaborationSource;token?:string;decisions?:Record<string,'keep'|'replace'>;removals?:string[]})=>Promise<Partial<StartupStatus>>;
export function ProjectStartup({project,build,art,collaboration,snapshot,blockedReason,onNavigate,onSaveProject}:{project:SavedProject;build:()=>AiDocument;art:ArtStore;collaboration:CollaborationSource;snapshot:()=>AuthoringInput['expectedEntries'];blockedReason:string;onNavigate:(name:string)=>void;onSaveProject?:()=>void}){
 const api=window.desktopClient?.projectStartup,[status,setStatus]=useState<Partial<StartupStatus>>({}),[entry,setEntry]=useState('gamecreator'),[docs,setDocs]=useState('docs/gamecreator'),[plan,setPlan]=useState<SyncPlan>(),[decisions,setDecisions]=useState<Record<string,'keep'|'replace'>>({}),[removals,setRemovals]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const lock=useRef(false),alive=useRef(true),token=useRef('');
 const release=()=>{if(token.current)void api?.('release',{token:token.current});token.current='';setPlan(undefined);setDecisions({});setRemovals([]);};
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(token.current)void api?.('release',{token:token.current});};},[api]);
 useEffect(()=>{const guard=(e:Event)=>{if(lock.current)e.preventDefault();};window.addEventListener(beforeLogoutEvent,guard);return()=>window.removeEventListener(beforeLogoutEvent,guard);},[]);
 async function run(op:'status'|'preview'|'initialize',initial=false){
  if(!api||lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');
  try{
   if(op!=='initialize')release();
   const result=await api(op,{projectId:project.id,...(initial?{}:{entryDirectory:entry,docsDirectory:docs}),...(op==='preview'?{expectedEntries:snapshot(),document:build(),art,collaboration}:{}),...(op==='initialize'?{token:plan?.token,decisions,removals}:{})});
   if(!alive.current){if(result.plan)void api('release',{token:result.plan.token});return;}
   setStatus(result);if(initial){setEntry(result.entryDirectory||'gamecreator');setDocs(result.docsDirectory||'docs/gamecreator');}
   if(result.plan){token.current=result.plan.token;setPlan(result.plan);}if(result.message){release();setNotice(result.message);}
  }catch(e){if(alive.current){setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));if(op==='initialize')release();}}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 useEffect(()=>{void run('status',true);},[project.id,project.config.projectPath,project.config.engine]);
 const blocked=busy||!!blockedReason||!api;
 return <section className="project-startup" aria-label="项目启动">
  <header className="startup-hero"><div><small>PROJECT STARTUP</small><h2>准备协作环境，开始项目开发。</h2><p>连接引擎、准备制作人与开发者令牌，再生成协作入口和分类文档。</p></div><Rocket size={32}/></header>
  {error&&<p role="alert" className="es-error">{error}</p>}{notice&&<p role="status" className="es-success"><CheckCircle2 size={18}/>{notice}</p>}
  {(blockedReason||!api)&&<p className="es-notice">{blockedReason||'项目初始化需要桌面客户端。'}</p>}
  <div className="startup-checks">
   <article><h3>1 · 工程与管理项目</h3><p>引擎工程</p><code>{project.config.projectPath||'尚未连接'}</code><p>GameCreator 项目</p><code>{project.folderPath||'尚未保存到独立文件夹'}</code><div className="startup-actions"><button disabled={busy} onClick={()=>onNavigate('工程连接')}>配置工程连接</button>{!project.folderPath&&<button disabled={busy} onClick={onSaveProject}>保存 GameCreator 项目</button>}</div></article>
   <article><h3>2 · 制作人与开发者</h3><p>至少一位制作人需要项目范围、项目写入权限和有效长期令牌。初始化导出当前启用成员的凭证。</p><ul>{status.members?.map(m=><li key={m.id}><b>{m.name}{m.producer&&m.name!=='制作人'?' · 制作人':''}</b><span>{m.error||'凭证可用'}</span></li>)}</ul>{!status.members?.length&&<p>尚未准备开发者身份。</p>}<button disabled={busy} onClick={()=>onNavigate('人员分配')}>配置人员与令牌</button></article>
  </div>
  <article className="startup-output"><h3>3 · 初始化输出</h3><div className="startup-paths"><label>协作入口子目录<input aria-label="协作入口子目录" disabled={busy} value={entry} onChange={e=>{setEntry(e.target.value);release();}}/><small>相对于引擎根目录。包含 README.md 与 personal/；开发反馈仍使用 gamecreator/feedback。</small></label><label>设计文档子目录<input aria-label="初始化文档子目录" disabled={busy} value={docs} onChange={e=>{setDocs(e.target.value);release();}}/><small>按项目指南、项目管理、玩法与关卡、系统与开发、内容制作、数据与同步分类。</small></label></div><p>完整编写工具仍生成在 GameCreator 项目的 ai/；引擎入口会写明目标位置和整套流程。personal/ 保存各成员完整凭证 JSON，按成员 ID 命名，并自动加入 Git 忽略规则。</p><p>重复初始化复用已有身份与令牌；文件冲突需要明确处理。历史令牌缺少私钥时，请先在人员分配导入凭证或更换令牌。</p>
   {!!status.blockers?.length&&<ul className="startup-blockers">{status.blockers.map(b=><li key={b}>{b}</li>)}</ul>}
   {status.initializedAt&&<p>上次完成：{new Date(status.initializedAt).toLocaleString()} · <code>{status.initializedEntry}</code></p>}
   <div className="startup-actions"><button disabled={blocked} onClick={()=>void run('status')}><RefreshCw size={16}/>检查准备状态</button><button className="primary" disabled={blocked||!project.folderPath||!project.config.projectPath} onClick={()=>void run('preview')}><FolderSync size={16}/>预览初始化</button><button disabled={busy} onClick={()=>onNavigate('工程同步')}>进入工程同步</button><button disabled={busy} onClick={()=>onNavigate('使用说明')}>进入项目编写</button></div>
  </article>
  {plan&&<article className="startup-output"><h3>确认初始化内容</h3><p>{plan.rows.filter(r=>r.status!=='unchanged').length} 项文档变更 · {status.members?.length||0} 份成员凭证。凭证内容不会出现在预览或同步备份中。</p><details><summary>查看文档与目录变更</summary>{plan.rows.filter(r=>r.status!=='unchanged').map(r=><div className="startup-file" key={r.path}><code>{r.path}</code><span>{r.remove?'旧位置待移除':r.status==='conflict'?'存在冲突':r.status==='added'?'新增':'更新'}</span>{r.status==='conflict'&&<select aria-label={'初始化冲突 '+r.path} value={decisions[r.path]||''} disabled={busy} onChange={e=>setDecisions(d=>({...d,[r.path]:e.target.value as 'keep'|'replace'}))}><option value="">请选择</option><option value="keep">保留工程文件</option><option value="replace">备份并使用生成内容</option></select>}{r.remove&&<label><input type="checkbox" checked={removals.includes(r.path)} disabled={busy} onChange={e=>setRemovals(v=>e.target.checked?[...v,r.path]:v.filter(p=>p!==r.path))}/>确认移除旧位置</label>}</div>)}</details><button className="primary" disabled={blocked||plan.rows.some(r=>r.status==='conflict'&&!decisions[r.path])} onClick={()=>void run('initialize')}><Rocket size={16}/>{busy?'正在初始化…':'初始化项目'}</button></article>}
 </section>;
}
