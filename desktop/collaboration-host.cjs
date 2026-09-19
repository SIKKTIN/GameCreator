const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { fork } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');

function requestJson(url, route, token, method = 'GET', timeout = 1800) {
  return new Promise((resolve, reject) => {
    const request = http.request(url + route, { method, agent: false, headers: token ? { 'X-GameCreator-Host-Token': token } : {} }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 65536) { response.destroy(); reject(new Error('服务器状态响应过大')); }
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try { resolve({ status: response.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch { reject(new Error('该端口未返回有效的协作服务状态')); }
      });
    });
    request.on('error', reject);
    request.setTimeout(timeout, () => request.destroy(new Error('服务器状态查询超时')));
    request.end();
  });
}

function createCollaborationHost({ root, directory = path.join(root, '.gamecreator/collaboration'), port = 4747, nodeExecutable = 'node' }) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('协作服务器端口必须在 1024–65535 之间');
  const dataDirectory = path.resolve(directory), url = `http://127.0.0.1:${port}`;
  const recordPath = path.join(dataDirectory, '.host-runtime.json'), logPath = path.join(dataDirectory, 'host.log');
  let operation = Promise.resolve();
  const serial = callback => {
    const next = operation.then(callback, callback); operation = next.catch(() => {}); return next;
  };
  const record = () => {
    try {
      if (fs.statSync(recordPath).size > 65536) return null;
      const value = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
      return value.schema === 1 && value.url === url && value.directory === dataDirectory && /^[a-f0-9]{64}$/.test(value.token) && typeof value.ownerId === 'string' ? value : null;
    } catch { return null; }
  };
  const base = { url, port, configuredDataDirectory: dataDirectory, dataDirectory: null, startedAt: null, background: true };
  const status = async () => {
    const owned = record();
    if (owned) {
      try {
        const response = await requestJson(url, '/api/host/status', owned.token);
        if (response.status === 200 && response.data.ownerId === owned.ownerId && response.data.service === 'gamecreator-host') {
          return { ...base, state: response.data.stopping ? 'stopping' : 'running', managed: true,
            dataDirectory, startedAt: response.data.startedAt, message: '本机协作服务器正在后台运行' };
        }
      } catch { /* An old ownership record is not authority over the current port. */ }
    }
    try {
      const response = await requestJson(url, '/api/team/health');
      if (response.status === 200 && response.data.service === 'gamecreator-collaboration') {
        return { ...base, state: 'external', managed: false, message: '检测到已有协作服务。它由终端或其他程序启动，本客户端不控制其停止。' };
      }
      return { ...base, state: 'unavailable', managed: false, message: `端口 ${port} 已被其他服务占用，请先关闭占用程序。` };
    } catch (error) {
      if (error.code === 'ECONNREFUSED') return { ...base, state: 'stopped', managed: false, message: '服务器尚未启动' };
      return { ...base, state: 'unavailable', managed: false, message: `无法确认端口 ${port} 的服务状态：${error.message}` };
    }
  };
  const start = () => serial(async () => {
    const existing = await status();
    if (existing.state === 'running' || existing.state === 'external') return existing;
    if (existing.state !== 'stopped') throw new Error(existing.message);
    fs.mkdirSync(dataDirectory, { recursive: true });
    const token = randomBytes(32).toString('hex'), ownerId = randomUUID();
    const env = { ...process.env, GAMECREATOR_TEAM_DATA_DIR: dataDirectory, GAMECREATOR_TEAM_PORT: String(port),
      GAMECREATOR_HOST_TOKEN: token, GAMECREATOR_HOST_OWNER: ownerId };
    delete env.ELECTRON_RUN_AS_NODE;
    const descriptor = fs.openSync(logPath, 'a');
    try {
      await new Promise((resolve, reject) => {
        const child = fork(path.join(root, 'server/collaboration-worker.cjs'), [], {
          execPath: nodeExecutable, execArgv: [], cwd: root, env, detached: true, windowsHide: true, stdio: ['ignore', descriptor, descriptor, 'ipc'],
        });
        let settled = false;
        const finish = error => {
          if (settled) return; settled = true; clearTimeout(timer);
          child.removeListener('exit', exited);
          if (child.connected) child.disconnect(); child.unref();
          if (error) reject(error); else resolve();
        };
        const exited = code => finish(new Error(`服务器启动失败（退出码 ${code}）。请检查 Node.js 版本和服务日志：${logPath}`));
        const timer = setTimeout(() => {
          // Only terminate the child created by this attempt; never look up and kill by port or PID.
          child.kill(); finish(new Error(`服务器启动超时，请检查日志：${logPath}`));
        }, 15000);
        child.once('error', error => finish(new Error(error.code === 'ENOENT' ? '未找到 Node.js，请安装 Node.js 24.11 或更新版本后重启客户端。' : error.message)));
        child.once('exit', exited);
        child.on('message', message => {
          if (message?.type === 'ready' && message.ownerId === ownerId) finish();
          else if (message?.type === 'error') finish(new Error(message.message));
        });
      });
    } catch (error) {
      // A second administrator may have won the same-port startup race.
      const current = await status(); if (current.state === 'running' || current.state === 'external') return current;
      throw error;
    } finally { fs.closeSync(descriptor); }
    const current = await status();
    if (current.state !== 'running') throw new Error('服务未通过启动后的状态检查，请刷新状态后重试。');
    return current;
  });
  const stop = () => serial(async () => {
    const current = await status();
    if (current.state === 'stopped') return current;
    const owned = record();
    if (!current.managed || !owned) throw new Error('本客户端只能停止通过服务器管理启动的服务，不能停止终端或其他程序的服务。');
    const response = await requestJson(url, '/api/host/stop', owned.token, 'POST', 3000);
    if (response.status !== 200 || response.data.ownerId !== owned.ownerId) throw new Error('服务器停止请求未被确认，请刷新状态。');
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      const next = await status(); if (next.state === 'stopped' || !next.managed) return next;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    return { ...current, state: 'stopping', message: '服务器正在完成请求并关闭数据库，请稍后刷新。' };
  });
  return { status, start, stop };
}
module.exports = { createCollaborationHost };
