const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const publicationLimits = require('../shared/publication-limits.json');
const { createOverviewStore } = require('./team-overview.cjs');
const { createAccessStore } = require('./team-access.cjs');
const { createCoreStore } = require('./team-core.cjs');
const { createProjectAdminStore } = require('./team-project-admin.cjs');

const demoAccounts = ['admin', 'alice', 'bob', 'viewer'];
class RequestError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
const fail = (status, message, extra) => { throw new RequestError(status, message, extra); };
function textField(value, name, limit, required = false) {
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) fail(400, `${name}无效或过长`);
  return required ? value.trim() : value;
}
const emptyDetails = () => ({ status: '草稿', tags: [], outlines: [], relations: { characters: [], locations: [], systems: [] } });
function stringList(value, name) {
  if (!Array.isArray(value) || value.length > 200 || value.some(item => typeof item !== 'string' || item.length > 2000)) fail(400, `${name}必须是最多 200 项的文本列表`);
  return value;
}
function storyDetails(input, fallback = emptyDetails()) {
  const relations = input.relations ?? fallback.relations;
  if (!relations || typeof relations !== 'object' || Array.isArray(relations)) fail(400, '关联设定格式无效');
  return { status: textField(input.status ?? fallback.status, '状态', 80, true), tags: stringList(input.tags ?? fallback.tags, '标签'),
    outlines: stringList(input.outlines ?? fallback.outlines, '大纲'), relations: {
      characters: stringList(relations.characters, '关联角色'), locations: stringList(relations.locations, '关联地点'), systems: stringList(relations.systems, '关联系统') } };
}
function storyFields(input, fallback) {
  return { title: textField(input.title, '标题', 160, true), content: textField(input.content, '正文', 100000),
    summary: textField(input.summary, '摘要', 2000), category: textField(input.category, '分类', 80, true), ...storyDetails(input, fallback) };
}
async function readBody(request, limit = 2000000) {
  if (!request.headers['content-type']?.startsWith('application/json')) fail(415, '请使用 JSON 请求');
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    // Drain an oversized body without retaining it, so the client receives a
    // reliable 413 response and subsequent requests can reuse the connection.
    if (size <= limit) chunks.push(chunk); else chunks.length = 0;
  }
  if (size > limit) fail(413, '提交内容过大，超过此操作允许的大小。');
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { fail(400, '请求内容不是有效的 JSON 对象'); }
}

async function createCollaborationServer({ directory, port = 4747, root = path.resolve(__dirname, '..'), hostControl }) {
  fs.mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'team.sqlite'));
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS members (project_id TEXT REFERENCES projects(id), user_id TEXT REFERENCES users(id),
      role TEXT NOT NULL CHECK(role IN ('admin', 'editor', 'viewer')), PRIMARY KEY(project_id,user_id));
    CREATE TABLE IF NOT EXISTS stories (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL, category TEXT NOT NULL, summary TEXT NOT NULL, content TEXT NOT NULL,
      revision INTEGER NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS history (story_id TEXT NOT NULL REFERENCES stories(id), revision INTEGER NOT NULL,
      snapshot TEXT NOT NULL, PRIMARY KEY(story_id, revision));
    CREATE TABLE IF NOT EXISTS story_imports (project_id TEXT NOT NULL REFERENCES projects(id), source_key TEXT NOT NULL,
      story_id TEXT NOT NULL REFERENCES stories(id), PRIMARY KEY(project_id,source_key));`);
  // Additive migration: existing verification data and its original history remain intact.
  if (!db.prepare('PRAGMA table_info(stories)').all().some(column => column.name === 'details')) {
    db.exec("ALTER TABLE stories ADD COLUMN details TEXT NOT NULL DEFAULT '{}'");
  }
  if (!db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'server_role')) {
    db.exec("BEGIN IMMEDIATE; ALTER TABLE users ADD COLUMN server_role TEXT NOT NULL DEFAULT 'member'; UPDATE users SET server_role='admin' WHERE id='admin' AND username='admin'; COMMIT");
  }
  if (!db.prepare('PRAGMA table_info(projects)').all().some(column => column.name === 'member_revision')) {
    db.exec('ALTER TABLE projects ADD COLUMN member_revision INTEGER NOT NULL DEFAULT 1');
  }
  db.exec(`CREATE TABLE IF NOT EXISTS project_creations (user_id TEXT NOT NULL REFERENCES users(id),
    request_key TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id), signature TEXT NOT NULL,
    PRIMARY KEY(user_id, request_key))`);
  db.exec(`CREATE TABLE IF NOT EXISTS project_publications (source_instance_id TEXT NOT NULL, source_project_id TEXT NOT NULL,
    project_id TEXT NOT NULL UNIQUE REFERENCES projects(id), published_by TEXT NOT NULL REFERENCES users(id),
    published_at TEXT NOT NULL, story_count INTEGER NOT NULL, PRIMARY KEY(source_instance_id, source_project_id))`);
  const transaction = operation => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const getStory = (project, id) => {
    const row = db.prepare(`SELECT s.id, s.project_id AS projectId, s.title, s.category, s.summary, s.content, s.details,
    s.revision, s.updated_at AS updatedAt, u.username AS updatedBy FROM stories s JOIN users u ON u.id=s.updated_by
    WHERE s.project_id=? AND s.id=?`).get(project, id);
    if (!row) return undefined;
    const { details, ...story } = row;
    return { ...story, ...storyDetails(JSON.parse(details)) };
  };
  const recordHistory = story => db.prepare('INSERT INTO history VALUES (?, ?, ?)').run(story.id, story.revision, JSON.stringify(story));
  transaction(() => {
    if (db.prepare("SELECT value FROM metadata WHERE key='serverId'").get()) return;
    db.prepare('INSERT INTO metadata VALUES (?, ?)').run('serverId', randomUUID());
    for (const username of demoAccounts) {
      const salt = randomBytes(16).toString('hex');
      const hash = scryptSync(username + '123', salt, 64).toString('hex');
      db.prepare('INSERT INTO users (id,username,salt,hash,server_role) VALUES (?, ?, ?, ?, ?)').run(username, username, salt, hash, username === 'admin' ? 'admin' : 'member');
    }
    db.prepare('INSERT INTO projects (id,name) VALUES (?, ?)').run('team-demo', '多人协作验证项目');
    for (const username of demoAccounts) db.prepare('INSERT INTO members VALUES (?, ?, ?)')
      .run('team-demo', username, username === 'admin' ? 'admin' : username === 'viewer' ? 'viewer' : 'editor');
    for (const [id, title, content] of [
      ['world', '世界背景', '在这里共同编写游戏世界。试着让 Alice 和 Bob 同时修改这篇文档，观察冲突提示。'],
      ['chapter', '第一章剧情', '这是一篇独立的文档。两位成员分别修改不同文档时，可以正常保存。'],
    ]) {
      db.prepare('INSERT INTO stories (id,project_id,title,category,summary,content,revision,updated_at,updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, 'team-demo', title, '世界观', '', content, 1, new Date().toISOString(), 'admin');
      recordHistory(getStory('team-demo', id));
    }
  });
  const serverId = db.prepare("SELECT value FROM metadata WHERE key='serverId'").get().value;
  const sessions = new Map();
  const access = createAccessStore(db, { fail, textField });
  const allowedOrigin = origin => {
    try { const url = new URL(origin); return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname); }
    catch { return false; }
  };
  const authenticate = request => {
    const token = request.headers.authorization?.replace(/^Bearer /, '');
    const session = sessions.get(token);
    if (!session || session.expires < Date.now()) { sessions.delete(token); fail(401, '登录已失效，请重新登录。草稿仍保留在本机。'); }
    const user = access.activeUser(session.userId);
    if (session.authRevision !== user.auth_revision) { sessions.delete(token); fail(401, '账号凭据已更新，请重新连接。草稿仍保留在本机。'); }
    return { ...session, token };
  };
  const { membership, requireServerAdmin, memberRows, memberInput, writeMembers } = access;
  const overview = createOverviewStore(db, { fail, textField });
  const core = createCoreStore(db, { fail, activity: overview.activity });
  const projectAdmin = createProjectAdminStore(db, { fail, audit: access.audit });
  const serverRole = user => access.activeUser(user).server_role;
  const publicationSource = input => ({
    sourceInstanceId: textField(input.sourceInstanceId, '本机标识', 100, true),
    sourceProjectId: textField(input.sourceProjectId, '来源项目', 1000, true),
  });
  const findPublication = (source, user) => {
    const published = db.prepare(`SELECT project_id AS projectId, published_at AS publishedAt, story_count AS storyCount
      FROM project_publications WHERE source_instance_id=? AND source_project_id=?`).get(source.sourceInstanceId, source.sourceProjectId);
    if (!published) return null;
    if (projectAdmin.deletedPublication(source)) return null;
    const member = membership(published.projectId, user);
    const project = db.prepare('SELECT id,name FROM projects WHERE id=?').get(published.projectId);
    return { project: { ...project, ...member }, publishedAt: published.publishedAt, storyCount: published.storyCount, overviewInitialized: overview.info(published.projectId).initialized, coreInitialized: core.read(published.projectId).initialized };
  };
  const prepareImports = (stories, source, maximum, minimum = 1) => {
    if (!Array.isArray(stories) || stories.length < minimum || stories.length > maximum) fail(400, `本次应包含 ${minimum}–${maximum} 篇故事文档`);
    const seen = new Set();
    return stories.map(item => {
      if (!item || typeof item !== 'object') fail(400, '导入文档格式无效');
      const sourceId = textField(item.id, '来源文档标识', 1000, true);
      if (seen.has(sourceId)) fail(400, '本次导入含重复文档');
      seen.add(sourceId);
      return { sourceKey: JSON.stringify([source.sourceInstanceId, source.sourceProjectId, sourceId]), fields: storyFields(item) };
    });
  };
  // Call only within the caller's transaction, together with membership checks.
  const insertImportedStory = (project, { sourceKey, fields }, user) => {
    const storyId = randomUUID();
    db.prepare(`INSERT INTO stories (id,project_id,title,category,summary,content,revision,updated_at,updated_by,details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(storyId, project, fields.title, fields.category, fields.summary, fields.content,
        1, new Date().toISOString(), user, JSON.stringify(storyDetails(fields)));
    const story = getStory(project, storyId); recordHistory(story);
    overview.activity(project,user,'导入了故事文档：' + story.title);
    db.prepare('INSERT INTO story_imports VALUES (?, ?, ?)').run(project, sourceKey, storyId);
    return story;
  };
  const send = (response, status, value) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
  };
  const server = http.createServer(async (request, response) => {
    try {
      // Local verification service: accept only loopback hosts and loopback UI origins.
      const host = new URL('http://' + request.headers.host).hostname;
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) fail(403, '仅接受本机连接');
      const origin = request.headers.origin;
      if (origin) {
        if (!allowedOrigin(origin)) fail(403, '不允许的来源');
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      }
      if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
      const url = new URL(request.url, 'http://127.0.0.1');
      const route = url.pathname;
      if (route === '/api/host/status' || route === '/api/host/stop') {
        if (!hostControl) fail(404, '此服务不支持客户端管理');
        const token = request.headers['x-gamecreator-host-token'];
        if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(hostControl.token))) fail(403, '不允许管理这个服务器进程');
        if (route.endsWith('/status') && request.method === 'GET') return send(response, 200, {
          service: 'gamecreator-host', ownerId: hostControl.ownerId, startedAt: hostControl.startedAt, stopping: hostControl.isStopping(),
        });
        if (route.endsWith('/stop') && request.method === 'POST') {
          response.once('finish', () => setImmediate(hostControl.stop));
          return send(response, 200, { ownerId: hostControl.ownerId, stopping: true });
        }
        fail(405, '不支持此操作');
      }
      if (route === '/api/team/health' && request.method === 'GET') return send(response, 200, { service: 'gamecreator-collaboration', serverId, apiVersion: 8 });
      if (route === '/api/team/login' && request.method === 'POST') {
        const input = await readBody(request);
        const username = textField(input.username, '账号', 80, true).toLowerCase();
        const password = textField(input.password, '密码', 256);
        const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
        const hash = scryptSync(password, user?.salt ?? 'invalid-account', 64);
        if (!user || !user.enabled || !timingSafeEqual(hash, Buffer.from(user.hash, 'hex'))) fail(401, '账号或密码错误，或账号已停用');
        for (const [token, session] of sessions) if (session.expires < Date.now()) sessions.delete(token);
        const token = randomBytes(32).toString('hex');
        sessions.set(token, { userId: user.id, username: user.username, authRevision: user.auth_revision, expires: Date.now() + 12 * 60 * 60 * 1000 });
        return send(response, 200, { token, serverId, apiVersion: 8, user: { id: user.id, username: user.username, serverRole: user.server_role } });
      }
      if (route.startsWith('/api/team/')) {
        const session = authenticate(request);
        // Recheck credentials after reading a body: account changes may arrive while it streams.
        const authorized = operation => transaction(() => { authenticate(request); return operation(); });
        if (route === '/api/team/logout' && request.method === 'POST') { sessions.delete(session.token); return send(response, 200, { ok: true }); }
        if (route === '/api/team/admin/projects' && request.method === 'GET') {
          requireServerAdmin(session.userId);
          return send(response,200,{projects:projectAdmin.list(session.userId)});
        }
        const projectAdminMatch = /^\/api\/team\/admin\/projects\/([^/]+)$/.exec(route);
        if (projectAdminMatch) {
          requireServerAdmin(session.userId);
          const project = projectAdminMatch[1];
          if (request.method === 'GET') return send(response,200,projectAdmin.preview(project));
          if (request.method === 'DELETE') {
            const input = await readBody(request);
            return send(response,200,authorized(() => { requireServerAdmin(session.userId); return projectAdmin.remove(project,input,session.userId); }));
          }
          fail(405,'不支持此操作');
        }
        if (route === '/api/team/admin/users' || route === '/api/team/admin/audit' || route.startsWith('/api/team/admin/users/')) {
          requireServerAdmin(session.userId);
          if (route === '/api/team/admin/users' && request.method === 'GET') return send(response, 200, { accounts: access.accounts() });
          if (route === '/api/team/admin/audit' && request.method === 'GET') return send(response, 200, { audit: access.auditRows() });
          if (route === '/api/team/admin/users' && request.method === 'POST') {
            const input = await readBody(request);
            const account = authorized(() => { requireServerAdmin(session.userId); return access.createAccount(session.userId, input); });
            return send(response, 201, { account });
          }
          const target = /^\/api\/team\/admin\/users\/([^/]+)(\/password)?$/.exec(route);
          if (target && ((!target[2] && request.method === 'PUT') || (target[2] && request.method === 'POST'))) {
            const input = await readBody(request);
            const account = authorized(() => { requireServerAdmin(session.userId); return target[2] ? access.resetPassword(session.userId,target[1],input) : access.updateAccount(session.userId,target[1],input); });
            return send(response, 200, { account });
          }
          fail(405, '不支持此操作');
        }
        if (route === '/api/team/accounts' && request.method === 'GET') {
          if (serverRole(session.userId) !== 'admin' && !db.prepare("SELECT 1 FROM members WHERE user_id=? AND role='admin'").get(session.userId)) fail(403, '只有管理员可以配置项目成员');
          return send(response, 200, { accounts: db.prepare('SELECT id AS userId, username, enabled FROM users ORDER BY username').all().map(row => ({ ...row, enabled: !!row.enabled })) });
        }
        if (route === '/api/team/projects' && request.method === 'GET') {
          return send(response, 200, { user: { id: session.userId, username: session.username, serverRole: serverRole(session.userId) }, projects: db.prepare(`SELECT p.id, p.name, m.role FROM projects p
            JOIN members m ON m.project_id=p.id WHERE m.user_id=? AND p.deleted_at IS NULL ORDER BY p.name`).all(session.userId).map(project => ({ ...project, capabilities: membership(project.id,session.userId).capabilities })) });
        }
        if (route === '/api/team/publications/lookup' && request.method === 'POST') {
          requireServerAdmin(session.userId);
          const source = publicationSource(await readBody(request));
          requireServerAdmin(session.userId);
          return send(response, 200, { publication: findPublication(source, session.userId), deletedPublication: projectAdmin.deletedPublication(source) });
        }
        if (route === '/api/team/publications/core' && request.method === 'POST') {
          requireServerAdmin(session.userId);
          const input = await readBody(request, publicationLimits.maxBytes), source = publicationSource(input);
          const result = authorized(() => {
            requireServerAdmin(session.userId);
            const previous = findPublication(source,session.userId);
            if (!previous) fail(404,'找不到这个本地项目的发布记录');
            if (membership(previous.project.id,session.userId).role !== 'admin') fail(403,'只有项目管理员可以补充玩法核心');
            core.initialize(previous.project.id,input.core,session.userId);
            return findPublication(source,session.userId);
          });
          return send(response,200,result);
        }
        if (route === '/api/team/publications/overview' && request.method === 'POST') {
          requireServerAdmin(session.userId);
          const input = await readBody(request), source = publicationSource(input);
          const result = authorized(() => {
            requireServerAdmin(session.userId);
            const previous = findPublication(source, session.userId);
            if (!previous) fail(404,'找不到这个本地项目的发布记录');
            if (membership(previous.project.id,session.userId).role !== 'admin') fail(403,'只有项目管理员可以补充概览');
            overview.initialize(previous.project.id,input.overview,session.userId,previous.project.name);
            return findPublication(source,session.userId);
          });
          return send(response,200,result);
        }
        if (route === '/api/team/publications' && request.method === 'POST') {
          requireServerAdmin(session.userId);
          const input = await readBody(request, publicationLimits.maxBytes), source = publicationSource(input);
          const result = authorized(() => {
            requireServerAdmin(session.userId);
            // A source is published once on this server. Retrying never overwrites
            // team edits or memberships, even if the local snapshot has changed.
            const previous = findPublication(source, session.userId);
            if (previous) return { ...previous, reused: true };
            const deleted = projectAdmin.deletedPublication(source);
            if (deleted && input.replacesProjectId !== deleted.projectId) fail(410,'原协作副本已删除，请重新读取发布预览并明确确认重新发布');
            if (!deleted && input.replacesProjectId !== undefined) fail(409,'发布记录已变化，请重新读取预览');
            const name = textField(input.name, '项目名称', 100, true), members = memberInput(input.members, session.userId);
            const imports = prepareImports(input.stories, source, publicationLimits.maxStories, 0);
            const id = randomUUID(), publishedAt = new Date().toISOString();
            db.prepare('INSERT INTO projects (id,name) VALUES (?, ?)').run(id, name);
            writeMembers(id, members);
            if (input.overview !== undefined) overview.initialize(id,input.overview,session.userId,name);
            if (input.core !== undefined) core.initialize(id,input.core,session.userId);
            for (const entry of imports) insertImportedStory(id, entry, session.userId);
            db.prepare(`INSERT INTO project_publications VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(source_instance_id,source_project_id) DO UPDATE SET project_id=excluded.project_id,published_by=excluded.published_by,published_at=excluded.published_at,story_count=excluded.story_count`)
              .run(source.sourceInstanceId, source.sourceProjectId, id, session.userId, publishedAt, imports.length);
            return { project: { id, name, ...membership(id,session.userId) }, publishedAt, storyCount: imports.length, reused: false, overviewInitialized: overview.info(id).initialized, coreInitialized: core.read(id).initialized };
          });
          return send(response, result.reused ? 200 : 201, result);
        }
        if (route === '/api/team/projects' && request.method === 'POST') {
          requireServerAdmin(session.userId);
          const input = await readBody(request);
          const name = textField(input.name, '项目名称', 100, true), requestKey = textField(input.requestId, '创建请求标识', 100, true);
          if (!/^[a-zA-Z0-9-]{16,100}$/.test(requestKey)) fail(400, '创建请求标识无效');
          const members = memberInput(input.members, session.userId), signature = JSON.stringify({ name, members });
          const result = authorized(() => {
            requireServerAdmin(session.userId);
            const previous = db.prepare('SELECT project_id,signature FROM project_creations WHERE user_id=? AND request_key=?').get(session.userId, requestKey);
            if (previous) {
              const legacySignature = members.every(item => Object.values(item.permissions).every(value => value === 'inherit'))
                ? JSON.stringify({ name, members: members.map(({ userId, role }) => ({ userId, role })) }) : null;
              const v6Signature = members.every(item => item.permissions.core === 'inherit') ? JSON.stringify({ name, members: members.map(item => ({...item,permissions:{overview:item.permissions.overview,stories:item.permissions.stories}})) }) : null;
              if (![signature,legacySignature,v6Signature].includes(previous.signature)) fail(409, '同一创建请求的内容已变化，请重新发起创建');
              const member = membership(previous.project_id, session.userId);
              const project = db.prepare('SELECT id,name FROM projects WHERE id=?').get(previous.project_id);
              return { project: { ...project, role: member.role }, reused: true };
            }
            const id = randomUUID();
            db.prepare('INSERT INTO projects (id,name) VALUES (?, ?)').run(id, name);
            writeMembers(id, members);
            db.prepare('INSERT INTO project_creations VALUES (?, ?, ?, ?)').run(session.userId, requestKey, id, signature);
            return { project: { id, name, role: 'admin' }, reused: false };
          });
          return send(response, result.reused ? 200 : 201, result);
        }
        const coreMatch = /^\/api\/team\/projects\/([^/]+)\/core$/.exec(route);
        if (coreMatch) {
          const project = coreMatch[1], member = membership(project,session.userId);
          if (request.method === 'GET') return send(response,200,{...core.read(project),...member});
          if (request.method === 'PUT') {
            membership(project,session.userId,'core');
            const input = await readBody(request,publicationLimits.maxBytes);
            return send(response,200,authorized(() => {
              const currentMember = membership(project,session.userId,'core');
              return {...core.update(project,input,session.userId),...currentMember};
            }));
          }
        }
        const overviewMatch = /^\/api\/team\/projects\/([^/]+)\/(overview|milestones)(?:\/([^/]+))?$/.exec(route);
        if (overviewMatch) {
          const [,project,resource,id] = overviewMatch, member = membership(project,session.userId);
          if (resource === 'overview' && !id && request.method === 'GET') return send(response,200,{...overview.read(project),...member});
          if (request.method === 'PUT' && ((resource === 'overview' && !id) || (resource === 'milestones' && id))) {
            membership(project,session.userId,'overview');
            const input = await readBody(request);
            const record = authorized(() => {
              membership(project,session.userId,'overview');
              return resource === 'overview' ? overview.updateInfo(project,input,session.userId) : overview.updateMilestone(project,id,input,session.userId);
            });
            return send(response,200,{record});
          }
          fail(405,'不支持此操作');
        }
        const match = /^\/api\/team\/projects\/([^/]+)\/(stories|members)(?:\/([^/]+))?(?:\/(history))?$/.exec(route);
        if (!match) fail(404, '接口不存在');
        const [, project, resource, id, history] = match;
        const member = membership(project, session.userId);
        if (resource === 'members' && !id && request.method === 'GET') {
          return send(response, 200, { members: memberRows(project), revision: db.prepare('SELECT member_revision FROM projects WHERE id=?').get(project).member_revision });
        }
        if (resource === 'members' && !id && request.method === 'PUT') {
          if (member.role !== 'admin') fail(403, '只有项目管理员可以修改成员');
          const input = await readBody(request), members = memberInput(input.members, session.userId, project);
          if (!Number.isSafeInteger(input.revision) || input.revision < 1) fail(400, '必须提供有效的成员配置版本');
          const result = authorized(() => {
            if (membership(project, session.userId).role !== 'admin') fail(403, '只有项目管理员可以修改成员');
            const current = db.prepare('SELECT member_revision FROM projects WHERE id=?').get(project).member_revision;
            if (current !== input.revision) fail(409, '其他管理员已修改成员配置，请重新读取后再保存');
            const before = memberRows(project);
            writeMembers(project, members);
            db.prepare('UPDATE projects SET member_revision=member_revision+1 WHERE id=?').run(project);
            overview.activity(project,session.userId,'更新了项目成员配置');
            access.audit(session.userId, '修改项目权限', project, { projectName: db.prepare('SELECT name FROM projects WHERE id=?').get(project).name, before, after: memberRows(project) });
            return { members: memberRows(project), revision: current + 1 };
          });
          return send(response, 200, result);
        }
        if (resource !== 'stories') fail(404, '接口不存在');
        if (id === 'import' && !history && request.method === 'POST') {
          membership(project, session.userId, 'stories');
          const input = await readBody(request, 5000000);
          const imports = prepareImports(input.stories, publicationSource(input), 50);
          const result = authorized(() => {
            membership(project, session.userId, 'stories');
            const imported = []; let skipped = 0;
            for (const entry of imports) {
              if (db.prepare('SELECT story_id FROM story_imports WHERE project_id=? AND source_key=?').get(project, entry.sourceKey)) { skipped++; continue; }
              imported.push(insertImportedStory(project, entry, session.userId));
            }
            return { imported, skipped };
          });
          return send(response, 200, result);
        }
        if (!id && request.method === 'GET') {
          const ids = db.prepare('SELECT id FROM stories WHERE project_id=? ORDER BY updated_at DESC, id').all(project);
          return send(response, 200, { stories: ids.map(row => getStory(project, row.id)), ...member });
        }
        if (id && request.method === 'GET') {
          const story = getStory(project, id);
          if (!story) fail(404, '文档不存在');
          if (history) return send(response, 200, { history: db.prepare('SELECT snapshot FROM history WHERE story_id=? ORDER BY revision DESC LIMIT 50')
            .all(id).map(row => { const snapshot = JSON.parse(row.snapshot); return { ...snapshot, ...storyDetails(snapshot) }; }) });
          return send(response, 200, { story });
        }
        if (history) fail(405, '不支持此操作');
        if ((!id && request.method === 'POST') || (id && request.method === 'PUT')) {
          membership(project, session.userId, 'stories');
          const input = await readBody(request);
          if (id && (!Number.isSafeInteger(input.revision) || input.revision < 1)) fail(400, '必须提供有效的文档版本');
          const story = authorized(() => {
            // Recheck permissions inside the same transaction as the content update.
            membership(project, session.userId, 'stories');
            const storyId = id || randomUUID(), now = new Date().toISOString();
            const previous = id ? getStory(project, id) : undefined;
            const fields = storyFields(input, previous);
            if (id) {
              const current = previous;
              if (!current) fail(404, '文档不存在');
              if (current.revision !== input.revision) fail(409, '其他成员已修改这篇文档，请对照最新版本处理冲突。', { current });
              const result = db.prepare(`UPDATE stories SET title=?, category=?, summary=?, content=?, revision=revision+1,
                updated_at=?, updated_by=?, details=? WHERE id=? AND project_id=? AND revision=?`)
                .run(fields.title, fields.category, fields.summary, fields.content, now, session.userId, JSON.stringify(storyDetails(fields)), id, project, input.revision);
              if (result.changes !== 1) fail(409, '文档已更新，请重新读取');
            } else {
              db.prepare('INSERT INTO stories (id,project_id,title,category,summary,content,revision,updated_at,updated_by,details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                .run(storyId, project, fields.title, fields.category, fields.summary, fields.content, 1, now, session.userId, JSON.stringify(storyDetails(fields)));
            }
            const saved = getStory(project, storyId); recordHistory(saved); overview.activity(project,session.userId,`${id ? '更新' : '新建'}了故事文档：${saved.title}`); return saved;
          });
          return send(response, id ? 200 : 201, { story });
        }
        fail(405, '不支持此操作');
      }
      if (request.method !== 'GET') fail(405, '不支持此操作');
      const dist = path.join(root, 'dist');
      const relative = decodeURIComponent(route);
      const file = path.resolve(dist, '.' + (relative === '/' ? '/index.html' : relative));
      if (!file.startsWith(dist + path.sep)) fail(403, '非法路径');
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(404, '页面不存在，请先运行 npm run build');
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      const stream = fs.createReadStream(file); stream.on('error', () => response.destroy()); stream.pipe(response);
    } catch (error) {
      if (response.destroyed || response.headersSent) return;
      if (!(error instanceof RequestError)) console.error('Collaboration request failed:', error);
      send(response, error.status || 500, { error: error.status ? error.message : '服务端保存失败，请保留草稿后重试', ...error.extra });
    }
  });
  server.requestTimeout = 15000;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  } catch (error) { db.close(); throw error; }
  let closed = false;
  return { server, url: `http://127.0.0.1:${server.address().port}`, directory, serverId,
    close: async () => {
      if (closed) return; closed = true;
      await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
      db.close();
    } };
}

module.exports = { createCollaborationServer };
if (require.main === module) {
  const directory = process.env.GAMECREATOR_TEAM_DATA_DIR || path.resolve(__dirname, '../.gamecreator/collaboration');
  createCollaborationServer({ directory, port: Number(process.env.GAMECREATOR_TEAM_PORT || 4747) }).then(service => {
    console.log(`GameCreator 本机协作服务：${service.url}/?team=alice\n数据目录：${service.directory}`);
    console.log('验证账号：admin / admin123、alice / alice123、bob / bob123、viewer / viewer123（只读）');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void service.close().then(() => process.exit()); });
  }).catch(error => { console.error('协作服务启动失败：', error.message); process.exitCode = 1; });
}
