import {useState,type ReactNode} from 'react';
import type {EnumRegistry} from './useEnumRegistry';
import {releaseDiff} from '../shared/data-releases.mjs';
import './data-sync.css';
export function DataChanges({registry}:{registry:EnumRegistry}) {
  const current=registry.store.dataReleases?.releases.find(r=>r.id===registry.store.dataReleases?.activeId),changes=releaseDiff(registry.data,current?.data);
  return <details className="ds-version-diff"><summary>{current?'相对稳定版 '+current.version:'尚未发布稳定版'} · {changes.length} 张表有变更</summary>{changes.map(c=><p key={c.table}><strong>{c.table}</strong> · {c.kind} · {c.fields.length} 个字段定义变化 · 新增 {c.added} / 修改 {c.changed} / 删除 {c.removed} 条记录{c.fields.length>0&&<small>字段：{c.fields.join('、')}</small>}</p>)}{!changes.length&&<p>开发版与稳定版内容一致。</p>}</details>;
}
export function DataVersions({registry,children,onOpenSync}:{registry:EnumRegistry;children:ReactNode;onOpenSync:()=>void}) {
  const [tab,setTab]=useState<'development'|'stable'>('development'),[releaseId,setReleaseId]=useState(''),[table,setTable]=useState('');
  const versions=registry.store.dataReleases,release=versions?.releases.find(r=>r.id===(releaseId||versions.activeId))||versions?.releases[0];
  const tables=Object.keys(release?.data.datasets||{}),selected=tables.includes(table)?table:tables[0],columns=release?.data.columns[selected]||[];
  return <div className="data-version-workspace"><div className="data-sync ds-version-bar"><div className="ds-tabs" role="tablist" aria-label="配置数据版本"><button role="tab" aria-selected={tab==='development'} onClick={()=>setTab('development')}>开发版</button><button role="tab" aria-selected={tab==='stable'} onClick={()=>setTab('stable')}>稳定版{release?' · '+release.version:''}</button><button onClick={onOpenSync}>同步与发布 →</button></div><p>{tab==='development'?'编辑字段与记录；引擎导入仅更新开发版。':'稳定版为发布时的只读快照，开发修改不会影响它。'}</p></div>
    {tab==='development'?<><DataChanges registry={registry}/>{children}</>:<section className="data-sync ds-stable" aria-label="稳定版配置">
      {!release?<div className="ds-empty"><h3>还没有稳定版本</h3><p>现有数据已作为开发版保留。在引擎验证完成后，发布第一份稳定快照。</p><button onClick={onOpenSync}>前往发布稳定版</button></div>:<>
      <div className="ds-toolbar"><label>历史版本 <select aria-label="选择稳定版本" value={release.id} onChange={e=>{setReleaseId(e.target.value);setTable('');}}>{versions?.releases.map(r=><option key={r.id} value={r.id}>{r.version} · {new Date(r.at).toLocaleString()}</option>)}</select></label><button disabled={registry.busy||!!registry.error} onClick={()=>{if(window.confirm('将此快照恢复到开发版？当前开发修改会被替换，稳定版历史保持不变。恢复后需重新核对当前引擎与枚举。'))void registry.restoreDataRelease(release.id).then(ok=>{if(ok)setTab('development');});}}>恢复此版本到开发版</button></div><p>{release.note}</p>
      <label>配置表 <select aria-label="稳定版配置表" value={selected||''} onChange={e=>setTable(e.target.value)}>{tables.map(t=><option key={t}>{t}</option>)}</select></label>
      <div className="ds-table-scroll"><table className="ds-compare-table"><thead><tr>{columns.map(c=><th key={c.key}>{c.label}<small> {c.key}</small></th>)}</tr></thead><tbody>{release.data.datasets[selected]?.map(row=><tr key={row.id}>{columns.map(c=><td key={c.key}>{row[c.key]}</td>)}</tr>)}</tbody></table></div><p>{release.data.datasets[selected]?.length||0} 条记录 · {columns.length} 个字段 · 只读</p>
      <details><summary>查看此版本字段定义</summary><pre>{JSON.stringify(columns,null,2)}</pre></details></>}
    </section>}
  </div>;
}
