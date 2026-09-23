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
  developerCredentials:(operation,input)=>ipcRenderer.invoke('ai-developer',operation,input),
  issueAiCredential:input=>ipcRenderer.invoke('ai-credential-issue',input),
  artFiles: {
    importFiles: workspaceId => ipcRenderer.invoke('art-files-import', workspaceId),
    readPreview: (workspaceId, storagePath) => ipcRenderer.invoke('art-files-preview', { workspaceId, storagePath }),
    reveal: (workspaceId, storagePath) => ipcRenderer.invoke('art-files-reveal', { workspaceId, storagePath }),
  },
  folderProjects: {
    open: () => ipcRenderer.invoke('folder-project','open'),
    create: input => ipcRenderer.invoke('folder-project','create',input),
    verify: id => ipcRenderer.invoke('folder-project','verify',{id}),
  },
  projectPackages: {
    exportFolder: input => ipcRenderer.invoke('project-package-export', input),
    chooseImport: () => ipcRenderer.invoke('project-package-choose-import'),
    restoreAssets: input => ipcRenderer.invoke('project-package-restore-assets', input),
    release: token => ipcRenderer.invoke('project-package-release', token),
  },
  revealProjectData: projectId => ipcRenderer.invoke('reveal-project-data',projectId),
  pickProjectDirectory: () => ipcRenderer.invoke('pick-project-directory'),
  validateProjectLocation: input => ipcRenderer.invoke('validate-project-location', input),
  prepareTestWorkspace: scenario => ipcRenderer.invoke('prepare-test-workspace', scenario),
  engineSync: {
    dataSchemaExport: input => ipcRenderer.invoke('engine-sync-dataSchemaExport',input),
    dataPublish: input => ipcRenderer.invoke('engine-sync-dataPublish',input),
    dataPreview: input => ipcRenderer.invoke('engine-sync-dataPreview',input),
    dataApply: input => ipcRenderer.invoke('engine-sync-dataApply',input),
    dataRecover: input => ipcRenderer.invoke('engine-sync-dataRecover',input),
    dataUndo: input => ipcRenderer.invoke('engine-sync-dataUndo',input),
    dataRelease: input => ipcRenderer.invoke('engine-sync-dataRelease',input),
    feedbackScan: input => ipcRenderer.invoke('engine-sync-feedbackScan',input),
    feedbackApply: input => ipcRenderer.invoke('engine-sync-feedbackApply',input),
    feedbackApplyBatch: input => ipcRenderer.invoke('engine-sync-feedbackApplyBatch',input),
    feedbackRepair: input => ipcRenderer.invoke('engine-sync-feedbackRepair',input),
    binding: input => ipcRenderer.invoke('engine-sync-binding',input),
    rebind: input => ipcRenderer.invoke('engine-sync-rebind',input),
    preview: input => ipcRenderer.invoke('engine-sync-preview',input),
    apply: input => ipcRenderer.invoke('engine-sync-apply',input),
    history: input => ipcRenderer.invoke('engine-sync-history',input),
    recover: input => ipcRenderer.invoke('engine-sync-recover',input),
    release: token => ipcRenderer.invoke('engine-sync-release',token),
  },
  aiDocuments: {
    options: () => ipcRenderer.invoke('ai-documents-options'),
    chooseDirectory: initial => ipcRenderer.invoke('ai-documents-choose-directory', initial),
    exportFolder: input => ipcRenderer.invoke('ai-documents-export', input),
    reveal: token => ipcRenderer.invoke('ai-documents-reveal', token),
  },
});
