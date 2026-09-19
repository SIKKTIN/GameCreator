const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createCollaborationServer } = require('../server/collaboration.cjs');

test('empty projects, idempotent creation, per-project membership, role changes and restart', async () => {
  const prefix = path.join(os.tmpdir(), 'gamecreator-projects-'), directory = fs.mkdtempSync(prefix);
  let service = await createCollaborationServer({ directory, port: 0 });
  const request = async (route, token, method = 'GET', body) => {
    const response = await fetch(service.url + '/api/team' + route, { method,
      headers: { Authorization: 'Bearer ' + (token || ''), 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const login = async username => {
    const result = await request('/login', '', 'POST', { username, password: username + '123' });
    assert.equal(result.status, 200); return result.data;
  };
  const members = (...extra) => [{ userId: 'admin', role: 'admin' }, ...extra];
  const aliceAdmin = { userId: 'alice', role: 'admin' }, bobEditor = { userId: 'bob', role: 'editor' };
  try {
    let admin = await login('admin'); const alice = await login('alice'), bob = await login('bob'), viewer = await login('viewer');
    assert.equal(admin.user.serverRole, 'admin'); assert.equal(alice.user.serverRole, 'member');
    assert.equal((await request('/accounts', viewer.token)).status, 403);
    const accounts = await request('/accounts', admin.token);
    assert.deepEqual(accounts.data.accounts.map(row => Object.keys(row).sort()), Array(4).fill(['enabled', 'userId', 'username']));
    const createBody = { name: ' 独立项目 ', requestId: randomUUID(), members: members(aliceAdmin, bobEditor) };
    for (const token of ['', alice.token, bob.token, viewer.token]) {
      assert.equal((await request('/projects', token, 'POST', { ...createBody, role: 'admin', serverRole: 'admin' })).status, token ? 403 : 401);
    }
    const created = await Promise.all([request('/projects', admin.token, 'POST', createBody), request('/projects', admin.token, 'POST', createBody)]);
    assert.deepEqual(created.map(row => row.status).sort(), [200, 201]);
    const project = created[0].data.project, route = '/projects/' + project.id;
    assert.equal(project.id, created[1].data.project.id); assert.equal(project.name, '独立项目');
    assert.deepEqual((await request(route + '/stories', bob.token)).data.stories, []);
    assert.equal((await request('/projects', admin.token, 'POST', { ...createBody, name: 'changed' })).status, 409);
    const other = await request('/projects', admin.token, 'POST', { ...createBody, requestId: randomUUID(), members: members({ userId: 'viewer', role: 'viewer' }) });
    assert.equal(other.status, 201); assert.notEqual(other.data.project.id, project.id);
    assert.deepEqual((await request('/projects', bob.token)).data.projects.map(row => row.id).sort(), [project.id, 'team-demo'].sort());
    assert.deepEqual((await request('/projects', viewer.token)).data.projects.map(row => row.id).sort(), [other.data.project.id, 'team-demo'].sort());
    for (const suffix of ['/stories', '/members', '/stories/world', '/stories/world/history']) {
      assert.equal((await request(route + suffix, viewer.token)).status, 403);
    }
    assert.equal((await request(route + '/stories/import', viewer.token, 'POST', {})).status, 403);
    for (const bad of [[], members(bobEditor, bobEditor), members({ userId: 'missing', role: 'admin' }), [{ userId: 'admin', role: 'viewer' }], members({ userId: 'bob', role: 'owner' })]) {
      assert.equal((await request('/projects', admin.token, 'POST', { ...createBody, requestId: randomUUID(), members: bad })).status, 400);
    }
    assert.equal((await request('/projects', admin.token)).data.projects.length, 3, 'Invalid requests must not create partial projects');
    assert.equal((await request('/accounts', alice.token)).status, 200, 'Project admin can choose members');
    assert.equal((await request('/projects', alice.token, 'POST', { ...createBody, requestId: randomUUID() })).status, 403, 'Project admin cannot create server projects');
    let current = (await request(route + '/members', admin.token)).data;
    for (const token of [bob.token, viewer.token]) assert.equal((await request(route + '/members', token, 'PUT', { members: members(), revision: current.revision })).status, 403);
    assert.equal((await request(route + '/members', admin.token, 'PUT', { members: [aliceAdmin], revision: current.revision })).status, 400);
    const competing = await Promise.all([
      request(route + '/members', admin.token, 'PUT', { members: members(aliceAdmin, { userId: 'bob', role: 'viewer' }), revision: current.revision }),
      request(route + '/members', alice.token, 'PUT', { members: members(aliceAdmin, { userId: 'bob', role: 'viewer' }), revision: current.revision }),
    ]);
    assert.deepEqual(competing.map(row => row.status).sort(), [200, 409]);
    current = (await request(route + '/members', admin.token)).data;
    assert.equal(current.revision, 2); assert.equal(current.members.find(row => row.userId === 'bob').role, 'viewer');
    const fields = { title: '项目隔离文档', category: '世界观', summary: '', content: 'saved' };
    const story = await request(route + '/stories', alice.token, 'POST', fields);
    assert.equal(story.status, 201);
    const storyRoute = route + '/stories/' + story.data.story.id;
    assert.equal((await request(storyRoute, bob.token)).status, 200);
    assert.equal((await request(storyRoute, bob.token, 'PUT', { ...fields, revision: 1 })).status, 403);
    assert.equal((await request('/projects/' + other.data.project.id + '/stories/' + story.data.story.id, viewer.token)).status, 404);
    assert.equal((await request('/projects/' + other.data.project.id + '/stories/' + story.data.story.id + '/history', viewer.token)).status, 404);
    const revoked = await request(route + '/members', admin.token, 'PUT', { revision: current.revision, members: members(bobEditor) });
    assert.equal(revoked.status, 200);
    for (const suffix of ['/stories', '/members', '/stories/' + story.data.story.id, '/stories/' + story.data.story.id + '/history']) {
      assert.equal((await request(route + suffix, alice.token)).status, 403, 'Existing sessions must observe membership removal');
    }
    assert.equal((await request(storyRoute, alice.token, 'PUT', { ...fields, revision: 1 })).status, 403);
    assert.equal((await request(route + '/stories/import', alice.token, 'POST', {})).status, 403);
    assert.equal((await request(route + '/members', alice.token, 'PUT', { members: members(aliceAdmin), revision: revoked.data.revision })).status, 403);
    assert.equal((await request('/projects', alice.token)).data.projects.some(row => row.id === project.id), false);
    assert.equal((await request('/projects/team-demo/stories', alice.token)).status, 200, 'Other memberships remain intact');
    const identity = service.serverId;
    await service.close(); service = await createCollaborationServer({ directory, port: 0 }); admin = await login('admin');
    assert.equal(service.serverId, identity);
    const retry = await request('/projects', admin.token, 'POST', createBody);
    assert.equal(retry.status, 200); assert.equal(retry.data.project.id, project.id);
    assert.equal((await request(route + '/members', admin.token)).data.revision, 3, 'Creation retry must not restore revoked membership');
    assert.equal((await request(storyRoute, admin.token)).data.story.content, fields.content);
    assert.equal((await request(storyRoute + '/history', admin.token)).data.history.length, 1);
  } finally {
    await service.close(); assert.ok(path.resolve(directory).startsWith(path.resolve(prefix)));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
