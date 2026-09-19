import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPublicationPreview, assertPublicationCurrent, publicationBody, publicationLimits, checkPublicationSize } from '../src/team-publish.ts';
const project = { id: 'local-project', name: '目录名称', initialContent: 'empty' };
const story = { id: 'local-story', title: '完整文档', category: '角色设定', status: '定稿', updated: '刚刚', summary: '摘要', content: '正文',
  tags: ['一'], outlines: ['起因'], relations: { characters: ['角色'], locations: ['地点'], systems: ['系统'] } };
const setup = () => {
  const records = new Map([['gamecreator.workspace.v1:local-project:project', JSON.stringify({ name: '实际项目名称', description: '同步发布的简介' })],
    ['gamecreator.workspace.v1:local-project:stories', JSON.stringify([story])]]);
  return { records, getItem: key => records.get(key) ?? null };
};
test('publication snapshot preserves all story fields, reads current name, excludes unsupported sections and never writes source', () => {
  const storage = setup(), before = [...storage.records];
  const preview = readPublicationPreview(storage, project);
  assert.equal(preview.name, '实际项目名称'); assert.equal(preview.stories.length, 1);
  const { updated, ...publishedStory } = story; assert.deepEqual(preview.stories, [publishedStory]);
  assertPublicationCurrent(storage, project, preview); assert.deepEqual([...storage.records], before);
  const request = publicationBody(preview, { sourceInstanceId: 'client', sourceProjectId: project.id }, '协作名称', [{ userId: 'admin', role: 'admin' }]);
  assert.equal(request.name, '协作名称'); assert.equal('description' in request, false); assert.equal('config' in request, false);
  assert.equal(request.overview.info.description,'同步发布的简介');assert.equal(request.overview.info.name,'协作名称');
  storage.records.set('gamecreator.workspace.v1:local-project:stories', JSON.stringify([{ ...story, content: '其他窗口修改' }]));
  assert.throws(() => assertPublicationCurrent(storage, project, preview), /本地项目已变化/);
  assert.equal(preview.stories[0].content, story.content);
  assert.throws(() => publicationBody(preview, { sourceInstanceId: 'client', sourceProjectId: 'another' }, '协作名称', []), /来源已变化/);
});
test('empty and legacy previews work; corrupt, invalid, excessive and oversized content fail before publication', () => {
  const storage = setup(), key = 'gamecreator.workspace.v1:local-project:stories';
  storage.records.delete(key); assert.equal(readPublicationPreview(storage, project).stories.length, 0);
  assert.ok(readPublicationPreview(storage, { ...project, initialContent: 'legacy' }).stories.length > 0);
  for (const invalid of ['{broken', JSON.stringify([{ ...story, title: '' }]), JSON.stringify([{ ...story, content: 'x'.repeat(100001) }]),
    JSON.stringify([{ ...story, tags: Array(201).fill('tag') }]), JSON.stringify([story, story])]) {
    storage.records.set(key, invalid); assert.throws(() => readPublicationPreview(storage, project)); assert.equal(storage.getItem(key), invalid);
  }
  storage.records.set(key, JSON.stringify(Array.from({ length: publicationLimits.maxStories + 1 }, (_, i) => ({ ...story, id: String(i) }))));
  assert.throws(() => readPublicationPreview(storage, project), /最多 500/);
  assert.throws(() => checkPublicationSize('字'.repeat(Math.ceil(publicationLimits.maxBytes / 3))), /10 MiB/);
  storage.records.set('gamecreator.workspace.v1:local-project:project', '{}');
  assert.throws(() => readPublicationPreview(storage, project), /名称存档异常/);
});
