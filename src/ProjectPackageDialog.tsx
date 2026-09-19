import { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, FolderInput, FolderOutput, LoaderCircle, X } from 'lucide-react';
import type { ProjectPackageDocument } from './project-package';
import './prototype-import.css';
import './project-package.css';

export type ProjectTransferState = {
  mode: 'import' | 'export'; busy: boolean; document?: ProjectPackageDocument;
  token?: string; directory?: string; fileCount?: number; error?: string;
};

export function ProjectPackageDialog({ state, names, onClose, onChoose, onImport }: {
  state: ProjectTransferState | null; names: string[]; onClose: () => void;
  onChoose: () => void; onImport: (name: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const id = useId();
  useEffect(() => {
    if (state && !ref.current?.open) ref.current?.showModal();
    if (!state && ref.current?.open) ref.current.close();
  }, [!!state]);
  useEffect(() => {
    if (!state?.token || !state.document) return;
    const base = state.document.project.name;
    let result = base, index = 1;
    while (names.includes(result)) result = base + (index++ === 1 ? '（副本）' : `（副本 ${index - 1}）`);
    setName(result);
  }, [state?.token]);
  const importing = state?.mode === 'import';
  const title = importing ? '从文件夹导入项目' : '导出项目到文件夹';
  const archives = state?.document?.archives;
  const files = archives?.['art-assets'].assets.flatMap(asset => asset.versions.flatMap(version => version.files)) ?? [];
  const fileCount = new Set(files.map(file => file.storagePath)).size;
  return <dialog ref={ref} className="pi-dialog pp-dialog" aria-labelledby={id + '-title'}
    onCancel={event => { event.preventDefault(); if (!state?.busy) onClose(); }}>
    <form aria-busy={state?.busy} onSubmit={event => { event.preventDefault(); if (state?.token && !state.busy && name.trim()) void onImport(name.trim()); }}>
      <div className="pi-heading"><div><span className="pi-kicker">PORTABLE PROJECT</span><h2 id={id + '-title'}>{title}</h2></div>
        <button className="pi-close" type="button" aria-label="关闭项目迁移" disabled={state?.busy} onClick={onClose}><X size={19} /></button></div>
      <p className="pi-description">{importing ? '选择导出的项目文件夹，恢复为独立的本地项目。玩法、系统、配置、枚举版本和美术文件会一起导入。' : '保存当前项目的完整副本。将整个文件夹复制到其他电脑，即可在客户端中导入。'}</p>
      {state?.busy && <div className="pp-progress" role="status"><LoaderCircle className="pi-spinner" size={20} />{state.token ? '正在校验并恢复项目…' : importing ? '正在选择并检查项目文件夹…' : '正在保存项目数据和美术文件…'}</div>}
      {state?.directory && <div className="pp-success" role="status"><CheckCircle2 size={22} /><div><strong>项目已导出</strong><p>{state.directory}</p><small>{state.fileCount} 个美术文件已包含在项目文件夹中。</small></div></div>}
      {importing && archives && <>
        <div className="pp-summary"><strong>{state?.document?.project.name}</strong><dl>
          <div><dt>玩法设计</dt><dd>{archives.gameplay.designs.length}</dd></div>
          <div><dt>功能系统</dt><dd>{archives['functional-systems'].systems.length}</dd></div>
          <div><dt>美术需求</dt><dd>{archives['art-assets'].requirements.length}</dd></div>
          <div><dt>美术文件</dt><dd>{fileCount}</dd></div>
          <div><dt>故事文档</dt><dd>{archives.stories.length}</dd></div>
          <div><dt>数据记录</dt><dd>{Object.values(archives['enum-versions'].data.datasets).reduce((sum, rows) => sum + rows.length, 0)}</dd></div>
        </dl></div>
        <label className="pi-name-field" htmlFor={id + '-name'}>项目名称<input id={id + '-name'} required maxLength={100} disabled={state?.busy} value={name} onChange={event => setName(event.target.value)} /></label>
        <p className="pi-note">导入后自动打开。游戏工程目录需在“引擎设置”中重新连接，已保存的枚举版本可继续查看。</p>
      </>}
      {state?.error && <p className="pi-error" role="alert">{state.error}</p>}
      <div className="pi-actions"><span>{importing ? '创建独立副本 · 保留完整版本记录' : '普通文件夹 · 可直接复制'}</span><div>
        <button className="pi-secondary" type="button" disabled={state?.busy} onClick={onClose}>{state?.directory ? '完成' : '取消'}</button>
        {!state?.directory && <button className="pi-secondary" type="button" disabled={state?.busy} onClick={onChoose}>{importing ? '重新选择文件夹' : '重新选择导出位置'}</button>}
        {importing && state?.token && <button className="pi-submit" type="submit" disabled={state.busy || !name.trim()}><FolderInput size={16} />导入并打开</button>}
        {!importing && state?.busy && <FolderOutput size={18} />}
      </div></div>
    </form>
  </dialog>;
}
