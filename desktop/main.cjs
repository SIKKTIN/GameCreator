const path = require('node:path');
const { app, BrowserWindow, shell, ipcMain, session, dialog, clipboard, safeStorage } = require('electron');
const { createDesktopServer } = require('./server.cjs');
const { createWorkspaceStorage, prepareTestWorkspace } = require('./test-workspaces.cjs');
const { validateProjectLocation } = require('./project-locations.cjs');
const { migrateLegacy } = require('./legacy-storage.cjs');
const { createArtFiles, validateWorkspaceId } = require('./art-files.cjs');
const { createProjectPackages, safeProjectDirectoryName } = require('./project-package.cjs');
const { createCollaborationHost } = require('./collaboration-host.cjs');
const { createAiDocuments } = require('./ai-documents.cjs');
const { createFolderProjects } = require('./folder-projects.cjs');
const {issueAiCredential}=require('./ai-credentials.cjs');
const { createEngineSync } = require('./engine-sync.cjs');

const root = path.resolve(__dirname, '..');
const dataDirectory = process.env.GAMECREATOR_DATA_DIR || path.join(root, '.gamecreator');
if (process.env.GAMECREATOR_USER_DATA_DIR) app.setPath('userData', process.env.GAMECREATOR_USER_DATA_DIR);
const folders = createFolderProjects({legacyStorage:createWorkspaceStorage(dataDirectory),dataDirectory});
const storage = folders.storage;
const artFiles = createArtFiles(dataDirectory, {resolveWorkspaceDirectory:folders.assetDirectory});
const projectPackages = createProjectPackages({dataDirectory, storage, resolveAssetDirectory:folders.assetDirectory});
const aiDocuments = createAiDocuments({defaultDirectory:path.join(root,'generate')});
const engineSync = createEngineSync({artFiles,storage});
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
  let developerService;
  const developers=()=>developerService??=require('./ai-developers.cjs').createDeveloperService({storage,vault:require('./ai-credential-vault.cjs').createCredentialVault({directory:path.join(app.getPath('userData'),'ai-credential-vault'),safeStorage})});
  ipcMain.handle('ai-developer',async(event,operation,input)=>{
    if(!trusted(event))throw new Error('不允许管理开发者凭证');
    const api=developers();
    if(['create','update','rotate'].includes(operation))return api.change(operation,input);
    if(operation==='available')return api.available(input);
    if(operation==='revoke')return api.revoke(input);
    if(operation==='copy'){clipboard.writeText(JSON.stringify(api.read(input),null,2));return {copied:true};}
    if(operation==='download'){
      api.read(input);const result=await dialog.showSaveDialog(mainWindow,{title:'保存开发者凭证',defaultPath:'gamecreator-credential-'+String(input.credentialId).replace(/[^a-zA-Z0-9-]/g,'_')+'.json',filters:[{name:'JSON',extensions:['json']}]});
      if(result.canceled||!result.filePath)return null;if(!trusted(event))throw new Error('原工作区已关闭');const secret=api.read(input);require('node:fs').writeFileSync(result.filePath,JSON.stringify(secret,null,2)+'\n',{mode:0o600});return {saved:true};
    }
    if(operation==='import'){
      const result=await dialog.showOpenDialog(mainWindow,{title:'导入已保存的开发者凭证',properties:['openFile'],filters:[{name:'JSON',extensions:['json']}]});if(result.canceled||!result.filePaths.length)return null;if(!trusted(event))throw new Error('原工作区已关闭');const fs=require('node:fs'),file=result.filePaths[0];if(fs.statSync(file).size>32768)throw new Error('凭证文件过大');return api.importSecret(input,JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')));
    }
    throw new Error('未知开发者操作');
  });
  ipcMain.handle('ai-credential-issue',(event,input)=>{if(!trusted(event))throw new Error('不允许签发协作令牌');return issueAiCredential(storage,input);});
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
  ipcMain.handle('folder-project', async (event, operation, payload) => {
    if (!trusted(event)) throw new Error('不允许访问项目文件夹');
    if (operation === 'verify') return folders.verify(payload.id);
    if (operation === 'open') {
      const result = await dialog.showOpenDialog(mainWindow, {title:'打开 GameCreator 项目文件夹',properties:['openDirectory']});
      if (result.canceled || !result.filePaths.length) return null;
      if (!trusted(event)) throw new Error('原工作区已关闭');
      const directory = result.filePaths[0];
      if (!require('node:fs').existsSync(path.join(directory,'project.gamecreator'))) {
        if(!require('node:fs').existsSync(path.join(directory,'manifest.json')))throw new Error('请选择包含 project.gamecreator 的项目文件夹，也支持旧版 manifest.json 文件夹');
        const legacy = await projectPackages.readFolder(directory);
        return folders.upgradeLegacy(directory, legacy.document);
      }
      return folders.open(directory);
    }
    if (operation === 'create') {
      const result = await dialog.showSaveDialog(mainWindow, {title:'保存 GameCreator 项目（创建同名文件夹）',buttonLabel:'保存项目',defaultPath:safeProjectDirectoryName(payload.project.name)});
      if (result.canceled || !result.filePath) return null;
      if (!trusted(event)) throw new Error('原工作区已关闭');
      return folders.create(result.filePath,payload.project,payload.entries,payload.sourceId,payload.expectedEntries);
    }
    throw new Error('未知项目操作');
  });
  ipcMain.handle('reveal-project-data', async (event, projectId) => {
    if(!trusted(event))throw new Error('不允许打开项目数据目录');
    const catalog=JSON.parse(storage.getItem('gamecreator.projects.v1')||'null');
    if(typeof projectId!=='string'||!catalog?.projects?.some(project=>project.id===projectId))throw new Error('本地项目不存在，请刷新项目列表');
    const projectFolder=folders.folder(projectId);
    if(projectFolder){const error=await shell.openPath(projectFolder);if(error)throw new Error(error);return {directory:projectFolder,file:null};}
    const keys=['gamecreator.workspace.v1:'+projectId+':project','gamecreator.enum-versions.v1:'+projectId,
      ...['gameplay','art-assets','stories'].map(section=>'gamecreator.workspace.v1:'+projectId+':'+section)];
    const directory=path.resolve(storage.directory);
    const stat=await require('node:fs/promises').stat(directory).catch(()=>null);
    if(!stat?.isDirectory())throw new Error('项目数据目录不存在或无法访问');
    if(!trusted(event))throw new Error('原工作区窗口已关闭');
    for(const key of keys) {
      const info=storage.info(key);
      if(info.modifiedAt&&path.dirname(path.resolve(info.file))===directory) {
        shell.showItemInFolder(info.file);
        return {directory,file:info.file};
      }
    }
    // A newly created project may only have a catalog entry, without module archives yet.
    const error=await shell.openPath(directory);if(error)throw new Error('打开项目数据目录失败：'+error);
    return {directory,file:null};
  });
  ipcMain.handle('pick-project-directory', async event => {
    if (!trusted(event)) throw new Error('不允许选择工程目录');
    const result = await dialog.showOpenDialog(mainWindow, { title: '选择游戏工程目录', properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('validate-project-location', async (event, input) => {
    if (!trusted(event)) throw new Error('不允许检查工程目录');
    return validateProjectLocation(input?.projectPath, input?.enumPath, input?.engine);
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
  for(const operation of ['preview','apply','history','recover','release','binding','rebind','feedbackScan','feedbackApply','feedbackApplyBatch','feedbackRepair','dataPreview','dataApply','dataRecover','dataUndo','dataRelease'])ipcMain.handle('engine-sync-'+operation,(event,input)=>{
    if(!trusted(event))throw new Error('不允许同步工程文件');
    return engineSync[operation](input);
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
    folders.refreshRecent();
    await createWindow();
    initializing = false;
  }).catch(error => {
    dialog.showErrorBox('本地存档加载失败', '未覆盖现有数据。请检查磁盘空间和存档目录权限后重试。\n' + error.message);
    app.quit();
  });
  app.on('window-all-closed', () => { if (!initializing && process.platform !== 'darwin') app.quit(); });
  app.on('will-quit', () => { folders.close(); if (localServer) localServer.server.close(); });
  app.on('activate', () => { if (!initializing && !mainWindow) void createWindow(); });
}
