const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createStorage, atomicWrite } = require('./storage.cjs');
const { workspaceHash } = require('./art-files.cjs');

const CATALOG = 'gamecreator.projects.v1';
const ENTRY = 'project.gamecreator';
const owned = (key, id) => key.startsWith('gamecreator.workspace.v1:' + id + ':') ||
  key === 'gamecreator.enum-versions.v1:' + id || key === 'gamecreator.story-view.v1:' + id;
const replaceId = (key, from, to) => {
  if (!owned(key, from)) throw new Error('存档不属于当前项目');
  return key.replace(':' + from, ':' + to);
};
function secureDirectory(directory) {
  const absolute = path.resolve(directory);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('项目目录不支持符号链接或文件路径');
  }
  return fs.realpathSync(absolute);
}
function regular(filename) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('项目中存在无效文件：' + path.basename(filename));
  return stat;
}
function descriptor(value) {
  if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 1100 ||
      typeof value.name !== 'string' || !value.config ||
      !['empty', 'legacy'].includes(value.initialContent)) throw new Error('项目入口文件格式无效');
  if (value.id !== value.id.trim().replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase() ||
      !['oasis-lua','godot-gdscript'].includes(value.config.engine) ||
      ['projectPath','enumPath','dataPath','outputFormat'].some(key=>typeof value.config[key]!=='string') ||
      typeof value.config.autoSync!=='boolean' || typeof value.config.backupBeforeSync!=='boolean') throw new Error('项目标识或引擎配置无效');
  return { id: value.id, name: value.name, config: value.config, initialContent: value.initialContent };
}
function readHeader(directory) {
  secureDirectory(directory);
  const filename = path.join(directory, ENTRY);
  if (regular(filename).size > 1024 * 1024) throw new Error('项目入口文件过大');
  const header = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (header.format !== 'gamecreator-project-folder' || header.schema !== 1) throw new Error('不支持的项目文件夹版本');
  return descriptor(header.project);
}
function writeHeader(directory, project) {
  const filename=path.join(directory,ENTRY);
  if(fs.existsSync(filename)){regular(filename);const backup=filename+'.bak';if(fs.existsSync(backup))regular(backup);atomicWrite(backup,fs.readFileSync(filename,'utf8'));}
  atomicWrite(filename, JSON.stringify({ format: 'gamecreator-project-folder', schema: 1, project: descriptor(project) }, null, 2));
}

/** Globals are local preferences; folder-backed project archives never fall back to the app cache. */
function createFolderProjects({ legacyStorage, dataDirectory }) {
  const locks = new Map(), owner = randomUUID();
  const catalog = () => JSON.parse(legacyStorage.getItem(CATALOG) || '{"projects":[]}');
  const project = id => catalog().projects.find(item => item.id === id);
  function folder(item) {
    if (!item?.folderPath) return null;
    const directory = secureDirectory(item.folderPath), header = readHeader(directory);
    if (header.id !== item.id) throw new Error('项目目录已更换，请重新打开项目');
    secureDirectory(path.join(directory, 'archives'));
    secureDirectory(path.join(directory, 'assets'));
    return directory;
  }
  function acquire(directory) {
    const filename = path.join(directory, '.gamecreator-lock');
    if (locks.has(directory)) {
      regular(filename);
      if (JSON.parse(fs.readFileSync(filename, 'utf8')).owner !== owner) throw new Error('项目写入锁已变化，请重新打开项目');
      return;
    }
    if (fs.existsSync(filename)) {
      regular(filename);
      const lock = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (!Number.isInteger(lock.pid) || lock.pid <= 0) throw new Error('项目锁文件无效，请检查 .gamecreator-lock');
      let alive = true;
      try { process.kill(lock.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
      if (alive) throw new Error('此项目正在另一个客户端中使用，请先关闭该客户端');
      fs.unlinkSync(filename);
    }
    fs.writeFileSync(filename, JSON.stringify({ pid: process.pid, owner }), { flag: 'wx' });
    locks.set(directory, filename);
  }
  function releaseExcept(directory) {
    for (const [root, filename] of locks) if (root !== directory) {
      try { if (JSON.parse(fs.readFileSync(filename, 'utf8')).owner === owner) fs.unlinkSync(filename); } catch {}
      locks.delete(root);
    }
  }
  function target(key, writing = false) {
    const state = catalog();
    const item = state.projects.filter(p => p.folderPath && owned(key, p.id)).sort((a, b) => b.id.length - a.id.length)[0];
    if (!item) return legacyStorage;
    const directory = folder(item);
    if (writing || state.activeId === item.id) acquire(directory);
    const result = createStorage(path.join(directory, 'archives'));
    const filename = result.info(key).file;
    if (fs.existsSync(filename)) regular(filename);
    if (fs.existsSync(filename + '.bak')) regular(filename + '.bak');
    return result;
  }
  const storage = {
    directory: legacyStorage.directory,
    getItem(key) { return target(key).getItem(key); },
    info(key) { return target(key).info(key); },
    setItem(key, value) {
      if (key !== CATALOG) return target(key, true).setItem(key, value);
      const next = JSON.parse(value), previous = catalog();
      // Metadata changes belong to the project, not just this machine's recent list.
      for (const item of next.projects) {
        const old = previous.projects.find(p => p.id === item.id);
        if (item.folderPath && (!old || old.folderPath !== item.folderPath || JSON.stringify(descriptor(old)) !== JSON.stringify(descriptor(item)))) {
          const directory = folder(item); acquire(directory); writeHeader(directory, item);
        }
      }
      legacyStorage.setItem(key, value);
      const active = next.projects.find(p => p.id === next.activeId);
      releaseExcept(active?.folderPath ? path.resolve(active.folderPath) : null);
    },
  };
  function assetDirectory(workspaceId) {
    if (!workspaceId.startsWith('project:')) return null;
    const item = project(workspaceId.slice(8));
    const root = folder(item);
    if (!root) return null;
    acquire(root);
    return path.join(root, 'assets');
  }
  function entriesFor(item) {
    const root = folder(item), directory = root ? path.join(root, 'archives') : legacyStorage.directory;
    if (root) acquire(root);
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).flatMap(name => {
      const file = path.join(directory, name); if(regular(file).size>20*1024*1024)throw new Error('项目存档超过大小限制');
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!owned(raw.key || '', item.id)) return [];
      if (raw.schema !== 1 || typeof raw.value !== 'string') throw new Error('项目存档损坏');
      JSON.parse(raw.value);
      if(createStorage(directory).getItem(raw.key)!==raw.value)throw new Error('存档文件名与内容不匹配');
      return [{ key: raw.key, value: raw.value }];
    });
  }
  function verify(id) {
    const item = project(id);
    if (!item) throw new Error('项目不在最近项目列表中');
    const root = folder(item);
    if (!root) return item;
    acquire(root);
    return { ...readHeader(root), folderPath: root };
  }
  function open(directory) {
    const root = secureDirectory(directory), item = { ...readHeader(root), folderPath: root };
    folder(item); acquire(root);
    // Verify all archives before exposing the project. Module-specific validation follows in the editor.
    entriesFor(item);
    return item;
  }
  function assertSnapshot(expected) {
    for (const entry of expected || []) if (storage.getItem(entry.key) !== entry.value) throw new Error('项目已变化，请重新保存');
  }
  function create(directory, item, entries = [], sourceId, expectedEntries = []) {
    const source = sourceId ? verify(sourceId) : null;
    assertSnapshot(expectedEntries);
    const clean = descriptor(item), parent = secureDirectory(path.dirname(directory));
    directory = path.join(parent, path.basename(directory));
    if (fs.existsSync(directory)) throw new Error('目标文件夹已存在，请选择新的文件夹名称');
    const temporary = path.join(parent, '.gamecreator-' + randomUUID() + '.tmp');
    fs.mkdirSync(temporary);
    try {
      fs.mkdirSync(path.join(temporary, 'archives')); fs.mkdirSync(path.join(temporary, 'assets'));
      const output = createStorage(path.join(temporary, 'archives'));
      const all = new Map();
      if (source) for (const entry of entriesFor(source)) all.set(replaceId(entry.key, source.id, clean.id), entry.value);
      for (const entry of entries) {
        if (!owned(entry.key, clean.id)) throw new Error('不能保存其他项目的存档');
        all.set(entry.key, entry.value);
      }
      for (const [key, value] of all) output.setItem(key, value);
      if (source) {
        const assets = assetDirectory('project:' + source.id) || path.join(dataDirectory, 'art-files', workspaceHash('project:' + source.id));
        if (fs.existsSync(assets)) {
          secureDirectory(assets);
          for (const name of fs.readdirSync(assets)) {
            if (!/^[a-f0-9-]{36}\.[a-z0-9]{1,12}$/.test(name)) continue;
            regular(path.join(assets, name));
            fs.copyFileSync(path.join(assets, name), path.join(temporary, 'assets', name), fs.constants.COPYFILE_EXCL);
          }
        }
      }
      const art = all.get('gamecreator.workspace.v1:' + clean.id + ':art-assets');
      for (const asset of JSON.parse(art || '{"assets":[]}').assets) for (const version of asset.versions) for (const file of version.files) {
        if (!/^[a-f0-9-]{36}\.[a-z0-9]{1,12}$/.test(file.storagePath) || regular(path.join(temporary, 'assets', file.storagePath)).size !== file.size) throw new Error('素材文件缺失或大小不符');
      }
      writeHeader(temporary, clean);
      fs.writeFileSync(path.join(temporary, 'README.md'), '# GameCreator 项目\n\n在 GameCreator 中选择“打开项目”并选择本文件夹。修改自动保存。\n搬迁时复制整个文件夹，包含 archives 和 assets。引擎工程是独立的交付目标。\n');
      assertSnapshot(expectedEntries);
      fs.renameSync(temporary, directory);
      acquire(directory);
      return { ...clean, folderPath: directory };
    } finally {
      // Only remove our exact, freshly allocated staging directory.
      if (path.dirname(temporary) === parent && path.basename(temporary).startsWith('.gamecreator-') && fs.existsSync(temporary)) fs.rmSync(temporary, { recursive: true });
    }
  }
  function upgradeLegacy(directory, document) {
    // The legacy reader has verified every manifest hash. Keep those original files as a backup.
    directory=secureDirectory(directory);
    if(fs.existsSync(path.join(directory,ENTRY)))return open(directory);
    const item={id:'project-'+randomUUID(),name:document.project.name,config:document.project.config,initialContent:'empty'};
    const archiveDirectory=path.join(directory,'archives');
    if(fs.existsSync(archiveDirectory))throw new Error('旧项目目录已有 archives，请检查先前迁移是否中断');
    acquire(directory);
    fs.mkdirSync(archiveDirectory);
    try {
    const output=createStorage(archiveDirectory);
    for(const [section,value] of Object.entries(document.archives)) {
      const key=section==='enum-versions'?'gamecreator.enum-versions.v1:'+item.id:'gamecreator.workspace.v1:'+item.id+':'+section;
      output.setItem(key,JSON.stringify(value));
    }
    if(document.project.defaultTablesVersion===1)output.setItem('gamecreator.workspace.v1:'+item.id+':default-table-migration',JSON.stringify({schema:1,state:'done',removed:[]}));
    const assets=path.join(directory,'assets');if(!fs.existsSync(assets))fs.mkdirSync(assets);secureDirectory(assets);
    writeHeader(directory,item);
    return {...item,folderPath:directory};
    } catch(error) {
      if(!fs.existsSync(path.join(directory,ENTRY)) && path.dirname(archiveDirectory)===directory && path.basename(archiveDirectory)==='archives')fs.rmSync(archiveDirectory,{recursive:true});
      throw error;
    }
  }
  function refreshRecent() {
    const raw=legacyStorage.getItem(CATALOG);if(!raw)return;
    const state=JSON.parse(raw);
    state.projects=state.projects.map(item=>{
      if(!item.folderPath)return item;
      try {const header=readHeader(item.folderPath);return header.id===item.id?{...header,folderPath:item.folderPath}:item;}catch{return item;}
    });
    const next=JSON.stringify(state);if(next!==raw)legacyStorage.setItem(CATALOG,next);
  }
  return { storage, assetDirectory, open, create, verify, upgradeLegacy, refreshRecent, folder: id => folder(project(id)), close: () => releaseExcept(null) };
}
module.exports = { createFolderProjects, ENTRY, owned };
