const { randomUUID } = require('node:crypto');

function createOverviewStore(db, { fail, textField }) {
  db.exec(`CREATE TABLE IF NOT EXISTS project_overviews (project_id TEXT PRIMARY KEY REFERENCES projects(id), fields TEXT NOT NULL,
    revision INTEGER NOT NULL, initialized INTEGER NOT NULL, updated_at TEXT, updated_by TEXT REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS project_milestones (project_id TEXT NOT NULL REFERENCES projects(id), id TEXT NOT NULL, fields TEXT NOT NULL,
    revision INTEGER NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(project_id,id));
    CREATE TABLE IF NOT EXISTS project_activity (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL REFERENCES projects(id),
    actor_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS project_activity_recent ON project_activity(project_id,id DESC);`);
  const infoFields = input => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, '项目基本信息格式无效');
    return Object.fromEntries([['name','项目名称',100],['genre','项目类型',80],['platform','目标平台',120],['version','当前版本',80],['status','项目状态',80],['description','项目简介',10000]]
      .map(([key,label,limit]) => [key, textField(input[key], label, limit, key === 'name')]));
  };
  const milestoneFields = input => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || !['planned','active','done'].includes(input.status)) fail(400, '里程碑格式或状态无效');
    return { title: textField(input.title, '里程碑名称',160,true), owner: textField(input.owner,'负责人',80), due: textField(input.due,'日期',40), status: input.status };
  };
  const publicationFields = (input, name) => {
    if (!input || !Array.isArray(input.milestones) || input.milestones.length > 200) fail(400, '概览必须包含最多 200 个里程碑');
    return { info: infoFields({ ...input.info, name }), milestones: input.milestones.map(milestoneFields) };
  };
  const activity = (project, user, title) => db.prepare('INSERT INTO project_activity (project_id,actor_id,title,created_at) VALUES (?,?,?,?)').run(project,user,title,new Date().toISOString());
  const info = project => {
    const row = db.prepare(`SELECT o.*,u.username FROM project_overviews o LEFT JOIN users u ON u.id=o.updated_by WHERE project_id=?`).get(project);
    const name = db.prepare('SELECT name FROM projects WHERE id=?').get(project)?.name;
    if (name === undefined) fail(404,'项目不存在');
    return { id: project, fields: { genre:'',platform:'',version:'',status:'',description:'',...(row ? JSON.parse(row.fields) : {}), name },
      revision: row?.revision ?? 0, initialized: !!row?.initialized, updatedAt: row?.updated_at ?? null, updatedBy: row?.username ?? null };
  };
  const milestone = (project,id) => {
    const row = db.prepare(`SELECT m.*,u.username FROM project_milestones m JOIN users u ON u.id=m.updated_by WHERE project_id=? AND m.id=?`).get(project,id);
    return row ? { id: row.id, fields: JSON.parse(row.fields), revision: row.revision, updatedAt: row.updated_at, updatedBy: row.username } : null;
  };
  const read = project => ({ info: info(project), milestones: db.prepare('SELECT id FROM project_milestones WHERE project_id=? ORDER BY updated_at,id').all(project).map(row => milestone(project,row.id)),
    activity: db.prepare(`SELECT a.id,a.title,a.created_at AS createdAt,u.username AS actor FROM project_activity a JOIN users u ON u.id=a.actor_id WHERE project_id=? ORDER BY a.id DESC LIMIT 50`).all(project) });
  const revision = value => { if (!Number.isSafeInteger(value) || value < 0) fail(400,'必须提供有效的内容版本'); };
  const setInfo = (project, fields, user, nextRevision) => {
    db.prepare(`INSERT INTO project_overviews VALUES (?,?,?,1,?,?) ON CONFLICT(project_id) DO UPDATE SET fields=excluded.fields,
      revision=excluded.revision,initialized=1,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).run(project,JSON.stringify(fields),nextRevision,new Date().toISOString(),user);
    db.prepare('UPDATE projects SET name=? WHERE id=?').run(fields.name,project);
  };
  const updateInfo = (project,input,user) => {
    revision(input.revision); const fields = infoFields(input.fields), current = info(project);
    if (input.revision !== current.revision) fail(409,'项目基本信息已被其他成员更新，请处理冲突。',{currentRecord:current});
    setInfo(project,fields,user,current.revision+1); activity(project,user,'更新了项目基本信息'); return info(project);
  };
  const updateMilestone = (project,id,input,user) => {
    if (!/^[0-9a-f-]{36}$/.test(id)) fail(400,'里程碑标识无效');
    revision(input.revision); const fields = milestoneFields(input.fields), current = milestone(project,id);
    if (input.revision !== (current?.revision ?? 0)) fail(409,'这个里程碑已被其他成员更新，请处理冲突。',{currentRecord:current});
    if (!current && db.prepare('SELECT COUNT(*) AS n FROM project_milestones WHERE project_id=?').get(project).n >= 200) fail(400,'每个项目最多 200 个里程碑');
    db.prepare(`INSERT INTO project_milestones VALUES (?,?,?,?,?,?) ON CONFLICT(project_id,id) DO UPDATE SET fields=excluded.fields,
      revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).run(project,id,JSON.stringify(fields),(current?.revision ?? 0)+1,new Date().toISOString(),user);
    db.prepare(`INSERT INTO project_overviews VALUES (?,'{}',0,1,NULL,NULL) ON CONFLICT(project_id) DO UPDATE SET initialized=1`).run(project);
    activity(project,user,`${current ? '更新' : '新增'}了里程碑：${fields.title}`); return milestone(project,id);
  };
  const initialize = (project, input, user, name) => {
    if (info(project).initialized) fail(409,'团队概览已初始化，请进入协作项目查看，不能再用本地内容覆盖。');
    const value = publicationFields(input,name);
    setInfo(project,value.info,user,1);
    for (const fields of value.milestones) db.prepare('INSERT INTO project_milestones VALUES (?,?,?,?,?,?)').run(project,randomUUID(),JSON.stringify(fields),1,new Date().toISOString(),user);
    activity(project,user,'从本地项目初始化了项目概览'); return read(project);
  };
  return { info, read, activity, updateInfo, updateMilestone, initialize, publicationFields };
}
module.exports = { createOverviewStore };
