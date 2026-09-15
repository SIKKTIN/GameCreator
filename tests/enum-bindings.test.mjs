import assert from 'node:assert/strict';
import test from 'node:test';
import { enumId, enumOptions, resolveEnumValue, validateCell, validateRow } from '../src/data-model.ts';
import { scanEngineProject, defaultEngineConfig } from '../src/engine.ts';

const mode = {
  name: 'Const_GameMode.ModeID', source: 'Script/Const/Package/GameMode/Const_GameMode.lua',
  valueType: 'number', line: 4, comment: '模式',
  members: [{ key: 'HALL', value: 1001, line: 5, comment: '' }, { key: 'LEVEL_1', value: 1002, line: 6, comment: '' }],
};
const map = { ...mode, name: 'Const_GameMode.MapID', valueType: 'string', members: [{ ...mode.members[0], value: 'Hall' }] };
const scan = { groups: [mode, map], files: [mode.source], orderTables: [], dynamic: [], counts: { files: 1, groups: 2, members: 3 } };
const registry = { scan, ready: true };
const column = { key: 'modeID', label: '模式', type: 'enum', enumId: enumId(mode) };
const data = { columns: { items: [column] }, datasets: { items: [{ id: 'record_1', modeID: 'HALL' }] } };

test('same member key resolves independently to a Lua number or string', () => {
  assert.equal(resolveEnumValue(column, 'HALL', registry), 1001);
  assert.equal(resolveEnumValue({ ...column, enumId: enumId(map) }, 'HALL', registry), 'Hall');
  assert.equal(enumOptions(column, registry)[0].label, 'HALL = 1001');
  assert.equal(enumOptions({ ...column, enumId: enumId(map) }, registry)[0].label, 'HALL = "Hall"');
});
test('rescan deleting a member invalidates the record without overwriting its stored key', () => {
  const next = { scan: { ...scan, groups: [{ ...mode, members: mode.members.slice(1) }, map] }, ready: true };
  assert.equal(validateRow(data.datasets.items[0], [column], data, registry).length, 0);
  assert.match(validateRow(data.datasets.items[0], [column], data, next)[0].message, /未知枚举成员/);
  assert.equal(data.datasets.items[0].modeID, 'HALL');
  assert.equal(resolveEnumValue(column, 'HALL', next), undefined);
  assert.equal(validateCell(column, 'LEVEL_1', data, next), '');
});
test('removed groups and stale scans cannot validate against cached definitions', () => {
  assert.match(validateCell(column, 'HALL', data, { scan: { ...scan, groups: [] }, ready: true }), /枚举已不存在/);
  assert.match(validateCell(column, 'HALL', data, { scan, ready: false }), /待同步/);
  assert.equal(resolveEnumValue(column, 'HALL', { scan, ready: false }), undefined);
});
test('a value change updates typed resolution while keeping the member binding', () => {
  const next = { scan: { ...scan, groups: [{ ...mode, members: [{ ...mode.members[0], value: 2001 }] }] }, ready: true };
  assert.equal(resolveEnumValue(column, 'HALL', next), 2001);
  assert.equal(validateCell(column, 'HALL', data, next), '');
});
test('identically named definitions in different files do not collide', () => {
  const other = { ...mode, source: 'Script/Const/Other/Const_GameMode.lua' };
  assert.notEqual(enumId(mode), enumId(other));
  assert.equal(resolveEnumValue({ ...column, enumId: enumId(other) }, 'HALL', registry), undefined);
});
test('legacy options still validate, new enum fields require a binding', () => {
  const legacy = { key: 'rarity', label: '稀有度', type: 'enum', options: ['普通', '稀有'] };
  assert.equal(validateCell(legacy, '普通', data, registry), '');
  assert.match(validateCell(legacy, '传说', data, registry), /未知/);
  assert.match(validateCell({ ...legacy, options: undefined }, '普通', data, registry), /绑定/);
});
test('static HTML from an unavailable API produces an actionable error', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html>Vite fallback</html>', { status: 200 });
  try { await assert.rejects(scanEngineProject(defaultEngineConfig), /接口返回无效结果/); }
  finally { globalThis.fetch = original; }
});
