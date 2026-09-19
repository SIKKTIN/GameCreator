import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLocalStories, localSourceIdentity } from '../src/story-import.ts';
const makeStorage = () => {
  const values = new Map(), writes = [];
  return { values, writes, getItem: key => values.get(key) ?? null, setItem: (key,value) => { writes.push(key); values.set(key,value); } };
};
test('import preview preserves all local fields, never writes the source, and rejects damaged archives', () => {
  const storage = makeStorage(), project = { id: 'project-local', initialContent: 'empty' };
  const key = 'gamecreator.workspace.v1:project-local:stories';
  const story = { id:'local-1', title:'故事', category:'世界观', status:'评审中', updated:'昨天', summary:'摘要', content:'正文',
    tags:['甲','乙'], outlines:['开始','结束'], relations:{ characters:['角色'], locations:['地点'], systems:['系统'] } };
  const raw = JSON.stringify([story]); storage.values.set(key,raw);
  const preview = readLocalStories(storage, project); assert.deepEqual(preview, [story]);
  preview[0].tags.push('修改副本'); assert.equal(storage.getItem(key),raw); assert.deepEqual(storage.writes, []);
  storage.values.set(key,'{"broken":true}'); assert.throws(() => readLocalStories(storage,project), /存档格式异常/);
  assert.equal(storage.getItem(key),'{"broken":true}'); assert.deepEqual(storage.writes, []);
  storage.values.delete(key); assert.deepEqual(readLocalStories(storage,project), []);
  const defaults = readLocalStories(storage,{ ...project,initialContent:'legacy' }); assert.ok(defaults.length > 0);
  defaults[0].tags.push('不污染默认值'); assert.ok(!readLocalStories(storage,{ ...project,initialContent:'legacy' })[0].tags.includes('不污染默认值'));
});
test('stable local import identity survives retry and refuses a corrupt identity', () => {
  const storage = makeStorage(), id = localSourceIdentity(storage);
  assert.equal(localSourceIdentity(storage),id); assert.equal(storage.writes.length,1);
  storage.values.set('gamecreator.local-source.v1','{}'); assert.throws(() => localSourceIdentity(storage), /来源标识无效/); assert.equal(storage.writes.length,1);
});
