import { useEffect, useRef, useState } from 'react';
import { workspaceStorage } from './workspace-storage';
import { emptyNumericalAnalysis, readNumericalAnalysis, validateNumericalAnalysis, writeNumericalAnalysis, type NumericalAnalysisStore } from './numerical-analysis';

// WorkspaceApp remounts by project ID. Failed writes retain the current draft.
export function useNumericalAnalysis(workspaceId: string) {
  const key = 'gamecreator.workspace.v1:' + workspaceId + ':numerical-analysis';
  const [initial] = useState(() => {
    try { return { ...readNumericalAnalysis(workspaceStorage, key), error: '' }; }
    catch (error) { return { raw: null, store: emptyNumericalAnalysis(), error: String(error) }; }
  });
  const [store, setStore] = useState(initial.store);
  const [loadError, setLoadError] = useState(initial.error);
  const [saveError, setSaveError] = useState(''), [operationError, setOperationError] = useState('');
  const latest = useRef(store), committed = useRef(initial.raw);
  const persist = (next: NumericalAnalysisStore) => {
    try {
      if (loadError) throw new Error(loadError);
      committed.current = writeNumericalAnalysis(workspaceStorage, key, committed.current, next);
      setSaveError(''); setOperationError(''); return true;
    } catch (error) { setSaveError('数值分析修改未保存：' + String(error)); return false; }
  };
  const update = (operation: (current: NumericalAnalysisStore) => NumericalAnalysisStore) => {
    if (loadError) return false;
    let next: NumericalAnalysisStore;
    try { next = validateNumericalAnalysis(operation(structuredClone(latest.current))); }
    catch (error) { setOperationError('数值分析更改未应用：' + String(error)); return false; }
    latest.current = next; setStore(next); setOperationError('');
    return persist(next);
  };
  // The caller offers a draft backup and confirms discarding local changes first.
  const reload = () => {
    try {
      const loaded = readNumericalAnalysis(workspaceStorage, key);
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
    error: loadError ? '数值分析存档读取失败，已停止写入：' + loadError : [saveError, operationError].filter(Boolean).join('；') };
}
export type NumericalAnalysisController = ReturnType<typeof useNumericalAnalysis>;
