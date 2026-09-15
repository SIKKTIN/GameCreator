const path = require('node:path');
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const { createDesktopServer } = require('./server.cjs');

let localServer;
ipcMain.handle('write-markdown', async (_event, payload) => {
  const filename = String(payload?.filename ?? 'context.md').replace(/[^a-zA-Z0-9._-]/g, '_');
  const outputDir = path.resolve(__dirname, '..', 'generate');
  await fs.mkdir(outputDir, { recursive: true });
  const output = path.join(outputDir, filename);
  await fs.writeFile(output, String(payload?.content ?? ''), 'utf8');
  return output;
});
async function createWindow() {
  localServer = await createDesktopServer({ root: path.resolve(__dirname, '..') });
  const window = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1100, minHeight: 700,
    backgroundColor: '#11121c',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  window.webContents.setWindowOpenHandler(({ url }) => { if (!url.startsWith('http://127.0.0.1:')) shell.openExternal(url); return { action: 'deny' }; });
  await window.loadURL('http://127.0.0.1:' + localServer.port + '/');
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (localServer) localServer.server.close(); if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
