import { AlertTriangle, CheckCircle2, Database, ListTree } from 'lucide-react';
import type { EngineConfig } from './engine';
import { enumId, formatLuaValue, type ProjectData } from './data-model';
import type { EnumRegistry } from './useEnumRegistry';
import { EnumReviewPanel } from './EnumReviewPanel';

export function EngineSettings({ config, setConfig, registry }: {
  config: EngineConfig; setConfig: (config: EngineConfig) => void; registry: EnumRegistry;
}) {
  const update = (key: keyof EngineConfig, value: string | boolean) => setConfig({ ...config, [key]: value });
  return <section className="engine-settings">
    <div className="settings-intro"><div><span>ENGINE ADAPTER</span><h2>绿洲启元 · Lua</h2>
      <p>扫描代码工程生成候选版本，经审核发布后供数据配置使用。</p></div>
      <div className="engine-badge">{registry.latestScan && <CheckCircle2 size={16} />}{registry.latestScan ? '已有扫描记录' : '工程待连接'}</div></div>
    <div className="settings-card"><h3>项目路径</h3>
      <label>引擎类型<select value={config.engine} onChange={(event) => update('engine', event.target.value)}><option value="oasis-lua">绿洲启元 Lua</option></select></label>
      <label>项目目录<input value={config.projectPath} onChange={(event) => update('projectPath', event.target.value)} /><small>绿洲工程根目录</small></label>
      <div className="settings-grid"><label>枚举定义目录<input value={config.enumPath} onChange={(event) => update('enumPath', event.target.value)} /><small>相对于项目目录</small></label>
        <label>数据输出目录<input value={config.dataPath} onChange={(event) => update('dataPath', event.target.value)} /><small>生成 Lua 配置的位置</small></label></div>
    </div>
    <div className="settings-card"><h3>同步行为</h3>
      <div className="setting-option"><div><b>输出格式</b><small>绿洲 Lua 配置模块</small></div><select value={config.outputFormat} onChange={(event) => update('outputFormat', event.target.value)}><option value="lua">Lua</option></select></div>
      <div className="setting-option"><div><b>自动同步</b><small>保存数据配置后自动生成 Lua 文件（待接入）</small></div>
        <button className={config.autoSync ? 'toggle on' : 'toggle'} aria-label="自动同步" disabled><span /></button></div>
      <div className="setting-option"><div><b>同步前备份</b><small>覆盖文件前保留上一版配置</small></div>
        <button className={config.backupBeforeSync ? 'toggle on' : 'toggle'} aria-label="同步前备份" onClick={() => update('backupBeforeSync', !config.backupBeforeSync)}><span /></button></div>
    </div>
    <div className="settings-footer"><span>路径自动保存于当前浏览器</span><button className="primary" disabled={registry.loading} onClick={() => void registry.refresh()}>
      <Database size={15} />{registry.loading ? '正在连接…' : '测试连接'}</button></div>
    <p role="status" className={registry.error ? 'field-error' : 'connection-ok'}>
      {registry.error || (registry.loading ? '正在读取工程…' : registry.latestScan ? '上次扫描 · ' + registry.latestScan.files.length + ' 个 Lua 文件 · 候选更新请到枚举管理审核' : '尚无扫描结果')}
    </p>
    {registry.latestScan && <div className="scan-result"><b>上次扫描文件</b>
      {registry.latestScan.files.map((file) => <code key={file}>{file}</code>)}</div>}
  </section>;
}

export function EnumManager({ config, registry, columns }: {
  config: EngineConfig; registry: EnumRegistry; columns: ProjectData['columns'];
}) {
  const scan = registry.scan;
  return <section className="enum-manager">
    <div className="enum-summary"><div><span>ENUM REGISTRY</span><h2>枚举管理</h2><p>扫描 {config.enumPath}，审核差异后发布稳定版本。</p></div>
      <button className="primary" disabled={registry.loading || registry.busy} onClick={() => void registry.refresh()}><Database size={15} />{registry.loading ? '扫描中…' : '扫描更新'}</button></div>
    {registry.error && <div role="alert" className="enum-note"><AlertTriangle size={16} color="#e7a93b" /><p>{registry.error}。当前稳定版本保持不变。</p></div>}
    <EnumReviewPanel registry={registry} />
    {!!registry.latestScan?.dynamic.length && <div className="enum-note"><AlertTriangle size={16} color="#e7a93b" /><p>动态定义未参与发布：{registry.latestScan.dynamic.map((table) => table.name + ' · ' + table.detail).join('；')}</p></div>}
    {scan && <>
      <div className="scan-summary"><b>{scan.groups.length} 组枚举 · {scan.counts.members} 个成员 · {scan.files.length} 个 Lua 文件</b>
        <span>稳定版本内容 · {scan.projectPath}</span></div>
      <div className="enum-preview-grid">{scan.groups.map((group) => {
        const used = Object.entries(columns).flatMap(([table, fields]) =>
          fields.filter((field) => field.enumId === enumId(group)).map((field) => table + '.' + field.key));
        return <article className="enum-preview" key={enumId(group)}>
          <div className="enum-detail-head"><div><span>ENGINE ENUM · {group.source}:{group.line}</span><h3>{group.name}</h3>
            <p>{group.comment || '无定义注释'}</p></div><em>{group.valueType}</em></div>
          <p className="enum-usage">使用字段：{used.join('、') || '尚未绑定'}</p>
          <div className="enum-values">{group.members.map((member) => <div key={member.key}><code>{member.key}</code><span>{formatLuaValue(member.value)}</span>
            <small>{member.comment || '无成员注释'} · L{member.line}</small></div>)}</div>
        </article>;
      })}</div>
      {scan.orderTables.length > 0 && <div className="enum-note"><ListTree size={16} color="#b5aaff" /><p>已应用排序表：{scan.orderTables.map((table) => table.name + ' (' + table.keys.length + ' 项)').join('、')}。</p></div>}
      {scan.dynamic.length > 0 && <div className="enum-note"><AlertTriangle size={16} color="#e7a93b" /><p>动态定义暂未导入：{scan.dynamic.map((table) => table.name + ' · ' + table.detail).join('；')}</p></div>}
    </>}
  </section>;
}
