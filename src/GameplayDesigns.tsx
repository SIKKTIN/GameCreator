import { useRef, useState, type FormEvent } from 'react';
import { Archive, ArrowDown, ArrowRight, ArrowUp, CheckCircle2, Copy, FileText, FlaskConical, Gamepad2, Link2, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { createGameplay, duplicateGameplay, gameplayLinkName, gameplayResults, gameplayStatuses, moveGameplayItem, type GameplayDesign, type GameplayLink, type GameplaySources, type GameplayStatus } from './gameplay';
import type { GameplayController } from './useGameplayDesigns';
import './gameplay.css';
import { GameplayDependencies, GameplayRules, GameplayStateFlow } from './GameplayStructure';
type EditorTab = 'design' | 'relations' | 'rules' | 'flow';

type Props = { selectedId: string; onSelect: (id: string) => void; controller: GameplayController; sources: GameplaySources; onOpenLink: (link: GameplayLink) => void };
export function GameplayDesigns({ controller, selectedId, onSelect: setSelectedId, sources, onOpenLink }: Props) {
  const { store, blocked, update } = controller;
  const [editorTab, setEditorTab] = useState<EditorTab>('design');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [archived, setArchived] = useState(false);
  const [title, setTitle] = useState('');
  const [formError, setFormError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const newButton = useRef<HTMLButtonElement>(null);
  const filter = query.trim().toLowerCase();
  const visible = store.designs.filter(d => d.archived === archived && (status === 'all' || d.status === status) && (d.title + ' ' + d.summary).toLowerCase().includes(filter));
  const selected = visible.find(d => d.id === selectedId) ?? visible[0];
  const activeCount = store.designs.filter(d => !d.archived).length;
  const addDesign = (design: GameplayDesign) => {
    update(current => ({ ...current, designs: [...current.designs, design] }));
    setArchived(false); setStatus('all'); setQuery(''); setSelectedId(design.id); setEditorTab('design');
  };
  const create = (event: FormEvent) => {
    event.preventDefault();
    if (blocked) return;
    if (!title.trim()) { setFormError('请输入玩法名称'); return; }
    addDesign(createGameplay(title)); dialog.current?.close();
  };
  const patch = (id: string, changes: Partial<GameplayDesign>) => update(current => ({ ...current,
    designs: current.designs.map(d => d.id === id ? { ...d, ...changes, updatedAt: new Date().toISOString() } : d) }));
  return <section className="gp-workspace" aria-label="玩法设计工作区">
    <div className="gp-library">
      <div className="gp-library-heading"><div><span className="gp-kicker">GAMEPLAY LIBRARY</span><h2>玩法库 <small>{activeCount}</small></h2></div>
        <button className="gp-icon" ref={newButton} aria-label="新建玩法" disabled={blocked} onClick={() => { setTitle(''); setFormError(''); dialog.current?.showModal(); nameInput.current?.focus(); }}><Plus size={18} /></button></div>
      <label className="gp-search"><Search size={16} /><input type="search" aria-label="搜索玩法" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索名称或说明…" /></label>
      <div className="gp-filters"><label>设计状态<select aria-label="玩法状态筛选" value={status} onChange={e => setStatus(e.target.value)}><option value="all">全部状态</option>{gameplayStatuses.map(s => <option key={s}>{s}</option>)}</select></label>
        <label>显示范围<select aria-label="玩法范围" value={archived ? 'archived' : 'active'} onChange={e => setArchived(e.target.value === 'archived')}><option value="active">有效玩法</option><option value="archived">已归档（{store.designs.length - activeCount}）</option></select></label></div>
      <div className="gp-list">{visible.map(d => <button key={d.id} className={'gp-list-card' + (selected?.id === d.id ? ' selected' : '')} aria-label={'打开玩法：' + (d.title || '未命名玩法')} aria-pressed={selected?.id === d.id} onClick={() => setSelectedId(d.id)}>
        <span className={'gp-badge' + (d.status === '已验证' ? ' verified' : '')}>{d.status}</span><strong>{d.title || '未命名玩法'}</strong><p>{d.summary || '补充一句话，描述玩家在这里做什么。'}</p>
        <small>{d.prototype.filter(i => i.done).length}/{d.prototype.length} 项制作完成 · {d.checks.filter(c => c.result === '通过').length}/{d.checks.length} 项验证通过</small></button>)}</div>
      {!visible.length && <p className="gp-muted gp-list-empty">{store.designs.length ? '当前筛选下没有玩法' : '从一个想法开始，逐步补充规则和验证方式。'}</p>}
    </div>
    <div className="gp-detail">
      {blocked ? <div className="gp-empty" role="status"><FileText size={34} /><h2>玩法存档暂时无法读取</h2><p>请恢复存档后重新打开项目，现有内容未被覆盖。</p></div>
        : selected ? <GameplayEditor key={selected.id} design={selected} designs={store.designs} tab={editorTab} onTab={setEditorTab} onNavigate={id => { const next = store.designs.find(d => d.id === id); if (next) { setQuery(''); setStatus('all'); setArchived(next.archived); setSelectedId(id); } }} sources={sources} onChange={changes => patch(selected.id, changes)}
          onCopy={() => addDesign(duplicateGameplay(selected))} onArchive={() => { patch(selected.id, { archived: !selected.archived }); setArchived(!selected.archived); setSelectedId(selected.id); }} onOpenLink={onOpenLink} />
          : <div className="gp-empty"><Gamepad2 size={36} /><span className="gp-kicker">从想法到第一次试玩</span><h2>{store.designs.length ? '选择或新建一个玩法' : '设计你的第一个玩法'}</h2><p>写下玩家的目标、行动与反馈，再确定这次原型要验证什么。无需连接引擎。</p>
            <div className="gp-empty-flow"><span>体验目标</span><ArrowRight size={15} /><span>玩法规则</span><ArrowRight size={15} /><span>试玩验证</span></div>
            <button className="primary" onClick={() => newButton.current?.click()}><Plus size={16} />创建第一个玩法</button></div>}
    </div>
    <dialog className="gp-dialog" ref={dialog} aria-labelledby="gp-new-title" onClose={() => newButton.current?.focus()}>
      <form onSubmit={create}><div className="gp-card-heading"><div><span className="gp-kicker">NEW GAMEPLAY</span><h2 id="gp-new-title">新建玩法</h2></div><button type="button" className="gp-icon" aria-label="关闭新建玩法" onClick={() => dialog.current?.close()}><X size={19} /></button></div>
        <p className="gp-muted">先给玩法起个名字，其他内容可以边做原型边补充。</p><label className="gp-field">玩法名称<input ref={nameInput} required value={title} onChange={e => { setTitle(e.target.value); setFormError(''); }} placeholder="例如：抵挡一波敌人" /></label>
        {formError && <p className="field-error" role="alert">{formError}</p>}<div className="gp-dialog-actions"><button type="button" className="gp-secondary" onClick={() => dialog.current?.close()}>取消</button><button className="primary" type="submit">创建玩法</button></div>
      </form>
    </dialog>
  </section>;
}
function GameplayEditor({ design: d, designs, tab, onTab, onNavigate, sources, onChange, onCopy, onArchive, onOpenLink }: {
  design: GameplayDesign; designs: GameplayDesign[]; tab: EditorTab; onTab: (tab: EditorTab) => void; onNavigate: (id: string) => void; sources: GameplaySources; onChange: (changes: Partial<GameplayDesign>) => void; onCopy: () => void; onArchive: () => void; onOpenLink: (link: GameplayLink) => void;
}) {
  const [linkKind, setLinkKind] = useState<GameplayLink['kind']>('story');
  const [targetId, setTargetId] = useState('');
  const choices = (linkKind === 'story' ? sources.stories.map(s => ({ id: s.id, name: s.title })) : sources.datasets.map(t => ({ id: t.key, name: t.label })))
    .filter(choice => !d.links.some(link => link.kind === linkKind && link.targetId === choice.id));
  const completed = d.prototype.filter(i => i.done).length;
  const passed = d.checks.filter(c => c.result === '通过').length;
  const progress = d.prototype.length ? Math.round(completed / d.prototype.length * 100) : 0;
  return <>
    <div className="gp-editor-heading"><div><span className="gp-kicker">GAMEPLAY DESIGN</span><h2>{d.title || '未命名玩法'}</h2><p className="gp-muted">最后编辑：{new Date(d.updatedAt).toLocaleString()}</p></div>
      <div className="gp-actions"><button className="gp-secondary" onClick={onCopy}><Copy size={15} />复制玩法</button><button className="gp-secondary" onClick={onArchive}>{d.archived ? <RotateCcw size={15} /> : <Archive size={15} />}{d.archived ? '恢复玩法' : '归档玩法'}</button></div></div>
    {d.archived && <p className="gp-archive-notice" role="status">此玩法已归档。恢复后可以继续编辑，也可以复制成新的方案。</p>}
    <div className="gp-structure-tabs" role="tablist" aria-label="玩法设计分页">{([['design', '设计说明', null], ['relations', '系统关系', d.dependencies.length], ['rules', '条件规则', d.conditionRules.length], ['flow', '状态流程', d.stateFlow.states.length]] as const).map(([id, name, count]) => <button role="tab" key={id} id={'gp-tab-' + id} aria-controls={'gp-panel-' + id} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onKeyDown={e => { const ids: EditorTab[] = ['design', 'relations', 'rules', 'flow']; const index = ids.indexOf(tab); const next = e.key === 'ArrowRight' ? ids[(index + 1) % ids.length] : e.key === 'ArrowLeft' ? ids[(index + ids.length - 1) % ids.length] : e.key === 'Home' ? ids[0] : e.key === 'End' ? ids[ids.length - 1] : null; if (next) { e.preventDefault(); onTab(next); document.getElementById('gp-tab-' + next)?.focus(); } }} onClick={() => onTab(id)}>{name}{count !== null && <small>{count}</small>}</button>)}</div>
    <div className="gs-panel" role="tabpanel" id={'gp-panel-' + tab} aria-labelledby={'gp-tab-' + tab}>
    {tab === 'relations' && <GameplayDependencies design={d} designs={designs} disabled={d.archived} onChange={onChange} onNavigate={onNavigate} />}
    {tab === 'rules' && <GameplayRules design={d} disabled={d.archived} onChange={onChange} />}
    {tab === 'flow' && <GameplayStateFlow design={d} disabled={d.archived} onChange={onChange} />}
    {tab === 'design' && <><div className="gp-stats"><div><span>原型制作</span><strong>{completed}<small> / {d.prototype.length}</small></strong><div className="gp-progress" aria-label={'制作完成 ' + progress + '%'}><span style={{ width: progress + '%' }} /></div></div>
      <div><span>试玩验证</span><strong>{passed}<small> / {d.checks.length} 通过</small></strong><p>制作完成后，仍需实际试玩验证。</p></div></div>
    <fieldset className="gp-editor-fields" disabled={d.archived}>
      <section className="gp-card"><div className="gp-card-heading"><h3>基本信息</h3><span className="gp-muted">可以逐步补充</span></div><div className="gp-two-fields">
        <label className="gp-field">玩法名称<input value={d.title} onChange={e => onChange({ title: e.target.value })} placeholder="为这个玩法起个名字" /></label>
        <label className="gp-field">设计状态<select aria-label="设计状态" value={d.status} onChange={e => onChange({ status: e.target.value as GameplayStatus })}>{gameplayStatuses.map(s => <option key={s}>{s}</option>)}</select></label></div>
        <label className="gp-field">一句话说明<textarea aria-label="一句话说明" rows={2} value={d.summary} onChange={e => onChange({ summary: e.target.value })} placeholder="玩家要做什么？例如：利用有限资源布置防御，抵挡一波敌人。" /></label>
        <label className="gp-field">体验目标<textarea aria-label="体验目标" rows={3} value={d.experience} onChange={e => onChange({ experience: e.target.value })} placeholder="希望玩家感受到什么？有哪些有意义的选择？" /></label></section>
      <section className="gp-card"><div className="gp-card-heading"><div><h3>核心循环</h3><p className="gp-muted">用连续步骤描述玩家的行动、反馈和下一步。</p></div><button className="gp-secondary" onClick={() => onChange({ loop: [...d.loop, { id: crypto.randomUUID(), text: '' }] })}><Plus size={15} />添加步骤</button></div>
        <ol className="gp-loop">{d.loop.map((step, index) => <li key={step.id}><span className="gp-step-number">{index + 1}</span><input aria-label={'循环步骤 ' + (index + 1)} value={step.text} onChange={e => onChange({ loop: d.loop.map(s => s.id === step.id ? { ...s, text: e.target.value } : s) })} placeholder="例如：探索并收集资源" />
          <button className="gp-icon" aria-label={'上移步骤 ' + (index + 1)} disabled={index === 0} onClick={() => onChange({ loop: moveGameplayItem(d.loop, index, -1) })}><ArrowUp size={15} /></button>
          <button className="gp-icon" aria-label={'下移步骤 ' + (index + 1)} disabled={index === d.loop.length - 1} onClick={() => onChange({ loop: moveGameplayItem(d.loop, index, 1) })}><ArrowDown size={15} /></button>
          <button className="gp-icon" aria-label={'删除步骤 ' + (index + 1)} onClick={() => onChange({ loop: d.loop.filter(s => s.id !== step.id) })}><Trash2 size={15} /></button></li>)}</ol>
        {!d.loop.length && <p className="gp-placeholder">还没有步骤。可以从玩家的第一个行动开始。</p>}</section>
      <section className="gp-card"><h3>玩法规则</h3><label className="gp-field">操作、条件与反馈<textarea aria-label="操作、条件与反馈" rows={5} value={d.rules} onChange={e => onChange({ rules: e.target.value })} placeholder="描述操作方式、触发条件、资源限制、奖励与例外情况。" /></label>
        <div className="gp-two-fields"><label className="gp-field">胜利条件<textarea aria-label="胜利条件" rows={2} value={d.winCondition} onChange={e => onChange({ winCondition: e.target.value })} placeholder="按玩法需要填写" /></label>
          <label className="gp-field">失败条件<textarea aria-label="失败条件" rows={2} value={d.loseCondition} onChange={e => onChange({ loseCondition: e.target.value })} placeholder="按玩法需要填写" /></label></div></section>
      <section className="gp-card"><div className="gp-card-heading"><div><h3>原型范围</h3><p className="gp-muted">这次只需要做出哪些内容，就能开始试玩？</p></div><button className="gp-secondary" onClick={() => onChange({ prototype: [...d.prototype, { id: crypto.randomUUID(), text: '', done: false }] })}><Plus size={15} />添加制作项</button></div>
        <ul className="gp-prototype">{d.prototype.map((item, index) => <li key={item.id}><input type="checkbox" aria-label={'完成制作项 ' + (index + 1)} checked={item.done} onChange={e => onChange({ prototype: d.prototype.map(i => i.id === item.id ? { ...i, done: e.target.checked } : i) })} />
          <input aria-label={'制作项 ' + (index + 1)} value={item.text} onChange={e => onChange({ prototype: d.prototype.map(i => i.id === item.id ? { ...i, text: e.target.value } : i) })} placeholder="例如：一种敌人、一把武器、一个测试场地" />
          <button className="gp-icon" aria-label={'删除制作项 ' + (index + 1)} onClick={() => onChange({ prototype: d.prototype.filter(i => i.id !== item.id) })}><Trash2 size={15} /></button></li>)}</ul>
        {!d.prototype.length && <p className="gp-placeholder">暂无制作项，先列出最少需要实现的内容。</p>}
        <label className="gp-field">暂缓内容<textarea aria-label="暂缓内容" rows={2} value={d.deferred} onChange={e => onChange({ deferred: e.target.value })} placeholder="例如：多种敌人、正式美术、完整成长系统，留待后续验证。" /></label></section>
      <section className="gp-card"><div className="gp-card-heading"><div><h3>验证清单</h3><p className="gp-muted">记录实际试玩的结果，再决定是否验证通过。</p></div><button className="gp-secondary" onClick={() => onChange({ checks: [...d.checks, { id: crypto.randomUUID(), question: '', steps: '', expected: '', actual: '', result: '未测试' }] })}><Plus size={15} />添加验证项</button></div>
        {!d.checks.length && <div className="gp-placeholder"><FlaskConical size={19} />还没有验证项。最想通过第一次试玩确认什么？</div>}
        <div className="gp-checks">{d.checks.map((check, index) => <section className="gp-check" key={check.id} aria-label={'验证项 ' + (index + 1)}><div className="gp-card-heading"><span className="gp-check-number"><FlaskConical size={16} />验证 {index + 1}</span><div className="gp-actions"><select aria-label={'验证结论 ' + (index + 1)} value={check.result} onChange={e => onChange({ checks: d.checks.map(c => c.id === check.id ? { ...c, result: e.target.value as typeof check.result } : c) })}>{gameplayResults.map(r => <option key={r}>{r}</option>)}</select>
          <button className="gp-icon" aria-label={'删除验证项 ' + (index + 1)} onClick={() => onChange({ checks: d.checks.filter(c => c.id !== check.id) })}><Trash2 size={15} /></button></div></div>
          {([['question', '要验证的问题', '例如：玩家能否在第一波敌人到来前理解防守目标？'], ['steps', '试玩步骤', '写下测试场景、初始条件和操作步骤。'], ['expected', '预期结果', '什么表现说明这个设计成立？'], ['actual', '实际结果', '试玩后记录观察到的表现、问题和下一次调整。']] as const).map(([key, label, placeholder]) => <label className="gp-field" key={key}>{label}<textarea aria-label={label} rows={key === 'question' ? 2 : 3} value={check[key]} placeholder={placeholder} onChange={e => onChange({ checks: d.checks.map(c => c.id === check.id ? { ...c, [key]: e.target.value } : c) })} /></label>)}</section>)}</div></section>
      <section className="gp-card"><h3>关联内容</h3><p className="gp-muted">连接当前项目的故事文档或配置表，方便从设计跳到具体内容。</p>
        <div className="gp-link-controls"><label className="gp-field">内容类型<select aria-label="内容类型" value={linkKind} onChange={e => { setLinkKind(e.target.value as GameplayLink['kind']); setTargetId(''); }}><option value="story">故事文档</option><option value="dataset">配置表</option></select></label>
          <label className="gp-field">关联目标<select aria-label="关联目标" value={targetId} onChange={e => setTargetId(e.target.value)}><option value="">{choices.length ? '选择关联内容' : '暂无可关联内容'}</option>{choices.map(c => <option key={c.id} value={c.id}>{c.name || '未命名'}</option>)}</select></label>
          <button className="gp-secondary" disabled={!choices.some(c => c.id === targetId)} onClick={() => { if (choices.some(c => c.id === targetId)) { onChange({ links: [...d.links, { kind: linkKind, targetId }] }); setTargetId(''); } }}><Link2 size={15} />添加关联</button></div>
        <ul className="gp-links">{d.links.map(link => { const name = gameplayLinkName(link, sources); return <li key={link.kind + ':' + link.targetId} className={name === undefined ? 'missing' : ''}>
          <span>{link.kind === 'story' ? '故事' : '配置表'}</span><button className="gp-link-name" disabled={name === undefined} onClick={() => onOpenLink(link)}>{name === undefined ? '关联已失效：' + link.targetId : name || '未命名'}</button>
          <button className="gp-icon" aria-label={'解除关联 ' + (name ?? link.targetId)} onClick={() => onChange({ links: d.links.filter(l => l.kind !== link.kind || l.targetId !== link.targetId) })}><X size={16} /></button></li>; })}</ul>
      </section>
    </fieldset>
    <p className="gp-editor-foot"><CheckCircle2 size={15} />设计状态由你手动决定，清单完成度仅用于记录进展。</p></>}
    </div>
  </>;
}
