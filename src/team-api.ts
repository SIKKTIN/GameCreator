import {storyExtras} from './story-library';
export type TeamRole = 'admin' | 'editor' | 'viewer';
export type ModulePermissions = { schedule: 'inherit' | 'view' | 'edit'; overview: 'inherit' | 'view' | 'edit'; stories: 'inherit' | 'view' | 'edit'; core: 'inherit' | 'view' | 'edit'; gameplay: 'inherit' | 'view' | 'edit' };
export type TeamCapabilities = { schedule: 'view' | 'edit'; overview: 'view' | 'edit'; stories: 'view' | 'edit'; core: 'view' | 'edit'; gameplay: 'view' | 'edit' };
export type TeamSession = { token: string; serverId: string; apiVersion?: number; invalid?: boolean; user: { id: string; username: string; serverRole?: 'admin' | 'member' }; url: string };
export type TeamMember = { userId: string; username: string; role: TeamRole; enabled?: boolean; permissions?: ModulePermissions; capabilities?: TeamCapabilities };
export type TeamProject = { id: string; name: string; role: TeamRole; capabilities?: TeamCapabilities };
export const defaultPermissions = (): ModulePermissions => ({ overview: 'inherit', stories: 'inherit', core: 'inherit', gameplay: 'inherit', schedule: 'inherit' });
export const effectivePermissions = (role: TeamRole, permissions = defaultPermissions()): TeamCapabilities => ({
  schedule: role === 'admin' || (role === 'editor' && permissions.schedule === 'edit') ? 'edit' : 'view',
  overview: role === 'admin' || (role === 'editor' && permissions.overview === 'edit') ? 'edit' : 'view',
  gameplay: role === 'admin' || (role === 'editor' && permissions.gameplay !== 'view') ? 'edit' : 'view',
  core: role === 'admin' || (role === 'editor' && permissions.core !== 'view') ? 'edit' : 'view',
  stories: role === 'admin' || (role === 'editor' && permissions.stories !== 'view') ? 'edit' : 'view',
});
export const canEditModule = (session: TeamSession, role: TeamRole, capabilities: TeamCapabilities | undefined, module: keyof TeamCapabilities) =>
  !session.invalid && ((session.apiVersion ?? 0) >= 6 ? capabilities?.[module] === 'edit' : effectivePermissions(role)[module] === 'edit');
export type DeletedPublication = { projectId: string; name: string; deletedAt: string };
export type TeamPublication = { project: TeamProject; publishedAt: string; storyCount: number; overviewInitialized?: boolean; coreInitialized?: boolean; gameplayInitialized?: boolean; scheduleInitialized?: boolean };
import type { StoryDoc } from './story-model';
export type TeamStoryFields = Omit<StoryDoc, 'id' | 'updated' | 'updatedAt'>;
export type TeamStory = TeamStoryFields & { id: string; projectId: string; revision: number; updatedAt: string; updatedBy: string };
export const roleLabels: Record<TeamRole, string> = { admin: '管理员', editor: '编辑者', viewer: '只读成员' };
export const storyFields = (story: TeamStory): TeamStoryFields => ({ title: story.title, category: story.category, summary: story.summary, content: story.content,
  status: story.status, tags: story.tags, outlines: story.outlines, relations: story.relations, ...storyExtras(story) });
export const sameFields = (a: TeamStoryFields, b: TeamStoryFields) => a.title === b.title && a.category === b.category && a.summary === b.summary && a.content === b.content &&
  a.status === b.status && JSON.stringify(a.tags) === JSON.stringify(b.tags) && JSON.stringify(a.outlines) === JSON.stringify(b.outlines) &&
  JSON.stringify(a.relations) === JSON.stringify(b.relations) && JSON.stringify(storyExtras(a)) === JSON.stringify(storyExtras(b));
export const teamStoryDocument = (story: TeamStory): StoryDoc => ({ ...storyFields(story), id: story.id, updatedAt:story.updatedAt, updated: `${story.updatedBy} · 版本 ${story.revision}` });
export const leaveTeamEvent = 'gamecreator:leave-team';
export const canLeaveTeam = () => window.dispatchEvent(new Event(leaveTeamEvent, { cancelable: true }));

export class TeamError extends Error {
  constructor(message: string, public status: number, public current?: TeamStory, public currentRecord?: unknown) { super(message); }
}
export function localTeamUrl(input: string) {
  const url = new URL(input);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('本机验证版请填写本地服务地址，例如 http://127.0.0.1:4747');
  }
  return url.origin;
}
export async function teamRequest<T>(url: string, route: string, token = '', method = 'GET', body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url + '/api/team' + route, { method, signal: controller.signal,
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new TeamError(data.error || '请求失败', response.status, data.current, data.currentRecord);
    return data as T;
  } catch (error) {
    if (error instanceof TeamError) throw error;
    throw new TeamError('无法连接协作服务，请确认服务正在运行。未提交的草稿保留在本机。', 0);
  } finally { window.clearTimeout(timeout); }
}
