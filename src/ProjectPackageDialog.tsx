import {useEffect,useRef} from 'react';
import {CheckCircle2,FolderOpen,LoaderCircle,X} from 'lucide-react';
import type {FolderTransferState} from './useProjectTransfer';
import './prototype-import.css';
import './project-package.css';
export function ProjectPackageDialog({state,onClose}:{state:FolderTransferState|null;onClose:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(state&&!ref.current?.open)ref.current?.showModal();if(!state&&ref.current?.open)ref.current.close();},[!!state]);
  return <dialog ref={ref} className="pi-dialog pp-dialog" aria-label={state?.title} onCancel={event=>{event.preventDefault();if(!state?.busy)onClose();}}>
    <div className="pi-heading"><div><span className="pi-kicker">GAMECREATOR PROJECT</span><h2>{state?.title}</h2></div><button className="pi-close" aria-label="关闭" disabled={state?.busy} onClick={onClose}><X size={19}/></button></div>
    {state?.busy?<p className="pi-description"><LoaderCircle size={18}/> 正在处理项目文件夹…</p>:state?.error?<p role="alert" className="pi-error">{state.error}</p>:<>
      <p className="pi-description"><CheckCircle2 size={18}/> 项目已保存。后续编辑会自动写回此文件夹。</p><p className="pp-path"><FolderOpen size={18}/> {state?.directory}</p>
      <p className="pi-description">转移项目时复制整个文件夹，包含文档、配置与所有素材版本。引擎工程在“引擎设置”中单独连接。</p>
    </>}
    <div className="pi-actions"><button type="button" disabled={state?.busy} onClick={onClose}>关闭</button></div>
  </dialog>;
}
