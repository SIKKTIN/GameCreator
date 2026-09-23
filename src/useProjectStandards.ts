import { useEffect, useRef, useState } from 'react';
import { workspaceStorage } from './workspace-storage';
import { emptyProjectStandards, readProjectStandards, validateProjectStandards, writeProjectStandards, type ProjectStandardsStore } from './project-standards';

// WorkspaceApp remounts by project ID. Failed writes retain the current draft.
export function useProjectStandards(workspaceId: string) {
  const key = 'gamecreator.workspace.v1:' + workspaceId + ':project-standards';
  const [initial] = useState(() => {
    try { return { ...readProjectStandards(workspaceStorage, key), error: '' }; }
    catch (error) { return { raw: null, store: emptyProjectStandards(), error: String(error) }; }
  });
  const [store, setStore] = useState(initial.store);
  const [loadError, setLoadError] = useState(initial.error);
  const [saveError, setSaveError] = useState(''), [operationError, setOperationError] = useState('');
  const latest = useRef(store), committed = useRef(initial.raw);
  const persist = (next: ProjectStandardsStore) => {
    try {
      if (loadError) throw new Error(loadError);
      committed.current = writeProjectStandards(workspaceStorage, key, committed.current, next);
      setSaveError(''); setOperationError(''); return true;
    } catch (error) { setSaveError('项目规范修改未保存：' + String(error)); return false; }
  };
  const update = (operation: (current: ProjectStandardsStore) => ProjectStandardsStore) => {
    if (loadError) return false;
    let next: ProjectStandardsStore;
    try { next = validateProjectStandards(operation(structuredClone(latest.current))); }
    catch (error) { setOperationError('项目规范更改未应用：' + String(error)); return false; }
    latest.current = next; setStore(next); setOperationError('');
    return persist(next);
  };
  // The caller offers a draft backup and confirms discarding local changes first.
  const reload = () => {
    try {
      const loaded = readProjectStandards(workspaceStorage, key);
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
    error: loadError ? '项目规范存档读取失败，已停止写入：' + loadError : [saveError, operationError].filter(Boolean).join('；') };
}
export type ProjectStandardsController = ReturnType<typeof useProjectStandards>;
