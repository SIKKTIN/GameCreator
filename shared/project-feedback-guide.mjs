export function projectFeedbackGuide(project){
 const common={schema:1,projectId:project.projectId,engine:project.engine,id:'00000000-0000-4000-8000-000000000002',snapshotId:project.snapshotId,author:'开发者名称',summary:'说明修改事项',evidence:['依据与验证结果'],reason:'为什么需要修改',impact:'对实现、测试和计划的影响',compatibility:{reuse:'保留原条目身份、分类和已有有效规则',modify:'说明要修改的字段、所属模块及兼容方式',add:'无',archive:'无'}};
 const spec={...common,intent:'spec_change',target:{kind:'task',id:'替换为真实任务ID'},changes:{description:'建议采用的新任务说明',acceptance:'建议采用的新验收标准'}};
 const formal={...common,id:'00000000-0000-4000-8000-000000000003',intent:'project_change',target:{kind:'module',id:'project'},changes:{'/description':JSON.stringify('项目的新说明')}};
 return '# 需求变更建议与正式项目修改\n\n'+
 '先阅读 [项目规范](project-standards.md)。新快照的需求与项目修改反馈必须填写 compatibility，分别说明复用、修改、新增、归档；无对应内容时写“无”。普通进度反馈与旧快照不补填。\n\n'+
 'progress 报告做到了什么；review 提交验收结论；propose 仅提交分工和排期建议。以下两种变更单独处理，不能混入批量进度反馈。\n\n'+
 '## spec_change：需求与验收变更建议\n\n需要 spec_change 权限及目标任务范围。changes 只允许 description、acceptance，填写建议采用的完整文本。原因 reason、影响 impact 必填。提交不会立即改变正式需求；管理者在 GameCreator 比较基准、当前内容和建议内容，逐项解决冲突并采纳，或拒绝。采纳不改变任务完成状态。\n\n```json\n'+JSON.stringify(spec,null,2)+'\n```\n\n'+
 '## project_write：项目内容修改权限\n\n它是权限，不是反馈类型。持有此权限并具有项目范围的长期开发者，使用 intent: project_change 提交正式修改。新建制作人默认拥有，其他开发者须由管理者显式授予。旧令牌不会因名称叫制作人自动扩权。修改仍在 GameCreator 中逐条比较和确认。\n\n'+
 '先读 context/content/<模块ID>.json。target.kind 固定为 module，target.id 是模块 ID。可用模块：project、project-schedule、gameplay、gameplay-core、prototype-design、task-flows、numerical-analysis、functional-systems、development-tools、art-assets、stories、story-orchestration、map-design、program-framework、definitions、enum-versions。\n\n'+
 'changes 的键是字段路径，值是 JSON.stringify(新值) 得到的文本。字符串也必须包含 JSON 引号。对象属性用 / 分隔，属性内的 ~ 和 / 分别写为 ~0 和 ~1；记录列表使用 /@ID/字段（记录只有 key 时用 @key），禁止下标定位，以免排序改变后改错条目。例如 /tasks/@真实任务ID/acceptance、/requirements/@素材需求ID/specification、/data/datasets/pvz_plants/@植物ID/health。\n\n'+
 '本反馈入口支持已有条目的字段修改。新增、删除及跨模块结构变更进入绑定的 GameCreator 项目，按 GAMECREATOR_GUIDE.md 使用 ai/changes 编写协议。排期可修改任务说明、验收标准、计划日期、优先级、负责人文字等计划字段。enum-versions 只开放 data 下的开发配置，枚举历史和稳定版本不通过此入口修改。人员身份、任务授权、令牌、处理记录、文件交付与验收状态不属于 project_write；制作状态仍使用 progress/review。禁止同时修改父字段和子字段。\n\n```json\n'+JSON.stringify(formal,null,2)+'\n```\n\n'+
 '将真实快照、目标 ID 和新的反馈 UUID 写入草稿，用 submit-feedback.cjs 和对应私有凭证签名。不要改写只读 context 或历史 snapshots。每条正式修改只更新一个模块；通过后重新同步上下文再继续开发。相同更新编号只处理一次，失败的多存档写入可在重新读取时恢复，不能通过换编号重复提交。\n';
}
