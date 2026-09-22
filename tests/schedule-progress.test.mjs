import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionTask, createProductionMilestone, validateProjectSchedule } from '../src/project-schedule.ts';
import { scheduleProgressLayout, progressGeometry, setProgressTaskStatus } from '../src/schedule-progress.ts';
const task = (id, kind = '程序', dependencyIds = []) => ({ ...createProductionTask(id), id, kind, dependencyIds });

test('role lanes reflect dependencies and parallel work without inventing links', () => {
  const tasks = [task('设计', '设计'), task('程序甲', '程序', ['设计']), task('程序乙', '程序', ['设计']), task('美术', '美术', ['设计']), task('测试', '测试', ['程序甲', '程序乙', '美术']), task('未排期', '其他')];
  tasks[1].status = '已完成'; const before = structuredClone(tasks), layout = scheduleProgressLayout(tasks);
  const node = id => layout.nodes.find(n => n.task.id === id);
  assert.deepEqual(layout.lanes.map(l => l.kind), ['设计', '程序', '美术', '测试', '其他']);
  assert.equal(node('设计').column, 0); assert.equal(node('程序甲').column, 1); assert.equal(node('程序乙').column, 1); assert.equal(node('测试').column, 2);
  assert.equal(node('程序甲').x, node('程序乙').x); assert.ok(Math.abs(node('程序甲').y - node('程序乙').y) >= progressGeometry.height);
  assert.equal(node('未排期').column, 0); assert.equal(layout.edges.length, 6);
  assert.deepEqual(layout.lanes.find(l => l.kind === '程序'), { kind: '程序', y: layout.lanes[0].y + layout.lanes[0].height, height: 2 * progressGeometry.row + 52, total: 2, completed: 1, visible: 2 });
  assert.deepEqual(tasks, before);
});

test('filters preserve global dependency positions and actual completion denominators', () => {
  const tasks = [task('前置', '设计'), task('程序一', '程序', ['前置']), task('程序二', '程序', ['程序一'])]; tasks[1].status = '已完成';
  const filtered = scheduleProgressLayout(tasks, new Set(['程序二']), new Set(['程序']));
  assert.equal(filtered.nodes.length, 1); assert.equal(filtered.nodes[0].column, 2); assert.equal(filtered.edges.length, 0);
  assert.equal(filtered.lanes.length, 1); assert.equal(filtered.lanes[0].completed, 1); assert.equal(filtered.lanes[0].total, 2); assert.equal(filtered.lanes[0].visible, 1);
  assert.deepEqual(scheduleProgressLayout(tasks, new Set()).nodes, []);
});

test('cycle members, downstream tasks, self loops and missing references render finitely and distinctly', () => {
  const tasks = [task('A', '程序', ['B']), task('B', '美术', ['A']), task('C', '测试', ['B']), task('D', '设计', ['不存在']), task('自己', '其他', ['自己'])];
  const layout = scheduleProgressLayout(tasks), get = id => layout.nodes.find(n => n.task.id === id);
  for (const id of ['A', 'B', '自己']) assert.equal(get(id).cyclic, true);
  assert.equal(get('C').cyclic, false); assert.equal(get('D').cyclic, false); assert.ok(get('C').column > get('B').column);
  assert.equal(layout.edges.filter(e => e.cyclic).length, 3); assert.equal(layout.edges.length, 4);
  assert.ok(Number.isFinite(layout.width) && Number.isFinite(layout.height));
});

test('large dependency chains use an iterative layout and never overlap cards in a role', () => {
  const tasks = Array.from({ length: 2000 }, (_, i) => task('任务' + i, '程序', i ? ['任务' + (i - 1)] : []));
  const layout = scheduleProgressLayout(tasks);
  assert.equal(layout.columns, 2000); assert.equal(layout.nodes.at(-1).column >= 0, true);
  assert.equal(layout.nodes.find(n => n.task.id === '任务1999').column, 1999); assert.equal(layout.edges.length, 1999);
  assert.equal(new Set(layout.nodes.map(n => n.x + ':' + n.y)).size, 2000);
  assert.deepEqual(scheduleProgressLayout([]).nodes, []);
});

test('manual completion and reopening change only the chosen status and preserve dates, results and milestones', () => {
  const a = task('程序'), b = task('测试', '测试', ['程序']), milestone = createProductionMilestone('灰盒验收');
  Object.assign(a, { start: '2026-09-21', end: '2026-09-22', actualStart: '2026-09-21', actualEnd: '', result: '已有验收记录', milestoneId: milestone.id });
  const store = { schema: 1, tasks: [a, b], milestones: [milestone] }, before = structuredClone(store);
  const done = validateProjectSchedule(setProgressTaskStatus(store, a.id, '待开始', '已完成'));
  assert.deepEqual(done.tasks[0], { ...a, status: '已完成' }); assert.deepEqual(done.tasks[1], b); assert.deepEqual(done.milestones, before.milestones); assert.deepEqual(store, before);
  assert.equal(scheduleProgressLayout(done.tasks).lanes.find(l => l.kind === '程序').completed, 1);
  const reopened = setProgressTaskStatus(done, a.id, '已完成', '进行中'); assert.deepEqual(reopened.tasks[0], { ...a, status: '进行中' });
  assert.throws(() => setProgressTaskStatus(done, a.id, '待开始', '进行中'), /状态已变化/);
  assert.throws(() => setProgressTaskStatus(done, 'missing', '待开始', '已完成'), /已被删除/);
});
