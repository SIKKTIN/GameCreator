import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeSnapshot, emptyStore, stageSnapshot, diffEnums, planRelease, publishRelease,
  rollback, getExportSnapshot, snapshotById, exportIssues, replaceProjectData,
} from '../src/enum-versions.ts';
import { enumId } from '../src/data-model.ts';
import { readVersions, writeVersions } from '../src/enum-storage.ts';

const group = {
  name: 'Const_Test.Mode', source: 'Script/Const/Const_Test.lua', line: 2, comment: '',
  valueType: 'number', members: [
    { key: 'A', value: 1, line: 3, comment: '' }, { key: 'B', value: 2, line: 4, comment: '' },
  ],
};
const scan = {
  projectPath: 'E:/Fixture', enumPath: 'Script/Const', files: [group.source],
  groups: [group], orderTables: [], dynamic: [], counts: { files: 1, groups: 1, members: 2 },
};
function data() {
  const result = { datasets: {}, columns: {} };
  for (const table of ['items', 'characters', 'skills', 'economy', 'shop']) { result.datasets[table] = []; result.columns[table] = []; }
  result.columns.items = [{ key: 'mode', label: '模式', type: 'enum', enumId: enumId(group) }];
  result.datasets.items = [{ id: 'item_1', mode: 'B', name: '原名称' }];
  return result;
}
function changed(members) {
  return { ...structuredClone(scan), groups: [{ ...structuredClone(group), members: members.map(([key, value]) => ({ key, value, line: 3, comment: '' })) }] };
}
async function baseline() {
  const store = stageSnapshot(emptyStore(data()), await makeSnapshot(scan, 'source'));
  return publishRelease(store);
}
async function candidate(store, source) { return stageSnapshot(store, await makeSnapshot(source, 'source')); }
function approve(store, predicate = () => true) {
  const review = store.reviews[store.candidateId];
  const changes = diffEnums(snapshotById(store, store.activeId)?.scan ?? null, snapshotById(store, store.candidateId).scan);
  review.selected = changes.filter(predicate).map((change) => change.id);
  review.acknowledged = changes.filter(predicate).map((change) => change.id);
  review.note = '已审核影响与迁移';
  return changes;
}

test('first scan is only a candidate; first release is explicit', async () => {
  const store = stageSnapshot(emptyStore(data()), await makeSnapshot(scan, 'source'));
  assert.equal(store.activeId, null);
  assert.throws(() => getExportSnapshot(store), /尚未发布/);
  const published = await publishRelease(store);
  assert.ok(published.activeId);
  assert.equal(store.activeId, null);
  assert.equal(published.candidateId, null);
});
test('source snapshots are detached from live objects and carry SHA-256', async () => {
  const input = structuredClone(scan);
  const snapshot = await makeSnapshot(input, 'source');
  input.groups[0].members[0].value = 99;
  assert.equal(snapshot.scan.groups[0].members[0].value, 1);
  assert.equal(snapshot.checksum.length, 64);
});
test('scan does not alter stable values, and partial approval preserves unselected changes', async () => {
  const old = await baseline();
  const staged = await candidate(old, changed([['A', 99], ['B', 2], ['C', 3]]));
  assert.equal(snapshotById(staged, staged.activeId).scan.groups[0].members[0].value, 1);
  // Only low-risk additions are selected by default.
  const next = await publishRelease(staged);
  assert.deepEqual(snapshotById(next, next.activeId).scan.groups[0].members.map(({ key, value }) => [key, value]), [['A', 1], ['B', 2], ['C', 3]]);
  assert.equal(getExportSnapshot(staged).scan.groups[0].members[0].value, 1);
});
test('high-risk selection requires acknowledgement and a review note', async () => {
  const staged = await candidate(await baseline(), changed([['A', 9], ['B', 2]]));
  const change = diffEnums(scan, snapshotById(staged, staged.candidateId).scan)[0];
  staged.reviews[staged.candidateId].selected = [change.id];
  await assert.rejects(publishRelease(staged), /高风险/);
  staged.reviews[staged.candidateId].acknowledged = [change.id];
  await assert.rejects(publishRelease(staged), /审核说明/);
});
test('used member deletion requires a migration; explicit rename migrates only matching cells', async () => {
  const staged = await candidate(await baseline(), changed([['A', 1], ['C', 3]]));
  const changes = approve(staged);
  await assert.rejects(publishRelease(staged), /替换或保留/);
  const deletion = changes.find((change) => change.kind === 'remove-member');
  staged.reviews[staged.candidateId].migrations[deletion.id] = { mode: 'replace', target: 'C' };
  const next = await publishRelease(staged);
  assert.equal(next.data.datasets.items[0].mode, 'C');
  assert.equal(staged.data.datasets.items[0].mode, 'B');
  assert.equal(next.releases[next.releases.length - 1].patches[0].before, 'B');
  assert.equal(exportIssues(next.data, snapshotById(next, next.activeId).scan).length, 0);
});
test('retaining removed values is explicit and blocks export', async () => {
  const staged = await candidate(await baseline(), changed([['A', 1]]));
  const deletion = approve(staged).find((change) => change.kind === 'remove-member');
  staged.reviews[staged.candidateId].migrations[deletion.id] = { mode: 'retain' };
  const next = await publishRelease(staged);
  assert.equal(next.data.datasets.items[0].mode, 'B');
  assert.throws(() => getExportSnapshot(next), /未知枚举/);
});
test('invalid replacement or deleting a bound enum group blocks publication', async () => {
  const staged = await candidate(await baseline(), changed([['A', 1]]));
  const deletion = approve(staged).find((change) => change.kind === 'remove-member');
  staged.reviews[staged.candidateId].migrations[deletion.id] = { mode: 'replace', target: 'MISSING' };
  assert.ok(planRelease(staged).errors.some((error) => error.includes('替换目标')));
  const removed = await candidate(await baseline(), { ...scan, groups: [] });
  approve(removed);
  assert.ok(planRelease(removed).errors.some((error) => error.includes('仍被字段绑定')));
});
test('mixed types, aliases and stale review baselines cannot publish', async () => {
  for (const members of [[['A', 'one'], ['B', 2]], [['A', 2], ['B', 2]]]) {
    const staged = await candidate(await baseline(), changed(members));
    approve(staged);
    assert.ok(planRelease(staged).errors.length > 0);
  }
  const staged = await candidate(await baseline(), changed([['A', 1], ['B', 2], ['C', 3]]));
  staged.reviews[staged.candidateId].baseId = 'old-version';
  assert.ok(planRelease(staged).errors.some((error) => error.includes('稳定版本已变化')));
});
test('rollback restores migrated keys and preserves unrelated later edits', async () => {
  const staged = await candidate(await baseline(), changed([['A', 1], ['C', 3]]));
  const deletion = approve(staged).find((change) => change.kind === 'remove-member');
  staged.reviews[staged.candidateId].migrations[deletion.id] = { mode: 'replace', target: 'C' };
  const next = await publishRelease(staged);
  next.data.datasets.items[0].name = '后续编辑';
  const restored = rollback(next);
  assert.equal(restored.data.datasets.items[0].mode, 'B');
  assert.equal(restored.data.datasets.items[0].name, '后续编辑');
  next.data.datasets.items[0].mode = 'A';
  assert.throws(() => rollback(next), /发布后修改/);
});
test('rollback rejects newly bound enums unavailable in the previous stable version', async () => {
  const other = { ...group, name: 'Const_Test.Other' };
  const staged = await candidate(await baseline(), { ...scan, groups: [group, other] });
  const next = await publishRelease(staged);
  next.data.columns.items[0].enumId = enumId(other);
  assert.throws(() => rollback(next), /目标版本中不存在/);
});
test('storage saves versions, decisions and data together; stale writes are rejected', async () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const published = await baseline();
  const staged = await candidate(published, changed([['A', 1], ['B', 2], ['C', 3]]));
  const saved = writeVersions(storage, 'project', 0, staged);
  const restored = readVersions(storage, 'project', data());
  assert.deepEqual(restored, saved);
  assert.equal(restored.reviews[restored.candidateId].selected.length, 1);
  assert.throws(() => writeVersions(storage, 'project', 0, published), /其他页面/);
  const before = values.get('project');
  assert.throws(() => writeVersions({ ...storage, setItem: () => { throw new Error('quota'); } }, 'project', 1, published), /quota/);
  assert.equal(values.get('project'), before);
});
test('corrupt storage fails closed', () => {
  assert.throws(() => readVersions({ getItem: () => '{"schema":7}', setItem: () => {} }, 'project', data()), /存档格式异常/);
});
test('rollback preserves pre-existing invalid values while still blocking export', async () => {
  const old = await baseline();
  old.data.datasets.items.push({ id: 'invalid_1', mode: 'LEGACY_UNKNOWN' });
  const staged = await candidate(old, changed([['A', 1], ['C', 3]]));
  const deletion = approve(staged).find((change) => change.kind === 'remove-member');
  staged.reviews[staged.candidateId].migrations[deletion.id] = { mode: 'replace', target: 'C' };
  const next = await publishRelease(staged);
  const restored = rollback(next);
  assert.equal(restored.data.datasets.items[0].mode, 'B');
  assert.equal(restored.data.datasets.items[1].mode, 'LEGACY_UNKNOWN');
  assert.throws(() => getExportSnapshot(restored), /未知枚举成员/);
});
test('metadata and sorting are reviewable without accepting value changes', async () => {
  const source = changed([['B', 20], ['A', 1]]);
  source.groups[0].comment = '新说明';
  source.groups[0].members[0].comment = '新成员注释';
  const staged = await candidate(await baseline(), source);
  const next = await publishRelease(staged);
  const result = snapshotById(next, next.activeId).scan.groups[0];
  assert.deepEqual(result.members.map((member) => member.key), ['B', 'A']);
  assert.equal(result.members[0].value, 2);
  assert.equal(result.members[0].comment, '新成员注释');
  assert.equal(result.comment, '新说明');
});
test('an edit queued before a migration cannot overwrite migrated data', async () => {
  const staged = await candidate(await baseline(), changed([['A', 1], ['C', 3]]));
  const oldData = structuredClone(staged.data);
  const deletion = approve(staged).find((change) => change.kind === 'remove-member');
  staged.reviews[staged.candidateId].migrations[deletion.id] = { mode: 'replace', target: 'C' };
  const next = await publishRelease(staged);
  const edit = structuredClone(oldData);
  edit.datasets.items[0].name = '旧页面排队的编辑';
  assert.throws(() => replaceProjectData(next, oldData, edit), /数据已被/);
  assert.equal(next.data.datasets.items[0].mode, 'C');
});
