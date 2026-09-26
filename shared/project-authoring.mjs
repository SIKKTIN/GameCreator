import {projectContentModules} from './project-changes.mjs';
import {authoringError} from './authoring-diagnostics.mjs';

export const authoringModules = {...projectContentModules, 'project-standards':'项目规范'};
export const canonical = v => Array.isArray(v) ? '['+v.map(canonical).join(',')+']' : v && typeof v==='object' ? '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}' : JSON.stringify(v);
const object = v => !!v && typeof v==='object' && !Array.isArray(v);
const same = (a,b) => canonical(a)===canonical(b);
const has = (v,k) => Object.hasOwn(v,k);
// `prototype` is the legitimate gameplay checklist field. Own-property traversal plus
// rejecting constructor/__proto__ prevents prototype traversal without banning this schema.
const unsafe = new Set(['__proto__','constructor']);
export function moduleGrants(member) { return member?.permissions?.includes('project_write') && member.developer?.scope==='project' ? member.developer.projectModules ?? Object.keys(authoringModules) : []; }
export function validModuleGrants(v) {return v===undefined || Array.isArray(v)&&v.length<=Object.keys(authoringModules).length&&new Set(v).size===v.length&&v.every(k=>has(authoringModules,k));}
const escape = s => String(s).replace(/~/g,'~0').replace(/\//g,'~1');
function parts(path) {
 if(typeof path!=='string'||path.length>1500||!path.startsWith('/'))throw new Error('操作路径必须是 /字段 或 /列表/@ID/字段');
 const p=path.slice(1).split('/').map(s=>{if(/~(?![01])/u.test(s))throw new Error('路径转义无效');return s.replace(/~1/g,'/').replace(/~0/g,'~');});
 if(p.some(s=>!s||unsafe.has(s)||s.startsWith('@')&&unsafe.has(s.slice(1))))throw new Error('路径包含保留名称');return p;
}
function location(root,path) {
 const p=parts(path);let parent=root;
 for(let i=0;i<p.length;i++){
  let key=p[i];
  if(Array.isArray(parent)){
   if(!key.startsWith('@'))throw new Error('列表必须使用 @ID / @key 定位，不支持数组下标');
   const matches=parent.flatMap((x,n)=>object(x)&&String(x.id??x.key)===key.slice(1)?[n]:[]);
   if(matches.length>1)throw new Error('条目标识重复');key=matches[0]??parent.length;
  }else if(!object(parent))throw new Error('路径的父级不存在：'+path);
  if(i===p.length-1)return {parent,key,exists:has(parent,key),value:parent[key]};
  if(!has(parent,key))throw new Error('路径的父级不存在：'+path);parent=parent[key];
 }
}
function safeJson(v,depth=0) {if(depth>60)throw new Error('提交内容嵌套过深');if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(unsafe.has(k))throw new Error('提交包含保留名称');safeJson(x,depth+1);}}
export function validateAuthoringProposal(p) {
 safeJson(p);
 if(!object(p)||p.schema!==1||p.format!=='gamecreator-content-change'||p.intent!=='project_change'||p.target?.kind!=='module'||!has(authoringModules,p.target.id)||typeof p.id!=='string'||!/^\w[\w-]{7,99}$/.test(p.id)||typeof p.projectId!=='string'||!p.projectId||typeof p.snapshotId!=='string'||!/^[a-f0-9]{64}$/.test(p.snapshotId)||typeof p.summary!=='string'||!p.summary.trim()||p.summary.length>4000||!object(p.compatibility)||['reuse','modify','add','archive'].some(k=>typeof p.compatibility[k]!=='string'||!p.compatibility[k].trim()||p.compatibility[k].length>10000)||!Array.isArray(p.operations)||!p.operations.length||p.operations.length>500)throw new Error('设计提交格式无效，请使用当前项目的提交模板');
 const seen=new Set();
 for(const op of p.operations){if(!object(op)||typeof op.id!=='string'||!op.id||op.id.length>100||seen.has(op.id)||!has(authoringModules,op.module)||!['add','set','remove'].includes(op.op)||op.op!=='remove'&&!has(op,'value'))throw new Error('设计操作无效或编号重复');parts(op.path);seen.add(op.id);}
 // A batch may add whole records, then reference them from other records. Overlapping writes
 // within one record must be combined so conflict decisions cannot produce order-dependent edits.
 for(let i=0;i<p.operations.length;i++)for(let j=i+1;j<p.operations.length;j++){const a=p.operations[i],b=p.operations[j];if(a.module===b.module&&(a.path===b.path||a.path.startsWith(b.path+'/')||b.path.startsWith(a.path+'/')))throw new Error('同一提交不能包含重叠路径，请合并为一个条目修改');}
 return p;
}
function mutate(root,op) {
 const at=location(root,op.path);
 if(op.op==='remove'){if(!at.exists)throw new Error('要删除的条目不存在：'+op.path);if(Array.isArray(at.parent))at.parent.splice(at.key,1);else delete at.parent[at.key];return;}
 if(op.op==='add'&&at.exists)throw new Error('新增标识已经存在：'+op.path);
 if(op.op==='set'&&!at.exists)throw new Error('要修改的字段不存在，请使用 add：'+op.path);
 if(Array.isArray(at.parent)){const expected=parts(op.path).at(-1).slice(1);if(!object(op.value)||String(op.value.id??op.value.key)!==expected)throw new Error('新增或替换条目的 ID / key 必须与路径一致');}
 at.parent[at.key]=structuredClone(op.value);
}
const lockedKeys=new Set(['dispatchHistory','personnel','authoringHistory','feedbackHistory','proposals','assignment','positionIds','specChanges','snapshots','releases','reviews','activeId','candidateId','dataReleases','dataSync','versions','styleReview','adoptedVersionId','images','files','storagePath','revision','scheduleProgress','scheduleAcceptance']);
const empty = v => v===undefined||v===null||v===''||v===false||v===0||Array.isArray(v)&&!v.length||object(v)&&!Object.keys(v).length;
function locked(module,path,key){
 if(lockedKeys.has(key))return true;
 if(module==='project-schedule'&&['status','actualStart','actualEnd','result','review'].includes(key))return true;
 if(module==='development-tools'&&['status','usage','delivery'].includes(key))return true;
 if(module==='functional-systems'&&key==='status')return true;
 if(module==='art-assets'&&['status','productionStatus','delivery'].includes(key))return true;
 if(module==='gameplay'&&['status','done','actual','result'].includes(key))return true;
 return false;
}
function initial(module,key,value){if(empty(value))return true;if(key==='status')return (module==='project-schedule'?['待开始','计划中']:module==='development-tools'?['待开发']:module==='functional-systems'?['待开发']:module==='art-assets'?['待制作','草稿']:['草稿']).includes(value);if(key==='productionStatus')return value==='待制作';if(module==='gameplay'&&key==='result')return value==='未测试';return false;}
function protect(module,before,after,path=''){
 // Configuration cells are domain data: names such as status, id, and result are not workflow metadata.
 if(module==='definitions'||module==='enum-versions'&&path==='/data')return;
 if(Array.isArray(before)||Array.isArray(after)){
  const a=before||[],b=after||[];
  if(!Array.isArray(a)||!Array.isArray(b))throw new Error('不能替换集合的数据类型');
  const records=[...a,...b].filter(object);
  if(records.length&&records.every(x=>has(x,'id')||has(x,'key'))){const key=x=>String(x.id??x.key);if(new Set(b.map(key)).size!==b.length)throw new Error('新增条目标识重复');const am=new Map(a.map(x=>[key(x),x])),bm=new Map(b.map(x=>[key(x),x]));for(const id of new Set([...am.keys(),...bm.keys()]))protect(module,am.get(id),bm.get(id),path+'/@'+escape(id));}
  else {for(let i=0;i<Math.max(a.length,b.length);i++)protect(module,a[i],b[i],path+'/'+i);}return;
 }
 if(!object(before)&&!object(after))return;
 const a=before||{},b=after||{};
 for(const k of new Set([...Object.keys(a),...Object.keys(b)])){
  if((k==='id'||k==='schema'||k==='key')&&before&&after&&has(a,k)&&!same(a[k],b[k]))throw new Error('已有条目标识和格式版本不可修改：'+path+'/'+k);
  if(locked(module,path,k)){
   if(before&&after&&!same(a[k],b[k])||!before&&!initial(module,k,b[k])||!after&&!initial(module,k,a[k]))throw new Error('此字段由进度、验收、人员或历史流程维护：'+path+'/'+k);
  }else protect(module,a[k],b[k],path+'/'+escape(k));
 }
}
export function assertAuthoringChange(module,before,after){
 if(!has(authoringModules,module))throw new Error('不支持的内容模块');
 if(module==='enum-versions'){const strip=v=>{const x={...v};delete x.data;return x;};if(!same(strip(before),strip(after)))throw new Error('只能修改开发配置表，不能改写发布及枚举历史');}
 if(module==='project-schedule')for(const task of before.tasks)if(['已完成','待验收'].includes(task.status)){const next=after.tasks.find(t=>t.id===task.id);if(next&&!same(task.references,next.references))throw new Error('已有验收成果的任务不能改绑交付对象，请为新增内容创建独立任务');}
 protect(module,before,after);
}
export function authoringPreview(p,base,current,decisions={}) {
 validateAuthoringProposal(p);const incoming=structuredClone(base),next=structuredClone(current),rows=[];
 for(const op of p.operations){try{mutate(incoming[op.module],op);const b=location(base[op.module],op.path),c=location(current[op.module],op.path),n=location(incoming[op.module],op.path);const state=c.exists===n.exists&&same(c.value,n.value)?'unchanged':c.exists===b.exists&&same(c.value,b.value)?'updated':'conflict';rows.push({id:op.id,module:op.module,path:op.path,op:op.op,state,base:b.exists?JSON.stringify(b.value,null,2):'（不存在）',current:c.exists?JSON.stringify(c.value,null,2):'（不存在）',incoming:n.exists?JSON.stringify(n.value,null,2):'（删除）'});
  if(state==='unchanged'||decisions[op.id]==='keep')continue;
  if(state==='conflict'&&!['keep','proposal'].includes(decisions[op.id]))continue;
  const effective={...op,op:op.op==='remove'?'remove':c.exists?'set':'add'};mutate(next[op.module],effective);
  }catch(e){throw authoringError(e,'proposal',op.module,[op]);}
 }
 const modules=[...new Set(p.operations.map(o=>o.module))];for(const m of modules){try{assertAuthoringChange(m,base[m],incoming[m]);assertAuthoringChange(m,current[m],next[m]);}catch(e){throw authoringError(e,'candidate',m,p.operations);}}
 return {rows,next,incoming,unresolved:rows.filter(r=>r.state==='conflict'&&!['keep','proposal'].includes(decisions[r.id])).length};
}
