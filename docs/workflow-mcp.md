# AI 工作流工具

制作人和其他开发者以引擎工程为工作目录，通过身份凭证连接 GameCreator。设计提交仍由管理项目保存，工程同步把已应用的内容交付回引擎。工具与界面使用同一套内容校验、权限检查、差异预览和同步记录。

## 连接准备

1. 在 GameCreator 保存独立管理项目，配置工程连接和成员授权。
2. 在“项目管理 → 项目内容同步”更新协作文件；在“工程同步”预览并导出成员凭证。
3. 管理项目的 `ai/` 中会生成 `workflow-mcp.cjs`、`WORKFLOW_MCP.md` 和 `mcp.config.example.json`。按示例将 stdio MCP 服务加入 AI 客户端，填入此助手的凭证文件绝对路径。运行环境需要 Node.js 20 或更新版本。
4. 保持 GameCreator 客户端运行。服务端点由软件发布到 `ai/workflow-service.json`，每次调用都会重新读取，重启软件后无需修改端口配置。已登记的项目按 ID 寻址，不要求切换到某个页面或项目。

```json
{
  "mcpServers": {
    "gamecreator": {
      "command": "node",
      "args": ["管理项目绝对路径/ai/workflow-mcp.cjs", "--project", "管理项目绝对路径"],
      "env": {"GAMECREATOR_CREDENTIAL_FILE": "引擎绝对路径/gamecreator/personal/成员ID.json"}
    }
  }
}
```

每个助手配置自己的凭证路径。工具参数与返回结果不携带私钥；凭证在本机适配器中用于签名。具体配置入口由所用 AI 客户端决定；项目内的示例文件本身不会自动注册 MCP 服务。

## 制作人的完整操作顺序

| 工具 | 用途 |
| --- | --- |
| `gc_project_read` | 获取当前版本、模块目录、身份授权和同步配置；用 `modules` 指定读取的内容，`templates: true` 获取模板。 |
| `gc_collaboration_export` | 更新管理项目的协作文件、使用说明、完整规范和设计基准。 |
| `gc_content_validate` | 检查 `draft` 的字段、引用、权限和差异，返回结构化诊断。 |
| `gc_content_submit` | 使用当前身份签名并保存草稿，尚不应用到正式内容。 |
| `gc_content_scan` | 读取待处理提交，获取 `id`、`digest`、`reviewId` 和冲突。 |
| `gc_content_preview` | 对选定提交及冲突选择重新检查。 |
| `gc_content_apply` | 应用检查后的整批设计变更，生成正式处理记录。 |
| `gc_engine_preview` | 使用已保存的同步配置，预览设计文档、协作文件及成员凭证。 |
| `gc_engine_apply` | 使用本开发者的预览 `token` 执行同步。 |
| `gc_operation_status` | 按 `requestId` 查询执行状态和结果。 |
| `gc_history` | 查看内容应用、工程同步和工作流操作记录。 |

写入工具返回 `id`、`status` 和 `result`；例如提交后的条目位于 `result.items`。读取与预览工具直接返回数据。`snapshotId` 是当前内容的基准摘要，必须先经 `gc_collaboration_export` 注册，再用于设计草稿。

新项目先读取现状与规范，建立设计方案，更新协作基准后再次读取 `snapshotId`。草稿结构见 `ai/change-template.json`；将草稿对象传入 `draft` 即可，适配器自动签名。先校验、提交，再读取差异并应用。应用完成后更新协作文件，预览并同步工程。进入引擎制作、试玩与验收后，再通过既有开发反馈流程回写实际结果。

内容冲突按操作 ID 选择 `keep`（保留当前）或 `proposal`（采用提交）。工程冲突按文件路径选择 `keep` 或 `replace`；待移除文件还必须列入 `removals`。工具不会自动选择冲突方案、改变工程归属或提高任务完成状态。

## 权限与并行

长期身份的当前授权在每次调用时重新验证。设计写入需要 `project_write` 及对应模块授权；处理其他人的设计提交还需要 `review`。完整协作文件导出和工程同步需要全部项目模块的写入授权；同步私有成员凭证另需 `team_manage`。人员管理继续使用 `manage-team.cjs`，详见“制作人与团队管理”。这一批工具覆盖设计提交与工程交付，进度/验收反馈处理继续使用现有反馈入口。

多个助手可以分别读取和准备内容；同一项目的服务操作按序提交，工程文件另有写入锁。每个预览绑定项目、开发者和版本；其他人改动内容、授权或配置后，旧预览会被拒绝，需要重新读取差异。编辑器有未保存内容、弹窗或正在执行的操作时，后台写入会返回忙碌信息；成功后编辑器重新读取正式内容。

每项写入必须提供唯一 `requestId`（例如 UUID）。同一请求重试时保持编号及参数不变，返回原执行记录；不要换编号重复提交。超时后先查 `gc_operation_status`。`succeeded` 表示已完成，`failed` 表示执行失败，`running` 在软件异常退出后可能表示结果待核对；先查看内容回执和工程同步历史，再重新预览。相同编号不能用于另一份内容。记录最多保留 10000 次写入，达到上限后停止新增并提示归档。

协议采用 MCP stdio，每行一个 JSON-RPC 消息；标准输出仅用于协议返回。参考：[MCP stdio 规范](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)。
