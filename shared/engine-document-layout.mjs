export const documentGroups = [
  {id:'project-guide',label:'项目指南',modules:['standards','usage-guide']},
  {id:'project-management',label:'项目管理',modules:['engine','schedule','personnel']},
  {id:'gameplay',label:'玩法与关卡',modules:['core','gameplay','prototype','maps','tasks','analysis']},
  {id:'development',label:'系统与开发',modules:['functional','framework','development-tools']},
  {id:'content',label:'内容制作',modules:['art','stories','narrative']},
  {id:'data-engine',label:'数据与同步',modules:['data','enum-definitions','enum-versions','config-data-policy']},
];
export const moduleDocumentPath = id => 'modules/'+(documentGroups.find(g=>g.modules.includes(id))?.id || 'other')+'/'+id+'.md';
export function relativeDocumentPath(from,to) {
  const a=from.split('/').slice(0,-1),b=to.split('/');
  while(a.length&&b.length&&a[0]===b[0]){a.shift();b.shift();}
  return [...a.map(()=>'..'),...b].map(encodeURIComponent).join('/');
}
export function projectWorkflowMarkdown({projectId='',projectName='',projectDirectory='',engineDirectory='',docsDirectory='docs/gamecreator'}={}) {
  const root=projectDirectory.replaceAll('\\','/').replace(/\/$/,'');
  const local=p=>'[打开 '+p+'](<file:///'+(root+'/'+p).replace(/^\//,'').split('/').map((v,i)=>i===0&&/^[A-Za-z]:$/.test(v)?v:encodeURIComponent(v)).join('/')+'>)';
  return `## 从引擎效果到项目管理\n\nAI 以引擎项目为主要工作目录，结合实际运行效果完成设计、开发与验证。GameCreator 项目保存正式设计、分工、进度和验收记录。\n\n`+
    `- 项目：${projectName}\n- 项目 ID：${projectId}\n- 引擎工程目录：${engineDirectory||'以当前工程为准'}\n- GameCreator 项目目录：${projectDirectory||'尚未保存为独立文件夹，请先在 GameCreator 保存项目，再重新同步'}\n- 设计文档目录（相对工程）：${docsDirectory}\n\n`+
    (root?`### 编写或重组设计\n\n1. 进入上述 GameCreator 项目，核对 project.gamecreator 中的项目 ID，阅读 ${local('GAMECREATOR_GUIDE.md')} 和 ${local('ai/README.md')}。\n2. 在 GameCreator 的“使用说明 → 项目编写”更新协作文件，然后读取该目录的 ai/project.json、ai/context 与模板。\n3. 在 **GameCreator 项目根目录**运行：\n\n\`\`\`sh\nnode ai/submit-change.cjs validate ai/draft.json\nnode ai/submit-change.cjs submit ai/draft.json <本开发者凭证的绝对路径>\n\`\`\`\n\n4. 设计提交写入该项目的 ai/changes；管理者在“使用说明 → 项目编写”读取、处理冲突并应用。查看 ai/receipts 确认结果。\n\n`:'')+
    `### 开发反馈与下一轮\n\n开发进度、验收结论及已有需求建议，通过引擎工程 gamecreator/feedback 提交，在“工程同步 → 开发反馈”处理；完整的跨模块设计编写使用上面的 ai/changes 流程。两种快照和提交格式不可混用。\n\n根据实际效果决定修复实现还是调整需求；代码当前行为不自动成为已验收标准。变更应用后，重新同步工程文档与协作上下文，再继续开发。正式配置另走“数据同步”的导入、导出与冲突处理。\n\n这些 Markdown 是同步副本，直接编辑不会回写 GameCreator；不要直接修改项目 archives 或只读上下文。目录搬迁后重新连接并同步入口。\n`;
}
