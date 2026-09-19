const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

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
    if (size > limit) fail(413, '提交内容过大，请减少本次复制的文档数量');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { fail(400, '请求内容不是有效的 JSON 对象'); }
}

async function createCollaborationServer({ directory, port = 4747, root = path.resolve(__dirname, '..') }) {
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
      db.prepare('INSERT INTO users VALUES (?, ?, ?, ?)').run(username, username, salt, hash);
    }
    db.prepare('INSERT INTO projects VALUES (?, ?)').run('team-demo', '多人协作验证项目');
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
  const allowedOrigin = origin => {
    try { const url = new URL(origin); return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname); }
    catch { return false; }
  };
  const authenticate = request => {
    const token = request.headers.authorization?.replace(/^Bearer /, '');
    const session = sessions.get(token);
    if (!session || session.expires < Date.now()) { sessions.delete(token); fail(401, '登录已失效，请重新登录。草稿仍保留在本机。'); }
    return { ...session, token };
  };
  const membership = (project, user, write = false) => {
    const member = db.prepare('SELECT role FROM members WHERE project_id=? AND user_id=?').get(project, user);
    if (!member) fail(403, '你不是这个项目的成员');
    if (write && member.role === 'viewer') fail(403, '当前账号只有查看权限');
    return member;
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
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
      }
      if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
      const url = new URL(request.url, 'http://127.0.0.1');
      const route = url.pathname;
      if (route === '/api/team/health' && request.method === 'GET') return send(response, 200, { service: 'gamecreator-collaboration', serverId, apiVersion: 2 });
      if (route === '/api/team/login' && request.method === 'POST') {
        const input = await readBody(request);
        const username = textField(input.username, '账号', 80, true).toLowerCase();
        const password = textField(input.password, '密码', 256, true);
        const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
        const hash = scryptSync(password, user?.salt ?? 'invalid-account', 64);
        if (!user || !timingSafeEqual(hash, Buffer.from(user.hash, 'hex'))) fail(401, '账号或密码错误');
        for (const [token, session] of sessions) if (session.expires < Date.now()) sessions.delete(token);
        const token = randomBytes(32).toString('hex');
        sessions.set(token, { userId: user.id, username: user.username, expires: Date.now() + 12 * 60 * 60 * 1000 });
        return send(response, 200, { token, serverId, apiVersion: 2, user: { id: user.id, username: user.username } });
      }
      if (route.startsWith('/api/team/')) {
        const session = authenticate(request);
        if (route === '/api/team/logout' && request.method === 'POST') { sessions.delete(session.token); return send(response, 200, { ok: true }); }
        if (route === '/api/team/projects' && request.method === 'GET') {
          return send(response, 200, { projects: db.prepare(`SELECT p.id, p.name, m.role FROM projects p
            JOIN members m ON m.project_id=p.id WHERE m.user_id=? ORDER BY p.name`).all(session.userId) });
        }
        const match = /^\/api\/team\/projects\/([^/]+)\/(stories|members)(?:\/([^/]+))?(?:\/(history))?$/.exec(route);
        if (!match) fail(404, '接口不存在');
        const [, project, resource, id, history] = match;
        const member = membership(project, session.userId);
        if (resource === 'members' && !id && request.method === 'GET') {
          return send(response, 200, { members: db.prepare(`SELECT u.username, m.role FROM members m JOIN users u ON u.id=m.user_id
            WHERE m.project_id=? ORDER BY u.username`).all(project) });
        }
        if (resource !== 'stories') fail(404, '接口不存在');
        if (id === 'import' && !history && request.method === 'POST') {
          membership(project, session.userId, true);
          const input = await readBody(request, 5000000);
          const sourceInstanceId = textField(input.sourceInstanceId, '本机标识', 100, true);
          const sourceProjectId = textField(input.sourceProjectId, '来源项目', 1000, true);
          if (!Array.isArray(input.stories) || input.stories.length < 1 || input.stories.length > 50) fail(400, '每次请选择 1–50 篇故事文档');
          const seen = new Set();
          const imports = input.stories.map(item => {
            if (!item || typeof item !== 'object') fail(400, '导入文档格式无效');
            const sourceId = textField(item.id, '来源文档标识', 1000, true);
            if (seen.has(sourceId)) fail(400, '本次导入含重复文档');
            seen.add(sourceId);
            return { sourceKey: JSON.stringify([sourceInstanceId, sourceProjectId, sourceId]), fields: storyFields(item) };
          });
          const result = transaction(() => {
            membership(project, session.userId, true);
            const imported = []; let skipped = 0;
            for (const { sourceKey, fields } of imports) {
              if (db.prepare('SELECT story_id FROM story_imports WHERE project_id=? AND source_key=?').get(project, sourceKey)) { skipped++; continue; }
              const storyId = randomUUID();
              db.prepare(`INSERT INTO stories (id,project_id,title,category,summary,content,revision,updated_at,updated_by,details)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(storyId, project, fields.title, fields.category, fields.summary, fields.content,
                1, new Date().toISOString(), session.userId, JSON.stringify(storyDetails(fields)));
              const story = getStory(project, storyId); recordHistory(story);
              db.prepare('INSERT INTO story_imports VALUES (?, ?, ?)').run(project, sourceKey, storyId);
              imported.push(story);
            }
            return { imported, skipped };
          });
          return send(response, 200, result);
        }
        if (!id && request.method === 'GET') {
          const ids = db.prepare('SELECT id FROM stories WHERE project_id=? ORDER BY updated_at DESC, id').all(project);
          return send(response, 200, { stories: ids.map(row => getStory(project, row.id)), role: member.role });
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
          membership(project, session.userId, true);
          const input = await readBody(request);
          if (id && (!Number.isSafeInteger(input.revision) || input.revision < 1)) fail(400, '必须提供有效的文档版本');
          const story = transaction(() => {
            // Recheck permissions inside the same transaction as the content update.
            membership(project, session.userId, true);
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
            const saved = getStory(project, storyId); recordHistory(saved); return saved;
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
