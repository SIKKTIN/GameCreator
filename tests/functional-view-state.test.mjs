import test from 'node:test';
import assert from 'node:assert/strict';
import { functionalViewKey, readFunctionalView, patchFunctionalExpansion } from '../src/functional-view-state.ts';
const memory = () => { const values = new Map(); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };
test('fold preferences are isolated by project and preserve unrelated groups across patches', () => {
  const storage = memory();
  assert.deepEqual(readFunctionalView('a', storage).collapsedIds, []); assert.equal(storage.values.size, 0);
  storage.setItem('gamecreator.workspace.v1:a:functional-systems', 'unchanged project content');
  assert.equal(patchFunctionalExpansion('a', ['player'], false, storage), true);
  patchFunctionalExpansion('a', ['enemy'], false, storage);
  patchFunctionalExpansion('a', ['player'], true, storage);
  assert.deepEqual(readFunctionalView('a', storage).collapsedIds, ['enemy']);
  assert.deepEqual(readFunctionalView('b', storage).collapsedIds, []);
  assert.equal(storage.getItem('gamecreator.workspace.v1:a:functional-systems'), 'unchanged project content');
});
test('damaged or newer preference archives remain untouched and reads fall back safely', () => {
  for (const raw of ['{broken', '{"schema":2,"collapsedIds":[]}', '{"schema":1,"collapsedIds":[null]}']) {
    const storage = memory(); storage.setItem(functionalViewKey('a'), raw);
    assert.deepEqual(readFunctionalView('a', storage).collapsedIds, []);
    assert.equal(patchFunctionalExpansion('a', ['player'], false, storage), false);
    assert.equal(storage.getItem(functionalViewKey('a')), raw);
  }
});
test('preference write failure is reported without changing project content', () => {
  const storage = memory(); storage.setItem(functionalViewKey('a'), '{"schema":1,"collapsedIds":["enemy"]}');
  const failing = { getItem: storage.getItem, setItem: () => { throw Error('disk failure'); } };
  assert.equal(patchFunctionalExpansion('a', ['player'], false, failing), false);
  assert.deepEqual(readFunctionalView('a', storage).collapsedIds, ['enemy']);
});
