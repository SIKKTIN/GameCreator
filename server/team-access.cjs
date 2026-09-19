const { randomUUID, randomBytes, scryptSync } = require('node:crypto');

function createAccessStore(db, { fail, textField }) {
  const columns = db.prepare('PRAGMA table_info(users)').all().map(column => column.name);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const column of ['enabled', 'revision', 'auth_revision']) if (!columns.includes(column)) db.exec(`ALTER TABLE users ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 1`);
    db.exec(`CREATE TABLE IF NOT EXISTS member_permissions (project_id TEXT NOT NULL, user_id TEXT NOT NULL,
      overview TEXT NOT NULL, stories TEXT NOT NULL, PRIMARY KEY(project_id,user_id),
      FOREIGN KEY(project_id,user_id) REFERENCES members(project_id,user_id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS access_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL REFERENCES users(id),
        action TEXT NOT NULL, target TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL); COMMIT;`);
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  if (!db.prepare('PRAGMA table_info(member_permissions)').all().some(column => column.name === 'core')) db.exec("ALTER TABLE member_permissions ADD COLUMN core TEXT NOT NULL DEFAULT 'inherit'");
  const inherit = () => ({ overview: 'inherit', stories: 'inherit', core: 'inherit' });
  const permissions = (project, user) => {
    const row = db.prepare('SELECT overview,stories,core FROM member_permissions WHERE project_id=? AND user_id=?').get(project, user);
    return row ? { ...row } : inherit();
  };
  const effective = (role, overrides = inherit()) => ({
    overview: role === 'admin' || (role === 'editor' && overrides.overview === 'edit') ? 'edit' : 'view',
    stories: role === 'admin' || (role === 'editor' && overrides.stories !== 'view') ? 'edit' : 'view',
    core: role === 'admin' || (role === 'editor' && overrides.core !== 'view') ? 'edit' : 'view',
  });
  const activeUser = user => {
    const row = db.prepare('SELECT id,username,server_role,enabled,auth_revision FROM users WHERE id=?').get(user);
    if (!row?.enabled) fail(401, '账号已停用或登录失效，请重新连接。草稿仍保留在本机。');
    return row;
  };
  const membership = (project, user, writeModule) => {
    activeUser(user);
    if (db.prepare('SELECT deleted_at FROM projects WHERE id=?').get(project)?.deleted_at) fail(410,'这个协作项目已被管理员删除。本机项目和未提交草稿仍保留，请选择其他项目。');
    const row = db.prepare('SELECT role FROM members WHERE project_id=? AND user_id=?').get(project, user);
    if (!row) fail(403, '你不是这个项目的成员');
    const capabilities = effective(row.role, permissions(project, user));
    if (writeModule && capabilities[writeModule] !== 'edit') fail(403, `你只有${{overview:'项目概览',stories:'故事文档',core:'玩法核心'}[writeModule]}查看权限，请联系项目管理员授权。`);
    return { ...row, capabilities };
  };
  const requireServerAdmin = user => { if (activeUser(user).server_role !== 'admin') fail(403, '此操作需要服务器管理员权限'); };
  const audit = (actor, action, target, details = {}) => db.prepare('INSERT INTO access_audit (actor_id,action,target,details,created_at) VALUES (?,?,?,?,?)')
    .run(actor, action, target, JSON.stringify(details), new Date().toISOString());
  const memberRows = project => db.prepare(`SELECT u.id AS userId,u.username,u.enabled,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.project_id=? ORDER BY u.username`)
    .all(project).map(row => ({ ...row, enabled: !!row.enabled, permissions: permissions(project, row.userId), capabilities: effective(row.role, permissions(project, row.userId)) }));
  const memberInput = (input, actor, project) => {
    if (!Array.isArray(input) || input.length < 1 || input.length > 200) fail(400, '请选择 1–200 位项目成员');
    const seen = new Set();
    const members = input.map(item => {
      if (!item || typeof item.userId !== 'string' || !['admin','editor','viewer'].includes(item.role) || seen.has(item.userId)) fail(400, '成员重复或权限无效');
      const user = db.prepare('SELECT enabled FROM users WHERE id=?').get(item.userId);
      const previous = project && db.prepare('SELECT role FROM members WHERE project_id=? AND user_id=?').get(project, item.userId);
      if (!user || (!user.enabled && !previous)) fail(400, '成员不存在或账号已停用，请先启用账号');
      seen.add(item.userId);
      // Older clients may edit roles but must not erase existing module restrictions.
      let overrides = item.permissions ?? (previous?.role === item.role ? permissions(project, item.userId) : inherit());
      if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides) || Object.keys(overrides).some(key => !['overview','stories','core'].includes(key)) ||
        ['overview','stories'].some(key => !['inherit','view','edit'].includes(overrides[key]))) fail(400, '模块权限配置无效');
      overrides = { ...overrides, core: overrides.core === undefined ? (previous?.role === item.role ? permissions(project,item.userId).core : 'inherit') : overrides.core };
      if (!['inherit','view','edit'].includes(overrides.core)) fail(400,'玩法核心权限配置无效');
      if (item.role === 'viewer' && Object.values(overrides).includes('edit')) fail(400, '只读成员不能获得编辑权限，请先调整成员角色');
      if (item.role === 'admin' && Object.values(overrides).includes('view')) fail(400, '项目管理员必须保留模块管理权限');
      return { userId: item.userId, role: item.role, permissions: item.role === 'editor' ? { ...overrides } : inherit() };
    });
    if (!members.some(item => item.userId === actor && item.role === 'admin')) fail(400, '当前管理账号必须保留项目管理员权限');
    return members.sort((a,b) => a.userId.localeCompare(b.userId));
  };
  const writeMembers = (project, members) => {
    db.prepare('DELETE FROM member_permissions WHERE project_id=?').run(project);
    db.prepare('DELETE FROM members WHERE project_id=?').run(project);
    for (const member of members) {
      db.prepare('INSERT INTO members VALUES (?,?,?)').run(project, member.userId, member.role);
      db.prepare('INSERT INTO member_permissions (project_id,user_id,overview,stories,core) VALUES (?,?,?,?,?)').run(project, member.userId, member.permissions.overview, member.permissions.stories, member.permissions.core);
    }
  };
  const account = id => {
    const row = db.prepare('SELECT id,username,server_role AS serverRole,enabled,revision FROM users WHERE id=?').get(id);
    if (!row) fail(404, '账号不存在');
    return { ...row, enabled: !!row.enabled };
  };
  const credential = value => {
    if (typeof value !== 'string' || value.length < 8 || value.length > 256 || !value.trim()) fail(400, '密码须为 8–256 个字符');
    const salt = randomBytes(16).toString('hex');
    return { salt, hash: scryptSync(value, salt, 64).toString('hex') };
  };
  const roleInput = role => { if (!['admin','member'].includes(role)) fail(400, '服务器角色无效'); return role; };
  const createAccount = (actor, input) => {
    const username = textField(input.username, '账号', 40, true).toLowerCase();
    if (!/^[a-z0-9][a-z0-9_.-]{2,39}$/.test(username)) fail(400, '账号须为 3–40 位英文字母、数字、点、下划线或短横线');
    if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) fail(409, '账号已存在，请刷新列表查看，未覆盖原账号');
    const role = roleInput(input.serverRole), { salt, hash } = credential(input.password), id = randomUUID();
    db.prepare('INSERT INTO users (id,username,salt,hash,server_role) VALUES (?,?,?,?,?)').run(id, username, salt, hash, role);
    audit(actor, '创建账号', username, { serverRole: role }); return account(id);
  };
  const requireRevision = (id, revision) => {
    if (!Number.isSafeInteger(revision) || revision < 1) fail(400, '必须提供有效的账号版本');
    const current = account(id); if (current.revision !== revision) fail(409, '账号已被其他管理员修改，请重新读取后操作'); return current;
  };
  const updateAccount = (actor, id, input) => {
    const current = requireRevision(id, input.revision), role = roleInput(input.serverRole);
    if (typeof input.enabled !== 'boolean') fail(400, '账号状态无效');
    if ((!input.enabled || role !== 'admin') && current.enabled && current.serverRole === 'admin' && !db.prepare("SELECT 1 FROM users WHERE id<>? AND enabled=1 AND server_role='admin'").get(id)) fail(400, '至少保留一位启用的服务器管理员');
    if (!input.enabled && current.enabled) {
      const orphaned = db.prepare(`SELECT p.name FROM projects p JOIN members m ON m.project_id=p.id WHERE m.user_id=? AND m.role='admin'
        AND NOT EXISTS (SELECT 1 FROM members other JOIN users u ON u.id=other.user_id WHERE other.project_id=p.id AND other.user_id<>? AND other.role='admin' AND u.enabled=1) LIMIT 1`).get(id,id);
      if (orphaned) fail(400, `请先为「${orphaned.name}」指定另一位启用的项目管理员，再停用此账号`);
    }
    db.prepare('UPDATE users SET enabled=?,server_role=?,revision=revision+1,auth_revision=auth_revision+? WHERE id=?')
      .run(input.enabled ? 1 : 0, role, input.enabled !== current.enabled ? 1 : 0, id);
    audit(actor, '修改账号权限', current.username, { before: { enabled: current.enabled, serverRole: current.serverRole }, after: { enabled: input.enabled, serverRole: role } });
    return account(id);
  };
  const resetPassword = (actor, id, input) => {
    const current = requireRevision(id, input.revision), { salt, hash } = credential(input.password);
    db.prepare('UPDATE users SET salt=?,hash=?,revision=revision+1,auth_revision=auth_revision+1 WHERE id=?').run(salt,hash,id);
    audit(actor, '重置密码', current.username); return account(id);
  };
  return { activeUser, membership, requireServerAdmin, memberRows, memberInput, writeMembers, audit, account, createAccount, updateAccount, resetPassword,
    accounts: () => db.prepare('SELECT id FROM users ORDER BY username').all().map(row => account(row.id)),
    auditRows: () => db.prepare(`SELECT a.id,u.username AS actor,a.action,a.target,a.details,a.created_at AS createdAt FROM access_audit a JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 50`).all().map(row => ({ ...row, details: JSON.parse(row.details) })),
  };
}
module.exports = { createAccessStore };
