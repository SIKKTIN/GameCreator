import type { DatasetDef, ProjectData } from './data-model.ts';
import { workspaceStorage } from './workspace-storage.ts';

export type DatasetViewState = {
  query: string;
  filter: 'all' | 'warning';
  selectedId: string;
  detailOpen: boolean;
  scrollTop: number;
  scrollLeft: number;
};

export type DataViewState = {
  version: 1;
  activeDataset: string;
  directoryWidth: number;
  directoryCollapsed: boolean;
  emptyExpanded: boolean;
  tables: Record<string, DatasetViewState>;
};

type ViewStorage = Pick<Storage, 'getItem' | 'setItem'>;
type RootPatch = Partial<Omit<DataViewState, 'tables' | 'version'>>;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const safeKey = (key: string) => !!key && key.length <= 256 && !['__proto__', 'constructor', 'prototype'].includes(key);
const text = (value: unknown, limit = 256) => typeof value === 'string' ? value.slice(0, limit) : '';
const scroll = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(value, 10_000_000)) : 0;

export function defaultDatasetViewState(): DatasetViewState {
  return { query: '', filter: 'all', selectedId: '', detailOpen: false, scrollTop: 0, scrollLeft: 0 };
}

function normalizeDatasetViewState(value: unknown): DatasetViewState {
  const source = isObject(value) ? value : {};
  return {
    query: text(source.query, 1_000), filter: source.filter === 'warning' ? 'warning' : 'all',
    selectedId: text(source.selectedId), detailOpen: source.detailOpen === true,
    scrollTop: scroll(source.scrollTop), scrollLeft: scroll(source.scrollLeft),
  };
}

export function normalizeDataViewState(value: unknown): DataViewState {
  const source = isObject(value) && (value.version === undefined || value.version === 1) ? value : {};
  const tables: Record<string, DatasetViewState> = {};
  if (isObject(source.tables)) {
    for (const [key, table] of Object.entries(source.tables)) {
      if (safeKey(key)) tables[key] = normalizeDatasetViewState(table);
    }
  }
  return {
    version: 1, activeDataset: text(source.activeDataset),
    directoryWidth: typeof source.directoryWidth === 'number' && Number.isFinite(source.directoryWidth)
      ? Math.round(Math.max(180, Math.min(source.directoryWidth, 300))) : 220,
    directoryCollapsed: source.directoryCollapsed === true,
    emptyExpanded: source.emptyExpanded === true, tables,
  };
}

// Presentation preferences never share a key with configuration data or versions.
export const dataViewStorageKey = (workspaceKey: string) => 'gamecreator.workspace.v1:' + workspaceKey + ':data-view';

function load(workspaceKey: string, storage: ViewStorage) {
  const raw = storage.getItem(dataViewStorageKey(workspaceKey));
  const value: unknown = raw === null ? null : JSON.parse(raw);
  if (isObject(value) && value.version !== undefined && value.version !== 1) throw new Error('Unsupported data view version');
  return normalizeDataViewState(value);
}

export function readDataViewState(workspaceKey: string, storage: ViewStorage = workspaceStorage): DataViewState {
  try { return load(workspaceKey, storage); }
  catch { return normalizeDataViewState(null); }
}

export function patchDataViewState(workspaceKey: string, patch: RootPatch, storage: ViewStorage = workspaceStorage): boolean {
  try {
    const current = load(workspaceKey, storage);
    const next = normalizeDataViewState({ ...current, ...patch, version: 1, tables: current.tables });
    storage.setItem(dataViewStorageKey(workspaceKey), JSON.stringify(next));
    return true;
  } catch { return false; }
}

export function patchDatasetViewState(workspaceKey: string, tableKey: string, patch: Partial<DatasetViewState>, storage: ViewStorage = workspaceStorage): boolean {
  if (!safeKey(tableKey)) return false;
  try {
    const current = load(workspaceKey, storage);
    const table = normalizeDatasetViewState({ ...current.tables[tableKey], ...patch });
    const next = { ...current, tables: { ...current.tables, [tableKey]: table } };
    storage.setItem(dataViewStorageKey(workspaceKey), JSON.stringify(next));
    return true;
  } catch { return false; }
}

export function resolveActiveDataset(definitions: readonly Pick<DatasetDef, 'key'>[], data: Pick<ProjectData, 'datasets'>, preferredKey = ''): string {
  const available = definitions.filter(definition => Array.isArray(data.datasets[definition.key]));
  if (available.some(definition => definition.key === preferredKey)) return preferredKey;
  return available.find(definition => data.datasets[definition.key].length > 0)?.key ?? available[0]?.key ?? '';
}
