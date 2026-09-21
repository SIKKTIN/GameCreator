// Shared by the renderer and desktop writer. Only plain Markdown files are accepted.
export function validName(value, label = '名称') {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 120 ||
      /[<>:"/\\|?*\x00-\x1f\x7f]/.test(value) || /[. ]$/.test(value) ||
      /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(value)) {
    throw new Error(`${label}无效：请使用 1–120 个字符，避开路径分隔符、特殊字符和系统保留名称。`);
  }
  return value;
}
export function markdownName(value) {
  const name = validName(value, '文档文件名');
  return validName(/\.md$/i.test(name) ? name : name + '.md', '文档文件名');
}
export function defaultFolderName(projectName, date = new Date()) {
  const name = String(projectName).replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '-').trim().replace(/[. ]+$/, '').slice(0, 65) || '项目';
  const stamp = [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-') + '-' +
    [date.getHours(),date.getMinutes(),date.getSeconds()].map(n=>String(n).padStart(2,'0')).join('');
  return `${name}-AI文档-${stamp}`;
}
export function validateDocumentFiles(input) {
  const folderName = validName(input?.folderName, '输出文件夹名称');
  if (!Array.isArray(input?.files) || input.files.length < 2 || input.files.length > 64) throw new Error('文档清单应包含总文档和模块文档');
  const seen = new Set(); let bytes = 0, summaries = 0;
  const encoder = new TextEncoder();
  const files = input.files.map(file => {
    if (typeof file?.path !== 'string' || typeof file?.content !== 'string') throw new Error('文档清单格式无效');
    const parts = file.path.split('/');
    if (parts.length !== 1 && !(parts.length === 2 && parts[0] === '模块')) throw new Error('文档路径必须位于导出文件夹内');
    const name = parts.at(-1); validName(name, '文档文件名');
    if (!/\.md$/i.test(name) || parts.length === 1 && name.toLowerCase() === '模块') throw new Error('只支持 Markdown 文档');
    const key = file.path.normalize('NFC').toLowerCase();
    if (seen.has(key)) throw new Error(`文档文件名重复：${file.path}`);
    seen.add(key); if (parts.length === 1) summaries++;
    bytes += encoder.encode(file.content).length;
    if (bytes > 128 * 1024 * 1024) throw new Error('文档总大小超过 128 MB，请减少单次导出的内容');
    return {path:file.path,content:file.content};
  });
  if (summaries !== 1) throw new Error('文档清单必须包含一份总文档');
  return {folderName, files};
}
