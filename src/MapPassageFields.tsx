import { useState } from 'react';
import type { GameplayDesign } from './gameplay';
import { mapStage, type DesignMap, type MapConnection, type MapDesignStore, type MapOpening, type SurfaceKind } from './map-design';
import { NumberField, Select, Text } from './StoryFields';
import { alignPassageOpening, createPassageOpenings, mergePassages } from './map-passages';
import { defaultActor } from './map-navigation';
export const surfaceNames={solid:'实体地形', 'one-way':'单向平台（可从下方穿过）',ladder:'梯子',decoration:'不阻挡 / 装饰'};
export const openingNames={left:'左侧',right:'右侧',top:'顶部',bottom:'底部'};
const options=(v:Record<string,string>)=>Object.entries(v).map(([id,name])=>({id,name}));

export function PassageFields({store,c,designs,onChange,onStore,onPreview}:{store:MapDesignStore;c:MapConnection;designs:GameplayDesign[];onChange:(p:Partial<MapConnection>)=>void;onStore:(s:MapDesignStore)=>void;onPreview:(reverse:boolean)=>void}) {
  const [error,setError]=useState(''),[peer,setPeer]=useState('');
  const act=(f:()=>MapDesignStore)=>{try{onStore(f());setError('');}catch(e){setError(String(e));}};
  const peers=store.connections.filter(v=>v.id!==c.id&&v.direction==='one'&&c.direction==='one'&&v.from===c.to&&v.to===c.from&&v.kind===c.kind);
  const objects=(id:string)=>{const m=store.maps.find(m=>m.id===id);return m?mapStage(m,designs).objects.map(o=>({id:o.id,name:o.name})):[];};
  return <div className="mw-properties"><h4>物理通道</h4>
    {(['from','to'] as const).map(end=><Select key={end} label={end==='from'?'起点物理开口':'终点物理开口'} value={c[end==='from'?'fromOpeningId':'toOpeningId']??''} options={store.maps.find(m=>m.id===c[end])?.openings??[]} blank="尚未指定" onChange={id=>onChange({[end==='from'?'fromOpeningId':'toOpeningId']:id})}/>)}
    <button className="gp-secondary" onClick={()=>act(()=>createPassageOpenings(store,c,designs))}>创建两端物理开口</button>
    <button className="gp-secondary" disabled={!c.fromOpeningId||!c.toOpeningId} onClick={()=>act(()=>alignPassageOpening(store,c,designs))}>对齐开口位置（保留房间）</button>
    <p className="md-help">开口具有独立位置和宽度。创建开口后，仍需在地图画布为地形开洞，并布置室内可达路径。</p>
    <Select label="连接段结构" value={c.structure??'open'} options={[{id:'open',name:'开放空间'},{id:'ladder',name:'连接梯子'},{id:'bridge',name:'水平桥面'}]} onChange={structure=>{if(structure)onChange({structure:structure as MapConnection['structure']});}}/>
    {c.direction==='both'&&<><Select label="返程出发点" value={c.reverseFromObjectId??c.toObjectId} options={objects(c.to)} onChange={reverseFromObjectId=>onChange({reverseFromObjectId})}/><Select label="返程安全落点" value={c.reverseToObjectId??c.fromObjectId} options={objects(c.from)} onChange={reverseToObjectId=>onChange({reverseToObjectId})}/><Text label="返程通行条件" rows={2} value={c.reverseCondition??c.condition} onChange={reverseCondition=>onChange({reverseCondition})}/></>}
    {!!peers.length&&<><Select label="合并为往返的通路" value={peer} options={peers.map(v=>({id:v.id,name:v.name+' · '+(v.condition||'无附加条件')}))} onChange={setPeer}/><button className="gp-secondary" disabled={!peer} onClick={()=>act(()=>mergePassages(store,c.id,peer))}>合并往返为一条通路</button><p className="md-help">仅合并同一个物理通道。各方向的条件、落点和原型引用会保留；普通路与近路应分别编辑。</p></>}
    <div className="gp-actions"><button className="gp-secondary" onClick={()=>onPreview(false)}>查看正向路线</button>{c.direction==='both'&&<button className="gp-secondary" onClick={()=>onPreview(true)}>查看返程路线</button>}</div>
    {error&&<p role="alert" className="mw-blocked">{error}</p>}
  </div>;
}

export function OpeningFields({map,designs,onChange,onRemove}:{map:DesignMap;designs:GameplayDesign[];onChange:(p:Partial<DesignMap>)=>void;onRemove:(id:string)=>void}) {
  const stage=mapStage(map,designs),change=(id:string,p:Partial<MapOpening>)=>onChange({openings:(map.openings??[]).map(o=>o.id===id?{...o,...p}:o)});
  return <div className="mw-properties"><h4>房间物理开口</h4>{(map.openings??[]).map(o=><details key={o.id} className="mw-opening" open><summary>{o.name} · {openingNames[o.side]}</summary><Text label={'开口名称 '+o.id} value={o.name} onChange={name=>change(o.id,{name})}/><Select label={'开口朝向 '+o.name} value={o.side} options={options(openingNames)} onChange={side=>{if(side)change(o.id,{side:side as MapOpening['side']});}}/><NumberField label={'开口位置 '+o.name} min={0} value={o.offset} onChange={offset=>change(o.id,{offset})}/><NumberField label={'开口宽度 '+o.name} min={.05} value={o.width} onChange={width=>change(o.id,{width})}/><button className="gp-secondary" onClick={()=>onRemove(o.id)}>删除开口</button></details>)}<button className="gp-secondary" onClick={()=>onChange({openings:[...(map.openings??[]),{id:crypto.randomUUID(),name:'新开口',side:'bottom',offset:stage.columns*stage.cellSize/2,width:Math.min(2,stage.columns*stage.cellSize)}]})}>添加物理开口</button><p className="md-help">位置是沿房间边缘的中心坐标。开口标记可在地图画布拖动；它不会自动挖空地形。</p></div>;
}

export function TerrainFields({map,objectId,kind,locked,onSurface,onCut}:{map:DesignMap;objectId:string;kind:string;locked:boolean;onSurface:(kind:SurfaceKind)=>void;onCut:(opening:MapOpening)=>void}) {
  const [openingId,setOpeningId]=useState('');const collision=map.surfaces?.find(v=>v.objectId===objectId)?.kind??(['terrain','obstacle','building'].includes(kind)?'solid':'decoration');
  return <fieldset disabled={locked} className="mw-properties"><h4>通行地形</h4><Select label="通行属性" value={collision} options={options(surfaceNames)} onChange={v=>{if(v)onSurface(v as SurfaceKind);}}/>{collision==='solid'&&<><Select label="地形开洞位置" value={openingId} options={map.openings??[]} onChange={setOpeningId}/><button className="gp-secondary" disabled={!openingId} onClick={()=>{const o=map.openings?.find(o=>o.id===openingId);if(o)onCut(o);}}>沿此开口切开地形</button><p className="md-help">将选中的矩形地形拆分为开口两侧的保留部分。来源地形需先解锁。</p></>}</fieldset>;
}

export function ActorFields({store,onChange}:{store:MapDesignStore;onChange:(s:MapDesignStore)=>void}) {
  const actor=store.world?.actor??defaultActor();return <details className="mw-agent"><summary>通行角色与能力</summary><div className="mw-agent-grid">{(Object.entries({width:'角色宽度',height:'角色高度',stepHeight:'可跨台阶高度',jumpRise:'角色最大跳高',jumpGap:'角色最大跳远',maxDrop:'角色最大安全落差'}) as [keyof typeof actor,string][]).map(([key,label])=><NumberField key={key} label={label} min={key==='width'||key==='height'?.05:0} value={actor[key]} onChange={v=>onChange({...store,world:{perspective:'top',unit:'格',snap:1,...store.world,actor:{...actor,[key]:v}}})}/>)}</div><p className="md-help">以世界单位验证矩形角色的净空、地面支撑、梯子和平台路线。待完善的路线不能通行。</p></details>;
}
