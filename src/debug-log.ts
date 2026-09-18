export type DebugEntry = { id: number; at: string; action: string; status: 'success' | 'error'; detail: string; scope: string };
let entries: DebugEntry[] = [];
let sequence = 0;
const listeners = new Set<() => void>();
export function logDebug(action: string, status: DebugEntry['status'], detail: string, scope = '') {
  entries = [...entries.slice(-199), { id: ++sequence, at: new Date().toISOString(), action, status, detail, scope }];
  listeners.forEach(listener => listener());
}
export const subscribeDebug = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getDebugLog = () => entries;
export function clearDebugLog() { entries = []; listeners.forEach(listener => listener()); }
