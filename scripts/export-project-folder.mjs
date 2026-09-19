// Export one saved local project without changing its archives or catalog.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { captureProjectPackage } from '../src/project-package.ts';
import { PROJECT_CATALOG_KEY, validateCatalog } from '../src/project-catalog.ts';
const require = createRequire(import.meta.url);
const { createWorkspaceStorage } = require('../desktop/test-workspaces.cjs');
const { createProjectPackages } = require('../desktop/project-package.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), flags = {};
for (let index = 0; index < args.length; index += 2) {
  if (!['--project', '--output', '--data-dir'].includes(args[index]) || !args[index + 1] || flags[args[index]]) throw new Error('用法：node scripts/export-project-folder.mjs --project <完整项目名或 ID> --output <新项目文件夹> [--data-dir <本地存档目录>]');
  flags[args[index]] = args[index + 1];
}
if (!flags['--project'] || !flags['--output']) throw new Error('请指定 --project 和 --output；输出文件夹必须尚不存在。');
const dataDirectory = path.resolve(flags['--data-dir'] || path.join(root, '.gamecreator'));
const storage = createWorkspaceStorage(dataDirectory);
const catalog = validateCatalog(JSON.parse(storage.getItem(PROJECT_CATALOG_KEY)));
const candidates = catalog.projects.filter(project => project.id === flags['--project'] || project.name === flags['--project']);
if (candidates.length !== 1) throw new Error('项目名称不存在或重复，请指定准确的项目 ID。');
const project = candidates[0], snapshot = captureProjectPackage(storage, project);
const result = await createProjectPackages({ dataDirectory, storage }).exportFolder({ directory: path.resolve(flags['--output']), projectId: project.id, ...snapshot });
console.log(JSON.stringify({ project: project.name, ...result }, null, 2));
