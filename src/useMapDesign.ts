import { withWorldLayout } from './map-world';
import { consolidatePassages } from './map-passages';
const normalize=(store:MapDesignStore,designs:GameplayDesign[])=>consolidatePassages(withWorldLayout(store,designs));
import type { GameplayDesign } from './gameplay';
import { useEffect, useRef, useState } from 'react';
import { workspaceStorage } from './workspace-storage';
import { emptyMapDesign, readMapDesign, validateMapDesign, writeMapDesign, type MapDesignStore } from './map-design';

// WorkspaceApp remounts by project ID. Failed writes retain the current draft.
export function useMapDesign(workspaceId: string, designs: GameplayDesign[]) {
  const key = 'gamecreator.workspace.v1:' + workspaceId + ':map-design';
  const [initial] = useState(() => {
    try { return { ...readMapDesign(workspaceStorage, key), error: '' }; }
    catch (error) { return { raw: null, store: emptyMapDesign(), error: String(error) }; }
  });
  const [store, setStore] = useState(()=>normalize(initial.store,designs));
  const [loadError, setLoadError] = useState(initial.error);
  const [saveError, setSaveError] = useState(''), [operationError, setOperationError] = useState('');
  const latest = useRef(store), committed = useRef(initial.raw);
  const persist = (next: MapDesignStore) => {
    try {
      if (loadError) throw new Error(loadError);
      committed.current = writeMapDesign(workspaceStorage, key, committed.current, next);
      setSaveError(''); setOperationError(''); return true;
    } catch (error) { setSaveError('地图设计修改未保存：' + String(error)); return false; }
  };
  const update = (operation: (current: MapDesignStore) => MapDesignStore) => {
    if (loadError) return false;
    let next: MapDesignStore;
    try { next = validateMapDesign(normalize(operation(structuredClone(latest.current)),designs)); }
    catch (error) { setOperationError('地图设计更改未应用：' + String(error)); return false; }
    latest.current = next; setStore(next); setOperationError('');
    return persist(next);
  };
  // The caller offers a draft backup and confirms discarding local changes first.
  const reload = () => {
    try {
      const loaded = readMapDesign(workspaceStorage, key);
      const restored=normalize(loaded.store,designs); latest.current = restored; committed.current = loaded.raw; setStore(restored);
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
    error: loadError ? '地图设计存档读取失败，已停止写入：' + loadError : [saveError, operationError].filter(Boolean).join('；') };
}
export type MapDesignController = ReturnType<typeof useMapDesign>;
