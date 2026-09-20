import type { GameplayDesign } from './gameplay';
import type { DesignMap, MapConnection, MapDesignStore } from './map-design';
import { NumberField, Select, Text } from './StoryFields';
import { alignWorldConnection, connectionSpatial, defaultTravel, opposingPortalSides, portalSides, suggestedPortalSides, travelModes, worldPlacement, worldRoom, worldSettings } from './map-world';
const options=(items:Record<string,string>)=>Object.entries(items).map(([id,name])=>({id,name}));
export function WorldMapFields({store,map,designs,onChange}:{store:MapDesignStore;map:DesignMap;designs:GameplayDesign[];onChange:(patch:Partial<DesignMap>)=>void}) {
  const placement=worldPlacement(store,map),room=worldRoom(store,map,designs),settings=worldSettings(store);
  return <div className="mw-properties"><h4>世界位置与尺寸</h4><div className="md-numbers"><NumberField label="世界横坐标" value={placement.x} onChange={x=>onChange({placement:{...placement,x}})}/><NumberField label={settings.perspective==='side'?'世界纵坐标（向下）':'世界纵坐标（向南）'} value={placement.y} onChange={y=>onChange({placement:{...placement,y}})}/></div><NumberField label="局部单位换算比例" min={.001} value={placement.scale} onChange={scale=>onChange({placement:{...placement,scale}})}/><p className="md-help">世界尺寸 {Number(room.width.toFixed(2))} × {Number(room.height.toFixed(2))} {settings.unit}。尺寸来自内部行列与单位；比例用于将不同来源换算到统一世界单位。</p></div>;
}
export function WorldConnectionFields({store,connection:c,designs,onChange,onStore}:{store:MapDesignStore;connection:MapConnection;designs:GameplayDesign[];onChange:(patch:Partial<MapConnection>)=>void;onStore:(s:MapDesignStore)=>void}) {
  const settings=worldSettings(store),rule=c.travel??defaultTravel(),forward=connectionSpatial(store,c,designs),backward=connectionSpatial(store,c,designs,true),suggestion=suggestedPortalSides(store,c,designs);
  const sideOptions=(side:MapConnection['fromSide'])=>options(portalSides).filter(o=>o.id!=='auto'||!side||side==='auto');
  return <div className="mw-properties"><h4>空间衔接与移动</h4>
    <div className="mw-port-summary"><b>{forward.a?.room.name||'起点'} · {portalSides[forward.a?.side??'auto']}</b><span>连接到</span><b>{forward.b?.room.name||'终点'} · {portalSides[forward.b?.side??'auto']}</b></div>
    <Select label="出口所在侧面" value={c.fromSide??'auto'} options={sideOptions(c.fromSide)} onChange={fromSide=>{if(fromSide)onChange({fromSide:fromSide as MapConnection['fromSide']});}}/><Select label="入口所在侧面" value={c.toSide??'auto'} options={sideOptions(c.toSide)} onChange={toSide=>{if(toSide)onChange({toSide:toSide as MapConnection['toSide']});}}/>
    <button className="gp-secondary" disabled={!suggestion} onClick={()=>{if(suggestion)onChange(suggestion);}}>按当前布局设置朝向</button>
    <p className="md-help">朝向固定，拖动房间不会自动换边。{suggestion?`当前布局建议：${portalSides[suggestion.fromSide]} → ${portalSides[suggestion.toSide]}。`:'房间位置重合或尚未指定，请手动选择朝向。'}边缘位置沿用绑定对象的坐标。</p>
    <button className="gp-secondary" disabled={!forward.a||!forward.b||c.from===c.to||!opposingPortalSides(forward.a.side,forward.b.side)} onClick={()=>onStore(alignWorldConnection(store,c,designs))}>移动终点地图以对齐出入口</button>
    <Select label="正向移动方式" value={rule.forward} options={options(travelModes)} onChange={forward=>{if(forward)onChange({travel:{...rule,forward:forward as typeof rule.forward}});}}/>{c.direction==='both'&&<Select label="反向移动方式" value={rule.reverse} options={options(travelModes)} onChange={reverse=>{if(reverse)onChange({travel:{...rule,reverse:reverse as typeof rule.reverse}});}}/>}
    {settings.perspective==='side'&&<><div className="md-numbers"><NumberField label="最大上升高度" min={0} value={rule.maxRise} onChange={maxRise=>onChange({travel:{...rule,maxRise}})}/><NumberField label="最大水平跨度" min={0} value={rule.maxGap} onChange={maxGap=>onChange({travel:{...rule,maxGap}})}/><NumberField label="最大下落高度" min={0} value={rule.maxDrop} onChange={maxDrop=>onChange({travel:{...rule,maxDrop}})}/></div><p className="md-help">限制以 {settings.unit} 为单位，检查出入口之间的跨度；房间内部的平台和完整移动路径由关卡设计确定。</p></>}
    {[forward,...(c.direction==='both'?[backward]:[])].map((route,i)=><div className={'mw-route-status '+(route.allowed?'ok':'warn')} key={i}><b>{i?'反向':'正向'} · {route.description}</b><p>{route.reason||'出入口衔接满足当前设定'}</p></div>)}
  </div>;
}
