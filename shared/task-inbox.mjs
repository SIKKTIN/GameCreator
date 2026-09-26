import {positionsOf,taskPositionIds,memberTasks,credentialTasks} from './ai-personnel.mjs';
import {artGrants,artPermissionsMarkdown} from './art-permissions.mjs';
const artTask=t=>t.kind==='美术'||t.references.some(r=>['asset','requirement'].includes(r.kind));
export function assertDispatch(schedule,fromId,toId,taskId){
 const members=schedule.personnel?.members||[],from=members.find(m=>m.id===fromId),to=members.find(m=>m.id===toId),task=schedule.tasks.find(t=>t.id===taskId);
 const positions=positionsOf(schedule),activeIds=m=>(m?.developer?.positionIds||[]).filter(id=>positions.some(p=>p.id===id&&p.active));
 if(!from?.active||!to?.active||!task||['已完成','待验收'].includes(task.status)||!artTask(task))throw new Error('只能派发未完成的素材制作任务给启用成员');
 if(from?.developer?.expiresAt&&Date.parse(from.developer.expiresAt)<=Date.now())throw new Error('派发人的权限已过期');
 if(!artGrants(from).includes('dispatch'))throw new Error('派发人没有派发美术任务权限');
 const allowed=activeIds(from).includes('art-director')?['technical-art','art']:activeIds(from).includes('technical-art')?['art']:[];
 if(!activeIds(to).some(id=>allowed.includes(id)))throw new Error('主美只能派发给技术美术或美术开发；技术美术只能派发给美术开发');
 if(!taskPositionIds(schedule,task).some(id=>activeIds(to).includes(id)))throw new Error('任务岗位与接收人不匹配，请先由负责人调整任务岗位');
 if(to.developer.expiresAt&&Date.parse(to.developer.expiresAt)<=Date.now())throw new Error('接收人的权限已过期');
 return {from,to,task};
}
export function dispatchTask(schedule,fromId,toId,taskId,id,at=new Date().toISOString()){
 const {to}=assertDispatch(schedule,fromId,toId,taskId),next=structuredClone(schedule),t=next.tasks.find(t=>t.id===taskId);
 t.assignment={primaryId:toId,collaboratorIds:(t.assignment?.collaboratorIds||[]).filter(id=>id!==toId),reviewerId:fromId};t.owner=to.name;
 t.dispatchHistory=[...(t.dispatchHistory||[]),{id,fromId,toId,at}];
 // Grant only this task, within the recipient's existing active position scope.
 const member=next.personnel.members.find(m=>m.id===toId);member.developer.taskIds=[...new Set([...member.developer.taskIds,taskId])];
 return next;
}
export function taskInbox(schedule,memberId=''){
 const team=schedule.personnel||{members:[],credentials:[]},direct=new Set(memberTasks(schedule,memberId).map(t=>t.id));
 for(const k of team.credentials.filter(k=>k.memberId===memberId))for(const t of credentialTasks(schedule,k))direct.add(t.id);
 const member=team.members.find(m=>m.id===memberId);for(const id of member?.developer?.taskIds||[])direct.add(id);
 const tasks=schedule.tasks.filter(t=>!memberId||direct.has(t.id));
 const reviews=schedule.tasks.filter(t=>t.status==='待验收'&&(!memberId||t.assignment?.reviewerId===memberId));
 const dispatched=schedule.tasks.filter(t=>t.dispatchHistory?.some(r=>!memberId||r.fromId===memberId));
 const proposals=schedule.tasks.flatMap(t=>(t.proposals||[]).filter(p=>!memberId||p.memberId===memberId||t.assignment?.reviewerId===memberId||t.assignment?.primaryId===memberId||!t.assignment?.reviewerId&&!t.assignment?.primaryId&&member?.developer?.positionIds.includes('producer')).map(p=>({...p,taskId:t.id,title:t.title})));
 return {tasks,reviews,dispatched,proposals};
}
export function inboxMarkdown(schedule,memberId=''){
 const box=taskInbox(schedule,memberId),member=schedule.personnel?.members.find(m=>m.id===memberId);
 return ['# '+(member?.name||'项目')+' · 任务清单','',...(member?[artPermissionsMarkdown(member),'']:[]),'## 收到的任务',...box.tasks.map(t=>'- '+t.title+' ['+t.id+'] · '+t.status+' · '+(t.end||'未排期')),'','## 待验收',...box.reviews.map(t=>'- '+t.title+' ['+t.id+']'),'','## 建议',...box.proposals.map(p=>'- '+p.title+' ['+p.id+'] · '+(p.resolution||'待处理')+'\n  '+p.text),'','## 我派发的任务',...box.dispatched.map(t=>'- '+t.title+' ['+t.id+'] · '+t.status),'','任务状态与项目排期共用同一份记录。结构建议须由负责人审核，不自动增删资产。','派发反馈：intent=dispatch，target.kind=task，changes 仅填写 assigneeId（成员 ID）。签名提交后由客户端核对并确认。'].join('\n');
}
