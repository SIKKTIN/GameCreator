import {useSearchRequest,useLeaveSearch} from './GlobalSearch';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ChevronsUpDown, Database, PanelLeftClose, PanelLeftOpen, PanelRight, Plus, RefreshCw, Search, SlidersHorizontal, Table2, Trash2, X } from 'lucide-react';
import {
  enumId, enumOptions, findEnum, formatLuaValue, resolveEnumValue, validateCell, validateRow,
  type ColumnDef, type DataRecord, type DatasetDef, type DatasetKey, type ProjectData,
} from './data-model';
import { defaultDatasetViewState, patchDatasetViewState, patchDataViewState, readDataViewState, type DatasetViewState } from './data-view-state';
import type { EnumRegistry } from './useEnumRegistry';
import './data-workspace.css';

type Props = {
  workspaceKey: string; data: ProjectData; onChange: (data: ProjectData) => Promise<boolean>; definitions: DatasetDef[];
  activeDataset: DatasetKey; setActiveDataset: (key: DatasetKey) => void; registry: EnumRegistry;
  onCreateTable: (definition: DatasetDef) => Promise<boolean>;
};

// Presentation preferences are saved separately from project data. Flush pending
// scroll/search changes when navigating away, not just after the debounce.
function useViewMemory<T extends object>(initial: () => T, write: (value: T) => boolean) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState(false);
  const latest = useRef(value);
  const writer = useRef(write); writer.current = write;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirty = useRef(false);
  const flush = () => {
    clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    const saved = writer.current(latest.current);
    setError(!saved);
  };
  const patch = (next: Partial<T>) => {
    latest.current = { ...latest.current, ...next };
    setValue(latest.current); dirty.current = true;
    clearTimeout(timer.current); timer.current = setTimeout(flush, 220);
  };
  useEffect(() => {
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => { window.removeEventListener('pagehide', flush); window.removeEventListener('beforeunload', flush); flush(); };
  }, []);
  return [value, patch, error] as const;
}

export function DataConfiguration({ workspaceKey, ...props }: Props) {
  const { data, definitions, activeDataset, setActiveDataset, registry, onCreateTable } = props;
  const [directory, patchDirectory, viewError] = useViewMemory(() => {
    const saved = readDataViewState(workspaceKey);
    return { directoryWidth: saved.directoryWidth, directoryCollapsed: saved.directoryCollapsed, emptyExpanded: saved.emptyExpanded };
  }, next => patchDataViewState(workspaceKey, next));
  const [tableQuery, setTableQuery] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const [showCreateTable, setShowCreateTable] = useState(false);
  const [creatingTable, setCreatingTable] = useState(false);
  const [width, setWidth] = useState(0);
  const root = useRef<HTMLElement>(null);
  const directoryTrigger = useRef<HTMLButtonElement>(null);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(root.current); return () => observer.disconnect();
  }, []);
  const narrow = width < 900;
  const definition = definitions.find(item => item.key === activeDataset);
  const matching = definitions.filter(item => (item.label + ' ' + item.key).toLocaleLowerCase().includes(tableQuery.trim().toLocaleLowerCase()));
  const occupied = matching.filter(item => data.datasets[item.key]?.length);
  const empty = matching.filter(item => !data.datasets[item.key]?.length);
  const emptyVisible = directory.emptyExpanded || !!tableQuery.trim();
  const closeDirectory = () => { setMobileOpen(false); if (narrow) directoryTrigger.current?.focus(); };
  useEffect(() => { if (mobileOpen && narrow) root.current?.querySelector<HTMLInputElement>('.data-directory-search input')?.focus(); }, [mobileOpen, narrow]);
  useEffect(() => { if (directory.directoryCollapsed && !narrow) directoryTrigger.current?.focus(); }, [directory.directoryCollapsed]);
  const renderTable = (item: DatasetDef) => <button type="button" key={item.key}
    className={'data-dataset-link' + (activeDataset === item.key ? ' active' : '')}
    aria-current={activeDataset === item.key ? 'page' : undefined}
    aria-label={item.label + '，' + (data.datasets[item.key]?.length ?? 0) + ' 条记录'} title={item.label + ' · ' + item.key}
    onClick={() => { setActiveDataset(item.key); closeDirectory(); }}>
    <Table2 size={15} /><span className="data-dataset-name">{item.label}</span><span className="data-dataset-count">{data.datasets[item.key]?.length ?? 0}</span>
  </button>;
  return <section ref={root} className={'data-workspace' + (directory.directoryCollapsed ? ' data-directory-collapsed' : '') + (mobileOpen ? ' data-directory-mobile-open' : '')}
    style={{ '--data-directory-width': directory.directoryWidth + 'px' } as CSSProperties}
    onKeyDown={event => { if (event.key === 'Escape' && mobileOpen) { event.stopPropagation(); closeDirectory(); } }}>
    <div className="data-shell">
      {mobileOpen && narrow && <button type="button" className="data-directory-backdrop" aria-label="关闭表目录遮罩" onClick={closeDirectory} />}
      <div className="data-directory" role="navigation" aria-label="配置表目录">
        <div className="data-directory-heading"><strong>配置表 <small>{definitions.length}</small></strong>
          <button type="button" className="data-directory-close" aria-label={narrow ? '关闭表目录' : '收起表目录'} title={narrow ? '关闭表目录' : '收起表目录'}
            onClick={() => { if (narrow) closeDirectory(); else { patchDirectory({ directoryCollapsed: true }); directoryTrigger.current?.focus(); } }}><PanelLeftClose size={17} /></button></div>
        <label className="data-directory-search"><Search size={15} /><input aria-label="搜索配置表" value={tableQuery}
          onChange={event => setTableQuery(event.target.value)} placeholder="搜索表名或 key…" /></label>
        <button type="button" className="data-create-table" onClick={() => setShowCreateTable(true)}><Plus size={15} />新建配置表</button>
        <div className="data-directory-list">
          {!!occupied.length && <><div className="data-directory-group">有记录的表 <span>{occupied.length}</span></div>{occupied.map(renderTable)}</>}
          {!!empty.length && <><button type="button" className="data-empty-toggle" disabled={!!tableQuery.trim()} aria-label={emptyVisible ? '收起空表' : '展开空表'} aria-expanded={emptyVisible}
            onClick={() => patchDirectory({ emptyExpanded: !emptyVisible })}>{emptyVisible ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<span>空表</span><small>{empty.length}</small></button>
            {emptyVisible && empty.map(renderTable)}</>}
          {!matching.length && <p className="data-directory-empty">{definitions.length ? '没有匹配的配置表。' : '按项目需要新建配置表。'}</p>}
        </div>
      </div>
      <button type="button" className="data-directory-resize" role="separator" aria-label="调整表目录宽度" aria-orientation="vertical"
        aria-valuemin={180} aria-valuemax={300} aria-valuenow={directory.directoryWidth} title="拖动调整宽度，方向键微调"
        onPointerDown={event => { resizeStart.current = { x: event.clientX, width: directory.directoryWidth }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (resizeStart.current) patchDirectory({ directoryWidth: Math.round(Math.max(180, Math.min(300, resizeStart.current.width + event.clientX - resizeStart.current.x))) }); }}
        onPointerUp={() => { resizeStart.current = null; }} onPointerCancel={() => { resizeStart.current = null; }}
        onKeyDown={event => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); patchDirectory({ directoryWidth: Math.max(180, Math.min(300, directory.directoryWidth + (event.key === 'ArrowRight' ? 10 : -10))) }); }
          if (event.key === 'Home') { event.preventDefault(); patchDirectory({ directoryWidth: 180 }); }
          if (event.key === 'End') { event.preventDefault(); patchDirectory({ directoryWidth: 300 }); }
        }} />
      <div className="data-content">
        <button type="button" ref={directoryTrigger} className="data-directory-trigger" aria-label="打开配置表目录" aria-expanded={narrow ? mobileOpen : !directory.directoryCollapsed}
          onClick={() => { if (narrow) setMobileOpen(!mobileOpen); else patchDirectory({ directoryCollapsed: false }); }}>
          <PanelLeftOpen size={16} /><span>{definition?.label ?? '配置表目录'}</span><ChevronsUpDown size={14} /></button>
        <div className="data-statusbar">
          <span className="data-status-summary">{registry.ready ? <CheckCircle2 size={14} /> : <Database size={14} />}
            {registry.ready ? '稳定枚举已连接' : registry.sourceConfigured ? '枚举待审核' : '引擎未连接 · 可编辑配置'}
            {registry.candidate && <span> · 有待审核更新</span>}</span>
          <div className="data-status-actions"><button type="button" aria-expanded={showStatus} onClick={() => setShowStatus(!showStatus)}
            className={registry.blockingIssues.length && registry.sourceConfigured ? 'data-status-problem' : ''}>
            {registry.blockingIssues.length ? '检查详情 · ' + registry.blockingIssues.length + ' 项待处理' : '检查通过'}{showStatus ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
            <button type="button" onClick={() => void registry.refresh()} disabled={!registry.sourceConfigured || registry.loading || registry.busy}><RefreshCw size={14} />{registry.loading ? '扫描中…' : '扫描更新'}</button></div>
        </div>
        {registry.error && <p className="data-status-error" role="alert">{registry.error}</p>}
        {viewError && <p className="data-view-warning" role="status">表目录偏好未能保存，本次仍可正常使用。</p>}
        {showStatus && <div className="data-status-details">
          <p>{registry.active ? '稳定版本 ' + registry.active.id.slice(0, 10) + ' · ' + registry.scan?.groups.length + ' 组枚举' : '尚无稳定枚举版本'}</p>
          <p>{registry.candidate ? '请到「枚举管理」审核更新；当前配置继续使用稳定版本。' : registry.ready ? '字段和记录自动保存到当前项目。' : !registry.sourceConfigured ? '可以先编写配置，后续在引擎设置中连接工程。' : '请到「枚举管理」审核首次导入。'}</p>
          {registry.blockingIssues.length > 0 && <ul>{registry.blockingIssues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
          <small>{registry.sourceWarning}引擎配置文件生成尚未接入。候选版本不参与当前数据解析。</small>
        </div>}
        {definition ? <DatasetEditor key={activeDataset} {...props} workspaceKey={workspaceKey} definition={definition} docked={width >= 1320} />
          : <div className="data-table-empty"><h3>还没有配置表</h3><p>新建一张配置表，开始整理原型数据。</p><button className="primary" onClick={() => setShowCreateTable(true)}><Plus size={15} />新建配置表</button></div>}
      </div>
    </div>
    {showCreateTable && <DataPanel label="新建配置表" busy={creatingTable} onClose={() => setShowCreateTable(false)}><CreateTableDialog definitions={definitions} onBusyChange={setCreatingTable} onClose={() => setShowCreateTable(false)}
      onCreate={async definition => { const saved = await onCreateTable(definition); if (saved) { setShowCreateTable(false); setTableQuery(''); setMobileOpen(false); patchDirectory({ emptyExpanded: true }); } return saved; }} /></DataPanel>}
  </section>;
}

function DatasetEditor({ workspaceKey, data, onChange, definitions, activeDataset, registry, definition, docked }: Props & { definition: DatasetDef; docked: boolean }) {
  const columns = data.columns[activeDataset] ?? [];
  const rows = data.datasets[activeDataset] ?? [];
  const [view, patchView, viewError] = useViewMemory<DatasetViewState>(() => {
    const tables = readDataViewState(workspaceKey).tables;
    return Object.prototype.hasOwnProperty.call(tables, activeDataset) ? tables[activeDataset] : defaultDatasetViewState();
  },
    next => patchDatasetViewState(workspaceKey, activeDataset, next));
  const searchRequest=useSearchRequest('数据配置');
  useEffect(()=>{if(searchRequest?.kind==='record'&&searchRequest.parent===activeDataset)patchView({query:'',filter:'all',selectedId:searchRequest.id,detailOpen:true,scrollTop:0});},[searchRequest,activeDataset]);
  const [showFields, setShowFields] = useState(false);
  const [savingFields, setSavingFields] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const inspector = useRef<HTMLDivElement>(null);
  const detailTrigger = useRef<HTMLButtonElement>(null);
  const issues = (row: DataRecord) => validateRow(row, columns, data, registry);
  const warnings = rows.filter(row => issues(row).length > 0).length;
  const visible = rows.filter(row => Object.values(row).some(value => value.toLocaleLowerCase().includes(view.query.toLocaleLowerCase())) && (view.filter === 'all' || issues(row).length > 0));
  const selected = visible.find(row => row.id === view.selectedId);
  const detailOpen = view.detailOpen && !!selected;
  useLayoutEffect(() => { if (scroll.current) { scroll.current.scrollTop = view.scrollTop; scroll.current.scrollLeft = view.scrollLeft; } }, []);
  useEffect(() => { if (view.selectedId && !selected) patchView({ selectedId: '', detailOpen: false }); }, [view.selectedId, selected]);
  useEffect(() => { if (detailOpen && !docked) inspector.current?.querySelector<HTMLButtonElement>('.data-inspector-close')?.focus(); }, [detailOpen, docked]);
  const leaveSearch=useLeaveSearch('数据配置');
  const selectRecord=(id:string,detail?:boolean)=>{if(id!==view.selectedId)leaveSearch();patchView({selectedId:id,...(detail===undefined?{}:{detailOpen:detail})});};
  const closeDetail = () => { patchView({ detailOpen: false }); detailTrigger.current?.focus(); };
  const changeRows = (next: DataRecord[]) => onChange({ ...data, datasets: { ...data.datasets, [activeDataset]: next } });
  const updateCell = async (row: DataRecord, column: ColumnDef, value: string) => {
    const saved = await changeRows(rows.map(current => current === row ? { ...current, [column.key]: value } : current));
    if (saved && column.key === 'id') patchView({ selectedId: value });
  };
  const resetFilter = (next: Partial<DatasetViewState>) => { leaveSearch(); patchView({ ...next, selectedId: '', detailOpen: false, scrollTop: 0, scrollLeft: 0 }); scroll.current?.scrollTo(0, 0); };
  const addRow = async () => {
    const id = activeDataset + '_' + crypto.randomUUID().slice(0, 8);
    const row = Object.fromEntries(columns.map(column => [column.key, column.key === 'id' ? id : ''])) as DataRecord;
    if (await changeRows([...rows, row])) {leaveSearch();patchView({ query: '', filter: 'all', selectedId: id, detailOpen: true });}
  };
  function cell(row: DataRecord, column: ColumnDef, detail = false) {
    const value = row[column.key] ?? '';
    const problem = validateCell(column, value, data, registry);
    const attributes = { 'aria-label': (detail ? '详情 ' : '') + row.id + ' · ' + column.label, 'aria-invalid': !!problem, title: problem };
    if (column.type === 'enum') {
      const options = enumOptions(column, registry), unknown = !!value && !options.some(option => option.key === value);
      return <select {...attributes} value={value} disabled={!!column.enumId && !registry.ready} onChange={event => updateCell(row, column, event.target.value)}>
        <option value="">请选择</option>{unknown && <option value={value}>未知成员：{value}</option>}
        {options.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</select>;
    }
    if (column.type === 'reference') {
      const references = column.reference ? data.datasets[column.reference] ?? [] : [];
      return <select {...attributes} value={value} onChange={event => updateCell(row, column, event.target.value)}><option value="">请选择记录</option>
        {value && !references.some(record => record.id === value) && <option value={value}>未知记录：{value}</option>}
        {references.map(record => <option key={record.id} value={record.id}>{record.id}</option>)}</select>;
    }
    return <input {...attributes} value={value} onChange={event => updateCell(row, column, event.target.value)} />;
  }
  return <div className={'data-editor' + (detailOpen ? ' data-inspector-open' : '')} onKeyDown={event => { if (event.key === 'Escape' && detailOpen && !showFields) { event.stopPropagation(); closeDetail(); } }}>
    <div className="data-table-heading"><div className="view-title"><Database size={20} /><h2>{definition.label}</h2></div><div className="data-table-meta"><code>{definition.key}</code><span>{rows.length} 条记录 · {columns.length} 个字段</span></div></div>
    <div className="data-toolbar"><div className="data-tools"><label className="data-search"><Search size={15} /><input aria-label="搜索记录" value={view.query} onChange={event => resetFilter({ query: event.target.value })} placeholder="搜索当前表记录…" /></label>
      <select aria-label="记录状态筛选" value={view.filter} onChange={event => resetFilter({ filter: event.target.value as DatasetViewState['filter'] })}><option value="all">全部状态</option><option value="warning">仅看问题</option></select></div>
      <div className="data-tools"><button type="button" ref={detailTrigger} aria-pressed={detailOpen} disabled={!visible.length} onClick={() => { if (detailOpen) closeDetail(); else selectRecord(selected?.id ?? visible[0].id,true); }}><PanelRight size={15} />记录详情</button>
        <button type="button" onClick={() => setShowFields(true)}><SlidersHorizontal size={15} />字段</button><button type="button" className="primary" onClick={addRow}><Plus size={15} />新增记录</button></div></div>
    {viewError && <p className="data-view-warning" role="status">浏览位置未能保存，本次筛选和编辑仍可继续。</p>}
    <div className="data-layout"><div className="data-grid" inert={detailOpen && !docked}>
      <div className="data-table-wrap" ref={scroll} onScroll={event => patchView({ scrollTop: event.currentTarget.scrollTop, scrollLeft: event.currentTarget.scrollLeft })}>
        <table className="data-table" aria-label={definition.label + ' 配置记录'}><thead><tr><th className="data-status-column" scope="col">状态</th>
          {columns.map(column => <th scope="col" key={column.key} className={column.key === 'id' ? 'data-id-column' : undefined}>{column.label}{column.enumId && <small className="column-binding" title={column.enumId}>{findEnum(column, registry)?.name ?? column.enumName ?? '枚举失效'}</small>}</th>)}<th scope="col" className="data-row-actions">操作</th></tr></thead>
          <tbody>{visible.map(row => <tr key={row.id} className={row.id === selected?.id ? 'selected' : ''} onClick={() => selectRecord(row.id)}>
            <td className="data-status-column" title={issues(row).map(issue => issue.column.label + '：' + issue.message).join('\n')}>{issues(row).length ? <AlertTriangle size={16} aria-label="需要修正" /> : <CheckCircle2 size={16} aria-label="检查通过" />}</td>
            {columns.map(column => <td key={column.key} className={column.key === 'id' ? 'data-id-column' : undefined}>{cell(row, column)}</td>)}
            <td className="data-row-actions"><div><button type="button" aria-label={'查看 ' + row.id + ' 的详情'} title="记录详情" onClick={event => { event.stopPropagation(); selectRecord(row.id,true); }}><PanelRight size={15} /></button>
              <button type="button" aria-label={'删除记录 ' + row.id} title="删除记录" onClick={event => { event.stopPropagation(); if (selected?.id === row.id) patchView({ selectedId: '', detailOpen: false }); changeRows(rows.filter(current => current !== row)); }}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table>
        {!visible.length && <div className="data-table-empty"><h3>{rows.length ? '没有匹配的记录' : '这张表还没有记录'}</h3><p>{rows.length ? '调整搜索内容或状态筛选，查看其他记录。' : '先定义字段，再添加这个原型需要的数据。'}</p>{rows.length > 0 && <button type="button" onClick={() => resetFilter({ query: '', filter: 'all' })}>清除筛选</button>}</div>}
      </div><div className="table-foot"><span>显示 {visible.length} / {rows.length} 条记录</span><button type="button" className={warnings ? 'data-status-problem' : ''} onClick={() => resetFilter({ filter: warnings ? 'warning' : 'all' })}>{warnings ? warnings + ' 条记录需要修正' : '字段与引用检查通过'}</button></div>
    </div>
      {detailOpen && selected && <>{!docked && <button type="button" className="data-inspector-backdrop" aria-label="关闭记录详情遮罩" onClick={closeDetail} />}
        <div ref={inspector} className="data-inspector" role="region" aria-label="记录详情"><div className="inspector-heading data-inspector-heading"><div><span>记录详情</span><h3>{selected.name || selected.itemID || selected.id}</h3></div><button type="button" className="data-inspector-close" aria-label="关闭记录详情" onClick={closeDetail}><X size={18} /></button></div>
          <div className="inspector-fields">{columns.map(column => {
            const value = resolveEnumValue(column, selected[column.key], registry), problem = validateCell(column, selected[column.key], data, registry), group = findEnum(column, registry);
            return <label key={column.key}>{column.label}{cell(selected, column, true)}{column.enumId && <small className="enum-resolution">{group?.name ?? column.enumName ?? column.enumId}{value !== undefined && <><br />引擎值：<code>{formatLuaValue(value)}</code> · {typeof value}</>}{group && <><br />{group.source}:{group.line}</>}</small>}{problem && <small className="field-error">{problem}</small>}</label>;
          })}</div><div className="validation">{issues(selected).length ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}<div><b>记录检查</b><p>{issues(selected).length ? '请修正上方标记的字段，未知值会保留，直到你重新选择。' : '当前记录通过字段、枚举与引用检查。'}</p></div></div>
        </div></>}
    </div>
    {showFields && <DataPanel label="字段定义" busy={savingFields} onClose={() => setShowFields(false)}><FieldManager onBusyChange={setSavingFields} columns={columns} definitions={definitions} registry={registry} onClose={() => setShowFields(false)} onApply={async next => { const saved = await onChange({ ...data, columns: { ...data.columns, [activeDataset]: next } }); if (saved) setShowFields(false); return saved; }} /></DataPanel>}
  </div>;
}

function DataPanel({ label, busy = false, onClose, children }: { label: string; busy?: boolean; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  return <dialog ref={dialog} className="data-panel-dialog" aria-label={label} aria-busy={busy} onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }} onClick={event => { if (!busy && event.target === event.currentTarget) onClose(); }}>{children}</dialog>;
}

function CreateTableDialog({ definitions, onBusyChange, onClose, onCreate }: { definitions: DatasetDef[]; onBusyChange: (busy: boolean) => void; onClose: () => void; onCreate: (definition: DatasetDef) => Promise<boolean> }) {
  const [key, setKey] = useState(''), [label, setLabel] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const submit = async () => {
    const normalized = key.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) { setError('表 key 需使用字母、数字、下划线，且不能以数字开头。'); return; }
    if (!label.trim()) { setError('请输入表名称。'); return; }
    if (definitions.some(item => item.key === normalized)) { setError('表 key 已存在，请使用不同的 key。现有配置表不会被覆盖。'); return; }
    setBusy(true); onBusyChange(true); setError('');
    try { if (!await onCreate({ key: normalized, label: label.trim(), badge: '0', columns: [{ key: 'id', label: 'ID', type: 'text' }] })) setError('配置表未能保存，请检查保存状态后重试。'); }
    catch (reason) { setError('创建失败：' + String(reason)); }
    finally { setBusy(false); onBusyChange(false); }
  };
  return <form className="field-manager create-table-dialog" onSubmit={event => { event.preventDefault(); if (!busy) void submit(); }}>
    <div className="field-manager-head"><div><span>NEW DATASET</span><h3>新建配置表</h3></div><button type="button" disabled={busy} onClick={onClose}>关闭</button></div>
    <label>表名称<input disabled={busy} value={label} onChange={event => setLabel(event.target.value)} placeholder="例如：任务配置" required autoFocus /></label>
    <label>表 key<input disabled={busy} value={key} onChange={event => setKey(event.target.value)} placeholder="例如：quests" required /></label>
    {error && <p className="field-error" role="alert">{error}</p>}<div className="field-manager-foot"><small>创建后可添加字段、绑定枚举或配置跨表引用。</small><button type="submit" className="primary" disabled={busy}><Plus size={14} />{busy ? '正在创建…' : '创建配置表'}</button></div>
  </form>;
}
function FieldManager({ columns, definitions, registry, onApply, onClose, onBusyChange }: {
  columns: ColumnDef[]; definitions: DatasetDef[]; registry: EnumRegistry;
  onApply: (columns: ColumnDef[]) => Promise<boolean>; onClose: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const [draft, setDraft] = useState(columns);
  const [saving, setSaving] = useState(false);
  const apply = async () => { if (bindingErrors.length || referenceErrors.length) return; setSaving(true); onBusyChange(true); setError(''); try { if (!await onApply(draft)) setError('字段定义未能保存，请重试。'); } finally { setSaving(false); onBusyChange(false); } };
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
  const referenceErrors = draft.filter(column => column.type === 'reference' && !definitions.some(item => item.key === column.reference));
  return <div className="field-manager"><fieldset disabled={saving} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
    <div className="field-manager-head"><div><span>SCHEMA EDITOR</span><h3>字段定义</h3></div><button onClick={onClose}>关闭</button></div>
    <p className="field-hint">仅可绑定稳定版本中的枚举，选项在审核发布后更新。已有记录保留原成员名，不匹配的值会显示校验提示。</p>
    <div className="field-list">{draft.map((column, index) => <div className="field-row binding-row" key={column.key}>
      <input aria-label={column.key + ' 字段名称'} value={column.label} onChange={(event) => update(index, { label: event.target.value })} />
      <code>{column.key}</code>
      <select aria-label={column.key + ' 字段类型'} disabled={column.key === 'id'} value={column.type ?? 'text'} onChange={(event) =>
        update(index, { type: event.target.value as ColumnDef['type'], enumId: undefined, enumName: undefined, options: undefined,
          reference: event.target.value === 'reference' ? definitions[0]?.key ?? '' : undefined })}>
        <option value="text">文本</option><option value="enum">枚举</option><option value="reference">跨表引用</option></select>
      {column.type === 'enum' && <div className="enum-binding">
        <select aria-label={column.key + ' 绑定枚举'} disabled={!registry.ready} value={column.enumId ?? ''} onChange={(event) => {
          const group = registry.scan?.groups.find((item) => enumId(item) === event.target.value);
          update(index, { enumId: group ? enumId(group) : undefined, enumName: group?.name, options: undefined });
        }}>
          <option value="" disabled>{column.options?.length ? '现有选项（未绑定枚举）' : '请选择引擎枚举'}</option>
          {column.enumId && !findEnum(column, registry) && <option value={column.enumId}>定义缺失：{column.enumName ?? column.enumId}</option>}
          {registry.scan?.groups.map((group) => <option key={enumId(group)} value={enumId(group)}>
            {group.name} · {group.valueType} · {group.members.length} 项
          </option>)}
        </select>
        <small>{column.enumId ? findEnum(column, registry)?.source ?? '定义已失效，请重新绑定。' :
          column.options?.join('、') || '成员从代码工程导入'}</small>
      </div>}
      {column.type === 'reference' && <select aria-label={column.key + ' 引用表'} value={column.reference ?? ''}
        onChange={(event) => update(index, { reference: event.target.value as DatasetKey })}>
        <option value="" disabled>请选择引用表</option>
        {column.reference && !definitions.some(item => item.key === column.reference) && <option value={column.reference}>引用表已失效：{column.reference}</option>}
        {definitions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>}
    </div>)}</div>
    <div className="field-add"><input aria-label="新字段 key" value={newKey} onChange={(event) => setNewKey(event.target.value)} placeholder="新字段 key，例如 modeID" />
      <button onClick={add}><Plus size={14} />添加字段</button></div>
    {error && <p className="field-error">{error}</p>}
    <div className="field-manager-foot"><small>{[
      bindingErrors.length ? '有 ' + bindingErrors.length + ' 个枚举字段需要绑定有效定义' : '',
      referenceErrors.length ? '有 ' + referenceErrors.length + ' 个引用字段需要选择有效配置表' : '',
    ].filter(Boolean).join('；') || '应用后自动保存到当前项目，重新打开后保留。'}</small>
      <button className="primary" disabled={saving || !!bindingErrors.length || !!referenceErrors.length} onClick={() => void apply()}>{saving ? '正在保存…' : '应用定义'}</button></div>
  </fieldset></div>;
}
