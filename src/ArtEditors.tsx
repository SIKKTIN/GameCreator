import {materialStatusLabel} from './material-progress';
import { MaterialPromptEditor } from './MaterialPromptEditor';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Archive, ArrowRight, Check, FileImage, FileText, FolderOpen, Image as ImageIcon, Link2, Palette, Plus, RotateCcw, Search, Trash2, Upload, X } from 'lucide-react';
import { artCategories, artPriorities, artRequirementStatuses, artReviewStatuses, artSourceText,  canAdoptVersion, type ArtStore, type ArtRequirement, type ArtAsset, type ArtVersion, type ArtFile, type ArtSource, type ArtSources } from './art-assets';
import type { ArtController } from './useArtAssets';
import './gameplay.css';
import './art-assets.css';
import './gameplay-library.css';
import { artLibrary, artCategoryId, artCategoryName } from './art-library';

type Navigation = {onOpenGameplay:(id:string,kind?:string,sourceId?:string)=>void;onOpenCapability:(id:string)=>void};
type Change = (operation: (store: ArtStore) => ArtStore) => boolean;
const timestamp = () => new Date().toISOString();
const originKey = (kind: string, id: string) => JSON.stringify([kind, id]);
const fileSize = (size: number) => size < 1024 ? size + ' B' : size < 1024 * 1024 ? (size / 1024).toFixed(1) + ' KB' : (size / 1024 / 1024).toFixed(1) + ' MB';
const capabilityArchived = (sources: ArtSources, id: string) => { const cap = sources.functional.capabilities.find(c => c.id === id); return !!(cap?.archived || sources.functional.systems.find(s => s.id === cap?.systemId)?.archived); };
function sourceChoices(sources: ArtSources, id: string) {
  const d = sources.designs.find(item => item.id === id);
  return [{ kind: 'design' as const, id: '', name: '整份玩法设计' },
    ...(d?.conditionRules ?? []).map(r => ({ kind: 'rule' as const, id: r.id, name: '条件规则 · ' + (r.name || '未命名规则') })),
    ...(d?.stateFlow.states ?? []).map(s => ({ kind: 'state' as const, id: s.id, name: '状态 · ' + (s.name || '未命名状态') })),
    ...(d?.timeline.events ?? []).map(e => ({ kind: 'event' as const, id: e.id, name: '时间事件 · ' + (e.name || '未命名事件') })),
    ...(d?.space.objects ?? []).map(o => ({ kind: 'object' as const, id: o.id, name: '空间对象 · ' + (o.name || '未命名对象') }))];
}
function sourceState(source: ArtSource, sources: ArtSources) {
  if (source.kind === 'capability') { const cap = sources.functional.capabilities.find(c => c.id === source.targetId); return { exists: !!cap, precise: !!cap, archived: capabilityArchived(sources, source.targetId) }; }
  const design = sources.designs.find(d => d.id === source.targetId);
  return { exists: !!design, precise: !!design && sourceChoices(sources, source.targetId).some(o => o.kind === source.sourceKind && o.id === source.sourceId), archived: !!design?.archived };
}
function Empty({ children }: { children: ReactNode }) { return <p className="gp-placeholder">{children}</p>; }
function Notice({ children }: { children: ReactNode }) { return <p className="ar-notice" role="status">{children}</p>; }
function TextField({ label, ariaLabel, value, onChange, rows = 3, disabled, placeholder }: { label: string; ariaLabel?: string; value: string; onChange: (value: string) => void; rows?: number; disabled?: boolean; placeholder?: string }) {
  return <label className="gp-field">{label}<textarea aria-label={ariaLabel || label} rows={rows} value={value} onChange={e => onChange(e.target.value)} disabled={disabled} placeholder={placeholder} /></label>;
}
function adoptedAssetText(asset: ArtAsset) { const version = asset.versions.find(v => v.id === asset.adoptedVersionId); return !version ? '尚未采用版本' : version.placeholder ? '占位版 · ' + version.name : '正式版 · ' + version.name; }

export function RequirementEditor({ requirement: r, controller, sources, apply, onChange, onOpenAsset, onOpenGameplay, onOpenCapability, unified=false,progressManaged=false }: { progressManaged?:boolean; unified?:boolean; requirement: ArtRequirement; controller: ArtController; sources: ArtSources; apply: Change; onChange: (changes: Partial<ArtRequirement>) => void; onOpenAsset: (id: string) => void; onOpenGameplay: Navigation['onOpenGameplay']; onOpenCapability: Navigation['onOpenCapability'] }) {
  const disabled = controller.blocked || r.archived;
  return <><div className="gp-editor-heading"><div><span className="gp-kicker">ART REQUIREMENT · {r.category}</span><h2>{r.name || '未命名需求'}</h2><p className="gp-muted">明确交付要求，关联实际使用场景。</p></div><button className="gp-secondary" disabled={controller.blocked} onClick={() => onChange({ archived: !r.archived })}>{r.archived ? <RotateCcw size={14} /> : <Archive size={14} />}{r.archived ? '恢复素材需求' : '归档素材需求'}</button></div>
    {r.archived && <Notice>此需求已归档，恢复后可以编辑；来源与资产仍可查看。</Notice>}
    <div className={'ar-readiness'+(r.status==='已通过'?' complete':'')}><div><Check size={18}/><strong>{materialStatusLabel(r.status)}</strong></div><p>{progressManaged?'制作状态跟随关联的美术任务更新。可在“工程交付与进度”查看任务和反馈结果。':'素材直接制作在游戏工程中，完成后通过关联美术任务或手动更新状态。'}</p></div>
    <section className="gp-card"><div className="gp-card-heading"><h3>需求说明</h3><span className="gp-muted">以工程内实际效果验收</span></div><fieldset className="ar-fields" disabled={disabled}>
      <div className="gp-two-fields"><label className="gp-field">需求名称<input aria-label="需求名称" value={r.name} onChange={e => onChange({ name: e.target.value })} /></label><label className="gp-field">制作类型<select aria-label="素材分类" value={r.category} onChange={e => onChange({ category: e.target.value as ArtRequirement['category'] })}>{artCategories.map(c => <option key={c}>{c}</option>)}</select></label></div>
      <div className="ar-three-fields"><label className="gp-field">优先级<select aria-label="需求优先级" value={r.priority} onChange={e => onChange({ priority: e.target.value as ArtRequirement['priority'] })}>{artPriorities.map(s => <option key={s}>{s}</option>)}</select></label><label className="gp-field">负责人<input aria-label="需求负责人" value={r.owner} onChange={e => onChange({ owner: e.target.value })} placeholder="待分配" /></label><label className="gp-field">截止日期<input aria-label="需求截止日期" type="date" value={r.dueDate} onChange={e => onChange({ dueDate: e.target.value })} /></label></div>
      <label className="gp-field">制作状态<select aria-label="需求状态" disabled={progressManaged} value={r.status} onChange={e => onChange({ status: e.target.value as ArtRequirement['status'] })}>{artRequirementStatuses.map(s => <option key={s} value={s}>{materialStatusLabel(s)}</option>)}</select></label>
      <TextField label="需求描述" value={r.description} onChange={description => onChange({ description })} placeholder="需要制作什么？在游戏中传达什么信息？" />
      <TextField label="制作规格" value={r.specification} onChange={specification => onChange({ specification })} placeholder="尺寸、比例、格式、透明背景、动画帧数或引擎限制等。" />
      <TextField label="素材验收标准" value={r.acceptance} onChange={acceptance => onChange({ acceptance })} placeholder="如何判断这份交付满足需求？" />
    </fieldset></section>
    <MaterialPromptEditor requirement={r} categoryName={artCategoryName(artLibrary(controller.store), artCategoryId(artLibrary(controller.store), 'requirement', r.id))} disabled={disabled} onChange={generationPrompt=>onChange({generationPrompt})}/>
    {!unified&&<RequirementSources requirement={r} sources={sources} disabled={disabled} onChange={value => onChange({ sources: value })} onOpenGameplay={onOpenGameplay} onOpenCapability={onOpenCapability} />}
    {!unified&&<RequirementAssets requirement={r} store={controller.store} disabled={disabled} apply={apply} onOpenAsset={onOpenAsset} />}
  </>;
}
export function RequirementSources({ requirement, sources, disabled, onChange, onOpenGameplay, onOpenCapability }: { requirement: ArtRequirement; sources: ArtSources; disabled: boolean; onChange: (value: ArtSource[]) => void; onOpenGameplay: Navigation['onOpenGameplay']; onOpenCapability: Navigation['onOpenCapability'] }) {
  const [kind, setKind] = useState<ArtSource['kind']>('gameplay'), [target, setTarget] = useState(''), [origin, setOrigin] = useState(originKey('design', '')), [note, setNote] = useState(''), [error, setError] = useState('');
  const options = kind === 'gameplay' ? sources.designs.filter(d => !d.archived).map(d => ({ id: d.id, name: d.title })) : sources.functional.capabilities.filter(c => !capabilityArchived(sources, c.id)).map(c => ({ id: c.id, name: (sources.functional.systems.find(s => s.id === c.systemId)?.name || '所属系统已失效') + ' / ' + c.name }));
  const preciseOptions = kind === 'gameplay' ? sourceChoices(sources, target) : [{ kind: 'design' as const, id: '', name: '整项功能定义' }];
  const add = () => { if (disabled || !options.some(o => o.id === target)) return; const [sourceKind, sourceId] = JSON.parse(origin) as [ArtSource['sourceKind'], string]; if (!preciseOptions.some(o => o.kind === sourceKind && o.id === sourceId)) { setError('需求来源已变化，请重新选择。'); return; } if (requirement.sources.some(s => s.kind === kind && s.targetId === target && s.sourceKind === sourceKind && s.sourceId === sourceId)) { setError('此来源已经关联，可补充现有的使用说明。'); return; } onChange([...requirement.sources, { id: crypto.randomUUID(), kind, targetId: target, sourceKind, sourceId, note }]); setNote(''); setError(''); };
  return <section className="gp-card ar-sources"><div className="gp-card-heading"><div><h3>需求来源</h3><p className="gp-muted">关联玩法、具体对象或程序功能，查看素材用在哪里。</p></div><Link2 size={17} /></div>
    {requirement.sources.length ? <div className="ar-reference-list">{requirement.sources.map(s => { const state = sourceState(s, sources); return <div className="ar-reference" key={s.id}><div className="ar-reference-heading"><button className="gp-link-name" disabled={!state.exists} onClick={() => s.kind === 'capability' ? onOpenCapability(s.targetId) : onOpenGameplay(s.targetId, state.precise ? s.sourceKind : 'design', state.precise ? s.sourceId : '')}>{artSourceText(s, sources)}<ArrowRight size={13} /></button><button className="gp-icon" aria-label={'移除素材需求来源：' + s.id} disabled={disabled} onClick={() => onChange(requirement.sources.filter(item => item.id !== s.id))}><Trash2 size={14} /></button></div>{(!state.exists || !state.precise || state.archived) && <p className="ar-warning">{!state.exists ? '来源已失效，可移除此关联。' : !state.precise ? '具体来源已失效，点击仅打开所属玩法。' : '来源已归档，引用仍保留。'}</p>}<TextField label="来源使用说明" ariaLabel={'素材来源使用说明：' + s.id} value={s.note} disabled={disabled} rows={2} onChange={note => onChange(requirement.sources.map(item => item.id === s.id ? { ...item, note } : item))} /></div>; })}</div> : <Empty>尚未关联玩法或功能。</Empty>}
    <fieldset className="ar-fields ar-add-box" disabled={disabled}><div className="ar-source-fields"><label className="gp-field">来源类型<select aria-label="素材需求来源类型" value={kind} onChange={e => { setKind(e.target.value as ArtSource['kind']); setTarget(''); setOrigin(originKey('design', '')); }}><option value="gameplay">玩法设计</option><option value="capability">功能系统</option></select></label><label className="gp-field">关联目标<select aria-label="素材需求关联目标" value={target} onChange={e => { setTarget(e.target.value); setOrigin(originKey('design', '')); setError(''); }}><option value="">选择来源</option>{options.map(o => <option value={o.id} key={o.id}>{o.name}</option>)}</select></label></div><label className="gp-field">具体来源<select aria-label="素材需求具体来源" value={origin} disabled={disabled || !target} onChange={e => setOrigin(e.target.value)}>{preciseOptions.map(o => <option key={originKey(o.kind, o.id)} value={originKey(o.kind, o.id)}>{o.name}</option>)}</select></label><TextField label="来源用途" ariaLabel="素材需求来源用途" value={note} onChange={setNote} rows={2} placeholder="例如：为冲刺状态提供启动、移动与结束特效。" /><button className="gp-secondary" disabled={disabled || !target} onClick={add}><Plus size={14} />关联需求来源</button>{error && <p className="ar-error" role="alert">{error}</p>}</fieldset>
  </section>;
}
export function RequirementAssets({ requirement, store, disabled, apply, onOpenAsset }: { requirement: ArtRequirement; store: ArtStore; disabled: boolean; apply: Change; onOpenAsset: (id: string) => void }) {
  const [target, setTarget] = useState(''), [note, setNote] = useState('');
  const links = store.links.filter(l => l.requirementId === requirement.id), available = store.assets.filter(a => !a.archived && !links.some(l => l.assetId === a.id));
  const add = () => { if (disabled || !available.some(a => a.id === target)) return; apply(current => ({ ...current, links: [...current.links, { id: crypto.randomUUID(), requirementId: requirement.id, assetId: target, note }] })); setTarget(''); setNote(''); };
  return <section className="gp-card ar-linked-assets"><div className="gp-card-heading"><div><h3>关联共用资源</h3><p className="gp-muted">保留已有资源的复用关系与说明，制作进度按明确关联的美术任务同步。</p></div><ImageIcon size={18} /></div>
    {links.length ? <div className="ar-reference-list">{links.map(link => { const asset = store.assets.find(a => a.id === link.assetId); return <div className="ar-reference" key={link.id}><div className="ar-reference-heading"><button className="gp-link-name" disabled={!asset} onClick={() => onOpenAsset(link.assetId)}>{asset?.name || '资产已失效'}<ArrowRight size={13} /></button><button className="gp-icon" aria-label={'解除素材资产关联：' + link.id} disabled={disabled} onClick={() => apply(current => ({ ...current, links: current.links.filter(l => l.id !== link.id) }))}><Trash2 size={14} /></button></div><div className="ar-asset-link-status"><span className="gp-badge">{asset?materialStatusLabel(asset.productionStatus||'待制作'):'关联已失效'}</span>{asset?.archived&&<span className="ar-warning">资源已归档</span>}</div><TextField label="使用说明" ariaLabel={'素材资产使用说明：' + link.id} rows={2} value={link.note} disabled={disabled} onChange={note => apply(current => ({ ...current, links: current.links.map(l => l.id === link.id ? { ...l, note } : l) }))} /></div>; })}</div> : <Empty>尚未关联共用资源。可直接导入文件，或在下方选择已有资源。</Empty>}
    <fieldset className="ar-fields ar-add-box" disabled={disabled}><label className="gp-field">资产<select aria-label="选择关联素材资产" value={target} onChange={e => setTarget(e.target.value)}><option value="">选择已有资产</option>{available.map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label><TextField label="资产使用说明" value={note} onChange={setNote} rows={2} placeholder="这份资产用于需求中的哪一部分？" /><button className="gp-secondary" disabled={disabled || !target} onClick={add}><Plus size={14} />关联素材资产</button></fieldset>
  </section>;
}

export function ArtReferences({ controller, sources, kind, targetId, onOpenRequirement }: { controller: ArtController; sources: ArtSources; kind: 'gameplay' | 'capability'; targetId: string; onOpenRequirement: (id: string) => void }) {
  const matches = controller.store.requirements.flatMap(requirement => { const links = requirement.sources.filter(s => s.kind === kind && s.targetId === targetId); return links.length ? [{ requirement, links }] : []; });
  return <section className="gp-card ar-backlinks" aria-label="关联素材需求"><div className="gp-card-heading"><div><h3>素材需求</h3><p className="gp-muted">在素材资产模块关联需求，这里会同步显示。</p></div><Palette size={18} /></div>{controller.blocked && <Notice>素材存档无法读取，关联内容暂时不可用。</Notice>}{matches.length ? <div className="ar-reference-list">{matches.map(({ requirement: r, links }) => <div className="ar-reference" key={r.id}><div className="ar-reference-heading"><button className="gp-link-name" aria-label={'查看素材需求：' + r.name} onClick={() => onOpenRequirement(r.id)}>{r.name}<ArrowRight size={13} /></button><span className="gp-badge">{r.archived ? '已归档' : materialStatusLabel(r.status)}</span></div>{links.map(link => <div key={link.id} className="ar-backlink-origin"><small>{artSourceText(link, sources)}</small>{link.note && <p>{link.note}</p>}</div>)}</div>)}</div> : <Empty>尚无素材需求引用此{kind === 'gameplay' ? '玩法' : '功能'}。</Empty>}</section>;
}
export function AssetEditor({ asset, controller, apply, onChange, onOpenRequirement, importRequest=0, onImportRequestHandled, onBusy, unified=false }: { importRequest?:number; onImportRequestHandled?:()=>void; onBusy?:(busy:boolean)=>void; unified?:boolean; asset: ArtAsset; controller: ArtController; apply: Change; onChange: (changes: Partial<ArtAsset>) => void; onOpenRequirement: (id: string) => void }) {
  const disabled = controller.blocked || asset.archived;
  const [versionId, setVersionId] = useState(asset.adoptedVersionId || asset.versions[asset.versions.length - 1]?.id || '');
  const [importing, setImporting] = useState(false), [importError, setImportError] = useState(''), [draft, setDraft] = useState<ArtVersion | null>(null);
  const versionDialog = useRef<HTMLDialogElement>(null), alive = useRef(true), importSequence = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; importSequence.current++; }; }, []);
  useEffect(() => { if (draft && asset.versions.some(v => v.id === draft.id)) { setVersionId(draft.id); setDraft(null); versionDialog.current?.close(); } }, [asset.versions, draft]);
  useEffect(() => {
    if (!importing && !draft) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [importing, draft]);
  const selectedVersion = asset.versions.find(v => v.id === versionId) || asset.versions.find(v => v.id === asset.adoptedVersionId) || asset.versions[asset.versions.length - 1];
  const links = controller.store.links.filter(l => l.assetId === asset.id);
  const importFiles = async () => {
    const api = window.desktopClient?.artFiles;
    if (!api || disabled || importing) return;
    const sequence = ++importSequence.current, workspaceId = controller.workspaceId;
    setImporting(true); setImportError(''); versionDialog.current?.showModal();
    try {
      const files = await api.importFiles(workspaceId);
      if (!alive.current || sequence !== importSequence.current) return;
      if (!files?.length) { versionDialog.current?.close(); return; }
      setDraft({ id: crypto.randomUUID(), name: '版本 ' + (asset.versions.length + 1), notes: '', placeholder: false, review: '待审核', feedback: '', files, createdAt: timestamp() });
      versionDialog.current?.showModal();
    } catch (e) { if (alive.current && sequence === importSequence.current) { versionDialog.current?.close(); setImportError('文件导入失败：' + String(e)); } }
    finally { if (alive.current && sequence === importSequence.current) setImporting(false); }
  };
  const busyCallback=useRef(onBusy);busyCallback.current=onBusy;
  useEffect(()=>{busyCallback.current?.(importing||!!draft);},[importing,!!draft]);
  useEffect(()=>()=>{busyCallback.current?.(false);},[]);
  useEffect(()=>{if(importRequest){onImportRequestHandled?.();void importFiles();}},[importRequest]);
  const submitVersion = (event: FormEvent) => { event.preventDefault(); if (disabled || !draft) return; if (!draft.name.trim()) { setImportError('请填写交付版本名称。'); return; } if (!draft.files.length) { setImportError('请选择至少一个交付文件。'); return; } const version = { ...draft, name: draft.name.trim() }; setImportError(''); apply(current => ({ ...current, assets: current.assets.map(a => a.id === asset.id ? { ...a, versions: [...a.versions, version], updatedAt: timestamp() } : a) })); };
  const patchVersion = (changes: Pick<Partial<ArtVersion>, 'review' | 'feedback'>) => { if (!selectedVersion || disabled) return; apply(current => ({ ...current, assets: current.assets.map(a => a.id === asset.id ? { ...a, versions: a.versions.map(v => v.id === selectedVersion.id ? { ...v, ...changes } : v), updatedAt: timestamp() } : a) })); };
  return <><div className="gp-editor-heading"><div><span className="gp-kicker">ART ASSET</span><h2>{asset.name || '未命名资产'}</h2><p className="gp-muted">{asset.versions.length} 个交付版本 · {links.length} 份需求使用</p></div><div className="gp-actions"><button className="gp-secondary" disabled={controller.blocked} onClick={() => onChange({ archived: !asset.archived })}>{asset.archived ? <RotateCcw size={14} /> : <Archive size={14} />}{asset.archived ? '恢复素材资产' : '归档素材资产'}</button></div></div>
    {asset.archived && <Notice>资产已归档，历史版本与采用记录保留。恢复后可添加交付或调整审核。</Notice>}
    <section className="gp-card"><div className="gp-card-heading"><h3>交付资源信息</h3><span className="ar-delivery-badge">{adoptedAssetText(asset)}</span>{unified&&<button className="gp-secondary" disabled={controller.blocked} onClick={()=>onChange({archived:!asset.archived})}>{asset.archived?'恢复交付资源':'归档交付资源'}</button>}</div><fieldset className="ar-fields" disabled={disabled}><label className="gp-field">资源名称<input aria-label="资产名称" value={asset.name} onChange={e => onChange({ name: e.target.value })} /></label><TextField label="资源说明" ariaLabel="资产说明" value={asset.description} onChange={description => onChange({ description })} placeholder="说明用途、风格或复用方式。" /></fieldset></section>
    <section className="gp-card ar-versions"><div className="gp-card-heading"><div><h3>交付版本</h3><p className="gp-muted">每次交付保留原文件，审核通过后再明确采用。</p></div><button className="gp-secondary" disabled={disabled || importing || !window.desktopClient?.artFiles} onClick={importFiles}><Upload size={15} />{importing ? '正在导入…' : '导入新版本'}</button></div>
      {!window.desktopClient?.artFiles && <Notice>请在桌面软件中导入文件。你仍可在这里管理需求和查看版本信息。</Notice>}
      {importError && !versionDialog.current?.open && <p className="ar-error" role="alert">{importError}</p>}
      {selectedVersion ? <div className="ar-version-layout"><div className="ar-version-list" aria-label="交付版本列表">{[...asset.versions].reverse().map(v => <button key={v.id} className={'ar-version-card' + (selectedVersion.id === v.id ? ' selected' : '')} aria-label={'查看交付版本：' + v.name} aria-pressed={selectedVersion.id === v.id} onClick={() => setVersionId(v.id)}><strong>{v.name || '未命名版本'}</strong><span>{v.placeholder ? '占位' : '正式'} · {v.review}</span><small>{v.files.length} 个文件 · {new Date(v.createdAt).toLocaleDateString()}</small>{asset.adoptedVersionId === v.id && <em><Check size={12} />当前采用</em>}</button>)}</div>
        <div className="ar-version-detail" key={selectedVersion.id}><div className="ar-version-heading"><div><h4>{selectedVersion.name}</h4><span className={'ar-delivery-badge' + (!selectedVersion.placeholder && selectedVersion.review === '已通过' ? ' ready' : '')}>{selectedVersion.placeholder ? '占位版本' : '正式版本'} · {selectedVersion.review}</span></div><div className="gp-actions">{asset.adoptedVersionId === selectedVersion.id ? <button className="gp-secondary" disabled={disabled} onClick={() => onChange({ adoptedVersionId: '' })}>取消采用</button> : <button className="primary" disabled={disabled || !canAdoptVersion(selectedVersion)} onClick={() => onChange({ adoptedVersionId: selectedVersion.id })}><Check size={14} />采用此版本</button>}</div></div>
          {selectedVersion.placeholder ? <Notice>占位版本可以用于原型，但不计为正式交付完成。</Notice> : selectedVersion.review !== '已通过' && <p className="gp-muted">正式版本通过审核后才能采用。</p>}
          {!asset.adoptedVersionId&&selectedVersion.review==='已通过'&&selectedVersion.files.length>0&&<Notice>此版本已审核通过，但尚未采用，不会同步到引擎。请点击上方“采用此版本”。</Notice>}
          {asset.adoptedVersionId===selectedVersion.id&&!controller.pending&&<Notice>当前采用版本：{selectedVersion.name}。可在引擎设置中预览变更并同步到工程。</Notice>}
          {selectedVersion.notes && <p className="ar-version-notes">{selectedVersion.notes}</p>}
          <VersionFiles key={selectedVersion.id} version={selectedVersion} workspaceId={controller.workspaceId} />
          <fieldset className="ar-fields ar-review-fields" disabled={disabled}><div className="gp-card-heading"><h4>版本审核</h4><small>审核不改变原始交付文件</small></div><label className="gp-field">审核状态<select aria-label="版本审核状态" value={selectedVersion.review} onChange={e => patchVersion({ review: e.target.value as ArtVersion['review'] })}>{artReviewStatuses.map(s => <option key={s}>{s}</option>)}</select></label><TextField label="审核反馈" ariaLabel="版本审核反馈" value={selectedVersion.feedback} onChange={feedback => patchVersion({ feedback })} rows={3} placeholder="记录需要修改的部分，或说明通过依据。" /></fieldset>
        </div></div> : <Empty>还没有交付版本。导入一组文件，记录版本名称与交付说明。</Empty>}
    </section>
    {!unified&&<section className="gp-card ar-asset-usages"><div className="gp-card-heading"><h3>使用此资产的需求</h3><Link2 size={17} /></div>{links.length ? <div className="ar-reference-list">{links.map(link => { const requirement = controller.store.requirements.find(r => r.id === link.requirementId); return <div className="ar-reference" key={link.id}><div className="ar-reference-heading"><button className="gp-link-name" disabled={!requirement} onClick={() => onOpenRequirement(link.requirementId)}>{requirement?.name || '需求已失效'}<ArrowRight size={13} /></button>{requirement && <span className="gp-badge">{requirement.archived ? '已归档' : requirement.status}</span>}</div>{link.note && <p className="ar-version-notes">{link.note}</p>}{!requirement && <button className="gp-secondary" disabled={disabled} onClick={() => apply(current => ({ ...current, links: current.links.filter(l => l.id !== link.id) }))}><Trash2 size={14} />移除失效需求关联</button>}</div>; })}</div> : <Empty>尚无需求使用此资产，可从需求详情中建立关联。</Empty>}</section>}
    <dialog className="gp-dialog ar-version-dialog" ref={versionDialog} aria-labelledby="ar-version-title" onCancel={event => { if (importing) event.preventDefault(); else setDraft(null); }}><form onSubmit={submitVersion}><div className="gp-card-heading"><div><span className="gp-kicker">NEW DELIVERY</span><h2 id="ar-version-title">添加交付版本</h2></div><button type="button" className="gp-icon" aria-label="关闭交付版本" disabled={importing} onClick={() => { versionDialog.current?.close(); setDraft(null); }}><X size={18} /></button></div><p className="gp-muted">{importing ? "正在选择和导入交付文件，请稍候…" : asset.name + " · " + (draft?.files.length || 0) + " 个文件。保存后保留此版本，后续修改请提交新版本。"}</p><label className="gp-field">版本名称<input aria-label="交付版本名称" disabled={importing} required value={draft?.name || ''} onChange={e => setDraft(current => current ? { ...current, name: e.target.value } : null)} /></label><TextField label="交付版本备注" disabled={importing} value={draft?.notes || ''} onChange={notes => setDraft(current => current ? { ...current, notes } : null)} placeholder="说明本次交付包含什么，与上一版有什么变化。" /><label className="ar-checkbox"><input aria-label="这是占位版本" disabled={importing} type="checkbox" checked={draft?.placeholder || false} onChange={e => setDraft(current => current ? { ...current, placeholder: e.target.checked } : null)} />这是占位版本</label><p className="gp-muted">占位版用于原型，正式交付仍需提交非占位版本并通过审核。</p><ul className="ar-import-files">{draft?.files.map(f => <li key={f.id}><FileText size={14} /><span>{f.name}</span><small>{fileSize(f.size)}</small></li>)}</ul>{(importError || controller.error) && <p className="ar-error" role="alert">{importError || controller.error}</p>}<div className="gp-dialog-actions"><button type="button" className="gp-secondary" disabled={importing} onClick={() => { versionDialog.current?.close(); setDraft(null); }}>取消</button><button type="submit" className="primary" disabled={disabled || importing || !draft?.files.length}>保存交付版本</button></div></form></dialog>
  </>;
}
function VersionFiles({ version, workspaceId }: { version: ArtVersion; workspaceId: string }) {
  const firstImage = version.files.find(f => /^image\/(png|jpeg|webp|gif|bmp|avif)$/i.test(f.mime));
  const [fileId, setFileId] = useState(firstImage?.id || version.files[0]?.id || ''), [revealError, setRevealError] = useState('');
  const file = version.files.find(f => f.id === fileId) || version.files[0];
  const reveal = async () => { if (!file || !window.desktopClient?.artFiles) return; setRevealError(''); try { await window.desktopClient.artFiles.reveal(workspaceId, file.storagePath); } catch (e) { setRevealError('文件不可用：' + String(e)); } };
  return <div className="ar-files"><div className="ar-file-list" aria-label="版本文件列表">{version.files.map(f => <button key={f.id} className={'ar-file-button' + (file?.id === f.id ? ' selected' : '')} aria-label={'预览交付文件：' + f.name} aria-pressed={file?.id === f.id} onClick={() => { setFileId(f.id); setRevealError(''); }}><FileText size={14} /><span>{f.name}</span><small>{fileSize(f.size)}</small></button>)}</div>{file ? <><FilePreview key={workspaceId + ":" + file.id} file={file} workspaceId={workspaceId} /><div className="ar-file-footer"><span>{file.name} · {fileSize(file.size)}</span><button className="gp-secondary" disabled={!window.desktopClient?.artFiles} onClick={reveal}><FolderOpen size={14} />在文件夹中显示</button></div>{revealError && <p className="ar-error" role="alert">{revealError}</p>}</> : <Empty>此版本没有交付文件，不能采用。</Empty>}</div>;
}
function FilePreview({ file, workspaceId }: { file: ArtFile; workspaceId: string }) {
  const [result, setResult] = useState<{ state: 'loading' | 'image' | 'unsupported' | 'unavailable' | 'desktop'; dataUrl?: string }>({ state: 'loading' });
  useEffect(() => {
    let current = true; setResult({ state: 'loading' }); const api = window.desktopClient?.artFiles;
    if (!api) { setResult({ state: 'desktop' }); return () => { current = false; }; }
    api.readPreview(workspaceId, file.storagePath).then(response => {
      if (!current) return;
      const safeImage = /^image\/(png|jpeg|webp|gif|bmp|avif)$/i.test(file.mime) && /^data:image\/(png|jpeg|webp|gif|bmp|avif);base64,[a-z0-9+/=]+$/i.test(response?.dataUrl || '');
      setResult(safeImage ? { state: 'image', dataUrl: response!.dataUrl } : { state: 'unsupported' });
    }).catch(() => { if (current) setResult({ state: 'unavailable' }); });
    return () => { current = false; };
  }, [workspaceId, file.id, file.storagePath, file.mime]);
  return <div className={'ar-preview ' + result.state} aria-label="交付文件预览">{result.state === 'image' ? <img className="ar-preview-image" src={result.dataUrl} alt={file.name} onError={() => setResult({ state: 'unavailable' })} /> : <div className="ar-preview-placeholder"><FileImage size={34} /><strong>{result.state === 'loading' ? '正在读取预览…' : result.state === 'unavailable' ? '文件不可用' : result.state === 'desktop' ? '请在桌面软件中预览本地文件' : '此文件格式不提供图片预览'}</strong><p>{result.state === 'unavailable' ? '文件可能缺失或无法读取，版本记录仍然保留。' : result.state === 'unsupported' ? '可在文件夹中查看原始交付文件。' : file.name}</p></div>}</div>;
}
