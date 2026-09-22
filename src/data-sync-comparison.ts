import {parseJson, stable, type Canonical, type DataDifference, type Decision, type Json} from '../shared/data-sync.mjs';
import type {DataSyncFile} from './data-sync';

export type DifferenceGroup = {id: string; label: string; differences: DataDifference[]; localExists: boolean; remoteExists: boolean; count?: number};
export type ComparisonCell = DifferenceGroup & {key: string; local?: Json; remote?: Json};
export type ComparisonRecord = {id: string; label: string; cells: ComparisonCell[]};
export type HeaderMatch = {key: string; remoteKey: string; localExists: boolean; remoteExists: boolean; group: DifferenceGroup};
const own = (value: object | undefined, key: string) => !!value && Object.prototype.hasOwnProperty.call(value, key);
const keys = (value: Canonical | undefined) => value?.shape === 'object' ? Object.keys(value.value ?? {}) : [...new Set(Object.values(value?.rows ?? {}).flatMap(Object.keys))];
const group = (id: string, label: string, differences: DataDifference[], localExists: boolean, remoteExists: boolean): DifferenceGroup => ({id, label, differences, localExists, remoteExists});

// Presentation groups retain the original decision IDs. A field decision applies
// to all of its affected records; the transaction still resolves the exact diff.
export function compareDataFile(file: DataSyncFile) {
  const {local, remote} = file, differences = file.differences ?? [];
  const object = (local ?? remote)?.shape === 'object';
  const localKeys = new Set([...keys(local), ...(!object && local ? file.fields?.local ?? [] : [])]);
  const remoteKeys = new Set(keys(remote));
  const headers: HeaderMatch[] = [...new Set([...localKeys, ...remoteKeys])].map(key => ({
    key, remoteKey: object ? key : file.mapping?.[key] ?? key, localExists: localKeys.has(key), remoteExists: remoteKeys.has(key),
    group: group('field:' + key, key, differences.filter(d => object ? d.path[0] === 'value' && d.path[1] === key : d.path[0] === 'rows' && d.path.length >= 3 && d.path[2] === key), localKeys.has(key), remoteKeys.has(key)),
  }));
  const shared = headers.filter(h => h.localExists && h.remoteExists);
  const structuralFields = headers.filter(h => h.localExists !== h.remoteExists);
  const files = differences.filter(d => !d.path.length).map(d => group(d.id, '整个配置', [d], d.local !== undefined, d.remote !== undefined));
  const records = differences.filter(d => d.path[0] === 'rows' && d.path.length === 2).map(d => ({...group(d.id, d.path[1], [d], d.local !== undefined, d.remote !== undefined), count: Object.keys((d.local ?? d.remote ?? {}) as object).length}));
  const valueRows: ComparisonRecord[] = [];
  const recordIds = object ? ['value'] : [...new Set([...(local?.order ?? []), ...Object.keys(local?.rows ?? {})])].filter(id => own(remote?.rows, id));
  for (const id of recordIds) {
    const l = object ? local?.value : local?.rows?.[id], r = object ? remote?.value : remote?.rows?.[id];
    const cells = shared.map(h => {
      const ds = h.group.differences.filter(d => object || d.path[1] === id);
      return {...group(JSON.stringify([id, h.key]), h.key, ds, own(l, h.key), own(r, h.key)), key: h.key, local: l?.[h.key], remote: r?.[h.key]};
    });
    if (cells.some(c => c.differences.length)) valueRows.push({id, label: object ? '对象配置' : id, cells});
  }
  const changedKeys = new Set(valueRows.flatMap(row => row.cells.filter(c => c.differences.length).map(c => c.key)));
  const valueHeaders = shared.filter(h => changedKeys.has(h.key));
  for (const row of valueRows) row.cells = row.cells.filter(c => changedKeys.has(c.key));
  const other = differences.filter(d => !['rows', 'value'].includes(d.path[0]) && d.path.length);
  return {headers, shared, structuralFields, files, records, valueHeaders, valueRows, other};
}

export function decisionFor(d: DataDifference, decisions: Record<string, Decision>): Decision {
  return decisions[d.id] ?? {choice: d.choice};
}
export function choiceFor(differences: DataDifference[], decisions: Record<string, Decision>) {
  const choices = new Set(differences.map(d => decisionFor(d, decisions).choice));
  if (choices.has('')) return '';
  return choices.size === 1 ? [...choices][0] : 'mixed';
}
export function pendingDifference(d: DataDifference, decisions: Record<string, Decision>) {
  const c = decisionFor(d, decisions);
  if (c.choice === 'custom') {try {parseJson(c.value ?? ''); return false;} catch {return true;}}
  return !c.choice || d[c.choice] === undefined && !c.allowDelete;
}
export function chooseDifferences(differences: DataDifference[], decisions: Record<string, Decision>, choice: 'local' | 'remote') {
  const next = {...decisions};
  for (const d of differences) next[d.id] = {choice, allowDelete: false};
  return next;
}
export function sameCell(cell: ComparisonCell) {return stable(cell.local) === stable(cell.remote);}

export function selectedGroupDifferences(groups: DifferenceGroup[], selected: string[]) {
  const ids = new Set(selected);
  return [...new Map(groups.filter(g => ids.has(g.id)).flatMap(g => g.differences).map(d => [d.id, d])).values()];
}
export function differenceRemovals(differences: DataDifference[], decisions: Record<string, Decision>) {
  return differences.filter(d => {const c = decisionFor(d, decisions); return c.choice && c.choice !== 'custom' && d[c.choice] === undefined;});
}
export function confirmDifferenceDeletions(differences: DataDifference[], decisions: Record<string, Decision>, allowDelete: boolean) {
  const next = {...decisions};
  for (const d of differenceRemovals(differences, decisions)) next[d.id] = {...decisionFor(d, decisions), allowDelete};
  return next;
}
