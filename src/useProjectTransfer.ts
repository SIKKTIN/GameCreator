import { useEffect, useRef, useState, type RefObject } from 'react';
import { beforeLogoutEvent } from './auth';
import { leaveTeamEvent } from './team-api';
import { workspaceStorage } from './workspace-storage';
import { captureProjectPackage, prepareProjectPackageImport } from './project-package';
import type { SavedProject } from './project-catalog';
import type { useProjectCatalog } from './useProjectCatalog';

export type FolderTransferState = { title:string; busy:boolean; directory?:string; error?:string };
export function useProjectTransfer({projects,lock,allowed,allowSwitch,onImported}: {
  projects:ReturnType<typeof useProjectCatalog>;lock:RefObject<boolean>;allowed:boolean;
  allowSwitch:()=>boolean;onImported:()=>void;
}) {
  const [state,setState]=useState<FolderTransferState|null>(null);
  const operating=useRef(false);
  const service=window.desktopClient?.folderProjects;
  useEffect(()=>{
    const guard=(event:Event)=>{if(operating.current)event.preventDefault();};
    const closing=(event:BeforeUnloadEvent)=>{if(operating.current){event.preventDefault();event.returnValue='';}};
    window.addEventListener(beforeLogoutEvent,guard);window.addEventListener(leaveTeamEvent,guard);window.addEventListener('beforeunload',closing);
    return ()=>{window.removeEventListener(beforeLogoutEvent,guard);window.removeEventListener(leaveTeamEvent,guard);window.removeEventListener('beforeunload',closing);};
  },[]);
  function publish(project:SavedProject) {
    if(!projects.commit(catalog=>({...catalog,mode:'project',activeId:project.id,projects:[...catalog.projects.filter(p=>p.id!==project.id),project]})))
      throw new Error('项目已保存在文件夹，但最近项目列表未能更新。请使用“打开项目”重新打开。');
    onImported();
  }
  async function run(mode:'open'|'save'|'copy',project?:SavedProject) {
    if(!service||!allowed||lock.current||projects.blocked||!allowSwitch())return;
    lock.current=true;operating.current=true;
    const title=mode==='open'?'打开项目':mode==='copy'?'项目另存为':project?.folderPath?'保存项目':'保存到项目文件夹';
    setState({title,busy:true});
    try {
      if(mode==='open') {
        const opened=await service.open();if(!opened){setState(null);return;}
        publish(opened);setState(null);return;
      }
      if(!project)throw new Error('请先选择项目');
      const snapshot=captureProjectPackage(workspaceStorage,project);
      if(mode==='save'&&project.folderPath) {
        await service.verify(project.id);
        setState({title,busy:false,directory:project.folderPath});return;
      }
      let target=project;
      if(mode==='copy')target=prepareProjectPackageImport(projects.catalog,snapshot.document,project.name).project;
      const entries=Object.entries(snapshot.document.archives).map(([section,value])=>({
        key:section==='enum-versions'?'gamecreator.enum-versions.v1:'+target.id:'gamecreator.workspace.v1:'+target.id+':'+section,value:JSON.stringify(value)
      }));
      const saved=await service.create({project:target,entries,sourceId:project.id,expectedEntries:snapshot.expectedEntries});
      if(!saved){setState(null);return;}
      publish(saved);setState({title,busy:false,directory:saved.folderPath});
    } catch(error){setState({title,busy:false,error:String(error)});}
    finally{lock.current=false;operating.current=false;}
  }
  return {state,busy:!!state?.busy,enabled:!!service&&allowed,close:()=>{if(!operating.current)setState(null);},
    openImport:()=>void run('open'),openExport:(project:SavedProject)=>void run('save',project),
    saveAs:(project:SavedProject)=>void run('copy',project)};
}
