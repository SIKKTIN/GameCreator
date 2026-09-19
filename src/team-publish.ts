import { readLocalCore } from './team-core-publish.ts';
import type { CorePublication } from './team-core-model.ts';
import limits from '../shared/publication-limits.json' with { type: 'json' };
import { readLocalStories } from './story-import.ts';
import type { SavedProject } from './project-catalog.ts';
import type { TeamRole, TeamStoryFields } from './team-api.ts';
import { readLocalOverview, normalizeInfo, type OverviewPublication } from './overview-model.ts';

type StorageReader = Pick<Storage, 'getItem'>;
export type PublicationStory = TeamStoryFields & { id: string };
export type PublicationPreview = { sourceProjectId: string; name: string; stories: PublicationStory[]; overview: OverviewPublication; core: CorePublication; signature: string };
export type PublicationSource = { sourceInstanceId: string; sourceProjectId: string };
export { limits as publicationLimits };

function text(value: unknown, label: string, maximum: number, required = false): string {
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) throw new Error(`${label}无效或过长，请在本地修正后重新读取预览。`);
  return required ? value.trim() : value;
}
function list(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 200 || value.some(item => typeof item !== 'string' || item.length > 2000)) throw new Error(`${label}最多包含 200 项，每项不超过 2000 字。`);
  return [...value];
}
export function readPublicationPreview(storage: StorageReader, project: SavedProject): PublicationPreview {
  const raw = storage.getItem(`gamecreator.workspace.v1:${project.id}:project`);
  const metadata = raw === null ? null : JSON.parse(raw);
  if (raw !== null && (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || typeof metadata.name !== 'string')) throw new Error('本地项目名称存档异常，请修复后重新读取预览。');
  const name = text(metadata?.name ?? project.name, '项目名称', 1000, true);
  const local = readLocalStories(storage, project);
  if (local.length > limits.maxStories) throw new Error(`单次发布最多 ${limits.maxStories} 篇故事文档，当前有 ${local.length} 篇。没有发布任何内容。`);
  const ids = new Set<string>();
  const stories = local.map(story => {
    const id = text(story.id, '文档标识', 1000, true);
    if (ids.has(id)) throw new Error('本地文档标识重复，请修复后重新读取预览。'); ids.add(id);
    return { id, title: text(story.title, '文档标题', 160, true), category: text(story.category, '文档分类', 80, true),
      status: text(story.status, '文档状态', 80, true), summary: text(story.summary, '文档摘要', 2000), content: text(story.content, '文档正文', 100000),
      tags: list(story.tags, '标签'), outlines: list(story.outlines, '大纲'), relations: {
        characters: list(story.relations.characters, '关联角色'), locations: list(story.relations.locations, '关联地点'), systems: list(story.relations.systems, '关联系统'),
      } };
  });
  const localOverview = readLocalOverview(storage,project);
  const overview = {info:localOverview.info,milestones:localOverview.milestones};
  const core = readLocalCore(storage,project.id).core;
  const signature = JSON.stringify({ name, stories, overview, core });
  checkPublicationSize(signature);
  return { sourceProjectId: project.id, name, stories, overview, core, signature };
}
export function assertPublicationCurrent(storage: StorageReader, project: SavedProject, preview: PublicationPreview) {
  if (project.id !== preview.sourceProjectId || readPublicationPreview(storage, project).signature !== preview.signature) {
    throw new Error('本地项目已变化，请重新读取预览后再发布。');
  }
}
export function checkPublicationSize(serialized: string) {
  if (new TextEncoder().encode(serialized).byteLength > limits.maxBytes) throw new Error('发布内容超过 10 MiB，未发布任何内容。请缩减文档内容后重新读取预览。');
}
export function publicationBody(preview: PublicationPreview, source: PublicationSource, name: string, members: { userId: string; role: TeamRole }[]) {
  if (preview.sourceProjectId !== source.sourceProjectId) throw new Error('发布来源已变化，请重新打开发布窗口。');
  const publishedName = text(name, '协作项目名称', 100, true);
  const body = { ...source, name: publishedName, members, stories: preview.stories, core: preview.core, overview: {...preview.overview,info:normalizeInfo({...preview.overview.info,name:publishedName})} };
  checkPublicationSize(JSON.stringify(body)); return body;
}
