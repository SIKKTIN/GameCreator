import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { emptyDevelopmentTools, createDevelopmentTool, validateDevelopmentTools, readDevelopmentTools, writeDevelopmentTools, createToolTask, removeDevelopmentTool, supplementDevelopmentPlan } from '../src/development-tools.ts';
import { emptyProjectSchedule, buildScheduleSources, projectScheduleIssues } from '../src/project-schedule.ts';
import { preparePrototypeProject, writePrototypeProject, validatePrototypeExample } from '../src/prototype-import.ts';
import { captureProjectPackage, validateProjectPackage, prepareProjectPackageImport } from '../src/project-package.ts';
import { buildSearchIndex, searchEntries } from '../src/global-search.ts';
import { buildAiDocument, buildAiDocumentFiles } from '../src/ai-export.ts';
import { readLocalSchedule } from '../src/team-schedule-publish.ts';
import { createProjectPackages } from '../desktop/project-package.cjs';
import { createWorkspaceStorage } from '../desktop/test-workspaces.cjs';
const json = async file => JSON.parse(await fs.readFile(new URL('../' + file, import.meta.url), 'utf8'));
const example = await json('examples/prototypes/plants-vs-zombies.json'), template = await json('examples/development-tools/plants-vs-zombies.json');
const memory = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; };
const fresh = () => preparePrototypeProject({ schema: 2, projects: [], activeId: '', mode: 'project' }, example, '工具验收项目');

test('tool archives reject corruption, preserve concurrent updates and leave old projects unwritten', () => {
  const storage = memory(); assert.deepEqual(readDevelopmentTools(storage, 'tools').store, emptyDevelopmentTools()); assert.equal(storage.getItem('tools'), null);
  const store = { schema: 1, tools: [createDevelopmentTool('动画检查')] };
  const first = writeDevelopmentTools(storage, 'tools', null, store);
  const edited = structuredClone(store); edited.tools[0].status = '开发中'; writeDevelopmentTools(storage, 'tools', first, edited);
  assert.throws(() => writeDevelopmentTools(storage, 'tools', first, store), /其他窗口/);
  assert.equal(readDevelopmentTools(storage, 'tools').store.tools[0].status, '开发中');
  for (const invalid of [null, { ...store, schema: 2 }, { ...store, tools: [store.tools[0], store.tools[0]] }, { ...store, tools: [{ ...store.tools[0], status: '自动完成' }] }, { ...store, tools: [{ ...store.tools[0], capabilityIds: ['a', 'a'] }] }]) assert.throws(() => validateDevelopmentTools(invalid));
});
test('schedule tasks reference tools without changing their status; referenced deletion is blocked', () => {
  const tool = createDevelopmentTool('动画预览'); tool.acceptance = '逐帧检查不改写资源'; tool.owner = '工具程序';
  const task = createToolTask(tool), store = { schema: 1, tools: [tool] }, schedule = { ...emptyProjectSchedule(), tasks: [task] };
  assert.deepEqual(task.references, [{ kind: 'tool', targetId: tool.id }]); assert.equal(task.acceptance, tool.acceptance); assert.equal(task.owner, tool.owner);
  task.status = '已完成'; assert.equal(tool.status, '待开发'); assert.throws(() => removeDevelopmentTool(store, tool.id, schedule), /关联排期/);
  assert.deepEqual(removeDevelopmentTool(store, tool.id, emptyProjectSchedule()), emptyDevelopmentTools());
});
test('PVZ tool plan is valid and moves integration after tool acceptance without dependency conflicts', () => {
  validatePrototypeExample(example);
  assert.deepEqual(example.developmentTools, template.tools); assert.equal(example.developmentTools.tools.length, 3);
  assert.equal(example.projectSchedule.tasks.length, 18);
  for (const t of template.schedule.tasks) assert.deepEqual(example.projectSchedule.tasks.find(x => x.id === t.id), t);
  const sources = buildScheduleSources(example.gameplay.designs, example.functionalSystems, example.artAssets, { enabled: false, maps: [] }, example.prototypeDesign, example.developmentTools);
  assert.deepEqual(projectScheduleIssues(example.projectSchedule, '2026-09-21', sources).filter(i => i.kind !== 'blocked'), []);
  const archived = structuredClone(sources); archived.tool[0].unavailable = true;
  assert.ok(projectScheduleIssues(example.projectSchedule, '2026-09-21', archived).some(i => i.kind === 'reference'));
});
test('supplement is idempotent, keeps completed work and user edits, and does not impose template dates', () => {
  const schedule = structuredClone(example.projectSchedule);
  schedule.tasks = schedule.tasks.filter(t => !template.schedule.tasks.some(x => x.id === t.id));
  schedule.tasks.forEach(t => { t.dependencyIds = t.dependencyIds.filter(id => schedule.tasks.some(x => x.id === id)); });
  schedule.milestones = schedule.milestones.filter(m => !template.schedule.milestones.some(x => x.id === m.id));
  schedule.tasks[0].status = '已完成'; schedule.tasks[0].result = '用户验收记录'; schedule.tasks[0].owner = '用户修改';
  const store = { schema: 1, tools: [{ ...template.tools.tools[0], name: '我的预览工具', status: '可使用', archived: true }] };
  const before = structuredClone(schedule), next = supplementDevelopmentPlan(store, schedule, template, new Set());
  assert.deepEqual(next.counts, { tools: 2, tasks: 6, milestones: 1 }); assert.deepEqual(next.tools.tools[0], store.tools[0]); assert.deepEqual(next.schedule.tasks.slice(0, before.tasks.length), before.tasks);
  assert.ok(next.schedule.tasks.slice(before.tasks.length).every(t => t.start === '' && t.end === ''));
  assert.deepEqual(supplementDevelopmentPlan(next.tools, next.schedule, template, new Set()).counts, { tools: 0, tasks: 0, milestones: 0 });
  const withoutBase = supplementDevelopmentPlan(emptyDevelopmentTools(), emptyProjectSchedule(), template, new Set());
  assert.ok(withoutBase.schedule.tasks.every(t => t.dependencyIds.every(id => withoutBase.schedule.tasks.some(x => x.id === id))));
});
test('tools join search, AI module documents and team schedule source descriptions', () => {
  const index = buildSearchIndex({ developmentTools: example.developmentTools, schedule: example.projectSchedule });
  assert.ok(searchEntries(index, '骨骼动画', '开发工具').length); assert.ok(index.filter(e => e.target.module === '项目排期').some(t => t.refs.some(id => index.find(e => e.key === id)?.target.module === '开发工具')));
  const p = fresh(), storage = memory(); writePrototypeProject(storage, p); const publication = readLocalSchedule(storage, p.project).schedule;
  assert.ok(publication.references.some(r => r.kind === 'tool' && r.name === '骨骼动画预览工具'));
  const doc = buildAiDocument({ ...example, genre: '', platform: '', version: '', status: '' }, example.stories, example.data, example.definitions, p.project.config, { scan: null }, example.gameplay.designs, example.functionalSystems, example.artAssets, example.gameplayCore, example.prototypeDesign, example.taskFlows, undefined, undefined, example.gameplay.categories, example.projectSchedule, example.numericalAnalysis, undefined, example.developmentTools);
  const files = buildAiDocumentFiles(doc, { folderName: '工具项目文档', summaryName: '完整项目', moduleNames: {} }).files;
  for (const file of [files[0], files.find(f => f.path === '模块/开发工具.md')]) assert.match(file.content, /骨骼动画预览工具/);
  assert.match(doc.sections.find(s => s.id === 'schedule').body, /开发工具 \/ 骨骼动画预览工具/);
});
test('project folders round-trip tool data and validate it at both renderer and desktop boundaries', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-tools-package-'));
  try {
    const p = fresh(), storage = createWorkspaceStorage(path.join(dir, 'data')); writePrototypeProject(storage, p); storage.setItem('gamecreator.projects.v1', JSON.stringify(p.catalog));
    const snapshot = captureProjectPackage(storage, p.project); assert.deepEqual(snapshot.document.archives['development-tools'], example.developmentTools);
    const old = structuredClone(snapshot.document); delete old.archives['development-tools']; assert.deepEqual(validateProjectPackage(old).archives['development-tools'], emptyDevelopmentTools());
    const imported = prepareProjectPackageImport(p.catalog, snapshot.document, '工具副本'); assert.notEqual(imported.project.id, p.project.id);
    assert.ok(imported.entries.some(e => e.key.endsWith(':development-tools') && e.value.includes('骨骼动画预览工具')));
    const service = createProjectPackages({ dataDirectory: path.join(dir, 'data'), storage }), target = path.join(dir, 'export');
    const broken = structuredClone(snapshot.document); broken.archives['development-tools'].tools[0].status = 'INVALID';
    assert.throws(() => validateProjectPackage(broken), /开发工具/);
    await assert.rejects(service.exportFolder({ directory: target, projectId: p.project.id, document: broken, expectedEntries: snapshot.expectedEntries }), /开发工具/);
    await service.exportFolder({ directory: target, projectId: p.project.id, ...snapshot });
    const exported = JSON.parse(await fs.readFile(path.join(target, 'data/development-tools.json'), 'utf8')); assert.deepEqual(exported, example.developmentTools);
  } finally { assert.equal(path.dirname(dir), path.resolve(os.tmpdir())); await fs.rm(dir, { recursive: true, force: true }); }
});
