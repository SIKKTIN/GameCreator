import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { emptyGameplayCore, validateGameplayCore, coreIssues } from '../src/gameplay-core.ts';
import { validatePrototypeExample, preparePrototypeProject, writePrototypeProject } from '../src/prototype-import.ts';
import { captureProjectPackage, prepareProjectPackageImport, writeProjectPackageImport, validateProjectPackage } from '../src/project-package.ts';
import { defaultCatalog } from '../src/project-catalog.ts';
import { buildAiMarkdown } from '../src/ai-export.ts';
const config = { engine: 'oasis-lua', projectPath: '', enumPath: 'Script/Const', dataPath: 'Script/Config', outputFormat: 'lua', autoSync: false, backupBeforeSync: true };
const catalog = defaultCatalog({ ...config, projectPath: 'E:/Existing/CoreTest' }, '测试项目');
const key = (id, section) => 'gamecreator.workspace.v1:' + id + ':' + section;
const registry = { scan: null, active: null };
function storage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
const examples = await Promise.all(['plants-vs-zombies', 'stardew-valley', 'hollow-knight', 'disco-elysium'].map(async name => ({ name, example: JSON.parse(await fs.readFile(new URL('../examples/prototypes/' + name + '.json', import.meta.url), 'utf8')) })));
for (const { name, example } of examples) {
  test(name + ': examples preserve every core graph, coordinate, edge and gameplay association through project folder documents', () => {
    validatePrototypeExample(example);
    assert.deepEqual(coreIssues(example.gameplayCore, example.gameplay.designs), []);
    assert.ok(example.gameplayCore.graphs.length >= 4);
    const prepared = preparePrototypeProject(catalog, example, '可编辑的核心');
    const source = storage(); writePrototypeProject(source, prepared);
    const snapshot = captureProjectPackage(source, prepared.project);
    assert.deepEqual(snapshot.document.archives['gameplay-core'], example.gameplayCore);
    assert.ok(snapshot.expectedEntries.some(entry => entry.key === key(prepared.project.id, 'gameplay-core')));
    const imported = prepareProjectPackageImport(catalog, snapshot.document, '另一个副本');
    const target = storage(); writeProjectPackageImport(target, imported);
    assert.deepEqual(JSON.parse(target.getItem(key(imported.project.id, 'gameplay-core'))), example.gameplayCore);
    const markdown = buildAiMarkdown(snapshot.document.archives.project, example.stories, example.data, example.definitions, config, registry,
      example.gameplay.designs, example.functionalSystems, example.artAssets, example.gameplayCore);
    assert.match(markdown, /玩法核心/);
    for (const graph of example.gameplayCore.graphs) {
      assert.ok(markdown.includes(graph.title), graph.title);
      for (const node of graph.nodes) assert.ok(markdown.includes(node.title), node.title);
      for (const edge of graph.edges) if (edge.condition) assert.ok(markdown.includes(edge.condition), edge.condition);
    }
  });
}

test('old examples and old folder documents gain an empty core without mutating their source', () => {
  const legacy = structuredClone(examples[0].example); delete legacy.gameplayCore;
  assert.equal(validatePrototypeExample(legacy), legacy);
  const prepared = preparePrototypeProject(catalog, legacy, '旧示例');
  const source = storage(); writePrototypeProject(source, prepared);
  const raw = JSON.parse(source.getItem(key(prepared.project.id, 'gameplay-core')));
  assert.deepEqual(raw, emptyGameplayCore());
  const document = captureProjectPackage(source, prepared.project).document;
  delete document.archives['gameplay-core'];
  const normalized = validateProjectPackage(document);
  assert.deepEqual(normalized.archives['gameplay-core'], emptyGameplayCore());
  assert.equal(Object.hasOwn(document.archives, 'gameplay-core'), false);
  const imported = prepareProjectPackageImport(catalog, document, '旧文件夹');
  const target = storage(); writeProjectPackageImport(target, imported);
  assert.deepEqual(JSON.parse(target.getItem(key(imported.project.id, 'gameplay-core'))), emptyGameplayCore());
});

test('invalid core data is rejected by examples and folder documents before import is prepared', () => {
  for (const mutate of [
    core => { core.schema = 999; },
    core => { core.graphs[0].nodes[0].x = null; },
    core => { core.graphs[0].edges[0].toId = 'missing-node'; },
    core => { core.graphs[0].nodes.find(node => node.kind === 'module').childGraphId = core.rootId; },
  ]) {
    const example = structuredClone(examples[0].example), prepared = preparePrototypeProject(catalog, example, '合法基线');
    const source = storage(); writePrototypeProject(source, prepared);
    const document = captureProjectPackage(source, prepared.project).document;
    mutate(example.gameplayCore); mutate(document.archives['gameplay-core']);
    assert.throws(() => validatePrototypeExample(example));
    assert.throws(() => prepareProjectPackageImport(catalog, document, '损坏文件夹'));
  }
});

test('incomplete design references remain portable drafts, while bundled examples require valid links', () => {
  const example = structuredClone(examples[0].example), prepared = preparePrototypeProject(catalog, example, '草稿');
  const source = storage(); writePrototypeProject(source, prepared);
  const core = JSON.parse(source.getItem(key(prepared.project.id, 'gameplay-core')));
  core.graphs[0].nodes[0].gameplayIds = ['removed-design'];
  validateGameplayCore(core);
  source.setItem(key(prepared.project.id, 'gameplay-core'), JSON.stringify(core));
  assert.deepEqual(captureProjectPackage(source, prepared.project).document.archives['gameplay-core'], core);
  example.gameplayCore = core;
  assert.throws(() => validatePrototypeExample(example), /玩法核心/);
});

test('AI export accepts prior call signatures and supplies an empty gameplay core', () => {
  const example = examples[0].example;
  const markdown = buildAiMarkdown({name: '旧项目', genre: '', platform: '', version: '', status: '', description: ''}, [], example.data, example.definitions, config, registry);
  assert.match(markdown, /玩法核心/);
});
