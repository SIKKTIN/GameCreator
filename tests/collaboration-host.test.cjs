const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const vm = require('node:vm');
const { createCollaborationHost } = require('../desktop/collaboration-host.cjs');
const { createCollaborationServer } = require('../server/collaboration.cjs');
const root = path.resolve(__dirname, '..');
const freePort = async () => {
  const listener = http.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve)); return port;
};
const waitUntil = async check => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('Timed out waiting for managed server shutdown');
};

test('managed service survives manager recreation, deduplicates start, protects stop and preserves data on restart', async () => {
  const prefix = path.join(os.tmpdir(), 'gamecreator-host-'), directory = fs.mkdtempSync(prefix), port = await freePort();
  const options = { root, directory, port, nodeExecutable: process.execPath };
  const host = createCollaborationHost(options); const url = `http://127.0.0.1:${port}`;
  let external;
  const request = (route, token, method = 'GET', body) => fetch(url + route, { method, headers: { Authorization: 'Bearer ' + (token || ''), 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const login = async () => (await (await request('/api/team/login', '', 'POST', { username:'alice', password:'alice123' })).json()).token;
  try {
    assert.equal((await host.status()).state, 'stopped');
    const [first, second] = await Promise.all([host.start(), host.start()]);
    assert.equal(first.state, 'running'); assert.equal(first.startedAt, second.startedAt); assert.equal(first.dataDirectory, directory);
    const recordPath = path.join(directory, '.host-runtime.json'), record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    assert.ok(!JSON.stringify(first).includes(record.token));
    const reopened = createCollaborationHost(options); assert.equal((await reopened.status()).managed, true);
    const token = await login();
    const story = (await (await request('/api/team/projects/team-demo/stories/world', token)).json()).story;
    assert.equal((await request('/api/team/projects/team-demo/stories/world', token, 'PUT', { ...story, content:'后台服务持久化验证' })).status, 200);
    assert.equal((await request('/api/host/stop', token, 'POST')).status, 403, 'A project login cannot stop the host');
    assert.equal((await fetch(url + '/api/host/stop', { method:'POST', headers:{'X-GameCreator-Host-Token':'f'.repeat(64)} })).status, 403);
    assert.equal((await fetch(url + '/api/host/stop', { method:'POST', headers:{'X-GameCreator-Host-Token':'bad'} })).status, 403);
    const stopped = await reopened.stop(); assert.equal(stopped.state, 'stopped');
    await waitUntil(() => !fs.existsSync(recordPath));
    assert.ok(fs.existsSync(path.join(directory, 'team.sqlite')));
    assert.equal((await reopened.start()).state, 'running');
    const restored = (await (await request('/api/team/projects/team-demo/stories/world', await login())).json()).story;
    assert.equal(restored.content, '后台服务持久化验证');
    await reopened.stop(); await waitUntil(() => !fs.existsSync(recordPath));
    // External services are detected and reused, never stopped or silently taken over.
    external = await createCollaborationServer({ directory: path.join(directory,'external'), port });
    const state = await reopened.start(); assert.equal(state.state, 'external'); assert.equal(state.dataDirectory, null);
    await assert.rejects(reopened.stop(), /不能停止/);
    assert.equal((await request('/api/team/health')).status, 200);
    await external.close(); external = null;
    const occupied = http.createServer((_request,response) => response.end('another application'));
    await new Promise(resolve => occupied.listen(port,'127.0.0.1',resolve));
    try {
      const untouched = path.join(directory,'must-not-be-created'), otherHost = createCollaborationHost({ ...options, directory:untouched });
      assert.equal((await otherHost.status()).state,'unavailable'); await assert.rejects(otherHost.start()); assert.equal(fs.existsSync(untouched),false);
    } finally { await new Promise(resolve => occupied.close(resolve)); }
    const missing = createCollaborationHost({ ...options, nodeExecutable:path.join(directory,'missing-node.exe') });
    await assert.rejects(missing.start(), /未找到 Node.js/);
  } finally {
    if (external) await external.close();
    if ((await host.status()).managed) await host.stop();
    await waitUntil(() => !fs.existsSync(path.join(directory, '.host-runtime.json')));
    assert.ok(path.resolve(directory).startsWith(path.resolve(prefix))); fs.rmSync(directory, { recursive:true, force:true });
  }
});

test('local service control needs no account and still rejects untrusted IPC frames and arbitrary operations', async () => {
  const handlers = new Map(), listeners = new Map(), calls = [];
  const electron = { app:{requestSingleInstanceLock:()=>true,on(){},setPath(){},whenReady:()=>new Promise(()=>{})}, BrowserWindow:class{}, shell:{}, session:{}, dialog:{},
    ipcMain:{on:(name,handler)=>listeners.set(name,handler),handle:(name,handler)=>handlers.set(name,handler)} };
  const context = { process, URL, __dirname:path.join(root,'desktop'), require:name => {
    if (name==='electron') return electron;
    if (name==='./collaboration-host.cjs') return {createCollaborationHost:()=>Object.fromEntries(['status','start','stop'].map(operation=>[operation,async()=>{calls.push(operation);return {state:'running'};}]))};
    if (name.startsWith('./')) return require(path.join(root,'desktop',name));
    return require(name);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(root,'desktop/main.cjs'),'utf8')+'\nglobalThis.setWindow=(w,s)=>{mainWindow=w;localServer=s;};',context);
  const frame = {url:'http://127.0.0.1:43210/'}, contents = {mainFrame:frame}; context.setWindow({webContents:contents},{url:'http://127.0.0.1:43210'});
  const trusted = {sender:contents,senderFrame:frame};
  assert.equal(listeners.has('local-auth'),false);
  await assert.rejects(handlers.get('collaboration-host')({sender:contents,senderFrame:{url:frame.url}},'start'), /不允许/);
  await assert.rejects(handlers.get('collaboration-host')(trusted,{operation:'start',command:'arbitrary'}), /未知/);
  await handlers.get('collaboration-host')(trusted,'start'); assert.deepEqual(calls,['start']);
  await handlers.get('collaboration-host')(trusted,'stop');assert.deepEqual(calls,['start','stop']);
  frame.url='https://untrusted.example/';await assert.rejects(handlers.get('collaboration-host')(trusted,'start'),/不允许/);
  frame.url='http://127.0.0.1:43210/';await assert.rejects(handlers.get('collaboration-host')({sender:{mainFrame:frame},senderFrame:frame},'start'),/不允许/);
});
