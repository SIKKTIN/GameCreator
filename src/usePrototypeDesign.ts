import { useEffect, useRef, useState } from 'react';
import { workspaceStorage } from './workspace-storage';
import { emptyPrototypeDesign, readPrototypeDesign, validatePrototypeDesign, writePrototypeDesign, type PrototypeDesignStore } from './prototype-design';

// WorkspaceApp remounts by project ID. Failed writes retain the current draft.
export function usePrototypeDesign(workspaceId: string) {
  const key = 'gamecreator.workspace.v1:' + workspaceId + ':prototype-design';
  const [initial] = useState(() => {
    try { return { ...readPrototypeDesign(workspaceStorage, key), error: '' }; }
    catch (error) { return { raw: null, store: emptyPrototypeDesign(), error: String(error) }; }
  });
  const [store, setStore] = useState(initial.store);
  const [loadError, setLoadError] = useState(initial.error);
  const [saveError, setSaveError] = useState(''), [operationError, setOperationError] = useState('');
  const latest = useRef(store), committed = useRef(initial.raw);
  const persist = (next: PrototypeDesignStore) => {
    try {
      if (loadError) throw new Error(loadError);
      committed.current = writePrototypeDesign(workspaceStorage, key, committed.current, next);
      setSaveError(''); setOperationError(''); return true;
    } catch (error) { setSaveError('原型设计修改未保存：' + String(error)); return false; }
  };
  const update = (operation: (current: PrototypeDesignStore) => PrototypeDesignStore) => {
    if (loadError) return false;
    let next: PrototypeDesignStore;
    try { next = validatePrototypeDesign(operation(structuredClone(latest.current))); }
    catch (error) { setOperationError('原型设计更改未应用：' + String(error)); return false; }
    latest.current = next; setStore(next); setOperationError('');
    return persist(next);
  };
  // The caller offers a draft backup and confirms discarding local changes first.
  const reload = () => {
    try {
      const loaded = readPrototypeDesign(workspaceStorage, key);
      latest.current = loaded.store; committed.current = loaded.raw; setStore(loaded.store);
      setLoadError(''); setSaveError(''); setOperationError(''); return true;
    } catch (error) { setLoadError(String(error)); return false; }
  };
  const pending = !!saveError;
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending]);
  return { store, update, retry: () => persist(latest.current), reload, blocked: !!loadError, pending,
    error: loadError ? '原型设计存档读取失败，已停止写入：' + loadError : [saveError, operationError].filter(Boolean).join('；') };
}
export type PrototypeDesignController = ReturnType<typeof usePrototypeDesign>;
