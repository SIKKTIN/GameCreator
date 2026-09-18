const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { atomicWrite, createStorage } = require('./storage.cjs');

const scenarios = ['first', 'unchanged', 'added', 'removed', 'modified', 'mixed', 'referenced', 'error'];
const identity = value => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
function createWorkspaceStorage(dataDirectory) {
  const normal = createStorage(path.join(dataDirectory, 'storage'));
  const testRoot = path.join(dataDirectory, 'test-workspaces');
  const prefix = identity(testRoot) + '/';
  const route = key => {
    for (const namespace of ['gamecreator.enum-versions.v1:', 'gamecreator.workspace.v1:']) {
      if (typeof key !== 'string' || !key.startsWith(namespace)) continue;
      const target = key.slice(namespace.length);
      if (!target.startsWith(prefix)) continue;
      const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/project(?::[a-z-]+)?$/.exec(target.slice(prefix.length));
      if (!match) throw new Error('测试存档路径无效');
      return createStorage(path.join(testRoot, match[1], 'storage'));
    }
    return normal;
  };
  return { directory: normal.directory, getItem: key => route(key).getItem(key),
    setItem: (key, value) => route(key).setItem(key, value), info: key => route(key).info(key) };
}
async function prepareTestWorkspace(root, dataDirectory, scenario) {
  if (!scenarios.includes(scenario)) throw new Error('未知测试场景');
  const id = randomUUID();
  const projectPath = path.join(dataDirectory, 'test-workspaces', id, 'project');
  const source = path.join(projectPath, 'Script', 'Const', 'Const_Panel.lua');
  const { scanConstDirectory } = await import(pathToFileURL(path.join(root, 'server', 'lua-enum-parser.mjs')).href);
  const lua = members => ['local Const_Panel = {}', 'Const_Panel.Mode = {',
    ...members.map(([key, value]) => '  ' + key + ' = ' + value + ','), '}', 'return Const_Panel'].join('\n');
  const baselineMembers = [['A', 1], ['B', 2]];
  atomicWrite(source, lua(baselineMembers));
  const baseline = await scanConstDirectory(projectPath, 'Script/Const');
  const members = scenario === 'added' ? [...baselineMembers, ['C', 3]]
    : scenario === 'removed' || scenario === 'referenced' ? [['A', 1]]
    : scenario === 'modified' ? [['A', 11], ['B', 2]]
    : scenario === 'mixed' ? [['A', 11], ['C', 3]] : baselineMembers;
  atomicWrite(source, lua(members));
  const incoming = scenario === 'error' ? null : await scanConstDirectory(projectPath, 'Script/Const');
  const config = { engine: 'oasis-lua', projectPath, enumPath: scenario === 'error' ? 'Missing' : 'Script/Const',
    dataPath: 'Script/Config', outputFormat: 'lua', autoSync: false, backupBeforeSync: true };
  return { id, scenario, config, baseline: scenario === 'first' ? null : baseline, incoming };
}
module.exports = { createWorkspaceStorage, prepareTestWorkspace, scenarios };
