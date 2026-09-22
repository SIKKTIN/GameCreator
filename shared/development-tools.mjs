export const developmentToolKinds = ['资源制作', '关卡编辑', '数据配置', '调试验证', '构建发布', '其他'];
export const developmentToolStatuses = ['待开发', '开发中', '待验收', '可使用', '停用'];
export const developmentToolPriorities = ['低', '普通', '高', '紧急'];
export const emptyDevelopmentTools = () => ({ schema: 1, tools: [] });
export function createDevelopmentTool(name) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('请填写工具名称');
  return { id: crypto.randomUUID(), name: name.trim(), kind: '调试验证', status: '待开发', priority: '普通', owner: '', audience: '', purpose: '', scope: '', inputs: '', outputs: '', environment: '', acceptance: '', usage: '', delivery: '', capabilityIds: [], archived: false };
}
export function validateDevelopmentTools(value) {
  const record = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const fail = () => { throw new Error('开发工具存档格式异常，已停止写入'); };
  if (!record(value) || value.schema !== 1 || !Array.isArray(value.tools) || value.tools.length > 2000) return fail();
  const ids = new Set();
  for (const t of value.tools) {
    if (!record(t) || typeof t.id !== 'string' || !t.id.trim() || t.id.length > 200 || ids.has(t.id) ||
      !['name', 'owner', 'audience', 'purpose', 'scope', 'inputs', 'outputs', 'environment', 'acceptance', 'usage', 'delivery'].every(k => typeof t[k] === 'string' && t[k].length <= (k === 'name' ? 200 : 30000)) ||
      !developmentToolKinds.includes(t.kind) || !developmentToolStatuses.includes(t.status) || !developmentToolPriorities.includes(t.priority) || typeof t.archived !== 'boolean' ||
      !Array.isArray(t.capabilityIds) || t.capabilityIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 200) || new Set(t.capabilityIds).size !== t.capabilityIds.length) return fail();
    ids.add(t.id);
  }
  return value;
}
export function developmentToolsMarkdown(store) {
  const lines = ['## 开发工具', '', '> 面向制作人员的工具需求与交付记录。工具可用状态和制作任务完成状态分别维护。', ''];
  for (const t of store.tools) {
    lines.push('### ' + (t.name || '未命名工具'), '- ID：' + t.id, '- 分类：' + t.kind + '；状态：' + t.status + '；优先级：' + t.priority + '；归档：' + (t.archived ? '是' : '否'), '- 负责人：' + (t.owner || '未分配'), '- 使用人员：' + (t.audience || '待填写'));
    for (const [key, label] of [['purpose', '用途'], ['scope', '功能范围'], ['environment', '运行环境与兼容性'], ['inputs', '输入'], ['outputs', '输出'], ['acceptance', '验收标准'], ['usage', '使用说明'], ['delivery', '交付位置与版本']]) lines.push('#### ' + label, t[key] || '待补充', '');
    lines.push('- 关联程序功能：' + (t.capabilityIds.join('、') || '无'), '');
  }
  return lines.join('\n');
}
