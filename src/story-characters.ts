import type { Narrative, StoryActor, StoryOrchestrationStore, StoryVariable } from './story-orchestration.ts';

export type StoryCharacter = {
  id: string; name: string; description: string; role: string; faction: string; background: string;
  motivation: string; personality: string; speech: string; color: string;
  portrait: { assetId: string; versionId: string; fileId: string } | null;
  position: { x: number; y: number };
};
export type StoryRelationship = { id: string; fromId: string; toId: string; label: string; description: string; secret: string; directed: boolean };
export const characterColors = ['#a78bfa', '#67c8ce', '#e6ad73', '#ed92b2', '#8fca93', '#8ca9e9'];
export function createStoryCharacter(name: string, index = 0): StoryCharacter {
  return { id: crypto.randomUUID(), name, description: '', role: '', faction: '', background: '', motivation: '', personality: '', speech: '', color: characterColors[index % characterColors.length], portrait: null, position: { x: 140 + index % 3 * 290, y: 100 + Math.floor(index / 3) * 170 } };
}
/** Old stories retain their local speaker IDs. Reading never writes or merges unrelated people by name. */
export function withCharacterLibrary(input: StoryOrchestrationStore): StoryOrchestrationStore {
  const store = structuredClone(input);
  store.characters ??= []; store.relationships ??= [];
  for (const story of store.stories) for (const actor of story.actors) {
    // Only the legacy adapter recognizes this old import convention. New speakers use explicit kinds.
    actor.kind ??= actor.id.startsWith('voice:') ? 'voice' : 'character';
    if (actor.kind === 'voice') { actor.voiceType ??= '内心声音'; continue; }
    if (actor.characterId) continue;
    const character = createStoryCharacter(actor.name, store.characters.length);
    character.id = `character:${story.id}:${actor.id}`;
    character.description = actor.description;
    if (store.characters.some(c => c.id === character.id)) throw new Error('旧人物迁移标识冲突，请检查人物库');
    store.characters.push(character); actor.characterId = character.id;
  }
  return store;
}
export function resolveStoryActors(store: StoryOrchestrationStore, story: Narrative): Narrative {
  return { ...story, actors: story.actors.map(a => {
    const character = store.characters?.find(c => c.id === a.characterId);
    return character ? { ...a, name: character.name, description: character.description } : a;
  }) };
}
export function addCharacterToStory(store: StoryOrchestrationStore, storyId: string, characterId: string): StoryOrchestrationStore {
  const character = store.characters?.find(c => c.id === characterId);
  if (!character) throw new Error('人物已失效');
  return { ...store, stories: store.stories.map(s => s.id !== storyId || s.actors.some(a => a.characterId === characterId) ? s : { ...s, actors: [...s.actors, { id: crypto.randomUUID(), characterId, kind: 'character', name: character.name, description: character.description } as StoryActor] }) };
}
export function removeStoryCharacter(store: StoryOrchestrationStore, id: string): StoryOrchestrationStore {
  if (store.stories.some(s => s.actors.some(a => a.characterId === id) || s.variables.some(v => v.characterId === id)) || store.relationships?.some(r => r.fromId === id || r.toId === id)) throw new Error('人物仍有关联故事、状态或关系，请先解除引用');
  return { ...store, characters: store.characters?.filter(c => c.id !== id) };
}
// A 0–1 numeric range may represent probability or progress; only explicit flags are boolean.
export const isStoryFlag = (v: StoryVariable) => v.kind === 'flag';
export const storyValueText = (v: StoryVariable, value: number) => isStoryFlag(v) && (value === 0 || value === 1) ? (value ? v.trueLabel || '是' : v.falseLabel || '否') : String(value);
export function storyCharacterIssues(store: StoryOrchestrationStore): string[] {
  const ids = new Set(store.characters?.map(c=>c.id)), issues: string[] = [];
  for (const story of store.stories) {
    for (const a of story.actors) if (a.characterId && !ids.has(a.characterId)) issues.push(`${story.title}：人物引用已失效（${a.name}）`);
    for (const v of story.variables) if (v.characterId && !ids.has(v.characterId)) issues.push(`${story.title}：状态关联人物已失效（${v.name}）`);
  }
  for (const r of store.relationships || []) if (!ids.has(r.fromId) || !ids.has(r.toId) || r.fromId === r.toId) issues.push(`关系端点待修复：${r.label}`);
  return issues;
}
