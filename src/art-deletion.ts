import { readArtAssets, validateArtAssets, type ArtStore } from './art-assets.ts';
import { artLibrary, type ArtItemKind } from './art-library.ts';
import type { PrototypeDesignStore } from './prototype-design.ts';
import type { MapDesignStore } from './map-design.ts';
import type { TaskFlowStore } from './task-flow.ts';
import type { ProjectScheduleStore } from './project-schedule.ts';
import type { StoryDoc } from './story-model.ts';
import type { StoryOrchestrationStore } from './story-orchestration.ts';

export type ArtItemTarget = { kind: ArtItemKind; id: string };
export type ArtDeletionSources = {
  prototype: PrototypeDesignStore; maps: MapDesignStore; tasks: TaskFlowStore;
  schedule: ProjectScheduleStore; stories: StoryDoc[]; narrative: StoryOrchestrationStore;
};

/** Include archived content and disabled modules: their references must survive reopening. */
export function externalArtReferences(target: ArtItemTarget, sources: ArtDeletionSources): string[] {
  const matches = (r: { kind: string; targetId: string }) => r.kind === target.kind && r.targetId === target.id;
  return [
    ...sources.stories.filter(s => s.references?.some(matches)).map(s => '故事文档 / ' + s.title),
    ...sources.schedule.tasks.filter(t => t.references.some(matches)).map(t => '项目排期 / ' + t.title),
    ...(target.kind === 'asset' ? [
      ...sources.prototype.scenes.flatMap(s => s.elements.filter(e => e.assetId === target.id).map(e => '原型设计 / ' + s.name + ' / ' + e.name)),
      ...sources.maps.maps.flatMap(m => m.objects.filter(o => o.references.some(matches)).map(o => '地图设计 / ' + m.name + ' / ' + o.name)),
      ...sources.tasks.tasks.filter(t => t.references.some(matches)).map(t => '任务与流程 / ' + t.title),
      ...(sources.narrative.characters || []).filter(c => c.portrait?.assetId === target.id).map(c => '故事角色头像 / ' + c.name),
    ] : []),
  ];
}

export function artItemReferences(store: ArtStore, target: ArtItemTarget): string[] {
  return target.kind === 'asset' ? store.links.filter(l => l.assetId === target.id).map(l =>
    '素材需求 / ' + (store.requirements.find(r => r.id === l.requirementId)?.name || l.requirementId)) : [];
}

/** Explicit card deletion is separate from edits, which still preserve immutable version history. */
export function removeArtItem(store: ArtStore, target: ArtItemTarget, externalReferences: string[] = []): ArtStore {
  validateArtAssets(store);
  if (target.kind !== 'asset' && target.kind !== 'requirement') throw new Error('素材条目类型无效');
  const field = target.kind === 'asset' ? 'assets' : 'requirements';
  if (!store[field].some(i => i.id === target.id)) throw new Error('素材条目不存在，请重新打开项目');
  const references = [...artItemReferences(store, target), ...externalReferences];
  if (references.length) throw new Error('请先解除以下引用，再删除：\n' + references.join('\n'));
  const library = structuredClone(artLibrary(store));
  delete library[field][target.id];
  return validateArtAssets({
    ...store, library,
    [field]: store[field].filter(i => i.id !== target.id),
    links: target.kind === 'requirement' ? store.links.filter(l => l.requirementId !== target.id) : store.links,
  });
}

/** Build the deletion from the committed snapshot and publish it only after the write succeeds. */
export function writeArtItemDeletion(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, expected: string | null, target: ArtItemTarget, externalReferences: string[] = []) {
  const current = readArtAssets(storage, key);
  if (current.raw !== expected) throw new Error('素材存档已被其他窗口修改，请重新打开项目后再删除');
  const store = removeArtItem(current.store, target, externalReferences), raw = JSON.stringify(store);
  storage.setItem(key, raw);
  return { store, raw };
}
