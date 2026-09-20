# 项目文件夹导出与迁移

管理员在桌面客户端左上角项目菜单中使用 **导出项目到文件夹**，选择保存位置。软件会在所选位置下建立以项目名称命名的新文件夹；已有同名文件夹不会被覆盖。再次备份时请选择另一个位置或先重命名旧备份。

复制整个文件夹到另一台电脑，打开客户端，选择 **从文件夹导入项目**，选中包含 `manifest.json` 的文件夹。预览内容、填写名称后点击“导入并打开”。每次导入均创建独立的本地项目，不覆盖或合并已有项目。

## 文件夹格式

```text
项目名称/
├─ manifest.json
├─ README.md
├─ data/
│  ├─ project.json
│  ├─ project-schedule.json
│  ├─ project-info.json
│  ├─ gameplay.json
│  ├─ gameplay-core.json
│  ├─ prototype-design.json
│  ├─ task-flows.json
│  ├─ story-orchestration.json
│  ├─ map-design.json
│  ├─ functional-systems.json
│  ├─ art-assets.json
│  ├─ definitions.json
│  ├─ stories.json
│  ├─ milestones.json
│  ├─ enum-versions.json
│  └─ data-view.json       # 原项目有视图偏好时包含
└─ assets/                # 所有美术交付版本的原始文件
```

`manifest.json` 记录格式版本、文件列表、大小和 SHA-256 校验值。所有文件引用均在此目录内。`project.json` 保存便携项目设置，`project-info.json` 保存项目概览信息。不要只复制 JSON 而漏掉 `assets`，也不要直接手改文件后忽略校验；请在客户端导入、编辑后重新导出。

## 包含的内容

- 项目概览、里程碑与故事文档。
- 项目排期的制作任务、计划与实际日期、负责人、前置依赖、内容来源与验收记录；旧包缺少排期时从包内里程碑恢复，详见[项目排期](project-schedule.md)。
- 玩法设计，以及依赖、条件规则、状态流程、空间布局和时间轴。
- 玩法核心、原型场景与交互、任务与阶段流程。
- 故事编排的启用状态、正文、条件、检定与后果；关闭的模块也保留内容，旧包缺少此部分时默认为关闭。
- 功能系统、能力、依赖和配置引用。
- 配置表定义与记录、枚举稳定版、候选版、审核及发布历史。
- 美术需求、资产台账、全部交付版本、审核与采用关系，以及每版的实际原始文件。
- 已保存的数据配置视图偏好。

工作状态和内部引用保持原样。未解决的设计问题随项目迁移，可在导入后继续编辑。游戏工程本身不属于 GameCreator 项目存档，不会自动复制；外部工程路径在便携设置中清空，自动同步关闭。新电脑请在“引擎设置”重新连接工程，历史枚举快照仍可查看。

导出读取已保存内容，检查导出前后存档是否变化。美术文件缺失、文件被更改、校验失败或格式版本不受支持时会报错。导入在内容和文件校验完成后才将新项目加入列表。写入失败时原项目保持不变，重试会创建新的独立身份；未发布成功的临时身份不会在项目列表中出现。

当前入口用于正式本地项目；团队项目仅按已接入的协作模块共享，测试工作区不作为正式项目导出。浏览器开发模式无此本地文件夹接口。

## 本地批量归档

仓库根目录 `ProjectCache/` 用于本机导出归档，已被 Git 忽略。当前五套原型分别保存到 `ProjectCache/空洞骑士/`、`ProjectCache/星露谷物语/`、`ProjectCache/植物大战僵尸/`、`ProjectCache/极乐迪斯科/`、`ProjectCache/吸血鬼幸存者/`。这些目录是当时的完整快照，不会随之后的编辑自动更新。

也可在 Node.js 24 环境中执行：

```powershell
node scripts/export-project-folder.mjs --project "完整项目名或 ID" --output "ProjectCache/新的归档目录"
```

命令默认只读本仓库 `.gamecreator` 的当前已保存项目，不改变项目列表或源存档。可以通过 `--data-dir` 指定其他本地存档目录。输出目录必须尚不存在。

只读检查导出文件夹，并在临时目录验证完整恢复、原始文件与重新打开后的内容：

```powershell
node scripts/verify-project-folder.mjs "ProjectCache/空洞骑士"
```
