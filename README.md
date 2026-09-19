# GameCreator

GameCreator 是一个面向游戏内容和数据配置的本地客户端。当前包含项目切换、项目概览、玩法设计、功能系统、美术资产、故事文档、数据配置、Lua 枚举扫描、稳定版本审核，以及管理员/用户登录。

## 启动

```powershell
npm install
npm run dev       # 浏览器开发模式
npm run desktop   # Electron 本地客户端
```

本机多人协作验证：运行 `npm run collaboration:demo`，打开 Alice 和 Bob 两个客户端。本地和团队项目共用左上角项目列表及故事编辑页，支持完整故事导入、共享编辑、冲突提示、本机草稿和修改历史。普通客户端可从项目列表选择“连接团队服务器”。详见 [多人协作验证](docs/collaboration.md)。

本机管理员登录后，可在左侧“管理”分组进入独立的“服务器管理”模块，启动本机协作服务、查看状态、复制地址或停止服务；本机 user 账号不显示该模块。通过此入口启动的服务会在关闭客户端后继续后台运行；重新打开客户端仍可管理。当前仅支持本机连接，需要 Node.js 24.11 或更新的兼容版本。

默认本地账号：

| 账号 | 密码 | 角色 |
| --- | --- | --- |
| `admin` | `admin123` | 管理员 |
| `user` | `user123` | 用户 |

## 项目切换

点击左上角项目名称，可切换已有项目。管理员可使用“新建项目”，只填写名称即可创建并切换到空白项目，先编写介绍、故事和配置数据。需要连接游戏工程时，再到“引擎设置”填写工程目录与枚举目录并点击“保存设置”。各项目的内容和引擎设置独立保存，后续修改目录不会更换项目存档，重启恢复上次选择。

详细操作见 [项目切换与独立存档](docs/project-switching.md)。管理员还可从项目菜单导出完整的普通文件夹，再从文件夹导入为独立项目，连同美术原始文件和版本历史一起迁移。见 [项目文件夹导出与迁移](docs/project-package.md)。

## 玩法设计

在左侧“玩法设计”创建玩法，逐步填写体验目标、核心循环、规则、原型范围和试玩验证。支持玩法依赖图、全部/任一条件规则、状态流程与手动路径预览，以及可编辑空间布局、事件时间轴与空间联动预览；也可复制、归档、关联故事和配置表，并独立自动保存，无需先连接引擎。详见 [玩法设计](docs/gameplay-design.md)。

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
- [从原型示例创建项目](docs/prototype-examples.md)
- [项目文件夹导出与迁移](docs/project-package.md)
- [分支与原型数据管理](docs/branch-workflow.md)
- [枚举版本审核流程](docs/enum-version-workflow.md)
- [Withdraw 枚举导入说明](docs/withdraw-enum-import.md)
- [本地客户端](docs/desktop-client.md)
- [AI 文档导出](docs/ai-export.md)
- [本地数据持久化与旧版迁移](docs/persistence.md)
- [Space 测试面板](docs/test-panel.md)


功能系统用于整理程序职责、共用能力和玩法需求引用，支持系统/功能目录、依赖图、配置引用和双向跳转。详见 [功能系统](docs/functional-systems.md)。

## 美术资产

管理美术需求、玩法与功能来源、交付文件、版本审核与当前采用素材。创建只需名称，占位素材可先用于原型验证，正式交付需通过审核。详见 [美术资产](docs/art-assets.md)。

## 原型示例

[三套完整设计快照](examples/prototypes/README.md)保存空洞骑士、星露谷和植物大战僵尸原型的玩法、功能系统、美术需求、资产台账及引用数据。管理员可从左上角项目列表选择“从原型示例创建项目”，只填写名称即可复制为独立本地项目；已有项目不会被覆盖，重复创建也互相独立。操作与保存规则见 [原型示例](docs/prototype-examples.md)。示例独立于本机存档，可以使用 `node scripts/validate-prototype-examples.mjs` 校验。
