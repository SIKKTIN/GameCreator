# GameCreator

GameCreator 是一个面向游戏内容和数据配置的本地客户端。当前包含项目切换、项目概览、玩法设计、故事文档、数据配置、Lua 枚举扫描、稳定版本审核，以及管理员/用户登录。

## 启动

```powershell
npm install
npm run dev       # 浏览器开发模式
npm run desktop   # Electron 本地客户端
```

默认本地账号：

| 账号 | 密码 | 角色 |
| --- | --- | --- |
| `admin` | `admin123` | 管理员 |
| `user` | `user123` | 用户 |

## 项目切换

点击左上角项目名称，可切换已有项目。管理员可使用“新建项目”，只填写名称即可创建并切换到空白项目，先编写介绍、故事和配置数据。需要连接游戏工程时，再到“引擎设置”填写工程目录与枚举目录并点击“保存设置”。各项目的内容和引擎设置独立保存，后续修改目录不会更换项目存档，重启恢复上次选择。

详细操作见 [项目切换与独立存档](docs/project-switching.md)。

## 玩法设计

在左侧“玩法设计”创建玩法，逐步填写体验目标、核心循环、规则、原型范围和试玩验证。支持玩法依赖图、全部/任一条件规则、状态流程与手动路径预览；也可复制、归档、关联故事和配置表，并独立自动保存，无需先连接引擎。详见 [玩法设计](docs/gameplay-design.md)。

## 调试 MCP

项目提供一个无需额外依赖的 stdio MCP 调试服务：

```powershell
npm run mcp:debug
```

在 MCP 客户端配置：

```json
{
  "mcpServers": {
    "gamecreator-debug": {
      "command": "node",
      "args": ["E:/Project/GameCreator/mcp/debug-server.mjs"]
    }
  }
}
```

可用工具：

- `inspect_path`：检查工程目录、枚举目录和 Lua 文件数量。
- `scan_const_directory`：解析 Lua 枚举，返回组数、成员数、排序数组和动态 ID 提示。

## 文档

- [玩法设计](docs/gameplay-design.md)

- [项目切换与独立存档](docs/project-switching.md)
- [枚举版本审核流程](docs/enum-version-workflow.md)
- [Withdraw 枚举导入说明](docs/withdraw-enum-import.md)
- [本地客户端](docs/desktop-client.md)
- [AI 文档导出](docs/ai-export.md)
- [本地数据持久化与旧版迁移](docs/persistence.md)
- [Space 测试面板](docs/test-panel.md)
