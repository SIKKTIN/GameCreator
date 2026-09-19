export type TeamRole = 'admin' | 'editor' | 'viewer';
export type TeamSession = { token: string; serverId: string; apiVersion?: number; user: { id: string; username: string; serverRole?: 'admin' | 'member' }; url: string };
export type TeamMember = { userId: string; username: string; role: TeamRole };
export type TeamProject = { id: string; name: string; role: TeamRole };
export type TeamPublication = { project: TeamProject; publishedAt: string; storyCount: number; overviewInitialized?: boolean };
import type { StoryDoc } from './story-model';
export type TeamStoryFields = Omit<StoryDoc, 'id' | 'updated'>;
export type TeamStory = TeamStoryFields & { id: string; projectId: string; revision: number; updatedAt: string; updatedBy: string };
export const roleLabels: Record<TeamRole, string> = { admin: '管理员', editor: '编辑者', viewer: '只读成员' };
export const storyFields = (story: TeamStory): TeamStoryFields => ({ title: story.title, category: story.category, summary: story.summary, content: story.content,
  status: story.status, tags: story.tags, outlines: story.outlines, relations: story.relations });
export const sameFields = (a: TeamStoryFields, b: TeamStoryFields) => a.title === b.title && a.category === b.category && a.summary === b.summary && a.content === b.content &&
  a.status === b.status && JSON.stringify(a.tags) === JSON.stringify(b.tags) && JSON.stringify(a.outlines) === JSON.stringify(b.outlines) &&
  JSON.stringify(a.relations) === JSON.stringify(b.relations);
export const teamStoryDocument = (story: TeamStory): StoryDoc => ({ ...storyFields(story), id: story.id, updated: `${story.updatedBy} · 版本 ${story.revision}` });
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
