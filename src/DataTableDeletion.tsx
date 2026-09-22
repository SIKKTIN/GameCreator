import { useEffect, useRef, useState, type MouseEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import type { DatasetDef, ProjectData } from './data-model';

export function useDataTableDeletion({ data, definitions, blocked, references, onDelete }: {
  data: ProjectData; definitions: DatasetDef[]; blocked: string;
  references: (key: string) => string[];
  onDelete: (key: string, expected: ProjectData) => Promise<boolean>;
}) {
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const [target, setTarget] = useState<{ key: string; expected: ProjectData } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const origin = useRef<HTMLButtonElement>(null), saving = useRef(false);
  const restore = () => { if (origin.current?.isConnected) origin.current.focus({ preventScroll: true }); else document.querySelector<HTMLInputElement>('[aria-label="搜索配置表"]')?.focus({ preventScroll: true }); };
  const close = () => { if (saving.current) return; setTarget(null); setError(''); requestAnimationFrame(restore); };
  const open = (key: string, button: HTMLButtonElement, x: number, y: number) => {
    origin.current = button;
    setMenu({ key, x: Math.max(8, Math.min(x, window.innerWidth - 208)), y: Math.max(8, Math.min(y, window.innerHeight - 60)) });
  };
  const bind = (key: string) => ({
    onContextMenu: (e: MouseEvent<HTMLButtonElement>) => { e.preventDefault(); e.stopPropagation(); open(key, e.currentTarget, e.clientX, e.clientY); },
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
      e.preventDefault(); e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); open(key, e.currentTarget, rect.left + 12, rect.top + 20);
    },
  });
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector('button')?.focus({ preventScroll: true });
    const outside = (e: Event) => { if (!(e.target instanceof Node) || !menuRef.current?.contains(e.target)) setMenu(null); };
    const dismiss = () => setMenu(null);
    document.addEventListener('pointerdown', outside); window.addEventListener('resize', dismiss);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', dismiss); };
  }, [menu]);
  useEffect(() => { if (target) { dialog.current?.showModal(); dialog.current?.querySelector<HTMLButtonElement>('button')?.focus(); } }, [target]);
  const item = definitions.find(d => d.key === target?.key), refs = target ? references(target.key) : [];
  const changed = target && JSON.stringify(target.expected) !== JSON.stringify(data);
  const reason = blocked || (!item ? '配置表已不存在。' : changed ? '配置数据已变化，请取消后重新检查再删除。' : '');
  const confirm = async () => {
    if (!target || reason || refs.length || saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try {
      if (await onDelete(target.key, target.expected)) { setTarget(null); requestAnimationFrame(restore); }
      else setError('删除未保存，请检查页面保存状态后重试。');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { saving.current = false; setBusy(false); }
  };
  const overlay = createPortal(<>
    {menu && <div ref={menuRef} className="data-table-context-menu" role="menu" aria-label="配置表操作" style={{ left: menu.x, top: menu.y }} onContextMenu={e => e.preventDefault()} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); setMenu(null); restore(); }
      if (e.key === 'Tab') setMenu(null);
    }}><button role="menuitem" onClick={() => { setTarget({ key: menu.key, expected: data }); setError(''); setMenu(null); }}><Trash2 size={16}/>删除表</button></div>}
    {target && <dialog ref={dialog} className="data-delete-dialog" aria-label="删除配置表" aria-busy={busy} onCancel={e => { e.preventDefault(); close(); }}>
      <h2>删除配置表</h2><p>确定删除“{item?.label || target.key}”？</p><code>{target.key}</code>
      <p>将删除此表的 {target.expected.datasets[target.key]?.length ?? 0} 条记录、{target.expected.columns[target.key]?.length ?? 0} 个字段及 JSON 格式信息。此操作无法在界面撤销。</p>
      <p>仅删除当前项目中的配置表，工程内的源文件保留；再次导入源文件可重新创建此表。</p>
      {!!refs.length && <div role="alert"><strong>请先解除以下引用：</strong><ul>{refs.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
      {(reason || error) && <p role="alert">{error || reason}</p>}
      <div className="data-delete-actions"><button disabled={busy} onClick={close}>取消</button><button className="data-delete-confirm" disabled={busy || !!reason || !!refs.length} onClick={() => void confirm()}>{busy ? '正在删除…' : '确认删除表'}</button></div>
    </dialog>}
  </>, document.body);
  return { bind, overlay };
}
