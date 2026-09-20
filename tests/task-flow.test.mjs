import test from 'node:test';
import assert from 'node:assert/strict';
import { createTask, createTaskStage, validateTaskFlows, taskFlowIssues, taskStageReady, startTaskPreview, advanceTaskPreview, copyTask, removeTaskStage, readTaskFlows, writeTaskFlows, taskReferenceLabel } from '../src/task-flow.ts';
function fixture() {
  const task = createTask('交付萝卜'), stage = createTaskStage(), success = createTaskStage('success'), failure = createTaskStage('failure');
  stage.objectives = [{ id: 'turnips', title: '当前萝卜数量', condition: '背包中的可用萝卜，允许数量回退', target: 3 }, { id: 'deadline', title: '到期', condition: '第七日结算开始', target: 1 }];
  stage.mode = 'any'; success.result = '扣除3萝卜并增加40金币，仅一次'; failure.result = '不发放奖励';
  task.stages = [stage, success, failure]; task.startId = stage.id;
  task.transitions = [{ id: 'deliver', fromId: stage.id, toId: success.id, label: '交付', condition: '期限前且当前萝卜不少于3' }, { id: 'expire', fromId: stage.id, toId: failure.id, label: '到期', condition: '期限已过且未交付' }];
  return { task, stage, success, failure, store: { schema: 1, tasks: [task] } };
}
test('manual preview gates on ALL/ANY progress, requires branch assumptions, supports failure and never writes to design', () => {
  const { task, stage, success, failure } = fixture(), before = JSON.stringify(task);
  const start = startTaskPreview(task);
  assert.throws(() => advanceTaskPreview(task, start, 'deliver', true), /目标/);
  const partial = { ...start, counts: { turnips: 2 } }; assert.equal(taskStageReady(stage, partial.counts), false);
  const ready = { ...start, counts: { turnips: 3 } }; assert.equal(taskStageReady(stage, ready.counts), true);
  assert.equal(taskStageReady({ ...stage, mode: 'all' }, ready.counts), false);
  assert.equal(taskStageReady({ ...stage, mode: 'all' }, { turnips: 3, deadline: 1 }), true);
  assert.throws(() => advanceTaskPreview(task, ready, 'deliver', false), /假定/);
  const finish = advanceTaskPreview(task, ready, 'deliver', true); assert.equal(finish.stageId, success.id);
  assert.deepEqual(finish.history[0].counts, { turnips: 3 }); assert.deepEqual(finish.counts, {});
  assert.throws(() => advanceTaskPreview(task, finish, 'deliver', true));
  assert.equal(advanceTaskPreview(task, { ...start, counts: { deadline: 1 } }, 'expire', true).stageId, failure.id);
  assert.equal(taskStageReady(stage, { turnips: 0 }), false, 'spending the items must remove readiness');
  assert.equal(JSON.stringify(task), before);
});
test('cycles with an exit are valid, unreachable stages and dead ends are reported, terminal edges cannot hide unreachable content', () => {
  const { task, stage, success, store } = fixture();
  assert.deepEqual(taskFlowIssues(store), []);
  task.transitions.push({ id: 'retry', fromId: stage.id, toId: stage.id, label: '重试', condition: '仍可继续' }); assert.deepEqual(taskFlowIssues(store), []);
  const orphan = createTaskStage(); orphan.objectives = [{ id: 'orphan-goal', title: '测试', condition: '测试', target: 1 }]; task.stages.push(orphan);
  task.transitions.push({ id: 'after-end', fromId: success.id, toId: orphan.id, label: '', condition: '' });
  assert.ok(taskFlowIssues(store).some(i => i.stageId === orphan.id && /无法到达/.test(i.message)));
  assert.ok(taskFlowIssues(store).some(i => /结果阶段不应继续/.test(i.message)));
  task.transitions = task.transitions.filter(e => e.id === 'retry'); assert.ok(taskFlowIssues(store).some(i => i.stageId === stage.id && /无法到达完成/.test(i.message)));
});
test('prerequisites detect locked cycles and missing/archived targets, but ANY with a valid external path can unlock', () => {
  const a = createTask('A'), b = createTask('B'), c = createTask('C'), store = { schema: 1, tasks: [a, b, c] };
  a.prerequisiteIds = [b.id]; b.prerequisiteIds = [a.id];
  assert.equal(taskFlowIssues(store).filter(i => /前置关系无法/.test(i.message)).length, 2);
  a.prerequisiteIds.push(c.id); a.prerequisiteMode = 'any';
  assert.equal(taskFlowIssues(store).filter(i => /前置关系无法/.test(i.message)).length, 0);
  c.archived = true; assert.equal(taskFlowIssues(store).filter(i => /前置关系无法/.test(i.message)).length, 2);
  b.prerequisiteIds = ['removed']; assert.ok(taskFlowIssues(store).some(i => /已失效/.test(i.message)));
});
test('copy remaps all owned IDs and branch endpoints, preserves external prerequisites and references, and allows safe stage removal', () => {
  const { task, stage, store } = fixture(); task.prerequisiteIds = ['external']; task.references = [{ kind: 'table', targetId: 'items', recordId: 'turnip' }]; task.archived = true; task.status = '已确认';
  const copied = copyTask(task); validateTaskFlows({ schema: 1, tasks: [...store.tasks, copied] });
  assert.notEqual(copied.id, task.id); assert.equal(copied.startId, copied.stages[0].id); assert.equal(copied.transitions[0].fromId, copied.startId);
  assert.deepEqual(copied.references, task.references); assert.deepEqual(copied.prerequisiteIds, ['external']); assert.equal(copied.archived, false); assert.equal(copied.status, '草稿');
  assert.throws(() => removeTaskStage(task, stage.id), /先调整/);
  const unused = createTaskStage(); task.stages.push(unused); assert.equal(removeTaskStage(task, unused.id).stages.length, 3);
});
test('malformed shapes and duplicate IDs are rejected; incomplete references remain repairable drafts', () => {
  for (const mutate of [s => { s.schema = 2; }, s => { s.tasks[0].stages[0].objectives[0].target = 0; }, s => { s.tasks[0].stages[0].objectives[0].target = 1.5; }, s => { s.tasks[0].stages[1].id = s.tasks[0].id; }, s => { s.tasks[0].prerequisiteIds = ['x', 'x']; }, s => { s.tasks[0].references = [{ kind: 'script', targetId: 'x', recordId: '' }]; }]) {
    const { store } = fixture(); mutate(store); assert.throws(() => validateTaskFlows(store), /格式异常/);
  }
  const { store } = fixture(); store.tasks[0].transitions[0].toId = 'missing'; assert.equal(validateTaskFlows(store), store); assert.ok(taskFlowIssues(store).some(i => /端点已失效/.test(i.message)));
});
test('missing storage is read-only, writes reject stale and corrupt data, and failed writes can be retried', () => {
  let raw = null, fail = false; const storage = { getItem: () => raw, setItem: (_, value) => { if (fail) throw Error('disk full'); raw = value; } };
  assert.deepEqual(readTaskFlows(storage, 'a').store, { schema: 1, tasks: [] }); assert.equal(raw, null);
  const { store } = fixture(); const saved = writeTaskFlows(storage, 'a', null, store);
  assert.throws(() => writeTaskFlows(storage, 'a', null, store), /其他窗口/); assert.equal(raw, saved);
  fail = true; assert.throws(() => writeTaskFlows(storage, 'a', saved, store), /disk full/); assert.equal(raw, saved);
  fail = false; assert.equal(writeTaskFlows(storage, 'a', saved, store), saved);
  raw = '{"schema":99}'; assert.throws(() => readTaskFlows(storage, 'a')); assert.throws(() => writeTaskFlows(storage, 'a', raw, store)); assert.equal(raw, '{"schema":99}');
});
test('references follow source names, retain missing records and flag archived content', () => {
  const sources = { designs: [{ id: 'play', title: '最新名称', archived: true }], capabilities: [], stories: [], assets: [], definitions: [{ key: 'items', label: '物品' }], data: { datasets: { items: [{ id: 'turnip', name: '萝卜' }] } } };
  const ref = { kind: 'table', targetId: 'items', recordId: 'turnip' };
  assert.deepEqual(taskReferenceLabel(ref, sources), { label: '物品 / 萝卜', available: true });
  sources.data.datasets.items = []; assert.equal(taskReferenceLabel(ref, sources).available, false);
  assert.deepEqual(taskReferenceLabel({ kind: 'gameplay', targetId: 'play', recordId: '' }, sources), { label: '最新名称（已归档）', available: false });
});
