const path = require('node:path');
const fs = require('node:fs/promises');

async function validateProjectLocation(projectPath, enumPath = 'Script/Const') {
  if (typeof projectPath !== 'string' || !projectPath.trim() || !path.isAbsolute(projectPath.trim())) throw new Error('请选择或输入完整的工程目录');
  if (typeof enumPath !== 'string' || !enumPath.trim() || path.isAbsolute(enumPath.trim()) || /^[A-Za-z]:/.test(enumPath.trim())) throw new Error('枚举目录必须是工程内的相对路径');
  const project = await fs.realpath(projectPath.trim()).catch(() => { throw new Error('工程目录不存在或无法访问'); });
  if (!(await fs.stat(project)).isDirectory()) throw new Error('项目目录必须是文件夹');
  const enumeration = path.resolve(project, enumPath.trim());
  const relative = path.relative(project, enumeration);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('枚举目录必须位于工程目录内');
  return { projectPath: project, enumPath: relative.replace(/\\/g, '/') || '.' };
}
module.exports = { validateProjectLocation };
