const path = require('node:path');
const { app, BrowserWindow, shell, ipcMain, session, dialog } = require('electron');
const { createDesktopServer } = require('./server.cjs');
const { createWorkspaceStorage, prepareTestWorkspace } = require('./test-workspaces.cjs');
const { validateProjectLocation } = require('./project-locations.cjs');
const { migrateLegacy } = require('./legacy-storage.cjs');
const { createArtFiles, validateWorkspaceId } = require('./art-files.cjs');
const { createProjectPackages, safeProjectDirectoryName } = require('./project-package.cjs');
const { createCollaborationHost } = require('./collaboration-host.cjs');
const { createAiDocuments } = require('./ai-documents.cjs');

const root = path.resolve(__dirname, '..');
const dataDirectory = process.env.GAMECREATOR_DATA_DIR || path.join(root, '.gamecreator');
if (process.env.GAMECREATOR_USER_DATA_DIR) app.setPath('userData', process.env.GAMECREATOR_USER_DATA_DIR);
const storage = createWorkspaceStorage(dataDirectory);
const artFiles = createArtFiles(dataDirectory);
const projectPackages = createProjectPackages({dataDirectory, storage});
const aiDocuments = createAiDocuments({defaultDirectory:path.join(root,'generate')});
const packageTokens = new Map();
let localServer, mainWindow;
let initializing = true;
if (!app.requestSingleInstanceLock()) app.quit();
else {
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
  ipcMain.handle('collaboration-host', async (event, operation) => {
    if (!trusted(event)) throw new Error('不允许管理本机服务器');
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
    if (!trusted(event)) throw new Error('不允许导入素材文件');
    validateWorkspaceId(workspaceId);
    const requestingWindow = mainWindow;
    const result = await dialog.showOpenDialog(requestingWindow, {
      title: '导入素材文件', properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || !result.filePaths.length) return null;
    if (mainWindow !== requestingWindow || !trusted(event)) throw new Error('原工作区窗口已关闭，请重新导入');
    return artFiles.importFiles(workspaceId, result.filePaths);
  });
  ipcMain.handle('art-files-preview', async (event, payload) => {
    if (!trusted(event)) throw new Error('不允许读取素材文件');
    return artFiles.readPreview(payload?.workspaceId, payload?.storagePath);
  });
  ipcMain.handle('art-files-reveal', async (event, payload) => {
    if (!trusted(event)) throw new Error('不允许定位素材文件');
    const requestingWindow = mainWindow;
    await artFiles.reveal(payload?.workspaceId, payload?.storagePath, filename => {
      if (mainWindow !== requestingWindow || !trusted(event)) throw new Error('原工作区窗口已关闭，未打开文件夹');
      shell.showItemInFolder(filename);
    });
  });
  ipcMain.handle('project-package-export', async (event, payload) => {
    if (!trusted(event)) throw new Error('不允许导出本地项目');
    const requestingWindow = mainWindow;
    const result = await dialog.showOpenDialog(requestingWindow, {title: '选择项目导出位置（将在其中创建项目文件夹）', properties: ['openDirectory', 'createDirectory']});
    if (result.canceled || !result.filePaths.length) return null;
    if (mainWindow !== requestingWindow || !trusted(event)) throw new Error('原工作区窗口已关闭，请重新导出');
    return projectPackages.exportFolder({projectId: payload?.projectId, document: payload?.document, expectedEntries: payload?.expectedEntries,
      directory: path.join(result.filePaths[0], safeProjectDirectoryName(payload?.document?.project?.name))});
  });
  ipcMain.handle('project-package-choose-import', async event => {
    if (!trusted(event)) throw new Error('不允许导入本地项目');
    const requestingWindow = mainWindow;
    const result = await dialog.showOpenDialog(requestingWindow, {title: '选择包含 manifest.json 的项目文件夹', properties: ['openDirectory']});
    if (result.canceled || !result.filePaths.length) return null;
    if (mainWindow !== requestingWindow || !trusted(event)) throw new Error('原工作区窗口已关闭，请重新导入');
    const prepared = await projectPackages.prepareImport(result.filePaths[0]);
    if (mainWindow !== requestingWindow || !trusted(event)) { projectPackages.release(prepared.token); throw new Error('原工作区窗口已关闭，请重新导入'); }
    packageTokens.set(prepared.token, event.sender);
    return prepared;
  });
  ipcMain.handle('project-package-restore-assets', async (event, payload) => {
    if (!trusted(event) || packageTokens.get(payload?.token) !== event.sender) throw new Error('不允许恢复此项目文件夹');
    return projectPackages.restoreAssets({token: payload.token, projectId: payload.projectId});
  });
  ipcMain.handle('project-package-release', (event, token) => {
    if (!trusted(event) || packageTokens.get(token) !== event.sender) throw new Error('不允许释放此项目文件夹');
    projectPackages.release(token); packageTokens.delete(token);
  });
  ipcMain.handle('ai-documents-options', event => {
    if(!trusted(event))throw new Error('不允许读取导出设置');
    return {defaultDirectory:path.join(root,'generate')};
  });
  ipcMain.handle('ai-documents-choose-directory', async (event, initial) => {
    if(!trusted(event))throw new Error('不允许选择保存位置');
    const requestingWindow=mainWindow;
    const result=await dialog.showOpenDialog(requestingWindow,{title:'选择 AI 文档保存位置',defaultPath:typeof initial==='string'&&path.isAbsolute(initial)?initial:undefined,properties:['openDirectory','createDirectory']});
    if(mainWindow!==requestingWindow||!trusted(event))throw new Error('原工作区窗口已关闭，请重新选择');
    return result.canceled?null:result.filePaths[0]??null;
  });
  ipcMain.handle('ai-documents-export', (event,payload) => {
    if(!trusted(event))throw new Error('不允许生成文档');
    return aiDocuments.exportFolder(payload);
  });
  ipcMain.handle('ai-documents-reveal', async (event,token) => {
    if(!trusted(event))throw new Error('不允许打开文件夹');
    const requestingWindow=mainWindow,directory=await aiDocuments.resolveDirectory(token);
    if(mainWindow!==requestingWindow||!trusted(event))throw new Error('原工作区窗口已关闭');
    const error=await shell.openPath(directory);if(error)throw new Error(error);
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
    mainWindow.on('closed', () => {
      for (const token of packageTokens.keys()) { try { projectPackages.release(token); } catch {} }
      packageTokens.clear(); mainWindow = null;
    });
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
