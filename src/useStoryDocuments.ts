import {useEffect,useRef,useState} from 'react';
import {workspaceStorage} from './workspace-storage';
import {validateStories} from './story-library';
import type {StoryDoc} from './story-model';
import {beforeLogoutEvent} from './auth';
import {leaveTeamEvent} from './team-api';
export function useStoryDocuments(id:string,defaults:StoryDoc[]){
 const key='gamecreator.workspace.v1:'+id+':stories';const [initial]=useState(()=>{try{const raw=workspaceStorage.getItem(key);return{raw,docs:raw===null?defaults:validateStories(JSON.parse(raw)),error:''};}catch(e){return{raw:null,docs:[] as StoryDoc[],error:'故事文档读取失败，已停止写入：'+String(e)};}});
 const [docs,setDocs]=useState(initial.docs),[error,setError]=useState(initial.error),[loadError,setLoadError]=useState(initial.error),[pending,setPending]=useState(false),current=useRef(docs),committed=useRef(initial.raw);
 const save=(next:StoryDoc[])=>{try{if(loadError)throw new Error(loadError);validateStories(next);if(workspaceStorage.getItem(key)!==committed.current)throw new Error('其他窗口已更新故事文档，请先导出草稿后重新读取');const raw=JSON.stringify(next);workspaceStorage.setItem(key,raw);committed.current=raw;setPending(false);setError('');return true;}catch(e){setPending(true);setError('故事草稿尚未保存：'+String(e));return false;}};
 const update=(action:StoryDoc[]|((current:StoryDoc[])=>StoryDoc[]))=>{if(loadError)return false;const next=validateStories(typeof action==='function'?action(current.current):action);current.current=next;setDocs(next);return save(next);};
 useEffect(()=>{const guard=(e:Event)=>{if(pending)e.preventDefault();},close=(e:BeforeUnloadEvent)=>{if(pending){e.preventDefault();e.returnValue='';}};window.addEventListener(beforeLogoutEvent,guard);window.addEventListener(leaveTeamEvent,guard);window.addEventListener('beforeunload',close);return()=>{window.removeEventListener(beforeLogoutEvent,guard);window.removeEventListener(leaveTeamEvent,guard);window.removeEventListener('beforeunload',close);};},[pending]);
 const reload=()=>{try{const raw=workspaceStorage.getItem(key),next=raw===null?defaults:validateStories(JSON.parse(raw));committed.current=raw;current.current=next;setDocs(next);setPending(false);setLoadError('');setError('');return true;}catch(e){setError(String(e));return false;}};
 return {docs,update,error,pending,blocked:!!loadError,retry:()=>save(current.current),reload};
}
