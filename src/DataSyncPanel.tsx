import {useEffect,useRef,useState} from 'react';
import {ArrowDownToLine,ArrowUpFromLine,RefreshCw,Save,CheckCircle2,AlertTriangle} from 'lucide-react';
import {dataDirectory,parseJson,stable,validateMapping,fromCanonical,type Canonical,type Json,type Decision} from '../shared/data-sync.mjs';
import {savedEngineConfig,type EngineConfig} from './engine';
import type {EnumRegistry} from './useEnumRegistry';
import type {DataSyncPlan,DataSyncFile} from './data-sync';
import './data-sync.css';
const message=(e:unknown)=>(e instanceof Error?e.message:String(e)).replace(/^Error invoking remote method '[^']+': Error: /,'');
const shown=(v:Json|undefined,root:boolean,mapping:Record<string,string>)=>v===undefined?'（不存在）':JSON.stringify(root?fromCanonical(v as unknown as Canonical,mapping):v,null,2);
type Props={projectId:string;config:EngineConfig;setConfig:(v:EngineConfig)=>Promise<boolean>|boolean;registry:EnumRegistry;blocked?:boolean;onOpenTable:(name:string)=>void};
export function DataSyncPanel({projectId,config,setConfig,registry,blocked,onOpenTable}:Props) {
  const api=window.desktopClient?.engineSync;
  const [direction,setDirection]=useState<'import'|'export'>('import');
  const [draft,setDraft]=useState(config),[plan,setPlan]=useState<DataSyncPlan|null>(null);
  const [mappings,setMappings]=useState<Record<string,Record<string,string>>>({});
  const [selected,setSelected]=useState<string[]>([]),[decisions,setDecisions]=useState<Record<string,Record<string,Decision>>>({});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const generation=useRef(0),operation=useRef(false),latest=useRef({projectId,config,revision:registry.store.revision});latest.current={projectId,config,revision:registry.store.revision};
  const dirty=stable(draft)!==stable(config),locked=busy||registry.busy||registry.loading||!!blocked;
  useEffect(()=>{setDraft(config);setMappings({});},[config]);
  useEffect(()=>{generation.current++;setPlan(null);setSelected([]);setDecisions({});},[config,projectId,registry.store.revision,direction]);
  useEffect(()=>()=>{generation.current++;},[]);
  useEffect(()=>()=>{if(plan)void api?.dataRelease(plan.token);},[plan,api]);
  const run=async(fn:()=>Promise<void>)=>{if(operation.current||locked)return;operation.current=true;setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(message(e));}finally{operation.current=false;setBusy(false);}};
  const preview=async(next=mappings)=>run(async()=>{
    if(!api)throw new Error('请在桌面客户端中使用数据同步');
    const seq=++generation.current,result=await api.dataPreview({projectId,config,store:registry.store,direction,mappings:next});
    if(seq!==generation.current){void api.dataRelease(result.token);return;}
    setPlan(result);setSelected(result.rows.filter(r=>!r.error&&!r.differences?.some(d=>d.conflict||d.deletion)).map(r=>r.table));setDecisions({});
  });
  const apply=async()=>run(async()=>{
    if(!plan||!api)return;
    await navigator.locks.request(registry.key,async()=>{
      await api.dataApply({token:plan.token,selections:selected.map(table=>({table,decisions:decisions[table]||{}}))});
      if(latest.current.projectId===projectId&&!registry.reload())throw new Error('同步成功，请重新读取配置以显示最新数据');
    });
    setPlan(null);setNotice((direction==='import'?'导入':'导出')+'完成，已保存同步基准和恢复备份。');
  });
  const setDecision=(table:string,id:string,patch:Partial<Decision>,fallback:Decision)=>setDecisions(prev=>({...prev,[table]:{...prev[table],[id]:{...fallback,...prev[table]?.[id],...patch}}}));
  const unresolved=plan?.rows.filter(r=>selected.includes(r.table)).some(r=>r.differences?.some(d=>{const c=decisions[r.table]?.[d.id]||{choice:d.choice};return !c.choice||c.choice!=='custom'&&d[c.choice]===undefined&&!c.allowDelete;}));
  function fileCard(row:DataSyncFile) {
    const diffs=row.differences||[],chosen=selected.includes(row.table);
    return <article className="ds-file" key={row.table}>
      <div className="ds-file-head"><label><input type="checkbox" aria-label={'同步 '+row.table} checked={chosen} disabled={!!row.error||locked} onChange={e=>setSelected(s=>e.target.checked?[...s,row.table]:s.filter(t=>t!==row.table))}/><strong>{row.table}</strong></label><span>{row.error?'需处理':row.shape==='object'?'对象配置':'记录表'} · {row.bound?'已绑定':'首次同步'}</span>{registry.data.datasets[row.table]&&<button onClick={()=>onOpenTable(row.table)}>打开配置</button>}</div>
      <code>{row.file}</code>
      {row.error&&<p role="alert" className="field-error">{row.error}</p>}
      <details className="ds-mapping"><summary>字段映射{Object.keys(mappings[row.table]||row.mapping||{}).length?' · 已自定义':''}</summary><p>左侧是 GameCreator 字段，右侧是文件字段。未列出的字段保留原名。映射会随成功同步保存。</p>
        <MappingEditor key={plan?.token} value={mappings[row.table]||row.mapping||{}} local={row.fields?.local||[]} remote={row.fields?.remote||[]} disabled={locked} onApply={next=>{const all={...mappings,[row.table]:next};setMappings(all);void preview(all);}}/>
      </details>
      {!row.error&&(!diffs.length?<p className="ds-ok"><CheckCircle2 size={15}/>内容一致{!row.bound?'，可勾选以建立同步基准':''}</p>:<details open={chosen}><summary>{diffs.length} 项差异 · {diffs.filter(d=>d.conflict).length} 项冲突</summary><div className="ds-diffs">{diffs.map(d=>{
        const c=decisions[row.table]?.[d.id]||{choice:d.choice};const removal=c.choice&&c.choice!=='custom'&&d[c.choice]===undefined;
        return <div className={'ds-diff'+(d.conflict?' conflict':'')} key={d.id}><b>{d.path.join(' / ')||'整个配置'} {d.conflict&&<span>需要选择</span>}</b>
          <div className="ds-values"><div><small>GameCreator</small><pre>{shown(d.local,!d.path.length,row.mapping||{})}</pre></div><div><small>引擎文件</small><pre>{shown(d.remote,!d.path.length,row.mapping||{})}</pre></div></div>
          {(d.baseLocal!==undefined||d.baseRemote!==undefined)&&<details><summary>上次同步基准</summary><div className="ds-values"><pre>{JSON.stringify(d.baseLocal,null,2)??'（不存在）'}</pre><pre>{JSON.stringify(d.baseRemote,null,2)??'（不存在）'}</pre></div></details>}
          <label>采用值<select aria-label={row.table+' '+(d.path.join('/')||'整个配置')+' 采用值'} disabled={locked} value={c.choice} onChange={e=>setDecision(row.table,d.id,{choice:e.target.value as Decision['choice'],allowDelete:false},c)}><option value="">请选择…</option><option value="local">保留 GameCreator</option><option value="remote">采用引擎文件</option><option value="custom">自定义 JSON 值</option></select></label>
          {c.choice==='custom'&&<textarea aria-label="自定义 JSON 值" spellCheck={false} value={c.value||''} onChange={e=>setDecision(row.table,d.id,{value:e.target.value},c)} placeholder={'字符串需要双引号，如 "sunflower"；数字直接填写 50'}/>}
          {removal&&<label><input type="checkbox" checked={!!c.allowDelete} onChange={e=>setDecision(row.table,d.id,{allowDelete:e.target.checked},c)}/>确认删除此字段或记录</label>}
        </div>;
      })}</div></details>)}
    </article>;
  }
  return <section className="data-sync" aria-label="数据同步">
    <div className="ds-intro"><span>DATA SYNC</span><h2>让配置表与工程数据保持一致。</h2><p>按文件名自动对应配置表。导入前比较变化，导出时保留 JSON 类型与原始结构。</p></div>
    {!api&&<p role="alert">此功能需要桌面客户端。请重新启动最新版客户端。</p>}
    <fieldset disabled={locked} className="ds-settings"><h3>数据配置路径</h3><p>工程根目录：<code>{config.projectPath||'请先在引擎设置中连接工程'}</code></p>
      <label>数据配置子目录<input aria-label="数据配置子目录" value={draft.dataPath} onChange={e=>setDraft({...draft,dataPath:e.target.value})} placeholder="data/generated"/></label>
      <p>最终位置：<code>{config.projectPath.replace(/[\\/]$/,'')+'/'+draft.dataPath.replace(/^res:\/\//,'')}</code></p>
      <div className="ds-settings-options"><label>文件格式<select aria-label="数据同步格式" value={draft.outputFormat} onChange={e=>setDraft({...draft,outputFormat:e.target.value})}><option value="json">JSON</option>{draft.outputFormat!=='json'&&<option value={draft.outputFormat}>{draft.outputFormat.toUpperCase()}（暂不支持）</option>}</select></label>
        <label><input type="checkbox" checked={draft.autoSync} onChange={e=>setDraft({...draft,autoSync:e.target.checked})}/>保存配置后自动导出已绑定文件</label><span>同步前备份：始终开启</span></div>
      <small>自动导出仅处理无冲突的已绑定文件；不自动导入、建立绑定或删除记录。当前目录中的 JSON 文件参与扫描。</small>
      <div className="ds-actions"><button className="primary" disabled={!dirty} onClick={()=>void run(async()=>{const next=savedEngineConfig({...draft,dataPath:dataDirectory(draft.dataPath),backupBeforeSync:true});if(!await setConfig(next))throw new Error('设置未保存');setNotice('数据同步设置已保存。');})}><Save size={16}/>保存同步设置</button></div>
    </fieldset>
    <div className="ds-tabs" role="tablist" aria-label="数据同步方向"><button role="tab" aria-selected={direction==='import'} onClick={()=>setDirection('import')} disabled={busy}><ArrowDownToLine size={17}/>导入</button><button role="tab" aria-selected={direction==='export'} onClick={()=>setDirection('export')} disabled={busy}><ArrowUpFromLine size={17}/>导出</button></div>
    <div className="ds-toolbar"><div><h3>{direction==='import'?'引擎 JSON → GameCreator':'GameCreator → 引擎 JSON'}</h3><p>{direction==='import'?'读取文件夹，自动匹配同名表；对象 JSON 显示为字段、类型和值。':'只写入勾选的文件；未选择的文件和其他工程内容保留。'}</p></div><button className="primary" disabled={locked||dirty||!api||!config.projectPath} onClick={()=>void preview()}><RefreshCw size={16}/>{busy?'处理中…':'读取并预览差异'}</button></div>
    {dirty&&<p role="status">请先保存数据同步设置，再读取文件。</p>}
    {(error||registry.error)&&<p className="field-error" role="alert">{error||registry.error}</p>}{notice&&<p role="status" className="ds-ok">{notice}</p>}
    {plan&&<><div className="ds-selection"><label><input type="checkbox" checked={!!plan.rows.length&&plan.rows.filter(r=>!r.error).every(r=>selected.includes(r.table))} disabled={locked} onChange={e=>setSelected(e.target.checked?plan.rows.filter(r=>!r.error).map(r=>r.table):[])}/>选择全部有效文件</label><span>已选 {selected.length} / {plan.rows.length}</span><button className="primary" disabled={locked||!selected.length||unresolved} onClick={()=>void apply()}>应用{direction==='import'?'导入':'导出'}（{selected.length}）</button></div>{plan.rows.length?plan.rows.map(fileCard):<p className="ds-empty">{direction==='import'?'目录中没有 JSON 文件。':'当前项目没有配置表。'}</p>}</>}
    {!plan&&<div className="ds-empty">读取目录后，在这里核对新增、修改与冲突。</div>}
    <details className="ds-history"><summary>同步记录与恢复 · {registry.store.dataSync?.history.length||0}</summary><div className="ds-actions"><button disabled={locked||!api||dirty} onClick={()=>void run(async()=>{const result=await api!.dataRecover({projectId,config});registry.reload();setNotice(result.message);setPlan(null);})}>恢复中断同步</button><button disabled={locked||!api||dirty||!registry.store.dataSync?.history.length} onClick={()=>{if(window.confirm('恢复上次数据同步前的配置与工程文件？同步后若有其他编辑，会停止恢复。'))void run(async()=>{const result=await api!.dataUndo({projectId,config});registry.reload();setNotice(result.message);setPlan(null);});}}>恢复上次同步前</button><button disabled={locked} onClick={()=>{registry.reload();setPlan(null);}}>重新读取配置</button></div>
      <p>备份保存在工程的 .gamecreator-sync/data-history/ 中。同步后又编辑的内容不会被一键恢复覆盖。</p>
      {registry.store.dataSync?.history.map(h=><div className="ds-history-row" key={h.id}><time>{new Date(h.at).toLocaleString()}</time><b>{h.direction==='import'?'导入':'导出'}</b><span>{h.tables.join('、')}</span></div>)}
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
        setStatus(skipped?'自动导出已跳过有冲突或删除的文件，请到数据同步检查。':eligible.length?'已自动导出 '+eligible.length+' 个配置文件。':'');});
      }catch(e){if(now.current.projectId===projectId)setStatus('自动导出暂停：'+message(e));}finally{if(token)void api.dataRelease(token);running.current=false;}
    },1200);return()=>clearTimeout(timer);
  },[signature,config,projectId,disabled,registry.busy,registry.loading,registry.error]);
  return status;
}
