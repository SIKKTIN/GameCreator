import { AlertTriangle, CheckCircle2, History, ShieldCheck } from 'lucide-react';
import { changeLabels, impacts, type Change } from './enum-versions';
import { enumId, formatLuaValue } from './data-model';
import type { EnumRegistry } from './useEnumRegistry';
import './enum-review.css';

const short = (id: string) => id.slice(0, 10);
export function EnumReviewPanel({ registry }: { registry: EnumRegistry }) {
  const { active, candidate, review, changes, plan, store } = registry;
  const locked = registry.busy || registry.loading;
  const select = (change: Change, checked: boolean) => {
    if (!review) return;
    void registry.updateReview({ selected: checked ? [...review.selected, change.id] : review.selected.filter((id) => id !== change.id) });
  };
  return <div className="version-workflow">
    <div className="version-banner"><ShieldCheck size={24} /><div>
      <h3>{active ? '当前稳定版本 · ' + short(active.id) : '尚未建立稳定版本'}</h3>
      <p>{active ? '数据配置固定使用此版本。扫描、审核和扫描失败都不会替换它。' : '首次扫描仅创建候选版本，请审核后发布。'}</p>
      {active && <small>{new Date(active.createdAt).toLocaleString()} · SHA-256 {active.checksum.slice(0, 16)}</small>}
    </div></div>
    <div className="review-card">
      <div className="review-heading"><div><span>候选更新</span>
        <h3>{candidate ? short(candidate.id) + ' · ' + changes.length + ' 项差异' : '暂无待审核版本'}</h3></div>
        {candidate && <small>{new Date(candidate.createdAt).toLocaleString()}</small>}
      </div>
      {!candidate && <p className="field-hint">点击“扫描更新”发现代码变化。未批准的内容不会进入稳定版本。</p>}
      {candidate && review && <>
        <p className="field-hint">扫描目录：{candidate.scan.enumPath} · 基准 {review.baseId ? short(review.baseId) : '首次导入'} · 审核选择自动保存</p>
        <p className="field-hint">重命名以“删除旧成员 + 新增成员”呈现，请显式指定替换映射。</p>
        <p className="field-hint">未选变更保持稳定版本原定义；下次扫描仍会列出与代码的差异。</p>
        <div className="review-tools">
          <button disabled={locked} onClick={() => void registry.updateReview({ selected: changes.filter((change) => change.kind === 'add-group' || change.kind === 'add-member').map((change) => change.id) })}>只选新增</button>
          <button disabled={locked} onClick={() => void registry.updateReview({ selected: changes.map((change) => change.id) })}>选择全部</button>
          <button disabled={locked} onClick={() => void registry.updateReview({ selected: [] })}>清空选择</button>
          <span>已选 {review.selected.length} / {changes.length}</span>
        </div>
        {!changes.length && <p className="review-empty"><CheckCircle2 size={17} />枚举内容与稳定版本一致，无需发布。</p>}
        <div className="change-list">{changes.map((change) => {
          const selected = review.selected.includes(change.id);
          const affected = impacts(change, store.data);
          const count = affected.reduce((sum, field) => sum + field.records.length, 0);
          const migration = review.migrations[change.id];
          const target = plan.scan?.groups.find((group) => enumId(group) === change.groupId);
          return <article key={change.id} className={'change-card ' + (selected ? 'selected' : '')}>
            <label className="change-title"><input type="checkbox" checked={selected} disabled={locked} onChange={(event) => select(change, event.target.checked)} />
              <strong>{change.name}{change.member ? '.' + change.member : ''}</strong>
              <span className={change.risk === 'high' ? 'risk-high' : 'risk-low'}>{changeLabels[change.kind]}</span>
            </label>
            {(change.before !== undefined || change.after !== undefined) && <div className="change-values">
              <code>{change.before === undefined ? '未定义' : formatLuaValue(change.before)}</code><span>→</span>
              <code>{change.after === undefined ? '删除' : formatLuaValue(change.after)}</code>
              {change.kind === 'value' && <small>{typeof change.before} → {typeof change.after}</small>}
            </div>}
            {change.kind === 'add-group' && <small className="field-hint">{candidate.scan.groups.find((group) => enumId(group) === change.groupId)?.members.map((member) => member.key + ' = ' + formatLuaValue(member.value)).join('；')}</small>}
            <details className="change-impact"><summary>影响 {affected.length} 个字段 · {count} 处记录值</summary>
              {affected.map((field) => <p key={field.table + field.field}>{field.table}.{field.field}：
                {field.records.join('、') || '暂无匹配记录'}</p>)}
              {!affected.length && <p>当前没有字段绑定此枚举。</p>}
            </details>
            {selected && change.risk === 'high' && <label className="risk-confirm"><input type="checkbox" checked={review.acknowledged.includes(change.id)}
              disabled={locked} onChange={(event) => void registry.updateReview({
                acknowledged: event.target.checked ? [...review.acknowledged, change.id] : review.acknowledged.filter((id) => id !== change.id),
              })} />已审核此高风险变更及其数据影响</label>}
            {selected && change.kind === 'remove-member' && count > 0 && <div className="migration-editor">
              <label>原记录处理<select aria-label={change.name + '.' + change.member + ' 迁移方式'} disabled={locked} value={migration?.mode ?? ''}
                onChange={(event) => void registry.updateReview({ migrations: { ...review.migrations, [change.id]: { mode: event.target.value as 'replace' | 'retain' } } })}>
                <option value="" disabled>请选择处理方式</option><option value="replace">替换为其他成员（含重命名）</option><option value="retain">保留旧值，标记待修复并阻止导出</option>
              </select></label>
              {migration?.mode === 'replace' && <label>替换目标<select disabled={locked} aria-label={change.name + '.' + change.member + ' 替换目标'} value={migration.target ?? ''}
                onChange={(event) => void registry.updateReview({ migrations: { ...review.migrations, [change.id]: { mode: 'replace', target: event.target.value } } })}>
                <option value="" disabled>选择本次发布中保留的成员</option>
                {target?.members.map((member) => <option key={member.key} value={member.key}>{member.key} = {formatLuaValue(member.value)}</option>)}
              </select></label>}
            </div>}
            {selected && change.kind === 'remove-group' && affected.length > 0 && <p className="field-error">请先在数据配置中重新绑定这些字段，或取消本次删除。</p>}
          </article>;
        })}</div>
        <div className="review-author"><label>审核人（记录用）<input value={review.reviewer} onChange={(event) => void registry.updateReview({ reviewer: event.target.value })} /></label>
          <label>审核说明<textarea value={review.note} onChange={(event) => void registry.updateReview({ note: event.target.value })} placeholder="说明改值、删除或迁移的原因" /></label></div>
        <div className="release-preview">
          <b>发布预览：{plan.scan?.groups.length ?? 0} 组 · {plan.scan?.counts.members ?? 0} 个成员 · 迁移 {plan.patches.length} 处记录值</b>
          {plan.patches.length > 0 && <details><summary>查看迁移明细</summary>{plan.patches.map((patch, index) => <p key={index}>
            {patch.table}/{patch.rowId}/{patch.field}：{patch.before} → {patch.after}</p>)}</details>}
          {plan.errors.length > 0 && changes.length > 0 && <ul>{plan.errors.map((error) => <li key={error}>{error}</li>)}</ul>}
          {plan.warnings.length > 0 && <details><summary>{plan.warnings.length} 项数据问题，发布后仍需修正才能导出</summary>
            {plan.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details>}
        </div>
        <div className="review-actions"><button disabled={locked} onClick={() => void registry.reject()}>{changes.length ? '驳回候选版本' : '归档本次扫描'}</button>
          <button className="publish-button" disabled={locked || !!plan.errors.length} onClick={() => void registry.publish()}>
            <ShieldCheck size={15} />批准所选变更并发布稳定版本</button></div>
      </>}
    </div>
    <div className="review-card">
      <div className="review-heading"><h3><History size={17} />版本记录</h3>
        <button disabled={locked || !!registry.rollbackPlan.errors.length} onClick={() => void registry.rollback()}>
          {registry.rollbackPlan.target ? '回退到 ' + short(registry.rollbackPlan.target.id) : '暂无上一稳定版本'}</button></div>
      {registry.rollbackPlan.target && registry.rollbackPlan.errors.length > 0 && <details><summary>回退前需处理 {registry.rollbackPlan.errors.length} 项问题</summary>
        {registry.rollbackPlan.errors.map((error) => <p key={error} className="field-error">{error}</p>)}</details>}
      {!store.releases.length && <p className="field-hint">首次审核发布后生成版本记录。</p>}
      {[...store.releases].reverse().map((release) => <details className="release-history" key={release.id}>
        <summary>{release.kind === 'publish' ? '发布' : '回退'} {short(release.toId)} · {new Date(release.createdAt).toLocaleString()} · {release.reviewer}</summary>
        <p>{release.note || '无附加说明'}</p><p>基准：{release.fromId ? short(release.fromId) : '首次导入'} · 迁移 {release.patches.length} 处</p>
        {release.accepted.map((change) => <p key={change.id}>{changeLabels[change.kind]}：{change.name}{change.member ? '.' + change.member : ''}
          {change.kind === 'value' ? ' ' + formatLuaValue(change.before!) + ' → ' + formatLuaValue(change.after!) : ''}</p>)}
      </details>)}
      <details><summary>扫描记录（{store.snapshots.filter((snapshot) => snapshot.kind === 'source').length} 次）</summary>
        {store.snapshots.filter((snapshot) => snapshot.kind === 'source').slice().reverse().map((snapshot) => <p key={snapshot.id}>
          {short(snapshot.id)} · {new Date(snapshot.createdAt).toLocaleString()} · {({ draft: '待审核', approved: '已发布所选变更', rejected: '已驳回', archived: '已归档' } as const)[store.reviews[snapshot.id]?.status ?? 'archived']}
          <small className="snapshot-hash">SHA-256 {snapshot.checksum}</small>
        </p>)}
      </details>
    </div>
    <p className="version-storage"><AlertTriangle size={14} />版本与草稿保存于当前浏览器的本地存档；清除网站数据会删除这些记录。</p>
  </div>;
}
