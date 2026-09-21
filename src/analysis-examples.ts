import { newAnalysisPlan, planFromStoryCheck, type AnalysisParameter, type AnalysisMetric, type AnalysisSources, type AnalysisPlan } from './numerical-analysis.ts';
const constant=(id:string,name:string,value:number,unit='',minimum:number|null=0):AnalysisParameter=>({id,name,value,unit,minimum,maximum:null,type:'number',binding:{kind:'constant'}});
const cell=(id:string,name:string,table:string,rowId:string,field:string,unit='',minimum:number|null=0):AnalysisParameter=>({...constant(id,name,0,unit,minimum),binding:{kind:'cell',table,rowId,field}});
const metric=(id:string,name:string,formula:string,unit=''):AnalysisMetric=>({id,name,formula,unit,minimum:null,maximum:null});
const plan=(name:string,notes:string,parameters:AnalysisParameter[],metrics:AnalysisMetric[],table=''):AnalysisPlan=>({...newAnalysisPlan(name),notes,parameters,metrics,batch:table?{table,rowIds:[]}:null});
export const analysisExampleGroups=[
  {id:'hollow-knight',name:'空洞骑士 · 战斗与治疗',tables:['hk_params','hk_enemies']},
  {id:'stardew-valley',name:'星露谷 · 作物收益',tables:['farm_crops','farm_items']},
  {id:'plants-vs-zombies',name:'植物大战僵尸 · 输出与波次',tables:['pvz_plants','pvz_zombies','pvz_waves']},
  {id:'disco-elysium',name:'极乐迪斯科 · 检定概率',tables:['de_skills','de_checks']},
  {id:'vampire-survivors',name:'吸血鬼幸存者 · 成长曲线',tables:['vs_weapon_levels','vs_experience','vs_passives']},
] as const;
export function analysisExamples(id:string,sources:AnalysisSources):AnalysisPlan[] {
  const group=analysisExampleGroups.find(g=>g.id===id); if(!group)throw new Error('未找到分析示例');
  const missing=group.tables.filter(t=>!sources.data.datasets[t]); if(missing.length)throw new Error('缺少来源配置表：'+missing.join('、'));
  let plans:AnalysisPlan[]=[];
  if(id==='hollow-knight') {
    const combat=plan('敌人承伤与击杀时间','持续命中、无护甲、无无敌阶段。第一次命中发生在 t=0；击杀时间不含接近敌人与首领阶段等待。',[
      cell('hp','敌人生命','hk_enemies','$row','hp','HP'),cell('damage','单次伤害','hk_params','nail_damage','value','HP',0.001),cell('period','攻击周期','hk_params','nail_period','value','秒',0.001),
    ],[metric('hits','击杀次数','ceil(hp / damage)','次'),metric('dps','理论每秒伤害','damage / period','HP/秒'),metric('time','理想击杀时间','max(0, hits - 1) * period','秒')],'hk_enemies');
    combat.variants=[{id:'stronger',name:'骨钉伤害 6',overrides:{damage:6}}];
    const soul=plan('聚焦治疗资源','从 0 灵魂开始，按普通敌/首领每次有效命中计算；不含残影、受击与治疗打断。',[
      cell('gain','命中获得灵魂','hk_params','soul_hit','value','灵魂',0.001),cell('cost','聚焦消耗','hk_params','focus_cost','value','灵魂'),cell('cap','正常上限','hk_params','soul_cap','value','灵魂'),cell('duration','聚焦时长','hk_params','focus_duration','value','秒'),
    ],[metric('hits','一次治疗所需命中','ceil(cost / gain)','次'),metric('heals','满灵魂可治疗次数','floor(cap / cost)','次'),metric('time','连续治疗耗时','heals * duration','秒')]);plans=[combat,soul];
  } else if(id==='stardew-valley') {
    const crop=plan('作物单轮收益','每格种 1 株，每晚已浇水，成熟即收获并出货；不含工具体力、天气、委托、土地闲置和现金到账延迟。种子与收获物通过作物表引用读取。',[
      cell('cost','种子成本','farm_items','$row.seed','buy','金币'),cell('price','收获物售价','farm_items','$row.harvest','sell','金币'),cell('yield','单次产量','farm_crops','$row','yield','个'),cell('days','成长夜数','farm_crops','$row','nights','夜',1),constant('plots','种植格数',16,'格',1),
    ],[metric('profit','单格利润','price * yield - cost','金币'),metric('daily','每格每夜平均利润','profit / days','金币/格/夜'),metric('total','整轮利润','profit * plots','金币'),metric('roi','单轮投入回报率','profit / cost * 100','%')],'farm_crops');
    crop.variants=[{id:'price',name:'售价统一试算为 24',overrides:{price:24}}];plans=[crop];
  } else if(id==='plants-vs-zombies') {
    const combat=plan('豌豆输出与僵尸承伤','单株豌豆射手持续命中一个目标；第一次命中为 t=0，不含弹道飞行、换目标与阻挡。',[
      cell('hp','僵尸生命','pvz_zombies','$row','hp','HP'),cell('damage','豌豆伤害','pvz_plants','peashooter','power','HP',0.001),cell('period','射击间隔','pvz_plants','peashooter','interval_s','秒',0.001),
    ],[metric('dps','每秒伤害','damage / period','HP/秒'),metric('hits','所需命中','ceil(hp / damage)','次'),metric('time','理想击杀时间','max(0,hits - 1) * period','秒')],'pvz_zombies');
    const income=plan('向日葵回本时间','种植后首次产出在一个周期后，所有阳光都及时拾取；不含天降阳光、冷却与被摧毁风险。',[
      cell('cost','种植成本','pvz_plants','sunflower','cost','阳光'),cell('gain','每次产量','pvz_plants','sunflower','power','阳光',0.001),cell('period','生产间隔','pvz_plants','sunflower','interval_s','秒',0.001),
    ],[metric('cycles','回本所需产出次数','ceil(cost / gain)','次'),metric('time','回本时间','cycles * period','秒'),metric('rate','长期产出速度','gain / period','阳光/秒')]);
    const waves=plan('波次事件生命负担','每行是一组生成事件，统计请求生成的总生命量；不是在场怪物数量或通关难度评分。',[
      cell('count','生成数量','pvz_waves','$row','count','只'),cell('hp','对应僵尸生命','pvz_zombies','$row.zombie_id','hp','HP'),
    ],[metric('total','事件总生命量','count * hp','HP')],'pvz_waves');plans=[combat,income,waves];
  } else if(id==='disco-elysium') {
    const story=sources.narrative.enabled?sources.narrative.stories.find(s=>s.checks.length):undefined;
    if(story) {
      plans=story.checks.map(c=>{const p=planFromStoryCheck(story,c.id);const skill=p.parameters.find(v=>v.binding.kind==='variable'&&v.binding.variableId===c.variableId)!;p.sweep={parameterId:skill.id,start:Math.max(0,skill.minimum??0),end:Math.min(10,skill.maximum??10),step:1};return p;});
    } else {
      const p=plan('技能与检定成功率','2d6 + 技能 + 修正 ≥ 难度。双 1 必败、双 6 必胜；只计算一次尝试，不计算剧情可达性或重试。',[
        constant('skill','有效技能等级',3,'级'),cell('difficulty','检定难度','de_checks','$row','difficulty',''),constant('modifier','额外修正',0,'',null),
      ],[metric('chance','单次成功率','diceChance(skill + modifier, difficulty, 2, 6, 1) * 100','%')],'de_checks'); p.sweep={parameterId:'skill',start:0,end:10,step:1};plans=[p];
    }
  } else {
    const p=plan('武器等级与输出预算','以每次发射数量 × 单次伤害 / 冷却计算理想输出预算；各投射物按一次有效命中计。持续区域、穿透、重复命中与实际覆盖率需另建公式。',[
      cell('damage','单次伤害','vs_weapon_levels','$row','damage','HP'),cell('amount','每次数量','vs_weapon_levels','$row','amount','个'),cell('period','攻击间隔','vs_weapon_levels','$row','cooldown','秒',0.001),cell('bonus','冷却每级增量','vs_passives','tome','perLevel','',null),constant('rank','空白之书等级',0,'级'),
    ],[metric('cooldown','修正后冷却','period * (1 + bonus * rank)','秒'),metric('dps','理想输出预算','damage * amount / cooldown','HP/秒')],'vs_weapon_levels');p.parameters.find(v=>v.id==='rank')!.maximum=5;p.variants=[{id:'tome5',name:'空白之书 5 级',overrides:{rank:5}}];
    const xp=plan('升级经验需求','每条记录表示从当前等级到下一级的经验需求；不包含击杀效率、拾取与暂停时间。',[
      cell('xp','下级经验','vs_experience','$row','nextXp','经验'),constant('rate','假设经验获取速度',5,'经验/秒',0.001),
    ],[metric('need','升级所需经验','xp','经验'),metric('time','假设升级耗时','xp / rate','秒')],'vs_experience');plans=[p,xp];
  }
  return plans;
}
