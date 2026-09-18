const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

function allowedKey(key) {
  return typeof key === 'string' && (['gamecreator.engine-config.v1', 'gamecreator.dataset-definitions.v1', 'gamecreator.test-session.v1', 'gamecreator.projects.v1'].includes(key) ||
    ['gamecreator.enum-versions.v1:', 'gamecreator.workspace.v1:'].some(prefix => key.startsWith(prefix) && key.length > prefix.length));
}
function atomicWrite(filename, content) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = filename + '.' + randomUUID() + '.tmp';
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx');
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, filename);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
function createStorage(directory) {
  const filename = key => {
    if (!allowedKey(key)) throw new Error('不支持的存档键');
    return path.join(directory, createHash('sha256').update(key).digest('hex') + '.json');
  };
  const getItem = key => {
    let raw;
    try { raw = fs.readFileSync(filename(key), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const record = JSON.parse(raw);
    if (record.schema !== 1 || record.key !== key || typeof record.value !== 'string') throw new Error('磁盘存档格式异常，已停止写入');
    return record.value;
  };
  return {
    directory, getItem,
    info(key) {
      const file = filename(key);
      return { directory, file, modifiedAt: fs.existsSync(file) ? fs.statSync(file).mtime.toISOString() : null };
    },
    setItem(key, value) {
      if (typeof value !== 'string') throw new Error('存档必须是字符串');
      JSON.parse(value);
      const previous = getItem(key); // Never overwrite a corrupt existing archive.
      const file = filename(key);
      if (previous !== null) atomicWrite(file + '.bak', fs.readFileSync(file, 'utf8'));
      atomicWrite(file, JSON.stringify({ schema: 1, key, value }, null, 2));
    },
  };
}
module.exports = { allowedKey, atomicWrite, createStorage };
