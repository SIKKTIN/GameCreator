# 多引擎接入：绿洲启元与 Godot

## 使用

在“引擎设置”选择“绿洲启元 · Lua”或“Godot 4 · GDScript”。Godot 选择包含 `project.godot` 的工程根目录，枚举目录默认 `.`（整个工程），也可填写 `scripts` 或 `res://scripts`。保存后生成扫描候选；在“枚举管理 → 枚举更新检测”选择同意/不同意，再同步到枚举定义。

连接是本地文件识别和静态枚举扫描，不依赖运行 Godot 编辑器。可以留空工程目录继续设计项目。不会执行 `.gd`/Lua 脚本，不会修改外部工程文件。

## 当前范围

- Godot 4.x GDScript 命名枚举、匿名枚举、内部类作用域；注释与来源行号。
- 自动编号，显式正负十进制、十六进制、二进制整数及数字分隔符；支持 Godot 重复数值的别名。
- 扫描 `.gd`，跳过 `.godot`、`.git` 和目录符号链接。根目录与扫描目录经过路径范围验证。
- 忽略字符串/多行字符串/注释里的伪枚举。
- 常量引用、运算表达式、函数调用、超过 JavaScript 精确整数范围的值、无法识别的声明会记录具体文件/行号。任意枚举未能解析时整个候选标记为不完整，不能发布，以免错误提议的删除进入定义。
- 匿名枚举用所属类及首个成员区分；改变首个成员可能表现为整组删除/新增，仍须审核。
- 不包括 C#、`@export_enum` 属性提示、场景导入、启动编辑器、工程生成。JSON 仅为 Godot 预留输出格式，数据文件导出和自动同步仍标记“待接入”。

## 配置与身份

引擎 ID 为 `oasis-lua` / `godot-gdscript`。原配置字段继续有效，可选 `profiles` 按引擎保存工程/枚举/输出目录、格式和同步选项。切换修改草稿，保存后生效；当前项目 ID、设计文档和配置表身份不变。旧 Lua 项目的已有输出格式原样保留。

扫描快照可选 `engine`、`incomplete`；缺少 engine 的历史记录按绿洲启元理解。Godot 枚举组带 engine，字段绑定 ID 为 `godot:<工程内脚本路径>#<完整枚举名>`。Lua 原 ID 算法保持不变。

引擎、工程路径或扫描目录改变后取消旧扫描，不展示/操作其他来源的候选，也不继承其他来源或不完整扫描的审核决定。已发布定义仍保留并显示旧来源提示。审核可以保留被引用的旧枚举；若版本含其他引擎的枚举，界面明确提示检查绑定，不自动替换数据值。

若新旧来源的枚举内容完全一致，点击“确认使用此枚举来源”创建有历史记录的新稳定版本，保留全部配置数据。来源相同时不能重复确认。

## 文件夹迁移

导出/导入保存引擎类型、相对目录、配置档案、完整枚举历史与字段绑定。所有引擎配置档案的外部绝对工程路径都清空，自动同步关闭；历史快照保留来源位置用于追溯。新电脑须重新选择实际工程。项目包仍为原 schema，未新增必需模块。

## 实现与验证

- `shared/engine-config.mjs`：引擎描述、配置/来源校验、可迁移配置。
- `server/engine-adapters.mjs`：统一工程识别与扫描分派，桌面 IPC、桌面 HTTP、Vite 使用同一路径。
- `server/godot-enum-parser.mjs`：只读 GDScript 枚举解析。
- `npm run test:engine`：解析、来源切换、绑定、旧配置兼容、真实 Vite/桌面 API、真实文件夹往返。
- `npm run build` 后运行 `node tests/desktop-godot-engine.cjs`、`node tests/desktop-enum-review.cjs`、`node tests/desktop-project-switching.cjs`。桌面测试使用隔离临时项目；Playwright 可通过 `GAMECREATOR_PLAYWRIGHT_PATH` 指定。

参考：[Godot 文件系统](https://docs.godotengine.org/en/stable/tutorials/scripting/filesystem.html)、[GDScript 枚举](https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/gdscript_basics.html#enums)。

## 工程内容交付

文档与已采用素材可通过引擎设置的同步分页交付到工程，包含范围选择、变更预览、冲突处理、备份与记录。参见 [工程内容同步](engine-content-sync.md)。配置表 JSON 输出仍未接入。
