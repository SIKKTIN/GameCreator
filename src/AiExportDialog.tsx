import {policyExportPath} from '../shared/config-data-policy.mjs';
import {useEffect,useRef,useState} from 'react';
import {CheckCircle2,FileText,FolderOpen,LoaderCircle,X} from 'lucide-react';
import {aiModules,buildAiDocumentFiles,saveAiDocumentFiles,type AiDocument,type AiExportNames,type AiModuleId} from './ai-export';
import {defaultFolderName,markdownName,validateDocumentFiles} from '../shared/ai-document-files.mjs';
import {workspaceStorage} from './workspace-storage';
import {beforeLogoutEvent} from './auth';
import {leaveTeamEvent} from './team-api';
import './ai-export.css';

type Settings=AiExportNames&{directory:string};
type Props={projectId:string;projectName:string;modules:AiModuleId[];build:()=>AiDocument;blockedReason:string;onClose:()=>void};
export function AiExportDialog({projectId,projectName,modules,build,blockedReason,onClose}:Props) {
  const desktop=window.desktopClient?.aiDocuments,key='gamecreator.workspace.v1:'+projectId+':ai-export-preferences';
  const [initial]=useState(()=>{
    const defaults:Settings={directory:'',folderName:defaultFolderName(projectName),summaryName:'项目完整文档.md',moduleNames:{}};
    try {
      const saved=JSON.parse(workspaceStorage.getItem(key)||'null');
      if(saved&&typeof saved==='object') {
        for(const field of ['directory','folderName','summaryName'] as const)if(typeof saved[field]==='string')defaults[field]=saved[field];
        for(const m of aiModules)if(typeof saved.moduleNames?.[m.id]==='string')defaults.moduleNames[m.id]=saved.moduleNames[m.id];
      }
      return {settings:defaults,warning:''};
    } catch {return {settings:defaults,warning:'上次导出设置暂时无法读取，已使用默认设置。'};}
  });
  const [settings,setSettings]=useState(initial.settings),[warning,setWarning]=useState(initial.warning),[error,setError]=useState('');
  const [loading,setLoading]=useState(!!desktop),[busy,setBusy]=useState(false),[choosing,setChoosing]=useState(false);
  const [result,setResult]=useState<{directory:string;fileCount:number;token:string}>();
  const dialog=useRef<HTMLDialogElement>(null),alive=useRef(true),running=useRef(false);
  useEffect(()=>{
    alive.current=true;const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();
    if(desktop)desktop.options().then(value=>{if(alive.current)setSettings(s=>({...s,directory:s.directory||value.defaultDirectory}));}).catch(e=>{if(alive.current)setError('读取默认保存位置失败：'+String(e));}).finally(()=>{if(alive.current)setLoading(false);});
    return()=>{alive.current=false;dialog.current?.close();previous?.focus();};
  },[]);
  useEffect(()=>{
    const guard=(e:Event)=>{if(busy||choosing)e.preventDefault();};
    const unload=(e:BeforeUnloadEvent)=>{if(busy||choosing){e.preventDefault();e.returnValue='';}};
    window.addEventListener(beforeLogoutEvent,guard);window.addEventListener(leaveTeamEvent,guard);
    window.addEventListener('beforeunload',unload);
    return()=>{window.removeEventListener(beforeLogoutEvent,guard);window.removeEventListener(leaveTeamEvent,guard);window.removeEventListener('beforeunload',unload);};
  },[busy,choosing]);
  const enabledModules=aiModules.filter(m=>modules.includes(m.id));
  let validation='';
  try {validateDocumentFiles({folderName:settings.folderName,files:[{path:markdownName(settings.summaryName),content:''},...enabledModules.map(m=>({path:'模块/'+markdownName(settings.moduleNames[m.id]??m.label),content:''})),{path:policyExportPath,content:''}]});}
  catch(e){validation=(e as Error).message;}
  const patch=(next:Partial<Settings>)=>{setSettings(s=>({...s,...next}));setError('');};
  const choose=async()=>{
    if(!desktop||choosing||busy)return;setChoosing(true);setError('');
    try {const path=await desktop.chooseDirectory(settings.directory);if(alive.current&&path)patch({directory:path});}
    catch(e){if(alive.current)setError(String(e));}finally{if(alive.current)setChoosing(false);}
  };
  const generate=async()=>{
    if(running.current||loading||choosing||validation||blockedReason)return;
    running.current=true;setBusy(true);setError('');
    try {
      const bundle=buildAiDocumentFiles(build(),settings);
      const output=await saveAiDocumentFiles(bundle,settings.directory);
      if(!alive.current)return;
      setResult(output);
      try {workspaceStorage.setItem(key,JSON.stringify(settings));}
      catch {setWarning('文档已生成，但本次设置未能记住。下次导出需要重新填写。');}
    } catch(e){if(alive.current)setError((e as Error).message);}
    finally{running.current=false;if(alive.current)setBusy(false);}
  };
  const close=()=>{if(!busy&&!choosing)onClose();};
  const separator=settings.directory.includes('\\')?'\\':'/';
  const location=desktop?(settings.directory.replace(/[\\/]+$/,'')+separator+settings.folderName):(settings.folderName+'.zip');
  return <dialog ref={dialog} className="ai-export-dialog" aria-labelledby="ai-export-title" onCancel={e=>{e.preventDefault();close();}}>
    <div className="aie-heading"><span className="aie-icon"><FileText size={25}/></span><div><h2 id="ai-export-title">生成 AI 文档</h2><p>{projectName} · 完整总文档与分模块文档</p></div><button type="button" aria-label="关闭 AI 文档导出" disabled={busy||choosing} onClick={close}><X size={20}/></button></div>
    <form onSubmit={e=>{e.preventDefault();void generate();}}>
      <div className="aie-body">
        {warning&&<p className="aie-notice" role="status">{warning}</p>}
        {result?<section className="aie-success" aria-label="文档生成结果"><CheckCircle2 size={40}/><h3>{desktop?'文档文件夹已生成':'已开始下载文档压缩包'}</h3><p>共 {result.fileCount} 份 Markdown 文档，包含一份完整总文档。</p><code>{result.directory}</code>{desktop&&<button type="button" className="gp-secondary" onClick={()=>{void desktop.reveal(result.token).catch(e=>setError('打开文件夹失败：'+String(e)));}}><FolderOpen size={17}/>打开文件夹</button>}</section>:<>
          <fieldset disabled={busy||choosing||loading} className="aie-fields">
            {desktop?<label className="aie-path">保存位置<span><input aria-label="AI 文档保存位置" value={settings.directory} onChange={e=>patch({directory:e.target.value})} placeholder="选择保存文档的文件夹"/><button type="button" onClick={()=>void choose()}><FolderOpen size={16}/>{choosing?'选择中…':'选择文件夹'}</button></span></label>:<p className="aie-notice">浏览器将下载 ZIP，解压后得到同样的文档文件夹。下载位置由浏览器设置决定。</p>}
            <div className="aie-grid"><label>输出文件夹名称<input aria-label="输出文件夹名称" value={settings.folderName} onChange={e=>patch({folderName:e.target.value})}/></label><label>总文档文件名<input aria-label="总文档文件名" value={settings.summaryName} onChange={e=>patch({summaryName:e.target.value})}/></label></div>
            <p className="aie-notice">附带《配置数据管理与同步规范》，包含当前项目的数据目录与格式，独立于程序框架采用。</p>
            <div className="aie-files-heading"><h3>模块文档</h3><span>{enabledModules.length} 个模块 · 自动补齐 .md</span></div>
            <div className="aie-file-list">{enabledModules.map(m=><label key={m.id}><span>{m.label}</span><span className="aie-file-path">模块 /</span><input aria-label={m.label+'文档文件名'} value={settings.moduleNames[m.id]??m.label+'.md'} onChange={e=>patch({moduleNames:{...settings.moduleNames,[m.id]:e.target.value}})}/></label>)}</div>
          </fieldset>
          <div className="aie-preview"><span>{desktop?'导出到':'下载文件'} · {enabledModules.length+2} 份文档</span><code>{location}</code><small>{desktop?'同名文件夹自动追加序号，保留历史导出。':'压缩包包含完整总文档和“模块”文件夹。'}</small></div>
          {(validation||blockedReason)&&<p className="aie-error" role="alert">{validation||blockedReason}</p>}
        </>}
        {error&&<p className="aie-error" role="alert">{error}</p>}
      </div>
      <footer className="aie-footer"><span>{busy?'正在生成文档，请稍候…':loading?'正在读取保存位置…':'仅整理当前项目的内容'}</span><button type="button" className="gp-secondary" disabled={busy||choosing} onClick={close}>{result?'完成':'取消'}</button>{!result&&<button type="submit" className="primary" disabled={busy||choosing||loading||!!validation||!!blockedReason||!!desktop&&!settings.directory.trim()}>{busy?<LoaderCircle size={17} className="aie-spin"/>:<FileText size={17}/>}生成文档文件夹</button>}</footer>
    </form>
  </dialog>;
}
