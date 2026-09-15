const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopClient', { platform: 'electron', localFiles: true, writeMarkdown: (filename, content) => ipcRenderer.invoke('write-markdown', { filename, content }) });
