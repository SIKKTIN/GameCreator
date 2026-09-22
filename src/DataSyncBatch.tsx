import {useEffect, useRef, useState} from 'react';
import type {Decision} from '../shared/data-sync.mjs';
import {chooseDifferences, confirmDifferenceDeletions, differenceRemovals, pendingDifference, selectedGroupDifferences, type DifferenceGroup} from './data-sync-comparison';

function SelectionBox({label, checked, partial = false, disabled, onChange}: {label: string; checked: boolean; partial?: boolean; disabled: boolean; onChange: (checked: boolean) => void}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {if (ref.current) ref.current.indeterminate = partial;}, [partial]);
  return <input ref={ref} type="checkbox" className="ds-batch-checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)}/>;
}

/** Each comparison section owns its selection; decisions retain original diff IDs. */
export function useDataSyncBatch({scope, groups, decisions, disabled, onChange, preventDelete = false}: {
  scope: string; groups: DifferenceGroup[]; decisions: Record<string, Decision>; disabled: boolean;
  onChange: (next: Record<string, Decision>) => void; preventDelete?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const available = groups.filter(g => g.differences.length > 0);
  const selectedGroups = available.filter(g => selected.includes(g.id));
  const differences = selectedGroupDifferences(available, selected);
  const removals = differenceRemovals(differences, decisions);
  const none = !selectedGroups.length;
  const all = <SelectionBox label={scope + ' 全选'} checked={!!available.length && selectedGroups.length === available.length} partial={!none && selectedGroups.length < available.length} disabled={disabled || !available.length} onChange={checked => setSelected(checked ? available.map(g => g.id) : [])}/>;
  const checkbox = (group: DifferenceGroup) => <SelectionBox label={scope + ' 选择 ' + group.label} checked={selected.includes(group.id) && !!group.differences.length} disabled={disabled || !group.differences.length} onChange={checked => setSelected(old => checked ? [...new Set([...old, group.id])] : old.filter(id => id !== group.id))}/>;
  const tools = <div className="ds-batch-tools" role="group" aria-label={scope + ' 批量操作'}>
    <div className="ds-batch-selection"><span>已选 {selectedGroups.length} / {available.length} 项</span><button type="button" disabled={disabled || !available.length} onClick={() => setSelected(available.filter(g => g.differences.some(d => pendingDifference(d, decisions))).map(g => g.id))}>选择待处理项</button><button type="button" disabled={disabled || none} onClick={() => setSelected([])}>清空选择</button></div>
    <div className="ds-batch-actions"><button type="button" disabled={disabled || none || preventDelete && differences.some(d => d.local === undefined)} onClick={() => onChange(chooseDifferences(differences, decisions, 'local'))}>所选保留 GameCreator</button><button type="button" disabled={disabled || none || preventDelete && differences.some(d => d.remote === undefined)} onClick={() => onChange(chooseDifferences(differences, decisions, 'remote'))}>所选采用引擎文件</button></div>
    {!preventDelete && !!removals.length && <label className="ds-delete-confirm"><input type="checkbox" aria-label={scope + ' 确认所选删除'} disabled={disabled} checked={removals.every(d => decisions[d.id]?.allowDelete)} onChange={e => onChange(confirmDifferenceDeletions(differences, decisions, e.target.checked))}/>确认所选删除（{removals.length} 处）</label>}
  </div>;
  return {all, checkbox, tools};
}
