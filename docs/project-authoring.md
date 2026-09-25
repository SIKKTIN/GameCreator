# 使用说明与项目内容编写

“使用说明”位于项目规范下方，包含使用说明、项目编写、权限说明、处理记录四个页签。本地项目不需要连接引擎即可创建协作上下文，由 AI 开发者提交从零设计或后续迭代的内容批次。

## 首次使用

1. 保存 GameCreator 项目为独立文件夹。新文件夹自动加入 `GAMECREATOR_GUIDE.md`、README 入口、`ai/project.json`、当前内容、常用条目模板和提交脚本。
2. 在人员分配创建长期开发者。制作人可以零任务创建，默认项目范围与全部内容模块权限。其他岗位默认没有 `project_write`；管理者可明确选择多个模块。
3. 到使用说明的项目编写页签，更新协作文件，单独下载开发者私有凭证。上下文仅包含公开身份和授权信息。
4. 开发者参考 `ai/change-template.json` 和 `ai/context/templates.json` 编写批次。完整操作规范由 `shared/gamecreator-guide.mjs` 统一生成，并随 AI 文档、引擎开发协作文件输出。
5. 在项目目录执行 `node ai/submit-change.cjs validate change.json`，再执行 `node ai/submit-change.cjs submit change.json /private/credential.json`。
6. 客户端读取设计提交，比较基准、当前值和提交值，处理冲突后应用整批变更。成功后重新加载所有模块，保存处理记录。

旧项目在使用说明中更新协作文件即可接入。目录内自定义 README 和 AGENTS.md 保留；发现同名的自定义使用说明文件时停止覆盖，提示先另存。旧格式或不完整存档另存时仍保留原文件，只生成静态入口和待生成上下文的说明，待客户端修复后再生成。

## 权限

- `progress`、`review`、`propose`、`spec_change` 的含义及现有引擎反馈流程保持不变。
- `project_write` 配合长期开发者的项目范围和 `developer.projectModules` 控制内容编写。未记录模块列表的历史授权保留原项目范围；显式空列表表示没有模块写入范围。
- 支持 17 个内容模块：概览、规范补充、排期、玩法、核心、原型、任务流程、数值分析、功能系统、工具、素材文档、故事文档、故事编排、地图、程序框架、数据表定义、开发配置数据。
- 人员、岗位分配、令牌、权限、引擎连接、附件文件、已发布数据、审核和历史记录不属于内容批次的可写范围。
- 新任务、功能、素材、工具和玩法保持初始状态。已完成或待验收任务不能改绑交付对象，避免把旧验收成果转移到新内容；需要新增独立任务。
- 实际权限取客户端中最新身份和令牌信息。预览后撤销令牌、停用岗位或减少模块授权，会阻止最终写入。旧单模块 `project_change` 同样遵守新增的模块限制。

## 批次与一致性

协议名称 `gamecreator-content-change`，schema 为 1。操作为 `add`、`set`、`remove`，采用字段路径和 `@ID` / `@key`，不使用数组下标。归档通过修改已有 `archived` 字段完成；不支持归档的内容可以在解除引用后删除未交付条目。

允许新增完整记录并在同一批次关联，也可以调整分类或编辑嵌套图节点。重叠路径须合并，避免冲突选择的先后顺序影响结果。所有模块的候选存档通过编辑器同源格式校验，再检查跨模块链接、流程节点、任务依赖循环和配置表字段。旧草稿已有的引用问题可以保留，但不能新增失效引用。语义重复、功能归属是否合理、玩法是否成立仍由提交人和管理者检查。

提交使用注册过的上下文快照。快照文件必须匹配 SHA-256，不能仅靠修改文件名生成可信基准。只保留最近 100 个注册基准；过旧提交应刷新上下文重做。扫描最多 500 个 JSON，每个不超过 2 MB；每批最多 500 个操作。已处理编号绑定原文件摘要，变更内容后不能复用原编号。

应用前再次校验所有原始存档、签名和提交文件。预览绑定当时的完整存档摘要，之后内容变化时必须重新读取并确认，旧的冲突选择不能覆盖再次更新的内容。客户端记录持久化事务日志后逐文件写入；发生中断时属于待恢复状态，不把部分内容当作成功。通过项目编写中的恢复操作继续已确认事务。普通存档、目录和开发者写入在恢复期间阻止覆盖。内容及 `project-schedule.authoringHistory` 同属事务，回执文件可以从处理历史重建。

修改项目名称时同步最近项目目录与文件夹入口，名称更新也参与事务恢复；配置数据变动由客户端递增修订号，防止旧编辑页面覆盖新数据。

## 文件和入口

```text
项目文件夹/
  project.gamecreator
  README.md
  GAMECREATOR_GUIDE.md
  archives/                     # 应用存档，不直接编辑
  assets/                       # 历史附件
  ai/
    project.json                # 基准编号、公开模块及开发者范围
    change-template.json
    submit-change.cjs
    context/
      templates.json
      content/*.json
      snapshots/<sha256>.json
    changes/<id>.json
    receipts/<id>.json
```

项目内容批次在 GameCreator 文件夹的 `ai/changes` 处理；引擎进度反馈仍在引擎文件夹的 `gamecreator/feedback` 处理。另存为新的项目身份后重新生成上下文及新项目凭证。导出的普通 AI 文档是阅读资料，不能代替签名提交和应用。

## 验证

核心和文件流程：`node --test tests/project-authoring.test.cjs`。

客户端回归：设置 `GAMECREATOR_PLAYWRIGHT_PATH` 后运行 `node tests/desktop-project-authoring.cjs`。测试使用临时项目与配置，不读取或修改正式项目。

内容模型更新后执行 `node scripts/build-project-content-model.mjs`，随后运行 `npm run build`。
