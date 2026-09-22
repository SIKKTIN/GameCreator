import {useEffect,useRef,useState} from 'react';
import {ArrowDownToLine,CheckCircle2,MessageSquare,RefreshCw} from 'lucide-react';
import type {EngineConfig} from './engine';
import type {CollaborationSource,FeedbackEntry,FeedbackScan} from './engine-sync';
import {beforeLogoutEvent} from './auth';

type Props={projectId:string;config:EngineConfig;collaboration:CollaborationSource;blockedReason:string;onApplied:()=>boolean};
export function EngineFeedbackPanel({projectId,config,collaboration,blockedReason,onApplied}:Props) {
  const api=window.desktopClient?.engineSync;
  const [scan,setScan]=useState<FeedbackScan>(),[selected,setSelected]=useState(''),[decisions,setDecisions]=useState<Record<string,'keep'|'feedback'>>({});
  const [confirmed,setConfirmed]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[view,setView]=useState('pending');
  const running=useRef(false),alive=useRef(true),tokens=useRef<string[]>([]);
  const blocked=blockedReason||(!api?'开发反馈需要桌面客户端。':!config.projectPath?'请先连接并保存游戏工程目录。':'');
  const source=JSON.stringify(collaboration),lastSource=useRef(source);
  const discard=()=>{for(const token of tokens.current)void api?.release(token);tokens.current=[];setScan(undefined);setSelected('');setDecisions({});setConfirmed(false);};
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;for(const token of tokens.current)void api?.release(token);};},[]);
  useEffect(()=>{if(lastSource.current!==source){lastSource.current=source;discard();}},[source]);
  useEffect(()=>{if(blocked)discard();},[blocked]);
  useEffect(()=>{
    const guard=(e:Event)=>{if(running.current)e.preventDefault();};
    const unload=(e:BeforeUnloadEvent)=>{if(running.current){e.preventDefault();e.returnValue='';}};
    window.addEventListener(beforeLogoutEvent,guard);window.addEventListener('beforeunload',unload);
    return()=>{window.removeEventListener(beforeLogoutEvent,guard);window.removeEventListener('beforeunload',unload);};
  },[]);
  async function run(operation:()=>Promise<void>){if(running.current||blocked)return;running.current=true;setBusy(true);setError('');setNotice('');try{await operation();}catch(e){if(alive.current)setError(String(e).replace(/^Error: Error invoking remote method '[^']+': (?:Error: )?/,''));}finally{running.current=false;if(alive.current)setBusy(false);}}
  const readFeedback=()=>run(async()=>{
    if(!api)return;const requestedSource=source;discard();const result=await api.feedbackScan({projectId,config,collaboration});
    if(!alive.current||lastSource.current!==requestedSource){for(const e of result.entries)if(e.token)void api.release(e.token);return;}
    tokens.current=result.entries.flatMap(e=>e.token?[e.token]:[]);setScan(result);setSelected(result.entries.find(e=>e.state==='pending')?.path||result.entries.find(e=>e.state==='invalid')?.path||'');
  });
  const entry=scan?.entries.find(e=>e.path===selected);
  const choose=(e:FeedbackEntry)=>{setSelected(e.path);setDecisions({});setConfirmed(false);setNotice('');};
  const apply=(dismiss:boolean)=>run(async()=>{
    if(!api||!entry?.token)return;
    const result=await api.feedbackApply({token:entry.token,decisions,dismiss,acceptCompletion:confirmed});
    const loaded=onApplied();
    if(alive.current){discard();setNotice((dismiss?'反馈已忽略，开发内容保持原样。':'反馈已应用，排期和开发工具已刷新。')+(result.warning?' '+result.warning:'')+(!loaded?' 当前模块存在未保存草稿，请先处理草稿后重新读取。':''));}
  });
  const repair=()=>run(async()=>{if(!api)return;const result=await api.feedbackRepair({projectId,config});if(alive.current){setScan(s=>s?{...s,missingReceipts:[]}:s);setNotice('已补写 '+result.count+' 份处理回执。');}});
  const unresolved=entry?.rows.some(r=>r.state==='conflict'&&!decisions[r.field]);
  const completing=entry?.rows.some(r=>r.field==='status'&&r.state!=='unchanged'&&decisions[r.field]!=='keep'&&['已完成','可使用'].includes(r.incoming));
  const pending=scan?.entries.filter(e=>e.state!=='processed')||[];
  return <section className="engine-content ef-panel" aria-label="开发反馈">
    <div className="es-section-heading"><div><h3>把开发成果带回项目</h3><p>读取工程中的反馈，比较字段变化，再更新任务进度与工具交付。</p></div><button className="primary" disabled={busy||!!blocked} onClick={()=>void readFeedback()}><RefreshCw size={16}/>{busy?'处理中…':'读取开发反馈'}</button></div>
    <div className="es-target-path"><span>开发者 / AI 提交反馈的位置</span><output>{config.projectPath?config.projectPath.replace(/[\\/]+$/,'')+'/gamecreator/feedback/':'尚未连接工程'}</output><small>先在“同步配置”开启开发协作并同步。填写规范与 JSON 模板位于 gamecreator/README.md。</small></div>
    {blocked&&<p className="es-notice">{blocked}</p>}{error&&<p className="es-error" role="alert">{error}</p>}{notice&&<p className="es-success" role="status"><CheckCircle2 size={17}/>{notice}</p>}
    {!!scan?.missingReceipts.length&&<div className="es-notice"><p>{scan.missingReceipts.length} 份工程回执缺失或内容不一致。项目中的处理记录已保存，补写回执不会再次修改任务。</p><button className="gp-secondary" disabled={busy||!!blocked} onClick={()=>void repair()}>补写回执</button></div>}
    <div className="ef-tabs"><button className={view==='pending'?'active':''} onClick={()=>setView('pending')}>待处理反馈 {pending.length}</button><button className={view==='history'?'active':''} onClick={()=>setView('history')}>处理记录 {scan?.history.length||0}</button></div>
    {!scan?<div className="es-empty"><MessageSquare size={36}/><h3>等待工程中的开发反馈</h3><p>支持任务状态、实际日期、开发结果，以及工具状态、使用说明与交付位置。</p></div>:view==='history'?<div>
      {!scan.history.length&&<p className="es-notice">尚无处理记录。</p>}
      {scan.history.map(r=><details className="es-history" key={r.id}><summary><span className={'es-state '+(r.outcome==='applied'?'added':'unchanged')}>{r.outcome==='applied'?'已应用':'已忽略'}</span><b>{r.title}</b><span>{new Date(r.at).toLocaleString()}</span></summary><p>{r.author} · {r.summary}</p><code>{r.id}</code>{r.evidence.map((v,i)=><p className="ef-text" key={i}>{v}</p>)}{r.rows.map(row=><p className="ef-text" key={row.field}>{row.label}：{r.decisions[row.field]==='keep'?'保留 '+(row.current||'空值'):(row.current||'空值')+' → '+(row.incoming||'空值')}</p>)}</details>)}
    </div>:!pending.length?<div className="es-empty"><CheckCircle2 size={36}/><h3>没有待处理反馈</h3><p>新反馈放入工程目录后，点击“读取开发反馈”。已处理的更新不会重复应用。</p></div>:<div className="ef-workbench">
      <nav className="ef-list" aria-label="反馈目录">{pending.map(e=><button key={e.path} className={selected===e.path?'active':''} onClick={()=>choose(e)} disabled={busy}><span className={'es-state '+(e.state==='invalid'?'conflict':e.rows.some(r=>r.state==='conflict')?'updated':'added')}>{e.state==='invalid'?'需修正':e.rows.some(r=>r.state==='conflict')?'存在冲突':'待处理'}</span><b>{e.title||e.path.split('/').pop()}</b><small>{e.feedback?.summary||e.error}</small></button>)}</nav>
      <article className="ef-detail">{entry?.state==='invalid'?<><h3>反馈无法接收</h3><p className="es-error">{entry.error}</p><code>{entry.path}</code><p>按协作说明修正文件后重新读取。已处理的反馈需要使用新的更新编号。</p></>:entry?.feedback&&<>
        <div className="es-section-heading"><div><span className="es-state">{entry.feedback.target.kind==='task'?'制作任务':'开发工具'}</span><h3>{entry.title}</h3><p>{entry.feedback.author} · {entry.feedback.summary}</p></div></div>
        <code>{entry.path}</code>
        {!!entry.feedback.evidence.length&&<details open className="ef-evidence"><summary>开发依据 / 测试结果</summary>{entry.feedback.evidence.map((v,i)=><p className="ef-text" key={i}>{v}</p>)}</details>}
        {entry.designChanged&&<p className="es-notice">目标的其他字段在导出后也有变化，请结合最新需求核对本次反馈。</p>}
        <div className="ef-diff">{entry.rows.map(r=><section className="ef-field" key={r.field}><header><b>{r.label}</b><span className={'es-state '+r.state}>{r.state==='conflict'?'双方均有修改':r.state==='unchanged'?'当前值已一致':'可更新'}</span></header><div className="ef-values"><div><small>导出时</small><p>{r.base||'（空）'}</p></div><div><small>GameCreator 当前</small><p>{r.current||'（空）'}</p></div><div><small>开发反馈</small><p>{r.incoming||'（空）'}</p></div></div>{r.state!=='unchanged'&&<label>处理方式<select aria-label={'反馈处理 '+r.label} disabled={busy} value={decisions[r.field]||(r.state==='conflict'?'':'feedback')} onChange={e=>setDecisions(d=>({...d,[r.field]:e.target.value as 'keep'|'feedback'}))}>{r.state==='conflict'&&<option value="">请选择</option>}<option value="feedback">采用反馈值</option><option value="keep">保留当前值</option></select></label>}</section>)}</div>
        {completing&&<label className="es-checkbox ef-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/>已核实交付与验收情况，接收“已完成 / 可使用”状态</label>}
        <p className="ef-hint">只处理上方字段；任务、工具和里程碑的状态分别维护。</p>
        <div className="es-footer"><button className="gp-secondary" disabled={busy||!!blocked} onClick={()=>void apply(true)}>忽略本条反馈</button><button className="primary" disabled={busy||!!blocked||unresolved||!!completing&&!confirmed} onClick={()=>void apply(false)}><ArrowDownToLine size={16}/>应用反馈</button></div>
      </>}</article>
    </div>}
  </section>;
}
