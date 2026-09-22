import {Fragment, useMemo, useState} from 'react';
import {ArrowDownToLine, ArrowUpFromLine, CheckCircle2, ChevronDown, X} from 'lucide-react';
import {type DataDifference, type Decision, type Json} from '../shared/data-sync.mjs';
import type {DataSyncFile} from './data-sync';
import {chooseDifferences, choiceFor, compareDataFile, decisionFor, pendingDifference, sameCell, type DifferenceGroup} from './data-sync-comparison';

type Props = {file: DataSyncFile; decisions: Record<string, Decision>; disabled: boolean; onChange: (next: Record<string, Decision>) => void};
const shown = (value: Json | undefined) => value === undefined ? '未设置' : JSON.stringify(value);
const short = (value: Json | undefined) => {const text = shown(value); return text.length > 100 ? text.slice(0, 100) + '…' : text;};

export function DataSyncComparison({file, decisions, disabled, onChange}: Props) {
  const comparison = useMemo(() => compareDataFile(file), [file]);
  const [active, setActive] = useState('');
  const {headers, shared, structuralFields, files, records, valueHeaders, valueRows, other} = comparison;
  const values = valueRows.flatMap(row => row.cells.flatMap(cell => cell.differences));
  const cell = valueRows.flatMap(row => row.cells.map(cell => ({...cell, record: row.label}))).find(cell => cell.id === active);
  const unresolved = (file.differences ?? []).filter(d => pendingDifference(d, decisions)).length;
  const localOnly = structuralFields.filter(h => h.localExists).length, remoteOnly = structuralFields.length - localOnly;
  return <div className="ds-comparison" aria-label={file.table + ' 差异预览'}>
    <div className="ds-comparison-summary"><span>同名字段 <b>{shared.length}</b></span><span>仅 GameCreator <b>{localOnly}</b></span><span>仅引擎文件 <b>{remoteOnly}</b></span><span className={unresolved ? 'ds-pending' : 'ds-resolved'}>{unresolved ? unresolved + ' 项待处理' : '已就绪'}</span></div>
    {files.length ? <><StructureTable title="配置新增" entity="配置" groups={files} {...{file, decisions, disabled, onChange}} preventDelete/><p className="ds-comparison-hint">该配置仅在一侧存在，将整体添加，无需逐项比较值。</p></> : <>
      <div className="ds-section-heading"><h4>字段对齐</h4><span>先按 key 匹配，再比较同名字段的值</span></div>
      {structuralFields.length > 0 && <StructureTable title="字段结构差异" entity="字段 key" groups={structuralFields.map(h => ({...h.group, label: h.key + (h.remoteKey !== h.key ? ' → ' + h.remoteKey : '')}))} {...{file, decisions, disabled, onChange}}/>}
      {!!shared.length && <details className="ds-matched-keys"><summary>{shared.length} 个字段 key 已对齐</summary><div>{shared.map(h => <code key={h.key}>{h.key}{h.remoteKey !== h.key && ' → ' + h.remoteKey}</code>)}</div></details>}
      {!structuralFields.length && <p className="ds-ok ds-compact-message"><CheckCircle2 size={14}/>字段 key 一致</p>}
      {!!records.length && <><div className="ds-section-heading"><h4>记录新增 / 缺失</h4><span>按 ID 匹配，整条处理</span></div><StructureTable title="记录结构差异" entity="记录 ID" groups={records} {...{file, decisions, disabled, onChange}}/></>}
      <div className="ds-section-heading"><h4>值差异 <small>{valueRows.length} {file.shape === 'object' ? '组对象' : '条记录'} · {valueHeaders.length} 个字段</small></h4><span>仅列出同名字段的变化</span></div>
      {values.length ? <>
        <div className="ds-comparison-tools"><span>每条记录上下对照；点击高亮值可单独处理</span><div><button type="button" disabled={disabled} onClick={() => onChange(chooseDifferences(values, decisions, 'local'))}><ArrowUpFromLine size={14}/>值差异全部保留 GameCreator</button><button type="button" disabled={disabled} onClick={() => onChange(chooseDifferences(values, decisions, 'remote'))}><ArrowDownToLine size={14}/>值差异全部采用引擎</button></div></div>
        <div className="ds-table-scroll"><table className="ds-compare-table ds-value-table" aria-label={file.table + ' 同名字段值差异'}><thead><tr><th scope="col">{file.shape === 'object' ? '配置' : '记录 ID'}</th><th scope="col">来源</th>{valueHeaders.map(h => <th scope="col" key={h.key}><code>{h.key}</code>{h.remoteKey !== h.key && <small>引擎：{h.remoteKey}</small>}</th>)}<th scope="col">采用值</th></tr></thead>
          <tbody>{valueRows.map(row => <Fragment key={row.id}>{(['local', 'remote'] as const).map((side, index) => <tr key={side} className={'ds-value-row ds-side-' + side}>
            {!index && <th scope="rowgroup" rowSpan={2} className="ds-record-id"><code>{row.label}</code></th>}<th scope="row" className="ds-source-label">{side === 'local' ? 'GameCreator' : '引擎文件'}</th>
            {row.cells.map(c => <td key={c.key} className={sameCell(c) ? 'ds-cell-same' : c.differences.some(d => pendingDifference(d, decisions)) ? 'ds-cell-pending' : 'ds-cell-changed'}>{c.differences.length ? <button type="button" className="ds-cell-button" aria-label={file.table + ' ' + row.label + ' ' + c.key + ' ' + (side === 'local' ? 'GameCreator' : '引擎文件') + ' 差异详情'} aria-pressed={active === c.id} onClick={() => setActive(c.id)}><code>{c.localExists !== c.remoteExists ? c[side] === undefined ? '缺失' : '存在' : short(c[side])}</code><ChevronDown size={12}/></button> : <code>{short(c[side])}</code>}</td>)}
            {!index && <td rowSpan={2} className="ds-row-decision"><GroupDecision group={{id: row.id, label: row.label, localExists: true, remoteExists: true, differences: row.cells.flatMap(c => c.differences)}} {...{file, decisions, disabled, onChange}}/></td>}
          </tr>)}</Fragment>)}</tbody></table></div>
        {cell && <section className="ds-cell-detail" aria-label="单元格差异详情"><div className="ds-section-heading"><h4><code>{cell.record} · {cell.key}</code></h4><button type="button" aria-label="关闭差异详情" onClick={() => setActive('')}><X size={15}/></button></div><DifferenceTable differences={cell.differences} {...{file, decisions, disabled, onChange}}/></section>}
      </> : <p className="ds-comparison-hint">{headers.length && !shared.length ? '没有同名字段可比较，请先检查字段映射。' : '同名字段没有值差异。'}</p>}
      {!!other.length && <details className="ds-other-differences" open={other.some(d => pendingDifference(d, decisions))}><summary>表信息与记录顺序 · {other.length} 项</summary><DifferenceTable differences={other} {...{file, decisions, disabled, onChange}}/></details>}
    </>}
  </div>;
}

function StructureTable({title, entity, groups, preventDelete, ...props}: Props & {title: string; entity: string; groups: DifferenceGroup[]; preventDelete?: boolean}) {
  return <div className="ds-table-scroll"><table className="ds-compare-table ds-structure-table" aria-label={props.file.table + ' ' + title}><thead><tr><th scope="col">{entity}</th><th scope="col">GameCreator</th><th scope="col">引擎文件</th><th scope="col">处理方式</th></tr></thead><tbody>{groups.map(g => <tr key={g.id}><th scope="row"><code>{g.label}</code></th><td><span className={g.localExists ? 'ds-presence' : 'ds-absence'}>{g.localExists ? '存在' : '缺失'}</span></td><td><span className={g.remoteExists ? 'ds-presence' : 'ds-absence'}>{g.remoteExists ? '存在' : '缺失'}</span></td><td>{g.differences.length ? <GroupDecision group={g} {...props} preventDelete={preventDelete}/> : <span className="ds-comparison-hint">随记录处理</span>}</td></tr>)}</tbody></table></div>;
}

function GroupDecision({group, file, decisions, disabled, onChange, preventDelete}: Props & {group: DifferenceGroup; preventDelete?: boolean}) {
  const choice = choiceFor(group.differences, decisions);
  const removals = group.differences.filter(d => {const c = decisionFor(d, decisions); return c.choice && c.choice !== 'custom' && d[c.choice] === undefined;});
  return <div className="ds-group-decision"><select aria-label={file.table + ' ' + group.label + ' 批量处理'} disabled={disabled} value={choice} onChange={e => onChange(chooseDifferences(group.differences, decisions, e.target.value as 'local' | 'remote'))}>
    <option value="" disabled>请选择…</option><option value="mixed" disabled>已按项处理</option><option value="custom" disabled>已自定义</option>
    <option value="local" disabled={preventDelete && !group.localExists}>保留 GameCreator</option><option value="remote" disabled={preventDelete && !group.remoteExists}>采用引擎文件</option>
  </select>{!!removals.length && <label className="ds-delete-confirm"><input type="checkbox" disabled={disabled} aria-label={file.table + ' ' + group.label + ' 确认删除'} checked={removals.every(d => decisionFor(d, decisions).allowDelete)} onChange={e => {const next = {...decisions}; for (const d of removals) next[d.id] = {...decisionFor(d, decisions), allowDelete: e.target.checked}; onChange(next);}}/>确认删除{removals.length > 1 ? '（' + removals.length + ' 处）' : ''}</label>}</div>;
}

function DifferenceTable({differences, file, decisions, disabled, onChange}: Props & {differences: DataDifference[]}) {
  const patch = (d: DataDifference, next: Partial<Decision>) => onChange({...decisions, [d.id]: {...decisionFor(d, decisions), ...next}});
  return <><div className="ds-table-scroll"><table className="ds-compare-table ds-detail-table" aria-label={file.table + ' 逐项处理'}><thead><tr><th scope="col">字段</th><th scope="col">GameCreator</th><th scope="col">引擎文件</th><th scope="col">采用值</th></tr></thead><tbody>{differences.map(d => {
    const c = decisionFor(d, decisions), removal = c.choice && c.choice !== 'custom' && d[c.choice] === undefined;
    const presenceOnly = d.local === undefined || d.remote === undefined;
    return <tr key={d.id}><th scope="row"><code>{d.path[0] === 'order' ? '记录顺序' : d.path.slice(d.path[0] === 'rows' ? 2 : 1).join(' / ') || d.path[0]}</code>{d.conflict && <small className="ds-pending">双方修改</small>}</th>
      <td><pre>{presenceOnly ? d.local === undefined ? '缺失' : '存在' : JSON.stringify(d.local, null, 2)}</pre></td><td><pre>{presenceOnly ? d.remote === undefined ? '缺失' : '存在' : JSON.stringify(d.remote, null, 2)}</pre></td>
      <td><select aria-label={file.table + ' ' + d.path.join('/') + ' 采用值'} disabled={disabled} value={c.choice} onChange={e => patch(d, {choice: e.target.value as Decision['choice'], allowDelete: false})}><option value="">请选择…</option><option value="local">保留 GameCreator</option><option value="remote">采用引擎文件</option><option value="custom">自定义 JSON 值</option></select>
        {c.choice === 'custom' && <textarea aria-label={file.table + ' ' + d.path.join('/') + ' 自定义 JSON 值'} disabled={disabled} value={c.value ?? ''} spellCheck={false} onChange={e => patch(d, {value: e.target.value})} placeholder="输入 JSON 值，字符串需加双引号"/>}
        {removal && <label className="ds-delete-confirm"><input type="checkbox" disabled={disabled} checked={!!c.allowDelete} onChange={e => patch(d, {allowDelete: e.target.checked})}/>确认删除</label>}
      </td></tr>;
  })}</tbody></table></div>{differences.some(d => d.baseLocal !== undefined || d.baseRemote !== undefined) && <details className="ds-baseline"><summary>上次同步基准</summary><div className="ds-table-scroll"><table className="ds-compare-table"><thead><tr><th scope="col">字段</th><th scope="col">GameCreator</th><th scope="col">引擎文件</th></tr></thead><tbody>{differences.map(d => <tr key={d.id}><th scope="row"><code>{d.path.join(' / ')}</code></th><td><pre>{shown(d.baseLocal)}</pre></td><td><pre>{shown(d.baseRemote)}</pre></td></tr>)}</tbody></table></div></details>}</>;
}
