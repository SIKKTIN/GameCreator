const path = require('node:path');
const { app, BrowserWindow, shell, ipcMain, session, dialog } = require('electron');
const fs = require('node:fs/promises');
const { createDesktopServer } = require('./server.cjs');
const { createWorkspaceStorage, prepareTestWorkspace } = require('./test-workspaces.cjs');
const { validateProjectLocation } = require('./project-locations.cjs');
const { migrateLegacy } = require('./legacy-storage.cjs');

const root = path.resolve(__dirname, '..');
const dataDirectory = process.env.GAMECREATOR_DATA_DIR || path.join(root, '.gamecreator');
if (process.env.GAMECREATOR_USER_DATA_DIR) app.setPath('userData', process.env.GAMECREATOR_USER_DATA_DIR);
const storage = createWorkspaceStorage(dataDirectory);
let localServer, mainWindow;
let initializing = true;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  });
  const trusted = event => mainWindow && event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame && new URL(event.senderFrame.url).origin === localServer?.url;
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
    await mainWindow.loadURL(localServer.url + '/');
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
