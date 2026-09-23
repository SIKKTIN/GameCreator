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
export function credentialMarkdown(schedule,key){const member=schedule.personnel?.members.find(m=>m.id===key.memberId);const profile=key.persistent?member?.developer:undefined;return ['# '+(member?.name||key.name)+' · 工作分配','', '- 执行者 ID：'+key.memberId,'- 令牌 ID：'+key.id,'- 绑定项目：'+key.projectId,'- 撤销记录：'+(key.revokedAt||'未撤销'),'- 岗位：'+(profile?.positionIds||key.positionIds||[]).map(id=>positionsOf(schedule).find(p=>p.id===id)?.name||id).join('、'),'- 工作说明：'+(key.persistent?member?.duties||'见下方任务':key.workDescription||member?.duties||'见下方任务'),'- 访问范围：'+(profile?{assigned:'已分配任务',positions:'所选岗位（包含后续任务）',project:'项目范围'}[profile.scope]:'旧版任务范围'),'- 反馈权限：'+(key.persistent?member?.permissions||[]:key.permissions).map(p=>aiPermissionLabels[p]).join('、'),'- 有效期：'+(credentialExpiry(schedule,key)||'长期有效，直至停用或撤销'),'','## 已分配任务',...(credentialTasks(schedule,key).length?[]:['暂无具体任务。开发者身份持续保留；允许反馈的范围见上方访问范围。']),...credentialTasks(schedule,key).flatMap(t=>['### '+t.title,'- ID：'+t.id,'- 当前状态：'+t.status,'- 内容：'+t.description,'- 前置任务：'+(t.dependencyIds.join('、')||'无'),'- 验收要求：'+(t.acceptance||'待补充')]),'','只提交获准任务的反馈。私有凭证由管理者单独交付；提交方式见 ../README.md。'].join('\n');}

export function credentialExpiry(schedule,key){return key.persistent?schedule.personnel?.members.find(m=>m.id===key.memberId)?.developer?.expiresAt||'':key.expiresAt;}
export function developerMayAccess(schedule,member,task){const d=member.developer;if(!d)return false;const active=positionsOf(schedule).filter(p=>p.active&&d.positionIds.includes(p.id));if(!active.length)return false;if(d.scope==='project')return true;const matches=active.some(p=>taskPositionIds(schedule,task).includes(p.id));return matches&&(d.scope==='positions'||d.taskIds.includes(task.id));}
export function credentialState(schedule,key,projectId){if(key.projectId!==projectId)return '属于原项目';if(key.revokedAt)return '已撤销';const expiry=credentialExpiry(schedule,key);if(expiry&&Date.parse(expiry)<=Date.now())return '已过期';if(!schedule.personnel?.members.find(m=>m.id===key.memberId)?.active)return '已停用';return '有效';}
