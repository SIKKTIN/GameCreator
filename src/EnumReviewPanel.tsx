import {engineInfo} from './engine';
import { useState } from 'react';
import { CheckCircle2, History, Search } from 'lucide-react';
import { changeLabels, impacts, type Change } from './enum-versions';
import { enumId, formatLuaValue } from './data-model';
import type { EnumRegistry } from './useEnumRegistry';
import './enum-review.css';
import './enum-management.css';

export function changeTone(change: Change) {
  return change.kind.startsWith('add-') ? 'added' : change.kind.startsWith('remove-') ? 'removed' : 'modified';
}
const toneLabel = { added: '新增', removed: '删除', modified: '修改' };
const short = (id: string) => id.slice(0, 10);

function Decision({ changes, registry, label }: { changes: Change[]; registry: EnumRegistry; label: string }) {
  const ids = changes.map(change => change.id);
  const agreed = ids.length > 0 && ids.every(id => registry.review?.selected.includes(id));
  const declined = ids.length > 0 && ids.every(id => registry.review?.declined?.includes(id));
  return <div className="enum-decision" role="group" aria-label={label + '审核决定'}>
    <span>{agreed ? '已同意' : declined ? '不同意' : ids.some(id => registry.review?.selected.includes(id) || registry.review?.declined?.includes(id)) ? '部分已决定' : '待决定'}</span>
    <button type="button" aria-pressed={agreed} disabled={registry.busy || registry.loading}
      aria-label={'同意 ' + label} onClick={() => void registry.decide(ids, true)}>同意</button>
    <button type="button" aria-pressed={declined} disabled={registry.busy || registry.loading}
      aria-label={'不同意 ' + label} onClick={() => void registry.decide(ids, false)}>不同意</button>
  </div>;
}

function ChangeItem({ change, registry }: { change: Change; registry: EnumRegistry }) {
  const fields = impacts(change, registry.data);
  const count = fields.reduce((total, field) => total + field.records.length, 0);
  const deletionBlocked = (change.kind === 'remove-member' && count > 0) || (change.kind === 'remove-group' && fields.length > 0);
  const label = change.name + (change.member ? '.' + change.member : '') + ' · ' + changeLabels[change.kind];
  const tone = changeTone(change);
  return <div className={'enum-change-item ' + tone} data-change-kind={change.kind}>
    <div className="enum-change-line"><span className={'enum-change-badge ' + tone}>{changeLabels[change.kind]}</span>
      <Decision changes={[change]} registry={registry} label={label} /></div>
    <details className="enum-readonly-diff"><summary>查看差异与影响 · {fields.length} 个字段 / {count} 条记录</summary>
      {(change.before !== undefined || change.after !== undefined) && <div className="enum-diff-values">
        <div><small>当前定义</small><code>{change.before === undefined ? '未定义' : formatLuaValue(change.before)}</code></div>
        <div><small>导入内容</small><code>{change.after === undefined ? '将删除' : formatLuaValue(change.after)}</code></div>
      </div>}
      {!fields.length && <p>没有字段引用此枚举。</p>}
      {fields.map(field => <p key={field.table + '.' + field.field}>{field.table}.{field.field}：{field.records.join('、') || '暂无使用记录'}</p>)}
      <p>内容只读。如需修改定义，请在来源工程中修改后重新检测。</p>
    </details>
    {deletionBlocked && <p className="enum-delete-blocked">仍有引用，请先到“数据配置”处理，再同意同步此删除。</p>}
  </div>;
}

export function EnumReviewPanel({ registry, onImport }: { registry: EnumRegistry; onImport: () => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('changes');
  const [message, setMessage] = useState('');
  const { active, candidate, changes, review, plan } = registry;
  const stable = active?.scan;
  const incoming = candidate?.scan ?? stable;
  const search = query.trim().toLowerCase();
  const matches = (text: string) => text.toLowerCase().includes(search);
  const includeChange = (change: Change) => filter === 'all' || filter === 'changes' || changeTone(change) === filter;
  const merged = new Map((stable?.groups ?? []).map(group => [enumId(group), group]));
  for (const group of incoming?.groups ?? []) merged.set(enumId(group), group);
  const groups = [...merged].flatMap(([id, group]) => {
    const old = stable?.groups.find(item => enumId(item) === id);
    const groupChanges = changes.filter(change => change.groupId === id);
    const own = groupChanges.filter(change => !change.member && includeChange(change));
    const whole = groupChanges.find(change => change.kind === 'add-group' || change.kind === 'remove-group');
    const members = new Map((old?.members ?? []).map(member => [member.key, member]));
    for (const member of group.members) members.set(member.key, member);
    const groupMatches = matches(group.name) || matches(group.comment);
    const rows = [...members.values()].filter(member => {
      const memberChanges = groupChanges.filter(change => change.member === member.key);
      const included = filter === 'all' || (whole ? includeChange(whole) : memberChanges.some(includeChange)) || own.length > 0;
      return included && (groupMatches || matches(member.key) || matches(member.comment));
    });
    const visibleOwn = own.filter(() => groupMatches || rows.length > 0);
    return rows.length || visibleOwn.length || (filter === 'all' && groupMatches)
      ? [{ id, group, old, groupChanges, own: visibleOwn, whole, rows }] : [];
  });
  const agreed = changes.filter(change => review?.selected.includes(change.id)).length;
  const declined = changes.filter(change => review?.declined?.includes(change.id)).length;
  const counts = (tone: string) => changes.filter(change => changeTone(change) === tone).length;
  const sync = async () => { setMessage(''); if (await registry.publish()) setMessage('已同步同意的变更，枚举定义已更新。'); };

  return <div className="enum-update-panel">{candidate?.scan.incomplete&&<p role="alert" className="field-error">扫描未完成，暂不可同步：{candidate.scan.dynamic.map(d=>d.source+':'+d.line+' '+d.detail).join('；')}</p>}
    <div className="enum-catalog-heading"><div><h2>枚举更新检测</h2>
      <p>对比已发布定义与导入内容，决定是否同步。所有变更内容均为只读。</p></div>
      <button type="button" className="primary" disabled={!registry.sourceConfigured || registry.busy || registry.loading}
        onClick={() => { setMessage(''); void registry.refresh(); }}>{registry.loading ? '检测中…' : '检测更新'}</button>
    </div>
    {registry.canConfirmSource&&<div className="engine-config-neutral"><p>新来源的枚举内容与当前定义一致，可以确认切换来源，保留配置数据。</p><button disabled={registry.loading||registry.busy} onClick={()=>void registry.confirmSource()}>确认使用此枚举来源</button></div>}
    <div className="enum-update-summary">
      {(['added', 'removed', 'modified'] as const).map(tone => <span key={tone} className={'enum-change-badge ' + tone}>{toneLabel[tone]} {counts(tone)}</span>)}
      <span>{active ? '当前已有发布版本' : '首次导入，尚未发布'}{candidate ? ' · ' + new Date(candidate.createdAt).toLocaleString() : ''}</span>
    </div>
    <div className="enum-catalog-toolbar">
      <label className="enum-catalog-search"><Search size={16} /><input type="search" aria-label="搜索待审核枚举或成员"
        placeholder="搜索枚举、成员或说明…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label className="enum-review-filter">显示<select aria-label="筛选变更" value={filter} onChange={event => setFilter(event.target.value)}>
        <option value="changes">仅变化</option><option value="all">全部</option><option value="added">新增</option>
        <option value="removed">删除</option><option value="modified">修改</option>
      </select></label>
    </div>
    {message && <p className="enum-sync-success" role="status"><CheckCircle2 size={16} />{message}</p>}
    {!groups.length ? <div className="enum-catalog-empty">
      <CheckCircle2 size={24} /><h3>{search ? '没有匹配的枚举或成员' : changes.length ? '当前筛选下没有变更' : candidate || active ? '暂无待同步的变更' : '等待导入枚举'}</h3>
      <p>{!candidate && !active ? '从工程目录导入枚举后，在这里决定是否同步。' : '枚举定义只会在同步已同意的变更后更新。'}</p>
      {!candidate && !active && <button onClick={onImport}>前往外部导入</button>}
    </div> : <div className="enum-catalog-grid">{groups.map(({ id, group, old, groupChanges, own, whole, rows }) =>
      <article key={id} className={'enum-catalog-group enum-review-group' + (whole ? ' ' + changeTone(whole) : '')}>
        <div className="enum-catalog-group-heading"><h3>{group.name}</h3><span>{groupChanges.length ? '当前 ' + (old?.members.length ?? 0) + ' · 导入 ' + (whole?.kind === 'remove-group' ? 0 : group.members.length) : group.members.length + ' 个成员'}</span></div>
        {group.comment && <p className="enum-catalog-description">{group.comment}</p>}
        {groupChanges.length > 1 && <div className="enum-group-decision"><small>本组全部 {groupChanges.length} 项变更</small>
          <Decision changes={groupChanges} registry={registry} label={group.name + ' 整组全部变更'} /></div>}
        {own.map(change => <ChangeItem key={change.id} change={change} registry={registry} />)}
        <ul className="enum-catalog-members">{rows.map(member => {
          const memberChanges = groupChanges.filter(change => change.member === member.key && includeChange(change));
          const tone = whole ? changeTone(whole) : memberChanges.length ? changeTone(memberChanges[0]) : '';
          return <li key={member.key} className={'enum-review-member ' + tone}><div className="enum-member-name">
            <code>{member.key}</code>{tone && <span className={'enum-change-badge ' + tone}>{toneLabel[tone as keyof typeof toneLabel]}</span>}
            {member.comment && <span>{member.comment}</span>}</div>
            {memberChanges.map(change => <ChangeItem key={change.id} change={change} registry={registry} />)}
          </li>;
        })}</ul>
      </article>)}</div>}
    {candidate && changes.length > 0 && <div className="enum-sync-bar">
      <div><b>同意 {agreed} · 不同意 {declined} · 待决定 {changes.length - agreed - declined}</b>
        <p>决定自动保存；点击同步后，仅已同意的变更进入枚举定义。</p></div>
      <button className="primary" disabled={registry.busy || registry.loading || !agreed || plan.errors.length > 0} onClick={() => void sync()}>同步已同意的变更</button>
      {agreed > 0 && plan.errors.length > 0 && <ul role="alert">{plan.errors.map(error => <li key={error}>{error}</li>)}</ul>}
    </div>}
    <EnumHistory registry={registry} />
  </div>;
}

function EnumHistory({ registry }: { registry: EnumRegistry }) {
  return <details className="enum-history"><summary><History size={16} />版本历史 · {registry.store.releases.length} 次发布或回退</summary>
    <button disabled={registry.busy || registry.loading || registry.rollbackPlan.errors.length > 0}
      onClick={() => void registry.rollback()}>回退到上一稳定版本</button>
    {registry.rollbackPlan.target && registry.rollbackPlan.errors.map(error => <p className="field-error" key={error}>{error}</p>)}
    {!registry.store.releases.length && <p>同步变更后生成版本记录。</p>}
    {[...registry.store.releases].reverse().map(release => <details key={release.id} className="release-history">
      <summary>{release.kind === 'publish' ? '同步' : '回退'} {short(release.toId)} · {new Date(release.createdAt).toLocaleString()} · {release.reviewer}</summary>
      <p>{release.note}</p><p>{(()=>{const scan=registry.store.snapshots.find(s=>s.id===release.toId)?.scan;return scan?engineInfo(scan.engine).name+' · '+scan.projectPath+'/'+scan.enumPath:'';})()}</p>{release.accepted.map(change => <p key={change.id}>{changeLabels[change.kind]}：{change.name}{change.member ? '.' + change.member : ''}</p>)}
    </details>)}
    <details><summary>检测与审核记录</summary>{[...registry.store.snapshots].reverse().filter(snapshot => snapshot.kind === 'source').map(snapshot => {
      const review = registry.store.reviews[snapshot.id];
      return <p key={snapshot.id}>{new Date(snapshot.createdAt).toLocaleString()} · {engineInfo(snapshot.scan.engine).name} · {snapshot.scan.projectPath}/{snapshot.scan.enumPath} · 同意 {review?.selected.length ?? 0} / 不同意 {review?.declined?.length ?? 0}
        · {({ draft: '审核中', approved: '已同步', rejected: '已驳回', archived: '已归档' } as const)[review?.status ?? 'archived']}</p>;
    })}</details>
    <p>{window.desktopClient?.storage ? '审核决定与版本记录自动保存到本地磁盘。' : '审核决定与版本记录保存于当前浏览器。'}</p>
  </details>;
}
