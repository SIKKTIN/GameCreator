const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const hook = path.resolve(__dirname, '../.githooks/pre-push');
function gitShell() {
  if (process.env.GAMECREATOR_GIT_SHELL) return process.env.GAMECREATOR_GIT_SHELL;
  if (process.platform !== 'win32') return 'sh';
  const executables = execFileSync('where.exe', ['git'], { encoding: 'utf8' }).trim().split(/\r?\n/);
  for (const executable of executables) {
    for (const relative of ['../bin/sh.exe', 'sh.exe']) {
      const candidate = path.resolve(path.dirname(executable), relative);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error('未找到 Git shell，请设置 GAMECREATOR_GIT_SHELL');
}
const shell = gitShell(), oid = '1'.repeat(40), zero = '0'.repeat(40);
const update = (name, source = name, remoteOid = zero) => `refs/heads/${source} ${oid} refs/heads/${name} ${remoteOid}\n`;
const deletion = name => `(delete) ${zero} refs/heads/${name} ${oid}\n`;
const run = input => {
  const result = spawnSync(shell, [hook, 'origin', 'https://example.invalid/repository.git'], { input, encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
};
test('remote branch whitelist permits only reserved destination branches, including explicit refspecs', () => {
  for (const name of ['master', 'release']) {
    assert.equal(run(update(name)).status, 0);
    assert.equal(run(update(name, name, oid)).status, 0);
  }
  assert.equal(run(update('master', 'codex/local-feature')).status, 0);
  for (const name of ['main', 'BranchTree', 'codex/feature', 'release-candidate', 'Master']) {
    assert.notEqual(run(update(name)).status, 0);
    assert.notEqual(run(update(name, name, oid)).status, 0);
  }
  assert.notEqual(run(update('main', 'release')).status, 0);
  const bulk = run(update('master') + update('codex/feature'));
  assert.notEqual(bulk.status, 0); assert.match(bulk.stderr, /Rejected destination/);
});
test('cleanup can delete retired main and feature refs but never master or release; tags remain unaffected', () => {
  assert.equal(run(deletion('main') + deletion('BranchTree') + deletion('codex/feature')).status, 0);
  assert.equal(run(update('release') + deletion('main')).status, 0);
  for (const name of ['master', 'release']) assert.notEqual(run(deletion(name)).status, 0);
  assert.equal(run(`refs/tags/v1 ${oid} refs/tags/v1 ${zero}\n`).status, 0);
  assert.equal(run(`(delete) ${zero} refs/tags/v1 ${oid}\n`).status, 0);
  assert.equal(run('').status, 0);
});
