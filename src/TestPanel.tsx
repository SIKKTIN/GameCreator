import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Bug, X, FlaskConical, Activity } from 'lucide-react';
import type { EngineConfig } from './engine';
import type { EnumRegistry } from './useEnumRegistry';
import { workspaceStorage } from './workspace-storage';
import { readVersions } from './enum-storage';
import { clearDebugLog, getDebugLog, logDebug, subscribeDebug } from './debug-log';
import { testScenarios, type TestScenarioId, type TestSession } from './test-scenarios';
import './test-panel.css';

type Props = {
  page: string; username: string; config: EngineConfig; registry: EnumRegistry; testSession: TestSession | null;
  busy: boolean; error: string; onLoad: (scenario: TestScenarioId) => Promise<void>; onExit: () => void;
  onNavigate: (page: string) => void;
};
type CheckResult = { title: string; result: string; status: 'ok' | 'error' | 'info' };
export function TestPanel(props: Props) {
  const { registry, testSession } = props;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'scenarios' | 'debug'>('scenarios');
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [notice, setNotice] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const logs = useSyncExternalStore(subscribeDebug, getDebugLog, getDebugLog);
  const disabled = props.busy || registry.busy || registry.loading;
  const scenario = testScenarios.find(item => item.id === testSession?.scenario);
  const counts = {
    added: registry.changes.filter(change => change.kind.startsWith('add-')).length,
    removed: registry.changes.filter(change => change.kind.startsWith('remove-')).length,
    modified: registry.changes.filter(change => !change.kind.startsWith('add-') && !change.kind.startsWith('remove-')).length,
  };
  useEffect(() => {
    let composing = false;
    const start = () => { composing = true; };
    const end = () => { composing = false; };
    const handle = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.key !== ' ') return;
      if (event.repeat || event.isComposing || composing || event.keyCode === 229 ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, button, a, summary, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="button"]')) return;
      const otherDialog = document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], .create-table-dialog');
      if (otherDialog && otherDialog !== dialog.current) return;
      event.preventDefault();
      setOpen(value => !value);
    };
    document.addEventListener('keydown', handle);
    document.addEventListener('compositionstart', start);
    document.addEventListener('compositionend', end);
    return () => {
      document.removeEventListener('keydown', handle);
      document.removeEventListener('compositionstart', start);
      document.removeEventListener('compositionend', end);
    };
  }, []);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      element.showModal(); element.focus();
    } else if (!open && element.open) {
      element.close();
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    }
  }, [open]);

  const info = () => {
    try { return window.desktopClient?.storage?.info?.(registry.key) ?? { directory: location.origin + ' / localStorage', modifiedAt: null }; }
    catch (error) { return { directory: '存档位置读取失败：' + String(error), modifiedAt: null }; }
  };
  const diskInfo = open ? info() : null;
  const report = {
    time: new Date().toISOString(), page: props.page, account: props.username,
    mode: window.desktopClient ? 'Electron' : '浏览器',
    workspace: testSession ? { type: '测试', scenario: scenario?.name, id: testSession.id } : { type: '正式' },
    projectPath: props.config.projectPath, enumPath: props.config.enumPath,
    storage: diskInfo, revision: registry.store.revision, stable: registry.active?.id ?? null, candidate: registry.candidate?.id ?? null,
    enums: { groups: registry.scan?.groups.length ?? 0, members: registry.scan?.counts.members ?? 0 },
    changes: counts, decisions: { agreed: registry.review?.selected.length ?? 0, declined: registry.review?.declined?.length ?? 0,
      pending: registry.changes.length - (registry.review?.selected.length ?? 0) - (registry.review?.declined?.length ?? 0) },
    error: props.error || registry.error, checks, recentLogs: logs.slice(-30),
  };
  const runChecks = () => {
    const result: CheckResult[] = [];
    try {
      const raw = workspaceStorage.getItem(registry.key);
      if (!raw) throw new Error('当前工程尚无存档');
      const stored = readVersions(workspaceStorage, registry.key, registry.data);
      result.push({title:'存档读取',result:'存档格式有效，读取成功',status:'ok'});
      const matches = stored.revision === registry.store.revision && stored.activeId === registry.store.activeId;
      result.push({title:'保存一致性',result:matches ? '内存与存档修订号、稳定版本一致' : '内存与存档不同，请重新加载',status:matches?'ok':'error'});
    } catch (error) { result.push({title:'存档读取',result:String(error),status:'error'}); }
    result.push({title:'枚举定义',result:registry.active ? '已发布 ' + registry.scan?.groups.length + ' 组 / ' + registry.scan?.counts.members + ' 个成员' : '尚未发布稳定版本',status:registry.active?'ok':'info'});
    result.push({title:'数据导出检查',result:registry.canExport ? '字段、枚举和引用检查通过' : registry.blockingIssues.join('；'),status:registry.canExport?'ok':'info'});
    if (testSession) {
      const isBaseline = registry.store.activeId === testSession.baselineId;
      const matches = JSON.stringify(counts) === JSON.stringify(testSession.expectedChanges);
      const failureExpected = testSession.scenario === 'error';
      result.push({title:'场景验证',result:failureExpected
        ? registry.error && isBaseline ? '检测失败且稳定版本保留，符合预期' : '等待检测失败，并检查稳定版本是否保留'
        : !isBaseline ? '已执行同步或回退，可在枚举定义中检查结果'
          : matches ? '当前新增 / 删除 / 修改数量符合初始场景预期' : '当前变化数量与初始场景不同，请检查审核操作',
        status:failureExpected ? registry.error && isBaseline ? 'ok' : 'info' : isBaseline && matches ? 'ok' : 'info'});
    }
    setChecks(result); setNotice('只读检查完成');
    logDebug('只读检查', result.some(item=>item.status==='error')?'error':'success', result.map(item=>item.title+'：'+item.result).join('；'),registry.key);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(report,null,2)); setNotice('诊断信息已复制'); }
    catch (error) { setNotice('复制失败，可展开下方诊断信息手动复制：' + String(error)); }
  };
  const navigate = (page: string) => { props.onNavigate(page); setOpen(false); };
  return <>
    <button className="test-panel-trigger" type="button" onClick={() => setOpen(true)} title="Space 打开测试面板"><Bug size={16} />测试面板 <kbd>Space</kbd></button>
    {createPortal(<dialog ref={dialog} className="test-panel" tabIndex={-1} aria-labelledby="test-panel-title"
      onCancel={event => { event.preventDefault(); setOpen(false); }}
      onClose={() => setOpen(false)}
      onClick={event => { if(event.target===dialog.current) {
        const bounds=dialog.current!.getBoundingClientRect();
        if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom) setOpen(false);
      } }}>
      <div className="test-panel-heading"><div><span>DEVELOPER TOOLS</span><h2 id="test-panel-title">测试面板</h2></div>
        <button aria-label="关闭测试面板" onClick={()=>setOpen(false)}><X size={20}/></button></div>
      <div className={'test-panel-scope '+(testSession?'is-test':'')}><b>{testSession?'测试工作区 · '+scenario?.name:'当前为正式工作区'}</b>
        <span>{testSession?'测试数据独立保存，可随时返回原工作区。':'加载场景会进入独立测试工作区。'}</span></div>
      <div className="test-panel-tabs" role="tablist" aria-label="测试面板分页">
        <button id="test-scenarios-tab" role="tab" aria-controls="test-scenarios-body" aria-selected={tab==='scenarios'} onClick={()=>setTab('scenarios')}><FlaskConical size={16}/>枚举测试</button>
        <button id="test-debug-tab" role="tab" aria-controls="test-debug-body" aria-selected={tab==='debug'} onClick={()=>setTab('debug')}><Activity size={16}/>通用调试</button>
      </div>
      <div className="test-panel-content">
        {props.error && <p className="test-panel-error" role="alert">{props.error}</p>}
        {props.busy && <p role="status">正在准备测试工程…</p>}
        {tab==='scenarios' ? <div id="test-scenarios-body" role="tabpanel" aria-labelledby="test-scenarios-tab">
          {!window.desktopClient?.prepareTestWorkspace && <p className="test-panel-hint">枚举场景需要桌面客户端；浏览器模式可使用通用调试。</p>}
          <div className="test-scenario-grid">{testScenarios.map(item=><div className="test-scenario-card" key={item.id}>
            <h3>{item.name}</h3><p>{item.expected}</p><button disabled={disabled||!window.desktopClient?.prepareTestWorkspace} onClick={()=>void props.onLoad(item.id)}>加载{item.name}</button>
          </div>)}</div>
          {testSession && <div className="test-current-scenario"><h3>当前场景：{scenario?.name}</h3><p>{scenario?.expected}</p>
            <p>初始预期：新增 {testSession.expectedChanges.added} / 删除 {testSession.expectedChanges.removed} / 修改 {testSession.expectedChanges.modified}</p>
            <p>当前结果：新增 {counts.added} / 删除 {counts.removed} / 修改 {counts.modified}</p>
            <div className="test-panel-actions"><button disabled={disabled} onClick={()=>navigate('枚举管理')}>进入枚举管理</button><button disabled={disabled} onClick={()=>navigate('枚举定义')}>查看枚举定义</button>
              <button disabled={disabled} onClick={()=>void props.onLoad(testSession.scenario)}>重置当前场景</button>
              <button disabled={disabled} onClick={props.onExit}>返回原工作区</button></div>
          </div>}
        </div> : <div id="test-debug-body" role="tabpanel" aria-labelledby="test-debug-tab">
          <dl className="test-debug-grid">
            <div><dt>运行环境</dt><dd>{report.mode} · {props.username}（管理员）</dd></div>
            <div><dt>当前页面</dt><dd>{props.page} · {testSession?'测试工作区':'正式工作区'}</dd></div>
            <div><dt>稳定版本</dt><dd>{report.stable??'尚未发布'}</dd></div>
            <div><dt>候选版本</dt><dd>{report.candidate??'暂无候选'}</dd></div>
            <div><dt>稳定枚举规模</dt><dd>{report.enums.groups} 组 · {report.enums.members} 个成员</dd></div>
            <div><dt>当前变化</dt><dd>新增 {counts.added} · 删除 {counts.removed} · 修改 {counts.modified}</dd></div>
            <div><dt>审核状态</dt><dd>待决定 {report.decisions.pending} · 同意 {report.decisions.agreed} · 不同意 {report.decisions.declined}</dd></div>
            <div><dt>存档修订</dt><dd>{report.revision} · {registry.busy?'保存中':props.error||registry.error?'存在错误':'空闲'}</dd></div>
            <div className="test-debug-wide"><dt>存档位置</dt><dd>{diskInfo?.directory}</dd></div>
            <div className="test-debug-wide"><dt>最近磁盘保存</dt><dd>{diskInfo?.modifiedAt ? new Date(diskInfo.modifiedAt).toLocaleString() : '暂无磁盘记录'}</dd></div>
            {(props.error||registry.error)&&<div className="test-debug-wide"><dt>最近错误</dt><dd className="test-panel-error">{props.error||registry.error}</dd></div>}
          </dl>
          <div className="test-panel-actions"><button onClick={runChecks} disabled={disabled}>运行只读检查</button><button onClick={()=>void copy()}>复制诊断信息</button><button onClick={()=>{clearDebugLog();setNotice('已清空面板日志');}}>清空面板日志</button></div>
          {notice&&<p role="status">{notice}</p>}
          {!!checks.length&&<ul className="test-check-results">{checks.map(item=><li key={item.title} className={item.status}><b>{item.title}</b><span>{item.result}</span></li>)}</ul>}
          <details><summary>诊断信息</summary><pre className="test-diagnostic-json">{JSON.stringify(report,null,2)}</pre></details>
          <h3>操作日志 <small>本次启动，最多 200 条</small></h3>
          <ol className="test-debug-log">{logs.slice().reverse().map(entry=><li key={entry.id} className={entry.status}>
            <time>{new Date(entry.at).toLocaleTimeString()}</time><b>{entry.action} · {entry.status==='success'?'成功':'失败'}</b><span>{entry.detail}</span>
          </li>)}</ol>{!logs.length&&<p className="test-panel-hint">暂无操作日志。</p>}
        </div>}
      </div>
      <div className="test-panel-footer"><span>Space 呼出 · Esc 关闭 · 输入区域保留空格</span><button onClick={()=>setOpen(false)}>关闭</button></div>
    </dialog>,document.body)}
  </>;
}
