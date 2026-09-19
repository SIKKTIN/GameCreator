// A detached Node process keeps the collaboration service alive after Electron exits.
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const { createCollaborationServer } = require('./collaboration.cjs');
  const directory = path.resolve(process.env.GAMECREATOR_TEAM_DATA_DIR);
  const token = process.env.GAMECREATOR_HOST_TOKEN, ownerId = process.env.GAMECREATOR_HOST_OWNER;
  if (!/^[a-f0-9]{64}$/.test(token || '') || !ownerId) throw new Error('缺少服务器管理凭据');
  const recordPath = path.join(directory, '.host-runtime.json'), startedAt = new Date().toISOString();
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    await service.close();
    // Never remove a newer server's ownership record.
    try { if (JSON.parse(fs.readFileSync(recordPath, 'utf8')).ownerId === ownerId) fs.unlinkSync(recordPath); } catch { /* stale/missing record */ }
    console.log(`[${new Date().toISOString()}] 协作服务已停止`);
    process.exit(0);
  };
  const service = await createCollaborationServer({ directory, port: Number(process.env.GAMECREATOR_TEAM_PORT),
    hostControl: { token, ownerId, startedAt, isStopping: () => stopping, stop: () => { void stop(); } } });
  const record = { schema: 1, url: service.url, directory, token, ownerId, startedAt };
  const temporary = recordPath + '.' + ownerId + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 }); fs.renameSync(temporary, recordPath);
  } catch (error) { await service.close(); try { fs.unlinkSync(temporary); } catch {} throw error; }
  console.log(`[${startedAt}] 协作服务已启动：${service.url}；数据目录：${directory}`);
  if (process.connected) process.send({ type: 'ready', ownerId }, () => {});
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop(); });
}
main().catch(error => {
  console.error(error.message);
  if (process.connected) process.send({ type: 'error', message: error.message }, () => process.exit(1));
  else process.exit(1);
});
