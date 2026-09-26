import {moduleGrants,authoringModules} from './project-authoring.mjs';
export const aiRoles=['制作管理','策划','程序开发','美术','动画','UI','测试','音效','音乐','开发工具','关卡设计'];
export const aiPermissionLabels={progress:'提交制作进度',review:'提交验收结论',propose:'提交排期与分配建议',spec_change:'提交需求与验收变更建议',project_write:'修改项目内容与排期'};
export function nextAiName(members,role){const base={'制作管理':'制作人','策划':'策划','程序开发':'程序','美术':'美术','测试':'测试','音效':'音效'}[role]||role;const names=new Set(members.map(m=>m.name));if(base==='制作人'&&!names.has(base))return base;for(let i=0;;i++){let n=i+1,s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}if(!names.has(base+s))return base+s;}}
export function newAiMember(members,role='程序开发'){return {id:crypto.randomUUID(),name:nextAiName(members,role),roles:[role],duties:'',active:true,scope:role==='制作管理'?'project':'assigned',permissions:role==='制作管理'?['review','propose','spec_change','project_write']:role==='测试'?['progress','review']:['progress'],createdAt:new Date().toISOString()};}
export function defaultAiTeam(){const duties={制作管理:'控制版本范围、统筹分工、审查交付；提出排期与分配建议。',策划:'维护玩法规则、数值、关卡与验收要求。',程序开发:'实现功能、接入工程并开发制作工具。',美术:'按制作文档完成角色、场景、动画与 UI 素材。',测试:'验证功能、记录问题并进行回归检查。',音效:'制作音效、音乐与音频接入说明。'};return {schema:1,members:Object.entries(duties).map(([role,duties])=>({...newAiMember([],role),duties})),credentials:[]};}
export const taskAssignment=t=>t.assignment||{primaryId:'',collaboratorIds:[],reviewerId:''};
export const memberTasks=(schedule,id)=>schedule.tasks.filter(t=>{const a=taskAssignment(t);return a.primaryId===id||a.reviewerId===id||a.collaboratorIds.includes(id);});
export function normalizePersonnelSchedule(schedule){if(!schedule.personnel)return schedule;return {...schedule,tasks:schedule.tasks.map(t=>{const member=schedule.personnel.members.find(m=>m.id===t.assignment?.primaryId);return member&&t.owner!==member.name?{...t,owner:member.name}:t;})};}
export function suggestAssignments(schedule){const members=schedule.personnel?.members.filter(m=>m.active)||[],roles={设计:'策划',程序:'程序开发',美术:'美术',关卡:'关卡设计',测试:'测试'};return schedule.tasks.filter(t=>!t.assignment?.primaryId).flatMap(t=>{const named=members.filter(m=>m.name===t.owner.trim()),matching=members.filter(m=>m.roles.includes(roles[t.kind]));const matches=t.owner.trim()?named:matching;return matches.length===1?[{taskId:t.id,memberId:matches[0].id,reason:t.owner.trim()?'负责人姓名完全匹配':'岗位与制作方向匹配'}]:[];});}
export function applyAssignments(schedule,assignments){const members=schedule.personnel?.members||[];return normalizePersonnelSchedule({...schedule,tasks:schedule.tasks.map(t=>{const choice=assignments.find(a=>a.taskId===t.id);if(!choice||t.assignment?.primaryId||!members.some(m=>m.id===choice.memberId&&m.active))return t;return {...t,assignment:{...taskAssignment(t),primaryId:choice.memberId,collaboratorIds:taskAssignment(t).collaboratorIds.filter(id=>id!==choice.memberId)}};})});}
export function personnelMarkdown(schedule,onlyMemberId){
 const people=schedule.personnel?.members||[],members=onlyMemberId?people.filter(m=>m.id===onlyMemberId):people;
 const lines=[...(onlyMemberId?[]:[positionsMarkdown(schedule),'']),'## AI 执行者与协作分配',''];
 if(!members.length)lines.push('尚未签发执行者凭证。到协作令牌中命名 AI 并选择工作。');
 for(const m of members){lines.push('### '+m.name,'- 成员 ID：'+m.id,'- 状态：'+(m.active?'启用':'停用'));const keys=(schedule.personnel?.credentials||[]).filter(k=>k.memberId===m.id);for(const key of keys)lines.push('',credentialMarkdown(schedule,key));const legacy=memberTasks(schedule,m.id);if(legacy.length)lines.push('历史成员任务：',...legacy.map(t=>'- '+t.title+' ['+t.id+'] · '+t.status));if(!keys.length&&!legacy.length)lines.push('暂无工作分配。');lines.push('');}
 return lines.join('\n');
}

// Positions describe work; members are execution identities created when issuing credentials.
export function defaultAiPositions(){return [
 ['producer','制作人',[],'控制版本范围、统筹分工、审查交付；提出排期与分配建议。'],
 ['planning','策划',['设计','关卡'],'维护玩法规则、数值、关卡与验收要求。'],
 ['program','程序',['程序'],'实现功能、接入工程并开发制作工具。'],
 ['art','美术',['美术'],'按制作文档完成角色、场景、动画与 UI 素材。'],
 ['qa','测试',['测试'],'验证功能、记录问题并进行回归检查。'],
 ['audio','音效',[],'制作音效、音乐与音频接入说明。'],
 ].map(([id,name,taskKinds,duties])=>({id,name,taskKinds,duties,active:true}));}
export function positionsOf(schedule){return schedule.personnel?.positions??defaultAiPositions();}
export function defaultWorkTeam(){return {schema:1,positions:defaultAiPositions(),members:[],credentials:[]};}
export function taskPositionIds(schedule,task){return task.positionIds??positionsOf(schedule).filter(p=>p.taskKinds.includes(task.kind)).map(p=>p.id);}
export function positionTasks(schedule,positionId){return schedule.tasks.filter(t=>taskPositionIds(schedule,t).includes(positionId));}
export function credentialTasks(schedule,key){if(key.persistent){const m=schedule.personnel?.members.find(m=>m.id===key.memberId);return schedule.tasks.filter(t=>m?.developer?.taskIds.includes(t.id));}return key.positionIds?schedule.tasks.filter(t=>key.taskIds.includes(t.id)):memberTasks(schedule,key.memberId).filter(t=>!key.taskIds.length||key.taskIds.includes(t.id));}
export function workAssignees(schedule,taskId,projectId){
 const team=schedule.personnel,task=schedule.tasks.find(t=>t.id===taskId);if(!team||!task)return [];
 const positionIds=taskPositionIds(schedule,task),positions=positionsOf(schedule),a=taskAssignment(task);
 return team.credentials.filter(k=>!k.revokedAt&&(!credentialExpiry(schedule,k)||Date.parse(credentialExpiry(schedule,k))>Date.now())&&(!projectId||k.projectId===projectId)&&team.members.some(m=>m.id===k.memberId&&m.active)&&
 (k.persistent?team.members.some(m=>m.id===k.memberId&&m.developer?.taskIds.includes(taskId)&&developerMayAccess(schedule,m,task)):k.positionIds?k.taskIds.includes(taskId)&&k.positionIds.some(id=>positionIds.includes(id)&&positions.some(p=>p.id===id&&p.active)):
 (!k.taskIds.length||k.taskIds.includes(taskId))&&[a.primaryId,a.reviewerId,...a.collaboratorIds].includes(k.memberId)));
}
export function positionsMarkdown(schedule){const lines=['## 岗位与工作内容',''];for(const p of positionsOf(schedule)){lines.push('### '+p.name,'- 岗位 ID：'+p.id,'- 职责：'+p.duties,'- 状态：'+(p.active?'启用':'停用'));const tasks=positionTasks(schedule,p.id);for(const t of tasks)lines.push('- '+t.title+' ['+t.id+'] · '+t.status);if(!tasks.length)lines.push('- 暂无工作任务，可在岗位详情中选择任务。');lines.push('');}return lines.join('\n');}
export function credentialMarkdown(schedule,key){const member=schedule.personnel?.members.find(m=>m.id===key.memberId);const profile=key.persistent?member?.developer:undefined;return ['# '+(member?.name||key.name)+' · 工作分配','', '- 执行者 ID：'+key.memberId,'- 令牌 ID：'+key.id,'- 绑定项目：'+key.projectId,'- 撤销记录：'+(key.revokedAt||'未撤销'),'- 岗位：'+(profile?.positionIds||key.positionIds||[]).map(id=>positionsOf(schedule).find(p=>p.id===id)?.name||id).join('、'),'- 工作说明：'+(key.persistent?member?.duties||'见下方任务':key.workDescription||member?.duties||'见下方任务'),'- 访问范围：'+(profile?{assigned:'已分配任务',positions:'所选岗位（包含后续任务）',project:'项目范围'}[profile.scope]:'旧版任务范围'),'- 反馈权限：'+(key.persistent?member?.permissions||[]:key.permissions).map(p=>aiPermissionLabels[p]).join('、'),'- 内容编写模块：'+(moduleGrants(member).map(id=>authoringModules[id]).join('、')||'未授权'),'- 有效期：'+(credentialExpiry(schedule,key)||'长期有效，直至停用或撤销'),'','## 已分配任务',...(credentialTasks(schedule,key).length?[]:['暂无具体任务。开发者身份持续保留；允许反馈的范围见上方访问范围。']),...credentialTasks(schedule,key).flatMap(t=>['### '+t.title,'- ID：'+t.id,'- 当前状态：'+t.status,'- 内容：'+t.description,'- 前置任务：'+(t.dependencyIds.join('、')||'无'),'- 验收要求：'+(t.acceptance||'待补充')]),'','只提交获准任务的反馈。私有凭证由管理者单独交付；提交方式见 ../README.md。'].join('\n');}

export function credentialExpiry(schedule,key){return key.persistent?schedule.personnel?.members.find(m=>m.id===key.memberId)?.developer?.expiresAt||'':key.expiresAt;}
export function developerMayAccess(schedule,member,task){const d=member.developer;if(!d)return false;const active=positionsOf(schedule).filter(p=>p.active&&d.positionIds.includes(p.id));if(!active.length)return false;if(d.scope==='project')return true;const matches=active.some(p=>taskPositionIds(schedule,task).includes(p.id));return matches&&(d.scope==='positions'||d.taskIds.includes(task.id));}
export function credentialState(schedule,key,projectId){if(key.projectId!==projectId)return '属于原项目';if(key.revokedAt)return '已撤销';const expiry=credentialExpiry(schedule,key);if(expiry&&Date.parse(expiry)<=Date.now())return '已过期';if(!schedule.personnel?.members.find(m=>m.id===key.memberId)?.active)return '已停用';return '有效';}


export const positionPresets=[
 {id:'basic',name:'基础协作',count:6,description:'制作人、策划、程序、美术、测试、音效。适合快速原型与小团队。'},
 {id:'production',name:'完整制作',count:8,description:'拆分主美、技术美术与美术开发，明确风格、技术方案和素材制作职责。'},
];
export function presetPositions(id){
 if(id==='basic')return defaultAiPositions();
 if(id!=='production')throw new Error('未知岗位预设');
 const base=defaultAiPositions(),find=id=>base.find(p=>p.id===id);
 return [find('producer'),find('planning'),
  {id:'art-director',name:'主美',taskKinds:[],active:true,duties:'制定视觉风格、参考图与美术品质标准；审核游戏内最终视觉效果，提出修改意见。'},
  {id:'technical-art',name:'技术美术',taskKinds:[],active:true,duties:'确定骨骼、逐帧、Shader 等素材实现方案；制定拆图、导入与性能规格，验证制作流程并验收技术结果。'},
  {...find('art'),name:'美术开发',duties:'按照主美确定的风格和技术美术制定的方案，制作角色、场景、动画、特效与 UI 素材，完成交付与修改。'},
  find('program'),find('qa'),find('audio')];
}
export function positionPresetState(schedule){
 const positions=positionsOf(schedule),id=schedule.personnel?.positionPreset||(['art-director','technical-art'].some(id=>positions.some(p=>p.id===id&&p.active))?'production':'basic');
 const expected=presetPositions(id),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 return {id,customized:expected.some(p=>{const found=positions.find(x=>x.id===p.id);return !found||['name','duties','active','taskKinds'].some(k=>!same(found[k],p[k]));})||positions.some(p=>p.active&&!expected.some(x=>x.id===p.id))};
}
export function previewPositionPreset(schedule,id){
 const current=positionsOf(schedule),defaults=[...presetPositions('basic'),...presetPositions('production')],target=presetPositions(id);
 const positions=target.map(p=>{const old=current.find(x=>x.id===p.id);if(!old)return p;const known=defaults.filter(x=>x.id===p.id),next={...old};
  for(const key of ['name','duties','taskKinds'])if(known.some(x=>JSON.stringify(old[key])===JSON.stringify(x[key])))next[key]=p[key];
  if(['art-director','technical-art'].includes(p.id))next.active=true;
  return next;
 });
 // Keep identities and authored details so old developer scopes and histories never point at deleted roles.
 const retired=id==='basic'?['art-director','technical-art']:[];
 positions.push(...current.filter(p=>!positions.some(x=>x.id===p.id)).map(p=>retired.includes(p.id)?{...p,active:false,taskKinds:[]}:p));
 const names=new Set();for(const p of positions){const name=p.name.trim().toLowerCase();if(names.has(name))throw new Error('岗位名称冲突：'+p.name+'。请先重命名现有自定义岗位，再切换预设。');names.add(name);}
 if(positions.length>100)throw new Error('切换后岗位超过 100 个，请先整理现有岗位');
 const changes=positions.flatMap(after=>{const before=current.find(p=>p.id===after.id);return JSON.stringify(before)===JSON.stringify(after)?[]:[{id:after.id,before,after}];});
 const taskChanges=[];
 const tasks=schedule.tasks.map(t=>{const before=taskPositionIds(schedule,t),after=[...new Set(before.map(p=>retired.includes(p)?'art':p))];
  if(JSON.stringify(before)!==JSON.stringify(after))taskChanges.push({taskId:t.id,title:t.title,from:before.map(id=>current.find(p=>p.id===id)?.name||id),to:after.map(id=>positions.find(p=>p.id===id)?.name||id)});
  // Freeze implicit membership before changing defaults; a preset never silently adds review work.
  const implicit=positions.filter(p=>p.taskKinds.includes(t.kind)).map(p=>p.id);
  return JSON.stringify(before)===JSON.stringify(after)&&(t.positionIds!==undefined||JSON.stringify(implicit)===JSON.stringify(after))?t:{...t,positionIds:after};
 });
 const affectedDevelopers=(schedule.personnel?.members||[]).filter(m=>m.developer?.positionIds.some(p=>retired.includes(p))).map(m=>m.name);
 const affectedCredentials=(schedule.personnel?.credentials||[]).filter(k=>!k.revokedAt&&k.positionIds?.some(p=>retired.includes(p))).length;
 return {changes,taskChanges,affectedDevelopers,affectedCredentials,next:{...schedule,personnel:{...(schedule.personnel||defaultWorkTeam()),positionPreset:id,positions},tasks}};
}

export function legacyRolePositionIds(schedule,roles){
 const aliases={'制作管理':'producer','制作人':'producer','策划':'planning','关卡设计':'planning','程序开发':'program','程序':'program','开发工具':'program','美术':'art','美术开发':'art','动画':'art','UI':'art','测试':'qa','音乐':'audio','音效':'audio','主美':'art-director','技术美术':'technical-art'};
 const positions=positionsOf(schedule);
 return [...new Set(roles.flatMap(role=>{const standard=positions.find(p=>p.id===aliases[role]);return standard?[standard.id]:positions.filter(p=>p.name===role).map(p=>p.id);}))];
}
