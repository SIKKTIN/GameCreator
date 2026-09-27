const {randomUUID}=require('node:crypto');
// Coordinate background writes with unsaved renderer drafts, without navigating the UI.
function createWorkflowEditorGuard({ipcMain,window:currentWindow,trusted,storage}){
 let editor='',pending;const busy=new Set();
 ipcMain.on('workflow-editor-ready',(event,id)=>{if(trusted(event))editor=typeof id==='string'?id:'';});
 ipcMain.on('workflow-editor-answer',(event,answer)=>{if(trusted(event)&&pending?.id===answer?.id){const p=pending;pending=undefined;p.resolve(answer);}});
 async function begin(projectId){
  if(busy.has(projectId))throw new Error('另一个工作流正在写入，请稍后重试');busy.add(projectId);
  const window=currentWindow();
  if(!window||window.isDestroyed()||editor!==projectId)return ()=>{busy.delete(projectId);};
  const id=randomUUID();let timer;
  try{
   const answer=await new Promise((resolve,reject)=>{pending={id,resolve};timer=setTimeout(()=>{pending=undefined;reject(new Error('编辑器尚未响应，请等待加载或保存完成后重试'));},5000);window.webContents.send('workflow-editor-prepare',{id,projectId});});
   if(answer.error)throw new Error(answer.error);
   if(!Array.isArray(answer.expectedEntries)||!answer.expectedEntries.length)throw new Error('编辑器未提供当前内容快照');
   for(const e of answer.expectedEntries)if(storage.getItem(e.key)!==e.value)throw new Error('编辑器内容已变化，请重试');
   return ()=>{busy.delete(projectId);if(!window.isDestroyed())window.webContents.send('workflow-editor-finish',{projectId,reload:true});};
  }catch(error){busy.delete(projectId);if(!window.isDestroyed())window.webContents.send('workflow-editor-finish',{projectId,reload:false});throw error;}
  finally{clearTimeout(timer);}
 }
 return {begin,blocks:key=>busy.size>0&&(key==='gamecreator.projects.v1'||[...busy].some(id=>require('./folder-projects.cjs').owned(key,id)))};
}
module.exports={createWorkflowEditorGuard};
