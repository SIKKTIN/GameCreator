const { createHash } = require('node:crypto');

function createProjectAdminStore(db, { fail, audit }) {
  const columns = db.prepare('PRAGMA table_info(projects)').all().map(c => c.name);
  for (const column of ['deleted_at','deleted_by','deletion_version']) if (!columns.includes(column)) db.exec(`ALTER TABLE projects ADD COLUMN ${column} TEXT`);
  const row = id => {
    const project = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
    if (!project) fail(404,'协作项目不存在');
    return project;
  };
  const list = user => db.prepare(`SELECT p.id,p.name,m.role,
    (SELECT COUNT(*) FROM members WHERE project_id=p.id) AS memberCount,
    (SELECT COUNT(*) FROM stories WHERE project_id=p.id) AS storyCount
    FROM projects p LEFT JOIN members m ON m.project_id=p.id AND m.user_id=? WHERE p.deleted_at IS NULL ORDER BY p.name,p.id`).all(user);
  const preview = id => {
    const project = row(id);
    if (project.deleted_at) return { project:{id:project.id,name:project.name},deleted:true,deletedAt:project.deleted_at };
    const stories = db.prepare('SELECT id,revision FROM stories WHERE project_id=? ORDER BY id').all(id);
    const overview = db.prepare('SELECT revision,initialized FROM project_overviews WHERE project_id=?').get(id) ?? null;
    const milestones = db.prepare('SELECT id,revision FROM project_milestones WHERE project_id=? ORDER BY id').all(id);
    const graphs = db.prepare('SELECT id,revision,graph IS NOT NULL AS live FROM core_graphs WHERE project_id=? ORDER BY id').all(id);
    const core = db.prepare('SELECT root_id,refs FROM core_projects WHERE project_id=?').get(id) ?? null;
    const gameplay = db.prepare('SELECT id,revision FROM gameplay_documents WHERE project_id=? ORDER BY id').all(id);
    const gameplayMeta = db.prepare('SELECT category_revision FROM gameplay_projects WHERE project_id=?').get(id)??null;
    const counts = {
      gameplays:gameplay.length,gameplayHistory:db.prepare('SELECT COUNT(*) AS n FROM gameplay_history WHERE project_id=?').get(id).n,
      members:db.prepare('SELECT COUNT(*) AS n FROM members WHERE project_id=?').get(id).n,
      stories:stories.length, history:db.prepare('SELECT COUNT(*) AS n FROM history WHERE story_id IN (SELECT id FROM stories WHERE project_id=?)').get(id).n,
      overview:overview?.initialized ? 1 : 0, milestones:milestones.length, graphs:graphs.filter(g => g.live).length,
    };
    const version = createHash('sha256').update(JSON.stringify({id:project.id,name:project.name,members:project.member_revision,stories,overview,milestones,graphs,core,gameplay,gameplayMeta,counts})).digest('hex');
    return { project:{id:project.id,name:project.name},deleted:false,counts,version };
  };
  // Called inside the request's authorization transaction. Retain only project identity
  // and publication/creation receipts so delayed retries cannot resurrect a deletion.
  const remove = (id,input,user) => {
    const project = row(id);
    if (typeof input.version !== 'string' || !/^[a-f0-9]{64}$/.test(input.version) || input.confirmName !== project.name) fail(400,'请输入完整项目名称并重新核对删除范围');
    if (project.deleted_at) {
      if (project.deletion_version !== input.version) fail(410,'这个协作项目已被删除');
      return {projectId:id,name:project.name,deleted:true,deletedAt:project.deleted_at,reused:true};
    }
    const current = preview(id);
    if (current.version !== input.version) fail(409,'项目内容或成员已变化，请重新核对删除范围后确认');
    db.prepare('DELETE FROM history WHERE story_id IN (SELECT id FROM stories WHERE project_id=?)').run(id);
    for (const table of ['gameplay_history','gameplay_operations','gameplay_documents','gameplay_projects','story_imports','stories','project_milestones','project_overviews','project_activity','core_operations','core_graphs','core_projects','member_permissions','members']) {
      db.prepare(`DELETE FROM ${table} WHERE project_id=?`).run(id);
    }
    const deletedAt = new Date().toISOString();
    db.prepare('UPDATE projects SET deleted_at=?,deleted_by=?,deletion_version=? WHERE id=?').run(deletedAt,user,input.version,id);
    audit(user,'删除协作项目',id,{projectName:project.name,counts:current.counts});
    return {projectId:id,name:project.name,deleted:true,deletedAt,reused:false};
  };
  const deletedPublication = source => {
    const result = db.prepare(`SELECT p.id AS projectId,p.name,p.deleted_at AS deletedAt FROM project_publications r
      JOIN projects p ON p.id=r.project_id WHERE r.source_instance_id=? AND r.source_project_id=? AND p.deleted_at IS NOT NULL`).get(source.sourceInstanceId,source.sourceProjectId);
    return result ?? null;
  };
  return { list, preview, remove, deletedPublication };
}
module.exports = { createProjectAdminStore };
