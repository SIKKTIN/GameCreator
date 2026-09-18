const { contextBridge, ipcRenderer } = require('electron');
function storageRequest(operation, key, value) {
  const result = ipcRenderer.sendSync('workspace-storage', { operation, key, value });
  if (!result?.ok) throw new Error(result?.error || '本地存档服务无响应');
  return result.value;
}
contextBridge.exposeInMainWorld('desktopClient', {
  platform: 'electron', localFiles: true,
  storage: { getItem: key => storageRequest('get', key), setItem: (key, value) => storageRequest('set', key, value), info: key => storageRequest('info', key) },
  pickProjectDirectory: () => ipcRenderer.invoke('pick-project-directory'),
  validateProjectLocation: input => ipcRenderer.invoke('validate-project-location', input),
  prepareTestWorkspace: scenario => ipcRenderer.invoke('prepare-test-workspace', scenario),
  writeMarkdown: (filename, content) => ipcRenderer.invoke('write-markdown', { filename, content }),
});
