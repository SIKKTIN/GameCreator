# 本地客户端

项目现在可以用 Electron 作为本地客户端外壳。界面仍由现有 React/Vite 构建，客户端启动时在回环地址启动一个本地 HTTP 服务，再由 Electron 窗口加载构建产物。工程扫描请求只在本机处理，原有 `Script/Const` 解析和枚举审核流程保持不变。

## 使用

首次使用需要安装依赖：

```powershell
npm install
```

启动本地客户端：

```powershell
npm run desktop
```

开发网页仍可使用：

```powershell
npm run dev
```

客户端入口位于 `desktop/main.cjs`，本地服务位于 `desktop/server.cjs`，预加载脚本位于 `desktop/preload.cjs`。服务只绑定 `127.0.0.1`，并限制静态文件和扫描接口的访问范围。
