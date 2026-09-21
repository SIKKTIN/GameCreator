const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {createArtFiles, workspaceHash, validateWorkspaceId, MAX_FILE_BYTES, MAX_PREVIEW_BYTES} = require('../desktop/art-files.cjs');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aV8AAAAASUVORK5CYII=', 'base64');
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const PROJECT = 'project:art-test';
const TEST_SPACE = 'test:10000000-0000-4000-8000-000000000001';
async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gamecreator-art-files-'));
  // root is a unique mkdtemp result directly below the OS temp directory; all fixtures stay inside it.
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  t.after(async () => { await fs.rm(root, {recursive: true, force: true}); });
  const source = path.join(root, 'source'), data = path.join(root, 'data');
  await fs.mkdir(source);
  return {root, source, data, service: createArtFiles(data), file: async (name, bytes = PNG) => {const p = path.join(source, name); await fs.writeFile(p, bytes); return p;}};
}
const assetDir = (data, workspace = PROJECT) => path.join(data, 'art-files', workspaceHash(workspace));

test('native-selected files copy to isolated storage; restart preview survives source removal', async t => {
  const f = await setup(t), original = await f.file('设计参考.png');
  const [asset] = await f.service.importFiles(PROJECT, [original]);
  assert.deepEqual(Object.keys(asset).sort(), ['id', 'mime', 'name', 'size', 'storagePath']);
  assert.equal(asset.name, '设计参考.png'); assert.equal(asset.size, PNG.length); assert.equal(asset.mime, 'image/png');
  assert.equal(asset.storagePath, asset.id + '.png'); assert.ok(!JSON.stringify(asset).includes(f.source));
  await fs.unlink(original);
  const restarted = createArtFiles(f.data);
  assert.equal((await restarted.readPreview(PROJECT, asset.storagePath)).dataUrl, 'data:image/png;base64,' + PNG.toString('base64'));
  let revealed = '';
  await restarted.reveal(PROJECT, asset.storagePath, filename => {revealed = filename;});
  assert.equal(revealed, path.join(assetDir(f.data), asset.storagePath));
});

test('file contents determine MIME; source formats are copied without execution or HTML/SVG preview', async t => {
  const f = await setup(t);
  const paths = await Promise.all([
    f.file('renamed.psd', PNG), f.file('layers.psd', Buffer.from('8BPS\0\1 layers')),
    f.file('scene.blend', Buffer.from('BLENDER-v300')), f.file('mesh.fbx', Buffer.from('FBX data')),
    f.file('source.exe', Buffer.from('MZ nothing runs')), f.file('drawing.svg', Buffer.from('<svg onload="alert(1)"></svg>')),
    f.file('fake.png', Buffer.from('<html><script>alert(1)</script></html>')), f.file('animation.gif', GIF),
    f.file('unusual.艺术', Buffer.from('opaque file')),
  ]);
  const assets = await f.service.importFiles(PROJECT, paths);
  assert.equal(assets.length, paths.length);
  assert.equal(assets[0].mime, 'image/png'); assert.match((await f.service.readPreview(PROJECT, assets[0].storagePath)).dataUrl, /^data:image\/png;base64,/);
  assert.equal(assets[1].mime, 'image/vnd.adobe.photoshop'); assert.equal(assets[2].mime, 'application/x-blender');
  for (const index of [1,2,3,4,5,6,8]) assert.equal(await f.service.readPreview(PROJECT, assets[index].storagePath), null);
  assert.match((await f.service.readPreview(PROJECT, assets[7].storagePath)).dataUrl, /^data:image\/gif;base64,/);
  assert.ok(assets[8].storagePath.endsWith('.bin'));
});

test('project, test and legacy project namespaces remain isolated', async t => {
  const f = await setup(t), source = await f.file('one.png');
  const [formal] = await f.service.importFiles(PROJECT, [source]);
  const [other] = await f.service.importFiles('project:other', [source]);
  const [sandbox] = await f.service.importFiles(TEST_SPACE, [source]);
  const legacy = 'project:e:/游戏项目/legacy';
  const [older] = await f.service.importFiles(legacy, [source]);
  assert.notEqual(formal.storagePath, other.storagePath); assert.notEqual(workspaceHash(PROJECT), workspaceHash(TEST_SPACE));
  for (const key of ['project:other', TEST_SPACE, legacy]) await assert.rejects(f.service.readPreview(key, formal.storagePath), /不属于当前项目/);
  assert.ok(await f.service.readPreview(TEST_SPACE, sandbox.storagePath)); assert.ok(await f.service.readPreview(legacy, older.storagePath));
  for (const key of ['art-test', '', 'other:foo', 'project:', 'project: bad ', 'test:../../x', 'project:x\0y', 123]) assert.throws(() => validateWorkspaceId(key), /工作区标识无效/);
});

test('preview and reveal reject path traversal, absolute paths and unowned file tokens', async t => {
  const f = await setup(t), [asset] = await f.service.importFiles(PROJECT, [await f.file('one.png')]);
  let calls = 0;
  for (const token of ['../one.png', '..\\one.png', '/etc/passwd', 'C:\\private.png', asset.storagePath + ':stream', asset.storagePath + '/x', 'one.png', '']) {
    await assert.rejects(f.service.readPreview(PROJECT, token), /存储标识无效/);
    await assert.rejects(f.service.reveal(PROJECT, token, () => {calls++;}), /存储标识无效/);
  }
  assert.equal(calls, 0);
  await fs.unlink(path.join(assetDir(f.data), asset.storagePath));
  await assert.rejects(f.service.readPreview(PROJECT, asset.storagePath), /素材文件已丢失/);
  await assert.rejects(f.service.reveal(PROJECT, asset.storagePath, () => {calls++;}), /素材文件已丢失/);
  assert.equal(calls, 0);
});

test('managed file symlinks are rejected for both preview and reveal', async t => {
  const f = await setup(t), original = await f.file('outside.png'), [asset] = await f.service.importFiles(PROJECT, [original]);
  const stored = path.join(assetDir(f.data), asset.storagePath);
  await fs.unlink(stored);
  try { await fs.symlink(original, stored, 'file'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) {t.skip('Host does not allow creating file symlinks'); return;} throw error; }
  await assert.rejects(f.service.readPreview(PROJECT, asset.storagePath), /符号链接/);
  await assert.rejects(f.service.reveal(PROJECT, asset.storagePath, () => assert.fail('must not reveal symlink')), /符号链接/);
});

test('workspace and art-root directory junctions cannot escape managed storage', async t => {
  const f = await setup(t), original = await f.file('outside.png');
  await fs.mkdir(path.join(f.data, 'art-files'), {recursive: true});
  const directory = assetDir(f.data);
  await fs.symlink(f.source, directory, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.service.importFiles(PROJECT, [original]), /目录不能是符号链接/);
  await assert.rejects(f.service.readPreview(PROJECT, '10000000-0000-4000-8000-000000000001.png'), /目录不能是符号链接/);
  await fs.unlink(directory);
  await fs.rmdir(path.join(f.data, 'art-files'));
  await fs.symlink(f.source, path.join(f.data, 'art-files'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.service.importFiles(PROJECT, [original]), /目录不能是符号链接/);
  assert.deepEqual(await fs.readdir(f.source), ['outside.png']);
});

test('a symlinked dataDirectory parent is also rejected', async t => {
  const f = await setup(t), original = await f.file('source.png');
  const actual = path.join(f.root, 'actual'), link = path.join(f.root, 'link');
  await fs.mkdir(actual); await fs.symlink(actual, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(createArtFiles(path.join(link, 'data')).importFiles(PROJECT, [original]), /目录不能是符号链接/);
  assert.deepEqual(await fs.readdir(actual), []);
});

test('signed but truncated or unreasonable images cannot be previewed', async t => {
  const f = await setup(t), enormous = Buffer.from(PNG); enormous.writeUInt32BE(100000, 16);
  const assets = await f.service.importFiles(PROJECT, [await f.file('broken.png', PNG.subarray(0,30)), await f.file('bad.jpg', Buffer.from([255,216,255,224,0,1,255,217])), await f.file('huge.png', enormous)]);
  for (const asset of assets) await assert.rejects(f.service.readPreview(PROJECT, asset.storagePath), /图片格式无效/);
});

test('100MB import and 12MB preview limits are enforced without buffering oversized inputs', async t => {
  assert.equal(MAX_FILE_BYTES, 100 * 1024 * 1024); assert.equal(MAX_PREVIEW_BYTES, 12 * 1024 * 1024);
  const f = await setup(t), large = await f.file('large.blend', Buffer.alloc(0));
  await fs.truncate(large, MAX_FILE_BYTES + 1);
  await assert.rejects(f.service.importFiles(PROJECT, [large]), /不能超过 100 MB/);
  await assert.rejects(fs.stat(path.join(f.data,'art-files')), {code:'ENOENT'});
  const limited = createArtFiles(f.data, {maxPreviewBytes: PNG.length - 1});
  const [asset] = await limited.importFiles(PROJECT, [await f.file('normal.png')]);
  assert.equal(await limited.readPreview(PROJECT, asset.storagePath), null);
  assert.ok(await createArtFiles(f.data).readPreview(PROJECT, asset.storagePath));
});

test('invalid selection fails the whole batch before saving any metadata or copy', async t => {
  const f = await setup(t), good = await f.file('good.png');
  await assert.rejects(f.service.importFiles(PROJECT, [good, f.source]), /不能导入目录/);
  await assert.rejects(f.service.importFiles(PROJECT, [good, path.join(f.source,'missing.png')]), /素材文件已丢失/);
  await assert.rejects(f.service.importFiles(PROJECT, ['relative.png']), /请选择有效/);
  await assert.rejects(fs.stat(path.join(f.data,'art-files')), {code:'ENOENT'});
});

test('copy failure rolls back only this batch and preserves previously imported assets', async t => {
  const f = await setup(t), first = await f.file('first.png'), second = await f.file('second.png');
  const [existing] = await f.service.importFiles(PROJECT, [first]);
  const realOpen = fs.open;
  let newFiles = 0;
  fs.open = async function(filename, flags, ...rest) {
    if (flags === 'wx' && path.dirname(filename) === assetDir(f.data) && ++newFiles === 2) throw Object.assign(new Error('simulated disk write failure'), {code:'EIO'});
    return realOpen.call(this, filename, flags, ...rest);
  };
  try { await assert.rejects(f.service.importFiles(PROJECT, [first, second]), /本批未添加任何文件记录.*simulated/); }
  finally { fs.open = realOpen; }
  assert.deepEqual(await fs.readdir(assetDir(f.data)), [existing.storagePath]);
  assert.ok(await f.service.readPreview(PROJECT, existing.storagePath));
});

test('art IPC accepts only the trusted main frame and imports only native-dialog selections', async () => {
  const vm = require('node:vm'), fsSync = require('node:fs');
  const handlers = new Map(), calls = [];
  let dialogResult = {canceled: false, filePaths: [path.resolve('native-dialog-selection.png')]}, dialogs = 0;
  let onDialog = () => {};
  let onReveal = () => {};
  const electron = {
    app: {requestSingleInstanceLock: () => true, on() {}, setPath() {}, whenReady: () => new Promise(() => {})},
    BrowserWindow: class {}, session: {},
    shell: {showItemInFolder: value => calls.push(['reveal-native', value])},
    ipcMain: {on() {}, handle: (name, handler) => handlers.set(name, handler)},
    dialog: {showOpenDialog: async (_window, options) => {dialogs++; assert.deepEqual([...options.properties], ['openFile','multiSelections']); await onDialog(); return dialogResult;}},
  };
  const service = {importFiles: async (workspaceId, selected) => {calls.push(['import', workspaceId, selected]); return [];}, readPreview: async (...args) => {calls.push(['preview', ...args]); return null;}, reveal: async (...args) => {calls.push(['reveal', ...args.slice(0,2)]); await onReveal(); await args[2]('/managed/file.png');}};
  const context = {require: name => {
    if (name === 'electron') return electron;
    if (name === './art-files.cjs') return {createArtFiles: () => service, validateWorkspaceId};
    if (name === './project-package.cjs') return {createProjectPackages: () => ({}), safeProjectDirectoryName: value => value};
    if (name === './test-workspaces.cjs') return {createWorkspaceStorage: () => ({}), prepareTestWorkspace: () => {}};
    if (name === './server.cjs') return {createDesktopServer: () => {}};
    if (name === './project-locations.cjs') return {validateProjectLocation: () => {}};
    if (name === './ai-documents.cjs') return {createAiDocuments: () => ({})};
    if (name === './engine-sync.cjs') return {createEngineSync: () => ({})};
    if (name === './legacy-storage.cjs') return {migrateLegacy: () => {}};
    if (name === './collaboration-host.cjs') return require(path.join(__dirname, '../desktop', name));
    if (name === './folder-projects.cjs') return {createFolderProjects: ({legacyStorage}) => ({storage:legacyStorage,assetDirectory:()=>null,folder:()=>null,close:()=>{}})};
    return require(name);
  }, __dirname: path.resolve(__dirname,'../desktop'), process, URL};
  vm.runInNewContext(fsSync.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8') + '\nglobalThis.setArtTestWindow = (window, server) => {mainWindow=window;localServer=server;};', context);
  const frame = {url: 'http://127.0.0.1:12345/'}, contents = {mainFrame: frame}, window = {webContents: contents};
  context.setArtTestWindow(window, {url:'http://127.0.0.1:12345'});
  const trusted = {sender: contents, senderFrame: frame};
  for (const [channel, payload] of [['art-files-import', PROJECT], ['art-files-preview',{workspaceId:PROJECT,storagePath:'fake'}], ['art-files-reveal',{workspaceId:PROJECT,storagePath:'fake'}]]) {
    for (const event of [{sender:{},senderFrame:frame}, {sender:contents,senderFrame:{url:frame.url}}]) await assert.rejects(handlers.get(channel)(event,payload), /不允许/);
  }
  assert.equal(calls.length,0); assert.equal(dialogs,0);
  await assert.rejects(handlers.get('reveal-project-data')({sender:{},senderFrame:frame},'project-id'),/不允许/);
  for(const operation of ['preview','apply','history','recover','release'])assert.throws(()=>handlers.get('engine-sync-'+operation)({sender:{},senderFrame:frame},{}),/不允许/);
  await assert.rejects(handlers.get('art-files-import')(trusted,{workspaceId:PROJECT,filePaths:['unselected']}), /工作区标识无效/);
  assert.equal(dialogs,0);
  await handlers.get('art-files-import')(trusted,PROJECT,['renderer-supplied-path']);
  assert.deepEqual(calls, [['import',PROJECT,dialogResult.filePaths]]);
  dialogResult = {canceled:true,filePaths:[]};
  assert.equal(await handlers.get('art-files-import')(trusted,PROJECT),null); assert.equal(calls.length,1);
  dialogResult = {canceled:false,filePaths:[path.resolve('late-selection.png')]};
  onDialog = () => context.setArtTestWindow(null, {url:'http://127.0.0.1:12345'});
  await assert.rejects(handlers.get('art-files-import')(trusted,PROJECT), /原工作区窗口已关闭/);
  assert.equal(calls.length,1);
  context.setArtTestWindow(window, {url:'http://127.0.0.1:12345'});
  onDialog = () => Object.defineProperty(trusted, 'senderFrame', {configurable:true,get(){throw new Error('Object has been destroyed');}});
  await assert.rejects(handlers.get('art-files-import')(trusted,PROJECT), /原工作区窗口已关闭/);
  assert.equal(calls.length,1);
  Object.defineProperty(trusted,'senderFrame',{configurable:true,writable:true,value:frame});
  onDialog = () => {};
  onReveal = () => context.setArtTestWindow(null, {url:'http://127.0.0.1:12345'});
  await assert.rejects(handlers.get('art-files-reveal')(trusted,{workspaceId:PROJECT,storagePath:'token'}), /原工作区窗口已关闭/);
  assert.ok(!calls.some(c=>c[0]==='reveal-native'));
  context.setArtTestWindow(window, {url:'http://127.0.0.1:12345'});
  frame.url = 'https://untrusted.example/';
  await assert.rejects(handlers.get('art-files-import')(trusted,PROJECT), /不允许/);
});

test('preload exposes only workspace/token operations, without a renderer-controlled import path', async () => {
  const vm = require('node:vm'), fsSync = require('node:fs'), invocations=[];
  let api;
  vm.runInNewContext(fsSync.readFileSync(path.join(__dirname,'../desktop/preload.cjs'),'utf8'), {require: name => {
    assert.equal(name,'electron');
    return {contextBridge: {exposeInMainWorld: (name,value) => {assert.equal(name,'desktopClient');api=value;}}, ipcRenderer:{invoke: async (...args) => {invocations.push(args);return null;},sendSync(){throw new Error('not used');}}};
  }});
  await api.revealProjectData('project-id','/private/unselected');
  assert.deepEqual(invocations.pop(), ['reveal-project-data','project-id']);
  await api.artFiles.importFiles(PROJECT, '/private/unselected.png');
  await api.artFiles.readPreview(PROJECT, 'asset-token');
  await api.artFiles.reveal(PROJECT, 'asset-token');
  assert.deepEqual(invocations[0], ['art-files-import',PROJECT]);
  assert.deepEqual(JSON.parse(JSON.stringify(invocations.slice(1))), [['art-files-preview',{workspaceId:PROJECT,storagePath:'asset-token'}],['art-files-reveal',{workspaceId:PROJECT,storagePath:'asset-token'}]]);
});
