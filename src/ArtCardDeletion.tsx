import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import { artItemReferences, type ArtItemTarget } from './art-deletion';
import type { ArtController } from './useArtAssets';

export type ArtCardBindings = (target: ArtItemTarget) => {
  onContextMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
};

export function useArtCardDeletion(controller: ArtController, externalReferences: (target: ArtItemTarget) => string[], onDeleted: (target: ArtItemTarget) => void) {
  const [menu, setMenu] = useState<{ target: ArtItemTarget; x: number; y: number } | null>(null);
  const [target, setTarget] = useState<ArtItemTarget | null>(null), [error, setError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null);
  const origin = useRef<HTMLButtonElement | null>(null), fallback = useRef<HTMLInputElement | null>(null);
  const scrollPositions = useRef(new Map<Element, string>());
  const scrollPosition = (element: Element) => element.scrollLeft + ':' + element.scrollTop;
  const label = (item: ArtItemTarget) => item.kind === 'asset' ? '素材资产' : '素材需求';
  const restoreFocus = () => requestAnimationFrame(() => (origin.current?.isConnected ? origin.current : fallback.current)?.focus());
  const close = () => { setTarget(null); setError(''); restoreFocus(); };
  const open = (item: ArtItemTarget, button: HTMLButtonElement, x: number, y: number) => {
    origin.current = button;
    scrollPositions.current.clear();
    for (let element: Element | null = button; element; element = element.parentElement) scrollPositions.current.set(element, scrollPosition(element));
    fallback.current = button.closest('section')?.querySelector<HTMLInputElement>('input[type="search"]') || null;
    setMenu({ target: item, x: Math.max(8, Math.min(x, window.innerWidth - 208)), y: Math.max(8, Math.min(y, window.innerHeight - 64)) });
  };
  const bind: ArtCardBindings = item => ({
    onContextMenu: event => { event.preventDefault(); event.stopPropagation(); open(item, event.currentTarget, event.clientX, event.clientY); },
    onKeyDown: event => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      event.preventDefault(); event.stopPropagation();
      const bounds = event.currentTarget.getBoundingClientRect(); open(item, event.currentTarget, bounds.left + 12, bounds.top + 24);
    },
  });
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (e: Event) => { if (!(e.target instanceof Node) || !menuRef.current?.contains(e.target)) setMenu(null); };
    const scrolled = (e: Event) => {
      const element = e.target === document ? document.scrollingElement : e.target;
      if (!(element instanceof Element) || menuRef.current?.contains(element)) return;
      // Ignore queued scroll notifications from revealing the card before the menu opened.
      if (scrollPositions.current.get(element) !== scrollPosition(element)) setMenu(null);
    };
    const dismiss = () => setMenu(null);
    document.addEventListener('pointerdown', outside); window.addEventListener('scroll', scrolled, true); window.addEventListener('resize', dismiss);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('scroll', scrolled, true); window.removeEventListener('resize', dismiss); };
  }, [menu]);
  useEffect(() => { if (target) { dialog.current?.showModal(); cancel.current?.focus(); } }, [target]);
  const item = target ? controller.store[target.kind === 'asset' ? 'assets' : 'requirements'].find(i => i.id === target.id) : undefined;
  const versionCount = target?.kind === 'asset' ? controller.store.assets.find(a => a.id === target.id)?.versions.length || 0 : 0;
  const references = target ? [...artItemReferences(controller.store, target), ...externalReferences(target)] : [];
  const blocked = controller.blocked ? '素材存档暂不可读，请恢复后再删除。' : controller.pending ? '请先保存尚未写入的素材修改，再删除。' : !item ? '素材条目不存在，请重新打开项目。' : '';
  const confirm = () => {
    if (!target || blocked) return;
    try {
      // Resolve again when confirming; the context-menu snapshot never authorizes a deletion.
      controller.remove(target, externalReferences(target));
      onDeleted(target); close();
    } catch (e) { setError('删除未完成：' + (e instanceof Error ? e.message : String(e))); }
  };
  const overlay = createPortal(<>
    {menu && <div ref={menuRef} role="menu" aria-label="素材卡片操作" className="ar-card-menu" style={{ left: menu.x, top: menu.y }} onContextMenu={e => e.preventDefault()} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); setMenu(null); restoreFocus(); }
      else if (e.key === 'Tab') setMenu(null);
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus(); }
    }}><button role="menuitem" onClick={() => { setTarget(menu.target); setError(''); setMenu(null); }}><Trash2 size={16}/>删除{label(menu.target)}</button></div>}
    {target && <dialog ref={dialog} className="gp-dialog ar-delete-dialog" aria-labelledby="ar-delete-title" onCancel={e => { e.preventDefault(); close(); }}>
      <h2 id="ar-delete-title">删除{label(target)}</h2>
      <p>确定删除“{item?.name || '此条目'}”？此操作无法撤销。</p>
      {target.kind === 'asset' ? <p className="gp-muted">会移除资产卡片及其 {versionCount} 个交付版本记录；已导入的本地文件仍保留在项目文件夹中。</p> : <p className="gp-muted">会移除需求及其资产关联；关联资产和交付文件继续保留。</p>}
      {!!references.length && <div className="ar-delete-references" role="alert"><strong>请先解除以下引用，再删除：</strong><ul>{references.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
      {blocked && <p className="ar-error" role="alert">{blocked}</p>}
      {error && <p className="ar-error" role="alert">{error}</p>}
      <div className="gp-dialog-actions"><button ref={cancel} className="gp-secondary" onClick={close}>取消</button><button className="gp-secondary ar-delete-confirm" disabled={!!blocked || !!references.length} onClick={confirm}><Trash2 size={16}/>确认删除</button></div>
    </dialog>}
  </>, document.body);
  return { bind, overlay };
}
