import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { validateTaskFlows, taskFlowIssues, emptyTaskFlows } from '../src/task-flow.ts';
import { validatePrototypeExample, preparePrototypeProject, writePrototypeProject } from '../src/prototype-import.ts';
import { captureProjectPackage, validateProjectPackage, prepareProjectPackageImport, writeProjectPackageImport } from '../src/project-package.ts';
import { defaultCatalog } from '../src/project-catalog.ts';
import { buildAiMarkdown } from '../src/ai-export.ts';
const require = createRequire(import.meta.url), { createProjectPackages } = require('../desktop/project-package.cjs');
const config = { engine: 'oasis-lua', projectPath: '', enumPath: 'Script/Const', dataPath: 'Script/Config', outputFormat: 'lua', autoSync: false, backupBeforeSync: true };
const catalog = defaultCatalog({ ...config, projectPath: 'E:/Existing/TaskTest' }, '已有项目');
const key = id => 'gamecreator.workspace.v1:' + id + ':task-flows';
const memory = () => { const values = new Map(); return { values, getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) }; };
const sources = d => ({ designs: d.gameplay.designs, capabilities: d.functionalSystems.capabilities, stories: d.stories, assets: d.artAssets.assets, definitions: d.definitions, data: d.data });
const slugs = ['hollow-knight', 'stardew-valley', 'plants-vs-zombies', 'disco-elysium', 'vampire-survivors'];
const examples = await Promise.all(slugs.map(async slug => JSON.parse(await fs.readFile(new URL('../examples/prototypes/' + slug + '.json', import.meta.url), 'utf8'))));
for (const [i, example] of examples.entries()) test(slugs[i] + ': valid tasks, independent copies, portable archives and AI export retain every goal and branch', () => {
  validatePrototypeExample(example); validateTaskFlows(example.taskFlows); assert.deepEqual(taskFlowIssues(example.taskFlows, sources(example)), []);
  const p = preparePrototypeProject(catalog, example, '任务副本'), storage = memory(); writePrototypeProject(storage, p);
  const snapshot = captureProjectPackage(storage, p.project);
  assert.deepEqual(snapshot.document.archives['task-flows'], example.taskFlows); assert.ok(snapshot.expectedEntries.some(e => e.key === key(p.project.id)));
  const other = prepareProjectPackageImport(catalog, snapshot.document, '第二副本'); writeProjectPackageImport(storage, other);
  assert.notEqual(other.project.id, p.project.id); assert.equal(storage.getItem(key(other.project.id)), storage.getItem(key(p.project.id)));
  const markdown = buildAiMarkdown(snapshot.document.archives.project, example.stories, example.data, example.definitions, config, { scan: null, active: null }, example.gameplay.designs, example.functionalSystems, example.artAssets, example.gameplayCore, undefined, example.taskFlows);
  for (const task of example.taskFlows.tasks) { assert.ok(markdown.includes(task.title)); for (const s of task.stages) { assert.ok(markdown.includes(s.title)); for (const o of s.objectives) assert.ok(markdown.includes(o.condition)); } for (const edge of task.transitions) assert.ok(markdown.includes(edge.condition)); }
});
test('old projects and examples acquire empty tasks without source mutation; broken links stay portable but are rejected in bundled examples', () => {
  const old = structuredClone(examples[0]); delete old.taskFlows;
  const p = preparePrototypeProject(catalog, old, '旧示例'), storage = memory(); writePrototypeProject(storage, p); assert.deepEqual(JSON.parse(storage.getItem(key(p.project.id))), emptyTaskFlows()); assert.equal(Object.hasOwn(old, 'taskFlows'), false);
  const doc = captureProjectPackage(storage, p.project).document; delete doc.archives['task-flows']; assert.deepEqual(validateProjectPackage(doc).archives['task-flows'], emptyTaskFlows()); assert.equal(Object.hasOwn(doc.archives, 'task-flows'), false);
  const example = structuredClone(examples[0]); example.taskFlows.tasks[0].references[0].targetId = 'removed'; assert.throws(() => validatePrototypeExample(example), /任务与流程/);
  doc.archives['task-flows'] = example.taskFlows; assert.deepEqual(validateProjectPackage(doc).archives['task-flows'], example.taskFlows);
});
test('disk project folders preserve task archives and check conflicts and malformed input before writing', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-task-package-'));
  t.after(async () => { assert.equal(path.dirname(dir), path.resolve(os.tmpdir())); await fs.rm(dir, { recursive: true, force: true }); });
  const p = preparePrototypeProject(catalog, examples[3], '案件'), storage = memory(); writePrototypeProject(storage, p);
  storage.setItem('gamecreator.projects.v1', JSON.stringify(p.catalog));
  const snapshot = captureProjectPackage(storage, p.project), service = createProjectPackages({ dataDirectory: path.join(dir, 'data'), storage });
  const args = { directory: path.join(dir, 'export'), projectId: p.project.id, ...snapshot };
  await service.exportFolder(args); const result = await service.readFolder(args.directory); assert.deepEqual(result.document.archives['task-flows'], examples[3].taskFlows);
  assert.ok(JSON.parse(await fs.readFile(path.join(args.directory, 'manifest.json'), 'utf8')).files.some(f => f.path === 'data/task-flows.json'));
  const changed = structuredClone(examples[3].taskFlows); changed.tasks[0].title = '其他窗口'; storage.setItem(key(p.project.id), JSON.stringify(changed));
  await assert.rejects(service.exportFolder({ ...args, directory: path.join(dir, 'conflict') }));
  storage.setItem(key(p.project.id), snapshot.expectedEntries.find(e => e.key === key(p.project.id)).value);
  for (const mutate of [s => { s.schema = 99; }, s => { s.tasks[0].stages[0].objectives[0].target = 0; }, s => { s.tasks[0].stages[1].id = s.tasks[0].id; }]) {
    const bad = structuredClone(snapshot.document); mutate(bad.archives['task-flows']);
    assert.throws(() => validateProjectPackage(bad)); await assert.rejects(service.exportFolder({ ...args, document: bad, directory: path.join(dir, 'bad-' + crypto.randomUUID()) }));
  }
});
