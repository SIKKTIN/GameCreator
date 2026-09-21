import test from 'node:test';
import assert from 'node:assert/strict';
import { createArtAsset, createArtRequirement, emptyArtAssets, validateArtMutation } from '../src/art-assets.ts';
import { artLibrary, assignArtCategory } from '../src/art-library.ts';
import { externalArtReferences, artItemReferences, removeArtItem, writeArtItemDeletion } from '../src/art-deletion.ts';

function fixture() {
  const asset = createArtAsset('豌豆射手'), other = createArtAsset('向日葵'), requirement = createArtRequirement('射击动画');
  const version = { id: 'v1', name: '正式版', notes: '', placeholder: false, review: '已通过', feedback: '', files: [{ id: 'file', name: 'pea.png', size: 128, mime: 'image/png', storagePath: 'retained/file.png' }], createdAt: new Date().toISOString() };
  asset.versions = [version]; asset.adoptedVersionId = version.id;
  let store = { ...emptyArtAssets(), assets: [asset, other], requirements: [requirement], links: [{ id: 'link', assetId: other.id, requirementId: requirement.id, note: '' }] };
  store = assignArtCategory(store, 'asset', asset.id, artLibrary(store).categories[0].id);
  return { store, asset, other, requirement, target: { kind: 'asset', id: asset.id } };
}
function memory(initial) { let raw = initial, writes = 0; return { getItem: () => raw, setItem: (_, next) => { raw = next; writes++; }, get writes() { return writes; } }; }

test('explicit deletion removes only the selected card, version records and its category assignment', () => {
  const { store, asset, other, target } = fixture(), before = structuredClone(store), next = removeArtItem(store, target);
  assert.deepEqual(store, before);
  assert.deepEqual(next.assets, [other]); assert.deepEqual(next.requirements, store.requirements); assert.deepEqual(next.links, store.links);
  assert.equal(next.library.assets[asset.id], undefined); assert.deepEqual(next.library.categories, store.library.categories);
  assert.throws(() => validateArtMutation(store, next), /使用归档/);
  const edited = structuredClone(store); edited.assets[0].versions = [];
  assert.throws(() => validateArtMutation(store, edited), /上传新增版本/);
});

test('requirement deletion cleans links, preserves all assets, and freezes legacy inferred categories', () => {
  const { store, requirement } = fixture(); delete store.library; requirement.category = '角色';
  const categories = artLibrary(store), before = structuredClone(store);
  const next = removeArtItem(store, { kind: 'requirement', id: requirement.id });
  assert.deepEqual(store, before); assert.deepEqual(next.requirements, []); assert.deepEqual(next.links, []);
  assert.deepEqual(next.assets, store.assets); assert.deepEqual(next.library.assets, categories.assets);
  assert.equal(next.library.requirements[requirement.id], undefined);
});

test('active, archived and missing requirement references block asset deletion', () => {
  const { store, asset, target, requirement } = fixture();
  store.links.push({ id: 'used', assetId: asset.id, requirementId: requirement.id, note: '' }); requirement.archived = true;
  assert.deepEqual(artItemReferences(store, target), ['素材需求 / 射击动画']);
  assert.throws(() => removeArtItem(store, target), /射击动画/);
  store.links.at(-1).requirementId = 'missing';
  assert.throws(() => removeArtItem(store, target), /missing/);
  store.links.pop(); asset.archived = true;
  assert.equal(removeArtItem(store, target).assets.length, 1);
  assert.throws(() => removeArtItem(store, target, ['原型设计 / 战斗']), /原型设计/);
});

test('cross-module checks include disabled maps, character portraits, archived stories and tasks, and schedule requirements', () => {
  const { target, requirement } = fixture(), ref = { kind: 'asset', targetId: target.id };
  const sources = {
    stories: [{ title: '植物设定', archived: true, references: [ref] }],
    schedule: { tasks: [{ title: '制作豌豆', references: [ref] }, { title: '验收动画', references: [{ kind: 'requirement', targetId: requirement.id }] }] },
    prototype: { scenes: [{ name: '草坪', elements: [{ name: '射手', assetId: target.id }] }] },
    maps: { enabled: false, maps: [{ name: '庭院', objects: [{ name: '植物', references: [ref] }] }] },
    tasks: { tasks: [{ title: '守住庭院', archived: true, references: [ref] }] },
    narrative: { enabled: false, characters: [{ name: '豌豆', portrait: { assetId: target.id } }] },
  };
  const references = externalArtReferences(target, sources);
  assert.equal(references.length, 6);
  for (const name of ['故事文档', '项目排期', '原型设计', '地图设计', '任务与流程', '故事角色头像']) assert.ok(references.some(r => r.startsWith(name)), name);
  assert.deepEqual(externalArtReferences({ kind: 'requirement', id: requirement.id }, sources), ['项目排期 / 验收动画']);
  assert.deepEqual(externalArtReferences({ kind: 'asset', id: 'unrelated' }, sources), []);
});

test('delete persistence rejects stale, corrupt, referenced and missing targets without writing', () => {
  const { store, target, other } = fixture(), raw = JSON.stringify(store), storage = memory(raw);
  assert.throws(() => writeArtItemDeletion(storage, 'key', null, target), /其他窗口/);
  assert.throws(() => writeArtItemDeletion(storage, 'key', raw, target, ['项目排期 / 动画']), /项目排期/);
  assert.throws(() => writeArtItemDeletion(storage, 'key', raw, { kind: 'asset', id: other.id }), /素材需求/);
  assert.throws(() => writeArtItemDeletion(storage, 'key', raw, { kind: 'asset', id: 'missing' }), /不存在/);
  assert.throws(() => writeArtItemDeletion(storage, 'key', raw, { kind: 'unknown', id: target.id }), /类型无效/);
  assert.equal(storage.getItem(), raw); assert.equal(storage.writes, 0);
  const corrupt = memory('{bad'); assert.throws(() => writeArtItemDeletion(corrupt, 'key', '{bad', target)); assert.equal(corrupt.writes, 0);
});

test('failed deletion leaves the committed archive intact, can retry, and stays deleted on reread', () => {
  const { store, target } = fixture(), raw = JSON.stringify(store), storage = memory(raw);
  assert.throws(() => writeArtItemDeletion({ getItem: storage.getItem, setItem: () => { throw Error('disk full'); } }, 'key', raw, target), /disk full/);
  assert.equal(storage.getItem(), raw);
  const result = writeArtItemDeletion(storage, 'key', raw, target);
  assert.deepEqual(JSON.parse(storage.getItem()), result.store); assert.equal(storage.writes, 1);
  assert.equal(result.store.assets.some(a => a.id === target.id), false);
  assert.throws(() => writeArtItemDeletion(storage, 'key', result.raw, target), /不存在/); assert.equal(storage.writes, 1);
});
