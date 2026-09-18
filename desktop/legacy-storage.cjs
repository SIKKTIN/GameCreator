const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { allowedKey, atomicWrite } = require('./storage.cjs');

// Origins are discovery hints only. Chromium reads the actual values, including
// compressed LevelDB records; never parse or modify the database ourselves.
function discoverOrigins(userData) {
  const directory = path.join(userData, 'Local Storage', 'leveldb');
  if (!fs.existsSync(directory)) return [];
  const origins = new Set();
  for (const filename of fs.readdirSync(directory).filter(name => /\.(log|ldb)$/.test(name))) {
    const bytes = fs.readFileSync(path.join(directory, filename)).toString('latin1');
    for (const match of bytes.matchAll(/http:\/\/127\.0\.0\.1:\d+/g)) {
      const port = Number(match[0].split(':').pop());
      if (port > 0 && port <= 65535) origins.add(match[0]);
    }
  }
  return [...origins].sort();
}
function rankArchive(raw) {
  try {
    const value = JSON.parse(raw);
    if (value.schema !== 1 || !Array.isArray(value.snapshots) || !value.data?.datasets || !value.data?.columns ||
        !Number.isInteger(value.revision) || !value.reviews || !Array.isArray(value.releases)) return null;
    const active = value.snapshots.find(snapshot => snapshot.id === value.activeId && snapshot.kind === 'release');
    if (value.activeId && !active) return null;
    return [active ? 1 : 0, Math.max(0, ...value.snapshots.map(snapshot => Date.parse(snapshot.createdAt) || 0)), value.revision];
  } catch { return null; }
}
function compareRanks(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
function importLegacy(records, storage, backupDirectory) {
  const candidates = new Map();
  for (const record of records) {
    atomicWrite(path.join(backupDirectory, createHash('sha256').update(record.origin).digest('hex') + '.json'),
      JSON.stringify(record, null, 2));
    for (const [key, raw] of Object.entries(record.items)) {
      if (!allowedKey(key) || !key.startsWith('gamecreator.enum-versions.v1:')) continue;
      const rank = rankArchive(raw);
      if (!rank) continue;
      const existing = candidates.get(key);
      if (!existing || compareRanks(rank, existing.rank) > 0) candidates.set(key, { record, raw, rank });
    }
  }
  const selected = [];
  for (const [key, candidate] of candidates) {
    if (storage.getItem(key) !== null) continue;
    storage.setItem(key, candidate.raw);
    selected.push({ key, origin: candidate.record.origin });
  }
  const preferred = [...candidates.values()].sort((a, b) => compareRanks(b.rank, a.rank))[0]?.record ?? records.at(-1);
  for (const key of ['gamecreator.engine-config.v1', 'gamecreator.dataset-definitions.v1']) {
    const raw = preferred?.items[key];
    if (raw && storage.getItem(key) === null) { JSON.parse(raw); storage.setItem(key, raw); }
  }
  return selected;
}
async function migrateLegacy({ userData, dataDirectory, storage, BrowserWindow, session }) {
  const marker = path.join(dataDirectory, 'legacy-migration.json');
  if (fs.existsSync(marker)) return;
  const origins = discoverOrigins(userData);
  const records = [];
  if (origins.length) {
    const originSet = new Set(origins);
    await session.protocol.handle('http', request => new Response(
      originSet.has(new URL(request.url).origin) ? '<!doctype html><title>Local storage migration</title>' : '',
      { status: originSet.has(new URL(request.url).origin) ? 200 : 403, headers: { 'Content-Type': 'text/html' } }));
    const window = new BrowserWindow({ show: false, webPreferences: { session, nodeIntegration: false, contextIsolation: true, sandbox: true } });
    try {
      for (const origin of origins) {
        await window.loadURL(origin + '/__gamecreator_storage_migration__');
        const items = await window.webContents.executeJavaScript(`Object.fromEntries(Object.keys(localStorage)
          .filter(key => key.startsWith('gamecreator.') && key !== 'gamecreator.auth.session')
          .map(key => [key, localStorage.getItem(key)]))`);
        if (Object.keys(items).length) records.push({ origin, items });
      }
    } finally { window.destroy(); session.protocol.unhandle('http'); }
  }
  const selected = importLegacy(records, storage, path.join(dataDirectory, 'legacy-backups'));
  atomicWrite(marker, JSON.stringify({ schema: 1, migratedAt: new Date().toISOString(), origins: records.map(record => record.origin), selected }, null, 2));
}
module.exports = { discoverOrigins, rankArchive, importLegacy, migrateLegacy };
