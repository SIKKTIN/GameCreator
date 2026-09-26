const {generateKeyPairSync,createPublicKey,verify,randomUUID}=require('node:crypto');
const {developerAllowed}=require('./ai-developers.cjs');
const {validateProjectScheduleArchive}=require('./project-package.cjs');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
function feedbackSigningText(feedback){const copy=structuredClone(feedback);if(copy.identity)delete copy.identity.signature;return canonical(copy);}
function issueAiCredential(storage,input){
 if(input?.positionIds!==undefined)return issueWorkCredential(storage,input);
 const {projectId,memberId,name,expiresAt,permissions,taskIds=[],schedule:expected}=input||{};
 const catalog=JSON.parse(storage.getItem('gamecreator.projects.v1')||'null');
 if(typeof projectId!=='string'||catalog?.activeId!==projectId||!catalog.projects.some(p=>p.id===projectId))throw new Error('请在当前项目生成协作令牌');
 require('./project-changes.cjs').assertNoPendingContent(storage,projectId);
 const key='gamecreator.workspace.v1:'+projectId+':project-schedule',raw=storage.getItem(key),schedule=validateProjectScheduleArchive(JSON.parse(raw||'null'));
 if(canonical(schedule)!==canonical(expected))throw new Error('排期或人员已变化，请重新读取后生成令牌');
 const member=schedule.personnel?.members.find(m=>m.id===memberId);if(!member?.active)throw new Error('AI 成员不存在或已停用');
 if(typeof name!=='string'||!name.trim()||name.length>100||!Array.isArray(permissions)||!permissions.length||new Set(permissions).size!==permissions.length||permissions.some(p=>!member.permissions.includes(p))||!Array.isArray(taskIds)||new Set(taskIds).size!==taskIds.length||taskIds.some(id=>!schedule.tasks.some(t=>t.id===id))||typeof expiresAt!=='string'||!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=Date.now()||Date.parse(expiresAt)>Date.now()+366*86400000)throw new Error('令牌名称、权限、任务范围或有效期无效（最多一年）');
 const pair=generateKeyPairSync('ed25519'),credential={id:randomUUID(),projectId,memberId,name:name.trim(),publicKey:pair.publicKey.export({type:'spki',format:'der'}).toString('base64'),permissions,taskIds,createdAt:new Date().toISOString(),expiresAt,revokedAt:''};
 const next={...schedule,personnel:{...schedule.personnel,credentials:[...schedule.personnel.credentials,credential]}};validateProjectScheduleArchive(next);
 if(storage.getItem(key)!==raw)throw new Error('人员发生变化，未签发令牌');storage.setItem(key,JSON.stringify(next));
 // Only the public verifier is persisted. The private credential is returned once for handoff.
 return {credential,secret:{schema:1,projectId,memberId,memberName:member.name,credentialId:credential.id,privateKey:pair.privateKey.export({type:'pkcs8',format:'der'}).toString('base64'),expiresAt}};
}
async function issueWorkCredential(storage,input){
 const {positionsOf,taskPositionIds}=await import('../shared/ai-personnel.mjs');
 const {projectId,memberId,executorName,name,expiresAt,permissions,taskIds,positionIds,workDescription='',schedule:expected}=input;
 const catalog=JSON.parse(storage.getItem('gamecreator.projects.v1')||'null');
 if(typeof projectId!=='string'||catalog?.activeId!==projectId||!catalog.projects.some(p=>p.id===projectId))throw new Error('请在当前项目生成协作令牌');
 require('./project-changes.cjs').assertNoPendingContent(storage,projectId);
 const key='gamecreator.workspace.v1:'+projectId+':project-schedule',raw=storage.getItem(key),schedule=validateProjectScheduleArchive(JSON.parse(raw||'null'));
 if(canonical(schedule)!==canonical(expected))throw new Error('岗位或排期已变化，请重新读取后生成令牌');
 const positions=positionsOf(schedule),unique=(v,max)=>Array.isArray(v)&&v.length>0&&v.length<=max&&new Set(v).size===v.length;
 if(!unique(positionIds,100)||positionIds.some(id=>!positions.some(p=>p.id===id&&p.active))||!unique(taskIds,2000)||taskIds.some(id=>!schedule.tasks.some(t=>t.id===id&&taskPositionIds(schedule,t).some(p=>positionIds.includes(p)))))throw new Error('请选择启用的岗位及其具体工作任务');
 if(!unique(permissions,5)||permissions.some(p=>!['progress','review','propose','spec_change','project_write'].includes(p))||typeof workDescription!=='string'||workDescription.length>10000||typeof name!=='string'||!name.trim()||name.length>100||typeof expiresAt!=='string'||!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=Date.now()||Date.parse(expiresAt)>Date.now()+366*86400000)throw new Error('令牌名称、权限、工作说明或有效期无效（最多一年）');
 const team=schedule.personnel||{schema:1,members:[],credentials:[]};let member=team.members.find(m=>m.id===memberId);
 if(memberId){if(!member?.active||permissions.some(p=>!member.permissions.includes(p)))throw new Error('执行者已停用或没有所选反馈权限');}
 else {if(typeof executorName!=='string'||!executorName.trim()||executorName.length>100||team.members.some(m=>m.name.trim().toLowerCase()===executorName.trim().toLowerCase()))throw new Error('请填写唯一的 AI 执行者名称，已有名称可选择复用');member={id:randomUUID(),name:executorName.trim(),roles:positions.filter(p=>positionIds.includes(p.id)).map(p=>p.name),duties:workDescription,active:true,scope:'assigned',permissions,createdAt:new Date().toISOString()};}
 const pair=generateKeyPairSync('ed25519'),credential={id:randomUUID(),projectId,memberId:member.id,name:name.trim(),publicKey:pair.publicKey.export({type:'spki',format:'der'}).toString('base64'),permissions,taskIds,positionIds,workDescription,createdAt:new Date().toISOString(),expiresAt,revokedAt:''};
 const next={...schedule,personnel:{...team,positions,members:memberId?team.members:[...team.members,member],credentials:[...team.credentials,credential]}};validateProjectScheduleArchive(next);
 if(storage.getItem(key)!==raw)throw new Error('岗位或排期发生变化，未签发令牌');storage.setItem(key,JSON.stringify(next));
 return {credential,secret:{schema:1,projectId,memberId:member.id,memberName:member.name,credentialId:credential.id,privateKey:pair.privateKey.export({type:'pkcs8',format:'der'}).toString('base64'),expiresAt}};
}
function verifyAiFeedback(feedback,schedule,now=Date.now()){
 const team=schedule.personnel;if(!feedback.identity){if(feedback.intent&&feedback.intent!=='progress')throw new Error('验收或分工建议需要 AI 签名凭证');return team?.members.length?{verified:false,legacy:true}:undefined;}
 const {memberId,credentialId,signature}=feedback.identity,member=team?.members.find(m=>m.id===memberId),key=team?.credentials.find(c=>c.id===credentialId);const expiry=key?.persistent?member?.developer?.expiresAt:key?.expiresAt;
 if(!member?.active||!key||key.memberId!==memberId||key.projectId!==feedback.projectId||key.revokedAt||expiry&&Date.parse(expiry)<=now||Date.parse(key.createdAt)>now)throw new Error('AI 令牌无效、已过期、已撤销或成员已停用');
 let valid=false;try{const publicKey=createPublicKey({key:Buffer.from(key.publicKey,'base64'),type:'spki',format:'der'});valid=publicKey.asymmetricKeyType==='ed25519'&&typeof signature==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(signature)&&verify(null,Buffer.from(feedbackSigningText(feedback)),publicKey,Buffer.from(signature,'base64'));}catch{}
 if(!valid)throw new Error('AI 反馈签名无效，内容或身份可能已改变');
 const intent=feedback.intent||'progress',permission=intent==='project_change'?'project_write':intent;const art=key.persistent?member.developer?.artPermissions||[]:[];const artContent=intent==='project_change'&&feedback.target?.id==='art-assets'&&art.some(k=>['style','details','technical'].includes(k));const artProposal=intent==='propose'&&art.includes('propose');if(!artContent&&!artProposal&&intent!=='dispatch'&&(!member.permissions.includes(permission)||!key.persistent&&!key.permissions.includes(permission)))throw new Error('此 AI 令牌没有提交该类反馈的权限');
 if(intent==='dispatch'){if(!key.persistent||feedback.target.kind!=='task'||Object.keys(feedback.changes).join(',')!=='assigneeId')throw new Error('派发需要长期开发者签名与单一接收人');require('./project-content-model.cjs').assertDispatch(schedule,memberId,feedback.changes.assigneeId,feedback.target.id);return {verified:true,memberId,credentialId,memberName:member.name,intent};}
 if(artContent){if(!team.positions?.some(p=>p.active&&member.developer.positionIds.includes(p.id)))throw new Error('开发者岗位已停用');return {verified:true,memberId,credentialId,memberName:member.name,intent};}
 if(intent==='project_change'){if(member.developer?.projectModules&&!member.developer.projectModules.includes(feedback.target?.id))throw new Error('此 AI 没有该模块的项目修改权限');if(feedback.target.kind!=='module')throw new Error('正式项目修改必须指定项目模块');if(!key.persistent||member.developer?.scope!=='project'||!team.positions?.some(p=>p.active&&member.developer.positionIds.includes(p.id)))throw new Error('正式项目修改需要项目范围及 project_write 权限');return {verified:true,memberId,credentialId,memberName:member.name,intent};} const assigned=t=>{const a=t.assignment||{};return intent==='review'?a.reviewerId===memberId:a.primaryId===memberId||(a.collaboratorIds||[]).includes(memberId)||(['propose','spec_change'].includes(intent)&&a.reviewerId===memberId);};
 const tasks=feedback.target.kind==='task'?schedule.tasks.filter(t=>t.id===feedback.target.id):schedule.tasks.filter(t=>t.references.some(r=>r.kind==='tool'&&r.targetId===feedback.target.id));
 const artReview=t=>intent==='review'&&key.persistent&&t.assignment?.reviewerId===memberId&&t.dispatchHistory?.some(r=>r.fromId===memberId)&&team.positions?.some(p=>p.active&&['art-director','technical-art'].includes(p.id)&&member.developer?.positionIds.includes(p.id));
 const allowed=t=>artReview(t)|| (key.persistent?developerAllowed(schedule,member,t):key.positionIds?key.taskIds.includes(t.id)&&team.positions?.some(p=>p.active&&key.positionIds.includes(p.id)&&(t.positionIds?t.positionIds.includes(p.id):p.taskKinds.includes(t.kind))):(member.scope==='project'||assigned(t))&&(!key.taskIds.length||key.taskIds.includes(t.id)));
 if(!(artProposal&&tasks.some(t=>(t.kind==='美术'||t.references.some(r=>['asset','requirement'].includes(r.kind)))&&team.positions?.some(p=>p.active&&member.developer.positionIds.includes(p.id))))&&!tasks.some(allowed))throw new Error('反馈目标不在此 AI 当前获准的任务范围内');
 const fields=Object.keys(feedback.changes);
 if(intent==='spec_change'&&(feedback.target.kind!=='task'||fields.some(k=>!['description','acceptance'].includes(k))))throw new Error('需求变更建议仅支持任务说明和验收标准'); if(intent==='propose'&&(feedback.target.kind!=='task'||fields.length!==1||fields[0]!=='result'))throw new Error('分配与排期建议只能提交任务的 result 说明');
 if(intent==='review'&&fields.some(k=>!['status','result','delivery','usage'].includes(k)))throw new Error('验收反馈不能修改实际工作日期');
 if(intent==='progress'&&['已完成','可使用','停用'].includes(feedback.changes.status))throw new Error('执行反馈请提交待验收；完成结论需要验收权限');
 return {verified:true,memberId,credentialId,memberName:member.name,intent};
}
module.exports={issueAiCredential,verifyAiFeedback,feedbackSigningText};
