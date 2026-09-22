import {useSearchRequest,useLeaveSearch} from './GlobalSearch';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import './enum-definitions.css';
import './project-switcher.css';
import { AlertTriangle, CheckCircle2, Database, FolderOpen, Save, Search, Settings2 } from 'lucide-react';
import {engines,engineInfo,selectEngine,savedEngineConfig,type EngineConfig} from './engine';
import { enumId, formatLuaValue } from './data-model';
import type { EnumRegistry } from './useEnumRegistry';
import { EnumReviewPanel } from './EnumReviewPanel';

export function EngineSettings({ config, setConfig, registry, onPickDirectory, onDirtyChange }: {
  config: EngineConfig;
  setConfig: (config: EngineConfig) => Promise<boolean> | boolean;
  registry: EnumRegistry;
  onPickDirectory?: () => Promise<string | null>;
  onDirtyChange?: (dirty:boolean) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<EngineConfig>({ ...config });
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const operation = useRef(false);
  useEffect(() => { setDraft({ ...config }); setError(''); setNotice(''); }, [config]);
  const adapter=engineInfo(draft.engine);
  const dirty = JSON.stringify(config)!==JSON.stringify(draft);
  useEffect(()=>{onDirtyChange?.(dirty);},[dirty,onDirtyChange]);
  const locked = saving || picking || registry.busy || registry.loading;
  const update = (key: keyof EngineConfig, value: string | boolean) => {
    setDraft(previous => ({ ...previous, [key]: value }));
    setError(''); setNotice('');
  };
  const pickDirectory = async () => {
    if (locked || operation.current || !onPickDirectory) return;
    operation.current = true; setPicking(true); setError(''); setNotice('');
    try {
      const selected = await onPickDirectory();
      if (selected) update('projectPath', selected);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { operation.current = false; setPicking(false); }
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dirty || locked || operation.current) return;
    operation.current = true; setSaving(true); setError(''); setNotice('');
    try {
      const next = savedEngineConfig({ ...draft, projectPath: draft.projectPath.trim(), enumPath: draft.enumPath.trim(), dataPath: draft.dataPath.trim() });
      if (!await setConfig(next)) { setError('设置未保存，请检查保存状态后重试。'); return; }
      setNotice('设置已保存。');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { operation.current = false; setSaving(false); }
  };
  return <form className="engine-settings" onSubmit={event => void save(event)} aria-label="引擎设置" aria-busy={saving || picking}>
    <div className="settings-intro"><div><span>ENGINE ADAPTER</span><h2>{adapter.name}</h2>
      <p>配置游戏工程目录后，可读取 {adapter.language} 枚举并审核同步。</p></div>
      <div className={`engine-badge${registry.sourceConfigured ? '' : ' engine-badge-neutral'}`}>
        {registry.sourceConfigured && registry.latestScan && <CheckCircle2 size={16} />}
        {dirty?'设置待保存':!registry.sourceConfigured ? '尚未配置引擎' : registry.latestScan?.incomplete?'扫描需处理':registry.latestScan ? '已有扫描记录' : '工程待连接'}
      </div></div>
    {!registry.sourceConfigured && <p className="engine-config-neutral" role="status">尚未配置引擎，可先编写项目内容。需要导入枚举时，再配置游戏工程目录并保存。</p>}
    <div className="settings-card"><h3>项目路径</h3>
      <label>引擎类型<select aria-label="引擎类型" value={draft.engine} onChange={(event) => {setDraft(previous=>selectEngine(previous,event.target.value));setError('');setNotice('');}} disabled={locked}>{Object.entries(engines).map(([id,e])=><option key={id} value={id}>{e.name}</option>)}</select></label>
      <div className="engine-directory-group"><label htmlFor={`${id}-project-path`}>项目目录</label><div className="engine-directory-field">
        <input id={`${id}-project-path`} value={draft.projectPath} onChange={(event) => update('projectPath', event.target.value)} placeholder="可暂留空，稍后配置游戏工程目录" disabled={saving || picking} spellCheck={false} aria-describedby={`${id}-project-hint`} />
        {onPickDirectory && <button type="button" className="engine-directory-button" disabled={locked} onClick={() => void pickDirectory()}><FolderOpen size={15} aria-hidden="true" />{picking ? '正在选择…' : '选择目录'}</button>}
      </div><small id={`${id}-project-hint`}>{draft.engine==='godot-gdscript'?'选择包含 project.godot 的 Godot 4 工程根目录。':'选择绿洲启元游戏工程根目录。'}留空并保存可暂不绑定引擎，项目内容仍独立保留。</small></div>
      <div className="settings-grid"><label>枚举定义目录<input aria-label="枚举定义目录" required={!!draft.projectPath.trim()} value={draft.enumPath} onChange={(event) => update('enumPath', event.target.value)} disabled={saving || picking} /><small>{draft.engine==='godot-gdscript'?'支持相对路径或 res://，默认扫描整个工程，跳过 .godot 缓存。':'相对于项目目录'}</small></label>
        </div><p>数据配置目录、JSON 导入导出与自动导出设置已移至“数据同步”模块。</p>
    </div>
    <div className="settings-footer engine-settings-footer"><span>{dirty ? '有未保存的设置，保存后生效' : window.desktopClient?.storage ? '设置保存在本地磁盘' : '设置保存在当前浏览器'}</span>
      <div className="engine-settings-actions"><button type="button" className="engine-test-button" disabled={locked || dirty || !registry.sourceConfigured} title={dirty ? '请先保存设置，再测试连接' : !registry.sourceConfigured ? '请先配置并保存游戏工程目录' : undefined} onClick={() => { if (!locked && !dirty && registry.sourceConfigured) void registry.refresh(); }}>
        <Database size={15} />{registry.loading ? '正在连接…' : '测试连接'}</button>
        <button type="submit" className="primary" disabled={locked || !dirty}><Save size={15} />{saving ? '正在保存…' : '保存设置'}</button></div>
    </div>
    {error && <p className="field-error" role="alert">{error}</p>}
    {notice && <p className="connection-ok" role="status">{notice}</p>}
    {registry.sourceWarning&&<p className="engine-config-neutral" role="status">{registry.sourceWarning}</p>}
    {registry.latestScan?.incomplete&&<p className="field-error">扫描未完成：{registry.latestScan.dynamic.map(d=>d.source+':'+d.line+' '+d.detail).join('；')}。修复后再审核同步。</p>}
    {registry.sourceConfigured && <p role="status" className={registry.error ? 'field-error' : 'connection-ok'}>
      {registry.error || (registry.loading ? '正在读取工程…' : registry.latestScan ? '上次扫描 · ' + registry.latestScan.files.length + ' 个 '+engineInfo(config.engine).language+' 文件 · 候选更新请到枚举管理审核' : '尚无扫描结果')}
    </p>}
    {registry.sourceConfigured && registry.latestScan && <div className="scan-result"><b>上次扫描文件</b>
      {registry.latestScan.files.map((file) => <code key={file}>{file}</code>)}</div>}
  </form>;
}
export function EnumDefinitions({ registry }: { registry: EnumRegistry }) {
  const searchRequest=useSearchRequest('枚举定义'),leaveSearch=useLeaveSearch('枚举定义');
  useEffect(()=>{if(searchRequest)setQuery(searchRequest.parent||searchRequest.id);},[searchRequest]);
  const scan = registry.active?.scan;
  const [query, setQuery] = useState('');
  useEffect(()=>{if(searchRequest?.kind==='member'){const frame=requestAnimationFrame(()=>document.querySelector('.gsearch-enum-focus')?.scrollIntoView({block:'center'}));return()=>cancelAnimationFrame(frame);}},[searchRequest,query]);
  const search = query.trim().toLowerCase();
  const matches = (text: string) => text.toLowerCase().includes(search);
  const groups = (scan?.groups ?? []).flatMap((group) => {
    if(searchRequest?.scope && query===(searchRequest.parent||searchRequest.id) && group.source!==searchRequest.scope)return [];
    const members = matches(group.name) || matches(group.comment)
      ? group.members
      : group.members.filter((member) => matches(member.key) || matches(member.comment));
    return members.length || matches(group.name) || matches(group.comment) ? [{ group, members }] : [];
  });
  const memberCount = groups.reduce((total, { members }) => total + members.length, 0);

  return <section className="enum-catalog" aria-label="枚举定义目录">{registry.sourceWarning&&<p className="engine-config-neutral" role="status">{registry.sourceWarning}</p>}
    <div className="enum-catalog-heading">
      <div><h2>枚举目录</h2><p>查看已发布的枚举和成员，用于配置数据。</p></div>
      <span className={`enum-catalog-status${scan ? ' is-published' : ''}`}>
        {scan && <CheckCircle2 size={15} />}{scan ? '已发布 · 可用' : registry.sourceConfigured ? '尚未发布' : '尚未配置引擎'}
      </span>
    </div>
    {!scan ? <div className="enum-catalog-empty" role="status">
      {registry.sourceConfigured ? <AlertTriangle size={24} /> : <Settings2 size={24} />}<h3>{registry.sourceConfigured ? '尚未发布枚举定义' : '尚未配置引擎'}</h3>
      <p>{registry.sourceConfigured ? '请管理员在“枚举管理”中扫描并审核发布，发布后即可在这里查看。' : '可先编写项目内容。需要枚举时，请管理员在“引擎设置”中配置游戏工程目录，再导入并审核。'}</p>
    </div> : <>
      <div className="enum-catalog-toolbar">
        <p role="status">{search ? `找到 ${groups.length} 组枚举 · ${memberCount} 个成员`
          : `${scan.groups.length} 组枚举 · ${memberCount} 个成员`}</p>
        <label className="enum-catalog-search"><Search size={16} aria-hidden="true" />
          <input type="search" aria-label="搜索枚举、成员或说明" placeholder="搜索枚举、成员或说明…"
            value={query} onChange={(event) => {leaveSearch();setQuery(event.target.value);}} />
        </label>
      </div>
      {groups.length ? <div className="enum-catalog-grid">{groups.map(({ group, members }) =>
        <article className="enum-catalog-group" key={enumId(group)}>
          <div className="enum-catalog-group-heading">
            <h3>{group.name}</h3><span>{members.length === group.members.length
              ? `${members.length} 个成员` : `${members.length} / ${group.members.length} 个成员`}</span>
          </div>
          {group.comment.trim() && <p className="enum-catalog-description">{group.comment}</p>}
          {members.length ? <ul className="enum-catalog-members">{members.map((member) =>
            <li key={member.key} className={searchRequest?.kind==='member'&&searchRequest.parent===group.name&&searchRequest.id===member.key?'gsearch-enum-focus':undefined}><code>{member.key}</code>
              {member.comment.trim() && <span>{member.comment}</span>}
            </li>)}</ul> : <p className="enum-catalog-description">暂无成员</p>}
        </article>)}</div>
        : <div className="enum-catalog-empty" role="status"><Search size={24} />
          <h3>{search ? '当前已发布版本中未找到' : '当前已发布版本暂无枚举定义'}</h3>
          <p>{search ? '试试其他枚举名称、成员名称或说明关键词。' : '请管理员在“枚举管理”中检查并发布所需定义。'}</p>
          {search && <button type="button" onClick={() => setQuery('')}>清除搜索</button>}
        </div>}
    </>}
  </section>;
}

export function EnumManager({ config, registry }: {
  config: EngineConfig; registry: EnumRegistry;
}) {
  const [tab, setTab] = useState<'updates' | 'import'>('updates');
  const source = registry.latestScan;
  return <section className="enum-management">{registry.sourceWarning&&<p className="engine-config-neutral" role="status">{registry.sourceWarning}</p>}
    <div role="tablist" aria-label="枚举管理分页" className="enum-management-tabs">
      <button role="tab" id="enum-updates-tab" aria-selected={tab === 'updates'} aria-controls="enum-updates-panel"
        onClick={() => setTab('updates')}>枚举更新检测{registry.changes.length > 0 && <span>{registry.changes.length}</span>}</button>
      <button role="tab" id="enum-import-tab" aria-selected={tab === 'import'} aria-controls="enum-import-panel"
        onClick={() => setTab('import')}>外部导入</button>
    </div>
    {registry.error && <p className="field-error" role="alert">{registry.error}</p>}
    {tab === 'updates' ? <div id="enum-updates-panel" role="tabpanel" aria-labelledby="enum-updates-tab">
      {!registry.sourceConfigured && !registry.candidate && !registry.active
        ? <div className="enum-catalog-empty" role="status"><Settings2 size={24} /><h3>尚未配置引擎</h3><p>可先编写项目内容。需要检测枚举更新时，请在“引擎设置”中配置游戏工程目录并保存。</p></div>
        : <>{!registry.sourceConfigured && <p className="engine-config-neutral" role="status">尚未配置引擎，当前显示已有枚举存档。配置游戏工程目录后可检测新变化。</p>}<EnumReviewPanel key={registry.key} registry={registry} onImport={() => setTab('import')} /></>}
    </div> : <div id="enum-import-panel" role="tabpanel" aria-labelledby="enum-import-tab" className="enum-import-panel">
      <div className="enum-catalog-heading"><div><h2>外部导入</h2><p>读取工程中的 {engineInfo(config.engine).language} 枚举，导入后前往更新检测决定是否同步。</p></div>
        <button className="primary" disabled={!registry.sourceConfigured || registry.loading || registry.busy} onClick={() => { if (registry.sourceConfigured) void registry.refresh(); }}>
          <Database size={16} />{registry.loading ? '正在读取…' : '从工程导入'}</button></div>
      <div className="enum-import-source"><b>当前来源</b>{registry.sourceConfigured ? <code>{config.projectPath}/{config.enumPath}</code> : <p>尚未配置引擎，可先编写项目内容。</p>}
        <p>来源目录在“引擎设置”中配置并保存。导入仅生成候选内容，不会自动更新枚举定义。</p></div>
      {source ? <>
        <div className="enum-import-result"><div><b>{source.groups.length} 组枚举 · {source.counts.members} 个成员</b>
          <p>{registry.changes.length} 项待审核差异</p></div><button className="primary" onClick={() => setTab('updates')}>前往更新检测</button></div>
        {!!source.dynamic.length && <div className="enum-import-warning">暂未导入的定义：{source.dynamic.map(item => item.name + ' · ' + item.detail).join('；')}</div>}
        <details className="enum-import-files"><summary>来源文件 · {source.files.length} 个</summary>{source.files.map(file => <code key={file}>{file}</code>)}</details>
        <div className="enum-catalog-grid">{source.groups.map(group => <article className="enum-catalog-group" key={enumId(group)}>
          <div className="enum-catalog-group-heading"><h3>{group.name}</h3><span>{group.members.length} 个成员</span></div>
          {group.comment && <p className="enum-catalog-description">{group.comment}</p>}
          <ul className="enum-catalog-members">{group.members.map(member => <li key={member.key}><code>{member.key}</code>{member.comment && <span>{member.comment}</span>}</li>)}</ul>
          <details className="enum-import-files"><summary>查看只读来源详情</summary><code>{group.source}:{group.line} · {group.valueType}</code>
            {group.members.map(member => <code key={member.key}>{member.key} = {formatLuaValue(member.value)}</code>)}</details>
        </article>)}</div>
      </> : <div className="enum-catalog-empty" role="status">{registry.sourceConfigured ? <Database size={24} /> : <Settings2 size={24} />}<h3>{registry.sourceConfigured ? '尚无导入内容' : '尚未配置引擎'}</h3><p>{registry.sourceConfigured ? '点击“从工程导入”读取已配置目录。' : '请在“引擎设置”中配置游戏工程目录并保存，再回来导入枚举。'}</p></div>}
    </div>}
  </section>;
}
