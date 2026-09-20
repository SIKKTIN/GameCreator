import { useEffect, useRef, useState } from 'react';
import { workspaceStorage } from './workspace-storage';
import { emptyTaskFlows, readTaskFlows, validateTaskFlows, writeTaskFlows, type TaskFlowStore } from './task-flow';

// WorkspaceApp remounts by project ID. Failed writes retain the current draft.
export function useTaskFlows(workspaceId: string) {
  const key = 'gamecreator.workspace.v1:' + workspaceId + ':task-flows';
  const [initial] = useState(() => {
    try { return { ...readTaskFlows(workspaceStorage, key), error: '' }; }
    catch (error) { return { raw: null, store: emptyTaskFlows(), error: String(error) }; }
  });
  const [store, setStore] = useState(initial.store);
  const [loadError, setLoadError] = useState(initial.error);
  const [saveError, setSaveError] = useState(''), [operationError, setOperationError] = useState('');
  const latest = useRef(store), committed = useRef(initial.raw);
  const persist = (next: TaskFlowStore) => {
    try {
      if (loadError) throw new Error(loadError);
      committed.current = writeTaskFlows(workspaceStorage, key, committed.current, next);
      setSaveError(''); setOperationError(''); return true;
    } catch (error) { setSaveError('任务与流程修改未保存：' + String(error)); return false; }
  };
  const update = (operation: (current: TaskFlowStore) => TaskFlowStore) => {
    if (loadError) return false;
    let next: TaskFlowStore;
    try { next = validateTaskFlows(operation(structuredClone(latest.current))); }
    catch (error) { setOperationError('任务与流程更改未应用：' + String(error)); return false; }
    latest.current = next; setStore(next); setOperationError('');
    return persist(next);
  };
  // The caller offers a draft backup and confirms discarding local changes first.
  const reload = () => {
    try {
      const loaded = readTaskFlows(workspaceStorage, key);
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
    error: loadError ? '任务与流程存档读取失败，已停止写入：' + loadError : [saveError, operationError].filter(Boolean).join('；') };
}
export type TaskFlowsController = ReturnType<typeof useTaskFlows>;
