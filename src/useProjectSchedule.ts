import { useEffect, useRef, useState } from 'react';
import { workspaceStorage } from './workspace-storage';
import { emptyProjectSchedule, readProjectSchedule, validateProjectSchedule, writeProjectSchedule, type ProjectScheduleStore } from './project-schedule';

// WorkspaceApp remounts by project ID. Failed writes retain the current draft.
export function useProjectSchedule(workspaceId: string, legacyDefaults: unknown[] = []) {
  const key = 'gamecreator.workspace.v1:' + workspaceId + ':project-schedule';
  const legacyKey = 'gamecreator.workspace.v1:' + workspaceId + ':milestones';
  const [initial] = useState(() => {
    try { return { ...readProjectSchedule(workspaceStorage, key, legacyKey, legacyDefaults), error: '' }; }
    catch (error) { return { raw: null, legacyRaw: null, store: emptyProjectSchedule(), error: String(error) }; }
  });
  const [store, setStore] = useState(initial.store);
  const [loadError, setLoadError] = useState(initial.error);
  const [saveError, setSaveError] = useState(''), [operationError, setOperationError] = useState('');
  const latest = useRef(store), committed = useRef(initial.raw), legacyRaw = useRef(initial.legacyRaw);
  const persist = (next: ProjectScheduleStore) => {
    try {
      if (loadError) throw new Error(loadError);
      committed.current = writeProjectSchedule(workspaceStorage, key, committed.current, next, { key: legacyKey, expected: legacyRaw.current });
      setSaveError(''); setOperationError(''); return true;
    } catch (error) { setSaveError('项目排期修改未保存：' + String(error)); return false; }
  };
  const update = (operation: (current: ProjectScheduleStore) => ProjectScheduleStore) => {
    if (loadError) return false;
    let next: ProjectScheduleStore;
    try { next = validateProjectSchedule(operation(structuredClone(latest.current))); }
    catch (error) { setOperationError('项目排期更改未应用：' + String(error)); return false; }
    latest.current = next; setStore(next); setOperationError('');
    return persist(next);
  };
  // The caller offers a draft backup and confirms discarding local changes first.
  const reload = () => {
    try {
      const loaded = readProjectSchedule(workspaceStorage, key, legacyKey, legacyDefaults);
      latest.current = loaded.store; committed.current = loaded.raw; legacyRaw.current = loaded.legacyRaw; setStore(loaded.store);
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
    error: loadError ? '项目排期存档读取失败，已停止写入：' + loadError : [saveError, operationError].filter(Boolean).join('；') };
}
export type ProjectScheduleController = ReturnType<typeof useProjectSchedule>;
