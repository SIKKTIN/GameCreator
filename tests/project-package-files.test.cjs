const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {randomUUID, createHash} = require('node:crypto');
const {createProjectPackages, archiveKey, SECTIONS, safeProjectDirectoryName, MAX_ASSET_BYTES} = require('../desktop/project-package.cjs');
const {createWorkspaceStorage} = require('../desktop/test-workspaces.cjs');
const {createArtFiles, workspaceHash} = require('../desktop/art-files.cjs');
const CATALOG = 'gamecreator.projects.v1';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aV8AAAAASUVORK5CYII=', 'base64');
const BLEND = Buffer.from('BLENDER-v300 original source bytes');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const newId = () => 'project-' + randomUUID();
const assetDirectory = (data, id) => path.join(data, 'art-files', workspaceHash('project:' + id));
async function exists(filename) { try { await fs.lstat(filename); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamecreator-project-package-'));
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  t.after(async () => { await fs.rm(root, {recursive: true, force: true}); });
  const data = path.join(root, 'local'), output = path.join(root, 'exports'), source = path.join(root, 'source');
  await fs.mkdir(output); await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'idle.png'), PNG); await fs.writeFile(path.join(source, 'hero.blend'), BLEND);
  const id = newId(), storage = createWorkspaceStorage(data), service = createProjectPackages({dataDirectory: data, storage});
  const files = await createArtFiles(data).importFiles('project:' + id, [path.join(source, 'idle.png'), path.join(source, 'hero.blend')]);
  const project = {name: '便携农场 · 原型', config: {engine: 'oasis-lua', projectPath: '', enumPath: 'Script/Const', dataPath: 'Script/Config', outputFormat: 'lua', autoSync: false, backupBeforeSync: true}};
  const archives = Object.fromEntries(SECTIONS.map(section => [section, {schema: 1}]));
  archives.gameplay = {schema: 1, designs: []};
  archives['art-assets'] = {schema: 1, requirements: [{id: 'requirement-1', status: '已通过'}], assets: [{id: 'asset-1', name: '主角', adoptedVersionId: 'version-2', versions: [{id: 'version-1', files: [files[0]], review: '需修改', feedback: '旧版本说明'}, {id: 'version-2', files, review: '已通过'}]}], links: [{id: 'link-1', requirementId: 'requirement-1', assetId: 'asset-1'}]};
  archives.project = {name: project.name, description: '包含全部历史、采用版本与真实文件'};
  archives.stories = [{id: 'story', content: '原始文档'}];
  archives.milestones = [];
  archives['gameplay-core'] = {schema: 1, rootId: 'root', graphs: [{id: 'root', title: '核心', summary: '', nodes: [{id: 'entry', kind: 'entry', title: '开始', description: '', x: 12.5, y: 87, childGraphId: '', gameplayIds: ['gameplay-1']}], edges: []}]};
  archives['story-orchestration'] = {schema:1,enabled:false,stories:[]};
  archives['map-design'] = {schema:1,enabled:false,maps:[],connections:[]};
  archives['project-schedule'] = {schema:1,tasks:[],milestones:[]};
  archives['task-flows'] = {schema: 1, tasks: []};
  archives['data-view'] = {schema: 1, activeTable: 'crops'};
  const document = {schema: 1, project, archives};
  storage.setItem(CATALOG, JSON.stringify({schema: 2, activeId: id, mode: 'project', projects: [{id, ...project, initialContent: 'empty'}]}));
  for (const [section, content] of Object.entries(archives)) storage.setItem(archiveKey(id, section), JSON.stringify(content));
  const expectedEntries = [CATALOG, ...Object.keys(archives).map(section => archiveKey(id, section))].map(key => ({key, value: storage.getItem(key)}));
  const directory = path.join(output, '便携农场');
  const args = {directory, projectId: id, document, expectedEntries};
  return {root, data, output, source, id, files, document, storage, service, directory, args,
    export: () => service.exportFolder(args),
    manifest: async () => JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8')),
    saveManifest: async value => fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(value, null, 2))};
}

test('project folder preserves full data and all historical source files; restore is isolated and restart-safe', async t => {
  const f = await fixture(t), sourceBefore = f.args.expectedEntries.map(entry => entry.value), result = await f.export();
  assert.equal(result.directory, f.directory);
  const manifest = await f.manifest();
  assert.equal(manifest.format, 'gamecreator-project'); assert.equal(manifest.schema, 1);
  assert.equal(result.fileCount, 2); assert.equal(result.totalFileCount, manifest.files.length + 1);
  assert.equal(manifest.files.filter(file => file.path.startsWith('assets/')).length, 2, 'repeated version references share a single physical asset');
  for (const file of manifest.files) {
    assert.ok(!path.isAbsolute(file.path) && !file.path.includes('\\'));
    const bytes = await fs.readFile(path.join(f.directory, ...file.path.split('/')));
    assert.equal(bytes.length, file.size); assert.equal(sha(bytes), file.sha256);
  }
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory, 'data/project.json'), 'utf8')), f.document.project);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory, 'data/project-info.json'), 'utf8')), f.document.archives.project);
  const read = await f.service.readFolder(f.directory);
  assert.deepEqual(read.document, f.document);
  assert.deepEqual(f.args.expectedEntries.map(entry => f.storage.getItem(entry.key)), sourceBefore);
  const otherData = path.join(f.root, 'other-machine'), other = createProjectPackages({dataDirectory: otherData, storage: createWorkspaceStorage(otherData)});
  const prepared = await other.prepareImport(f.directory), destinationId = newId();
  assert.deepEqual(prepared.document, f.document);
  await other.restoreAssets({token: prepared.token, projectId: destinationId});
  const recovered = createArtFiles(otherData);
  assert.equal((await recovered.readPreview('project:' + destinationId, f.files[0].storagePath)).dataUrl, 'data:image/png;base64,' + PNG.toString('base64'));
  assert.deepEqual(await fs.readFile(path.join(assetDirectory(otherData, destinationId), f.files[1].storagePath)), BLEND);
  assert.equal(createWorkspaceStorage(otherData).getItem(CATALOG), null, 'file restoration must never publish a project catalog');
  other.release(prepared.token);
  await assert.rejects(other.restoreAssets({token: prepared.token, projectId: newId()}), /凭证已失效/);
});

test('existing export folder is never overwritten and does not leave temporary output', async t => {
  const f = await fixture(t); await fs.mkdir(f.directory); await fs.writeFile(path.join(f.directory, 'keep.txt'), 'keep');
  await assert.rejects(f.export(), /已存在/);
  assert.equal(await fs.readFile(path.join(f.directory, 'keep.txt'), 'utf8'), 'keep');
  assert.deepEqual(await fs.readdir(f.output), ['便携农场']);
});

test('missing originals or mismatched recorded size fail the entire export', async t => {
  const f = await fixture(t), filename = path.join(assetDirectory(f.data, f.id), f.files[1].storagePath);
  await fs.unlink(filename);
  await assert.rejects(f.export(), /美术文件已丢失/);
  assert.deepEqual(await fs.readdir(f.output), []);
  await fs.writeFile(filename, Buffer.from('changed'));
  await assert.rejects(f.export(), /校验失败/);
  assert.deepEqual(await fs.readdir(f.output), []);
});

test('changed archive snapshot aborts export and cleans only its own temporary folder', async t => {
  const f = await fixture(t), key = archiveKey(f.id, 'stories'); let reads = 0;
  const guardedStorage = {getItem(requested) { if (requested === key && ++reads === 2) f.storage.setItem(key, JSON.stringify([{content: 'newer edit'}])); return f.storage.getItem(requested); }};
  const service = createProjectPackages({dataDirectory: f.data, storage: guardedStorage});
  await assert.rejects(service.exportFolder(f.args), /导出期间发生变化/);
  assert.deepEqual(await fs.readdir(f.output), []);
  assert.match(f.storage.getItem(key), /newer edit/);
});

test('unknown projects, incomplete snapshots and cross-project keys are rejected before output', async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.exportFolder({...f.args, projectId: newId()}), /项目不存在/);
  await assert.rejects(f.service.exportFolder({...f.args, expectedEntries: f.args.expectedEntries.slice(1)}), /快照不完整/);
  const entries = structuredClone(f.args.expectedEntries); entries[1].key = archiveKey(newId(), 'gameplay');
  await assert.rejects(f.service.exportFolder({...f.args, expectedEntries: entries}), /未知或重复存档/);
  assert.deepEqual(await fs.readdir(f.output), []);
});

test('asset tampering after preview is detected; a failed restore can be retried after repairing the folder', async t => {
  const f = await fixture(t); await f.export();
  const prepared = await f.service.prepareImport(f.directory), id = newId(), filename = path.join(f.directory, 'assets', f.files[0].storagePath);
  await fs.writeFile(filename, Buffer.alloc(PNG.length, 1));
  await assert.rejects(f.service.restoreAssets({token: prepared.token, projectId: id}), /校验失败/);
  assert.equal(await exists(assetDirectory(f.data, id)), false);
  await fs.writeFile(filename, PNG);
  await f.service.restoreAssets({token: prepared.token, projectId: id});
  assert.deepEqual(await fs.readFile(path.join(assetDirectory(f.data, id), f.files[0].storagePath)), PNG);
  const retryId = newId();
  await f.service.restoreAssets({token: prepared.token, projectId: retryId});
  assert.deepEqual(await fs.readFile(path.join(assetDirectory(f.data, retryId), f.files[0].storagePath)), PNG, 'catalog publication failure may retry using a new project ID');
});

test('a changed manifest after preview requires choosing the folder again', async t => {
  const f = await fixture(t); await f.export();
  const prepared = await f.service.prepareImport(f.directory), manifest = await f.manifest();
  manifest.createdAt = '2000-01-01T00:00:00.000Z'; await f.saveManifest(manifest);
  await assert.rejects(f.service.restoreAssets({token: prepared.token, projectId: newId()}), /预览后发生变化/);
});

test('traversal, absolute, duplicate and unknown manifest paths are rejected', async t => {
  const f = await fixture(t); await f.export(); const original = await f.manifest();
  for (const invalid of ['../secret', 'assets/../secret', 'assets/../../secret', 'assets/x.png', 'assets/a:stream', 'C:\\secret', '/etc/passwd', 'data/unknown.json', 'data\\project.json']) {
    const manifest = structuredClone(original); manifest.files[0].path = invalid; await f.saveManifest(manifest);
    await assert.rejects(f.service.readFolder(f.directory), /无效、重复或越界路径/);
  }
  const duplicate = structuredClone(original); duplicate.files.push(duplicate.files[0]); await f.saveManifest(duplicate);
  await assert.rejects(f.service.readFolder(f.directory), /无效、重复或越界路径/);
});

test('missing, extra and unreferenced files cannot silently pass a folder import', async t => {
  const f = await fixture(t); await f.export();
  const extra = path.join(f.directory, 'private.txt'); await fs.writeFile(extra, 'unrelated data');
  await assert.rejects(f.service.readFolder(f.directory), /未列入清单/); await fs.unlink(extra);
  const filename = path.join(f.directory, 'assets', f.files[1].storagePath); await fs.unlink(filename);
  await assert.rejects(f.service.readFolder(f.directory), {code: 'ENOENT'});
  await fs.writeFile(filename, BLEND);
  const manifest = await f.manifest(); manifest.files = manifest.files.filter(file => file.path !== 'data/stories.json'); await f.saveManifest(manifest);
  await assert.rejects(f.service.readFolder(f.directory), /清单缺少/);
});

test('file size limits are checked before copying or parsing', async t => {
  const f = await fixture(t); await f.export();
  const manifest = await f.manifest(); manifest.files.find(file => file.path.startsWith('assets/')).size = MAX_ASSET_BYTES + 1; await f.saveManifest(manifest);
  await assert.rejects(f.service.readFolder(f.directory), /大小限制/);
  const filename = path.join(assetDirectory(f.data, f.id), f.files[1].storagePath), handle = await fs.open(filename, 'r+');
  await handle.truncate(MAX_ASSET_BYTES + 1); await handle.close();
  const directory = path.join(f.output, 'oversize');
  await assert.rejects(f.service.exportFolder({...f.args, directory}), /大小限制/);
  assert.equal(await exists(directory), false);
});

test('restore rejects existing project IDs, existing archives and existing managed art directories', async t => {
  const f = await fixture(t); await f.export(); const prepared = await f.service.prepareImport(f.directory);
  await assert.rejects(f.service.restoreAssets({token: prepared.token, projectId: f.id}), /项目已存在/);
  await assert.rejects(f.service.restoreAssets({token: prepared.token, projectId: '../../old'}), /新项目标识/);
  const archiveId = newId(); f.storage.setItem(archiveKey(archiveId, 'stories'), '[]');
  await assert.rejects(f.service.restoreAssets({token: prepared.token, projectId: archiveId}), /已有项目数据/);
  const artId = newId(), directory = assetDirectory(f.data, artId); await fs.mkdir(directory); await fs.writeFile(path.join(directory, 'keep'), 'keep');
  await assert.rejects(f.service.restoreAssets({token: prepared.token, projectId: artId}), /已存在/);
  assert.equal(await fs.readFile(path.join(directory, 'keep'), 'utf8'), 'keep');
});

test('directory junctions cannot redirect package input, export output or asset restoration', async t => {
  const f = await fixture(t); await f.export();
  const linked = path.join(f.root, 'linked'); await fs.symlink(f.directory, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.service.readFolder(linked), /符号链接/);
  await assert.rejects(f.service.exportFolder({...f.args, directory: path.join(linked, 'another')}), /符号链接/);
  const otherData = path.join(f.root, 'unsafe-data'); await fs.mkdir(otherData); await fs.symlink(f.source, path.join(otherData, 'art-files'), process.platform === 'win32' ? 'junction' : 'dir');
  const unsafe = createProjectPackages({dataDirectory: otherData, storage: createWorkspaceStorage(otherData)}), prepared = await unsafe.prepareImport(f.directory);
  await assert.rejects(unsafe.restoreAssets({token: prepared.token, projectId: newId()}), /符号链接/);
  assert.deepEqual((await fs.readdir(f.source)).sort(), ['hero.blend', 'idle.png']);
});

test('file symlinks are rejected even when manifest size and hash match their targets', async t => {
  const f = await fixture(t); await f.export();
  const filename = path.join(f.directory, 'assets', f.files[0].storagePath); await fs.unlink(filename);
  try { await fs.symlink(path.join(f.source, 'idle.png'), filename, 'file'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) {t.skip('Host does not allow creating file symlinks'); return;} throw error; }
  await assert.rejects(f.service.readFolder(f.directory), /符号链接/);
});

test('safe export names remain one normal directory component on Windows', () => {
  for (const name of ['空洞骑士', '../escape', 'C:\\folder:name', 'CON', 'NUL.json', '.', ' ', 'ending. ', 'a/b']) {
    const result = safeProjectDirectoryName(name);
    assert.ok(result && !/[<>:"/\\|?*\x00-\x1f]/.test(result));
    assert.ok(!/[. ]$/.test(result)); assert.ok(!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result));
  }
});


test('an absent optional data-view archive still participates in the export snapshot guard', async t => {
  const f = await fixture(t), document = structuredClone(f.document), viewKey = archiveKey(f.id, 'data-view');
  delete document.archives['data-view'];
  const storage = {getItem(key) {return key === viewKey ? null : f.storage.getItem(key);}};
  const service = createProjectPackages({dataDirectory: f.data, storage});
  const expectedEntries = f.args.expectedEntries.map(entry => entry.key === viewKey ? {...entry, value: null} : entry);
  await service.exportFolder({...f.args, document, expectedEntries});
  assert.deepEqual((await service.readFolder(f.directory)).document, document);
});

test('project package IPC accepts only native-selected folders and window-owned opaque import tokens', async () => {
  const vm = require('node:vm'), fsSync = require('node:fs'), handlers = new Map(), calls = [];
  const nativeDirectory = path.resolve('native-project-folder');
  let dialogResult = {canceled: false, filePaths: [nativeDirectory]}, onDialog = () => {}, dialogs = 0, onPrepare = () => {};
  const packages = {
    exportFolder: async value => {calls.push(['export', value]); return {directory: value.directory, fileCount: 0};},
    prepareImport: async directory => {calls.push(['prepare', directory]); onPrepare(); return {token: 'opaque-test-token', document: {schema: 1}};},
    restoreAssets: async value => {calls.push(['restore', value]);},
    release: token => calls.push(['release', token]),
  };
  const electron = {
    app: {requestSingleInstanceLock: () => true, on() {}, setPath() {}, whenReady: () => new Promise(() => {})},
    BrowserWindow: class {}, session: {}, shell: {},
    ipcMain: {on() {}, handle: (name, handler) => handlers.set(name, handler)},
    dialog: {showOpenDialog: async (_window, options) => {dialogs++; assert.ok(options.properties.includes('openDirectory')); onDialog(); return dialogResult;}},
  };
  const context = {require: name => {
    if (name === 'electron') return electron;
    if (name === './project-package.cjs') return {createProjectPackages: () => packages, safeProjectDirectoryName};
    if (name === './art-files.cjs') return {createArtFiles: () => ({}), validateWorkspaceId() {}};
    if (name === './test-workspaces.cjs') return {createWorkspaceStorage: () => ({}), prepareTestWorkspace() {}};
    if (name === './server.cjs') return {createDesktopServer() {}};
    if (name === './project-locations.cjs') return {validateProjectLocation() {}};
    if (name === './legacy-storage.cjs') return {migrateLegacy() {}};
    if (name === './collaboration-host.cjs') return require(path.join(__dirname, '../desktop', name));
    return require(name);
  }, __dirname: path.resolve(__dirname, '../desktop'), process, URL};
  vm.runInNewContext(fsSync.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8') + '\nglobalThis.setPackageWindow = (window, server) => {mainWindow=window;localServer=server;};', context);
  const frame = {url: 'http://127.0.0.1:12345/'}, contents = {mainFrame: frame}, window = {webContents: contents}, server = {url: 'http://127.0.0.1:12345'};
  const trusted = {sender: contents, senderFrame: frame}; context.setPackageWindow(window, server);
  for (const channel of ['project-package-export', 'project-package-choose-import', 'project-package-restore-assets', 'project-package-release']) {
    for (const event of [{sender: {}, senderFrame: frame}, {sender: contents, senderFrame: {url: frame.url}}]) await assert.rejects(Promise.resolve().then(() => handlers.get(channel)(event, {})), /不允许/);
  }
  assert.equal(dialogs, 0); assert.deepEqual(calls, []);
  const payload = {projectId: 'project-1', document: {project: {name: '../Farm'}}, expectedEntries: [], directory: path.resolve('renderer-chosen-forbidden')};
  await handlers.get('project-package-export')(trusted, payload);
  assert.equal(calls[0][0], 'export'); assert.equal(calls[0][1].directory, path.join(nativeDirectory, safeProjectDirectoryName('../Farm')));
  assert.notEqual(calls[0][1].directory, payload.directory);
  const prepared = await handlers.get('project-package-choose-import')(trusted, path.resolve('renderer-unselected-input'));
  assert.deepEqual(calls[1], ['prepare', nativeDirectory]);
  await assert.rejects(handlers.get('project-package-restore-assets')(trusted, {token: 'not-chosen', projectId: 'x'}), /不允许/);
  await handlers.get('project-package-restore-assets')(trusted, {token: prepared.token, projectId: 'project-new', directory: 'renderer-cannot-supply-a-path'});
  assert.deepEqual(JSON.parse(JSON.stringify(calls[2])), ['restore', {token: prepared.token, projectId: 'project-new'}]);
  const otherFrame = {url: frame.url}, otherContents = {mainFrame: otherFrame}; context.setPackageWindow({webContents: otherContents}, server);
  await assert.rejects(handlers.get('project-package-restore-assets')({sender: otherContents, senderFrame: otherFrame}, {token: prepared.token, projectId: 'new'}), /不允许/);
  context.setPackageWindow(window, server);
  handlers.get('project-package-release')(trusted, prepared.token);
  await assert.rejects(handlers.get('project-package-restore-assets')(trusted, {token: prepared.token, projectId: 'new'}), /不允许/);
  dialogResult = {canceled: true, filePaths: []};
  assert.equal(await handlers.get('project-package-export')(trusted, payload), null);
  assert.equal(await handlers.get('project-package-choose-import')(trusted), null);
  dialogResult = {canceled: false, filePaths: [nativeDirectory]}; onDialog = () => context.setPackageWindow(null, server);
  await assert.rejects(handlers.get('project-package-choose-import')(trusted), /窗口已关闭/);
  context.setPackageWindow(window, server); onDialog = () => {}; onPrepare = () => context.setPackageWindow(null, server);
  await assert.rejects(handlers.get('project-package-choose-import')(trusted), /窗口已关闭/);
  assert.deepEqual(calls.at(-1), ['release', 'opaque-test-token']);
});

test('project package preload exposes selection and opaque handles without direct filesystem readers', async () => {
  const vm = require('node:vm'), fsSync = require('node:fs'), calls = []; let api;
  vm.runInNewContext(fsSync.readFileSync(path.join(__dirname, '../desktop/preload.cjs'), 'utf8'), {require: () => ({
    contextBridge: {exposeInMainWorld: (_name, value) => {api = value;}},
    ipcRenderer: {invoke: async (...args) => {calls.push(args); return null;}, sendSync() {throw new Error('not used');}},
  })});
  assert.deepEqual(Object.keys(api.projectPackages).sort(), ['chooseImport', 'exportFolder', 'release', 'restoreAssets']);
  await api.projectPackages.chooseImport('/renderer/unselected');
  await api.projectPackages.restoreAssets({token: 'opaque', projectId: 'new'});
  await api.projectPackages.release('opaque');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['project-package-choose-import'], ['project-package-restore-assets', {token: 'opaque', projectId: 'new'}], ['project-package-release', 'opaque']]);
});


test('modern table-default state survives folder export and participates in snapshot checks', async t => {
  const f = await fixture(t), key = archiveKey(f.id, 'default-table-migration');
  const value = JSON.stringify({schema:1,state:'done',removed:[]});
  f.storage.setItem(key,value);
  const document = {...f.document,project:{...f.document.project,defaultTablesVersion:1}};
  const expectedEntries = [...f.args.expectedEntries,{key,value}];
  await assert.rejects(f.service.exportFolder({...f.args,document}), /快照不完整/);
  await f.service.exportFolder({...f.args,document,expectedEntries});
  assert.equal((await f.service.readFolder(f.directory)).document.project.defaultTablesVersion,1);
  const blocked = newId(); f.storage.setItem(archiveKey(blocked, 'default-table-migration'),value);
  const prepared = await f.service.prepareImport(f.directory);
  await assert.rejects(f.service.restoreAssets({token:prepared.token,projectId:blocked}), /已有项目数据/);
});

test('legacy folders without gameplay core remain readable while new core archives are hash-protected', async t => {
  const f = await fixture(t);
  delete f.document.archives['gameplay-core'];
  await f.export();
  const legacy = await f.service.readFolder(f.directory);
  assert.equal(Object.hasOwn(legacy.document.archives, 'gameplay-core'), false);
  const next = await fixture(t);
  await next.export();
  const manifest = await next.manifest();
  const coreFile = manifest.files.find(file => file.path === 'data/gameplay-core.json');
  assert.ok(coreFile);
  const bytes = await fs.readFile(path.join(next.directory, coreFile.path));
  assert.equal(sha(bytes), coreFile.sha256);
  const changed = JSON.parse(bytes.toString('utf8')); changed.graphs[0].nodes[0].x += 1;
  await fs.writeFile(path.join(next.directory, coreFile.path), JSON.stringify(changed));
  await assert.rejects(next.service.readFolder(next.directory), /校验失败/);
});

test('malformed core graphs are rejected before export creates a directory', async t => {
  for (const mutate of [
    core => { core.schema = 2; },
    core => { core.rootId = ' '; core.graphs[0].id = ' '; },
    core => { core.graphs[0].nodes[0].id = ' '; },
    core => { core.graphs[0].nodes[0].gameplayIds = [' ']; },
    core => { core.graphs[0].edges.push({id: ' ', fromId: 'entry', toId: 'entry', label: '', condition: ''}); },
    core => { core.graphs[0].nodes[0].x = null; },
    core => { core.graphs[0].edges.push({id: 'invalid', fromId: 'entry', toId: 'missing', label: '', condition: ''}); },
    core => { core.graphs[0].nodes[0].kind = 'module'; core.graphs[0].nodes[0].childGraphId = 'root'; },
  ]) {
    const f = await fixture(t); mutate(f.document.archives['gameplay-core']);
    await assert.rejects(f.export(), /玩法核心存档格式无效/);
    assert.equal(await exists(f.directory), false);
  }
});

test('core edits during export invalidate its captured snapshot', async t => {
  const f = await fixture(t), coreKey = archiveKey(f.id, 'gameplay-core');
  const core = structuredClone(f.document.archives['gameplay-core']); core.graphs[0].nodes[0].x = 700;
  f.storage.setItem(coreKey, JSON.stringify(core));
  await assert.rejects(f.export(), /导出期间发生变化/);
  assert.equal(await exists(f.directory), false);
});


test('prototype scene archives are portable, hash protected and included in export race checks', async t => {
  const {createPrototypeScene,createPrototypeElement}=await import('../src/prototype-design.ts');
  const f=await fixture(t),scene=createPrototypeScene('开始界面');scene.elements=[createPrototypeElement('button')];
  const value={schema:1,entryId:scene.id,scenes:[scene]},key=archiveKey(f.id,'prototype-design');
  f.document.archives['prototype-design']=value;f.storage.setItem(key,JSON.stringify(value));f.args.expectedEntries.push({key,value:JSON.stringify(value)});
  const changed=structuredClone(value);changed.scenes[0].name='另一个窗口';f.storage.setItem(key,JSON.stringify(changed));
  await assert.rejects(f.export(),/导出期间发生变化/);assert.equal(await exists(f.directory),false);f.storage.setItem(key,JSON.stringify(value));
  await f.export();assert.deepEqual((await f.service.readFolder(f.directory)).document.archives['prototype-design'],value);
  const manifest=await f.manifest(),file=manifest.files.find(f=>f.path==='data/prototype-design.json');assert.ok(file);assert.equal(sha(await fs.readFile(path.join(f.directory,file.path))),file.sha256);
  await fs.writeFile(path.join(f.directory,file.path),JSON.stringify(changed));await assert.rejects(f.service.readFolder(f.directory),/校验失败/);
});
test('malformed prototype archives fail before any project folder is created',async t=>{
 const {createPrototypeScene,createPrototypeElement}=await import('../src/prototype-design.ts');
 for(const mutate of [s=>s.schema=999,s=>s.scenes[0].elements[0].action.kind='eval',s=>s.scenes[0].elements[0].x=null,s=>s.scenes[0].width=0]){
  const f=await fixture(t),scene=createPrototypeScene();scene.elements=[createPrototypeElement('button')];const value={schema:1,entryId:scene.id,scenes:[scene]};mutate(value);f.document.archives['prototype-design']=value;
  await assert.rejects(f.export(),/原型设计存档格式无效/);assert.equal(await exists(f.directory),false);
 }
});
