import {authoringModules} from './project-authoring.mjs';
export const guideVersion='2026-09-26.1';
export function gamecreatorGuide(){return `# GameCreator 使用说明与 AI 项目编写协议

说明版本：${guideVersion}

## 从哪里开始

GameCreator 项目文件夹以 project.gamecreator 为入口，archives 保存应用存档，assets 保存历史附件。先在客户端打开项目，再阅读本说明、项目规范和 ai/context/content 中的当前内容。不要直接编辑哈希存档、锁文件或私有凭证。

全新原型可以先完成设计，再连接引擎。项目文件夹的 ai 目录支持内容编写；引擎内 gamecreator 目录支持开发反馈，两者用途与路径不同。

## 从零设计原型

1. 在人员分配创建开发者。制作人可不分配任务，使用长期令牌；选择项目范围、修改项目内容与排期，并明确允许的模块。私有凭证单独下载给开发者。
2. 在“使用说明 → 项目编写”点击“更新协作文件”，生成最新上下文。新建文件夹已包含起始上下文；人员或项目有变化时重新生成。
3. 先明确项目目标、范围与验收，再组织玩法核心、玩法文档、功能、配置、素材标准、任务与里程碑。已有项目优先复用已有分类、系统与稳定 ID。版本不作为所有模块的重复分类。
4. 读取 ai/project.json 的 snapshotId、modules、developers 与 ai/context/templates.json、template-options.json。空数组的条目结构应从对应嵌套模板取得，不要猜测字符串或对象；新增条目需使用新的稳定 ID，补齐必填字段，保持未开发状态。
5. 以 ai/change-template.json 为例编写一个跨模块 JSON 提交，先本地校验，再用凭证签名提交。
6. 管理者在“使用说明 → 项目编写”读取提交、查看差异、处理冲突并应用。整批内容与引用检查通过后统一写入。回执位于 ai/receipts；更新上下文后再开始下一批。

## 内容权限与反馈权限

progress 报告开发成果；review 提交验收结论；propose 建议分工或排期；spec_change 建议修改已有任务说明和验收标准；project_write 编写获准模块的正式项目内容。

project_write 支持新增、修改、重新分类、关联、归档、删除未交付条目及跨模块批次。完成或交付历史不允许通过删除条目抹除；应保留旧成果并归档。人员、岗位授权、令牌、引擎连接、文件访问、稳定发布与验收结果由各自管理流程维护。

旧 project_change 反馈仍支持已有字段修改；本说明的 gamecreator-content-change 协议用于结构性批次。私有凭证不写入上下文，不提交到 Git。当前权限以客户端中开发者的最新配置为准，导出的 developers 只是生成时的公开说明。

## 提交格式

必填：format=gamecreator-content-change、schema=1、id、projectId、snapshotId、intent=project_change、target={kind:module,id:首个模块}、summary、compatibility、operations。

compatibility 的 reuse、modify、add、archive 分别说明复用、修改、新增、归档及影响，没有写“无”。

每个 operation 包含唯一 id、module、op、path，以及 add/set 的 value（原生 JSON，不是字符串化 JSON）。op 为 add / set / remove。

- 对象字段：/description。新增可选字段用 add，修改已存在字段用 set。
- 列表条目：/designs/@条目ID。配置表定义根列表：/@表名。使用 @ID 或 @key，禁止顺序下标。
- 嵌套字段：/tasks/@任务ID/acceptance。归档：将条目的 archived 设为 true。
- 新增完整条目可含内部节点；同批其他模块可以引用它。不能在一批里重叠写入同一路径及其子路径。
- 新增配置表时同时添加 definitions 的 /@表名，以及 enum-versions 的 /data/columns/表名 和 /data/datasets/表名。单元格值为字符串，表、字段、行 ID 唯一。
- 更新配置字段时同步表定义与开发数据字段；发布快照保持不变。引用目标删除时，同批修复所有关联，否则拒绝应用。

## 提交命令

在 GameCreator 项目文件夹运行（需要 Node.js）：

\`\`\`sh
node ai/submit-change.cjs validate change.json
node ai/submit-change.cjs validate change.json --json
node ai/submit-change.cjs submit change.json /私有位置/credential.json
\`\`\`

validate 使用随项目导出的 ai/validator.cjs，与编辑器同源地检查操作路径、候选模块结构、工作流锁定字段、配置一致性、跨模块引用及任务依赖循环。submit 在读取私有凭证与签名前执行同样的完整校验。离线成功只针对导出快照，不代表最新授权或并发状态通过；客户端仍以当前内容复核权限、冲突与事务。签名后不要再手改 ai/changes 中的文件；内容变更请使用新的提交 ID。相同 ID 不允许变更内容重放。

## 嵌套模板与错误定位

templates.json 提供完整对象和常用嵌套条目：gameplayLoopStep、gameplayPrototypeItem、gameplayCheck、gameplayDependency、gameplayRuleCondition、gameplayRuleAction、gameplayTimelineTrack、gameplayTimelineEvent、coreEdge，以及任务、地图、故事、素材和数值分析的子项。每次复用模板都重新生成条目 ID，随后填写真实引用。template-options.json 列出关键枚举、初始工作流值和模板路径；它不是完整 Schema，完整约束由同源校验器执行。

玩法的 loop 是 { id, text } 对象列表；prototype 是 { id, text, done: false } 对象列表；checks 的条目需包含 id、question、steps、expected、actual: ""、result: "未测试"。状态 kind 只允许 normal 或 outcome，不能使用 terminal。

使用 --json 获得可供 AI 读取的诊断。失败退出码为 1，diagnostics 包含 code、scope、module、operationId、path、message，以及可用时的 expected / actual。最多返回100项独立字段问题；结构损坏时不继续执行依赖该结构的引用检查。路径优先使用 @ID；非法列表项没有 ID 时用位置数字定位，修正后仍以 @ID 提交。

scope=candidate 表示提交候选内容非法，没有写入正式项目；baseline 表示导出基准异常；current 表示客户端当前存档异常；proposal 表示操作或路径错误；reference 表示引用检查失败。某些模块仍只有模块级结构诊断，此时需要结合对应模板排查；客户端显示同样的操作与字段信息，并可复制诊断。

ai/project.json 记录校验包模型版本和摘要，用于发现导出文件不配套。缺少校验包、模型版本或摘要不符时，在新版客户端更新协作文件；不要手改版本号或摘要跳过检查。模型升级后更新上下文再提交。无需安装 GameCreator 源码依赖或启动客户端即可执行离线校验。

## 支持的内容模块

${Object.entries(authoringModules).map(([id,label])=>'- '+label+'：'+id).join('\n')}

模块存档结构参照 context/content 对应 JSON，新增常用条目参照 templates.json。地图、故事编排等可选模块须在同批明确设置 enabled。项目规范可编辑项目补充，通用内置规则随客户端维护。美术风格可编辑草稿；确认风格基线在客户端执行。

## 冲突、恢复与边界

提交绑定生成时的快照。其他人修改了同一字段时，预览对比基准、当前值、提交值，逐项选择保留当前或采用提交。未处理冲突不写入。新增标识冲突、错误引用、模块越权、改写完成状态会阻止应用。结构已删除时应重新读取最新上下文再提交。

应用使用持久化事务日志；发生中断时在项目编写点击“恢复未完成提交”，恢复后重新打开各模块。存档文件自带上一版备份，处理历史保留在项目排期存档中。复制项目时保留整个项目文件夹。另存为新身份后应重新生成协作文件与凭证。

引擎中的开发反馈仍在“引擎设置 → 开发反馈”读取和处理；设计批次在本模块处理。设计内容保存成功不代表开发完成，也不会自动验收里程碑。

## 文件维护

更新协作文件只更新 GameCreator 管理的文档与上下文，保留自定义 README 和 AGENTS.md。项目根 README 中的使用说明链接用于发现入口。此说明不授予权限；缺少令牌或范围时，在人员分配明确授权后再提交。
`;}
