import { useEffect, useRef, useState } from 'react';
import { workspaceStorage } from './workspace-storage';
import { emptyGameplay, readGameplay, validateGameplay, writeGameplay, type GameplayStore } from './gameplay';

// Mounted once per workspace ID by WorkspaceApp. Keep failed edits in memory so
// users can retry, and prevent navigation that would discard those edits.
export function useGameplayDesigns(workspaceId: string) {
  const key = 'gamecreator.workspace.v1:' + workspaceId + ':gameplay';
  const [initial] = useState(() => {
    try { return { ...readGameplay(workspaceStorage, key), error: '' }; }
    catch (error) { return { raw: null, store: emptyGameplay(), error: String(error) }; }
  });
  const [store, setStore] = useState(initial.store);
  const [saveError, setSaveError] = useState('');
  const latest = useRef(store);
  const committed = useRef(initial.raw);
  const persist = (next: GameplayStore) => {
    try {
      if (initial.error) throw new Error(initial.error);
      committed.current = writeGameplay(workspaceStorage, key, committed.current, next);
      setSaveError(''); return true;
    } catch (error) { setSaveError('玩法修改未保存：' + String(error)); return false; }
  };
  const update = (operation: (current: GameplayStore) => GameplayStore) => {
    if (initial.error) return false;
    const next = validateGameplay(operation(latest.current));
    latest.current = next; setStore(next);
    return persist(next);
  };
  const pending = !!saveError;
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending]);
  return { store, update, retry: () => persist(latest.current), blocked: !!initial.error, pending,
    error: initial.error ? '玩法存档读取失败，已停止写入：' + initial.error : saveError };
}
export type GameplayController = ReturnType<typeof useGameplayDesigns>;
