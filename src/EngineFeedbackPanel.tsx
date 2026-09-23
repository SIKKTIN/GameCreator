import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowDownToLine,CheckCircle2,MessageSquare,RefreshCw} from 'lucide-react';
import type {EngineConfig} from './engine';
import type {CollaborationSource,FeedbackEntry,FeedbackScan,FeedbackApplyResult} from './engine-sync';
import {feedbackBatchItems,validateFeedbackHistory,type FeedbackReceipt} from '../shared/engine-feedback.mjs';
import {beforeLogoutEvent} from './auth';
import './engine-feedback.css';

type Props={projectId:string;config:EngineConfig;collaboration:CollaborationSource;blockedReason:string;onApplied:()=>boolean};
export function EngineFeedbackPanel({projectId,config,collaboration,blockedReason,onApplied}:Props) {
  const api=window.desktopClient?.engineSync;
  const [scan,setScan]=useState<FeedbackScan>(),[selected,setSelected]=useState(''),[decisions,setDecisions]=useState<Record<string,'keep'|'feedback'>>({});
  const [confirmed,setConfirmed]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[view,setView]=useState('pending');
  const [batchConfirmed,setBatchConfirmed]=useState(false),[batchReport,setBatchReport]=useState<{path:string;reason:string}[]>([]);
  const [recent,setRecent]=useState<FeedbackReceipt[]>([]),[refresh,setRefresh]=useState(0);
  const running=useRef(false),alive=useRef(true),tokens=useRef<string[]>([]),queued=useRef(false);
  const blocked=blockedReason||(!api?'开发反馈需要桌面客户端。':!config.projectPath?'请先连接并保存游戏工程目录。':'');
  const source=JSON.stringify(collaboration),latest=useRef({source,collaboration,blocked});latest.current={source,collaboration,blocked};
  const localHistory=useMemo(()=>{
    try{return [...validateFeedbackHistory(collaboration.schedule.feedbackHistory,'task'),...validateFeedbackHistory(collaboration.tools.feedbackHistory,'tool')];}
    catch{return [];}
  },[source]);
  const history=[...new Map([...(scan?.history||[]),...localHistory,...recent].filter(r=>r.projectId===projectId&&r.engine===config.engine).map(r=>[r.id,r])).values()].sort((a,b)=>b.at.localeCompare(a.at));
  // Invalidate reviewed tokens, but keep visible history and the previous list while reading.
  const invalidate=()=>{for(const token of tokens.current)void api?.release(token);tokens.current=[];setScan(s=>s?{...s,entries:s.entries.map(e=>({...e,token:undefined}))}:s);setDecisions({});setConfirmed(false);setBatchConfirmed(false);};
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;for(const token of tokens.current)void api?.release(token);};},[]);
  useEffect(()=>{
    const guard=(e:Event)=>{if(running.current)e.preventDefault();};
    const unload=(e:BeforeUnloadEvent)=>{if(running.current){e.preventDefault();e.returnValue='';}};
    window.addEventListener(beforeLogoutEvent,guard);window.addEventListener('beforeunload',unload);
    return()=>{window.removeEventListener(beforeLogoutEvent,guard);window.removeEventListener('beforeunload',unload);};
  },[]);
  async function run(operation:()=>Promise<void>,clearNotice=true){
    if(running.current||latest.current.blocked)return;running.current=true;setBusy(true);setError('');if(clearNotice)setNotice('');
    try{await operation();}catch(e){if(alive.current)setError(String(e).replace(/^Error: Error invoking remote method '[^']+': (?:Error: )?/,''));}
    finally{running.current=false;if(alive.current){setBusy(false);if(queued.current){queued.current=false;setRefresh(v=>v+1);}}}
  }
  const readFeedback=(manual=true)=>run(async()=>{
    if(!api)return;const request=latest.current;invalidate();if(manual)setBatchReport([]);
    const result=await api.feedbackScan({projectId,config,collaboration:request.collaboration});
    if(!alive.current||latest.current.source!==request.source||latest.current.blocked){for(const e of result.entries)if(e.token)void api.release(e.token);if(alive.current&&!latest.current.blocked)queued.current=true;return;}
    tokens.current=result.entries.flatMap(e=>e.token?[e.token]:[]);setScan(result);
    const pending=result.entries.filter(e=>e.state!=='processed');setSelected(current=>pending.some(e=>e.path===current)?current:pending.find(e=>e.state==='pending')?.path||pending[0]?.path||'');
  },manual);
  // Mount, source changes and completed mutations all read automatically. Queue behind an
  // in-flight operation so its post-save render cannot lose the refresh request.
  useEffect(()=>{
    if(blocked){invalidate();return;}
    if(running.current){queued.current=true;return;}
    void readFeedback(false);
  },[source,blocked,refresh]);
  const entry=scan?.entries.find(e=>e.path===selected);
  const choose=(e:FeedbackEntry)=>{setSelected(e.path);setDecisions({});setConfirmed(false);setNotice('');};
  const recordResults=(results:FeedbackApplyResult[])=>{
    if(!alive.current)return;
    const receipts=results.map(r=>r.receipt);setRecent(old=>[...new Map([...old,...receipts].map(r=>[r.id,r])).values()]);
    setScan(s=>s?{...s,entries:s.entries.map(e=>{
      const receipt=receipts.find(r=>r.id===e.feedback?.id);return receipt?{...e,state:'processed',receipt,token:undefined}:{...e,token:undefined};
    }),missingReceipts:[...new Set([...s.missingReceipts,...results.filter(r=>r.warning).map(r=>r.receipt.id)])]}:s);
  };
  const apply=(dismiss:boolean)=>run(async()=>{
    if(!api||!entry?.token)return;
    try{
      const result=await api.feedbackApply({token:entry.token,decisions,dismiss,acceptCompletion:confirmed});recordResults([result]);
      if(alive.current)setNotice((dismiss?'反馈已忽略，开发内容保持原样。':'反馈已应用，排期和开发工具已刷新。')+(result.warning?' '+result.warning:''));
    }finally{onApplied();queued.current=true;}
  });
  const applyBatch=()=>run(async()=>{
    if(!api||!scan)return;setBatchReport([]);
    const pending=scan.entries.filter(e=>e.state!=='processed'),valid=pending.filter(e=>e.token);
    try{
      const result=await api.feedbackApplyBatch({tokens:valid.map(e=>e.token!),acceptCompletion:batchConfirmed});recordResults(result.applied);
      if(alive.current){
        setBatchReport([...result.failed,...result.skipped,...pending.filter(e=>!e.token).map(e=>({path:e.path,reason:e.error||'需要重新读取'}))]);
        const warnings=result.applied.filter(r=>r.warning).length;
        setNotice('批量处理完成：已应用 '+result.applied.length+' 条，保留待处理 '+(pending.length-result.applied.length-result.failed.length)+' 条，失败 '+result.failed.length+' 条。'+(warnings?' '+warnings+' 份工程回执待补写。':''));
      }
    }finally{onApplied();queued.current=true;}
  });
  const repair=()=>run(async()=>{if(!api)return;const result=await api.feedbackRepair({projectId,config});if(alive.current){setScan(s=>s?{...s,missingReceipts:[]}:s);setNotice('已补写 '+result.count+' 份处理回执。');}});
  const unresolved=entry?.rows.some(r=>r.state==='conflict'&&!decisions[r.field]);
  const completing=entry?.rows.some(r=>r.field==='status'&&r.state!=='unchanged'&&decisions[r.field]!=='keep'&&['已完成','可使用'].includes(r.incoming));
  const pending=scan?.entries.filter(e=>e.state!=='processed')||[];
  const batch=feedbackBatchItems(pending,batchConfirmed),completionCount=feedbackBatchItems(pending,true).ready.length-feedbackBatchItems(pending,false).ready.length;
  return <section className="engine-content ef-panel" aria-label="开发反馈">
    <div className="es-section-heading"><div><h3>把开发成果带回项目</h3><p>进入此页自动读取，处理后立即更新任务进度与处理记录。</p></div><div className="ef-actions"><button className="gp-secondary" disabled={busy||!!blocked} onClick={()=>void readFeedback()}><RefreshCw size={16}/>{busy?'处理中…':'读取开发反馈'}</button><button className="primary" aria-label="一键应用反馈" disabled={busy||!!blocked||!batch.ready.length} onClick={()=>void applyBatch()}><ArrowDownToLine size={16}/>一键应用反馈{batch.ready.length?'（'+batch.ready.length+'）':''}</button></div></div>
    <div className="es-target-path"><span>开发者 / AI 提交反馈的位置</span><output>{config.projectPath?config.projectPath.replace(/[\\/]+$/,'')+'/gamecreator/feedback/':'尚未连接工程'}</output><small>先在“同步配置”开启开发协作并同步。填写规范与 JSON 模板位于 gamecreator/README.md。</small></div>
    {blocked&&<p className="es-notice">{blocked}</p>}{error&&<p className="es-error" role="alert">{error}</p>}{notice&&<p className="es-success" role="status"><CheckCircle2 size={17}/>{notice}</p>}
    {!!scan?.missingReceipts.length&&<div className="es-notice"><p>{scan.missingReceipts.length} 份工程回执缺失或内容不一致。项目中的处理记录已保存，补写回执不会再次修改任务。</p><button className="gp-secondary" disabled={busy||!!blocked} onClick={()=>void repair()}>补写回执</button></div>}
    <div className="ef-tabs"><button className={view==='pending'?'active':''} onClick={()=>setView('pending')}>待处理反馈 {scan?pending.length:'…'}</button><button className={view==='history'?'active':''} onClick={()=>setView('history')}>处理记录 {history.length}</button></div>
    {view==='pending'&&!!pending.length&&<section className="ef-batch-summary" aria-label="批量反馈范围"><p>可一键应用 <b>{batch.ready.length}</b> 条，保留逐条处理 {batch.skipped.length} 条。字段冲突、同一目标多条反馈及异常文件会保留。</p>{completionCount>0&&<label className="es-checkbox"><input type="checkbox" aria-label="批量确认完成状态" disabled={busy||!!blocked} checked={batchConfirmed} onChange={e=>setBatchConfirmed(e.target.checked)}/>已核实 {completionCount} 条完成状态的交付与验收，纳入一键应用</label>}</section>}
    {!!batchReport.length&&<details className="es-notice ef-batch-report"><summary>查看保留或失败的反馈 · {batchReport.length} 条</summary>{batchReport.map(r=><p key={r.path}><b>{scan?.entries.find(e=>e.path===r.path)?.title||r.path}</b>：{r.reason}</p>)}</details>}
    {view==='history'?<div>
      {!history.length&&<p className="es-notice">尚无处理记录。</p>}
      {history.map(r=><details className="es-history" key={r.id}><summary><span className={'es-state '+(r.outcome==='applied'?'added':'unchanged')}>{r.outcome==='applied'?'已应用':'已忽略'}</span><b>{r.title}</b><span>{new Date(r.at).toLocaleString()}</span></summary><p>{r.author} · {r.summary}</p><code>{r.id}</code>{r.evidence.map((v,i)=><p className="ef-text" key={i}>{v}</p>)}{r.rows.map(row=><p className="ef-text" key={row.field}>{row.label}：{r.decisions[row.field]==='keep'?'保留 '+(row.current||'空值'):(row.current||'空值')+' → '+(row.incoming||'空值')}</p>)}</details>)}
    </div>:!scan?<div className="es-empty"><MessageSquare size={36}/><h3>{busy?'正在读取开发反馈…':'尚未读取到工程反馈'}</h3><p>支持任务状态、实际日期、开发结果，以及工具状态、使用说明与交付位置。</p></div>:!pending.length?<div className="es-empty"><CheckCircle2 size={36}/><h3>没有待处理反馈</h3><p>新反馈放入工程目录后，点击“读取开发反馈”。已处理的更新不会重复应用。</p></div>:<div className="ef-workbench">
      <nav className="ef-list" aria-label="反馈目录">{pending.map(e=><button key={e.path} className={selected===e.path?'active':''} onClick={()=>choose(e)} disabled={busy}><span className={'es-state '+(e.state==='invalid'?'conflict':e.rows.some(r=>r.state==='conflict')?'updated':'added')}>{e.state==='invalid'?'需修正':e.rows.some(r=>r.state==='conflict')?'存在冲突':'待处理'}</span><b>{e.title||e.path.split('/').pop()}</b><small>{e.feedback?.summary||e.error}</small></button>)}</nav>
      <article className="ef-detail">{entry?.state==='invalid'?<><h3>反馈无法接收</h3><p className="es-error">{entry.error}</p><code>{entry.path}</code><p>按协作说明修正文件后重新读取。已处理的反馈需要使用新的更新编号。</p></>:entry?.feedback&&<>
        <div className="es-section-heading"><div><span className="es-state">{entry.feedback.target.kind==='task'?'制作任务':'开发工具'}</span><h3>{entry.title}</h3><p>{entry.feedback.author} · {entry.feedback.summary}</p></div></div>
        <code>{entry.path}</code>
        {!!entry.feedback.evidence.length&&<details open className="ef-evidence"><summary>开发依据 / 测试结果</summary>{entry.feedback.evidence.map((v,i)=><p className="ef-text" key={i}>{v}</p>)}</details>}
        {entry.designChanged&&<p className="es-notice">目标的其他字段在导出后也有变化，请结合最新需求核对本次反馈。</p>}
        <div className="ef-diff">{entry.rows.map(r=><section className="ef-field" key={r.field}><header><b>{r.label}</b><span className={'es-state '+r.state}>{r.state==='conflict'?'双方均有修改':r.state==='unchanged'?'当前值已一致':'可更新'}</span></header><div className="ef-values"><div><small>导出时</small><p>{r.base||'（空）'}</p></div><div><small>GameCreator 当前</small><p>{r.current||'（空）'}</p></div><div><small>开发反馈</small><p>{r.incoming||'（空）'}</p></div></div>{r.state!=='unchanged'&&<label>处理方式<select aria-label={'反馈处理 '+r.label} disabled={busy} value={decisions[r.field]||(r.state==='conflict'?'':'feedback')} onChange={e=>setDecisions(d=>({...d,[r.field]:e.target.value as 'keep'|'feedback'}))}>{r.state==='conflict'&&<option value="">请选择</option>}<option value="feedback">采用反馈值</option><option value="keep">保留当前值</option></select></label>}</section>)}</div>
        {completing&&<label className="es-checkbox ef-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/>已核实交付与验收情况，接收“已完成 / 可使用”状态</label>}
        <p className="ef-hint">应用上方字段后，已完成的关联任务会同步工具验收与美术素材进度；里程碑仍需在项目排期确认。</p>
        <div className="es-footer"><button className="gp-secondary" disabled={busy||!!blocked||!entry.token} onClick={()=>void apply(true)}>忽略本条反馈</button><button className="primary" disabled={busy||!!blocked||!entry.token||unresolved||!!completing&&!confirmed} onClick={()=>void apply(false)}><ArrowDownToLine size={16}/>应用反馈</button></div>
      </>}</article>
    </div>}
  </section>;
}
