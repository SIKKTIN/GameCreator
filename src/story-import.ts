import {validateStoryExtras} from './story-library.ts';
import { initialStoryDocs, type StoryDoc } from './story-model.ts';
import type { SavedProject } from './project-catalog.ts';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export function readLocalStories(storage: Pick<StorageLike, 'getItem'>, project: SavedProject): StoryDoc[] {
  const raw = storage.getItem(`gamecreator.workspace.v1:${project.id}:stories`);
  const stories = raw === null ? (project.initialContent === 'legacy' ? initialStoryDocs : []) : JSON.parse(raw);
  const ids = new Set<string>();
  const list = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string');
  if (!Array.isArray(stories) || stories.some(story => {
    if (!story || ['id','title','category','status','updated','summary','content'].some(key => typeof story[key] !== 'string') || !story.id || ids.has(story.id) ||
      !list(story.tags) || !list(story.outlines) || !story.relations || !['characters','locations','systems'].every(key => list(story.relations[key]))) return true;
    validateStoryExtras(story); ids.add(story.id); return false;
  })) throw new Error('本地故事存档格式异常，已停止导入，原存档保持不变。');
  return structuredClone(stories);
}
export function localSourceIdentity(storage: StorageLike) {
  const key = 'gamecreator.local-source.v1', raw = storage.getItem(key);
  if (raw !== null) {
    const id = JSON.parse(raw);
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('本机来源标识无效，已停止导入。');
    return id;
  }
  const id = crypto.randomUUID(); storage.setItem(key, JSON.stringify(id)); return id;
}
