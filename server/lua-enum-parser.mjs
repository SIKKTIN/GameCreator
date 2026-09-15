import fs from 'node:fs/promises';
import path from 'node:path';

const isIdentifier = (value) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);

function stripComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '-' && line[index + 1] === '-') return line.slice(0, index);
  }
  return line;
}

function findTableEnd(source, start) {
  let depth = 0;
  let quote = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return index;
  }
  return -1;
}

function decodeValue(raw) {
  const value = raw.trim().replace(/,$/, '');
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) return Number(value);
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).replace(/\\([\\"'nrt])/g, (_, code) => ({ n: '\n', r: '\r', t: '\t' }[code] ?? code));
  }
  return undefined;
}

function sourceComment(lines, lineNumber) {
  const comments = [];
  for (let index = lineNumber - 2; index >= 0; index -= 1) {
    const trimmed = lines[index].trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('---')) comments.unshift(trimmed.slice(3).trim());
    else if (trimmed.startsWith('--')) comments.unshift(trimmed.slice(2).trim());
    else break;
  }
  return comments.join(' ');
}

function parseFile(source, relativePath) {
  const lines = source.split(/\r?\n/);
  const groups = [];
  const assignment = /([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{/g;
  let match;
  while ((match = assignment.exec(source))) {
    const end = findTableEnd(source, assignment.lastIndex - 1);
    if (end < 0) continue;
    const body = source.slice(assignment.lastIndex, end);
    const startLine = source.slice(0, match.index).split(/\r?\n/).length;
    const members = [];
    const entryPattern = /(?:^|[,\n])\s*(?:\[\s*["']([^"']+)["']\s*\]|([A-Za-z_][A-Za-z0-9_]*))\s*=\s*([^,\n}]+)/g;
    let entry;
    while ((entry = entryPattern.exec(body))) {
      const key = entry[1] ?? entry[2];
      const value = decodeValue(entry[3]);
      if (isIdentifier(key) && value !== undefined) {
        const memberLine = startLine + body.slice(0, entry.index).split(/\r?\n/).length;
        members.push({ key, value, line: memberLine, comment: sourceComment(lines, memberLine) });
      }
    }
    const moduleName = match[1];
    const name = `${moduleName}.${match[2]}`;
    if (members.length && !body.includes('{')) {
      groups.push({ name, source: relativePath, line: startLine, valueType: typeof members[0].value, members, kind: 'enum', comment: sourceComment(lines, startLine) });
    } else if (/\.[A-Za-z_][A-Za-z0-9_]*\s*=\s*\{\s*\}/.test(source.slice(match.index, end + 1))) {
      const dynamicAssignments = [...source.slice(end + 1).matchAll(new RegExp(`${moduleName}\\.${match[2]}\\[([^\\]]+)\\]\\s*=\\s*([^\\n]+)`, 'g'))];
      groups.push({ name, source: relativePath, line: startLine, valueType: 'dynamic', members: [], kind: 'dynamic', comment: sourceComment(lines, startLine), detail: dynamicAssignments.length ? '由后续赋值动态生成，未执行 Lua 代码。' : '空表，未发现静态成员。' });
    }
  }
  return groups;
}

async function filesUnder(root) {
  const result = [];
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lua')) result.push(full);
    }
  }
  await walk(root);
  return result;
}

export async function scanConstDirectory(projectPath, enumPath) {
  const project = path.resolve(projectPath);
  const directory = path.resolve(project, enumPath);
  const relative = path.relative(project, directory);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('枚举目录必须位于项目目录内');
  const stat = await fs.stat(directory);
  if (!stat.isDirectory()) throw new Error('枚举路径不是目录');
  const files = await filesUnder(directory);
  const groups = [];
  for (const file of files.sort()) {
    const source = await fs.readFile(file, 'utf8');
    groups.push(...parseFile(source, path.relative(project, file).replaceAll('\\', '/')));
  }
  const orderTables = [];
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    const matches = [...source.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*_ORDER)\s*=\s*\{([\s\S]*?)\}/g)];
    for (const match of matches) {
      const keys = [...match[3].matchAll(/['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g)].map((item) => item[1]);
      orderTables.push({ name: `${match[1]}.${match[2]}`, source: path.relative(project, file).replaceAll('\\', '/'), keys, detail: '排序列表，不新增枚举。' });
    }
  }
  const dynamic = groups.filter((group) => group.kind === 'dynamic');
  return { projectPath: project, enumPath: path.relative(project, directory).replaceAll('\\', '/'), files: files.map((file) => path.relative(project, file).replaceAll('\\', '/')), groups: groups.filter((group) => group.kind === 'enum'), orderTables, dynamic, counts: { files: files.length, groups: groups.filter((group) => group.kind === 'enum').length, members: groups.filter((group) => group.kind === 'enum').reduce((sum, group) => sum + group.members.length, 0) } };
}
