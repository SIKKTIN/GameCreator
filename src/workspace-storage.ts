import { logDebug } from './debug-log.ts';
// Desktop archives are independent of the local HTTP origin. Web development
// retains browser storage. Do not silently fall back after a desktop write fails.
export const workspaceStorage: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem(key) {
    if (typeof window !== 'undefined' && window.desktopClient?.storage) return window.desktopClient.storage.getItem(key);
    return localStorage.getItem(key);
  },
  setItem(key, value) {
    try {
      if (typeof window !== 'undefined' && window.desktopClient?.storage) window.desktopClient.storage.setItem(key, value);
      else localStorage.setItem(key, value);
      logDebug('保存', 'success', '存档已写入', key);
    } catch (error) { logDebug('保存', 'error', String(error), key); throw error; }
  },
};
