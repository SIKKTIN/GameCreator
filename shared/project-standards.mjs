export const standardModules = {
  general:'通用规则', core:'玩法核心', gameplay:'玩法设计', functional:'功能系统',
  prototype:'原型设计', maps:'地图设计', tasks:'任务与流程', narrative:'故事编排',
  stories:'故事文档', data:'数据配置', art:'素材资产', tools:'开发工具',
  schedule:'项目排期', personnel:'人员分配', framework:'程序框架', analysis:'数值分析',
};
const rule=(id,scope,title,body,example)=>({id,scope,title,body,example});
export const projectStandardRules = [
  rule('reuse-first','general','先复用，再扩展','更新前先查阅现有分类、模块、条目及引用。能够复用的直接引用，职责相同的原位修改；只有出现独立的新职责或内容，才新增条目并说明归属。','新增一种敌人：先检查已有敌人行为、受击和移动能力，仅增加缺少的行为。'),
  rule('stable-structure','general','业务结构保持稳定','按职责、体验主题和内容关系组织项目。版本、迭代和发布日期用于记录变更，不默认成为新的业务分类、系统或父级流程。','从三关扩展到五关：扩展关卡内容，不额外复制整套战斗与结算系统。'),
  rule('current-truth','general','明确当前有效规则','同一职责保持明确的当前定义。修改时检查旧规则是否仍有效；过时内容通过归档或变更记录保留，不让互相矛盾的规则同时作为当前要求。','修改资源获取规则时更新原规则，并说明历史差异，而非追加第二份相反的规则。'),
  rule('stable-identity','general','保留身份、引用和开发成果','保留稳定 ID、历史记录和已完成成果。改名或移动分类时维护原引用；替换或拆分条目时先列出引用迁移。没有明确指示，不删除、重置或覆盖无关内容。','移动功能所属系统时保留功能 ID，核对玩法、素材与排期引用。'),
  rule('change-plan','general','先说明兼容方案，再修改','每次更新先列出复用、修改、新增、归档四类内容，说明原因和影响。无对应内容时明确写“无”。改变现有行为时补充兼容方式、迁移步骤及回归验证。','新增条件影响存档时，说明旧存档的默认值和升级方法。'),
  rule('evidence','general','需求、实现和验收分别记录','写入设计文档不代表功能已经实现，完成开发也不代表已经验收。变更说明与验收标准不得自动提升进度；提供验证依据后按权限确认。','修改验收标准后重新评估受影响工作，保留原有交付记录。'),
  rule('engine-neutral','general','通用规则与引擎实现分开','业务规则描述输入、状态、输出与边界；引擎 API、路径、资源格式写在实现说明或适配约定中。按项目需要启用模块，不假定所有游戏都有客户端和服务端。','单机游戏可直接在本地工程实现，不为复用框架额外引入服务器。'),
  rule('bounded-change','general','按范围交付，可检查可恢复','采用字段级或明确条目级变更。预览差异、处理冲突、保留记录；发现原有内容不支持新需求时说明缺口，不用整包覆盖掩盖问题。规范补充冲突时交由管理者决定。','收到过期快照反馈时重新比较当前内容，不直接覆盖最新编辑。'),
  rule('core-loop','core','层级表达玩家循环','总览描述玩家从哪里进入、做什么、如何反馈与循环；子模块表达真实的玩法子循环，版本先后不构成父子关系。','选关 → 战斗 → 结算 → 返回选关；新关卡复用这条循环。'),
  rule('gameplay-topics','gameplay','按体验主题组织玩法','分类按玩家活动、规则主题或内容领域组织。新增内容放入对应分类，通过引用连接已有规则，避免每次迭代建立一份混合分类。','探索、战斗、资源、经营可以分别组织；新增减速规则归入战斗。'),
  rule('functional-responsibility','functional','系统按职责划分','系统说明职责与边界，功能说明触发、处理和输出。优先扩展已有功能，跨系统通过依赖与事件关联，避免按版本建立包含无关功能的大系统。','敌人加速属于行为或移动职责，新增关卡属于关卡进度职责。'),
  rule('prototype-scope','prototype','原型验证明确的问题','原型注明要验证的体验、交互和验收范围。复用已有场景或控件，实验内容与当前采用方案明确区分。','新增交互先在相关原型验证，再更新正式玩法说明。'),
  rule('map-space','maps','地图关系服从空间和通路','按项目视角表达空间布局。连接对应实际出入口、通路、方向和能力条件；移动区域后复核连接，不只改变总览中的展示位置。','横版上下通路需要可通行的开口和攀爬、跳跃或其他能力依据。'),
  rule('task-flow','tasks','玩家任务复用已有目标与事件','按目标、阶段、条件和结果组织任务。引用玩法和故事事件，变更分支时检查进入条件、可达性和终止结果。','新增结局优先扩展现有任务分支，不复制整条任务链。'),
  rule('narrative-chain','narrative','叙事实体与故事状态分工明确','复用角色、地点和状态定义；场景与片段构成故事链。选择后果、检定与状态变化明确关联，避免在每个故事里重复定义同一实体。','人物改名保留身份，相关对白引用继续有效。'),
  rule('story-reference','stories','背景设定与执行规则互相引用','故事文档按主题组织，保持角色与世界设定一致；具体执行规则以关联的玩法、功能或故事编排条目为依据。','背景描述引用对应规则，避免复制一份随后失去同步的参数表。'),
  rule('data-contract','data','先核对数据契约','保留表名、字段、记录 ID 与引用；明确类型、单位、默认值和取值约束。新增或变更字段需评估旧数据和引擎读取兼容性，稳定版本与开发数据分别管理。','增加冷却字段时说明单位、旧记录默认值以及读取方变更。'),
  rule('art-docs','art','素材以制作文档和工程交付为准','复用分类及素材条目，说明用途、规格、命名、工程位置和关联任务。新素材在引擎工程制作，通过反馈与任务验收同步进度。','同一素材的修订完善原条目，不把每次交付都建成独立需求。'),
  rule('tool-reuse','tools','工具服务明确的制作流程','先查找现有工具，复用或扩展后说明入口、支持格式、操作方式和验证方法。工具需求、开发任务与交付记录互相关联。','动画预览新增格式支持时扩展现有预览工具。'),
  rule('schedule-delivery','schedule','按交付拆分工作','每项任务对应可检查的成果，引用真实内容，明确前置依赖和验收标准。新迭代可以新增任务或里程碑，保留既有任务的完成状态与验收记录。','版本属于排期与交付组织，不因此复制玩法分类。'),
  rule('personnel-authority','personnel','职责、身份与权限分别维护','岗位描述职责，开发者可负责多个岗位。任务分配与权限以明确授权为准；名字、负责人文字或内容变更不能自动增加权限。','制作人可零任务统筹；程序助手完成一项任务后继续使用同一身份。'),
  rule('framework-boundary','framework','复用框架边界','先核对已有包、核心机制与依赖。业务变化优先修改所属包，跨引擎差异交给适配层；不为单一功能改写所有项目的基础结构。','引擎资源加载接口放在适配层，业务包依赖稳定接口。'),
  rule('analysis-baseline','analysis','分析采用明确的数据基准','注明数据来源、假设、单位、目标和验证方式；数值变化复核受影响玩法与关卡，旧分析作为历史依据保留。','调整伤害时同时检查攻击频率、资源成本和目标生命值。'),
];
export const updateSteps = [
  ['查阅现状','读取项目规范、现有模块、有效规则和引用，确认当前版本基准。'],
  ['列出兼容方案','明确复用、修改、新增、归档，并说明新增内容为什么不能直接复用。'],
  ['核对影响','检查任务、配置、存档、素材、工具、引用及验收标准的影响。'],
  ['按归属修改','保留身份和成果，小范围修改；必要的迁移单独说明并保留恢复依据。'],
  ['检查与验收','核对差异与引用，回归已有功能；语义重复与组织合理性由管理者复核。'],
  ['同步上下文','确认后同步文档和工程上下文，让开发者以最新基准继续工作。'],
];
export const emptyProjectStandards=()=>({schema:1,notes:'',moduleNotes:{}});
export function validateProjectStandards(v){
  if(!v||v.schema!==1||Object.keys(v).some(k=>!['schema','notes','moduleNotes'].includes(k))||typeof v.notes!=='string'||v.notes.length>30000||!v.moduleNotes||typeof v.moduleNotes!=='object'||Array.isArray(v.moduleNotes)||Object.entries(v.moduleNotes).some(([k,s])=>k==='general'||!Object.hasOwn(standardModules,k)||typeof s!=='string'||s.length>10000))throw new Error('项目规范存档格式无效，已停止写入');
  return v;
}
export function projectStandardsMarkdown(store=emptyProjectStandards()){
  validateProjectStandards(store);
  return '## 项目规范\n\n更新项目内容前必读。先兼容已有结构，再扩展独立的新内容。适用于不同游戏类型和引擎。\n\n'+
    projectStandardRules.map(r=>'### '+standardModules[r.scope]+' · '+r.title+'\n\n'+r.body+'\n\n示例：'+r.example+(r.scope!=='general'&&store.moduleNotes[r.scope]?'\n\n本项目补充：\n'+store.moduleNotes[r.scope]:'')).join('\n\n')+
    '\n\n### 本项目通用补充\n\n'+(store.notes||'暂无补充，采用以上通用规则。')+
    '\n\n### 更新步骤\n\n'+updateSteps.map(([title,body],i)=>`${i+1}. **${title}**：${body}`).join('\n')+
    '\n\n### 反馈中的兼容方案\n\n需求建议与项目修改填写 compatibility：reuse（复用）、modify（修改）、add（新增）、archive（归档），每项说明对象、归属与处理方式，没有则写“无”。新增或删除条目仍按对应模块支持的操作执行，不通过替换整个对象绕过。规范补充由管理者在 GameCreator 维护，也可授权 project-standards 模块后通过项目编写批次更新；通用内置规则随客户端维护。\n';
}
export function validateCompatibility(value,required=false){
  if(value===undefined&&!required)return;
  const fields=['reuse','modify','add','archive'];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==fields.length||fields.some(k=>typeof value[k]!=='string'||!value[k].trim()||value[k].length>3000))throw new Error('请按项目规范填写兼容方案：复用、修改、新增、归档；无对应内容时写“无”');
}
