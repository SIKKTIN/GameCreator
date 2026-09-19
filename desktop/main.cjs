const path = require('node:path');
const { app, BrowserWindow, shell, ipcMain, session, dialog } = require('electron');
const fs = require('node:fs/promises');
const { createDesktopServer } = require('./server.cjs');
const { createWorkspaceStorage, prepareTestWorkspace } = require('./test-workspaces.cjs');
const { validateProjectLocation } = require('./project-locations.cjs');
const { migrateLegacy } = require('./legacy-storage.cjs');
const { createArtFiles, validateWorkspaceId } = require('./art-files.cjs');
const { createLocalAuth } = require('./local-auth.cjs');
const { createCollaborationHost } = require('./collaboration-host.cjs');

const root = path.resolve(__dirname, '..');
const dataDirectory = process.env.GAMECREATOR_DATA_DIR || path.join(root, '.gamecreator');
if (process.env.GAMECREATOR_USER_DATA_DIR) app.setPath('userData', process.env.GAMECREATOR_USER_DATA_DIR);
const storage = createWorkspaceStorage(dataDirectory);
const artFiles = createArtFiles(dataDirectory);
let localServer, mainWindow;
let initializing = true;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  const localAuth = createLocalAuth();
  let collaborationHost;
  const host = () => collaborationHost ??= createCollaborationHost({ root,
    directory: process.env.GAMECREATOR_TEAM_DATA_DIR || path.join(root, '.gamecreator/collaboration'),
    port: Number(process.env.GAMECREATOR_TEAM_PORT || 4747), nodeExecutable: process.env.GAMECREATOR_NODE_PATH || 'node' });
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
  const trusted = event => {
    try {
      if (!mainWindow || mainWindow.isDestroyed?.() || event.sender?.isDestroyed?.()) return false;
      const frame = event.senderFrame;
      return !!frame && event.sender === mainWindow.webContents && frame === mainWindow.webContents.mainFrame &&
        new URL(frame.url).origin === localServer?.url;
    } catch { return false; } // An IPC frame may detach while a native dialog is open.
  };
  ipcMain.on('local-auth', (event, request) => {
    try {
      if (!trusted(event)) throw new Error('不允许访问本机登录');
      if (request?.operation === 'session') event.returnValue = { ok: true, value: localAuth.current() };
      else if (request?.operation === 'login') event.returnValue = { ok: true, value: localAuth.login(request.input) };
      else if (request?.operation === 'logout') { localAuth.logout(); event.returnValue = { ok: true }; }
      else throw new Error('未知本机登录操作');
    } catch (error) { event.returnValue = { ok: false, error: error.message }; }
  });
  ipcMain.handle('collaboration-host', async (event, operation) => {
    if (!trusted(event)) throw new Error('不允许管理本机服务器');
    localAuth.requireAdmin();
    if (!['status', 'start', 'stop'].includes(operation)) throw new Error('未知服务器管理操作');
    return host()[operation]();
  });
  ipcMain.on('workspace-storage', (event, request) => {
    try {
      if (!trusted(event)) throw new Error('不允许访问本地存档');
      if (request?.operation === 'get') event.returnValue = { ok: true, value: storage.getItem(request.key) };
      else if (request?.operation === 'set') { storage.setItem(request.key, request.value); event.returnValue = { ok: true }; }
      else if (request?.operation === 'info') event.returnValue = { ok: true, value: storage.info(request.key) };
      else throw new Error('未知存档操作');
    } catch (error) { event.returnValue = { ok: false, error: error.message }; }
  });
  ipcMain.handle('pick-project-directory', async event => {
    if (!trusted(event)) throw new Error('不允许选择工程目录');
    const result = await dialog.showOpenDialog(mainWindow, { title: '选择游戏工程目录', properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('validate-project-location', async (event, input) => {
    if (!trusted(event)) throw new Error('不允许检查工程目录');
    return validateProjectLocation(input?.projectPath, input?.enumPath);
  });
  ipcMain.handle('prepare-test-workspace', async (event, scenario) => {
    if (!trusted(event)) throw new Error('不允许创建测试工程');
    return prepareTestWorkspace(root, dataDirectory, scenario);
  });
  ipcMain.handle('art-files-import', async (event, workspaceId) => {
    if (!trusted(event)) throw new Error('不允许导入美术文件');
    validateWorkspaceId(workspaceId);
    const requestingWindow = mainWindow;
    const result = await dialog.showOpenDialog(requestingWindow, {
      title: '导入美术文件', properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    if (mainWindow !== requestingWindow || !trusted(event)) throw new Error('原工作区窗口已关闭，请重新导入');
    return artFiles.importFiles(workspaceId, result.filePaths);
  });
  ipcMain.handle('art-files-preview', async (event, payload) => {
    if (!trusted(event)) throw new Error('不允许读取美术文件');
    return artFiles.readPreview(payload?.workspaceId, payload?.storagePath);
  });
  ipcMain.handle('art-files-reveal', async (event, payload) => {
    if (!trusted(event)) throw new Error('不允许定位美术文件');
    const requestingWindow = mainWindow;
    await artFiles.reveal(payload?.workspaceId, payload?.storagePath, filename => {
      if (mainWindow !== requestingWindow || !trusted(event)) throw new Error('原工作区窗口已关闭，未打开文件夹');
      shell.showItemInFolder(filename);
    });
  });
  ipcMain.handle('write-markdown', async (event, payload) => {
    if (!trusted(event)) throw new Error('不允许写入文件');
    const filename = String(payload?.filename ?? 'context.md').replace(/[^a-zA-Z0-9._-]/g, '_');
    const outputDir = path.join(root, 'generate');
    await fs.mkdir(outputDir, { recursive: true });
    const output = path.join(outputDir, filename);
    await fs.writeFile(output, String(payload?.content ?? ''), 'utf8');
    return output;
  });
  async function createWindow() {
    if (!localServer) localServer = await createDesktopServer({ root });
    mainWindow = new BrowserWindow({
      width: 1440, height: 920, minWidth: 1100, minHeight: 700, backgroundColor: '#11121c',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url) && new URL(url).origin !== localServer.url) shell.openExternal(url);
      return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== localServer.url) event.preventDefault(); });
    mainWindow.on('closed', () => { mainWindow = null; });
    const teamAccount = process.env.GAMECREATOR_TEAM_ACCOUNT;
    await mainWindow.loadURL(localServer.url + '/' + (teamAccount ? '?team=' + encodeURIComponent(teamAccount) : ''));
  }
  app.whenReady().then(async () => {
    await migrateLegacy({ userData: app.getPath('userData'), dataDirectory, storage, BrowserWindow, session: session.defaultSession });
    await createWindow();
    initializing = false;
  }).catch(error => {
    dialog.showErrorBox('本地存档加载失败', '未覆盖现有数据。请检查磁盘空间和存档目录权限后重试。\n' + error.message);
    app.quit();
  });
  app.on('window-all-closed', () => { if (!initializing && process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => { if (localServer) localServer.server.close(); });
  app.on('activate', () => { if (!initializing && !mainWindow) void createWindow(); });
}
