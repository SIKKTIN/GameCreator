const {createGameplay}=require('../src/gameplay.ts');
const {createStageObject}=require('../src/gameplay-stage.ts');
const {createSpatialRoom}=require('../src/spatial-layout.ts');
function sample(){
  const a={...createGameplay('战斗设计'),id:'combat',categoryId:'action',tags:['战斗'],summary:'测试战斗'},b={...createGameplay('养成设计'),id:'growth'};
  a.loop=[{id:'step',text:'战斗后成长'}];a.prototype=[{id:'proto',text:'敌人',done:true}];a.checks=[{id:'check',question:'是否有反馈',steps:'攻击',expected:'伤害数字',actual:'观察到了',result:'通过'}];
  a.dependencies=[{id:'dep',targetId:b.id,kind:'collaborates',note:'共享成长'}];
  a.conditionRules=[{id:'rule',name:'攻击规则',trigger:'攻击时',mode:'all',conditions:[{id:'condition',subject:'生命',operator:'gt',value:'0'}],actions:[{id:'act',text:'伤害'}],otherwise:[]}];
  a.stateFlow={initialStateId:'idle',states:[{id:'idle',name:'待机',description:'等待输入',kind:'normal'},{id:'fight',name:'战斗',description:'出招',kind:'normal'}],transitions:[{id:'transition',fromId:'idle',toId:'fight',event:'攻击',condition:'存活',action:'扣体力',priority:1}]};
  a.space.objects=[{...createStageObject('actor',1,1),id:'actor',name:'玩家'}];
  a.space.spatial={version:1,view:'grid',rooms:[{...createSpatialRoom(0),id:'room-a',name:'房间甲'},{...createSpatialRoom(1),id:'room-b',name:'房间乙'}],connections:[{id:'passage',name:'连接',from:'room-a',to:'room-b',fromObjectId:'',toObjectId:'',direction:'both',condition:'',ruleId:'rule'}]};
  b.timeline={duration:60,clock:'游戏时间',spaceOwnerId:a.id,tracks:[{id:'track',name:'主轨',color:'violet'}],events:[{id:'event',trackId:'track',name:'刷怪',start:5,duration:2,repeat:1,interval:0,quantity:1,objectId:'actor',condition:'',notes:''}]};
  return{schema:3,categories:[{id:'action',name:'动作',description:'动作类',icon:'combat'}],designs:[a,b]};
}
module.exports={sample};
