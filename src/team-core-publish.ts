import { readGameplayCore } from './gameplay-core.ts';
import { readGameplay } from './gameplay.ts';
import { normalizeCorePublication } from './team-core-model.ts';

export function readLocalCore(storage: Pick<Storage,'getItem'>, projectId: string) {
  const prefix = `gamecreator.workspace.v1:${projectId}:`;
  const store = readGameplayCore(storage,prefix + 'gameplay-core').store;
  const hasReferences = store.graphs.some(g => g.nodes.some(n => n.gameplayIds.length));
  const references = hasReferences ? readGameplay(storage,prefix + 'gameplay').store.designs.map(d => ({id:d.id,title:d.title})) : [];
  const core = normalizeCorePublication({store,references});
  return { core, signature: JSON.stringify(core) };
}
