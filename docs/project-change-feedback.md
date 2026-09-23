# 需求建议与项目内容修改

这两项能力属于本地项目的开发协作。开发者在游戏工程的 `gamecreator/feedback/` 中提交签名反馈，GameCreator 对照已交付快照和当前内容，由管理者确认后保存。

## 权限与反馈类型

| 权限 | 反馈 intent | 用途 |
| --- | --- | --- |
| `progress` | `progress` | 报告开发结果、实际日期和制作进度 |
| `review` | `review` | 提交验收结论，接收完成状态仍需确认 |
| `propose` | `propose` | 建议调整分工或排期，追加建议记录 |
| `spec_change` | `spec_change` | 建议修改任务说明、验收标准 |
| `project_write` | `project_change` | 修改已有项目内容及计划字段 |

`project_write` 是独立的项目权限，不是 intent。它要求长期开发者令牌、项目操作范围和至少一个启用岗位。新建开发者选择制作人岗位时默认预选此权限，其他岗位不默认拥有。现有身份和旧令牌不自动扩权；可在“开发者与令牌 → 编辑开发者”显式授权，旧版任务令牌还需更换为长期令牌。

人员、岗位授权、令牌、任务归属和处理历史不属于项目内容修改范围。将负责人文字改为某人的名称，也不会授予该人权限。撤销权限后，即使凭证文件尚未更新，原令牌也不能继续提交或应用被收回权限的修改。

## 操作流程

1. 在人员分配中配置权限。`spec_change` 可以只授权已分配任务或岗位范围，不需要项目修改权限。
2. 在引擎设置重新同步开发协作。工程获得 `project-changes.md`、当前内容快照和新版签名工具。
3. 开发者先阅读 `gamecreator/project-standards.md` 和当前需求，填写完整的新值、修改原因 `reason` 和影响 `impact`。基于新快照的反馈还需填写 `compatibility` 的复用、修改、新增、归档方案，使用私有凭证签名提交。详见 [项目规范](project-standards.md)。
4. 在“开发反馈”查看基准、当前值和建议值。双方同时改动同一字段时，逐项选择保留当前内容或采用反馈。
5. 勾选“已评估变更内容与影响”，采纳需求建议或应用项目修改；也可拒绝。两种修改均不参与“一键应用反馈”。
6. 保存后各编辑模块立即重新读取内容；处理记录保留原因、影响、身份、前后值和决定。任务详情同时显示需求与验收变更记录。再次同步后，开发者以新快照继续工作。

`spec_change` 只修改目标任务的 `description` 和 `acceptance`。采纳建议不会把任务标为已完成，也不替代验收结论。

## 项目修改覆盖范围

| 模块 ID | 内容 |
| --- | --- |
| `project` | 项目概览 |
| `project-schedule` | 任务、里程碑的说明和计划字段 |
| `gameplay` / `gameplay-core` | 玩法设计、玩法核心 |
| `prototype-design` | 原型设计 |
| `task-flows` | 任务与流程 |
| `numerical-analysis` | 数值分析 |
| `functional-systems` | 功能系统说明 |
| `development-tools` | 开发工具需求 |
| `art-assets` | 素材制作文档 |
| `stories` / `story-orchestration` | 故事文档、故事编排 |
| `map-design` | 地图设计 |
| `program-framework` | 程序框架 |
| `definitions` | 数据表定义 |
| `enum-versions` | `data` 下的开发配置数据 |

当前支持已有条目的字段修改，新增和删除条目仍在 GameCreator 界面操作。允许修改计划日期、优先级、负责人文字、依赖和里程碑归属；任务方向、工作授权、关联引用及完成状态单独管理。工具与素材的制作、交付、验收结果沿用进度反馈和任务验收，不能通过替换整个对象绕过。

开发配置修改不会更新稳定版本、发布历史或枚举历史，也不直接写入游戏的运行配置。配置发布与导出继续经过原有数据校验和同步流程。

## 项目字段协议

读取 `gamecreator/context/content/<模块ID>.json` 的 `value`。反馈 `target.kind` 为 `module`，`target.id` 为上表模块 ID。`changes` 的键是相对于 value 的字段路径，值是 `JSON.stringify(新值)` 得到的文本。

- 普通属性：`/description`。
- 按稳定 ID 定位列表记录：`/tasks/@真实任务ID/acceptance`。
- 只有 key 的记录使用 `@key`，禁止数组下标定位，避免重排后改错条目。
- 属性名称包含 `~` 或 `/` 时，分别转义为 `~0` 或 `~1`。
- 每条反馈只修改一个模块，最多 40 个字段，不能同时修改父字段和子字段。
- 字符串新值也要使用 JSON 编码，例如 `"/description": "\"新的项目说明\""`。对象、数组和数值同样编码。

完整可复制的 JSON 模板随每次同步写入 `gamecreator/project-changes.md`，带有该项目的 ID、引擎和快照编号。目标条目 ID 必须从真实上下文复制，每次反馈使用新的 UUID。

```shell
node gamecreator/submit-feedback.cjs <私有凭证文件> <反馈草稿.json> gamecreator/feedback
```

签名覆盖变更内容、原因和影响。未签名内容不能通过这两个入口修改项目。

## 保存与恢复

预览与最终保存均检查当前身份、权限、项目、反馈文件和存档版本。新的外部修改使旧预览失效，需重新读取比较。

正式项目修改可能同时更新内容模块和排期中的审计记录。主进程先记录已确认事务，再保存各存档；中断后重新读取开发反馈可完成恢复。如果恢复前存档又被其他编辑改变，会停止恢复并保留内容，提示恢复备份后重试。恢复完成前阻止其他反馈应用、协作导出和项目导出。

反馈 UUID 防止重复应用；工程回执写入失败时可以补写，项目内的处理记录仍是依据。私钥不会随项目、内容快照或文档导出。

## 开发与验证

`src/project-content-model.ts` 复用编辑器的项目包校验器，生成供主进程使用的 `desktop/project-content-model.cjs`。修改被引用的模型或校验器后运行：

```shell
node scripts/build-project-content-model.mjs
npm run build
node --test tests/project-change-feedback.test.mjs tests/ai-developers.test.mjs tests/engine-feedback.test.mjs
node tests/desktop-project-changes.cjs
```

构建时检查生成文件是否与源码一致。测试覆盖权限分离、显式采纳/拒绝、冲突、跨模块修改、绕过限制、顺序重排、权限撤回、部分保存恢复、批量跳过及桌面刷新。所有测试使用临时项目。
