import { useEffect, useRef } from 'react';
import { engineInfo } from './engine';
import type { SyncBinding } from './engine-sync';

export const foreignSyncBinding = (binding?: SyncBinding) => binding?.status === 'project-mismatch' || binding?.status === 'engine-mismatch';

export function EngineSyncBinding({ binding, busy, blocked, confirming, error, onRefresh, onConfirm, onCancel, onRebind }: {
  binding?: SyncBinding; busy: boolean; blocked: string; confirming: boolean; error: string;
  onRefresh: () => void; onConfirm: () => void; onCancel: () => void; onRebind: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirming) { dialog.current?.showModal(); cancel.current?.focus(); } }, [confirming]);
  if (!binding || !foreignSyncBinding(binding)) return null;
  const sameEngine = binding.status === 'project-mismatch';
  const details = <dl className="es-binding-details">
    <dt>原归属项目</dt><dd>{binding.ownerProjectId}</dd>
    <dt>当前项目</dt><dd>{binding.projectId}</dd>
    <dt>记录引擎</dt><dd>{binding.ownerEngine ? engineInfo(binding.ownerEngine).name : '未记录'}</dd>
    <dt>已有内容</dt><dd>{binding.fileCount} 个受管文件 · {binding.historyCount} 条记录</dd>
  </dl>;
  return <>
    <section className="es-binding" aria-label="工程同步归属冲突">
      <h3>{sameEngine ? '此工程仍绑定另一个 GameCreator 项目' : '此工程的同步记录使用另一种引擎'}</h3>
      <p>{sameEngine ? '旧项目升级或另存为后，项目标识可能变化。若要由当前项目继续维护此工程，请核对归属后重新绑定。' : '请选择记录对应的引擎，或更换工程目录。不同引擎之间不能重新绑定同步记录。'}</p>
      {details}
      {binding.reason && <p role="status">{binding.reason}</p>}
      <div className="gp-actions"><button className="gp-secondary" disabled={busy} onClick={onRefresh}>重新检查归属</button>{sameEngine && <button className="primary" disabled={busy || !!blocked || !binding.token} onClick={onConfirm}>重新绑定到当前项目</button>}</div>
    </section>
    {confirming && <dialog ref={dialog} className="gp-dialog es-binding-dialog" aria-labelledby="es-binding-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
      <h2 id="es-binding-title">确认重新绑定工程</h2>
      <code>{binding.root}</code>{details}
      <p>将由当前项目接续这份工程的同步记录，原项目需要重新绑定后才能继续同步。</p>
      <p>会先备份原同步清单，保留已有文件与历史。绑定完成后，需要重新预览变更；不会立即同步或覆盖工程内容。</p>
      {error && <p className="es-error" role="alert">{error}</p>}
      {blocked && <p className="es-notice" role="status">{blocked}</p>}
      <div className="gp-dialog-actions"><button ref={cancel} className="gp-secondary" disabled={busy} onClick={onCancel}>取消</button><button className="primary" disabled={busy || !!blocked || !binding.token} onClick={onRebind}>{busy ? '正在重新绑定…' : '备份并重新绑定'}</button></div>
    </dialog>}
  </>;
}
