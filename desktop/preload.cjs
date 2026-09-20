const { contextBridge, ipcRenderer } = require('electron');
function storageRequest(operation, key, value) {
  const result = ipcRenderer.sendSync('workspace-storage', { operation, key, value });
  if (!result?.ok) throw new Error(result?.error || '本地存档服务无响应');
  return result.value;
}
contextBridge.exposeInMainWorld('desktopClient', {
  platform: 'electron', localFiles: true,
  collaborationHost: {
    status: () => ipcRenderer.invoke('collaboration-host', 'status'),
    start: () => ipcRenderer.invoke('collaboration-host', 'start'),
    stop: () => ipcRenderer.invoke('collaboration-host', 'stop'),
  },
  storage: { getItem: key => storageRequest('get', key), setItem: (key, value) => storageRequest('set', key, value), info: key => storageRequest('info', key) },
  artFiles: {
    importFiles: workspaceId => ipcRenderer.invoke('art-files-import', workspaceId),
    readPreview: (workspaceId, storagePath) => ipcRenderer.invoke('art-files-preview', { workspaceId, storagePath }),
    reveal: (workspaceId, storagePath) => ipcRenderer.invoke('art-files-reveal', { workspaceId, storagePath }),
  },
  projectPackages: {
    exportFolder: input => ipcRenderer.invoke('project-package-export', input),
    chooseImport: () => ipcRenderer.invoke('project-package-choose-import'),
    restoreAssets: input => ipcRenderer.invoke('project-package-restore-assets', input),
    release: token => ipcRenderer.invoke('project-package-release', token),
  },
  pickProjectDirectory: () => ipcRenderer.invoke('pick-project-directory'),
  validateProjectLocation: input => ipcRenderer.invoke('validate-project-location', input),
  prepareTestWorkspace: scenario => ipcRenderer.invoke('prepare-test-workspace', scenario),
  writeMarkdown: (filename, content) => ipcRenderer.invoke('write-markdown', { filename, content }),
});
