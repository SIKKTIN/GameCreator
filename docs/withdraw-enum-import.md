# Withdraw 引擎设置与 Lua 枚举导入分析

更新：已接入候选扫描、差异审核、选择性发布与稳定版本机制。操作说明见 [枚举版本审核与稳定发布](enum-version-workflow.md)。下方导入规则保留为背景设计。

## 本次配置

- 项目目录：`E:/WeGameApps/rail_apps/OasisEraEditor(2001776)/ShadowTrackerExtra/UGCProjects/Withdraw`
- 枚举目录：`Script/Const`，相对于项目目录，递归扫描 `.lua` 文件。
- 已修改 `src/main.tsx` 中引擎设置的默认路径。
- 已实现配置持久化、本地扫描接口、静态解析、只读预览及共享枚举字段绑定；枚举写回与数据生成仍未实现。

## 现有程序的接入点

GameCreator 当前是 React + Vite 前端。本地开发服务通过 Vite middleware 提供工程扫描接口；生产静态部署仍需要配套本地服务。

`src/main.tsx` 中：

- `engineConfig` 使用 `localStorage` 持久化，刷新后会恢复项目目录和枚举目录。
- `useEnumRegistry` 在 App 中统一扫描，三个页面共享同一快照和重新扫描操作。失败保留上次结果并标记待同步；切换路径取消旧请求。
- `EnginePanels.tsx` 展示连接信息、8 组枚举、成员来源/行号、注释、排序表、动态 ID 和已绑定字段。
- `DataConfiguration.tsx` 的字段管理可按 `enumId` 选择真实 Lua 枚举；旧示例字段保留原有选项，需逐个迁移。
- `data-model.ts` 校验空值、枚举成员和跨表引用；删除成员或整组枚举后重扫即可提示受影响记录，原值保留。
- 字段定义、数据草稿与枚举版本按项目路径写入浏览器本地存档，刷新后恢复；尚未写入工程磁盘文件。
- 绑定字段存储成员键；通过 `resolveEnumValue` 从注册表解析原始 number/string 值，详情面板展示实际值、类型和来源。
- 逻辑回归测试：Node 24 执行 `node --test tests/enum-bindings.test.mjs`。

读取、解析、共享枚举状态和字段绑定已经接通。DebugKit 投影适配与 Lua 数据生成按后续步骤推进。

## 目录中的实际定义

以下文件路径均相对于 `Script/Const`。当前共 4 个文件、8 组可直接导入的静态枚举、27 个成员。

| 文件 | 枚举名 | 值类型 | 成员数 |
| --- | --- | --- | ---: |
| `Core/Const_DebugKit.lua` | `Const_DebugKit.LineType` | string | 2 |
| `Data/Const_Data.lua` | `Const_Data.PLAYER_DATA_TYPE` | string | 8 |
| `Data/Const_Data.lua` | `Const_Data.GAME_DATA_TYPE` | string | 1 |
| `Package/Enemy/Const_Enemy.lua` | `Const_Enemy.Type` | string | 3 |
| `Package/Enemy/Const_Enemy.lua` | `Const_Enemy.ID` | string | 2 |
| `Package/GameMode/Const_GameMode.lua` | `Const_GameMode.ModeID` | number | 4 |
| `Package/GameMode/Const_GameMode.lua` | `Const_GameMode.MapID` | string | 4 |
| `Package/GameMode/Const_GameMode.lua` | `Const_GameMode.EvacuationMethod` | string | 3 |

### 需要单独处理的表

1. `Const_Data.PLAYER_DATA_TYPE_ORDER` / `GAME_DATA_TYPE_ORDER`
   - 是枚举键名组成的数组，作为相应枚举的展示顺序，不新增枚举。
   - 校验键名存在、无重复；遗漏的成员按源码顺序追加并提示。
2. `Const_DebugKit.Lines`
   - 是记录表，成员包含 `id`、`name`、`type`，不直接当作扁平枚举。
3. `Const_DebugKit.ID`
   - 初始化为 `{}`，随后通过 `Const_DebugKit.ID[key] = line.id` 在循环中填充。
   - 第一版应提示“运行时生成，暂未导入”，不能报告为空枚举或已同步。
   - 后续可为该模块配置显式投影规则：从 `Lines` 的成员键和 `id` 字段生成只读枚举，`name` 用作显示标签。对应结果为 `LIFECYCLE = 1001`、`PLAYER_LIFECYCLE = 1002`、`ENEMY_DEATH = 1003`。
   - 投影规则应记录来源和派生关系，不把任意循环解释为枚举生成规则；完成该适配后总计 9 组、30 个成员。

## 推荐导入流程

### 1. 由本地服务读取工程

为当前 Vite 开发应用增加本地 Node 服务接口，负责验证工程目录和递归读取 `Script/Const/**/*.lua`。后续桌面壳或独立服务可复用相同读取模块；单独部署静态网页时仍需要本地读取能力。

- 测试连接：验证目录存在、可读，找到 `Withdraw.ugcproj`，返回枚举目录和文件数。
- 同步定义：读取文件并返回解析结果、文件位置与诊断信息。
- 将规范化后的项目目录作为读取范围，枚举路径必须落在该范围内；只开放需要的本地接口。
- 设置后续保存在 GameCreator 工作区配置文件中，包括项目路径、相对枚举目录和适配器规则。
- 枚举读取流程不需要修改 Withdraw 文件。

### 2. 静态分析 Lua 语法树

建议使用 JavaScript 的 Lua 解析器，将源码转换为语法树（AST），按语法结构读取定义。[luaparse](https://github.com/fstirlitz/luaparse) 提供 AST、注释、位置和源码区间，可作为候选；本次未添加依赖。

针对当前 4 个文件，识别以下结构：

```lua
local Const_GameMode = {}
Const_GameMode.ModeID = {
    HALL = 1001,
    LEVEL_1 = 1002,
}
return Const_GameMode
```

- 跟踪顶层声明、赋值以及返回的模块对象，避免把函数局部变量识别成导出定义。
- 接受非空、有名称键、所有值均为字符串或数字的扁平表；第一版要求组内类型一致。
- 支持 `KEY = value` 和 `["KEY"] = value` 两种键写法。
- 保存声明顺序、枚举注释、成员注释和源文件行号。
- 对后续赋值和动态修改进行检查；被循环或不支持表达式修改的表标记为待处理，不能只导入早期赋值而声称是完整结果。
- 函数、调用、条件分支和循环不执行。不能解析的枚举给出明确原因。
- 嵌套记录表、数组、模块根空表不作为普通枚举导入。
- 必须处理 Lua 字符串转义和 UTF-8；`luaparse` 默认编码模式下字符串节点的 `value` 为 `null`，不能直接当作有效字符串读取。实现时应明确字节解码策略，并验证中文和转义字符。

这组规则覆盖当前所有静态枚举，也能明确报告 DebugKit 的动态 ID。没有必要加载 Lua 虚拟机执行整个工程。

### 3. 建立共享枚举注册表

每组枚举保留模块路径和成员路径，不能只用 `Type` 或 `ID` 作为唯一名称。建议数据形状：

```json
{
  "id": "Script.Const.Package.GameMode.Const_GameMode#ModeID",
  "name": "Const_GameMode.ModeID",
  "module": "Script.Const.Package.GameMode.Const_GameMode",
  "memberPath": "ModeID",
  "source": "Script/Const/Package/GameMode/Const_GameMode.lua",
  "valueType": "number",
  "description": "引擎多模式 ID，用于 UGCMultiMode 查询和匹配。",
  "members": [
    { "key": "HALL", "value": 1001 },
    { "key": "LEVEL_1", "value": 1002 },
    { "key": "LEVEL_2", "value": 1003 },
    { "key": "LEVEL_3", "value": 1004 }
  ]
}
```

`key` 是代码成员名，`value` 是实际值，注释/标签只是展示信息。比如 `MapID.HALL` 的实际值是 `"Hall"`；`ModeID.HALL` 的实际值是数字 `1001`，两者不能混用。

注册表按工程隔离，记录同步时间和诊断；路径变化后将旧结果标记为过期。成功扫描以新快照替换，包含删除的定义；解析失败时保留上一份成功结果并明确标记过期，避免界面误报成功。

### 4. 接入枚举页与数据字段

- 枚举页显示真实来源、值类型、成员名、实际值、注释及未导入项的原因。
- 字段管理中选择已导入枚举，以 `enumId` 绑定共享注册表；字段定义需提升到项目级状态。
- 下拉框展示成员名和实际值，保留未知旧值并显示校验错误。
- 数据记录保存成员键或有类型的值，不能依赖目前全为字符串的 `DataRecord` 推测数字类型。
- Lua 导出可根据模块及成员键生成 `require` 和常量引用。Withdraw 的 `Script/Config/Package/GameMode/Config_GameMode.lua` 已使用 `ModeID` / `MapID` 引用，可沿用该风格。
- 枚举删除、重命名或值变化后，重新检查绑定字段；遇到失效成员阻止相关配置导出并定位记录。

## 实施顺序与验收

1. 设置持久化与本地工程连接：两个路径保存后可恢复，“测试连接”能列出 4 个 Lua 文件，错误目录有反馈。
2. 静态解析与只读预览：得到 8 组、27 个成员；识别排序数组，提示动态 ID，显示来源和注释。
3. 共享注册表与字段绑定：数据编辑器使用真实枚举并保留 number/string 类型，删除成员能触发校验。
4. DebugKit 投影适配：经显式规则得到第 9 组、3 个 ID；校验重复 ID 和缺失字段。
5. 再接数据生成：当前输出目录仍是原型默认值 `Scripts/Configs`，Withdraw 实际已有 `Script/Config` 和 `Script/Data`；应按要生成的数据类型确定落点，避免直接使用原型路径。

解析器验证应覆盖实际 4 个文件，以及字符串转义、数字/字符串区分、同名成员、数组与记录表排除、动态赋值、语法错误和同步删除。路径配置修改本身通过 TypeScript 与 Vite 构建检查即可。
