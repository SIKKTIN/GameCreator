const path = require('node:path');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 12 * 1024 * 1024;
const FILE_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,12}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const comparable = value => process.platform === 'win32' ? value.toLowerCase() : value;
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;

function validateWorkspaceId(value) {
  if (typeof value !== 'string' || value.length > 1100 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('素材文件工作区标识无效');
  const match = /^(project|test):(.+)$/.exec(value);
  if (!match || match[2] !== match[2].trim() || match[2].length > 1024 || (match[1] === 'test' && !UUID.test(match[2]))) throw new Error('素材文件工作区标识无效');
  // Project IDs may be a legacy normalized project path. They are hashed as opaque IDs, never resolved as paths.
  return value;
}
function workspaceHash(value) { return createHash('sha256').update(validateWorkspaceId(value)).digest('hex'); }
function sniffMime(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_HEADER)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return 'image/gif';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 4 && bytes.toString('ascii', 0, 4) === '8BPS') return 'image/vnd.adobe.photoshop';
  if (bytes.length >= 7 && bytes.toString('ascii', 0, 7) === 'BLENDER') return 'application/x-blender';
  return 'application/octet-stream';
}
function validDimensions(width, height) { return width > 0 && height > 0 && width <= 16384 && height <= 16384 && width * height <= 40_000_000; }
function validImage(bytes, mime) {
  if (mime === 'image/png') {
    if (bytes.length < 45 || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR' || !validDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20))) return false;
    let offset = 8, hasData = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
      if (end > bytes.length) return false;
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (type === 'IDAT') hasData = true;
      if (type === 'IEND') return hasData && length === 0 && end === bytes.length;
      offset = end;
    }
    return false;
  }
  if (mime === 'image/gif') {
    if (bytes.length < 14 || !validDimensions(bytes.readUInt16LE(6), bytes.readUInt16LE(8))) return false;
    let offset = 13 + ((bytes[10] & 0x80) ? 3 * (2 ** ((bytes[10] & 7) + 1)) : 0), hasImage = false;
    const skipBlocks = () => {
      while (offset < bytes.length) {
        const length = bytes[offset++];
        if (!length) return true;
        offset += length;
        if (offset > bytes.length) return false;
      }
      return false;
    };
    while (offset < bytes.length) {
      const type = bytes[offset++];
      if (type === 0x3b) return hasImage && offset === bytes.length;
      if (type === 0x21) { if (offset >= bytes.length) return false; offset++; if (!skipBlocks()) return false; }
      else if (type === 0x2c) {
        if (offset + 9 > bytes.length || !validDimensions(bytes.readUInt16LE(offset + 4), bytes.readUInt16LE(offset + 6))) return false;
        const packed = bytes[offset + 8]; offset += 9;
        if (packed & 0x80) offset += 3 * (2 ** ((packed & 7) + 1));
        if (offset >= bytes.length || bytes[offset] < 2 || bytes[offset] > 8) return false;
        offset++;
        if (!skipBlocks()) return false;
        hasImage = true;
      } else return false;
    }
    return false;
  }
  if (mime === 'image/webp') {
    if (bytes.length < 25 || bytes.readUInt32LE(4) + 8 !== bytes.length) return false;
    const kind = bytes.toString('ascii', 12, 16), size = bytes.readUInt32LE(16);
    if (20 + size + (size % 2) > bytes.length) return false;
    if (kind === 'VP8X') return size >= 10 && bytes.length >= 30 && validDimensions(bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1);
    if (kind === 'VP8L') return size >= 5 && bytes[20] === 0x2f && validDimensions((bytes.readUInt32LE(21) & 0x3fff) + 1, ((bytes.readUInt32LE(21) >>> 14) & 0x3fff) + 1);
    return kind === 'VP8 ' && size >= 10 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a && validDimensions(bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff);
  }
  if (mime === 'image/jpeg') {
    if (bytes.length < 12 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return false;
    let offset = 2, dimensions = false;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) return false;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda) return dimensions; // The renderer decodes entropy data; only allow a signed, bounded image stream.
      if (marker === 0xd9) return dimensions;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) return false;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) return false;
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (length < 8 || !validDimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3))) return false;
        dimensions = true;
      }
      offset += length;
    }
    return false;
  }
  return false;
}

function createArtFiles(dataDirectory, options = {}) {
  if (typeof dataDirectory !== 'string' || !dataDirectory) throw new Error('素材文件存储目录无效');
  const base = path.resolve(dataDirectory), artRoot = path.join(base, 'art-files');
  const maxFileBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
  const maxPreviewBytes = options.maxPreviewBytes ?? MAX_PREVIEW_BYTES;
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1 || !Number.isSafeInteger(maxPreviewBytes) || maxPreviewBytes < 1) throw new Error('素材文件大小限制无效');
  async function secureDirectory(directory, create = false) {
    const absolute = path.resolve(directory), root = path.parse(absolute).root;
    let current = root;
    const parts = absolute.slice(root.length).split(path.sep).filter(Boolean);
    for (const part of parts) {
      current = path.join(current, part);
      let stat;
      try { stat = await fs.lstat(current); }
      catch (error) {
        if (error.code !== 'ENOENT' || !create) throw error;
        try { await fs.mkdir(current); } catch (mkdirError) { if (mkdirError.code !== 'EEXIST') throw mkdirError; }
        stat = await fs.lstat(current);
      }
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('素材文件目录不能是符号链接或非目录');
    }
    const real = await fs.realpath(absolute);
    if (comparable(real) !== comparable(absolute)) throw new Error('素材文件目录超出受管目录');
    return absolute;
  }
  function workspaceDirectory(workspaceId) { return path.join(artRoot, workspaceHash(workspaceId)); }
  async function checkedPath(workspaceId, storagePath) {
    if (typeof storagePath !== 'string' || !FILE_TOKEN.test(storagePath)) throw new Error('素材文件存储标识无效');
    const directory = workspaceDirectory(workspaceId);
    await secureDirectory(directory);
    const filename = path.join(directory, storagePath);
    if (path.dirname(filename) !== directory) throw new Error('素材文件不能越过工作区目录');
    const stat = await fs.lstat(filename);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('素材文件不能是目录或符号链接');
    const real = await fs.realpath(filename);
    if (comparable(real) !== comparable(filename)) throw new Error('素材文件超出受管目录');
    return { filename, stat };
  }
  function missing(error) {
    if (error.code === 'ENOENT') return new Error('素材文件已丢失，或不属于当前项目，请重新导入');
    return error;
  }
  async function openedManaged(workspaceId, storagePath) {
    const before = await checkedPath(workspaceId, storagePath);
    const handle = await fs.open(before.filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const actual = await handle.stat(), after = await checkedPath(workspaceId, storagePath);
      if (!actual.isFile() || !sameFile(before.stat, actual) || !sameFile(actual, after.stat)) throw new Error('素材文件在读取时发生变化，请重试');
      return {handle, filename: before.filename, stat: actual};
    } catch (error) { await handle.close(); throw error; }
  }
  async function importFiles(workspaceId, selectedPaths) {
    const directory = workspaceDirectory(workspaceId);
    if (!Array.isArray(selectedPaths) || !selectedPaths.length || selectedPaths.some(p => typeof p !== 'string' || !path.isAbsolute(p))) throw new Error('请选择有效的素材文件');
    const inputs = [], created = [], result = [];
    try {
      // Preflight the whole native-dialog selection before creating any managed file.
      for (const sourcePath of selectedPaths) {
        const stat = await fs.lstat(sourcePath);
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('仅可导入普通文件，不能导入目录或符号链接：' + path.basename(sourcePath));
        if (stat.size > maxFileBytes) throw new Error('单个素材文件不能超过 ' + Math.round(maxFileBytes / 1024 / 1024) + ' MB：' + path.basename(sourcePath));
        const handle = await fs.open(sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        try {
          const current = await handle.stat();
          if (!sameFile(stat, current) || !current.isFile() || current.size > maxFileBytes) throw new Error('待导入文件已发生变化，请重新选择');
          inputs.push({sourcePath, handle, stat: current});
        } catch (error) { await handle.close(); throw error; }
      }
      await secureDirectory(directory, true);
      for (const input of inputs) {
        await secureDirectory(directory);
        const name = path.basename(input.sourcePath), id = randomUUID();
        const extension = path.extname(name).slice(1).toLowerCase();
        const storagePath = id + '.' + (/^[a-z0-9]{1,12}$/.test(extension) ? extension : 'bin');
        const filename = path.join(directory, storagePath);
        const destination = await fs.open(filename, 'wx');
        const identity = await destination.stat();
        created.push({storagePath, identity});
        let total = 0, header = Buffer.alloc(0);
        try {
          const chunk = Buffer.alloc(64 * 1024);
          while (true) {
            const {bytesRead} = await input.handle.read(chunk, 0, chunk.length, total);
            if (!bytesRead) break;
            if (!header.length) header = Buffer.from(chunk.subarray(0, Math.min(bytesRead, 512)));
            total += bytesRead;
            if (total > maxFileBytes) throw new Error('文件在复制时超过大小限制：' + name);
            let written = 0;
            while (written < bytesRead) {
              const part = await destination.write(chunk, written, bytesRead - written, total - bytesRead + written);
              if (!part.bytesWritten) throw new Error('素材文件写入未完成');
              written += part.bytesWritten;
            }
          }
          const final = await input.handle.stat();
          if (total !== input.stat.size || final.size !== input.stat.size || final.mtimeMs !== input.stat.mtimeMs) throw new Error('文件在复制时发生变化，请重新导入：' + name);
          await destination.sync();
        } finally { await destination.close(); }
        const saved = await checkedPath(workspaceId, storagePath);
        if (!sameFile(saved.stat, identity) || saved.stat.size !== total) throw new Error('素材文件复制校验失败');
        result.push({id, name, size: total, mime: sniffMime(header), storagePath});
      }
      return result;
    } catch (error) {
      let uncleared = 0;
      for (const entry of created) {
        try {
          const own = await checkedPath(workspaceId, entry.storagePath);
          if (!sameFile(own.stat, entry.identity)) { uncleared++; continue; }
          await fs.unlink(own.filename);
        } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') uncleared++; }
      }
      throw new Error('素材文件导入失败，本批未添加任何文件记录：' + missing(error).message + (uncleared ? '。部分本批文件未能安全清理，可稍后检查存储目录' : ''));
    } finally { await Promise.all(inputs.map(input => input.handle.close())); }
  }
  async function readPreview(workspaceId, storagePath) {
    let opened;
    try {
      opened = await openedManaged(workspaceId, storagePath);
      if (opened.stat.size > maxPreviewBytes) return null;
      const bytes = Buffer.alloc(opened.stat.size);
      let total = 0;
      while (total < bytes.length) {
        const {bytesRead} = await opened.handle.read(bytes, total, bytes.length - total, total);
        if (!bytesRead) break;
        total += bytesRead;
      }
      const after = await opened.handle.stat();
      if (total !== bytes.length || after.size !== opened.stat.size || after.mtimeMs !== opened.stat.mtimeMs) throw new Error('素材文件在预览时发生变化，请重试');
      await checkedPath(workspaceId, storagePath);
      const mime = sniffMime(bytes);
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)) return null;
      if (!validImage(bytes, mime)) throw new Error('图片格式无效、文件不完整或尺寸过大，无法预览');
      return {dataUrl: 'data:' + mime + ';base64,' + bytes.toString('base64')};
    } catch (error) { throw missing(error); }
    finally { if (opened) await opened.handle.close(); }
  }
  async function reveal(workspaceId, storagePath, showItemInFolder) {
    if (typeof showItemInFolder !== 'function') throw new Error('无法在文件夹中显示文件');
    let opened;
    try {
      opened = await openedManaged(workspaceId, storagePath);
      await showItemInFolder(opened.filename); // Reveal only. Never open the asset as an executable or document.
    } catch (error) { throw missing(error); }
    finally { if (opened) await opened.handle.close(); }
  }
  // Original delivery bytes for engine sync; never execute or accept arbitrary source paths.
  async function readBytes(workspaceId, storagePath) {
    let opened;
    try {
      opened=await openedManaged(workspaceId,storagePath);
      if(opened.stat.size>maxFileBytes)throw new Error('素材超过同步大小限制');
      const bytes=await opened.handle.readFile(),after=await opened.handle.stat();
      const current=await checkedPath(workspaceId,storagePath);
      if(!sameFile(current.stat,opened.stat)||bytes.length!==opened.stat.size||after.size!==opened.stat.size||after.mtimeMs!==opened.stat.mtimeMs)throw new Error('素材在读取期间发生变化');
      return bytes;
    }catch(error){throw missing(error);}finally{await opened?.handle.close();}
  }
  return {importFiles, readPreview, reveal, readBytes};
}
module.exports = {createArtFiles, validateWorkspaceId, workspaceHash, MAX_FILE_BYTES, MAX_PREVIEW_BYTES};
