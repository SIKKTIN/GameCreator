import {useSearchRequest} from './GlobalSearch';
import {useEffect,useRef,useState} from 'react';
import {beforeLogoutEvent} from './auth';
import {GameplayDesigns} from './GameplayDesigns';
import {validateGameplay,type GameplayDesign,type GameplaySources} from './gameplay';
import type {GameplayController} from './useGameplayDesigns';
import {applyGameplayPatch,emptyGameplaySnapshot,gameplayDirty,gameplayPatch,gameplaySections,reconcileGameplay,validateGameplayDraft,validateGameplayLayout,withGameplayLayout,type GameplayDraft,type GameplayLayout,type GameplaySnapshot} from './team-gameplay-model';
import {canEditModule,leaveTeamEvent,teamRequest,TeamError,type TeamCapabilities,type TeamRole,type TeamSession,type TeamStory} from './team-api';
import {workspaceStorage} from './workspace-storage';
import './team-gameplay.css';

type Response=GameplaySnapshot&{role:TeamRole;capabilities:TeamCapabilities};
type HistoryItem={design:GameplayDesign;revision:number;updatedAt:string;updatedBy:string};
export function useTeamGameplay(session:TeamSession,projectId:string,blocked:boolean,onDenied:(status:number)=>void){
  const key=`gamecreator.team-draft.v1:${session.serverId}:${session.user.id}:${projectId}:gameplay`;
  const layoutKey=`gamecreator.team-gameplay-layout.v1:${session.serverId}:${session.user.id}:${projectId}`;
  const [initial]=useState(()=>{try{const raw=workspaceStorage.getItem(key),value=raw?JSON.parse(raw):null;return{draft:value?validateGameplayDraft(value):{base:emptyGameplaySnapshot(),store:emptyGameplaySnapshot().store},error:''};}catch(e){return{draft:{base:emptyGameplaySnapshot(),store:emptyGameplaySnapshot().store},error:'玩法设计草稿读取失败，已停止写入：'+String(e)};}});
  const [initialLayout]=useState(()=>{try{const raw=workspaceStorage.getItem(layoutKey);return{value:raw?validateGameplayLayout(JSON.parse(raw)):{} as GameplayLayout,error:''};}catch(e){return{value:{} as GameplayLayout,error:'个人房间布局读取失败：'+String(e)};}});
  const [draft,setDraft]=useState<GameplayDraft>(initial.draft),current=useRef(draft);
  const [layout,setLayout]=useState(initialLayout.value),positions=useRef(layout);
  const [remote,setRemote]=useState<Response>(),[loaded,setLoaded]=useState(false),[saving,setSaving]=useState(false);
  const [error,setError]=useState(''),[syncError,setSyncError]=useState(''),[diskError,setDiskError]=useState(initial.error),[layoutError,setLayoutError]=useState(initialLayout.error);
  const [conflict,setConflict]=useState<{remote:GameplaySnapshot;ids:string[]}|null>(null);
  const alive=useRef(true),savingRef=useRef(false),epoch=useRef(0),denied=useRef(onDenied);denied.current=onDenied;
  const operation=useRef<{signature:string;id:string}|null>(null),route=`/projects/${encodeURIComponent(projectId)}/gameplay`;
  const persist=(next:GameplayDraft)=>{
    if(initial.error)return false;
    try{const value=JSON.stringify(gameplayDirty(next)?next:null);if(workspaceStorage.getItem(key)!==value)workspaceStorage.setItem(key,value);setDiskError('');return true;}
    catch(e){setDiskError('草稿尚未写入本机，请保持窗口打开：'+String(e));return false;}
  };
  const change=(next:GameplayDraft)=>{current.current=next;setDraft(next);persist(next);};
  const receive=(value:Response)=>{
    setRemote(value);setLoaded(true);if(initial.error)return;
    const result=reconcileGameplay(current.current,value);
    if(result.conflicts.length)setConflict({remote:value,ids:result.conflicts});
    else{change(result.draft);setConflict(null);if(!gameplayDirty(result.draft))setError('');}
  };
  useEffect(()=>{
    alive.current=true;let active=true,timer:number;
    const poll=async()=>{
      const started=epoch.current;
      try{if(!savingRef.current){const value=await teamRequest<Response>(session.url,route,session.token);if(active&&started===epoch.current&&!savingRef.current){receive(value);setSyncError('');}}}
      catch(reason){if(active){setSyncError((reason as Error).message);if(reason instanceof TeamError&&[401,403,410].includes(reason.status)){setRemote(undefined);denied.current(reason.status);}}}
      finally{if(active)timer=window.setTimeout(poll,2000);}
    };
    if((session.apiVersion??0)>=9)void poll();return()=>{active=false;alive.current=false;window.clearTimeout(timer);};
  },[session,projectId]);
  useEffect(()=>{
    const guard=(event:Event)=>{if(savingRef.current||(diskError&&!initial.error)||(layoutError&&!initialLayout.error))event.preventDefault();};
    const unload=(event:BeforeUnloadEvent)=>{if(savingRef.current||(diskError&&!initial.error)||(layoutError&&!initialLayout.error)){event.preventDefault();event.returnValue='';}};
    window.addEventListener(leaveTeamEvent,guard);window.addEventListener(beforeLogoutEvent,guard);window.addEventListener('beforeunload',unload);
    return()=>{window.removeEventListener(leaveTeamEvent,guard);window.removeEventListener(beforeLogoutEvent,guard);window.removeEventListener('beforeunload',unload);};
  },[diskError,layoutError]);
  const readOnly=blocked||!loaded||!remote||!canEditModule(session,remote.role,remote.capabilities,'gameplay');
  const patch=gameplayPatch(draft.base,draft.store),dirty=gameplayDirty(draft);
  const save=async(id?:string)=>{
    if(readOnly||savingRef.current||conflict||initial.error||!dirty)return;
    const fields=gameplayPatch(current.current.base,withGameplayLayout(current.current.store,positions.current));
    if(id){if(fields.categories)return;fields.changes=fields.changes.filter(c=>c.id===id);}
    if(!fields.changes.length&&!fields.categories)return;
    const signature=JSON.stringify(fields);if(operation.current?.signature!==signature)operation.current={signature,id:crypto.randomUUID()};
    savingRef.current=true;++epoch.current;setSaving(true);setError('');
    try{const result=await teamRequest<Response>(session.url,route,session.token,'PUT',{...fields,requestId:operation.current.id});if(alive.current)receive(result);}
    catch(reason){if(alive.current){setError((reason as Error).message);if(reason instanceof TeamError){if(reason.status===409&&reason.currentRecord)setConflict({remote:reason.currentRecord as GameplaySnapshot,ids:[...fields.changes.map(c=>c.id),...(fields.categories?['$categories']:[])]});if([401,403,410].includes(reason.status)){setRemote(undefined);denied.current(reason.status);}}}}
    finally{savingRef.current=false;++epoch.current;if(alive.current)setSaving(false);}
  };
  const moveRoom=(designId:string,roomId:string,x:number,y:number)=>{
    if(initialLayout.error)return;
    const value={...positions.current,[designId]:{...positions.current[designId],[roomId]:{x,y}}};positions.current=value;setLayout(value);
    try{workspaceStorage.setItem(layoutKey,JSON.stringify(value));setLayoutError('');}catch(e){setLayoutError('个人布局未写入本机：'+String(e));}
  };
  const controller:GameplayController={store:withGameplayLayout(draft.store,layout),blocked:!!initial.error,pending:dirty,error:diskError,
    retry:()=>persist(current.current),update:update=>{
      if(readOnly||savingRef.current||initial.error)return false;
      try{const store=validateGameplay(update(structuredClone(withGameplayLayout(current.current.store,positions.current))));change({...current.current,store});setError('');return true;}
      catch(e){setError((e as Error).message);return false;}
    }};
  const resolve=(keep:boolean)=>{
    if(!conflict||savingRef.current||initial.error||(keep&&readOnly))return;
    if(!keep&&!window.confirm('丢弃本机玩法设计草稿并采用团队内容？个人房间布局会保留。'))return;
    try{const store=keep?applyGameplayPatch(conflict.remote.store,gameplayPatch(current.current.base,current.current.store)):conflict.remote.store;change({base:conflict.remote,store});setConflict(null);setError('');}
    catch(e){setError((e as Error).message);}
  };
  return{controller,draft,remote,loaded,readOnly,saving,dirty,patch,save,conflict,resolve,moveRoom,layoutError,error,syncError,diskError,
    retryLayout:()=>{const d=Object.entries(positions.current)[0],r=d&&Object.entries(d[1])[0];if(d&&r)moveRoom(d[0],r[0],r[1].x,r[1].y);}};
}

export function TeamGameplayDesign({state,session,projectId,stories,selectedId,onSelect,onOpenStory}:{state:ReturnType<typeof useTeamGameplay>;session:TeamSession;projectId:string;stories:TeamStory[];selectedId:string;onSelect:(id:string)=>void;onOpenStory:(id:string)=>void}){
  const searchRequest=useSearchRequest('玩法设计');
  const [history,setHistory]=useState<{id:string;items:HistoryItem[]}|null>(null),[historyError,setHistoryError]=useState(''),[busy,setBusy]=useState(false);
  const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const {controller,draft,remote,readOnly,saving,dirty,patch,conflict}=state,selected=controller.store.designs.find(d=>d.id===selectedId);
  const references=remote?.references??draft.base.references;
  const sourceStories=[...new Map(references.filter(r=>r.kind==='story').map(r=>[r.targetId,{id:r.targetId,title:r.title+'（来源文档尚未导入）',sourceOnly:true}])).values()].filter(r=>!stories.some(s=>s.id===r.id));
  const sources:GameplaySources={stories:[...stories.map(s=>({id:s.id,title:s.title})),...sourceStories],datasets:[...new Map(references.filter(r=>r.kind==='dataset').map(r=>[r.targetId,{key:r.targetId,label:r.title+'（尚未接入协作）'}])).values()]};
  const showHistory=async()=>{if(!selected||busy)return;setBusy(true);setHistoryError('');const id=selected.id;try{const result=await teamRequest<{history:HistoryItem[]}>(session.url,`/projects/${encodeURIComponent(projectId)}/gameplay/${encodeURIComponent(id)}/history`,session.token);if(alive.current)setHistory({id,items:result.history});}catch(e){if(alive.current)setHistoryError((e as Error).message);}finally{if(alive.current)setBusy(false);}};
  const exportDraft=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({...draft,store:controller.store},null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='gameplay-team-draft.json';link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const stamp=selected&&draft.base.stamps[selected.id];
  return <section className="team-gameplay" aria-label="团队玩法设计">
    <div className="team-editor-heading"><p>{selected?`当前玩法版本 ${draft.base.versions[selected.id]??0}${stamp?' · '+stamp.updatedBy+' · '+new Date(stamp.updatedAt).toLocaleString('zh-CN'):''}`:`玩法库 · ${controller.store.designs.length} 份文档`}</p><div className="team-actions">
      {selected&&<button disabled={busy} onClick={()=>void showHistory()}>玩法修改历史</button>}{dirty&&<button onClick={exportDraft}>导出玩法设计草稿</button>}
      {selected&&<button disabled={readOnly||saving||!!conflict||!!patch.categories||!patch.changes.some(c=>c.id===selected.id)} onClick={()=>void state.save(selected.id)}>保存当前玩法到团队</button>}
      <button className="team-primary" disabled={readOnly||saving||!!conflict||!dirty} onClick={()=>void state.save()}>{saving?'正在提交…':'保存全部玩法修改'}</button></div></div>
    <div className={'team-core-status'+(dirty?' pending':'')} data-testid="gameplay-save-state" role="status">{!state.loaded?'正在读取团队玩法…':readOnly?'玩法设计只读':dirty?`本机草稿：${patch.changes.length} 份玩法${patch.categories?'及分类':''}待提交`:'玩法设计已与团队同步'} · 浏览与房间排布不计入修改</div>
    {patch.categories&&<p>分类调整会与受影响的文档一起提交，请使用“保存全部玩法修改”。</p>}
    {readOnly&&dirty&&<p>你的未提交草稿保留在本机，尚未写入团队。</p>}
    {[state.error,state.syncError,state.diskError,state.layoutError,historyError].filter(Boolean).map((e,i)=><p className="team-message" role="alert" key={i}>{e}</p>)}
    {state.diskError&&!controller.blocked&&<button onClick={controller.retry}>重试保存玩法草稿</button>}{state.layoutError&&<button onClick={state.retryLayout}>重试保存房间布局</button>}
    {conflict&&<section className="team-conflict" aria-label="玩法设计冲突"><h2>玩法设计已有团队修改</h2><p>你的草稿保留在编辑区。对照下方各部分内容，修改后确认合并，再提交到团队。</p>
      {conflict.ids.map(id=>id==='$categories'?<details open key={id}><summary>分类列表</summary><div className="team-core-diff"><pre>{controller.store.categories?.map(c=>c.name+'：'+c.description).join('\n')}</pre><pre>{conflict.remote.store.categories?.map(c=>c.name+'：'+c.description).join('\n')}</pre></div></details>:
        <GameplayComparison key={id} mine={controller.store.designs.find(d=>d.id===id)} latest={conflict.remote.store.designs.find(d=>d.id===id)} mineStore={controller.store} latestStore={conflict.remote.store}/>)}
      <div className="team-actions"><button disabled={readOnly||saving} onClick={()=>state.resolve(true)}>已对照合并玩法，准备提交</button><button disabled={saving||controller.blocked} onClick={()=>state.resolve(false)}>采用团队版本并丢弃玩法设计草稿</button></div></section>}
    {(state.loaded||dirty)&&<GameplayDesigns initialSource={searchRequest?{kind:searchRequest.kind||'design',id:searchRequest.parent?searchRequest.id:''}:undefined} controller={controller} readOnly={readOnly||saving} team selectedId={selectedId} onSelect={onSelect} sources={sources} onRoomMove={state.moveRoom}
      onOpenLink={l=>{if(l.kind==='story'&&stories.some(s=>s.id===l.targetId))onOpenStory(l.targetId);}}
      renderImplementation={d=><div className="team-gameplay-references">{d.links.filter(l=>l.kind==='story'&&stories.some(s=>s.id===l.targetId)).map(l=><button className="gp-secondary" key={l.targetId} onClick={()=>onOpenStory(l.targetId)}>打开团队故事：{stories.find(s=>s.id===l.targetId)?.title}</button>)}
        {references.filter(r=>r.designId===d.id&&(r.kind==='function'||r.kind==='art'||(r.kind==='story'&&!stories.some(s=>s.id===r.targetId)))).map((r,i)=><p key={i}>来源{r.kind==='function'?'功能':r.kind==='art'?'素材':'故事'}：{r.title} · {r.targetId} · 尚未接入当前团队内容</p>)}</div>}/>}
    {history&&history.id===selectedId&&<section className="team-history" aria-label="玩法修改历史"><div><h2>最近的玩法修改记录</h2><button onClick={()=>setHistory(null)}>收起玩法历史</button></div>{history.items.length?history.items.map(item=><details key={item.revision}><summary>版本 {item.revision} · {item.updatedBy} · {new Date(item.updatedAt).toLocaleString('zh-CN')}</summary>{gameplaySections(item.design,{...controller.store,designs:controller.store.designs.map(d=>d.id===item.design.id?item.design:d)}).map(s=><details key={s.label}><summary>{s.label}</summary><pre>{s.text}</pre></details>)}</details>):<p>尚未提交团队版本</p>}</section>}
  </section>;
}
function GameplayComparison({mine,latest,mineStore,latestStore}:{mine?:GameplayDesign;latest?:GameplayDesign;mineStore:GameplaySnapshot['store'];latestStore:GameplaySnapshot['store']}){
  const mineSections=mine?gameplaySections(mine,mineStore):[],latestSections=latest?gameplaySections(latest,latestStore):[];
  return <details open><summary>{mine?.title??latest?.title??'玩法文档'}</summary>{(mineSections.length?mineSections:latestSections).map((s,i)=>mineSections[i]?.text===latestSections[i]?.text?null:<details key={s.label} open><summary>{s.label}</summary><div className="team-core-diff"><div><strong>我的草稿</strong><pre>{mineSections[i]?.text??'无'}</pre></div><div><strong>团队内容</strong><pre>{latestSections[i]?.text??'尚未创建'}</pre></div></div></details>)}</details>;
}
