import {projectContentModules} from './project-changes.mjs';
// Engine-neutral exchange format. Feedback is data, never a script to execute.
export const feedbackIntentLabels={progress:'制作进度',review:'验收结论',propose:'分工/排期建议',spec_change:'需求与验收变更建议',project_change:'正式项目修改'};
export const feedbackFields = {
  task: {status:'任务状态',actualStart:'实际开始日期',actualEnd:'实际结束日期',result:'开发结果 / 受阻原因'},
  tool: {status:'工具状态',usage:'使用说明',delivery:'交付位置与测试结果'},
  module: {},
};
const statuses={task:['待开始','进行中','待验收','已完成','受阻'],tool:['待开发','开发中','待验收','可使用','停用']};
export const feedbackIdPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const snapshotIdPattern=/^[a-f0-9]{64}$/;
const record=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const text=(v,max)=>typeof v==='string'&&v.length<=max;
const date=v=>v===''||(/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v);
export function stableFeedbackJson(value) {
  if(Array.isArray(value))return '['+value.map(stableFeedbackJson).join(',')+']';
  if(record(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableFeedbackJson(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export function validateFeedback(value) {
  const fail=message=>{throw new Error('反馈格式无效：'+message);};
  if(!record(value)||value.schema!==1||!text(value.projectId,1200)||!value.projectId||!['godot-gdscript','oasis-lua'].includes(value.engine)||!feedbackIdPattern.test(value.id)||!snapshotIdPattern.test(value.snapshotId))fail('项目、引擎、更新编号或快照编号错误');
  if(!record(value.target)||!Object.hasOwn(feedbackFields,value.target.kind)||!text(value.target.id,1200)||!value.target.id.trim())fail('任务或工具标识错误');
  if(!text(value.author,200)||!value.author.trim()||!text(value.summary,3000)||!value.summary.trim()||!Array.isArray(value.evidence)||value.evidence.length>30||value.evidence.some(v=>!text(v,2000)))fail('请提供作者、反馈摘要和依据列表');
  if(value.intent!==undefined&&!Object.hasOwn(feedbackIntentLabels,value.intent))fail('反馈意图无效');
  const spec=value.intent==='spec_change',project=value.intent==='project_change';
  if(spec&&value.target.kind!=='task'||project!==(value.target.kind==='module'))fail('反馈类型与目标不匹配');
  if(project&&!Object.hasOwn(projectContentModules,value.target.id))fail('项目模块不支持修改');
  if((spec||project)&&(!text(value.reason,3000)||!value.reason.trim()||!text(value.impact,3000)||!value.impact.trim()))fail('请填写修改原因和影响说明');
  if(value.identity!==undefined&&(!record(value.identity)||Object.keys(value.identity).some(k=>!['memberId','credentialId','signature'].includes(k))||!text(value.identity.memberId,200)||!value.identity.memberId||!feedbackIdPattern.test(value.identity.credentialId)||!text(value.identity.signature,200)))fail('AI 反馈身份格式无效');
  if(!record(value.changes)||!Object.keys(value.changes).length)fail('没有变更字段');
  for(const [key,v] of Object.entries(value.changes)) {
    if(project){if(!key.startsWith('/')||key.length>1500)fail('字段路径无效');try{JSON.parse(v);}catch{fail('项目字段值必须是 JSON 编码的文本');}}
    else if(spec?!['description','acceptance'].includes(key):!Object.hasOwn(feedbackFields[value.target.kind],key))fail('不支持回写字段 '+key);
    if(!text(v,30000))fail('字段必须是文本且不超过 30000 字符');
    if(key==='status'&&!statuses[value.target.kind].includes(v))fail('状态不受支持');
    if(['actualStart','actualEnd'].includes(key)&&!date(v))fail('实际日期必须是有效的 YYYY-MM-DD 或空字符串');
  }
  if(value.changes.actualStart&&value.changes.actualEnd&&value.changes.actualStart>value.changes.actualEnd)fail('实际结束日期早于开始日期');
  if(Object.keys(value.changes).length>(project?40:4))fail('单条反馈字段过多');
  if(project){const paths=Object.keys(value.changes);if(paths.some(a=>paths.some(b=>a!==b&&b.startsWith(a+'/'))))fail('同一反馈不能同时修改父字段和子字段');}
  return value;
}
export function validateFeedbackHistory(value,kind) {
  if(value===undefined)return [];
  const fail=()=>{throw new Error('开发反馈处理记录损坏');},seen=new Set();
  if(!Array.isArray(value)||value.length>10000)return fail();
  for(const r of value) {
    if(!record(r)||r.schema!==1||!feedbackIdPattern.test(r.id)||!snapshotIdPattern.test(r.digest)||!snapshotIdPattern.test(r.snapshotId)||!text(r.projectId,1200)||!r.projectId||!['godot-gdscript','oasis-lua'].includes(r.engine)||!['applied','dismissed'].includes(r.outcome)||!record(r.target)||!(r.target.kind===kind||kind==='task'&&r.target.kind==='module'&&r.identity?.intent==='project_change')||!text(r.target.id,1200)||!r.target.id||!text(r.title,3000)||!text(r.at,50)||!Number.isFinite(Date.parse(r.at))||!text(r.author,200)||!text(r.summary,3000)||!Array.isArray(r.evidence)||r.evidence.length>30||r.evidence.some(v=>!text(v,2000))||!Array.isArray(r.rows)||r.rows.length>(r.target.kind==='module'?40:4)||!record(r.decisions)||seen.has(r.projectId+':'+r.id))return fail();
    if(r.identity!==undefined&&(!record(r.identity)||r.identity.verified!==true||!text(r.identity.memberId,200)||!text(r.identity.credentialId,200)||!text(r.identity.memberName,100)||!Object.hasOwn(feedbackIntentLabels,r.identity.intent)))return fail();
    if(r.reason!==undefined&&(!text(r.reason,3000)||!text(r.impact,3000)))return fail();
    const fields=new Set();
    for(const row of r.rows) {
      if(!record(row)||!text(row.field,1500)||!(r.target.kind==='module'?row.field.startsWith('/'):(Object.hasOwn(feedbackFields[kind],row.field)||r.identity?.intent==='spec_change'&&['description','acceptance'].includes(row.field)))||fields.has(row.field)||!text(row.label,1700)||!['base','current'].every(k=>text(row[k],20*1024*1024))||!text(row.incoming,30000)||!['updated','unchanged','conflict'].includes(row.state)||!['keep','feedback'].includes(r.decisions[row.field]))return fail();
      fields.add(row.field);
    }
    if(Object.keys(r.decisions).some(k=>!fields.has(k)))return fail();
    seen.add(r.projectId+':'+r.id);
  }
  return value;
}
export function feedbackDiff(feedback,base,current) {
  if(!base)throw new Error('导出的快照中不存在此任务或工具');
  if(!current)throw new Error('当前项目已删除此任务或工具');
  if(current.archived)throw new Error('此工具已归档，请先在开发工具中恢复');
  return Object.entries(feedback.changes).map(([field,incoming])=>({field,label:({description:'任务说明',acceptance:'验收标准'}[field]||feedbackFields[feedback.target.kind][field]),base:base[field],current:current[field],incoming,
    state:current[field]===incoming?'unchanged':current[field]===base[field]?'updated':'conflict'}));
}
export function mergeFeedback(current,rows,decisions={},acceptCompletion=false) {
  const next=structuredClone(current);
  for(const row of rows) {
    if(row.state==='conflict'&&!['keep','feedback'].includes(decisions[row.field]))throw new Error('请逐项处理冲突');
    if(row.state==='unchanged'||decisions[row.field]==='keep')continue;
    if(row.field==='status'&&['已完成','可使用'].includes(row.incoming)&&!acceptCompletion)throw new Error('请先核实交付与验收情况，再接收完成状态');
    next[row.field]=row.incoming;
  }
  if(next.actualStart&&next.actualEnd&&next.actualStart>next.actualEnd)throw new Error('合并后的实际结束日期早于开始日期，请调整日期反馈或字段选择');
  return next;
}
export function feedbackBatchItems(entries,acceptCompletion=false) {
  const ready=[],skipped=[];
  const counts=new Map();
  const target=e=>JSON.stringify([e.feedback?.target.kind,e.feedback?.target.id]);
  for(const e of entries)if(e.state==='pending'&&e.feedback)counts.set(target(e),(counts.get(target(e))||0)+1);
  for(const entry of entries) {
    if(entry.state==='processed')continue;
    let reason='';
    if(entry.legacy)reason='旧版未签名反馈需要逐条确认来源';
    else if(entry.state!=='pending'||!entry.feedback||!entry.token)reason=entry.error||'需要重新读取或修正反馈';
    else if(['spec_change','project_change'].includes(entry.feedback.intent))reason='需求建议与正式项目修改需逐条评估并确认';
    else if(counts.get(target(entry))>1)reason='同一目标有多条反馈，请逐条核对';
    else if(entry.rows.some(r=>r.state==='conflict'))reason='存在字段冲突，请逐条处理';
    else if(!acceptCompletion&&entry.rows.some(r=>r.field==='status'&&r.state!=='unchanged'&&['已完成','可使用'].includes(r.incoming)))reason='完成状态等待验收确认';
    if(reason)skipped.push({entry,reason});else ready.push(entry);
  }
  return {ready,skipped};
}
export function collaborationReadme(project) {
  return `# GameCreator 开发协作\n\n项目：${project.projectName}\n\n## 使用方式\n\n1. 先读 project.json、context/tasks.json、context/tools.json 和项目设计文档。ID 是稳定身份，名称不可代替 ID。\n2. 开始开发时反馈“进行中”；实现后建议反馈“待验收”，并写明测试结果、未完成项和交付入口。\n3. 每个反馈文件只更新一个任务、工具或项目模块，放在 feedback/<更新编号>.json，使用 UTF-8 JSON。每次新反馈使用新的 UUID。先写 .tmp 文件再重命名为 .json，避免读取半写入文件。\n4. GameCreator 的“引擎设置 → 开发反馈”会读取并比较差异，由用户应用或忽略。receipts/ 保存处理回执。重复读取不会再次应用；已处理的反馈请勿修改。\n5. 收到回执后再次同步上下文，基于最新快照继续开发。\n\n## 岗位工作与协作令牌\n\n启用人员分配后，先读 context/team.json、context/assignments.json 与 assignments/<令牌ID>.md，members/<执行者ID>.md 汇总执行分配。岗位描述要做什么；每个长期令牌代表一个开发者，可暂不指定任务，后续调整职责、岗位、权限和任务时继续使用同一令牌。已分配任务范围仅允许明确选择的工作；岗位范围包含所选岗位的后续任务；项目范围可用于零任务的制作人管理项目。范围不等于个人工作量，只有明确分配的任务计入个人任务。反馈权限和有效期以 GameCreator 当前授权为准。完整凭证由管理者单独交付，禁止放在公共文档、反馈文件或版本库中。普通工程同步不会重新签发凭证。\n\n使用 Node.js 运行：\n\n\`node gamecreator/submit-feedback.cjs <私有凭证文件> <反馈草稿.json> gamecreator/feedback\`\n\n辅助工具会签名并添加 identity，不会将私钥写入反馈。草稿的 intent 为 progress（制作进度，默认）、review（验收结论）、propose（分工/排期建议）、spec_change（需求与验收变更建议）或 project_change（正式项目修改）。后两种需要独立权限、原因与影响说明，详见 [需求与项目修改](project-changes.md)；不会混入一键应用。执行成员提交待验收；提交已完成或可使用需要 review 权限。长期开发者必须有目标范围和 review 权限；旧版工作令牌仍受原选中任务限制，旧版成员令牌仍要求指定验收负责人或项目范围。propose 仅支持 task 的 result 文本，应用后追加到任务建议，不覆盖进度和结果。工具反馈根据引用该工具的制作任务核验授权。\n\n改名或调整任务不改变成员与令牌 ID。管理者可在开发者与令牌页签重新复制凭证。任务范围、开发者和岗位启用状态、权限、有效期与撤销情况均按最新状态核验；项目范围无需逐一分配任务。未签名的旧反馈在启用 AI 团队后需逐条核实，不能一键应用。原始 author 文字不代表身份。所有写入仍需在 GameCreator 确认。\n\n## 文件约定\n\n- context/ 与 project.json 由 GameCreator 生成，请勿修改。历史 snapshots/ 保留旧反馈的比较基准。\n- feedback/ 由开发者、AI 助手或引擎工具写入。receipts/ 由 GameCreator 写入。\n- 本目录用于开发协作，发布游戏时按工程规则排除。反馈中的路径、命令和链接仅作为说明，不会被自动执行。\n- 单机工程无需额外服务器；反馈格式与引擎语言无关。\n\n## 反馈格式\n\n从 project.json 复制 projectId、engine、snapshotId。target.kind 为 task 或 tool；target.id 从对应上下文复制。\n\n\`\`\`json\n${JSON.stringify({schema:1,projectId:project.projectId,engine:project.engine,id:'00000000-0000-4000-8000-000000000001',snapshotId:project.snapshotId,target:{kind:'task',id:'复制真实任务ID'},author:'开发者或 AI 助手名称',summary:'说明本次开发进展',evidence:['提交号、相关文件、运行入口、测试结果（如有）'],changes:{status:'待验收',result:'已实现内容、测试情况与剩余问题'}},null,2)}\n\`\`\`\n\n上例仅为模板，必须替换更新编号与真实目标 ID 后提交。\n\n## 允许回写的字段\n\n- task：status（待开始/进行中/待验收/已完成/受阻）、actualStart、actualEnd（YYYY-MM-DD 或空字符串）、result（开发结果或受阻原因）。\n- tool：status（待开发/开发中/待验收/可使用/停用）、usage（使用说明）、delivery（交付位置与测试结果）。\n- changes 只填写本次要改的字段；未填写的字段保持原值。\n- evidence 是文本数组，author 与 summary 必填。\n- 标记“已完成”或“可使用”需要在 GameCreator 内核实验收。在 GameCreator 中，工具关联任务全部完成后同步为可使用；素材关联的美术任务全部完成后同步素材状态为已完成，退回任务也会更新素材状态。里程碑仍由管理者确认验收。\n- 美术素材直接生成在游戏工程内，无需上传到 GameCreator。查看素材制作文档并按 context/tasks.json 中的 requirement/asset 引用定位对应美术任务；通过任务反馈 status 与 result 回写进度，在 result 中填写交付路径、验证结果与未完成项。路径按文档要求填写，不会自动执行。没有明确关联时请先在 GameCreator 中关联美术任务，不要根据名称猜测。\n- 需求与验收标准通过 spec_change 提建议；项目范围且具有 project_write 权限的长期开发者可通过 project_change 修改已有项目内容与计划字段。详见 [需求与项目修改](project-changes.md)。新增、删除条目和人员授权仍在 GameCreator 界面管理。\n- 同字段两边同时修改会显示冲突；设计要求变化也会提示复核。\n`;
}
