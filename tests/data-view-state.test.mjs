import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  dataViewStorageKey, defaultDatasetViewState, normalizeDataViewState,
  patchDatasetViewState, patchDataViewState, readDataViewState, resolveActiveDataset,
} from '../src/data-view-state.ts';

function memory(entries = {}) {
  const values = new Map(Object.entries(entries));
  const writes = [];
  return { values, writes, getItem: key => values.get(key) ?? null, setItem(key, value) { writes.push(key); values.set(key, value); } };
}

test('table selection restores a valid preference or finds the first nonempty table', () => {
  const definitions = ['items', 'rooms', 'enemies'].map(key => ({ key }));
  const data = { datasets: { items: [], rooms: [{ id: 'room_1' }], enemies: [{ id: 'enemy_1' }] } };
  assert.equal(resolveActiveDataset(definitions, data), 'rooms');
  assert.equal(resolveActiveDataset(definitions, data, 'items'), 'items');
  assert.equal(resolveActiveDataset(definitions, data, 'enemies'), 'enemies');
  assert.equal(resolveActiveDataset(definitions, data, 'deleted_table'), 'rooms');
  assert.equal(resolveActiveDataset(definitions, { datasets: { items: [], rooms: [] } }), 'items');
  assert.equal(resolveActiveDataset([], { datasets: {} }), '');
});

test('view state is project scoped and never changes configuration data archives', () => {
  const archiveKey = 'gamecreator.enum-versions.v1:project-a';
  const archive = '{"revision":14,"data":"unchanged"}';
  const storage = memory({ [archiveKey]: archive });
  assert.equal(patchDataViewState('project-a', { activeDataset: 'rooms', directoryWidth: 260 }, storage), true);
  assert.equal(patchDatasetViewState('project-a', 'rooms', { query: '入口', selectedId: 'room_1', detailOpen: true }, storage), true);
  assert.equal(patchDataViewState('project-b', { activeDataset: 'crops' }, storage), true);
  assert.equal(readDataViewState('project-a', storage).activeDataset, 'rooms');
  assert.equal(readDataViewState('project-a', storage).tables.rooms.selectedId, 'room_1');
  assert.equal(readDataViewState('project-b', storage).activeDataset, 'crops');
  assert.deepEqual(readDataViewState('project-b', storage).tables, {});
  assert.equal(storage.getItem(archiveKey), archive);
  assert.ok(storage.writes.every(key => key.startsWith('gamecreator.workspace.v1:') && key.endsWith(':data-view')));
});

test('a delayed table patch retains the latest directory and other table preferences', () => {
  const storage = memory();
  patchDatasetViewState('project', 'rooms', { query: '门', scrollTop: 60 }, storage);
  patchDataViewState('project', { activeDataset: 'enemies', emptyExpanded: true }, storage);
  patchDatasetViewState('project', 'enemies', { filter: 'warning', selectedId: 'enemy_1' }, storage);
  patchDatasetViewState('project', 'rooms', { scrollLeft: 200 }, storage);
  const state = readDataViewState('project', storage);
  assert.equal(state.activeDataset, 'enemies');
  assert.equal(state.emptyExpanded, true);
  assert.equal(state.tables.rooms.query, '门');
  assert.equal(state.tables.rooms.scrollTop, 60);
  assert.equal(state.tables.rooms.scrollLeft, 200);
  assert.equal(state.tables.enemies.selectedId, 'enemy_1');
  assert.equal(state.tables.enemies.filter, 'warning');
});

test('invalid stored values are bounded and prototype keys are excluded', () => {
  const input = JSON.parse('{"version":1,"activeDataset":42,"directoryWidth":900,"directoryCollapsed":"true","tables":{"rooms":{"query":false,"filter":"bad","selectedId":null,"detailOpen":1,"scrollTop":-4,"scrollLeft":"12"},"__proto__":{"selectedId":"bad"}}}');
  const state = normalizeDataViewState(input);
  assert.equal(state.activeDataset, '');
  assert.equal(state.directoryWidth, 300);
  assert.equal(state.directoryCollapsed, false);
  assert.deepEqual(state.tables.rooms, defaultDatasetViewState());
  assert.equal(Object.prototype.hasOwnProperty.call(state.tables, '__proto__'), false);
  assert.equal(normalizeDataViewState({ directoryWidth: -2 }).directoryWidth, 180);
  assert.equal(normalizeDataViewState({ directoryWidth: NaN }).directoryWidth, 220);
  assert.equal(patchDatasetViewState('project', '__proto__', {}, memory()), false);
});

test('unavailable storage is harmless and unreadable or future preferences are not overwritten', () => {
  const denied = { getItem() { throw new Error('unavailable'); }, setItem() { throw new Error('unavailable'); } };
  assert.equal(readDataViewState('project', denied).directoryWidth, 220);
  assert.equal(patchDataViewState('project', { activeDataset: 'rooms' }, denied), false);
  assert.equal(patchDatasetViewState('project', 'rooms', { query: 'test' }, denied), false);
  for (const raw of ['broken json', '{"version":2,"futureState":"keep"}']) {
    const storage = memory({ [dataViewStorageKey('project')]: raw });
    assert.equal(readDataViewState('project', storage).activeDataset, '');
    assert.equal(patchDataViewState('project', { activeDataset: 'rooms' }, storage), false);
    assert.equal(storage.getItem(dataViewStorageKey('project')), raw);
    assert.deepEqual(storage.writes, []);
  }
});


test('desktop storage accepts preferences and routes test-project paths into their isolated archive', async t => {
  const { createWorkspaceStorage } = createRequire(import.meta.url)('../desktop/test-workspaces.cjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gamecreator-data-view-'));
  t.after(async () => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('gamecreator-data-view-'));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  let storage = createWorkspaceStorage(directory);
  const testId = '00000000-0000-4000-8000-000000000001';
  const projectPath = path.join(directory, 'test-workspaces', testId, 'project').replace(/\\/g, '/').toLowerCase();
  assert.equal(patchDataViewState('project-formal', { activeDataset: 'rooms' }, storage), true);
  assert.equal(patchDataViewState(projectPath, { activeDataset: 'modes' }, storage), true);
  assert.equal(patchDatasetViewState(projectPath, 'modes', { query: 'A', detailOpen: true }, storage), true);
  assert.equal(storage.info(dataViewStorageKey('project-formal')).directory, path.join(directory, 'storage'));
  assert.equal(storage.info(dataViewStorageKey(projectPath)).directory, path.join(directory, 'test-workspaces', testId, 'storage'));
  storage = createWorkspaceStorage(directory);
  assert.equal(readDataViewState('project-formal', storage).activeDataset, 'rooms');
  assert.equal(readDataViewState(projectPath, storage).activeDataset, 'modes');
  assert.equal(readDataViewState(projectPath, storage).tables.modes.query, 'A');
});
