const {emptyContentDocument,validateContentArchive}=require('./project-content-model.cjs');
const {archiveKey}=require('./project-package.cjs');
const journalKey=id=>'gamecreator.workspace.v1:'+id+':project-change-journal';
function assertNoPendingContent(storage,projectId){const pending=storage.getItem(journalKey(projectId));if(pending&&pending!=='null')throw new Error('项目修改未完成，请先重新读取开发反馈恢复');}
function readContent(storage,projectId,module){assertNoPendingContent(storage,projectId);const key=archiveKey(projectId,module),raw=storage.getItem(key),defaults=emptyContentDocument().archives;if(!Object.hasOwn(defaults,module))throw new Error('未知项目内容模块');const value=raw===null?defaults[module]:JSON.parse(raw);validateContentArchive(module,value);return{key,raw,value};}
function recoverContent(storage,projectId){
 const key=journalKey(projectId),raw=storage.getItem(key);if(!raw)return false;const journal=JSON.parse(raw);if(journal===null)return false;
 if(journal.schema!==1||journal.projectId!==projectId||!Array.isArray(journal.entries)||journal.entries.length<1||journal.entries.length>2||new Set(journal.entries.map(e=>e.module)).size!==journal.entries.length)throw new Error('项目修改恢复记录损坏，已停止写入');
 for(const e of journal.entries){validateContentArchive(e.module,JSON.parse(e.after));if(e.before!==null)validateContentArchive(e.module,JSON.parse(e.before));const current=storage.getItem(archiveKey(projectId,e.module));if(current!==e.before&&current!==e.after)throw new Error('未完成的项目修改与当前内容冲突，请保留存档并恢复备份后重试');}
 // The local journal stores an already confirmed transaction, not commands supplied by the engine.
 for(const e of journal.entries){const destination=archiveKey(projectId,e.module);if(storage.getItem(destination)!==e.after)storage.setItem(destination,e.after);}
 storage.setItem(key,'null');return true;
}
function commitContent(storage,projectId,entries){
 if(storage.getItem(journalKey(projectId))&&!['null'].includes(storage.getItem(journalKey(projectId))))throw new Error('存在未完成的项目修改，请重新读取反馈恢复');
 for(const e of entries){validateContentArchive(e.module,JSON.parse(e.after));if(storage.getItem(archiveKey(projectId,e.module))!==e.before)throw new Error('项目内容在应用前已变化，请重新读取');}
 storage.setItem(journalKey(projectId),JSON.stringify({schema:1,projectId,entries}));
 try{recoverContent(storage,projectId);}catch(error){throw new Error('项目修改尚未完成，重新读取反馈将尝试恢复。'+error.message);}
}
module.exports={readContent,commitContent,recoverContent,assertNoPendingContent,validateContentArchive};
