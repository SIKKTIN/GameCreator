import {DataChanges} from './DataVersions';
import {useEffect,useRef,useState} from 'react';
import {ArrowDownToLine,ArrowUpFromLine,RefreshCw,Save,CheckCircle2} from 'lucide-react';
import {dataDirectory,parseJson,stable,validateMapping,type Decision} from '../shared/data-sync.mjs';
import {savedEngineConfig,type EngineConfig} from './engine';
import type {EnumRegistry} from './useEnumRegistry';
import type {DataSyncPlan,DataSyncFile} from './data-sync';
import {DataSyncComparison} from './DataSyncComparison';
import {pendingDifference} from './data-sync-comparison';
import './data-sync.css';
const message=(e:unknown)=>(e instanceof Error?e.message:String(e)).replace(/^Error invoking remote method '[^']+': Error: /,'');
type Props={projectId:string;config:EngineConfig;setConfig:(v:EngineConfig)=>Promise<boolean>|boolean;registry:EnumRegistry;blocked?:boolean;onOpenTable:(name:string)=>void};
export function DataSyncPanel({projectId,config,setConfig,registry,blocked,onOpenTable}:Props) {
  const api=window.desktopClient?.engineSync;
  const [direction,setDirection]=useState<'import'|'export'|'schema'|'publish'>('import');
  const [version,setVersion]=useState(''),[releaseNote,setReleaseNote]=useState(''),[verified,setVerified]=useState(false);
  const [draft,setDraft]=useState(config),[plan,setPlan]=useState<DataSyncPlan|null>(null);
  const [mappings,setMappings]=useState<Record<string,Record<string,string>>>({});
  const [selected,setSelected]=useState<string[]>([]),[decisions,setDecisions]=useState<Record<string,Record<string,Decision>>>({});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const generation=useRef(0),operation=useRef(false),latest=useRef({projectId,config,revision:registry.store.revision});latest.current={projectId,config,revision:registry.store.revision};
  const dirty=stable(draft)!==stable(config),locked=busy||registry.busy||registry.loading||!!registry.error||!!blocked;
  useEffect(()=>{setDraft(config);setMappings({});},[config]);
  useEffect(()=>{generation.current++;setPlan(null);setSelected([]);setDecisions({});setVerified(false);},[config,projectId,registry.store.revision,direction]);
  useEffect(()=>()=>{generation.current++;},[]);
  useEffect(()=>()=>{if(plan)void api?.dataRelease(plan.token);},[plan,api]);
  const run=async(fn:()=>Promise<void>)=>{if(operation.current||locked)return;operation.current=true;setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(message(e));}finally{operation.current=false;setBusy(false);}};
  const preview=async(next=mappings)=>run(async()=>{
    if(!api)throw new Error('请在桌面客户端中使用数据同步');
    setVerified(false);
    const seq=++generation.current,result=await api.dataPreview({projectId,config,store:registry.store,direction:direction==='import'?'import':'export',...(direction==='import'?{mappings:next}:{})});
    if(seq!==generation.current){void api.dataRelease(result.token);return;}
    setPlan(result);setSelected(result.rows.filter(r=>!r.error&&!r.differences?.some(d=>d.conflict||d.deletion)).map(r=>r.table));setDecisions({});
  });
  const apply=async()=>run(async()=>{
    if(!plan||!api)return;
    await navigator.locks.request(registry.key,async()=>{
      await api.dataApply({token:plan.token,selections:selected.map(table=>({table,decisions:decisions[table]||{}}))});
      if(latest.current.projectId===projectId&&!registry.reload())throw new Error('同步成功，请重新读取配置以显示最新数据');
    });
    setPlan(null);setNotice((direction==='import'?'导入':'同步配置')+'完成，已保存同步基准和恢复备份。');
  });
  const unresolved=plan?.rows.filter(r=>selected.includes(r.table)).some(r=>r.differences?.some(d=>pendingDifference(d,decisions[r.table]||{})));
  function fileCard(row:DataSyncFile) {
    const diffs=row.differences||[],chosen=selected.includes(row.table);
    return <article className="ds-file" key={row.table}>
      <div className="ds-file-head"><label><input type="checkbox" aria-label={'同步 '+row.table} checked={chosen} disabled={!!row.error||locked||direction==='publish'} onChange={e=>setSelected(s=>e.target.checked?[...s,row.table]:s.filter(t=>t!==row.table))}/><strong>{row.table}</strong></label><span>{row.error?'需处理':row.shape==='object'?'对象配置':'记录表'} · {row.bound?'已绑定':'首次同步'}</span>{registry.data.datasets[row.table]&&<button onClick={()=>onOpenTable(row.table)}>打开配置</button>}</div>
      <code>{row.file}</code>
      {row.error&&<p role="alert" className="field-error">{row.error}</p>}
      {direction==='import'&&<details className="ds-mapping"><summary>字段映射{Object.keys(mappings[row.table]||row.mapping||{}).length?' · 已自定义':''}</summary><p>左侧是 GameCreator 字段，右侧是文件字段。未列出的字段保留原名。映射会随成功同步保存。</p>
        <MappingEditor key={plan?.token} value={mappings[row.table]||row.mapping||{}} local={row.fields?.local||[]} remote={row.fields?.remote||[]} disabled={locked} onApply={next=>{const all={...mappings,[row.table]:next};setMappings(all);void preview(all);}}/>
      </details>}
      {!row.error&&(!diffs.length?<p className="ds-ok"><CheckCircle2 size={15}/>内容一致{!row.bound?'，可勾选以建立同步基准':''}</p>:<DataSyncComparison key={plan?.token} file={row} decisions={decisions[row.table]||{}} disabled={locked||direction==='publish'} onChange={next=>setDecisions(prev=>({...prev,[row.table]:next}))}/>)}
    </article>;
  }
  return <section className="data-sync" aria-label="数据同步">
    <div className="ds-intro"><span>DATA SYNC</span><h2>让配置表与工程数据保持一致。</h2><p>开发版接收结构变化；同步配置只传递结构一致的数据，验证完成后发布稳定版。</p></div>
    {!api&&<p role="alert">此功能需要桌面客户端。请重新启动最新版客户端。</p>}
    <fieldset disabled={locked} className="ds-settings"><h3>数据配置路径</h3><p>工程根目录：<code>{config.projectPath||'请先在引擎设置中连接工程'}</code></p>
      <label>数据配置子目录<input aria-label="数据配置子目录" value={draft.dataPath} onChange={e=>setDraft({...draft,dataPath:e.target.value})} placeholder="data/generated"/></label>
      <p>最终位置：<code>{config.projectPath.replace(/[\\/]$/,'')+'/'+draft.dataPath.replace(/^res:\/\//,'')}</code></p>
      <div className="ds-settings-options"><label>文件格式<select aria-label="数据同步格式" value={draft.outputFormat} onChange={e=>setDraft({...draft,outputFormat:e.target.value})}><option value="json">JSON</option>{draft.outputFormat!=='json'&&<option value={draft.outputFormat}>{draft.outputFormat.toUpperCase()}（暂不支持）</option>}</select></label>
        <label><input type="checkbox" checked={draft.autoSync} onChange={e=>setDraft({...draft,autoSync:e.target.checked})}/>保存配置后自动同步已绑定文件</label><span>同步前备份：始终开启</span></div>
      <small>自动同步仅处理字段结构一致、无冲突的已绑定文件；不改字段、不建立新表、不自动删除记录。只扫描当前目录中的 JSON 文件。</small>
      <div className="ds-actions"><button className="primary" disabled={!dirty} onClick={()=>void run(async()=>{const next=savedEngineConfig({...draft,dataPath:dataDirectory(draft.dataPath),backupBeforeSync:true});if(!await setConfig(next))throw new Error('设置未保存');setNotice('数据同步设置已保存。');})}><Save size={16}/>保存同步设置</button></div>
    </fieldset>
    <div className="ds-tabs" role="tablist" aria-label="数据同步操作">{([['import','从引擎导入'],['schema','开发字段说明'],['export','同步配置'],['publish','发布稳定版']] as const).map(([id,label])=><button key={id} role="tab" aria-selected={direction===id} onClick={()=>setDirection(id)} disabled={busy}>{id==='import'?<ArrowDownToLine size={17}/>:<ArrowUpFromLine size={17}/>} {label}</button>)}</div>
    <DataChanges registry={registry}/>
    {direction==='schema'?<div className="ds-settings"><h3>导出完整开发版字段说明</h3><p>包含所有开发表的字段、类型、枚举及引用约束。供程序与 AI 对照扩展实现，不写入游戏配置。</p><code>{config.dataPath}/_gamecreator/development-schema.json</code><p>这份文件代表开发期望，不代表引擎已适配。遇到空表或未知类型时，程序需在同目录 engine-schema.json 明确实际结构；补充方式见开发规范。</p><button className="primary" disabled={locked||dirty||!api||!config.projectPath} onClick={()=>void run(async()=>{const result=await api!.dataSchemaExport({projectId,config,store:registry.store});setNotice('已导出 '+result.tables+' 张表的字段说明：'+result.path);})}>导出开发版字段说明</button></div>:<div className="ds-toolbar"><div><h3>{direction==='import'?'引擎 JSON → 开发版':direction==='publish'?'开发版 → 稳定快照':'开发版 → 引擎 JSON'}</h3><p>{direction==='import'?'预览并审核引擎字段与数据变化，仅更新开发版。':direction==='publish'?'先检查全部开发配置与引擎是否一致，再确认运行验证并发布。':'只同步记录新增、值修改与记录删除；字段不符时禁止同步。'}</p></div><button className="primary" disabled={locked||dirty||!api||!config.projectPath} onClick={()=>void preview()}><RefreshCw size={16}/>{busy?'处理中…':direction==='publish'?'检查发布条件':'读取并预览差异'}</button></div>}
    {direction==='publish'&&<div className="ds-settings"><h3>发布信息</h3><label>版本号<input aria-label="配置发布版本号" value={version} maxLength={80} onChange={e=>setVersion(e.target.value)} placeholder="例如 0.1.0" disabled={locked}/></label><label>发布说明<textarea aria-label="配置发布说明" value={releaseNote} maxLength={4000} onChange={e=>setReleaseNote(e.target.value)} disabled={locked}/></label><label><input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)} disabled={locked}/>我已在引擎中验证当前开发版运行正常</label><p>软件检查数据一致性；实际玩法运行需由你验证。发布保留全部历史，不写入引擎文件。</p><button className="primary" disabled={locked||dirty||!plan?.rows.length||plan.rows.some(r=>r.error||r.differences?.length)||!verified||!version.trim()||!releaseNote.trim()} onClick={()=>void run(async()=>{if(!api||!plan)return;const result=await navigator.locks.request(registry.key,()=>api.dataPublish({token:plan.token,version,note:releaseNote,verified}));registry.reload();setPlan(null);setVerified(false);setNotice('稳定版 '+result.version+' 已发布，历史快照已保存。');})}>发布为稳定版</button></div>}
    {dirty&&<p role="status">请先保存数据同步设置，再读取文件。</p>}
    {(error||registry.error)&&<p className="field-error" role="alert">{error||registry.error}</p>}{notice&&<p role="status" className="ds-ok">{notice}</p>}
    {plan&&<>{direction!=='publish'&&<div className="ds-selection"><label><input type="checkbox" checked={!!plan.rows.length&&plan.rows.filter(r=>!r.error).every(r=>selected.includes(r.table))} disabled={locked} onChange={e=>setSelected(e.target.checked?plan.rows.filter(r=>!r.error).map(r=>r.table):[])}/>选择全部有效文件</label><span>已选 {selected.length} / {plan.rows.length}</span><button className="primary" disabled={locked||!selected.length||unresolved} onClick={()=>void apply()}>{direction==='import'?'应用导入':'应用同步'}（{selected.length}）</button></div>}{plan.rows.length?plan.rows.map(fileCard):<p className="ds-empty">{direction==='import'?'目录中没有 JSON 文件。':'当前项目没有配置表。'}</p>}</>}
    {!plan&&direction!=='schema'&&<div className="ds-empty">读取目录后，在这里核对新增、修改与冲突。</div>}
    <details className="ds-history"><summary>同步记录与恢复 · {registry.store.dataSync?.history.length||0}</summary><div className="ds-actions"><button disabled={locked||!api||dirty} onClick={()=>void run(async()=>{const result=await api!.dataRecover({projectId,config});registry.reload();setNotice(result.message);setPlan(null);})}>恢复中断同步</button><button disabled={locked||!api||dirty||!registry.store.dataSync?.history.length} onClick={()=>{if(window.confirm('恢复上次数据同步前的配置与工程文件？同步后若有其他编辑，会停止恢复。'))void run(async()=>{const result=await api!.dataUndo({projectId,config});registry.reload();setNotice(result.message);setPlan(null);});}}>恢复上次同步前</button><button disabled={locked} onClick={()=>{registry.reload();setPlan(null);}}>重新读取配置</button></div>
      <p>备份保存在工程的 .gamecreator-sync/data-history/ 中。同步后又编辑的内容不会被一键恢复覆盖。</p>
      {registry.store.dataSync?.history.map(h=><div className="ds-history-row" key={h.id}><time>{new Date(h.at).toLocaleString()}</time><b>{h.direction==='import'?'导入':'同步配置'}</b><span>{h.tables.join('、')}</span></div>)}
    </details>
  </section>;
}
function MappingEditor({value,local,remote,disabled,onApply}:{value:Record<string,string>;local:string[];remote:string[];disabled:boolean;onApply:(v:Record<string,string>)=>void}) {
  const [text,setText]=useState(JSON.stringify(value,null,2)),[error,setError]=useState('');
  let mapping=value;try{mapping=validateMapping(parseJson(text) as Record<string,string>);}catch{/* Keep fields available while editing incomplete JSON. */}
  return <div className="ds-map-editor">{local.filter(k=>k!=='id').map(k=><label key={k}><code>{k}</code> → <select aria-label={k+' 对应文件字段'} value={mapping[k]||k} disabled={disabled} onChange={e=>{const next={...mapping};if(e.target.value===k)delete next[k];else next[k]=e.target.value;setText(JSON.stringify(next,null,2));}}>{[...new Set([k,...remote])].map(field=><option key={field} value={field}>{field===k?field+'（保持原名）':field}</option>)}</select></label>)}
    <details><summary>高级映射编辑</summary><p>例如：<code>{'{"cols":"columns","gap_s":"interval_s"}'}</code></p><textarea aria-label="字段映射 JSON" value={text} onChange={e=>setText(e.target.value)} disabled={disabled} spellCheck={false}/></details>{error&&<p role="alert">{error}</p>}<button disabled={disabled} onClick={()=>{try{const next=validateMapping(parseJson(text) as Record<string,string>);setError('');onApply(next);}catch(e){setError(message(e));}}}>应用映射并重新预览</button></div>;
}

// The watcher is mounted at workspace level, so saving in Data Configuration also exports.
export function useAutomaticDataExport(projectId:string,config:EngineConfig,registry:EnumRegistry,disabled:boolean) {
  const [status,setStatus]=useState('');const signature=stable(registry.data),seen=useRef(signature),running=useRef(false),now=useRef({projectId,config,registry,disabled});now.current={projectId,config,registry,disabled};
  useEffect(()=>{seen.current=signature;setStatus('');},[projectId]);
  useEffect(()=>{
    if(disabled||!config.autoSync||!config.projectPath||registry.busy||registry.loading||registry.error||running.current||seen.current===signature)return;
    const timer=setTimeout(async()=>{const current=now.current,api=window.desktopClient?.engineSync;if(!api||current.projectId!==projectId)return;seen.current=signature;running.current=true;let token='';
      try{await navigator.locks.request(registry.key,async()=>{const p=await api.dataPreview({projectId,config,store:current.registry.store,direction:'export'});token=p.token;
        if(now.current.disabled||now.current.projectId!==projectId||stable(now.current.config)!==stable(config))return;
        const eligible=p.rows.filter(r=>r.bound&&r.localChanged&&!r.error&&!r.engineChanged&&!!r.differences?.length&&!r.differences.some(d=>d.conflict||d.deletion));
        const skipped=p.rows.some(r=>r.bound&&(r.error||r.engineChanged||r.differences?.some(d=>d.conflict||d.deletion)));
        if(eligible.length){await api.dataApply({token,selections:eligible.map(r=>({table:r.table})),automatic:true});now.current.registry.reload();}
        setStatus(skipped?'自动同步已跳过字段不符、有冲突或删除的文件，请到数据同步检查。':eligible.length?'已自动同步 '+eligible.length+' 个配置文件。':'');});
      }catch(e){if(now.current.projectId===projectId)setStatus('自动同步暂停：'+message(e));}finally{if(token)void api.dataRelease(token);running.current=false;}
    },1200);return()=>clearTimeout(timer);
  },[signature,config,projectId,disabled,registry.busy,registry.loading,registry.error]);
  return status;
}
