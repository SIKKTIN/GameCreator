const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

try {
  const configured = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8' });
  if (configured.error) throw configured.error;
  if (configured.status === 0) throw new Error('已配置 core.hooksPath，请先把分支检查整合到现有 hook；未修改任何配置。');
  if (configured.status !== 1) throw new Error(configured.stderr || '无法检查 Git hook 配置');
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
  const directory = path.join(common, 'hooks'), target = path.join(directory, 'pre-push');
  const source = fs.readFileSync(path.join(root, '.githooks', 'pre-push'), 'utf8').replace(/\r\n/g, '\n');
  if (fs.existsSync(target)) {
    if (fs.readFileSync(target, 'utf8') !== source) throw new Error('已有不同的 pre-push hook，请先整合检查；未覆盖现有文件。');
  } else {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(target, source, { flag: 'wx', mode: 0o755 });
  }
  console.log('分支推送检查已安装，供本仓库所有 worktree 共用：' + target);
} catch (error) {
  console.error(error.message); process.exitCode = 1;
}
