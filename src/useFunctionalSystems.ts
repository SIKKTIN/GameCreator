import { useEffect, useRef, useState } from 'react';
import { workspaceStorage } from './workspace-storage';
import { emptyFunctionalSystems, readFunctionalSystems, validateFunctionalSystems, writeFunctionalSystems, type FunctionalStore } from './functional-systems';

// WorkspaceApp remounts this controller by project ID. Failed writes retain the draft.
export function useFunctionalSystems(workspaceId: string) {
  const key = 'gamecreator.workspace.v1:' + workspaceId + ':functional-systems';
  const [initial] = useState(() => {
    try { return { ...readFunctionalSystems(workspaceStorage, key), error: '' }; }
    catch (error) { return { raw: null, store: emptyFunctionalSystems(), error: String(error) }; }
  });
  const [store, setStore] = useState(initial.store);
  const [saveError, setSaveError] = useState('');
  const latest = useRef(store);
  const committed = useRef(initial.raw);
  const persist = (next: FunctionalStore) => {
    try {
      if (initial.error) throw new Error(initial.error);
      committed.current = writeFunctionalSystems(workspaceStorage, key, committed.current, next);
      setSaveError(''); return true;
    } catch (error) { setSaveError('功能系统修改未保存：' + String(error)); return false; }
  };
  const update = (operation: (current: FunctionalStore) => FunctionalStore) => {
    if (initial.error) return false;
    const next = validateFunctionalSystems(operation(latest.current));
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
    error: initial.error ? '功能系统存档读取失败，已停止写入：' + initial.error : saveError };
}
export type FunctionalController = ReturnType<typeof useFunctionalSystems>;
