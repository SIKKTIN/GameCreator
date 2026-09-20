// Map layouts keep live references to the existing gameplay spaces. This script
// seeds physical passages; the HK floor is split in its authoritative gameplay space.
import fs from 'node:fs';
import { validateMapDesign, mapIssues } from '../src/map-design.ts';
import { connectionSpatial, defaultTravel } from '../src/map-world.ts';
import { mergePassages, splitTerrainAtOpening } from '../src/map-passages.ts';
import { objectGeometry } from '../src/spatial-layout.ts';
for (const file of ['hollow-knight','stardew-valley']) {
  const path=new URL('../examples/prototypes/'+file+'.json',import.meta.url),e=JSON.parse(fs.readFileSync(path,'utf8'));
  const hk=file==='hollow-knight',owner=e.gameplay.designs.find(d=>d.space.spatial?.rooms.length),a=owner.space.spatial;
  const descriptions=hk?[
    '长椅作为探索中心：上层进入试炼，下层到达裂隙近岸。解锁远岸拉杆后，从长椅旁的近路快速返回后半段。保留三组独立出入口，避免出生点叠在交互门上。',
    '由左侧安全点进入，跨过触发线开始试炼。战斗期间封闭返回门；清场后开放冲刺印记与返程。获得冲刺后回到回廊探索先前无法通过的裂隙。',
    '近岸与远岸间隔六格尖刺沟，先展示能力门槛。冲刺越过后先开启永久近路，再抵达首领门；失败回收点放在战斗门外。',
    '左侧保留安全缓冲区，中段触发战斗并封门。场地中央留出冲刺与攻击空间；胜利后开放奖励箱和出口石碑，避免重复奖励。'
  ]:[
    '农田、农舍、出货箱和水井组成每日工作回路。东门接村庄西口；耕种区域与固定障碍分离，方便检查工具邻接范围和返家路线。沿用七日原型的室外交互范围。',
    '西口接农场，广场、柜台、河边与阿禾家门组成日程路线。采集点靠近步道；根据时段寻找阿禾并提交三颗萝卜，室外柜台承担商店交互。'
  ];
  const maps=a.rooms.map((r,i)=>{
    const id='map-'+r.id,source=e.gameplay.designs.find(d=>d.id===r.sourceDesignId),layers=['地形规划','障碍规划','环境装饰','任务与标记'].map((name,j)=>({id:id+'-layer-'+j,name,visible:true,locked:false}));
    const tasks=hk?[[],['hk-task-dash'],['hk-task-shortcut'],['hk-task-boss']][i]:[['farm-task-week'],['farm-task-turnips']][i];
    const add=(suffix,name,kind,x,y,width,height,layer,notes,references=[])=>({id:id+'-'+suffix,name,kind,x,y,width,height,layerId:layers[layer].id,color:kind==='task'?'violet':'green',notes,references});
    const objects=hk?[
      add('light','引导光源','decoration',i===2?16:5,3,1,1,2,'用环境光提示可探索的方向；仅作为地图美术布置。'),
      add('sign',i===0?'路线指示牌':'区域设计标记', 'note',i===2?19:8,2,2,1,3,descriptions[i],[{kind:'gameplay',targetId:source.id},...tasks.map(targetId=>({kind:'task',targetId}))])
    ]:i===0?[
      add('flowers','门旁花圃','decoration',1,5,1,2,2,'布置在日常行进路线边缘，不占据农田或固定交互点。'),
      add('guide','七日生活计划牌','task',8,8,1,1,3,'记录首周目标；连接任务目录，具体进度由任务模块管理。',[{kind:'task',targetId:tasks[0]}]),
      add('path-note','返家路线标记','note',11,5,1,1,3,'黄昏时从东门沿主路回到农舍，预留无障碍通路。',[{kind:'gameplay',targetId:source.id}])
    ]:[
      add('flowers','广场花坛','decoration',2,7,1,1,2,'广场边缘的环境装饰，避开NPC停留点。'),
      add('board','村口委托告示','task',1,4,1,1,3,'指引玩家寻找阿禾；关联三颗萝卜任务。',[{kind:'task',targetId:tasks[0]}]),
      add('lantern','河边路灯','decoration',12,6,1,1,2,'以灯光提示傍晚的河边步道。')
    ];
    return {id,name:r.name,region:hk?'裂隙遗迹':'春日河谷',description:descriptions[i],perspective:hk?'side':'top',view:r.view,x:r.x,y:r.y,rows:source.space.rows,columns:source.space.columns,cellSize:source.space.cellSize,unit:source.space.unit,sourceDesignId:source.id,roomId:'',sourceVisible:true,sourceLocked:true,layers,objects};
  });
  const connections=a.connections.map(c=>({id:'map-'+c.id,name:c.name,from:'map-'+c.from,to:'map-'+c.to,fromObjectId:c.fromObjectId,toObjectId:c.toObjectId,direction:c.direction,kind:c.name.includes('近路')?'shortcut':'passage',condition:c.condition==='shortcutOpen'?'已从远岸打开永久近路':c.condition==='trial门未封闭'?'试炼门未封闭':c.condition}));
  for(const [i,m] of maps.entries())m.placement={x:hk?(i%2)*24:i*16,y:hk?Math.floor(i/2)*16:0,scale:1};
  e.mapDesign={schema:1,enabled:true,world:{perspective:hk?'side':'top',unit:hk?'格':'地块',snap:1},maps,connections};
  for(const c of connections){
    const from=maps.findIndex(m=>m.id===c.from),to=maps.findIndex(m=>m.id===c.to),vertical=hk&&Math.floor(from/2)!==Math.floor(to/2);
    c.fromSide=vertical?(from<to?'bottom':'top'):(from<to?'right':'left');c.toSide=vertical?(from<to?'top':'bottom'):(from<to?'left':'right');
    c.travel={...defaultTravel(),forward:vertical?(from<to?'drop':'climb'):hk?'jump':'walk',reverse:vertical?(from<to?'climb':'drop'):hk?'jump':'walk',maxRise:16,maxGap:24,maxDrop:20};
  }
  const addOpening=(m,id,side,offset,width=2)=>{const o={id:m.id+'-opening-'+id,name:id,side,offset,width};m.openings=[...(m.openings??[]),o];return o.id;};
  if(hk){
    const [A,B,C,D]=maps;
    const ar=addOpening(A,'试炼通道','right',9),bl=addOpening(B,'回廊通道','left',9),an=addOpening(A,'近岸竖井','bottom',4),cn=addOpening(C,'近岸竖井','top',4),as=addOpening(A,'远岸近路','bottom',18),cs=addOpening(C,'远岸近路','top',18),cr=addOpening(C,'首领通道','right',9),dl=addOpening(D,'裂隙通道','left',9);
    for(const [first,back,fo,to] of [['A_B','B_A',ar,bl],['A_C','C_A',an,cn],['A_C_short','C_A_short',as,cs],['C_D','D_C',cr,dl]]){
      const f=e.mapDesign.connections.find(c=>c.id==='map-hk-sp-'+first),r=e.mapDesign.connections.find(c=>c.id==='map-hk-sp-'+back);
      f.fromOpeningId=fo;f.toOpeningId=to;r.fromOpeningId=to;r.toOpeningId=fo;
      e.mapDesign=mergePassages(e.mapDesign,f.id,r.id);
      const merged=e.mapDesign.connections.find(c=>c.id===f.id),vertical=first.includes('A_C');
      merged.name=vertical?(first.includes('short')?'永久近路':'近岸竖井'):first==='A_B'?'回廊与试炼':'裂隙与首领';
      merged.structure=vertical?'ladder':'open';merged.travel.forward=vertical?'climb':'jump';merged.travel.reverse=vertical?'climb':'jump';
    }
    for(const m of [A,C])for(const offset of [4,18]){const id=m.id+'-ladder-'+offset;m.objects.push({id,name:offset===4?'近岸竖井梯子':'远岸近路梯子',kind:'note',layerId:m.layers[0].id,x:offset-1,y:m===A?8:0,width:2,height:m===A?4:10,color:'amber',notes:'与实际井口对齐的可攀爬路径',references:[]});m.surfaces=[...(m.surfaces??[]),{objectId:id,kind:'ladder'}];}
    // These two authored platforms intentionally allow passage from below.
    const source=e.gameplay.designs.find(d=>d.id===A.sourceDesignId);
    A.surfaces=[...(A.surfaces??[]),...source.space.objects.filter(o=>o.name.startsWith('单向平台')).map(o=>({objectId:o.id,kind:'one-way'}))];
    const floor=source.space.objects.find(o=>o.id==='68fd2f24-3b6b-44c7-bf5c-178e363a210e');
    let pieces=[{...objectGeometry(floor,source.space),x:0,y:10,width:24,height:2}];
    for(const opening of A.openings.filter(o=>o.side==='bottom'))pieces=pieces.flatMap(g=>opening.offset+opening.width/2>g.x&&opening.offset-opening.width/2<g.x+g.width?splitTerrainAtOpening(g,opening):[g]);
    source.space.objects=source.space.objects.filter(o=>!o.id.startsWith('map-cut-hk-A-')).flatMap(o=>o.id===floor.id?pieces.map((geometry,i)=>({...o,id:i?'map-cut-hk-A-'+i:o.id,name:'井口间底板 '+(i+1),geometry})):[o]);
    A.description='近岸竖井和远岸近路都有实际开口、上下梯子；试炼通道从右侧进入。往返各保留独立的门与安全落点。';
  }else{
    const c=e.mapDesign.connections[0];c.fromOpeningId=addOpening(maps[0],'东侧道路','right',5.5);c.toOpeningId=addOpening(maps[1],'西侧道路','left',5.5);c.structure='open';
  }
  validateMapDesign(e.mapDesign);
  for(const c of e.mapDesign.connections)for(const reverse of c.direction==='both'?[false,true]:[false]){const r=connectionSpatial(e.mapDesign,c,e.gameplay.designs,reverse);if(r.reason)throw new Error(c.name+': '+r.reason);}
  const issues=mapIssues(e.mapDesign,e.gameplay.designs);if(issues.length)throw new Error(issues.join('\n'));
  fs.writeFileSync(path,JSON.stringify(e,null,2)+'\n');console.log(file+': '+maps.length+' maps, '+e.mapDesign.connections.length+' connections');
}
