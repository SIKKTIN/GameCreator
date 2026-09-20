// Map layouts keep live references to the existing gameplay spaces. This script
// seeds only the optional module and never changes gameplay or prototype scenes.
import fs from 'node:fs';
import { validateMapDesign, mapIssues } from '../src/map-design.ts';
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
  e.mapDesign={schema:1,enabled:true,maps,connections};validateMapDesign(e.mapDesign);
  const issues=mapIssues(e.mapDesign,e.gameplay.designs);if(issues.length)throw new Error(issues.join('\n'));
  fs.writeFileSync(path,JSON.stringify(e,null,2)+'\n');console.log(file+': '+maps.length+' maps, '+connections.length+' connections');
}
