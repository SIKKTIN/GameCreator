import { useEffect, useRef, useState } from 'react';
import { workspaceStorage } from './workspace-storage';
import { emptyDevelopmentTools, readDevelopmentTools, validateDevelopmentTools, writeDevelopmentTools, type DevelopmentToolsStore } from './development-tools';

// WorkspaceApp remounts by project ID. Failed writes retain the current draft.
export function useDevelopmentTools(workspaceId: string) {
  const key = 'gamecreator.workspace.v1:' + workspaceId + ':development-tools';
  const [initial] = useState(() => {
    try { return { ...readDevelopmentTools(workspaceStorage, key), error: '' }; }
    catch (error) { return { raw: null, store: emptyDevelopmentTools(), error: String(error) }; }
  });
  const [store, setStore] = useState(initial.store);
  const [loadError, setLoadError] = useState(initial.error);
  const [saveError, setSaveError] = useState(''), [operationError, setOperationError] = useState('');
  const latest = useRef(store), committed = useRef(initial.raw);
  const unsaved=useRef(false);
  const persist = (next: DevelopmentToolsStore) => {
    try {
      if (loadError) throw new Error(loadError);
      committed.current = writeDevelopmentTools(workspaceStorage, key, committed.current, next);
      unsaved.current=false;setSaveError(''); setOperationError(''); return true;
    } catch (error) { unsaved.current=true;setSaveError('开发工具修改未保存：' + String(error)); return false; }
  };
  const update = (operation: (current: DevelopmentToolsStore) => DevelopmentToolsStore) => {
    if (loadError) return false;
    let next: DevelopmentToolsStore;
    try { next = validateDevelopmentTools(operation(structuredClone(latest.current))); }
    catch (error) { setOperationError('开发工具更改未应用：' + String(error)); return false; }
    latest.current = next; setStore(next); setOperationError('');
    return persist(next);
  };
  // The caller offers a draft backup and confirms discarding local changes first.
  const reload = () => {
    try {
      const loaded = readDevelopmentTools(workspaceStorage, key);
      latest.current = loaded.store; committed.current = loaded.raw; setStore(loaded.store);
      unsaved.current=false;setLoadError(''); setSaveError(''); setOperationError(''); return true;
    } catch (error) { setLoadError(String(error)); return false; }
  };
  const pending = !!saveError;
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending]);
  return { store, update, retry: () => persist(latest.current), reload, reloadIfClean:()=>!unsaved.current&&reload(), blocked: !!loadError, pending,
    error: loadError ? '开发工具存档读取失败，已停止写入：' + loadError : [saveError, operationError].filter(Boolean).join('；') };
}
export type DevelopmentToolsController = ReturnType<typeof useDevelopmentTools>;
