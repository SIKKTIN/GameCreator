import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateGameplayCore, coreIssues } from '../src/gameplay-core.ts';
import { validateGameplay } from '../src/gameplay.ts';
import { dependencyIssues, stateFlowIssues } from '../src/gameplay-structure.ts';
import { stageIssues } from '../src/gameplay-stage.ts';
import { validateFunctionalSystems, functionalIssues } from '../src/functional-systems.ts';
import { validateArtAssets, validateArtMutation, emptyArtAssets, artIssues } from '../src/art-assets.ts';

const examples = [
  { file: 'hollow-knight.json', requirements: 26, assets: 39 },
  { file: 'stardew-valley.json', requirements: 23, assets: 34 },
  { file: 'plants-vs-zombies.json', requirements: 20, assets: 32 },
  { file: 'disco-elysium.json', requirements: 22, assets: 40 },
  { file: 'vampire-survivors.json', requirements: 26, assets: 42 },
];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
function unique(items, key, label) {
  assert.ok(Array.isArray(items), `${label} must be an array`);
  assert.ok(items.every(item => record(item) && nonempty(item[key])), `${label} needs nonempty ${key}`);
  assert.equal(new Set(items.map(item => item[key])).size, items.length, `${label} contains duplicate ${key}`);
}
function columns(items, label) {
  unique(items, 'key', label);
  for (const column of items) {
    assert.ok(nonempty(column.label), `${label}.${column.key} needs a label`);
    if (column.type !== undefined) assert.ok(['text', 'enum', 'reference'].includes(column.type), `${label}.${column.key} has an invalid type`);
    if (column.options !== undefined) assert.ok(Array.isArray(column.options) && column.options.every(option => typeof option === 'string'), `${label}.${column.key} has invalid options`);
    for (const key of ['enumName', 'enumId', 'reference']) {
      if (column[key] !== undefined) assert.equal(typeof column[key], 'string', `${label}.${column.key}.${key}`);
    }
  }
}
function validateDocuments(example) {
  unique(example.stories, 'id', 'stories');
  for (const story of example.stories) {
    for (const key of ['title', 'category', 'status', 'updated', 'summary', 'content']) assert.equal(typeof story[key], 'string', `story ${story.id}.${key}`);
    for (const key of ['tags', 'outlines']) assert.ok(Array.isArray(story[key]) && story[key].every(value => typeof value === 'string'), `story ${story.id}.${key}`);
    assert.ok(record(story.relations), `story ${story.id}.relations`);
    for (const key of ['characters', 'locations', 'systems']) assert.ok(Array.isArray(story.relations[key]) && story.relations[key].every(value => typeof value === 'string'), `story ${story.id}.relations.${key}`);
  }
  unique(example.definitions, 'key', 'definitions');
  assert.ok(record(example.data) && record(example.data.datasets) && record(example.data.columns), 'data must contain datasets and columns');
  const definedKeys = example.definitions.map(definition => definition.key).sort();
  assert.deepEqual(Object.keys(example.data.datasets).sort(), definedKeys, 'dataset definitions and data must match');
  assert.deepEqual(Object.keys(example.data.columns).sort(), definedKeys, 'dataset column maps and definitions must match');
  for (const definition of example.definitions) {
    assert.ok(nonempty(definition.label) && typeof definition.badge === 'string', `dataset ${definition.key} metadata`);
    columns(definition.columns, `${definition.key} definition columns`);
    columns(example.data.columns[definition.key], `${definition.key} columns`);
    const rows = example.data.datasets[definition.key];
    unique(rows, 'id', `${definition.key} rows`);
    for (const row of rows) assert.ok(Object.values(row).every(value => typeof value === 'string'), `${definition.key}/${row.id} has a non-string value`);
  }
}

async function validateExample(expected) {
  // URL resolution makes this read-only command independent of the caller's working directory.
  const url = new URL(`../examples/prototypes/${expected.file}`, import.meta.url);
  const example = JSON.parse(await readFile(url, 'utf8'));
  assert.ok(record(example), 'example must be an object');
  assert.deepEqual(Object.keys(example).sort(), ['schema', 'name', 'description', 'gameplay', 'gameplayCore', 'functionalSystems', 'artAssets', 'data', 'definitions', 'stories'].sort(), 'example contains missing or nonportable top-level fields');
  assert.equal(example.schema, 1, 'example schema');
  assert.ok(nonempty(example.name) && nonempty(example.description), 'example needs a name and description');
  validateDocuments(example);
  assert.equal(example.gameplay?.schema, 3, 'gameplay must use the current portable schema');
  const gameplay = validateGameplay(example.gameplay);
  const core = validateGameplayCore(example.gameplayCore);
  assert.deepEqual(coreIssues(core, gameplay.designs), [], 'gameplay core references');
  const functional = validateFunctionalSystems(example.functionalSystems);
  const art = validateArtAssets(example.artAssets);
  validateArtMutation(emptyArtAssets(), art);
  assert.ok(gameplay.designs.length > 0, 'example needs gameplay designs');
  const storyIds = new Set(example.stories.map(story => story.id));
  const datasetKeys = new Set(example.definitions.map(definition => definition.key));
  for (const design of gameplay.designs) {
    assert.deepEqual(dependencyIssues(design, gameplay.designs), [], `${design.title}: gameplay dependencies`);
    assert.deepEqual(stateFlowIssues(design.stateFlow), [], `${design.title}: state references`);
    assert.deepEqual(stageIssues(design, gameplay.designs), [], `${design.title}: spatial and timeline references`);
    for (const link of design.links) assert.ok((link.kind === 'story' ? storyIds : datasetKeys).has(link.targetId), `${design.title}: missing ${link.kind} ${link.targetId}`);
    assert.ok(design.prototype.every(item => item.done === false), `${design.title}: prototype work must remain unfinished`);
    assert.ok(design.checks.every(check => check.result === '未测试' && check.actual === ''), `${design.title}: playtests must remain untested`);
  }
  assert.deepEqual(functionalIssues(functional, { designs: gameplay.designs, data: example.data, definitions: example.definitions }), [], 'functional references');
  assert.deepEqual(artIssues(art, { designs: gameplay.designs, functional }), [], 'art references');
  assert.equal(art.requirements.length, expected.requirements, 'art requirement count');
  assert.equal(art.assets.length, expected.assets, 'art asset count');
  assert.ok(art.requirements.every(requirement => requirement.status === '待制作'), 'art requirements must remain planned');
  assert.ok(art.assets.every(asset => asset.versions.length === 0 && asset.adoptedVersionId === ''), 'art assets must have no fabricated deliveries or adopted versions');
  const requirementUses = new Map(art.requirements.map(requirement => [requirement.id, 0]));
  const assetUses = new Map(art.assets.map(asset => [asset.id, 0]));
  for (const link of art.links) {
    requirementUses.set(link.requirementId, requirementUses.get(link.requirementId) + 1);
    assetUses.set(link.assetId, assetUses.get(link.assetId) + 1);
  }
  assert.ok([...requirementUses.values()].every(count => count > 0), 'every requirement needs an asset');
  assert.ok([...assetUses.values()].every(count => count > 0), 'every asset needs a requirement');
  assert.ok([...requirementUses.values()].some(count => count > 1) && [...assetUses.values()].some(count => count > 1), 'example must demonstrate shared assets and multiple deliveries per requirement');
  console.log(`${expected.file}: OK — ${gameplay.designs.length} gameplay, ${functional.capabilities.length} capabilities, ${art.requirements.length} art requirements, ${art.assets.length} assets, ${art.links.length} links; untested, no deliveries`);
}

let failed = false;
for (const expected of examples) {
  try {
    await validateExample(expected);
  } catch (error) {
    failed = true;
    console.error(`${expected.file}: FAILED — ${error instanceof Error ? error.message : String(error)}`);
  }
}
if (failed) process.exitCode = 1;
