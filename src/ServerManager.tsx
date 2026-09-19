import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Copy, Play, RefreshCw, Server, Square } from 'lucide-react';
import type { UserRole } from './auth';
import './server-manager.css';

export type HostStatus = {
  state: 'stopped' | 'running' | 'external' | 'unavailable' | 'stopping'; managed: boolean;
  url: string; port: number; configuredDataDirectory: string; dataDirectory: string | null; startedAt: string | null;
  background: boolean; message: string;
};
const labels: Record<HostStatus['state'], string> = { stopped: '未启动', running: '运行中', external: '外部服务运行中', unavailable: '端口不可用', stopping: '正在停止' };

export type ServerModuleNavigation = { serverPage: ReactNode; onManageServer: () => void; onLeaveServer: () => void;
  adminPageName?: '服务器管理'|'用户与权限'; onManageUsers?: () => void };
type ServerManagerProps = { role: UserRole; onBack: () => void; returnToConnection: boolean; onUseAddress: (address: string) => void };

export function ServerManager(props: ServerManagerProps) {
  return props.role === 'admin' ? <ServerManagerPage {...props} /> : null;
}

function ServerManagerPage({ onBack, returnToConnection, onUseAddress }: ServerManagerProps) {
  const api = window.desktopClient?.collaborationHost;
  const active = useRef(true), busyRef = useRef(false), sequence = useRef(0);
  const [status, setStatus] = useState<HostStatus | null>(null);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [queryError, setQueryError] = useState(''), [copied, setCopied] = useState(false), [confirmStop, setConfirmStop] = useState(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    let mounted = true, timer: number;
    const refresh = async () => {
      if (!busyRef.current && api) {
        const request = ++sequence.current;
        try { const result = await api.status(); if (mounted && request === sequence.current) { setStatus(result); setQueryError(''); } }
        catch (reason) { if (mounted && request === sequence.current) setQueryError((reason as Error).message); }
      }
      if (mounted) timer = window.setTimeout(refresh, 3000);
    };
    void refresh();
    return () => { mounted = false; window.clearTimeout(timer); };
  }, [api]);
  const run = async (operation: 'start' | 'stop' | 'status') => {
    if (!api || busyRef.current) return;
    busyRef.current = true; setBusy(operation); setError(''); setCopied(false); ++sequence.current;
    try { const result = await api[operation](); if (active.current) { setStatus(result); setQueryError(''); setConfirmStop(false); } }
    catch (reason) { if (active.current) setError((reason as Error).message); }
    finally { busyRef.current = false; if (active.current) setBusy(''); }
  };
  const running = status?.state === 'running' || status?.state === 'external';
  return <main className="server-manager-page" aria-label="服务器管理">
      <header><div><div className="crumb">本机管理 <span>/</span> 团队协作服务</div><h1>服务器管理</h1></div>
        <button type="button" onClick={onBack}><ArrowLeft size={15} />{returnToConnection ? '返回连接设置' : '返回工作区'}</button></header>
      <p className="server-manager-intro">在本地或团队工作区均可管理这台电脑上的协作服务器，权限以本机登录账号为准。</p>
      <section className="server-manager-card" aria-label="本机协作服务器">
      <h2>本机协作服务器</h2>
      {!api ? <p className="server-manager-error" role="alert">请使用桌面客户端管理本机服务器。</p> : <>
        <div className={'server-manager-state ' + (running ? 'is-running' : '')} role="status"><Server size={19} /><strong>{busy === 'start' ? '正在启动…' : busy === 'stop' ? '正在停止…' : status ? labels[status.state] : '正在检查…'}</strong>
          <button type="button" aria-label="刷新服务器状态" disabled={!!busy} onClick={() => void run('status')}><RefreshCw size={15} /></button></div>
        {status && <>
          <dl className="server-manager-details"><div><dt>连接地址</dt><dd><code>{status.url}</code><button type="button" disabled={!running} onClick={() => {
            void navigator.clipboard.writeText(status.url).then(() => setCopied(true)).catch(() => setError('复制失败，请手动复制上面的连接地址。'));
          }}><Copy size={13} />{copied ? '已复制' : '复制地址'}</button></dd></div>
            <div><dt>{status.state === 'external' ? '本客户端启动时的数据目录' : '数据目录'}</dt><dd>{status.dataDirectory || status.configuredDataDirectory}</dd></div>
            <div><dt>访问范围</dt><dd>本机 · 127.0.0.1</dd></div>
            {status.startedAt && <div><dt>启动时间</dt><dd>{new Date(status.startedAt).toLocaleString('zh-CN')}</dd></div>}
          </dl>
          {status.state === 'external' && <p className="server-manager-notice">{status.message} 可以直接连接；如需改由这里管理，请先在原启动位置停止该服务。</p>}
          {status.state === 'unavailable' && <p className="server-manager-error" role="alert">{status.message}</p>}
        </>}
        {(error || queryError) && <p className="server-manager-error" role="alert">{error || queryError}</p>}
        {confirmStop && <div className="server-manager-confirm" role="alert"><p>停止服务器会中断所有协作者的连接，已经保存的数据会保留。</p>
          <button type="button" disabled={!!busy} onClick={() => void run('stop')}>确认停止服务器</button><button type="button" disabled={!!busy} onClick={() => setConfirmStop(false)}>取消停止</button></div>}
        <div className="server-manager-actions"><button className="server-manager-start" type="button" disabled={!!busy || status?.state !== 'stopped'} onClick={() => void run('start')}><Play size={15} />启动服务器</button>
          <button type="button" disabled={!!busy || !status?.managed || status.state !== 'running'} onClick={() => setConfirmStop(true)}><Square size={14} />停止服务器</button>
          <button type="button" disabled={!!busy || !running} onClick={() => onUseAddress(status!.url)}>使用此地址连接</button></div>
        <p className="server-manager-footnote">关闭客户端或退出登录后，服务器继续在后台运行。重新打开客户端后，管理员仍可在这里停止服务。停止服务会保留已保存的数据。</p>
      </>}
      </section>
    </main>;
}
