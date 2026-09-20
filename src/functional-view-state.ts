import { workspaceStorage } from './workspace-storage.ts';

type ViewStorage = Pick<Storage, 'getItem' | 'setItem'>;
type FunctionalView = { schema: 1; collapsedIds: string[] };
export const functionalViewKey = (workspaceId: string) => 'gamecreator.workspace.v1:' + workspaceId + ':functional-view';
function load(workspaceId: string, storage: ViewStorage): FunctionalView {
  const raw = storage.getItem(functionalViewKey(workspaceId));
  if (raw === null) return { schema: 1, collapsedIds: [] };
  const value = JSON.parse(raw);
  if (value?.schema !== 1 || !Array.isArray(value.collapsedIds) || !value.collapsedIds.every((id: unknown) => typeof id === 'string' && id.length > 0)) throw new Error('Invalid functional view preferences');
  return { schema: 1, collapsedIds: [...new Set<string>(value.collapsedIds)] };
}
export function readFunctionalView(workspaceId: string, storage: ViewStorage = workspaceStorage): FunctionalView {
  try { return load(workspaceId, storage); }
  catch { return { schema: 1, collapsedIds: [] }; }
}
// Only presentation preferences are written; project content and export archives are separate.
export function patchFunctionalExpansion(workspaceId: string, ids: string[], expanded: boolean, storage: ViewStorage = workspaceStorage): boolean {
  try {
    const current = load(workspaceId, storage), collapsed = new Set(current.collapsedIds);
    for (const id of ids) { if (expanded) collapsed.delete(id); else collapsed.add(id); }
    storage.setItem(functionalViewKey(workspaceId), JSON.stringify({ schema: 1, collapsedIds: [...collapsed] }));
    return true;
  } catch { return false; }
}
