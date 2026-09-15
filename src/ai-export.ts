import type { EngineConfig } from './engine';
import type { EnumRegistry } from './useEnumRegistry';
import type { DatasetDef, ProjectData } from './data-model';

type ExportProject = { name: string; genre: string; platform: string; version: string; status: string; description: string };
type ExportStory = { title: string; category: string; status: string; summary: string; content: string; tags: string[]; outlines: string[]; relations: { characters: string[]; locations: string[]; systems: string[] } };
const bullets = (items: string[]) => items.length ? items.map((item) => `- ${item}`).join('\n') : '- 无';
const table = (headers: string[], rows: string[][]) => [
  `| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.map((cell) => String(cell).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`),
].join('\n');

export function buildAiMarkdown(project: ExportProject, stories: ExportStory[], data: ProjectData, definitions: DatasetDef[], config: EngineConfig, registry: EnumRegistry) {
  const lines = [`# ${project.name}：AI 项目上下文`, '', `> 生成时间：${new Date().toISOString()}`, '> 本文件由 GameCreator 本地客户端生成，供 AI 检索和协作使用。', '', '## 项目概览', '', `- 类型：${project.genre}`, `- 平台：${project.platform}`, `- 版本：${project.version}`, `- 状态：${project.status}`, '', project.description, '', '## 引擎配置', '', table(['配置项', '值'], [['引擎', config.engine], ['工程目录', config.projectPath], ['枚举目录', config.enumPath], ['数据目录', config.dataPath], ['输出格式', config.outputFormat], ['自动同步', String(config.autoSync)]]), '', '## 稳定枚举版本', ''];
  if (registry.scan) lines.push(`- 来源：${registry.scan.projectPath}/${registry.scan.enumPath}`, `- 文件：${registry.scan.counts.files}`, `- 枚举组：${registry.scan.counts.groups}`, `- 成员：${registry.scan.counts.members}`, `- 稳定版本：${registry.active?.id ?? '未建立'}`, '');
  for (const group of registry.scan?.groups ?? []) { lines.push(`### ${group.name}`, '', group.comment ? `> ${group.comment}` : '', table(['键', '值', '来源', '注释'], group.members.map((member) => [member.key, String(member.value), `${group.source}:${member.line}`, member.comment || ''])), ''); }
  if (registry.scan?.dynamic.length) lines.push('### 动态 ID 提示', '', bullets(registry.scan.dynamic.map((item) => `${item.name}（${item.source}:${item.line}）：${item.detail}`)), '');
  lines.push('## 故事文档', '');
  for (const story of stories) lines.push(`### ${story.title}`, '', `- 分类：${story.category}`, `- 状态：${story.status}`, '', story.summary, '', story.content, '', `标签：${story.tags.join('、')}`, '', `大纲：${story.outlines.join('、')}`, '');
  lines.push('## 数据配置', '');
  for (const definition of definitions) { const rows = (data.datasets[definition.key] ?? []).map((record) => definition.columns.map((column) => String(record[column.key] ?? ''))); lines.push(`### ${definition.label}`, '', table(definition.columns.map((column) => column.label), rows), ''); }
  return lines.join('\n').trim() + '\n';
}

export async function saveAiMarkdown(markdown: string) {
  const filename = `gamecreator-context-${new Date().toISOString().slice(0, 10)}.md`;
  if (window.desktopClient?.writeMarkdown) return window.desktopClient.writeMarkdown(filename, markdown);
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); URL.revokeObjectURL(link.href);
  return `下载文件：${filename}`;
}
