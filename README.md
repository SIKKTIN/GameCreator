# GameCreator

GameCreator 是一个面向游戏内容和数据配置的本地客户端。当前包含项目概览、故事文档、数据配置、Lua 枚举扫描、稳定版本审核，以及管理员/用户登录。

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

- [枚举版本审核流程](docs/enum-version-workflow.md)
- [Withdraw 枚举导入说明](docs/withdraw-enum-import.md)
- [本地客户端](docs/desktop-client.md)
- [AI 文档导出](docs/ai-export.md)
