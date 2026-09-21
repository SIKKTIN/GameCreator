import {EngineSyncBinding,foreignSyncBinding} from './EngineSyncBinding';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,CheckCircle2,FileText,FolderSync,History,RefreshCw,Save,Settings2} from 'lucide-react';
import {EngineSettings} from './EnginePanels';
import {aiModules,type AiDocument} from './ai-export';
import type {ArtStore} from './art-assets';
import {engineInfo,type EngineConfig} from './engine';
import type {EnumRegistry} from './useEnumRegistry';
import {defaultSyncSettings,syncSettings,syncPath,type SyncSettings} from '../shared/engine-sync.mjs';
import type {SyncHistory,SyncPlan,SyncBinding} from './engine-sync';
import {workspaceStorage} from './workspace-storage';
import {beforeLogoutEvent} from './auth';
import './engine-sync.css';

type Props={projectId:string;config:EngineConfig;setConfig:(next:EngineConfig)=>Promise<boolean>|boolean;registry:EnumRegistry;onPickDirectory?:()=>Promise<string|null>;build:()=>AiDocument;art:ArtStore;blockedReason:string;onOpenAsset?:(id:string)=>void};
const labels={added:'新增',updated:'更新',removed:'待移除',unchanged:'无变化',conflict:'冲突'};
export function EngineSyncPanel(props:Props) {
  const [tab,setTab]=useState('connection'),[connectionDirty,setConnectionDirty]=useState(false);
  return <section className="engine-hub" aria-label="引擎与同步">
    <div className="engine-hub-intro"><div><span>ENGINE & CONTENT</span><h2>连接工程，交付项目内容。</h2><p>文档与采用的素材由 GameCreator 交付，引擎继续负责场景、程序与运行。</p></div><FolderSync size={30}/></div>
    <div className="engine-hub-tabs" role="tablist" aria-label="引擎与同步分页">{([['connection','工程连接',Settings2],['settings','同步配置',FileText],['preview','待同步变更',FolderSync],['history','同步记录',History]] as const).map(([key,label,Icon])=><button key={key as string} role="tab" aria-selected={tab===key} onClick={()=>setTab(key as string)}><Icon size={16}/>{label as string}</button>)}</div>
    <div hidden={tab!=='connection'}><EngineSettings onDirtyChange={setConnectionDirty} config={props.config} setConfig={props.setConfig} registry={props.registry} onPickDirectory={props.onPickDirectory}/></div>
    <ContentSync key={props.projectId+':'+props.config.engine+':'+props.config.projectPath} {...props} blockedReason={connectionDirty?'工程连接有未保存的修改，请先保存工程连接再同步。':props.blockedReason} tab={tab} setTab={setTab}/>
  </section>;
}
function ContentSync({projectId,config,build,art,blockedReason,onOpenAsset,tab,setTab}:Props&{tab:string;setTab:(tab:string)=>void}) {
  const api=window.desktopClient?.engineSync,key='gamecreator.workspace.v1:'+projectId+':engine-sync-'+config.engine;
  const available=buildSafe();
  function buildSafe(){try{return build().sections.map(s=>s.id);}catch{return aiModules.map(m=>m.id);}}
  const [initial]=useState(()=>{
    try{const raw=workspaceStorage.getItem(key);return {settings:raw?syncSettings(JSON.parse(raw)):{...defaultSyncSettings,modules:available},error:''};}
    catch(e){return {settings:{...defaultSyncSettings,modules:available},error:'同步配置读取失败：'+String(e)};}
  });
  const [settings,setSettings]=useState<SyncSettings>(initial.settings),[saved,setSaved]=useState(JSON.stringify(initial.settings));
  const [error,setError]=useState(initial.error),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [plan,setPlan]=useState<SyncPlan>(),[entries,setEntries]=useState<SyncHistory[]>([]),[decisions,setDecisions]=useState<Record<string,'keep'|'replace'>>({}),[removals,setRemovals]=useState<string[]>([]);
  const [showUnchanged,setShowUnchanged]=useState(false),running=useRef(false),alive=useRef(true),token=useRef('');
  const [ownership,setOwnership]=useState<SyncBinding>(),[confirmBinding,setConfirmBinding]=useState(false),bindingToken=useRef(''),checkedBinding=useRef(false);
  const foreign=foreignSyncBinding(ownership);
  const unadopted=art.assets.filter(a=>!a.archived&&!a.adoptedVersionId&&a.versions.some(v=>v.files.length>0));
  const dirty=JSON.stringify(settings)!==saved;
  const blocked=!api?'工程文件同步需要桌面客户端。浏览器仍可使用“生成 AI 文档”。':!config.projectPath?'请先在工程连接中配置并保存工程目录。':blockedReason;
  let invalid='';try{syncSettings(settings);if(settings.documents&&!settings.modules.some(m=>available.includes(m as typeof available[number])))invalid='请选择至少一个文档模块';}catch(e){invalid=(e as Error).message;}
  const discard=()=>{if(token.current){void api?.release(token.current);token.current='';}setPlan(undefined);setDecisions({});setRemovals([]);};
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(token.current)void api?.release(token.current);if(bindingToken.current)void api?.release(bindingToken.current);};},[]);
  useEffect(()=>{
    const guard=(e:Event)=>{if(running.current)e.preventDefault();};
    const unload=(e:BeforeUnloadEvent)=>{if(running.current){e.preventDefault();e.returnValue='';}};
    window.addEventListener(beforeLogoutEvent,guard);window.addEventListener('beforeunload',unload);
    return()=>{window.removeEventListener(beforeLogoutEvent,guard);window.removeEventListener('beforeunload',unload);};
  },[]);
  // Any source edits invalidate the reviewed snapshot, including programmatic updates while the tab stays open.
  let source='';try{const doc=build();source=JSON.stringify({art,sections:doc.sections,name:doc.projectName,version:doc.version});}catch{/* blocked above */}
  const lastSource=useRef(source);
  useEffect(()=>{if(lastSource.current!==source){lastSource.current=source;discard();}},[source]);
  async function run(operation:()=>Promise<void>){if(running.current)return;running.current=true;setBusy(true);setError('');try{await operation();}catch(e){if(alive.current)setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));}finally{running.current=false;if(alive.current)setBusy(false);}}
  const inspectBinding=async()=>{
    if(!api||!config.projectPath)return;
    const next=await api.binding({projectId,config});
    if(!alive.current){if(next.token)void api.release(next.token);return;}
    if(bindingToken.current)void api.release(bindingToken.current);
    bindingToken.current=next.token||'';checkedBinding.current=true;setOwnership(next);
    if(foreignSyncBinding(next)){discard();setEntries([]);}
    return next;
  };
  const checkBinding=()=>run(async()=>{await inspectBinding();});
  const loadHistory=()=>run(async()=>{if(!api||!config.projectPath)return;const binding=await inspectBinding();if(!binding||foreignSyncBinding(binding))return;const result=await api.history({projectId,config});if(alive.current)setEntries(result.entries);});
  useEffect(()=>{if(tab==='history')void loadHistory();else if(tab!=='connection'&&!checkedBinding.current)void checkBinding();},[tab]);
  const rebind=()=>run(async()=>{
    if(!api||blocked||!ownership?.token)return;
    const result=await api.rebind({token:ownership.token});
    if(!alive.current)return;
    setConfirmBinding(false);discard();setNotice(result.message);await inspectBinding();
    const history=await api.history({projectId,config});if(alive.current)setEntries(history.entries);
  });
  const save=()=>{if(invalid)return;try{const next=syncSettings(settings);workspaceStorage.setItem(key,JSON.stringify(next));setSettings(next);setSaved(JSON.stringify(next));setNotice('同步配置已保存。');setError('');discard();}catch(e){setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));}};
  const patch=(next:Partial<SyncSettings>)=>{setSettings(s=>({...s,...next}));discard();setNotice('');};
  const preview=()=>run(async()=>{
    if(!api||blocked||invalid||dirty)return;discard();setNotice('');
    const binding=await inspectBinding();if(!binding||foreignSyncBinding(binding))return;
    const next=await api.preview({projectId,config,settings,document:build(),art});
    if(!alive.current){void api.release(next.token);return;}
    token.current=next.token;setPlan(next);setEntries(next.history);setTab('preview');
  });
  const apply=()=>run(async()=>{
    if(!api||!plan||blocked||dirty)return;
    try{const result=await api.apply({token:plan.token,decisions,removals});if(alive.current){discard();setNotice(result.message+'，共 '+result.files.length+' 个文件。');setEntries(e=>[result,...e]);}}
    catch(e){discard();throw e;}
  });
  const recover=()=>run(async()=>{if(!api||!config.projectPath)return;const result=await api.recover({projectId,config});if(alive.current){discard();setNotice(result.message);setEntries((await api.history({projectId,config})).entries);}});
  const unresolved=plan?.rows.some(r=>r.status==='conflict'&&!decisions[r.path]);
  const root=plan?.root||config.projectPath;
  const fullPath=(relative:string)=>{if(!root)return '请先连接游戏工程';try{const sub=syncPath(relative);return root.replace(/[\\/]+$/,'')+'/'+sub;}catch{return '请填写有效的工程内子目录';}};
  useEffect(()=>{if(blockedReason)discard();},[blockedReason]);
  const actions=plan?.rows.filter(r=>r.status!=='unchanged'&&(r.status!=='conflict'||decisions[r.path]==='replace')&&(!r.remove||removals.includes(r.path))).length||0;
  return <div className="engine-content" hidden={tab==='connection'}>
    <section className="es-engine-root" aria-label="当前同步工程"><div><span>{engineInfo(config.engine).name} · 已保存的游戏工程根目录</span><code aria-label="同步工程根目录">{root||'尚未连接游戏工程'}</code><p>同步直接写入此工程。下方仅设置工程内的子目录。</p></div><button type="button" className="gp-secondary" disabled={busy} onClick={()=>setTab('connection')}>更换工程</button></section>
    <EngineSyncBinding binding={ownership} busy={busy} blocked={blocked} confirming={confirmBinding} error={error} onRefresh={()=>void checkBinding()} onConfirm={()=>{setError('');setConfirmBinding(true);}} onCancel={()=>setConfirmBinding(false)} onRebind={()=>void rebind()}/>
    {blocked&&<p className="es-notice" role="status">{blocked}</p>}
    {error&&<p className="es-error" role="alert">{error}</p>}{notice&&<p className="es-success" role="status"><CheckCircle2 size={17}/>{notice}</p>}
    {(tab==='settings'||tab==='preview')&&settings.assets&&unadopted.length>0&&<section className="es-notice es-material-pending" aria-label="未纳入同步的素材">
      <strong>{unadopted.length} 项素材已有文件，但尚未采用，不会同步到引擎</strong>
      <p>审核通过后，还需要点击“采用此版本”。下方文档同步成功并不代表这些图片已交付。</p>
      <ul>{unadopted.map(asset=><li key={asset.id}><div><b>{asset.name}</b><small>{asset.versions.some(v=>v.files.length>0&&v.review==='已通过')?'已有审核通过的版本，请确认采用':'请先审核正式版本，或采用占位版本'}</small></div>{onOpenAsset&&<button className="gp-secondary" disabled={busy} onClick={()=>onOpenAsset(asset.id)}>查看并采用</button>}</li>)}</ul>
    </section>}
    {tab==='settings'&&<>
      <div className="es-section-heading"><div><h3>同步范围与目录</h3><p>同步位置跟随已保存的工程连接。关闭某类同步会保留其已交付文件。</p></div><button className="primary" disabled={busy||!dirty||!!invalid} onClick={save}><Save size={16}/>保存同步配置</button></div>
      <fieldset disabled={busy} className="es-fields">
        <div className="es-config-grid">
          <section className="es-card"><label className="es-checkbox"><input type="checkbox" checked={settings.documents} onChange={e=>patch({documents:e.target.checked})}/>同步设计文档</label><p>按模块生成 Markdown，可供程序与 AI 查阅。</p><label>文档子目录（相对于工程根目录）<input aria-label="文档目标目录" value={settings.docsDirectory} onChange={e=>patch({docsDirectory:e.target.value})}/></label><div className="es-target-path"><span>最终写入位置</span><output aria-label="文档最终写入位置">{fullPath(settings.docsDirectory)}</output></div><div className="es-modules">{aiModules.filter(m=>available.includes(m.id)).map(m=><label className="es-checkbox" key={m.id}><input type="checkbox" disabled={!settings.documents} checked={settings.modules.includes(m.id)} onChange={e=>patch({modules:e.target.checked?[...settings.modules,m.id]:settings.modules.filter(id=>id!==m.id)})}/>{m.label}</label>)}</div><small>{config.engine==='godot-gdscript'?'文档以 Markdown 同步，可在 Godot 文件系统中查看。若旧版留下 .gdignore，请在待同步变更中确认移除。':'文档用于开发查阅，发布游戏时请按工程规则排除。'}</small></section>
          <section className="es-card"><label className="es-checkbox"><input type="checkbox" checked={settings.assets} onChange={e=>patch({assets:e.target.checked})}/>同步已采用素材</label><p>交付采用版本的原文件，历史版本仍保留在素材资产中。</p><label>素材子目录（相对于工程根目录）<input aria-label="素材目标目录" value={settings.assetsDirectory} onChange={e=>patch({assetsDirectory:e.target.value})}/></label><div className="es-target-path"><span>最终写入位置</span><output aria-label="素材最终写入位置">{fullPath(settings.assetsDirectory)}</output></div><label className="es-checkbox"><input type="checkbox" disabled={!settings.assets} checked={settings.includePlaceholders} onChange={e=>patch({includePlaceholders:e.target.checked})}/>包含已采用的占位素材</label><small>关闭后，仅纳入审核通过的正式采用版本。单文件素材更新时保留同格式的工程路径；多文件版本按文件名对应。</small><div className="es-policy"><b>交付规则</b><p>更新和移除前自动备份。工程中手工修改过的文件需处理冲突。不会修改程序、场景或引擎生成的导入缓存。</p></div></section>
        </div>
      </fieldset>
      {invalid&&<p className="es-error" role="alert">{invalid}</p>}
      <div className="es-footer"><span>{dirty?'配置待保存':'配置已保存 · 手动预览后同步'}</span><button className="primary" disabled={busy||foreign||dirty||!!blocked||!!invalid} onClick={()=>void preview()}>预览同步变更<ArrowRight size={16}/></button></div>
    </>}
    {tab==='preview'&&<>
      <div className="es-section-heading"><div><h3>待同步变更</h3><p>以当前内容为快照；文件变化或预览超过十分钟后需重新检查。</p></div><button className="gp-secondary" disabled={busy||foreign||dirty||!!blocked||!!invalid} onClick={()=>void preview()}><RefreshCw size={16}/>{busy?'处理中…':'检查同步变更'}</button></div>
      {dirty&&<p className="es-notice">请先到同步配置保存设置。</p>}
      {!plan?<div className="es-empty"><FolderSync size={36}/><h3>把最新内容交付到工程</h3><p>检查文档和已采用素材的变化，确认后一次同步。</p><code>{config.projectPath||'尚未连接工程'}</code><button className="primary" disabled={busy||foreign||dirty||!!blocked||!!invalid} onClick={()=>void preview()}>预览同步变更</button></div>:<>
        <div className="es-summary">{Object.entries(labels).map(([status,label])=><span className={'es-state '+status} key={status}>{label} {plan.rows.filter(r=>r.status===status).length}</span>)}<label className="es-checkbox"><input type="checkbox" checked={showUnchanged} onChange={e=>setShowUnchanged(e.target.checked)}/>显示无变化</label></div>
        {!!plan.warnings.length&&<details className="es-notice"><summary>{plan.warnings.length} 项同步提示</summary>{plan.warnings.map((w,i)=><p key={i}>{w}</p>)}</details>}
        <div className="es-changes">{plan.rows.filter(r=>showUnchanged||r.status!=='unchanged').map(r=><article className="es-change" key={r.path}><div><span className={'es-state '+r.status}>{labels[r.status]}{r.remove&&r.status==='conflict'?' · 待移除':''}</span><b>{r.label}</b>{r.placeholder&&<small>占位素材</small>}<code title={root.replace(/[\\/]+$/,'')+'/'+r.path}>{root.replace(/[\\/]+$/,'')+'/'+r.path}</code><small>{r.version&&'版本：'+r.version+' · '}{r.reason}</small></div><div className="es-row-actions">{r.status==='conflict'&&<select aria-label={'冲突处理 '+r.path} disabled={busy} value={decisions[r.path]||''} onChange={e=>setDecisions(d=>({...d,[r.path]:e.target.value as 'keep'|'replace'}))}><option value="">请选择处理方式</option><option value="keep">保留工程文件，本次跳过</option><option value="replace">{r.remove?'备份并允许移除':'备份并使用 GameCreator 版本'}</option></select>}{r.remove&&<label className="es-checkbox"><input type="checkbox" aria-label={'确认移除 '+r.path} disabled={busy} checked={removals.includes(r.path)} onChange={e=>setRemovals(a=>e.target.checked?[...a,r.path]:a.filter(p=>p!==r.path))}/>确认移除</label>}</div></article>)}</div>
        {plan.rows.every(r=>r.status==='unchanged')&&<p className="es-success"><CheckCircle2 size={20}/>{settings.assets&&unadopted.length?'已纳入同步的文件已是最新版本；上方未采用素材仍未同步。':'所选范围的工程文件已是最新版本。'}</p>}
        <div className="es-footer"><span>{unresolved?'请先处理冲突':actions?'本次处理 '+actions+' 个文件，覆盖前自动备份':'没有需要写入的变更'}</span><button className="primary" disabled={busy||foreign||!!blocked||!!unresolved||!actions} onClick={()=>void apply()}><FolderSync size={16}/>{busy?'正在同步…':'同步到工程'}</button></div>
      </>}
    </>}
    {tab==='history'&&<>
      <div className="es-section-heading"><div><h3>同步记录</h3><p>记录保存在当前工程，备份目录保留写入前的文件和清单。</p></div><button className="gp-secondary" disabled={busy||!api||!config.projectPath} onClick={()=>void loadHistory()}><RefreshCw size={16}/>刷新记录</button></div>
      {!entries.length?<div className="es-empty"><History size={32}/><h3>尚无同步记录</h3><p>完成第一次同步后，可在这里查看交付内容与备份位置。</p></div>:entries.map(entry=><details className="es-history" key={entry.id}><summary><span className={'es-state '+(entry.status==='success'?'added':'conflict')}>{entry.kind==='rebind'?'已重新绑定':entry.status==='success'?'已同步':'失败 / 已恢复'}</span>{new Date(entry.at).toLocaleString()}<span>{entry.files.length} 个文件</span></summary><p>{entry.message}</p>{entry.kind==='rebind'&&<p>原归属：{entry.fromProjectId}<br/>新归属：{entry.toProjectId}</p>}{entry.backupDirectory&&<><small>写入前备份位置</small><code>{entry.backupDirectory}</code></>}{entry.files.map(f=><p key={f.path}><code>{f.path}</code> {f.action==='removed'?'已移除':f.version?'版本：'+f.version:'已写入'}</p>)}</details>)}
      <div className="es-footer"><small>客户端异常退出后，可恢复未完成的同步。检测到外部改动时会停止恢复。</small><button className="gp-secondary" disabled={busy||foreign||!api||!config.projectPath} onClick={()=>void recover()}>恢复中断的同步</button></div>
    </>}
  </div>;
}
