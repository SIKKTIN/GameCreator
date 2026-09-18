const {app,BrowserWindow} = require('electron');
const http = require('node:http');
app.setPath('userData', process.env.GAMECREATOR_USER_DATA_DIR);
let server;
app.whenReady().then(async () => {
  server=http.createServer((req,res)=>res.end('<!doctype html><title>Legacy fixture</title>'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
  await win.loadURL('http://127.0.0.1:'+server.address().port+'/');
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>server?.close());
