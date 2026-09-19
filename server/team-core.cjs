const { createHash } = require('node:crypto');
const { emptyCoreSnapshot, sameGraph, applyCoreChanges, normalizeCorePublication, graphContent } = require('../src/team-core-model.ts');

function createCoreStore(db, { fail, activity }) {
  db.exec(`CREATE TABLE IF NOT EXISTS core_projects (project_id TEXT PRIMARY KEY REFERENCES projects(id), root_id TEXT NOT NULL, refs TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS core_graphs (project_id TEXT NOT NULL REFERENCES projects(id), id TEXT NOT NULL, graph TEXT,
      revision INTEGER NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(project_id,id));
    CREATE TABLE IF NOT EXISTS core_operations (project_id TEXT NOT NULL REFERENCES projects(id), user_id TEXT NOT NULL REFERENCES users(id),
      request_id TEXT NOT NULL, signature TEXT NOT NULL, PRIMARY KEY(project_id,user_id,request_id));`);
  const read = project => {
    const meta = db.prepare('SELECT * FROM core_projects WHERE project_id=?').get(project);
    if (!meta) return emptyCoreSnapshot();
    const rows = db.prepare('SELECT g.*,u.username FROM core_graphs g JOIN users u ON u.id=g.updated_by WHERE project_id=? ORDER BY g.id').all(project);
    return { initialized: true, store: { schema: 1, rootId: meta.root_id, graphs: rows.filter(r => r.graph !== null).map(r => JSON.parse(r.graph)) },
      references: JSON.parse(meta.refs), versions: Object.fromEntries(rows.map(r => [r.id,r.revision])),
      stamps: Object.fromEntries(rows.map(r => [r.id,{ updatedAt: r.updated_at, updatedBy: r.username }])) };
  };
  const normalize = value => { try { return normalizeCorePublication(value); } catch (error) { fail(400,error.message); } };
  const writeGraph = (project,id,graph,revision,user) => db.prepare(`INSERT INTO core_graphs VALUES (?,?,?,?,?,?)
    ON CONFLICT(project_id,id) DO UPDATE SET graph=excluded.graph,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
    .run(project,id,graph ? JSON.stringify(graph) : null,revision,new Date().toISOString(),user);
  const initialize = (project,input,user) => {
    if (read(project).initialized) fail(409,'团队玩法核心已开始编辑，不能再用本地内容覆盖');
    const value = normalize(input);
    db.prepare('INSERT INTO core_projects VALUES (?,?,?)').run(project,value.store.rootId,JSON.stringify(value.references));
    value.store.graphs.forEach(g => writeGraph(project,g.id,g,1,user));
    activity(project,user,'初始化了玩法核心'); return read(project);
  };
  const update = (project,input,user) => {
    const current = read(project), changes = input.changes;
    if (typeof input.requestId !== 'string' || !input.requestId.trim() || input.requestId.length > 200 || !Array.isArray(changes) || changes.length > 1000 ||
      changes.some(c => !c || typeof c.id !== 'string' || c.id.length > 200 || !Number.isSafeInteger(c.revision) || c.revision < 0 || (c.graph !== null && (!c.graph || c.graph.id !== c.id))) || new Set(changes.map(c => c.id)).size !== changes.length) fail(400,'玩法核心提交格式无效');
    let signature;
    try { signature = createHash('sha256').update(JSON.stringify({ rootId: input.rootId, changes: changes.map(c => ({ ...c,graph:graphContent(c.graph) })) })).digest('hex'); } catch { fail(400,'流程字段无效'); }
    const prior = db.prepare('SELECT signature FROM core_operations WHERE project_id=? AND user_id=? AND request_id=?').get(project,user,input.requestId);
    if (prior) { if (prior.signature !== signature) fail(409,'提交请求的内容已变化，请重新提交'); return current; }
    const conflict = () => fail(409,'玩法核心已有新的团队版本，请对照处理后再提交', { currentRecord: current });
    if (input.rootId !== current.store.rootId || changes.some(c => c.revision !== (current.versions[c.id] ?? 0))) conflict();
    let candidate;
    try { candidate = applyCoreChanges(current.store,changes); } catch { fail(409,'流程结构已变化或不完整，请重新核对模块及内部流程', { currentRecord: current }); }
    candidate = normalize({ store: candidate, references: current.references }).store;
    const oldNodes = new Map(current.store.graphs.flatMap(g => g.nodes.map(n => [n.id,n])));
    // Existing positions are immutable server-side. Only new nodes carry an initial layout.
    candidate = { ...candidate, graphs: candidate.graphs.map(g => ({ ...g,nodes:g.nodes.map(n => ({ ...n, ...(oldNodes.has(n.id) ? { x:oldNodes.get(n.id).x,y:oldNodes.get(n.id).y } : {}) })) })) };
    const effective = changes.filter(c => !sameGraph(current.store.graphs.find(g => g.id === c.id),candidate.graphs.find(g => g.id === c.id)));
    if (effective.length) {
      if (!current.initialized) db.prepare('INSERT INTO core_projects VALUES (?,?,?)').run(project,candidate.rootId,'[]');
      // Every removed descendant must appear explicitly with its current version.
      // Whole-tree validation above prevents omission of newly created descendants.
      effective.forEach(c => writeGraph(project,c.id,candidate.graphs.find(g => g.id === c.id) ?? null,c.revision + 1,user));
      if (!current.initialized && !effective.some(c => c.id === candidate.rootId)) writeGraph(project,candidate.rootId,candidate.graphs.find(g => g.id === candidate.rootId),1,user);
      activity(project,user,`更新了玩法核心：${effective.length} 个流程`);
    }
    db.prepare('INSERT INTO core_operations VALUES (?,?,?,?)').run(project,user,input.requestId,signature);
    return read(project);
  };
  return { read, initialize, update };
}
module.exports = { createCoreStore };
