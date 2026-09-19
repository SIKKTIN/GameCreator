const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createCollaborationServer } = require('../server/collaboration.cjs');

test('team authentication, membership, independent edits, atomic conflicts, history and restart', async () => {
  const prefix = path.join(os.tmpdir(), 'gamecreator-team-');
  const directory = fs.mkdtempSync(prefix);
  let service = await createCollaborationServer({ directory, port: 0 });
  const request = async (route, { token = '', method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(service.url + '/api/team' + route, { method, headers: { Authorization: 'Bearer ' + token,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: response.status === 204 ? null : await response.json() };
  };
  const login = async username => {
    const response = await request('/login', { method: 'POST', body: { username, password: username + '123' } });
    assert.equal(response.status, 200); return response.data.token;
  };
  const route = '/projects/team-demo/stories';
  const fields = story => ({ title: story.title, category: story.category, summary: story.summary, content: story.content, revision: story.revision });
  try {
    assert.equal((await request('/projects')).status, 401);
    assert.equal((await request('/login', { method: 'POST', body: { username: 'alice', password: 'wrong' } })).status, 401);
    assert.equal((await request('/login', { method: 'POST', body: { username: 'missing', password: 'wrong' } })).status, 401);
    const alice = await login('alice'), bob = await login('bob'), viewer = await login('viewer');
    const projects = await request('/projects', { token: alice });
    assert.equal(projects.data.projects[0].role, 'editor');
    const initial = (await request(route, { token: alice })).data.stories;
    const world = initial.find(story => story.id === 'world'), chapter = initial.find(story => story.id === 'chapter');
    // Separate documents commit concurrently without competing for a whole-project revision.
    const independent = await Promise.all([
      request(route + '/world', { token: alice, method: 'PUT', body: { ...fields(world), content: 'Alice world' } }),
      request(route + '/chapter', { token: bob, method: 'PUT', body: { ...fields(chapter), content: 'Bob chapter' } }),
    ]);
    assert.deepEqual(independent.map(result => result.status), [200, 200]);
    const before = independent[0].data.story;
    const competing = await Promise.all([
      request(route + '/world', { token: alice, method: 'PUT', body: { ...fields(before), content: 'Alice wins?' } }),
      request(route + '/world', { token: bob, method: 'PUT', body: { ...fields(before), content: 'Bob wins?' } }),
    ]);
    assert.deepEqual(competing.map(result => result.status).sort(), [200, 409]);
    const won = competing.find(result => result.status === 200).data.story;
    const lost = competing.find(result => result.status === 409).data.current;
    assert.deepEqual(lost, won); assert.equal(won.revision, 3);
    assert.equal((await request(route + '/world', { token: viewer, method: 'PUT', body: { ...fields(won), content: 'forged editor', role: 'admin' } })).status, 403);
    assert.equal((await request(route, { token: viewer, method: 'POST', body: { ...fields(won), title: 'No rights' } })).status, 403);
    assert.equal((await request('/projects/unknown/stories', { token: alice })).status, 403);
    assert.equal((await request(route + '/world', { token: alice, method: 'PUT', body: { ...fields(won), revision: '3' } })).status, 400);
    assert.equal((await request(route + '/world', { token: alice, method: 'PUT', body: { ...fields(won), title: ' ' } })).status, 400);
    const created = await request(route, { token: alice, method: 'POST', body: { title: '新故事', category: '支线', summary: '新建测试', content: '共享内容' } });
    assert.equal(created.status, 201); assert.equal(created.data.story.updatedBy, 'alice');
    assert.ok((await request(route, { token: bob })).data.stories.some(story => story.id === created.data.story.id));
    const fullStory = { id: 'local-story', title: '真实故事', category: '角色设定', status: '评审中', summary: '完整字段', content: '正文',
      tags: ['主角', '队友'], outlines: ['起因', '转折'], relations: { characters: ['艾拉'], locations: ['矿城'], systems: ['声望'] } };
    const importBody = { sourceInstanceId: 'test-client', sourceProjectId: 'local-project', stories: [fullStory] };
    const copy = await request(route + '/import', { token: alice, method: 'POST', body: importBody });
    assert.equal(copy.status, 200); assert.equal(copy.data.imported.length, 1); assert.equal(copy.data.skipped, 0);
    const copied = copy.data.imported[0]; assert.notEqual(copied.id, fullStory.id);
    for (const field of ['status','tags','outlines','relations']) assert.deepEqual(copied[field], fullStory[field]);
    const retried = await request(route + '/import', { token: bob, method: 'POST', body: importBody });
    assert.equal(retried.data.imported.length, 0); assert.equal(retried.data.skipped, 1);
    assert.equal((await request(route + '/import', { token: viewer, method: 'POST', body: importBody })).status, 403);
    const invalid = await request(route + '/import', { token: alice, method: 'POST', body: { ...importBody, stories: [
      { ...fullStory, id: 'would-be-valid' }, { ...fullStory, id: 'invalid', tags: 'invalid list' },
    ] } });
    assert.equal(invalid.status, 400);
    assert.equal((await request(route, { token: bob })).data.stories.length, 4, 'Invalid batch must not partially import');
    // Older clients may omit new fields; this must never erase imported metadata.
    const legacySave = await request(route + '/' + copied.id, { token: alice, method: 'PUT', body: { ...fields(copied), content: '旧客户端修改正文' } });
    assert.equal(legacySave.status, 200); assert.deepEqual(legacySave.data.story.relations, fullStory.relations);
    assert.deepEqual(legacySave.data.story.tags, fullStory.tags);
    const metadataSave = await request(route + '/' + copied.id, { token: bob, method: 'PUT', body: { ...legacySave.data.story, status: '定稿', tags: ['已审核'] } });
    assert.equal(metadataSave.status, 200);
    const detailHistory = (await request(route + '/' + copied.id + '/history', { token: alice })).data.history;
    assert.deepEqual(detailHistory[0].tags, ['已审核']); assert.deepEqual(detailHistory[1].tags, fullStory.tags);
    const history = (await request(route + '/world/history', { token: viewer })).data.history;
    assert.deepEqual(history.map(item => item.revision), [3, 2, 1]);
    assert.equal(history[0].content, won.content); assert.equal(history[1].updatedBy, 'alice');
    assert.equal((await request('/health', { headers: { Origin: 'https://untrusted.example' } })).status, 403);
    assert.equal((await request('/health', { headers: { Origin: 'http://127.0.0.1:5173' } })).status, 200);
    // Member checks apply to private projects, document IDs and history alike.
    const database = new DatabaseSync(path.join(directory, 'team.sqlite'));
    database.exec("INSERT INTO projects VALUES ('private', 'Private'); INSERT INTO members VALUES ('private', 'admin', 'admin');");
    database.close();
    assert.equal((await request('/projects/private/stories', { token: alice })).status, 403);
    assert.equal((await request('/projects/private/stories/world/history', { token: bob })).status, 403);
    assert.equal((await request('/projects', { token: alice })).data.projects.length, 1);
    assert.equal((await request('/logout', { token: alice, method: 'POST' })).status, 200);
    assert.equal((await request(route, { token: alice })).status, 401);
    const identity = service.serverId;
    await service.close(); service = await createCollaborationServer({ directory, port: 0 });
    assert.equal(service.serverId, identity);
    assert.equal((await request(route, { token: bob })).status, 401);
    const afterRestart = await login('bob');
    assert.deepEqual((await request(route + '/world', { token: afterRestart })).data.story, won);
    assert.equal((await request(route + '/world/history', { token: afterRestart })).data.history.length, 3);
    assert.equal((await request(route, { token: afterRestart })).data.stories.length, 4);
  } finally {
    await service.close();
    assert.ok(path.resolve(directory).startsWith(path.resolve(prefix)));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('upgrade the original team database without rewriting existing stories or history', async () => {
  const prefix = path.join(os.tmpdir(), 'gamecreator-team-upgrade-'), directory = fs.mkdtempSync(prefix);
  let service = await createCollaborationServer({ directory, port: 0 });
  try {
    await service.close();
    const database = new DatabaseSync(path.join(directory, 'team.sqlite'));
    database.exec('ALTER TABLE stories DROP COLUMN details; DROP TABLE story_imports;');
    for (const row of database.prepare('SELECT story_id,revision,snapshot FROM history').all()) {
      const snapshot = JSON.parse(row.snapshot); for (const key of ['status','tags','outlines','relations']) delete snapshot[key];
      database.prepare('UPDATE history SET snapshot=? WHERE story_id=? AND revision=?').run(JSON.stringify(snapshot), row.story_id, row.revision);
    }
    const historyBefore = database.prepare('SELECT * FROM history ORDER BY story_id').all();
    const storiesBefore = database.prepare('SELECT * FROM stories ORDER BY id').all(); database.close();
    service = await createCollaborationServer({ directory, port: 0 });
    const login = await fetch(service.url + '/api/team/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username:'alice', password:'alice123' }) }).then(response => response.json());
    const read = await fetch(service.url + '/api/team/projects/team-demo/stories', { headers: { Authorization: 'Bearer ' + login.token } }).then(response => response.json());
    assert.equal(login.apiVersion, 2); assert.equal(read.stories.length, 2);
    assert.equal(read.stories[0].status, '草稿'); assert.deepEqual(read.stories[0].relations, { characters: [], locations: [], systems: [] });
    const verify = new DatabaseSync(path.join(directory, 'team.sqlite'));
    assert.deepEqual(verify.prepare('SELECT * FROM history ORDER BY story_id').all(), historyBefore);
    assert.deepEqual(verify.prepare('SELECT id,project_id,title,category,summary,content,revision,updated_at,updated_by FROM stories ORDER BY id').all(), storiesBefore);
    verify.close();
  } finally { await service.close(); assert.ok(path.resolve(directory).startsWith(path.resolve(prefix))); fs.rmSync(directory, { recursive: true, force: true }); }
});
