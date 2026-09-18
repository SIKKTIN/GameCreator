const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStorage } = require('../desktop/storage.cjs');
const { importLegacy } = require('../desktop/legacy-storage.cjs');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamecreator-storage-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  return {dir, storage:createStorage(path.join(dir,'storage'))};
}
const key = 'gamecreator.enum-versions.v1:e:/fixture';
function archive(time, active = true) {
  return JSON.stringify({schema:1, revision:3, activeId: active ? 'V-1' : null,
    snapshots:[{id:'V-1',kind:'release',createdAt:time}], reviews:{}, releases:[],
    data:{datasets:{items:[{id:'item1',name:time}]},columns:{items:[]}}});
}
test('disk records survive new storage instances and keep a prior backup', t => {
  const {dir,storage} = fixture(t);
  storage.setItem(key, '{"revision":1}');
  assert.equal(createStorage(path.join(dir,'storage')).getItem(key), '{"revision":1}');
  storage.setItem(key, '{"revision":2}');
  const backup = fs.readdirSync(storage.directory).find(name=>name.endsWith('.bak'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(storage.directory,backup))).value, '{"revision":1}');
});
test('failed atomic replacement preserves the last committed record', t => {
  const {storage} = fixture(t);
  storage.setItem(key, '{"revision":1}');
  const rename = fs.renameSync;
  fs.renameSync = (from,to) => { if(to.endsWith('.json')) throw new Error('disk full'); return rename(from,to); };
  try { assert.throws(()=>storage.setItem(key, '{"revision":2}'), /disk full/); }
  finally { fs.renameSync = rename; }
  assert.equal(storage.getItem(key), '{"revision":1}');
  assert.equal(fs.readdirSync(storage.directory).some(name=>name.endsWith('.tmp')), false);
});
test('invalid keys and corrupt existing archives cannot be overwritten', t => {
  const {storage} = fixture(t);
  assert.throws(()=>storage.setItem('../escape','{}'), /存档键/);
  assert.throws(()=>storage.setItem('gamecreator.auth.session','{}'), /存档键/);
  storage.setItem(key,'{}');
  const file=path.join(storage.directory, fs.readdirSync(storage.directory)[0]);
  fs.writeFileSync(file,'broken');
  assert.throws(()=>storage.getItem(key));
  assert.throws(()=>storage.setItem(key,'{"replacement":true}'));
  assert.equal(fs.readFileSync(file,'utf8'),'broken');
});
test('migration preserves every origin and chooses the latest published archive per project', t => {
  const {dir,storage} = fixture(t);
  const records = [
    {origin:'http://127.0.0.1:41001',items:{[key]:archive('2026-09-15')}},
    {origin:'http://127.0.0.1:41002',items:{[key]:archive('2026-09-18')}},
    {origin:'http://127.0.0.1:41003',items:{[key]:archive('2026-09-19',false)}},
  ];
  const backup = path.join(dir,'legacy');
  const selected=importLegacy(records,storage,backup);
  assert.equal(selected[0].origin,records[1].origin);
  assert.equal(storage.getItem(key),records[1].items[key]);
  assert.equal(fs.readdirSync(backup).length,3);
  storage.setItem(key,'{"already":"saved"}');
  importLegacy(records,storage,backup);
  assert.equal(storage.getItem(key),'{"already":"saved"}');
});
