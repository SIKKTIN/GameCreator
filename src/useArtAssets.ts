import { artLibrary } from './art-library';
import { writeArtItemDeletion, type ArtItemTarget } from './art-deletion';
import { useEffect, useRef, useState } from 'react';
import { workspaceStorage } from './workspace-storage';
import { emptyArtAssets, readArtAssets, validateArtAssets, validateArtMutation, writeArtAssets, type ArtStore } from './art-assets';

export function useArtAssets(workspaceId: string, fileWorkspaceId = 'project:' + workspaceId) {
  const key = 'gamecreator.workspace.v1:' + workspaceId + ':art-assets';
  const [initial] = useState(() => {
    try { return { ...readArtAssets(workspaceStorage, key), error: '' }; }
    catch (error) { return { raw: null, store: emptyArtAssets(), error: String(error) }; }
  });
  const [store, setStore] = useState(initial.store);
  const [saveError, setSaveError] = useState(''), [operationError, setOperationError] = useState('');
  const latest = useRef(store), committed = useRef(initial.raw);
  const persist = (next: ArtStore) => {
    try {
      if (initial.error) throw new Error(initial.error);
      committed.current = writeArtAssets(workspaceStorage, key, committed.current, next);
      setSaveError(''); setOperationError(''); return true;
    } catch (error) { setSaveError('素材资产修改未保存：' + String(error)); return false; }
  };
  const update = (operation: (current: ArtStore) => ArtStore) => {
    if (initial.error) return false;
    let next: ArtStore;
    try { next = validateArtMutation(latest.current, validateArtAssets(operation(structuredClone({ ...latest.current, library: artLibrary(latest.current) })))); }
    catch (error) { setOperationError('素材更改未应用：' + String(error)); return false; }
    latest.current = next; setStore(next); setOperationError('');
    return persist(next);
  };
  const pending = !!saveError;
  const remove = (target: ArtItemTarget, references: string[], material=false) => {
    if (initial.error) throw new Error('素材存档暂不可读，请恢复后再删除');
    if (pending) throw new Error('请先保存尚未写入的素材修改，再删除');
    const result = writeArtItemDeletion(workspaceStorage, key, committed.current, target, references, material);
    committed.current = result.raw; latest.current = result.store; setStore(result.store); setOperationError('');
  };
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending]);
  return { workspaceId: fileWorkspaceId, store, update, remove, retry: () => persist(latest.current), blocked: !!initial.error, pending,
    error: initial.error ? '素材资产存档读取失败，已停止写入：' + initial.error : [saveError, operationError].filter(Boolean).join('；') };
}
export type ArtController = ReturnType<typeof useArtAssets>;
