import { useEffect, useRef, useState } from 'react';
import { workspaceStorage } from './workspace-storage';
import { emptyProgramFramework, readProgramFramework, validateProgramFramework, writeProgramFramework, type ProgramFrameworkStore } from './program-framework';

// WorkspaceApp remounts by project ID. Failed writes retain the current draft.
export function useProgramFramework(workspaceId: string) {
  const key = 'gamecreator.workspace.v1:' + workspaceId + ':program-framework';
  const [initial] = useState(() => {
    try { return { ...readProgramFramework(workspaceStorage, key), error: '' }; }
    catch (error) { return { raw: null, store: emptyProgramFramework(), error: String(error) }; }
  });
  const [store, setStore] = useState(initial.store);
  const [loadError, setLoadError] = useState(initial.error);
  const [saveError, setSaveError] = useState(''), [operationError, setOperationError] = useState('');
  const latest = useRef(store), committed = useRef(initial.raw);
  const persist = (next: ProgramFrameworkStore) => {
    try {
      if (loadError) throw new Error(loadError);
      committed.current = writeProgramFramework(workspaceStorage, key, committed.current, next);
      setSaveError(''); setOperationError(''); return true;
    } catch (error) { setSaveError('程序框架修改未保存：' + String(error)); return false; }
  };
  const update = (operation: (current: ProgramFrameworkStore) => ProgramFrameworkStore) => {
    if (loadError) return false;
    let next: ProgramFrameworkStore;
    try { next = validateProgramFramework(operation(structuredClone(latest.current))); }
    catch (error) { setOperationError('程序框架更改未应用：' + String(error)); return false; }
    latest.current = next; setStore(next); setOperationError('');
    return persist(next);
  };
  // The caller offers a draft backup and confirms discarding local changes first.
  const reload = () => {
    try {
      const loaded = readProgramFramework(workspaceStorage, key);
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
    error: loadError ? '程序框架存档读取失败，已停止写入：' + loadError : [saveError, operationError].filter(Boolean).join('；') };
}
export type ProgramFrameworkController = ReturnType<typeof useProgramFramework>;
