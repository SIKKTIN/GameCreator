const path = require('node:path');
const { spawn } = require('node:child_process');
const { createCollaborationServer } = require('../server/collaboration.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const directory = process.env.GAMECREATOR_TEAM_DATA_DIR || path.join(root, '.gamecreator/collaboration');
  let service;
  try { service = await createCollaborationServer({ directory }); }
  catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    throw new Error('4747 端口已被占用。请先关闭已有协作服务，再运行本机双客户端演示。');
  }
  const children = new Set();
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return; shuttingDown = true;
    for (const child of children) child.kill();
    await service.close();
  };
  try {
    for (const account of ['alice', 'bob']) {
      const env = { ...process.env, GAMECREATOR_TEAM_ACCOUNT: account,
        GAMECREATOR_USER_DATA_DIR: path.join(root, '.gamecreator/team-clients', account, 'profile'),
        GAMECREATOR_DATA_DIR: path.join(root, '.gamecreator/team-clients', account, 'data') };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(require('electron'), [path.join(root, 'desktop/main.cjs')], { cwd: root, env, stdio: 'ignore' });
      children.add(child);
      child.once('error', error => { console.error('客户端启动失败：', error.message); void shutdown(); });
      child.once('exit', () => { children.delete(child); if (!children.size) void shutdown(); });
    }
  } catch (error) { await shutdown(); throw error; }
  console.log(`协作服务已启动：${service.url}\n已打开 Alice 和 Bob 两个客户端。登录本机工作区后，在自动打开的连接窗口点击“连接并进入项目”。\n共享数据：${directory}\n关闭两个客户端后，演示服务自动停止。`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void shutdown(); });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
