const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createCollaborationServer } = require('../server/collaboration.cjs');
const limits = require('../shared/publication-limits.json');
const fields = index => ({ id: 'source-' + index, title: '故事 ' + index, category: '角色设定', status: '评审中', summary: '摘要', content: '正文 ' + index,
  tags: ['主角'], outlines: ['起因', '转折'], relations: { characters: ['角色'], locations: ['地点'], systems: ['系统'] } });
const origin = { sourceInstanceId: 'publication-client', sourceProjectId: 'local-project' };
const body = () => ({ ...origin, name: '协作副本', members: [{ userId: 'admin', role: 'admin' }, { userId: 'bob', role: 'editor' }], stories: [fields(0), fields(1)] });
async function fixture(run) {
  const prefix = path.join(os.tmpdir(), 'gc-publication-'), directory = fs.mkdtempSync(prefix);
  let service = await createCollaborationServer({ directory, port: 0 });
  const request = async (route, token, method = 'GET', payload) => {
    const response = await fetch(service.url + '/api/team' + route, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || '') }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    return { status: response.status, data: await response.json() };
  };
  const login = async username => (await request('/login', '', 'POST', { username, password: username + '123' })).data.token;
  const restart = async () => { const id = service.serverId; await service.close(); service = await createCollaborationServer({ directory, port: 0 }); assert.equal(service.serverId, id); };
  try { await run({ request, login, restart, directory }); }
  finally { await service.close(); assert.ok(path.resolve(directory).startsWith(path.resolve(prefix))); fs.rmSync(directory, { recursive: true, force: true }); }
}

test('publish all stories atomically with new identities, membership, initial history and import deduplication', () => fixture(async ({ request, login }) => {
  const admin = await login('admin'), bob = await login('bob'), alice = await login('alice');
  for (const token of ['', bob, alice]) for (const route of ['/publications', '/publications/lookup']) {
    assert.equal((await request(route, token, 'POST', { ...body(), serverRole: 'admin' })).status, token ? 403 : 401);
  }
  assert.equal((await request('/publications/lookup', admin, 'POST', origin)).data.publication, null);
  const input = { ...body(), stories: Array.from({ length: 61 }, (_, index) => fields(index)) };
  const created = await request('/publications', admin, 'POST', input);
  assert.equal(created.status, 201); assert.equal(created.data.storyCount, 61);
  const route = '/projects/' + created.data.project.id;
  assert.notEqual(created.data.project.id, origin.sourceProjectId);
  const read = await request(route + '/stories', bob); assert.equal(read.status, 200); assert.equal(read.data.role, 'editor');
  assert.equal(read.data.stories.length, input.stories.length);
  for (const story of read.data.stories) {
    const source = input.stories.find(item => item.title === story.title); assert.ok(source); assert.notEqual(story.id, source.id);
    for (const key of ['title', 'category', 'status', 'summary', 'content', 'tags', 'outlines', 'relations']) assert.deepEqual(story[key], source[key]);
    assert.equal(story.revision, 1); assert.equal(story.updatedBy, 'admin');
  }
  const story = read.data.stories[0];
  assert.deepEqual((await request(route + '/stories/' + story.id + '/history', bob)).data.history, [story]);
  assert.equal((await request(route + '/stories', alice)).status, 403);
  assert.equal((await request('/projects', alice)).data.projects.some(project => project.id === created.data.project.id), false);
  const imported = await request(route + '/stories/import', bob, 'POST', { ...origin, stories: input.stories.slice(0, 50) });
  assert.equal(imported.data.skipped, 50); assert.equal(imported.data.imported.length, 0);
  const lookedUp = (await request('/publications/lookup', admin, 'POST', origin)).data.publication;
  assert.equal(lookedUp.project.id, created.data.project.id); assert.equal(lookedUp.storyCount, 61);
}));

test('publication retry survives concurrency and restart without overwriting team edits or changed memberships', () => fixture(async ({ request, login, restart }) => {
  let admin = await login('admin'); const bob = await login('bob');
  const concurrent = await Promise.all([request('/publications', admin, 'POST', body()), request('/publications', admin, 'POST', body())]);
  assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 201]);
  const id = concurrent[0].data.project.id, route = '/projects/' + id;
  assert.equal(concurrent[1].data.project.id, id);
  const story = (await request(route + '/stories', bob)).data.stories[0];
  const edited = await request(route + '/stories/' + story.id, bob, 'PUT', { ...story, content: '团队成员之后的修改' });
  assert.equal(edited.status, 200);
  const members = await request(route + '/members', admin, 'PUT', { revision: 1, members: [{ userId: 'admin', role: 'admin' }, { userId: 'bob', role: 'viewer' }] });
  assert.equal(members.status, 200);
  await restart(); admin = await login('admin');
  const retry = await request('/publications', admin, 'POST', { ...body(), name: '不应改名', stories: [], members: [{ userId: 'admin', role: 'admin' }] });
  assert.equal(retry.status, 200); assert.equal(retry.data.project.id, id); assert.equal(retry.data.project.name, body().name);
  assert.equal((await request(route + '/stories/' + story.id, admin)).data.story.content, '团队成员之后的修改');
  assert.equal((await request(route + '/stories/' + story.id + '/history', admin)).data.history.length, 2);
  assert.equal((await request(route + '/members', admin)).data.members.find(member => member.userId === 'bob').role, 'viewer');
  // The same local project on a different source machine is a separate source.
  assert.equal((await request('/publications', admin, 'POST', { ...body(), sourceInstanceId: 'another-client' })).status, 201);
  assert.equal((await request('/projects', admin)).data.projects.length, 3);
  // A server administrator removed from this project cannot recover its content or create a replacement by retrying.
  await request(route + '/members', admin, 'PUT', { revision: 2, members: [{ userId: 'admin', role: 'admin' }, { userId: 'bob', role: 'admin' }] });
  const newBob = await login('bob');
  assert.equal((await request(route + '/members', newBob, 'PUT', { revision: 3, members: [{ userId: 'bob', role: 'admin' }] })).status, 200);
  assert.equal((await request('/publications/lookup', admin, 'POST', origin)).status, 403);
  assert.equal((await request('/publications', admin, 'POST', body())).status, 403);
}));

test('invalid input, oversize submissions and a mid-transaction write failure leave no partial project', t => fixture(async ({ request, login, directory }) => {
  const admin = await login('admin'), database = new DatabaseSync(path.join(directory, 'team.sqlite'));
  const counts = () => Object.fromEntries(['projects', 'members', 'stories', 'history', 'story_imports', 'project_publications'].map(table => [table, database.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n]));
  try {
    const before = counts();
    for (const invalid of [
      { ...body(), stories: [fields(0), { ...fields(1), tags: 'wrong' }] },
      { ...body(), stories: [fields(0), fields(0)] },
      { ...body(), stories: Array.from({ length: limits.maxStories + 1 }, (_, i) => fields(i)) },
      { ...body(), name: ' ' }, { ...body(), members: [{ userId: 'missing', role: 'admin' }] },
    ]) { assert.equal((await request('/publications', admin, 'POST', invalid)).status, 400); assert.deepEqual(counts(), before); }
    const huge = { ...body(), stories: Array.from({ length: 120 }, (_, i) => ({ ...fields(i), content: 'x'.repeat(100000) })) };
    assert.equal((await request('/publications', admin, 'POST', huge)).status, 413); assert.deepEqual(counts(), before);
    database.exec("CREATE TRIGGER reject_publication_history BEFORE INSERT ON history WHEN json_extract(NEW.snapshot,'$.title')='故事 1' BEGIN SELECT RAISE(ABORT,'injected publication failure'); END;");
    const reported = []; const log = t.mock.method(console, 'error', (...args) => reported.push(args));
    assert.equal((await request('/publications', admin, 'POST', body())).status, 500);
    assert.equal(reported.length, 1); assert.equal(reported[0][1].message, 'injected publication failure'); log.mock.restore();
    assert.deepEqual(counts(), before, 'Project, members, first story and its history must all roll back');
    assert.equal((await request('/publications/lookup', admin, 'POST', origin)).data.publication, null);
    database.exec('DROP TRIGGER reject_publication_history');
    const retried = await request('/publications', admin, 'POST', body()); assert.equal(retried.status, 201);
    const empty = await request('/publications', admin, 'POST', { ...body(), sourceProjectId: 'empty-local', stories: [] });
    assert.equal(empty.status, 201); assert.equal(empty.data.storyCount, 0);
    assert.deepEqual((await request('/projects/' + empty.data.project.id + '/stories', admin)).data.stories, []);
  } finally { database.close(); }
}));
