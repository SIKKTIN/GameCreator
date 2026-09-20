import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Archive, ArrowRight, Boxes, ChevronDown, ChevronRight, Link2, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { GameplayGraph } from './GameplayGraph';
import { createFunctionalSystem, createCapability, removeFunctionalSystem, removeCapability, functionalIssues, configReferenceText, usageSourceText, capabilityStatuses, dependencyKinds, type FunctionalStore, type FunctionalSources, type Capability, type FunctionalUsage, type ConfigReference } from './functional-systems';
import type { FunctionalController } from './useFunctionalSystems';
import './gameplay.css';
import './gameplay-structure.css';
import './functional-systems.css';
import { readFunctionalView, patchFunctionalExpansion } from './functional-view-state';

export type FunctionalSelection = { kind: 'system' | 'capability'; id: string } | null;
type Props = { workspaceId: string; controller: FunctionalController; sources: FunctionalSources; selected: FunctionalSelection; onSelect: (selection: FunctionalSelection) => void; onOpenGameplay: (id: string, sourceKind?: string, sourceId?: string) => void; onOpenDataset: (key: string) => void; renderArtReferences?: (capability: Capability) => ReactNode };
type Tab = 'details' | 'dependencies' | 'usages';
type Mutate = FunctionalController['update'];
const now = () => new Date().toISOString();
const archivedCapability = (store: FunctionalStore, cap: Capability) => cap.archived || !!store.systems.find(s => s.id === cap.systemId)?.archived;
const activeCapability = (store: FunctionalStore, cap: Capability) => !archivedCapability(store, cap) && store.systems.some(s => s.id === cap.systemId);
const capName = (store: FunctionalStore, id: string) => store.capabilities.find(c => c.id === id)?.name || '功能已失效';
const systemName = (store: FunctionalStore, id: string) => store.systems.find(s => s.id === id)?.name || '系统已失效';
const keyOfSource = (kind: string, id: string) => JSON.stringify([kind, id]);
function sourceOptions(sources: FunctionalSources, gameplayId: string) {
  const design = sources.designs.find(d => d.id === gameplayId);
  return [{ kind: 'design' as const, id: '', name: '整份玩法设计' },
    ...(design?.conditionRules ?? []).map(r => ({ kind: 'rule' as const, id: r.id, name: '条件规则 · ' + (r.name || '未命名规则') })),
    ...(design?.stateFlow.states ?? []).map(s => ({ kind: 'state' as const, id: s.id, name: '状态 · ' + (s.name || '未命名状态') })),
    ...(design?.timeline.events ?? []).map(e => ({ kind: 'event' as const, id: e.id, name: '时间事件 · ' + (e.name || '未命名事件') }))];
}
function Notice({ children }: { children: ReactNode }) { return <p className="fs-notice" role="status">{children}</p>; }
function Empty({ children }: { children: ReactNode }) { return <p className="gp-placeholder">{children}</p>; }
function IssueList({ store, sources }: { store: FunctionalStore; sources: FunctionalSources }) {
  const items = functionalIssues(store, sources);
  return items.length ? <details className="fs-issues"><summary>引用与依赖检查 · {items.length} 项</summary><ul>{items.map((text, i) => <li key={i}>{text}</li>)}</ul></details> : null;
}
function TextField({ label, ariaLabel, value, onChange, disabled, rows = 3, placeholder }: { label: string; ariaLabel?: string; value: string; onChange: (value: string) => void; disabled?: boolean; rows?: number; placeholder?: string }) {
  return <label className="gp-field">{label}<textarea aria-label={ariaLabel || label} rows={rows} value={value} disabled={disabled} placeholder={placeholder} onChange={e => onChange(e.target.value)} /></label>;
}

export function FunctionalSystems({ workspaceId, controller, sources, selected, onSelect, onOpenGameplay, onOpenDataset, renderArtReferences }: Props) {
  const { store, blocked, update } = controller;
  const [collapsed, setCollapsed] = useState(() => new Set(readFunctionalView(workspaceId).collapsedIds));
  const [viewError, setViewError] = useState('');
  const [query, setQuery] = useState(''), [range, setRange] = useState('active'), [status, setStatus] = useState('all');
  const [tab, setTab] = useState<Tab>('details'), [newKind, setNewKind] = useState<'system' | 'capability'>('system'), [newName, setNewName] = useState(''), [newSystem, setNewSystem] = useState(''), [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const selectedSystem = selected?.kind === 'system' ? store.systems.find(s => s.id === selected.id) : undefined;
  const selectedCap = selected?.kind === 'capability' ? store.capabilities.find(c => c.id === selected.id) : undefined;
  const owningSystem = selectedSystem ?? store.systems.find(s => s.id === selectedCap?.systemId);
  const effective = selectedSystem || selectedCap;
  const archived = !!(effective?.archived || owningSystem?.archived);
  const disabled = blocked || archived;
  const activeSystems = store.systems.filter(s => !s.archived);
  const q = query.trim().toLocaleLowerCase();
  const matchesRange = (isArchived: boolean) => range === 'all' || (range === 'archived' ? isArchived : !isArchived);
  const groups = store.systems.map(system => {
    const matchSystem = (system.name + ' ' + system.purpose).toLocaleLowerCase().includes(q);
    const capabilities = store.capabilities.filter(c => c.systemId === system.id && matchesRange(c.archived || system.archived) && (status === 'all' || c.status === status) && (matchSystem || (c.name + ' ' + c.purpose).toLocaleLowerCase().includes(q)));
    return { system, capabilities, visible: capabilities.length > 0 || (matchesRange(system.archived) && matchSystem && status === 'all') };
  }).filter(g => g.visible);
  const orphanCapabilities = store.capabilities.filter(c => !store.systems.some(s => s.id === c.systemId) && matchesRange(c.archived) && (status === 'all' || c.status === status) && (c.name + ' ' + c.purpose).toLocaleLowerCase().includes(q));
  const filtering = !!q || status !== 'all';
  const expandableIds = groups.filter(g => g.capabilities.length).map(g => g.system.id);
  const setExpanded = (ids: string[], expanded: boolean) => {
    setCollapsed(previous => { const next = new Set(previous); for (const id of ids) { if (expanded) next.delete(id); else next.add(id); } return next; });
    const saved = patchFunctionalExpansion(workspaceId, ids, expanded);
    setViewError(saved ? '' : '折叠状态未能保存，当前窗口仍可继续使用。');
  };
  // Reveal incoming links and moved functions; manually collapsing the current group stays allowed.
  useEffect(() => {
    if (!selectedCap) return;
    if (collapsed.has(selectedCap.systemId)) setExpanded([selectedCap.systemId], true);
    const visible = groups.some(g => g.capabilities.some(c => c.id === selectedCap.id)) || orphanCapabilities.some(c => c.id === selectedCap.id);
    if (!visible) { setQuery(''); setStatus('all'); setRange(archivedCapability(store, selectedCap) ? 'archived' : 'active'); }
  }, [selected, selectedCap?.systemId]);
  const navigate = (value: FunctionalSelection) => {
    setError('');
    if (value) {
      const visible = value.kind === 'system' ? groups.some(g => g.system.id === value.id) : groups.some(g => g.capabilities.some(c => c.id === value.id)) || orphanCapabilities.some(c => c.id === value.id);
      if (!visible) {
        setQuery(''); setStatus('all');
        const target = value.kind === 'system' ? store.systems.find(s => s.id === value.id) : store.capabilities.find(c => c.id === value.id);
        const isArchived = target && (value.kind === 'system' ? target.archived : archivedCapability(store, target as Capability));
        setRange(isArchived ? 'archived' : 'active');
      }
    }
    onSelect(value);
  };
  const openCreate = (kind: 'system' | 'capability') => { setNewKind(kind); setNewName(''); setNewSystem(owningSystem && !owningSystem.archived ? owningSystem.id : activeSystems[0]?.id || ''); setError(''); dialog.current?.showModal(); input.current?.focus(); };
  const create = (event: FormEvent) => {
    event.preventDefault(); if (blocked) return;
    try {
      if (newKind === 'system') { const s = createFunctionalSystem(newName); update(current => ({ ...current, systems: [...current.systems, s] })); navigate({ kind: 'system', id: s.id }); }
      else { if (!activeSystems.some(s => s.id === newSystem)) throw new Error('请选择有效系统'); const c = createCapability(newSystem, newName); update(current => ({ ...current, capabilities: [...current.capabilities, c] })); navigate({ kind: 'capability', id: c.id }); }
      setQuery(''); setRange('active'); setStatus('all'); setTab('details'); dialog.current?.close();
    } catch (e) { setError(String(e)); }
  };
  const patchSystem = (changes: Record<string, unknown>) => selectedSystem && update(current => ({ ...current, systems: current.systems.map(s => s.id === selectedSystem.id ? { ...s, ...changes, updatedAt: now() } : s) }));
  const patchCap = (changes: Partial<Capability>) => selectedCap && update(current => ({ ...current, capabilities: current.capabilities.map(c => c.id === selectedCap.id ? { ...c, ...changes, updatedAt: now() } : c) }));
  const remove = () => { if (!effective || !selected || blocked || archived) return; try { const next = selected.kind === 'system' ? removeFunctionalSystem(store, selected.id) : removeCapability(store, selected.id); update(() => next); navigate(null); } catch (e) { setError(String(e)); } };
  return <section className="gp-workspace fs-workspace" aria-label="功能系统工作区">
    <div className="gp-library fs-library"><div className="gp-library-heading"><div><span className="gp-kicker">FUNCTIONAL SYSTEMS</span><h2>系统目录 <small>{activeSystems.length}</small></h2></div><Boxes size={20} /></div>
      <div className="fs-create-actions"><button className="gp-secondary" disabled={blocked} onClick={() => openCreate('system')}><Plus size={14} />新建系统</button><button className="gp-secondary" disabled={blocked || !activeSystems.length} title={!activeSystems.length ? '先创建一个系统' : undefined} onClick={() => openCreate('capability')}><Plus size={14} />新建功能</button></div>
      <label className="gp-search"><Search size={16} /><input aria-label="搜索系统或功能" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索名称或用途…" /></label>
      <div className="gp-filters"><label>显示范围<select aria-label="功能系统范围" value={range} onChange={e => setRange(e.target.value)}><option value="active">有效条目</option><option value="archived">已归档</option><option value="all">全部条目</option></select></label><label>实现状态<select aria-label="实现状态筛选" value={status} onChange={e => setStatus(e.target.value)}><option value="all">全部状态</option>{capabilityStatuses.map(s => <option key={s}>{s}</option>)}</select></label></div>
      <div className="fs-tree-controls"><button disabled={filtering || !expandableIds.some(id => collapsed.has(id))} onClick={() => setExpanded(expandableIds, true)}>全部展开</button><button disabled={filtering || !expandableIds.some(id => !collapsed.has(id))} onClick={() => setExpanded(expandableIds, false)}>全部收起</button>{filtering && <small>筛选时自动展开</small>}</div>
      {viewError && <p className="fs-view-note" role="status">{viewError}</p>}
      <div className="fs-tree" role="navigation" aria-label="系统与功能目录">{groups.map(({ system, capabilities }) => {
        const expanded = filtering || !collapsed.has(system.id), containsSelected = selectedCap?.systemId === system.id;
        const childrenId = 'fs-children-' + system.id;
        return <div className="fs-tree-group" key={system.id}>
          <div className={'fs-tree-system-row' + (selectedSystem?.id === system.id ? ' selected' : '') + (!expanded && containsSelected ? ' contains-selected' : '')}>
            <button className="fs-tree-toggle" aria-label={(expanded ? '收起系统：' : '展开系统：') + system.name} aria-expanded={expanded} aria-controls={childrenId} disabled={filtering || !capabilities.length} title={filtering ? '筛选时自动展开匹配功能' : !capabilities.length ? '系统暂无功能' : expanded ? '收起所属功能' : '展开所属功能'} onClick={() => setExpanded([system.id], !expanded)}>{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>
            <button className="fs-tree-system" aria-label={'打开系统：' + system.name} aria-pressed={selectedSystem?.id === system.id} onClick={() => navigate({ kind: 'system', id: system.id })}><Boxes size={15} /><strong>{system.name || '未命名系统'}</strong><small>{system.archived ? '归档' : capabilities.length}</small></button>
          </div>
          <div id={childrenId} hidden={!expanded}>{capabilities.map(c => <button key={c.id} className={'fs-tree-capability' + (selectedCap?.id === c.id ? ' selected' : '')} aria-label={'打开功能：' + c.name} aria-pressed={selectedCap?.id === c.id} onClick={() => navigate({ kind: 'capability', id: c.id })}><span>{c.name || '未命名功能'}</span><small className={c.status === '已完成' ? 'complete' : ''}>{c.archived || system.archived ? '归档' : c.status}</small></button>)}</div>
        </div>;
      })}{orphanCapabilities.length > 0 && <div className="fs-tree-group fs-orphan-group" role="group" aria-label="所属系统已失效"><div className="fs-tree-system"><Boxes size={15} /><strong>所属系统已失效</strong><small>{orphanCapabilities.length}</small></div>{orphanCapabilities.map(c => <button key={c.id} className={'fs-tree-capability' + (selectedCap?.id === c.id ? ' selected' : '')} aria-label={'打开功能：' + c.name} aria-pressed={selectedCap?.id === c.id} onClick={() => navigate({ kind: 'capability', id: c.id })}><span>{c.name || '未命名功能'}</span><small>{c.archived ? '归档' : c.status}</small></button>)}</div>}</div>{!groups.length && !orphanCapabilities.length && <p className="gp-muted gp-list-empty">{store.systems.length ? '没有匹配的系统或功能。' : '先定义系统职责，再逐步拆分可复用的功能。'}</p>}
    </div>
    <div className="gp-detail fs-detail">

      {error && !dialog.current?.open && <p className="fs-notice" role="alert">{error}</p>}
      {blocked && <Notice>功能系统存档暂时无法读取，已停止写入。请恢复存档后重新打开项目。</Notice>}
      <IssueList store={store} sources={sources} />
      {effective && selected ? <>
        <div className="gp-editor-heading"><div><span className="gp-kicker">{selectedCap ? systemName(store, selectedCap.systemId) + ' / CAPABILITY' : 'SYSTEM'}</span><h2>{effective.name || '未命名'}</h2><p className="gp-muted">{selectedCap ? '一份功能定义，连接多个玩法场景。' : '定义职责、边界与可复用的功能。'}</p></div><div className="gp-actions">
          {selectedSystem && <button className="gp-secondary" disabled={disabled} onClick={() => openCreate('capability')}><Plus size={14} />添加功能</button>}
          <button className="gp-secondary" disabled={blocked || !!(selectedCap && owningSystem?.archived)} onClick={() => { if (selectedSystem) patchSystem({ archived: !selectedSystem.archived }); else if (selectedCap) patchCap({ archived: !selectedCap.archived }); }}>
            {effective.archived ? <RotateCcw size={14} /> : <Archive size={14} />}{effective.archived ? '恢复' : '归档'}{selectedCap ? '功能' : '系统'}</button>
          <button className="gp-icon" aria-label={selectedCap ? '删除功能' : '删除系统'} disabled={disabled} onClick={remove}><Trash2 size={15} /></button>
        </div></div>
        {selectedCap && !owningSystem && <Notice>所属系统已失效。请在功能说明中重新选择所属系统，功能内容和现有引用均会保留。</Notice>}
        {archived && <Notice>{selectedCap && owningSystem?.archived ? '所属系统已归档，请先恢复系统。' : '此条目已归档，恢复后可继续编辑。'} 现有引用仍然保留，可继续查看和跳转。</Notice>}
        <div className="gp-structure-tabs" role="tablist" aria-label="功能系统分页">{([['details', selectedCap ? '功能说明' : '系统说明'], ['dependencies', '依赖关系'], ['usages', '关联玩法']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} aria-controls={'fs-panel-' + id} id={'fs-tab-' + id} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={e => { const tabs: Tab[] = ['details', 'dependencies', 'usages']; const i = tabs.indexOf(tab); const next = e.key === 'ArrowRight' ? tabs[(i + 1) % 3] : e.key === 'ArrowLeft' ? tabs[(i + 2) % 3] : e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[2] : null; if (next) { e.preventDefault(); setTab(next); document.getElementById('fs-tab-' + next)?.focus(); } }}>{label}</button>)}</div>
        <div role="tabpanel" className="fs-panel" id={'fs-panel-' + tab} aria-labelledby={'fs-tab-' + tab}>
          {tab === 'details' && selectedSystem && <><section className="gp-card"><h3>系统职责</h3><fieldset className="fs-fields" disabled={disabled}><label className="gp-field">系统名称<input aria-label="系统名称" value={selectedSystem.name} onChange={e => patchSystem({ name: e.target.value })} /></label><TextField label="系统职责" value={selectedSystem.purpose} onChange={purpose => patchSystem({ purpose })} placeholder="这个系统负责解决什么问题？" /><TextField label="职责边界" value={selectedSystem.boundary} onChange={boundary => patchSystem({ boundary })} placeholder="系统负责什么，以及哪些职责交给其他系统？" /></fieldset></section><section className="gp-card"><div className="gp-card-heading"><h3>所属功能</h3><span className="gp-muted">{store.capabilities.filter(c => c.systemId === selectedSystem.id).length} 个</span></div><CapabilityCards capabilities={store.capabilities.filter(c => c.systemId === selectedSystem.id)} onSelect={id => navigate({ kind: 'capability', id })} /></section></>}
          {tab === 'details' && selectedCap && <>{renderArtReferences?.(selectedCap)}<section className="gp-card"><div className="gp-card-heading"><h3>功能定义</h3><span className="gp-muted">实现状态独立于玩法验证</span></div><fieldset className="fs-fields" disabled={disabled}><div className="gp-two-fields"><label className="gp-field">功能名称<input aria-label="功能名称" value={selectedCap.name} onChange={e => patchCap({ name: e.target.value })} /></label><label className="gp-field">实现状态<select aria-label="功能实现状态" value={selectedCap.status} onChange={e => patchCap({ status: e.target.value as Capability['status'] })}>{capabilityStatuses.map(s => <option key={s}>{s}</option>)}</select></label></div><label className="gp-field">所属系统<select aria-label="功能所属系统" value={selectedCap.systemId} onChange={e => patchCap({ systemId: e.target.value })}>{!owningSystem && <option value={selectedCap.systemId} disabled>所属系统已失效（请选择系统）</option>}{store.systems.filter(s => !s.archived || s.id === selectedCap.systemId).map(s => <option key={s.id} value={s.id}>{s.name}{s.archived ? '（已归档）' : ''}</option>)}</select></label>
            {([['purpose', '功能用途', '描述它提供的通用能力。'], ['input', '触发与输入', '谁发起请求？需要传入什么？'], ['conditions', '执行条件', '什么情况下允许执行？'], ['process', '处理流程', '按顺序描述执行、结束与状态更新。'], ['output', '结果与输出', '返回什么结果？产生哪些事件或状态变化？'], ['failure', '打断与失败处理', '失败如何返回？中途打断如何收尾？'], ['state', '关键状态', '需要保存或维护哪些状态？'], ['acceptance', '实现验收', '程序实现后，怎样确认功能符合要求？']] as const).map(([key, label, placeholder]) => <TextField key={key} label={label} value={selectedCap[key]} onChange={value => patchCap({ [key]: value })} placeholder={placeholder} />)}</fieldset></section>
            <ConfigReferences key={selectedCap.id} capability={selectedCap} sources={sources} disabled={disabled} onChange={configRefs => patchCap({ configRefs })} onOpenDataset={onOpenDataset} /></>}
          {tab === 'dependencies' && <Dependencies key={selected.id} store={store} sources={sources} selection={selected} disabled={disabled} update={update} onSelect={navigate} onOpenGameplay={onOpenGameplay} />}
          {tab === 'usages' && selectedCap && <UsageSection key={selectedCap.id} controller={controller} sources={sources} capabilityId={selectedCap.id} disabled={disabled} onOpenCapability={id => navigate({ kind: 'capability', id })} onOpenGameplay={onOpenGameplay} />}
          {tab === 'usages' && selectedSystem && <section className="gp-card"><h3>系统支持的玩法</h3><p className="gp-muted">汇总本系统功能的需求来源。进入功能可编辑关联。</p><UsageSummary store={store} sources={sources} usages={store.usages.filter(u => store.capabilities.some(c => c.id === u.capabilityId && c.systemId === selectedSystem.id))} onOpenGameplay={onOpenGameplay} onOpenCapability={id => navigate({ kind: 'capability', id })} /></section>}
        </div>
      </> : <div className="gp-empty"><Boxes size={36} /><span className="gp-kicker">从玩法需求到程序实现</span><h2>{store.systems.length ? '选择一个系统或功能' : '建立第一个功能系统'}</h2><p>让多个玩法引用同一份功能定义，把输入、处理、输出与依赖关系放在一起。</p><div className="gp-empty-flow"><span>系统职责</span><ArrowRight size={15} /><span>功能定义</span><ArrowRight size={15} /><span>玩法引用</span></div><button className="primary" disabled={blocked} onClick={() => openCreate('system')}><Plus size={16} />{store.systems.length ? '创建系统' : '创建第一个系统'}</button></div>}
    </div>
    <dialog className="gp-dialog" ref={dialog} aria-labelledby="fs-new-title"><form onSubmit={create}><div className="gp-card-heading"><div><span className="gp-kicker">NEW {newKind === 'system' ? 'SYSTEM' : 'CAPABILITY'}</span><h2 id="fs-new-title">新建{newKind === 'system' ? '系统' : '功能'}</h2></div><button type="button" className="gp-icon" aria-label="关闭新建功能系统条目" onClick={() => dialog.current?.close()}><X size={18} /></button></div><p className="gp-muted">只需要填写名称，详细内容可以逐步补充。</p>
      {newKind === 'capability' && <label className="gp-field">所属系统<select aria-label="新功能所属系统" value={newSystem} onChange={e => setNewSystem(e.target.value)}>{activeSystems.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
      <label className="gp-field">{newKind === 'system' ? '系统' : '功能'}名称<input ref={input} aria-label={newKind === 'system' ? '新系统名称' : '新功能名称'} required value={newName} onChange={e => setNewName(e.target.value)} /></label>{error && <p className="field-error" role="alert">{error}</p>}<div className="gp-dialog-actions"><button type="button" className="gp-secondary" onClick={() => dialog.current?.close()}>取消</button><button className="primary" type="submit" disabled={blocked}>创建{newKind === 'system' ? '系统' : '功能'}</button></div></form></dialog>
  </section>;
}

function CapabilityCards({ capabilities, onSelect }: { capabilities: Capability[]; onSelect: (id: string) => void }) {
  return capabilities.length ? <div className="fs-capability-cards">{capabilities.map(c => <button key={c.id} className="fs-capability-card" onClick={() => onSelect(c.id)} aria-label={'查看功能：' + c.name}><div><strong>{c.name || '未命名功能'}</strong><span className="gp-badge">{c.archived ? '已归档' : c.status}</span></div><p>{c.purpose || '功能用途待补充'}</p><ChevronRight size={15} /></button>)}</div> : <Empty>尚未添加功能。可以先写下系统职责，再拆分具体能力。</Empty>;
}
function ConfigReferences({ capability, sources, disabled, onChange, onOpenDataset }: { capability: Capability; sources: FunctionalSources; disabled: boolean; onChange: (refs: ConfigReference[]) => void; onOpenDataset: (key: string) => void }) {
  const [table, setTable] = useState(''), [row, setRow] = useState(''), [column, setColumn] = useState(''), [note, setNote] = useState(''), [error, setError] = useState('');
  const add = () => { if (disabled || !table) return; if (capability.configRefs.some(r => r.datasetKey === table && r.rowId === row && r.columnKey === column)) { setError('此配置已经关联，可直接补充其用途。'); return; } onChange([...capability.configRefs, { id: crypto.randomUUID(), datasetKey: table, rowId: row, columnKey: column, note }]); setNote(''); setError(''); };
  return <section className="gp-card fs-config"><div className="gp-card-heading"><div><h3>关联配置</h3><p className="gp-muted">引用配置的当前位置和当前值，参数在数据配置中统一维护。</p></div><Link2 size={18} /></div>
    {capability.configRefs.length ? <div className="fs-reference-list">{capability.configRefs.map(ref => <article key={ref.id} className="fs-reference"><div className="fs-reference-heading"><button className="gp-link-name" disabled={!sources.definitions.some(t => t.key === ref.datasetKey)} onClick={() => onOpenDataset(ref.datasetKey)}>{sources.definitions.find(t => t.key === ref.datasetKey)?.label || '配置表已失效：' + ref.datasetKey}<ArrowRight size={13} /></button><button className="gp-icon" aria-label={'移除配置引用：' + ref.datasetKey + (ref.rowId ? ' / ' + ref.rowId : '') + (ref.columnKey ? ' / ' + ref.columnKey : '')} disabled={disabled} onClick={() => onChange(capability.configRefs.filter(r => r.id !== ref.id))}><Trash2 size={14} /></button></div><output className="fs-current-value" aria-label={'配置当前值：' + ref.id}>{configReferenceText(ref, sources)}</output><label className="gp-field">配置用途<input aria-label={'配置用途：' + ref.id} disabled={disabled} value={ref.note} onChange={e => onChange(capability.configRefs.map(r => r.id === ref.id ? { ...r, note: e.target.value } : r))} placeholder="此功能如何使用这份配置？" /></label></article>)}</div> : <Empty>尚未关联配置。</Empty>}
    <fieldset className="fs-fields fs-add-box" disabled={disabled}><div className="fs-three-fields"><label className="gp-field">配置表<select aria-label="引用配置表" value={table} onChange={e => { setTable(e.target.value); setRow(''); setColumn(''); setError(''); }}><option value="">选择配置表</option>{sources.definitions.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}</select></label><label className="gp-field">记录（可选）<select aria-label="引用配置记录" value={row} disabled={!table || disabled} onChange={e => setRow(e.target.value)}><option value="">整张表</option>{(sources.data.datasets[table] ?? []).map(r => <option key={r.id} value={r.id}>{r.id}</option>)}</select></label><label className="gp-field">字段（可选）<select aria-label="引用配置字段" value={column} disabled={!table || disabled} onChange={e => setColumn(e.target.value)}><option value="">所有字段</option>{(sources.data.columns[table] ?? []).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label></div><label className="gp-field">用途说明<input aria-label="新配置引用用途" value={note} onChange={e => setNote(e.target.value)} placeholder="例如：读取冲刺速度和持续时间" /></label><button className="gp-secondary" disabled={!table || disabled} onClick={add}><Plus size={14} />关联配置</button>{error && <p role="alert" className="fs-error">{error}</p>}</fieldset>
  </section>;
}

function Dependencies({ store, sources, selection, disabled, update, onSelect, onOpenGameplay }: { store: FunctionalStore; sources: FunctionalSources; selection: NonNullable<FunctionalSelection>; disabled: boolean; update: Mutate; onSelect: (s: FunctionalSelection) => void; onOpenGameplay: Props['onOpenGameplay'] }) {
  const [filter, setFilter] = useState('all'), [target, setTarget] = useState(''), [kind, setKind] = useState<'call' | 'data' | 'event'>('call'), [note, setNote] = useState(''), [error, setError] = useState('');
  const isSystem = selection.kind === 'system';
  const ownIds = new Set(isSystem ? store.capabilities.filter(c => c.systemId === selection.id).map(c => c.id) : [selection.id]);
  const related = store.dependencies.filter(d => (ownIds.has(d.fromId) || ownIds.has(d.toId)) && (filter === 'all' || d.kind === filter));
  const grouped = new Map<string, { id: string; from: string; to: string; kind: 'call' | 'data' | 'event'; count: number }>();
  for (const dependency of related) {
    const from = isSystem ? store.capabilities.find(c => c.id === dependency.fromId)?.systemId : dependency.fromId;
    const to = isSystem ? store.capabilities.find(c => c.id === dependency.toId)?.systemId : dependency.toId;
    if (!from || !to || (isSystem && from === to)) continue;
    const key = JSON.stringify([from, to, dependency.kind]); const old = grouped.get(key);
    if (old) old.count++; else grouped.set(key, { id: key, from, to, kind: dependency.kind, count: 1 });
  }
  const graphIds = new Set([selection.id, ...[...grouped.values()].flatMap(g => [g.from, g.to])]);
  const graphNodes = isSystem ? store.systems.filter(s => graphIds.has(s.id)).map(s => ({ id: s.id, label: s.name, tag: s.archived ? '系统 · 已归档' : '系统', description: s.purpose })) : store.capabilities.filter(c => graphIds.has(c.id)).map(c => ({ id: c.id, label: c.name, tag: systemName(store, c.systemId), description: c.purpose }));
  const graphEdges = [...grouped.values()].map(g => ({ id: g.id, from: g.from, to: g.to, label: dependencyKinds[g.kind] + (isSystem ? ' · ' + g.count : ''), tone: g.kind }));
  const affectedIds = new Set(ownIds); let grew = true;
  while (grew) { grew = false; for (const d of store.dependencies) if (affectedIds.has(d.toId) && !affectedIds.has(d.fromId)) { affectedIds.add(d.fromId); grew = true; } }
  const affected = store.usages.filter(u => affectedIds.has(u.capabilityId));
  const outgoing = related.filter(d => ownIds.has(d.fromId)), incoming = related.filter(d => !ownIds.has(d.fromId) && ownIds.has(d.toId));
  const choices = store.capabilities.filter(c => !ownIds.has(c.id) && activeCapability(store, c) && !store.dependencies.some(d => d.fromId === selection.id && d.toId === c.id && d.kind === kind));
  const add = () => { if (disabled || isSystem) return; if (!choices.some(c => c.id === target)) { setError('请选择一个尚未建立此类依赖的有效功能。'); return; } update(current => ({ ...current, dependencies: [...current.dependencies, { id: crypto.randomUUID(), fromId: selection.id, toId: target, kind, note }] })); setTarget(''); setNote(''); setError(''); };
  const list = (items: typeof related, outgoingSide: boolean) => items.length ? <div className="fs-dependency-list">{items.map(d => { const other = store.capabilities.find(c => c.id === (outgoingSide ? d.toId : d.fromId)); return <article key={d.id} className="fs-dependency"><div className="fs-reference-heading"><div><span className={'fs-relation-kind ' + d.kind}>{dependencyKinds[d.kind]}</span><button className="gp-link-name" disabled={!other} onClick={() => other && onSelect({ kind: 'capability', id: other.id })}>{other ? other.name : '功能已失效'}{other && archivedCapability(store, other) ? '（已归档）' : other && !store.systems.some(s => s.id === other.systemId) ? '（所属系统已失效）' : ''}<ArrowRight size={13} /></button></div>{outgoingSide && !isSystem && <button className="gp-icon" aria-label={'移除依赖：' + dependencyKinds[d.kind] + ' · ' + capName(store, d.toId)} disabled={disabled} onClick={() => update(current => ({ ...current, dependencies: current.dependencies.filter(e => e.id !== d.id) }))}><Trash2 size={14} /></button>}{!outgoingSide && !other && <button className="gp-secondary" aria-label={'移除失效入向依赖：' + d.id} disabled={disabled} onClick={() => update(current => ({ ...current, dependencies: current.dependencies.filter(e => e.id !== d.id) }))}><Trash2 size={14} />移除失效依赖</button>}</div>
      {!outgoingSide && !other && <p className="fs-reference-warning">依赖来源功能已不存在，可以移除此失效关系。</p>}
      {isSystem && <p className="gp-muted">{capName(store, d.fromId)} → {capName(store, d.toId)}</p>}
      {outgoingSide && !isSystem ? <label className="gp-field">依赖目的<input aria-label={'依赖目的：' + d.id} disabled={disabled} value={d.note} onChange={e => update(current => ({ ...current, dependencies: current.dependencies.map(item => item.id === d.id ? { ...item, note: e.target.value } : item) }))} placeholder="为什么需要这个依赖？" /></label> : <p className="gp-muted">{d.note || '依赖目的待补充'}</p>}
    </article>; })}</div> : <Empty>{outgoingSide ? '尚未依赖其他功能。' : '暂时没有功能依赖此条目。'}</Empty>;
  return <><section className="gp-card"><div className="gp-card-heading"><div><h3>{isSystem ? '系统依赖概览' : '直接依赖与使用者'}</h3><p className="gp-muted">箭头从使用方指向提供方。{isSystem ? '连线由功能依赖汇总；系统内依赖在下方列出。' : '默认只展开当前功能和直接相邻的功能。'}</p></div><label className="fs-inline-field">关系类型<select aria-label="依赖关系类型筛选" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部类型</option>{Object.entries(dependencyKinds).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div><GameplayGraph label={isSystem ? '系统依赖图' : '功能依赖图'} nodes={graphNodes} edges={graphEdges} rootId={selection.id} selectedNode={selection.id} onNode={id => onSelect({ kind: selection.kind, id })} />
    </section><div className="fs-dependency-columns"><section className="gp-card"><h3>依赖谁 <small>{outgoing.length}</small></h3>{list(outgoing, true)}</section><section className="gp-card"><h3>谁使用它 <small>{incoming.length}</small></h3>{list(incoming, false)}</section></div>
    {!isSystem && <section className="gp-card"><h3>添加功能依赖</h3><fieldset className="fs-fields" disabled={disabled}><div className="gp-two-fields"><label className="gp-field">目标功能<select aria-label="依赖目标功能" value={target} onChange={e => { setTarget(e.target.value); setError(''); }}><option value="">选择功能</option>{choices.map(c => <option key={c.id} value={c.id}>{systemName(store, c.systemId)} / {c.name}</option>)}</select></label><label className="gp-field">依赖类型<select aria-label="新依赖类型" value={kind} onChange={e => { setKind(e.target.value as typeof kind); setTarget(''); }} >{Object.entries(dependencyKinds).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div><TextField label="新依赖目的" value={note} onChange={setNote} rows={2} placeholder="例如：请求水平位移，并由移动系统处理碰撞。" /><button className="gp-secondary" disabled={!target || disabled} onClick={add}><Plus size={14} />添加依赖</button>{error && <p className="fs-error" role="alert">{error}</p>}</fieldset></section>}
    <section className="gp-card"><h3>受影响玩法</h3><p className="gp-muted">包括直接引用，以及通过上游功能间接依赖的玩法。此列表按全部关系类型计算，用于评估修改影响。</p><UsageSummary store={store} sources={sources} usages={affected} onOpenGameplay={onOpenGameplay} onOpenCapability={id => onSelect({ kind: 'capability', id })} /></section></>;
}
function UsageSummary({ store, sources, usages, onOpenGameplay, onOpenCapability }: { store: FunctionalStore; sources: FunctionalSources; usages: FunctionalUsage[]; onOpenGameplay: Props['onOpenGameplay']; onOpenCapability: (id: string) => void }) {
  return usages.length ? <div className="fs-usage-summary">{usages.map(u => { const design = sources.designs.find(d => d.id === u.gameplayId); const exists = sourceOptions(sources, u.gameplayId).some(s => s.kind === u.sourceKind && s.id === u.sourceId); return <article key={u.id}><div><button className="gp-link-name" disabled={!design} onClick={() => onOpenGameplay(u.gameplayId, exists ? u.sourceKind : 'design', exists ? u.sourceId : '')}>{design?.title || '玩法已失效'}{design?.archived ? '（已归档）' : ''}<ArrowRight size={13} /></button><small>{usageSourceText(u, sources)}{!exists && ' · 点击仅打开玩法'}</small></div><button className="fs-cap-chip" disabled={!store.capabilities.some(c => c.id === u.capabilityId)} onClick={() => onOpenCapability(u.capabilityId)}>{capName(store, u.capabilityId)}</button><p>{u.note || '使用场景待补充'}</p></article>; })}</div> : <Empty>尚无关联玩法。</Empty>;
}
export function GameplayFunctions({ controller, sources, gameplayId, archived, onOpenCapability }: { controller: FunctionalController; sources: FunctionalSources; gameplayId: string; archived: boolean; onOpenCapability: (id: string) => void }) {
  return <UsageSection key={gameplayId} controller={controller} sources={sources} gameplayId={gameplayId} disabled={archived || controller.blocked} onOpenCapability={onOpenCapability} onOpenGameplay={() => {}} />;
}
function UsageSection({ controller, sources, capabilityId, gameplayId, disabled, onOpenCapability, onOpenGameplay }: { controller: FunctionalController; sources: FunctionalSources; capabilityId?: string; gameplayId?: string; disabled: boolean; onOpenCapability: (id: string) => void; onOpenGameplay: Props['onOpenGameplay'] }) {
  const { store, update } = controller;
  const [target, setTarget] = useState(''), [source, setSource] = useState(keyOfSource('design', '')), [note, setNote] = useState(''), [error, setError] = useState('');
  const fromGameplay = !!gameplayId;
  const usages = store.usages.filter(u => fromGameplay ? u.gameplayId === gameplayId : u.capabilityId === capabilityId);
  const options = fromGameplay ? store.capabilities.filter(c => activeCapability(store, c)).map(c => ({ id: c.id, name: systemName(store, c.systemId) + ' / ' + c.name })) : sources.designs.filter(d => !d.archived).map(d => ({ id: d.id, name: d.title }));
  const choices = sourceOptions(sources, gameplayId || target);
  const add = () => {
    if (disabled || !target) return;
    if (!options.some(o => o.id === target)) { setError('请选择有效的关联对象。'); return; }
    const [sourceKind, sourceId] = JSON.parse(source) as [FunctionalUsage['sourceKind'], string];
    if (!choices.some(c => c.kind === sourceKind && c.id === sourceId)) { setError('请选择有效的需求来源。'); return; }
    const g = gameplayId || target, c = capabilityId || target;
    if (store.usages.some(u => u.gameplayId === g && u.capabilityId === c && u.sourceKind === sourceKind && u.sourceId === sourceId)) { setError('此来源已经关联该功能，可直接修改使用场景。'); return; }
    update(current => ({ ...current, usages: [...current.usages, { id: crypto.randomUUID(), gameplayId: g, capabilityId: c, sourceKind, sourceId, note }] })); setNote(''); setError('');
  };
  const patchUsage = (id: string, changes: Partial<FunctionalUsage>) => update(current => ({ ...current, usages: current.usages.map(u => u.id === id ? { ...u, ...changes } : u) }));
  return <section className="gp-card fs-usages" aria-label={fromGameplay ? '玩法实现功能' : '功能关联玩法'}><div className="gp-card-heading"><div><h3>{fromGameplay ? '实现功能' : '关联玩法'}</h3><p className="gp-muted">{fromGameplay ? '复用已有功能，补充它在这份玩法中的使用场景。' : '查看同一功能被哪些玩法使用，并追溯具体需求来源。'}</p></div><Link2 size={18} /></div>
    {fromGameplay && controller.blocked && <Notice>功能系统存档无法读取，暂时不能更改关联。</Notice>}
    {usages.length ? <div className="fs-reference-list">{usages.map(u => { const cap = store.capabilities.find(c => c.id === u.capabilityId), design = sources.designs.find(d => d.id === u.gameplayId); const sourceChoices = sourceOptions(sources, u.gameplayId); const sourceExists = sourceChoices.some(c => c.kind === u.sourceKind && c.id === u.sourceId); const duplicateSource = (kind: string, id: string) => store.usages.some(item => item.id !== u.id && item.gameplayId === u.gameplayId && item.capabilityId === u.capabilityId && item.sourceKind === kind && item.sourceId === id); const locked = disabled || (!!cap && archivedCapability(store, cap)); return <article key={u.id} className="fs-reference">
      <div className="fs-reference-heading"><button className="gp-link-name" disabled={fromGameplay ? !cap : !design} onClick={() => fromGameplay ? onOpenCapability(u.capabilityId) : onOpenGameplay(u.gameplayId, sourceExists ? u.sourceKind : 'design', sourceExists ? u.sourceId : '')}>{fromGameplay ? (cap ? systemName(store, cap.systemId) + ' / ' + cap.name : '功能已失效') : design?.title || '玩法已失效'}<ArrowRight size={13} /></button><button className="gp-icon" aria-label={'移除功能关联：' + u.id} disabled={locked} onClick={() => update(current => ({ ...current, usages: current.usages.filter(item => item.id !== u.id) }))}><Trash2 size={14} /></button></div>
      {(!cap || !design || !sourceExists || design.archived || !activeCapability(store, cap)) && <p className="fs-reference-warning">{!cap ? '功能已失效。' : archivedCapability(store, cap) ? '功能或所属系统已归档，关联只读。' : !store.systems.some(s => s.id === cap.systemId) ? '功能所属系统已失效，请进入功能详情修复。' : ''}{!design ? '玩法已失效。' : design.archived ? '来源玩法已归档。' : ''}{!sourceExists ? '具体需求来源已失效，链接仅打开玩法。' : ''}</p>}
      <p className="fs-source-text">{usageSourceText(u, sources)}</p>
      <label className="gp-field">需求来源<select aria-label={'关联需求来源：' + u.id} disabled={locked || !design} value={keyOfSource(u.sourceKind, u.sourceId)} onChange={e => { const [sourceKind, sourceId] = JSON.parse(e.target.value) as [FunctionalUsage['sourceKind'], string]; patchUsage(u.id, { sourceKind, sourceId }); }}>
        {!sourceExists && <option value={keyOfSource(u.sourceKind, u.sourceId)}>来源已失效（保留引用）</option>}{sourceChoices.map(o => <option key={keyOfSource(o.kind, o.id)} value={keyOfSource(o.kind, o.id)} disabled={duplicateSource(o.kind, o.id)}>{o.name}</option>)}</select></label><TextField label="使用场景" ariaLabel={'使用场景：' + u.id} value={u.note} disabled={locked} rows={2} onChange={note => patchUsage(u.id, { note })} placeholder="例如：本试炼完成后解锁玩家冲刺；不在这里重复定义冲刺执行规则。" />
    </article>; })}</div> : <Empty>{fromGameplay ? '尚未关联实现功能。可先到「功能系统」建立系统和功能。' : '尚无玩法引用这个功能。'}</Empty>}
    <fieldset className="fs-fields fs-add-box" disabled={disabled}><div className="gp-two-fields"><label className="gp-field">{fromGameplay ? '功能' : '玩法'}<select aria-label={fromGameplay ? '选择实现功能' : '选择关联玩法'} value={target} onChange={e => { setTarget(e.target.value); setSource(keyOfSource('design', '')); setError(''); }}><option value="">选择{fromGameplay ? '功能' : '玩法'}</option>{options.map(o => <option value={o.id} key={o.id}>{o.name}</option>)}</select></label><label className="gp-field">需求来源<select aria-label="新关联需求来源" value={source} disabled={disabled || (!fromGameplay && !target)} onChange={e => setSource(e.target.value)}>{choices.map(o => <option key={keyOfSource(o.kind, o.id)} value={keyOfSource(o.kind, o.id)}>{o.name}</option>)}</select></label></div><TextField label="新关联使用场景" value={note} onChange={setNote} rows={2} placeholder="这里如何使用这项功能？" /><button className="gp-secondary" disabled={disabled || !target} onClick={add}><Plus size={14} />{fromGameplay ? '关联功能' : '关联玩法'}</button>{error && <p className="fs-error" role="alert">{error}</p>}</fieldset>
  </section>;
}
