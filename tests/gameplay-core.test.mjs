import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { emptyGameplayCore, createCoreNode, createCoreEdge, createCoreModule, removeCoreNode, validateGameplayCore, readGameplayCore, writeGameplayCore, coreIssues, gameplayCoreMarkdown } from '../src/gameplay-core.ts';
const require = createRequire(import.meta.url);
const { createWorkspaceStorage } = require('../desktop/test-workspaces.cjs');

function memory(initial = null) {
  let raw = initial, writes = 0;
  return { getItem: () => raw, setItem: (_, value) => { raw = value; writes++; }, get writes() { return writes; } };
}
function edge(a, b, label = '', condition = '') { return { ...createCoreEdge(a.id, b.id), label, condition }; }
function fixture() {
  let store = emptyGameplayCore();
  const menu = createCoreNode('entry', '主界面'), challenge = createCoreNode('module', '挑战模式'), endless = createCoreNode('module', '无尽模式');
  store.graphs[0].nodes = [menu, challenge, endless];
  store.graphs[0].edges = [edge(menu, challenge, '开始挑战'), edge(menu, endless, '进入无尽'), edge(challenge, menu, '返回主界面'), edge(endless, menu, '离开无尽')];
  store = createCoreModule(createCoreModule(store, store.rootId, challenge.id), store.rootId, endless.id);
  const challengeGraph = store.graphs.find(g => g.id === store.graphs[0].nodes.find(n => n.id === challenge.id).childGraphId);
  const start = createCoreNode('entry', '开始关卡'), prepare = createCoreNode('activity', '选择植物'), battle = createCoreNode('module', '挑战关卡'), reward = createCoreNode('decision', '获得奖励'), finish = createCoreNode('exit', '完成冒险');
  prepare.gameplayIds = ['plant-selection']; battle.gameplayIds = ['battle'];
  challengeGraph.nodes = [start, prepare, battle, reward, finish];
  challengeGraph.edges = [edge(start, prepare), edge(prepare, battle, '进入战斗'), edge(battle, reward, '获胜', '关卡目标达成'), edge(reward, prepare, '下一关', '还有未完成的关卡'), edge(reward, finish, '通关', '全部关卡完成并击败 Boss')];
  store = createCoreModule(store, challengeGraph.id, battle.id);
  const battleGraph = store.graphs.find(g => g.title === '挑战关卡'), fight = createCoreNode('entry', '战斗开始'), spawn = createCoreNode('activity', '生成下一波'), win = createCoreNode('exit', '战斗胜利');
  battleGraph.nodes = [fight, spawn, win];
  battleGraph.edges = [edge(fight, spawn), edge(spawn, spawn, '继续防守', '剩余波次大于零'), edge(spawn, win, '战斗完成', '敌人已清空')];
  const endlessGraph = store.graphs.find(g => g.title === '无尽模式'), endlessEntry = createCoreNode('entry', '准备无尽'), wave = createCoreNode('activity', '挑战下一轮');
  endlessGraph.nodes = [endlessEntry, wave]; endlessGraph.edges = [edge(endlessEntry, wave), edge(wave, wave, '继续挑战')];
  return { store, menu, challenge, endless, battle, challengeId: challengeGraph.id, battleId: battleGraph.id,
    designs: [{ id: 'plant-selection', title: '植物选择规则' }, { id: 'battle', title: '关卡战斗规则' }] };
}

test('older projects without the new storage key open an independent empty root without writes', () => {
  const storage = memory(), first = readGameplayCore(storage, 'old-project');
  assert.equal(first.raw, null); assert.deepEqual(first.store, emptyGameplayCore()); assert.equal(storage.writes, 0);
  first.store.graphs[0].nodes.push(createCoreNode('entry'));
  assert.equal(readGameplayCore(storage, 'old-project').store.graphs[0].nodes.length, 0);
  validateGameplayCore(emptyGameplayCore());
});

test('nested modules allow branches, returning to the menu, self loops and endless modes without exits', () => {
  const { store, designs } = fixture();
  assert.equal(validateGameplayCore(store), store);
  assert.deepEqual(coreIssues(store, designs), []);
  const endless = store.graphs.find(g => g.title === '无尽模式');
  assert.equal(endless.nodes.some(n => n.kind === 'exit'), false);
  assert.ok(endless.edges.some(e => e.fromId === e.toId));
});

test('creating an internal module graph is immutable, idempotent and restricted to module nodes', () => {
  const initial = emptyGameplayCore(), module = createCoreNode('module', '农场循环'), activity = createCoreNode('activity');
  initial.graphs[0].nodes = [module, activity];
  const next = createCoreModule(initial, initial.rootId, module.id), linked = next.graphs[0].nodes[0];
  assert.equal(initial.graphs.length, 1); assert.equal(module.childGraphId, '');
  assert.equal(next.graphs.length, 2); assert.equal(next.graphs[1].id, linked.childGraphId); assert.equal(next.graphs[1].title, '农场循环');
  assert.equal(createCoreModule(next, next.rootId, module.id), next);
  assert.throws(() => createCoreModule(initial, initial.rootId, activity.id), /循环模块/);
  assert.throws(() => createCoreModule(initial, 'missing', module.id), /循环模块/);
});

test('deleting a module removes nested graphs and incident edges while preserving sibling flows and external designs', () => {
  const { store, challenge, endless, designs } = fixture(), before = structuredClone(store), beforeDesigns = structuredClone(designs);
  const result = removeCoreNode(store, store.rootId, challenge.id);
  validateGameplayCore(result); assert.deepEqual(store, before); assert.deepEqual(designs, beforeDesigns);
  assert.equal(result.graphs.length, 2);
  assert.deepEqual(result.graphs.map(g => g.title), ['游戏入口', '无尽模式']);
  assert.ok(result.graphs[0].nodes.some(n => n.id === endless.id));
  assert.equal(result.graphs[0].edges.length, 2);
  assert.ok(result.graphs[0].edges.every(e => e.fromId !== challenge.id && e.toId !== challenge.id));
  assert.equal(removeCoreNode(result, result.rootId, 'missing'), result);
});

test('deleting an activity removes its self loop and all incoming/outgoing edges only', () => {
  const { store } = fixture(), endless = store.graphs.find(g => g.title === '无尽模式'), wave = endless.nodes[1];
  const result = removeCoreNode(store, endless.id, wave.id);
  assert.equal(result.graphs.length, store.graphs.length);
  const changed = result.graphs.find(g => g.id === endless.id);
  assert.equal(changed.nodes.length, 1); assert.equal(changed.edges.length, 0);
  validateGameplayCore(result);
});

test('strict archive shape rejects invalid IDs, positions, kinds and malformed references without overwriting storage', () => {
  const { store } = fixture();
  const mutations = [s => { s.schema = 2; }, s => { s.rootId = 'absent'; }, s => { s.graphs = []; }, s => { delete s.graphs[0].summary; },
    s => { s.graphs[0].id = ''; }, s => { s.graphs.push(structuredClone(s.graphs[0])); },
    s => { s.graphs[0].nodes[0].kind = 'system'; }, s => { s.graphs[0].nodes[0].x = Infinity; }, s => { s.graphs[0].nodes[0].y = '120'; },
    s => { s.graphs[0].nodes[0].id = ''; }, s => { s.graphs[1].nodes[0].id = s.graphs[0].nodes[0].id; },
    s => { s.graphs[0].nodes[0].gameplayIds = ['a', 'a']; }, s => { s.graphs[0].nodes[0].gameplayIds = ['']; },
    s => { s.graphs[0].edges[0].toId = 'missing'; }, s => { s.graphs[0].edges[0].toId = s.graphs[1].nodes[0].id; },
    s => { s.graphs[0].edges[0].id = s.graphs[1].edges[0].id; }, s => { delete s.graphs[0].edges[0].condition; }];
  for (const mutate of mutations) {
    const broken = structuredClone(store); mutate(broken);
    assert.throws(() => validateGameplayCore(broken), /格式异常/);
    const raw = JSON.stringify(broken), storage = memory(raw);
    assert.throws(() => readGameplayCore(storage, 'key'));
    assert.throws(() => writeGameplayCore(storage, 'key', raw, emptyGameplayCore()));
    assert.equal(storage.getItem(), raw); assert.equal(storage.writes, 0);
  }
});

test('module ownership rejects shared, missing, recursive and orphaned child graphs while allowing empty draft modules', () => {
  const { store } = fixture();
  const mutations = [s => { s.graphs[0].nodes[1].childGraphId = s.rootId; },
    s => { s.graphs[0].nodes[1].childGraphId = 'missing'; },
    s => { s.graphs[0].nodes[2].childGraphId = s.graphs[0].nodes[1].childGraphId; },
    s => { s.graphs[0].nodes[0].childGraphId = s.graphs[0].nodes[1].childGraphId; },
    s => { s.graphs[0].nodes[1].childGraphId = ''; },
    s => { s.graphs[1].nodes.find(n => n.kind === 'module').childGraphId = s.graphs[1].id; },
    s => { const a = createCoreNode('module'), b = createCoreNode('module'); a.childGraphId = 'island-b'; b.childGraphId = 'island-a'; s.graphs.push({ id: 'island-a', title: '', summary: '', nodes: [a], edges: [] }, { id: 'island-b', title: '', summary: '', nodes: [b], edges: [] }); }];
  for (const mutate of mutations) { const broken = structuredClone(store); mutate(broken); assert.throws(() => validateGameplayCore(broken), /格式异常/); }
  const draft = emptyGameplayCore(); draft.graphs[0].nodes.push(createCoreNode('module'));
  validateGameplayCore(draft); assert.ok(coreIssues(draft, []).some(issue => issue.message.includes('尚未建立')));
});

test('unresolved and archived design links remain editable and are reported at their exact graph and node', () => {
  const { store, designs } = fixture(), graph = store.graphs.find(g => g.title === '挑战模式'), node = graph.nodes.find(n => n.gameplayIds.includes('plant-selection'));
  node.gameplayIds.push('removed-design'); designs[0].archived = true;
  validateGameplayCore(store);
  const issues = coreIssues(store, designs).filter(issue => issue.nodeId === node.id);
  assert.equal(issues.length, 2); assert.ok(issues.every(issue => issue.graphId === graph.id));
  assert.ok(issues.some(issue => issue.message.includes('已归档'))); assert.ok(issues.some(issue => issue.message.includes('已失效')));
  const storage = memory(); writeGameplayCore(storage, 'key', null, store);
  assert.deepEqual(readGameplayCore(storage, 'key').store.graphs.find(g => g.id === graph.id).nodes.find(n => n.id === node.id).gameplayIds, ['plant-selection', 'removed-design']);
});

test('review issues identify absent/multiple entrances and unreachable nodes without rejecting work in progress', () => {
  const store = emptyGameplayCore(); assert.ok(coreIssues(store, []).some(i => i.message.includes('入口')));
  const entry = createCoreNode('entry'), disconnected = createCoreNode('activity', '尚未接入的活动');
  store.graphs[0].nodes = [entry, disconnected]; validateGameplayCore(store);
  assert.ok(coreIssues(store, []).some(i => i.nodeId === disconnected.id && i.message.includes('无法到达')));
  store.graphs[0].edges = [edge(entry, disconnected)]; assert.deepEqual(coreIssues(store, []), []);
  store.graphs[0].nodes.push(createCoreNode('entry')); assert.ok(coreIssues(store, []).some(i => i.message.includes('多个入口')));
});

test('optimistic saves reject stale windows and disk failures without replacing the committed graph, and support retry', () => {
  const { store } = fixture(), storage = memory(), raw = writeGameplayCore(storage, 'key', null, store), next = structuredClone(store);
  next.graphs[0].summary = '更清晰的模式入口';
  assert.throws(() => writeGameplayCore(storage, 'key', null, next), /其他窗口/);
  assert.equal(storage.getItem(), raw); assert.equal(storage.writes, 1);
  assert.throws(() => writeGameplayCore({ getItem: storage.getItem, setItem: () => { throw Error('disk full'); } }, 'key', raw, next), /disk full/);
  assert.equal(storage.getItem(), raw);
  const saved = writeGameplayCore(storage, 'key', raw, next);
  assert.equal(readGameplayCore(storage, 'key').store.graphs[0].summary, next.graphs[0].summary);
  assert.equal(saved, storage.getItem());
  const corrupt = memory('{invalid'); assert.throws(() => writeGameplayCore(corrupt, 'key', '{invalid', next)); assert.equal(corrupt.writes, 0);
});

test('core graphs persist across disk reopen and stay isolated between projects and test workspaces', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gamecreator-core-'));
  try {
    const { store } = fixture(), storage = createWorkspaceStorage(directory), projectA = 'gamecreator.workspace.v1:project-a:gameplay-core', projectB = 'gamecreator.workspace.v1:project-b:gameplay-core';
    const testKey = 'gamecreator.workspace.v1:' + path.join(directory, 'test-workspaces', crypto.randomUUID(), 'project').replaceAll('\\', '/').toLowerCase() + ':gameplay-core';
    writeGameplayCore(storage, projectA, null, store); writeGameplayCore(storage, projectB, null, emptyGameplayCore());
    const sandbox = emptyGameplayCore(); sandbox.graphs[0].title = '测试循环'; writeGameplayCore(storage, testKey, null, sandbox);
    const reopened = createWorkspaceStorage(directory);
    assert.deepEqual(readGameplayCore(reopened, projectA).store, store);
    assert.deepEqual(readGameplayCore(reopened, projectB).store, emptyGameplayCore());
    assert.equal(readGameplayCore(reopened, testKey).store.graphs[0].title, '测试循环');
    assert.notEqual(reopened.info(projectA).directory, reopened.info(testKey).directory);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});


test('after a conflict, reading the committed snapshot allows new edits while retaining the other window changes', () => {
  const storage = memory(), original = emptyGameplayCore();
  let expected = writeGameplayCore(storage, 'key', null, original);
  const other = structuredClone(original); other.graphs[0].summary = '另一窗口已保存的循环目标';
  other.graphs[0].nodes.push(createCoreNode('entry', '另一窗口创建的入口'));
  writeGameplayCore(storage, 'key', expected, other);
  const draft = structuredClone(original); draft.graphs[0].title = '本地冲突草稿';
  assert.throws(() => writeGameplayCore(storage, 'key', expected, draft), /其他窗口/);
  assert.throws(() => writeGameplayCore(storage, 'key', expected, draft), /其他窗口/);
  const backup = JSON.stringify(draft), reloaded = readGameplayCore(storage, 'key');
  expected = reloaded.raw; const edited = structuredClone(reloaded.store); edited.graphs[0].title = '重新读取后编辑的标题';
  writeGameplayCore(storage, 'key', expected, edited);
  const saved = readGameplayCore(storage, 'key').store;
  assert.equal(saved.graphs[0].summary, other.graphs[0].summary);
  assert.deepEqual(saved.graphs[0].nodes, other.graphs[0].nodes);
  assert.equal(saved.graphs[0].title, edited.graphs[0].title);
  assert.equal(JSON.parse(backup).graphs[0].title, '本地冲突草稿');
});

test('Markdown carries hierarchical paths, gameplay references, branches, conditions and endless loop edges', () => {
  const { store, designs } = fixture(), markdown = gameplayCoreMarkdown(store, designs);
  for (const expected of ['## 玩法核心', '### 游戏入口 / 挑战模式 / 挑战关卡', '### 游戏入口 / 无尽模式', '主界面 → 挑战模式', '获得奖励 → 选择植物', '条件：全部关卡完成并击败 Boss', '挑战下一轮 → 挑战下一轮', '关联玩法：植物选择规则', '[玩法 ID：plant-selection]']) assert.ok(markdown.includes(expected), expected);
  assert.equal(markdown.includes('### 待完善内容'), false);
  designs[0].archived = true; const archived = gameplayCoreMarkdown(store, designs);
  assert.ok(archived.includes('植物选择规则（已归档）')); assert.ok(archived.includes('### 待完善内容'));
});
