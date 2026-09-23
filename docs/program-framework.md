# 程序框架

本地项目主导航中的“程序框架”提供离线规范库和项目采用方案。团队项目尚未接入该模块的共享编辑，入口标记为未接入。

## 内置规范

内置“通用游戏项目框架 v1.0”全部 19 份文档，支持目录、正文搜索、Markdown 表格与代码阅读、内部文档跳转、复制以及完整 ZIP 下载。原文只读，所有项目共用同一版本；项目差异填写在采用方案中。

文档源位于 `frameworks/package-core-v1/`。运行 `node scripts/build-framework-library.mjs` 生成客户端可离线加载的固定内容；`--check` 检查是否与源一致。发布新的规范契约时，应增加独立版本和迁移策略，不静默替换已采用版本的含义。

## 项目采用方案

默认未采用，运行模式为单机，不强制已有项目遵循新的架构。采用后包含基础规范、开发规范和通用引擎接入原则，可独立选择存档、集中数据管理、声明装配和联机扩展。单机模式不能选联机；从多人切回单机时移除联机选项。绿洲补充只有明确选择且当前引擎为绿洲时才进入导出。

取消采用保留扩展选择及项目约定。全部参考文档仍可阅读，示例、迁移说明和未选扩展不会作为 AI 实现要求自动导出。

## 保存、迁移与输出

采用方案自动保存到当前项目的 `program-framework` 存档，与其他项目隔离。冲突或写入失败保留草稿，提供备份、重试和重新读取；有未保存草稿时阻止项目切换和正式导出。损坏或未知版本不会被空默认值覆盖，旧项目缺少存档时使用未采用状态。

完整项目文件夹包含此存档，导入后恢复选择和约定。AI 总文档、独立“程序框架”模块文件、引擎文档同步使用同一份采用内容，保留内置版本和项目运行模式。未采用时仅输出状态与项目约定。完整参考库可以通过页面“下载规范包”获得。

全局搜索支持内置规范和本项目约定；从结果打开时保留返回上下文，普通导航不显示返回搜索结果。

## 验证

```powershell
node scripts/build-framework-library.mjs --check
npm run build
node --test tests/program-framework.test.mjs tests/project-package.test.mjs tests/project-package-files.test.cjs tests/ai-document-export.test.mjs tests/global-search.test.mjs tests/engine-sync.test.cjs
node tests/desktop-program-framework.cjs
```

桌面测试使用独立临时数据，覆盖阅读、搜索、采用与扩展、项目隔离、重启、AI 导出、ZIP 下载、损坏存档和保存失败。Playwright 可通过 `GAMECREATOR_PLAYWRIGHT_PATH` 指定。

## 配置数据交付规范

开发规范目录新增《配置数据管理与同步规范》，作为 GameCreator 数据交付参考，不改变 Package/Core 1.0 的已采用架构契约。该约定仅在使用数据同步管理配置时适用。

生成 AI 文档时，总文档和 `模块/config-data-policy.md` 附带同一份规范及当前保存的引擎、工程根目录、数据目录和输出格式。开启引擎文档同步时，固定交付到文档目录下的 `config-data-policy.md`，由 README 索引；不依赖是否选择程序框架模块，也不依赖框架采用状态。关闭文档同步不会写入或删除该文件。

源文档统一维护在 `frameworks/package-core-v1/开发规范/03_配置数据管理与同步规范.md`；项目路径由 `shared/config-data-policy.mjs` 生成。路径未配置、无效或当前格式不是 JSON 时会明确提示，不自动移动游戏工程文件。
