import { useMemo, useRef, useState, type SetStateAction } from 'react';
import { workspaceStorage } from './workspace-storage';

export function useStoredState<T>(key: string, initial: T) {
  const loaded = useMemo(() => {
    try {
      const raw = workspaceStorage.getItem(key);
      return { value: raw === null ? initial : JSON.parse(raw) as T, error: '' };
    } catch (error) { return { value: initial, error: '存档读取失败，已停止写入：' + String(error) }; }
  }, [key, initial]);
  const [frame, setFrame] = useState({ key, value: loaded.value });
  const [failure, setFailure] = useState({ key, message: '' });
  const value = frame.key === key ? frame.value : loaded.value;
  const latest = useRef(value);
  latest.current = value;
  const setValue = (action: SetStateAction<T>) => {
    try {
      if (loaded.error) throw new Error(loaded.error);
      const next = action instanceof Function ? action(latest.current) : action;
      workspaceStorage.setItem(key, JSON.stringify(next));
      latest.current = next;
      setFrame({ key, value: next });
      setFailure({ key, message: '' });
      return true;
    } catch (error) { setFailure({ key, message: '修改未保存：' + String(error) }); return false; }
  };
  return [value, setValue, loaded.error || (failure.key === key ? failure.message : '')] as const;
}
