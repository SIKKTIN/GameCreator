import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Check, ChevronDown, CopyPlus, FolderOpen, LoaderCircle, Plus, X } from 'lucide-react';
import './project-switcher.css';

export type SwitchableProject = { id: string; name: string; projectPath: string; kind?: 'local' | 'team'; detail?: string };
export type AddProjectInput = { name: string };
export type ProjectSwitcherProps = {
  projects: SwitchableProject[];
  currentId: string | null;
  currentName: string;
  testName?: string;
  canAdd: boolean;
  busy: boolean;
  onSelect: (id: string) => Promise<boolean> | boolean;
  onAdd: (input: AddProjectInput) => Promise<boolean>;
  onConnectTeam?: () => void;
  onImportPrototype?: () => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作未完成，请稍后重试。';
}

export function ProjectSwitcher({ projects, currentId, currentName, testName, canAdd, busy, onSelect, onAdd, onConnectTeam, onImportPrototype }: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [menuError, setMenuError] = useState('');
  const [formError, setFormError] = useState('');
  const [name, setName] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const operationRef = useRef(false);
  const id = useId();
  const locked = busy || pending;

  function closeMenu(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    if (!open) return;
    function onOutside(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', onOutside);
    return () => document.removeEventListener('pointerdown', onOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const active = menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)');
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)');
    (active ?? first)?.focus();
  }, [open]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? []);
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowUp' ? (index - 1 + buttons.length) % buttons.length : (index + 1) % buttons.length;
    buttons[next].focus();
  }

  async function selectProject(projectId: string) {
    if (locked || operationRef.current) return;
    if (projectId === currentId) { closeMenu(true); return; }
    operationRef.current = true;
    setPending(true);
    setMenuError('');
    try {
      if (await onSelect(projectId)) closeMenu(true);
      else setMenuError('项目尚未切换，请检查保存状态后重试。');
    } catch (error) {
      setMenuError(errorMessage(error));
    } finally {
      operationRef.current = false;
      setPending(false);
    }
  }

  function openAddDialog() {
    if (locked || !canAdd) return;
    closeMenu();
    setName('');
    setFormError('');
    dialogRef.current?.showModal();
    nameRef.current?.focus();
  }

  function closeDialog() {
    if (pending) return;
    dialogRef.current?.close();
  }

  async function submitProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || operationRef.current) return;
    const input = { name: name.trim() };
    if (!input.name) {
      setFormError('请填写项目名称。');
      return;
    }
    operationRef.current = true;
    setPending(true);
    setFormError('');
    try {
      if (await onAdd(input)) dialogRef.current?.close();
      else setFormError('项目尚未创建，请检查保存状态后重试。');
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      operationRef.current = false;
      setPending(false);
    }
  }

  return <div className="ps-root" ref={rootRef}>
    <button
      className={`ps-trigger${open ? ' ps-trigger-open' : ''}`}
      type="button"
      ref={triggerRef}
      aria-label={`切换项目，当前：${currentName}`}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={`${id}-menu`}
      disabled={locked}
      title={currentName}
      onClick={() => { setMenuError(''); setOpen(value => !value); }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
      }}
    >
      <span className={`ps-status-dot${testName ? ' ps-status-test' : ''}`} aria-hidden="true" />
      <span className="ps-trigger-name">{currentName}</span>
      {locked ? <LoaderCircle className="ps-spinner" size={15} aria-hidden="true" /> : <ChevronDown className="ps-chevron" size={15} aria-hidden="true" />}
    </button>
    {open && <div className="ps-dropdown">
      <div className="ps-menu-heading">切换项目</div>
      {testName && <div className="ps-test-current">
        <span className="ps-status-dot ps-status-test" aria-hidden="true" />
        <div><strong>{testName}</strong><small>测试工作区 · 选择项目可返回</small></div>
      </div>}
      <div id={`${id}-menu`} role="menu" aria-label="项目列表" ref={menuRef} className="ps-menu" onKeyDown={onMenuKeyDown}
        onBlur={event => {
          if (event.relatedTarget instanceof Node && !rootRef.current?.contains(event.relatedTarget)) closeMenu();
        }}>
        {projects.map(project => <button
          type="button"
          className={`ps-project-row${project.id === currentId ? ' ps-project-selected' : ''}`}
          role="menuitemradio"
          aria-checked={project.id === currentId}
          key={project.id}
          disabled={locked}
          title={`${project.name}\n${project.kind === 'team' ? '团队项目' : '本地项目'} · ${project.detail || project.projectPath || '尚未配置引擎'}`}
          onClick={() => void selectProject(project.id)}
        >
          <FolderOpen size={16} aria-hidden="true" />
          <span className="ps-project-copy"><strong>{project.name}</strong><small>{project.kind === 'team' ? '团队项目' : '本地项目'} · {project.detail || project.projectPath || '尚未配置引擎'}</small></span>
          {project.id === currentId && <Check className="ps-project-check" size={15} aria-hidden="true" />}
        </button>)}
        {projects.length === 0 && <p className="ps-no-projects">暂无已创建的项目</p>}
        {canAdd && <button type="button" role="menuitem" className="ps-add-button" disabled={locked} onClick={openAddDialog}><Plus size={16} aria-hidden="true" />新建项目</button>}
        {canAdd && onImportPrototype && <button type="button" role="menuitem" className="ps-add-button" disabled={locked} onClick={() => { closeMenu(); triggerRef.current?.focus(); onImportPrototype(); }}><CopyPlus size={16} aria-hidden="true" />从原型示例创建项目</button>}
        {onConnectTeam && <button type="button" role="menuitem" className="ps-add-button" disabled={locked} onClick={() => { closeMenu(); onConnectTeam(); }}><FolderOpen size={16} />连接团队服务器</button>}
      </div>
      {menuError && <p className="ps-error" role="alert">{menuError}</p>}
    </div>}
    <dialog
      ref={dialogRef}
      className="ps-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={event => { if (pending) event.preventDefault(); }}
      onClose={() => requestAnimationFrame(() => triggerRef.current?.focus())}
    >
      <form onSubmit={event => void submitProject(event)} aria-busy={pending}>
        <div className="ps-dialog-heading">
          <div><span className="ps-dialog-kicker">PROJECT</span><h2 id={`${id}-title`}>新建项目</h2></div>
          <button type="button" className="ps-close-button" aria-label="关闭新建项目" disabled={pending} onClick={closeDialog}><X size={19} aria-hidden="true" /></button>
        </div>
        <p id={`${id}-description`} className="ps-dialog-description">输入名称即可开始编写项目内容。需要连接游戏工程时，再到“引擎设置”配置目录。</p>
        <label htmlFor={`${id}-name`} className="ps-field">项目名称
          <input id={`${id}-name`} ref={nameRef} required autoComplete="off" value={name} onChange={event => setName(event.target.value)} placeholder="例如：我的游戏" disabled={locked} />
        </label>
        {formError && <p className="ps-error ps-form-error" role="alert">{formError}</p>}
        <div className="ps-dialog-actions">
          <button type="button" className="ps-secondary-button" disabled={pending} onClick={closeDialog}>取消</button>
          <button type="submit" className="ps-submit-button" disabled={locked}>
            {pending ? <LoaderCircle className="ps-spinner" size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
            {pending ? '正在创建…' : '创建并切换'}
          </button>
        </div>
      </form>
    </dialog>
  </div>;
}
