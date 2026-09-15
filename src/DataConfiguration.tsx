import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, Pencil, Plus, RefreshCw, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import {
  enumId, enumOptions, findEnum, formatLuaValue, resolveEnumValue, validateCell, validateRow,
  type ColumnDef, type DataRecord, type DatasetDef, type DatasetKey, type ProjectData,
} from './data-model';
import type { EnumRegistry } from './useEnumRegistry';

type Props = {
  data: ProjectData; onChange: (data: ProjectData) => void; definitions: DatasetDef[];
  activeDataset: DatasetKey; setActiveDataset: (key: DatasetKey) => void; registry: EnumRegistry;
};

export function DataConfiguration({ data, onChange, definitions, activeDataset, setActiveDataset, registry }: Props) {
  const definition = definitions.find((item) => item.key === activeDataset)!;
  const columns = data.columns[activeDataset];
  const rows = data.datasets[activeDataset];
  const [showFields, setShowFields] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'warning'>('all');
  const [selectedId, setSelectedId] = useState('');
  const issues = (row: DataRecord) => validateRow(row, columns, data, registry);
  const warnings = rows.filter((row) => issues(row).length > 0).length;
  const visible = rows.filter((row) => Object.values(row).some((value) => value.toLowerCase().includes(query.toLowerCase())) &&
    (filter === 'all' || issues(row).length > 0));
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0];
  const changeRows = (next: DataRecord[]) => onChange({ ...data, datasets: { ...data.datasets, [activeDataset]: next } });
  const updateCell = (row: DataRecord, column: ColumnDef, value: string) => {
    changeRows(rows.map((current) => current === row ? { ...current, [column.key]: value } : current));
    if (column.key === 'id') setSelectedId(value);
  };
  const addRow = () => {
    const id = activeDataset + '_' + Date.now();
    const row = Object.fromEntries(columns.map((column) => [column.key, column.key === 'id' ? id : ''])) as DataRecord;
    changeRows([...rows, row]);
    setSelectedId(id);
  };
  function cell(row: DataRecord, column: ColumnDef, inspector = false) {
    const value = row[column.key] ?? '';
    const problem = validateCell(column, value, data, registry);
    const label = (inspector ? '详情 ' : '') + row.id + ' · ' + column.label;
    const attributes = { 'aria-label': label, 'aria-invalid': !!problem, title: problem };
    if (column.type === 'enum') {
      const options = enumOptions(column, registry);
      const unknown = !!value && !options.some((option) => option.key === value);
      return <select {...attributes} value={value} disabled={!!column.enumId && !registry.ready}
        onChange={(event) => updateCell(row, column, event.target.value)}>
        <option value="">请选择</option>
        {unknown && <option value={value}>未知成员：{value}</option>}
        {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>;
    }
    if (column.type === 'reference') {
      const references = column.reference ? data.datasets[column.reference] : [];
      return <select {...attributes} value={value} onChange={(event) => updateCell(row, column, event.target.value)}>
        <option value="">请选择记录</option>
        {value && !references.some((record) => record.id === value) && <option value={value}>未知记录：{value}</option>}
        {references.map((record) => <option key={record.id} value={record.id}>{record.id}</option>)}
      </select>;
    }
    return <input {...attributes} value={value} onChange={(event) => updateCell(row, column, event.target.value)} />;
  }
  return <section className="data-workspace">
    <div className="data-tabs">{definitions.map((item) => <button key={item.key} className={item.key === activeDataset ? 'active' : ''}
      onClick={() => { setActiveDataset(item.key); setSelectedId(''); setShowFields(false); }}>
      {item.label}<span>{data.datasets[item.key].length}</span></button>)}</div>
    <div className="registry-status" role="status">
      <div><b>{registry.active ? '稳定版本 ' + registry.active.id.slice(0, 10) + ' · ' + registry.scan?.groups.length + ' 组枚举' : '尚无稳定枚举版本'}</b>
        <small>{registry.error || (registry.candidate ? '存在候选更新，请到「枚举管理」审核；当前配置继续使用稳定版本。' : registry.ready ? '数据与字段自动保存，更新需审核发布。' : '请先到「枚举管理」审核首次导入。')}</small></div>
      <button onClick={() => void registry.refresh()} disabled={registry.loading || registry.busy}><RefreshCw size={14} />扫描更新</button>
    </div>
    <details className="release-preview"><summary>{registry.canExport ? '导出检查通过 · 仅使用当前稳定版本' : '导出被阻止 · ' + registry.blockingIssues.length + ' 项待处理问题'}</summary>
      {registry.blockingIssues.map((issue, index) => <p key={index}>{issue}</p>)}
      <small>Lua 文件生成尚未接入。候选版本不会参与数据解析或导出。</small>
    </details>
    <div className="data-toolbar"><div className="view-title"><Database size={18} color="#7c6af7" /><b>{definition.label} 配置</b></div>
      <div className="data-tools"><div className="data-search"><Search size={15} /><input aria-label="搜索记录" value={query}
        onChange={(event) => setQuery(event.target.value)} placeholder="搜索记录..." /></div>
        <select aria-label="记录状态筛选" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
          <option value="all">全部状态</option><option value="warning">仅看问题</option></select>
        <button onClick={() => setShowFields(!showFields)}><SlidersHorizontal size={15} />字段</button>
        <button className="primary" onClick={addRow}><Plus size={15} />新增记录</button></div></div>
    {showFields && <FieldManager key={activeDataset} columns={columns} definitions={definitions} registry={registry}
      onClose={() => setShowFields(false)} onApply={(next) => {
        onChange({ ...data, columns: { ...data.columns, [activeDataset]: next } });
        setShowFields(false);
      }} />}
    <div className="data-layout"><div className="data-table-wrap"><table className="data-table">
      <thead><tr><th>状态</th>{columns.map((column) => <th key={column.key}>{column.label}
        {column.enumId && <small className="column-binding" title={column.enumId}>{findEnum(column, registry)?.name ?? column.enumName ?? '枚举失效'}</small>}
      </th>)}<th /></tr></thead>
      <tbody>{visible.map((row) => <tr key={row.id} className={row.id === selected?.id ? 'selected' : ''} onClick={() => setSelectedId(row.id)}>
        <td title={issues(row).map((issue) => issue.column.label + '：' + issue.message).join('\n')}>
          {issues(row).length ? <AlertTriangle size={16} color="#e7a93b" /> : <CheckCircle2 size={16} color="#34c38f" />}</td>
        {columns.map((column) => <td key={column.key}>{cell(row, column)}</td>)}
        <td><button className="icon-button" title="删除记录" onClick={(event) => {
          event.stopPropagation(); changeRows(rows.filter((current) => current !== row));
        }}><Trash2 size={15} /></button></td></tr>)}</tbody></table>
      {!visible.length && <p className="empty-inspector">暂无匹配记录。</p>}
      <div className="table-foot">显示 {visible.length} / {rows.length} 条记录<span>{warnings} 条记录需要修正</span></div></div>
      <aside className="data-inspector"><div className="inspector-heading"><div><span>SELECTED RECORD</span>
        <h3>{selected?.name || selected?.itemID || selected?.id || '未选择记录'}</h3></div><Pencil size={16} /></div>
        {selected ? <div className="inspector-fields">{columns.map((column) => {
          const value = resolveEnumValue(column, selected[column.key], registry);
          const problem = validateCell(column, selected[column.key], data, registry);
          const group = findEnum(column, registry);
          return <label key={column.key}>{column.label}{cell(selected, column, true)}
            {column.enumId && <small className="enum-resolution">{group?.name ?? column.enumName ?? column.enumId}
              {value !== undefined && <><br />Lua 值：<code>{formatLuaValue(value)}</code> · {typeof value}</>}
              {group && <><br />{group.source}:{group.line}</>}
            </small>}
            {problem && <small className="field-error">{problem}</small>}
          </label>;
        })}</div> : <p className="empty-inspector">新增一条记录后可在此编辑属性。</p>}
        <div className="validation">{warnings ? <AlertTriangle size={16} color="#e7a93b" /> : <CheckCircle2 size={16} color="#34c38f" />}
          <div><b>配置检查</b><p>{warnings ? '发现 ' + warnings + ' 条记录需要修正。未知成员会保留原值，重新选择后解除提示。' :
            '当前数据已通过字段、枚举与引用检查。'}</p></div></div>
      </aside></div>
  </section>;
}

function FieldManager({ columns, definitions, registry, onApply, onClose }: {
  columns: ColumnDef[]; definitions: DatasetDef[]; registry: EnumRegistry;
  onApply: (columns: ColumnDef[]) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(columns);
  const [newKey, setNewKey] = useState('');
  const [error, setError] = useState('');
  const update = (index: number, patch: Partial<ColumnDef>) =>
    setDraft((current) => current.map((column, i) => i === index ? { ...column, ...patch } : column));
  const add = () => {
    const key = newKey.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || draft.some((column) => column.key === key)) {
      setError('字段 key 需使用字母、数字、下划线，不能以数字开头或与已有字段重复。'); return;
    }
    setDraft([...draft, { key, label: key, type: 'text' }]); setNewKey(''); setError('');
  };
  const bindingErrors = draft.filter((column) => column.type === 'enum' &&
    (column.enumId ? !registry.ready || !findEnum(column, registry) : !column.options?.length));
  return <div className="field-manager">
    <div className="field-manager-head"><div><span>SCHEMA EDITOR</span><h3>字段定义</h3></div><button onClick={onClose}>关闭</button></div>
    <p className="field-hint">仅可绑定稳定版本中的枚举，选项在审核发布后更新。已有记录保留原成员名，不匹配的值会显示校验提示。</p>
    <div className="field-list">{draft.map((column, index) => <div className="field-row binding-row" key={column.key}>
      <input aria-label={column.key + ' 字段名称'} value={column.label} onChange={(event) => update(index, { label: event.target.value })} />
      <code>{column.key}</code>
      <select aria-label={column.key + ' 字段类型'} disabled={column.key === 'id'} value={column.type ?? 'text'} onChange={(event) =>
        update(index, { type: event.target.value as ColumnDef['type'], enumId: undefined, enumName: undefined, options: undefined,
          reference: event.target.value === 'reference' ? 'items' : undefined })}>
        <option value="text">文本</option><option value="enum">枚举</option><option value="reference">跨表引用</option></select>
      {column.type === 'enum' && <div className="enum-binding">
        <select aria-label={column.key + ' 绑定枚举'} disabled={!registry.ready} value={column.enumId ?? ''} onChange={(event) => {
          const group = registry.scan?.groups.find((item) => enumId(item) === event.target.value);
          update(index, { enumId: group ? enumId(group) : undefined, enumName: group?.name, options: undefined });
        }}>
          <option value="" disabled>{column.options?.length ? '现有选项（未绑定 Lua）' : '请选择 Lua 枚举'}</option>
          {column.enumId && !findEnum(column, registry) && <option value={column.enumId}>定义缺失：{column.enumName ?? column.enumId}</option>}
          {registry.scan?.groups.map((group) => <option key={enumId(group)} value={enumId(group)}>
            {group.name} · {group.valueType} · {group.members.length} 项
          </option>)}
        </select>
        <small>{column.enumId ? findEnum(column, registry)?.source ?? '定义已失效，请重新绑定。' :
          column.options?.join('、') || '成员从代码工程导入'}</small>
      </div>}
      {column.type === 'reference' && <select aria-label={column.key + ' 引用表'} value={column.reference}
        onChange={(event) => update(index, { reference: event.target.value as DatasetKey })}>
        {definitions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>}
    </div>)}</div>
    <div className="field-add"><input aria-label="新字段 key" value={newKey} onChange={(event) => setNewKey(event.target.value)} placeholder="新字段 key，例如 modeID" />
      <button onClick={add}><Plus size={14} />添加字段</button></div>
    {error && <p className="field-error">{error}</p>}
    <div className="field-manager-foot"><small>{bindingErrors.length ?
      '有 ' + bindingErrors.length + ' 个枚举字段需要绑定有效定义。' : '字段与数据自动保存到当前浏览器，刷新后保留。'}</small>
      <button className="primary" disabled={!!bindingErrors.length} onClick={() => onApply(draft)}>应用定义</button></div>
  </div>;
}
