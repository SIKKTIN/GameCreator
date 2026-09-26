import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, Check, ChevronDown, CloudUpload, CopyPlus, FolderInput, FolderOutput, FolderOpen, LoaderCircle, Plus, X } from 'lucide-react';
import './project-switcher.css';

export type SwitchableProject = { id: string; name: string; projectPath: string; kind?: 'local' | 'team'; detail?: string };
export type AddProjectInput = { name: string };
export type ProjectSwitcherProps = {
  projects: SwitchableProject[];
  currentId: string | null;
  currentName: string;
  testName?: string;
  teamNotice?: string;
  canAdd: boolean;
  busy: boolean;
  onSelect: (id: string) => Promise<boolean> | boolean;
  onAdd: (input: AddProjectInput) => Promise<boolean>;
  onDelete?: (id: string) => Promise<boolean>;
  onConnectTeam?: () => void;
  onCreateTeam?: () => void;
  onPublishProject?: () => void;
  onImportPrototype?: () => void;
  onImportProject?: () => void;
  onExportProject?: () => void;
  onSaveAsProject?: () => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作未完成，请稍后重试。';
}

export function ProjectSwitcher({ projects, currentId, currentName, testName, teamNotice, canAdd, busy, onSelect, onAdd, onDelete, onConnectTeam, onCreateTeam, onPublishProject, onImportPrototype, onImportProject, onExportProject, onSaveAsProject }: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<{ id: string; x: number; y: number } | null>(null);
  const [deleting, setDeleting] = useState<SwitchableProject | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const contextRef = useRef<HTMLDivElement>(null);
  const contextOrigin = useRef<HTMLButtonElement | null>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const deleteCancel = useRef<HTMLButtonElement>(null);
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
    setOpen(false); setContext(null);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    if (!open) return;
    function onOutside(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target) && !contextRef.current?.contains(event.target)) closeMenu();
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

  const contextProject = context ? projects.find(project => project.id === context.id) : undefined;
  function closeContext(restoreFocus = false) {
    setContext(null);
    if (restoreFocus) requestAnimationFrame(() => contextOrigin.current?.focus());
  }
  const canOpenContext=(project:SwitchableProject)=>project.kind!=='team'&&!!((canAdd&&onDelete)||window.desktopClient?.revealProjectData);
  function openContext(project: SwitchableProject, button: HTMLButtonElement, x: number, y: number) {
    if (locked || !canOpenContext(project)) return;
    contextOrigin.current = button;
    setContext({ id: project.id, x: Math.max(8, Math.min(x, window.innerWidth - 232)), y: Math.max(8, Math.min(y, window.innerHeight - 172)) });
  }
  useEffect(() => {
    if (!context) return;
    if (!contextProject || locked) { setContext(null); return; }
    contextRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const close = () => setContext(null);
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !contextRef.current?.contains(event.target)) close(); };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', scroll, true);
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', scroll, true); };
  }, [context, contextProject, locked]);
  useEffect(() => {
    if (deleting) { deleteDialog.current?.showModal(); deleteCancel.current?.focus(); }
  }, [deleting]);
  async function openDataFolder(projectId:string) {
    const reveal=window.desktopClient?.revealProjectData;
    if(!reveal||locked||operationRef.current)return;
    operationRef.current=true;setPending(true);setMenuError('');closeContext();
    try {await reveal(projectId);closeMenu(true);}
    catch(error){setMenuError(errorMessage(error));}
    finally{operationRef.current=false;setPending(false);}
  }
  async function confirmDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleting || !onDelete || !canAdd || locked || operationRef.current) return;
    operationRef.current = true; setPending(true); setDeleteError('');
    try {
      if (await onDelete(deleting.id)) deleteDialog.current?.close();
      else setDeleteError('项目尚未移除，请检查保存状态后重试。');
    } catch (error) { setDeleteError(errorMessage(error)); }
    finally { operationRef.current = false; setPending(false); }
  }

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
      {teamNotice && <p className="ps-no-projects" role="status">{teamNotice}</p>}
      {testName && <div className="ps-test-current">
        <span className="ps-status-dot ps-status-test" aria-hidden="true" />
        <div><strong>{testName}</strong><small>测试工作区 · 选择项目可返回</small></div>
      </div>}
      <div id={`${id}-menu`} role="menu" aria-label="项目列表" ref={menuRef} className="ps-menu" onKeyDown={onMenuKeyDown}
        onBlur={event => {
          if (event.relatedTarget instanceof Node && !rootRef.current?.contains(event.relatedTarget) && !contextRef.current?.contains(event.relatedTarget)) closeMenu();
        }}>
        {projects.map(project => <button
          type="button"
          className={`ps-project-row${project.id === currentId ? ' ps-project-selected' : ''}`}
          role="menuitemradio"
          aria-checked={project.id === currentId}
          key={project.id}
          disabled={locked}
          title={`${project.name}\n${project.kind === 'team' ? '团队项目' : '本地项目'} · ${project.detail || project.projectPath || '尚未保存到项目文件夹'}`}
          onClick={() => void selectProject(project.id)}
          onContextMenu={event => {
            if (!canOpenContext(project)) return;
            event.preventDefault(); event.stopPropagation();
            openContext(project, event.currentTarget, event.clientX, event.clientY);
          }}
          onKeyDown={event => {
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
              if (!canOpenContext(project)) return;
              event.preventDefault(); event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              openContext(project, event.currentTarget, rect.left + 20, rect.bottom);
            }
          }}
        >
          <FolderOpen size={16} aria-hidden="true" />
          <span className="ps-project-copy"><strong>{project.name}</strong><small>{project.kind === 'team' ? '团队项目' : '本地项目'} · {project.detail || project.projectPath || '尚未保存到项目文件夹'}</small></span>
          {project.id === currentId && <Check className="ps-project-check" size={15} aria-hidden="true" />}
        </button>)}
        {projects.length === 0 && <p className="ps-no-projects">暂无已创建的项目</p>}
        {canAdd && <button type="button" role="menuitem" className="ps-add-button" disabled={locked} onClick={openAddDialog}><Plus size={16} aria-hidden="true" />新建项目</button>}
        {canAdd && onCreateTeam && <button type="button" role="menuitem" className="ps-add-button" disabled={locked} onClick={() => { closeMenu(); onCreateTeam(); }}><Plus size={16} />新建协作项目</button>}
        {canAdd && onPublishProject && <button type="button" role="menuitem" className="ps-add-button" disabled={locked} onClick={() => { closeMenu(); onPublishProject(); }}><CloudUpload size={16} />发布为协作项目</button>}
        {canAdd && onImportPrototype && <button type="button" role="menuitem" className="ps-add-button" disabled={locked} onClick={() => { closeMenu(); triggerRef.current?.focus(); onImportPrototype(); }}><CopyPlus size={16} aria-hidden="true" />从原型示例创建项目</button>}
        {canAdd && onImportProject && <button type="button" role="menuitem" className="ps-add-button" disabled={locked} onClick={() => { closeMenu(); triggerRef.current?.focus(); onImportProject(); }}><FolderInput size={16} aria-hidden="true" />打开项目</button>}
        {canAdd && onExportProject && <button type="button" role="menuitem" className="ps-add-button" disabled={locked} onClick={() => { closeMenu(); triggerRef.current?.focus(); onExportProject(); }}><FolderOutput size={16} aria-hidden="true" />保存项目</button>}
        {canAdd && onSaveAsProject && <button type="button" role="menuitem" className="ps-add-button" disabled={locked} onClick={()=>{closeMenu();onSaveAsProject();}}><FolderOutput size={16}/>项目另存为…</button>}
        {onConnectTeam && <button type="button" role="menuitem" className="ps-add-button" disabled={locked} onClick={() => { closeMenu(); onConnectTeam(); }}><FolderOpen size={16} />连接团队服务器</button>}
      </div>
      {menuError && <p className="ps-error" role="alert">{menuError}</p>}
    </div>}
    {context && contextProject && createPortal(<div ref={contextRef} role="menu" aria-label={`项目操作：${contextProject.name}`} className="ps-context-menu"
      style={{ left: context.x, top: context.y }} onContextMenu={event => event.preventDefault()}
      onKeyDown={event => {
        if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); closeContext(true); }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          const buttons=Array.from(contextRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[]);
          const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
          if(buttons.length)buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:event.key==='ArrowUp'?(index-1+buttons.length)%buttons.length:(index+1)%buttons.length].focus();
        }
      }}>
      <div className="ps-context-name" title={contextProject.name}>{contextProject.name}</div>
      <button type="button" role="menuitem" className="ps-open-data-action" disabled={locked||!window.desktopClient?.revealProjectData} title={window.desktopClient?.revealProjectData?'打开保存此项目数据的文件夹':'仅桌面客户端可打开本地数据目录'} onClick={()=>void openDataFolder(contextProject.id)}><FolderOpen size={15} aria-hidden="true"/>打开项目文件夹</button>
      <div className="ps-context-hint">GameCreator 项目保存位置</div>
      {canAdd&&onDelete&&<button type="button" role="menuitem" className="ps-delete-action" disabled={locked} onClick={() => {
        setDeleting(contextProject); setDeleteError(''); closeMenu();
      }}><Trash2 size={15} aria-hidden="true" />移除项目</button>}
    </div>, document.body)}
    <dialog ref={deleteDialog} className="ps-dialog ps-delete-dialog" aria-labelledby={`${id}-delete-title`} aria-describedby={`${id}-delete-description`}
      onCancel={event => { if (pending) event.preventDefault(); }}
      onClose={() => { setDeleting(null); setDeleteError(''); requestAnimationFrame(() => triggerRef.current?.focus()); }}>
      <form onSubmit={event => void confirmDelete(event)} aria-busy={pending}>
        <div className="ps-dialog-heading"><div><span className="ps-dialog-kicker">LOCAL PROJECT</span><h2 id={`${id}-delete-title`}>从最近项目移除</h2></div>
          <button type="button" className="ps-close-button" aria-label="关闭移除项目" disabled={pending} onClick={() => deleteDialog.current?.close()}><X size={19} /></button></div>
        <p className="ps-delete-name">{deleting?.name}</p>
        <p id={`${id}-delete-description`} className="ps-dialog-description">仅从最近项目列表移除，项目文件夹及全部内容都会保留。以后可以通过“打开项目”再次打开。</p>
        {deleting?.id === currentId && <p className="ps-dialog-description">移除后将切换到其他本地项目；没有其他项目时显示空工作区。</p>}
        {deleteError && <p role="alert" className="ps-error ps-form-error">{deleteError}</p>}
        <div className="ps-dialog-actions"><button ref={deleteCancel} type="button" className="ps-secondary-button" disabled={pending} onClick={() => deleteDialog.current?.close()}>取消</button>
          <button type="submit" className="ps-submit-button ps-delete-submit" disabled={locked}>{pending ? <LoaderCircle className="ps-spinner" size={16} /> : <Trash2 size={16} />}{pending ? '正在移除…' : '移除项目'}</button></div>
      </form>
    </dialog>
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
        <p id={`${id}-description`} className="ps-dialog-description">填写名称后选择保存位置，创建独立的项目文件夹。需要连接游戏工程时，再到“工程连接”配置。</p>
        <label htmlFor={`${id}-name`} className="ps-field">项目名称
          <input id={`${id}-name`} ref={nameRef} required autoComplete="off" value={name} onChange={event => setName(event.target.value)} placeholder="例如：我的游戏" disabled={locked} />
        </label>
        {formError && <p className="ps-error ps-form-error" role="alert">{formError}</p>}
        <div className="ps-dialog-actions">
          <button type="button" className="ps-secondary-button" disabled={pending} onClick={closeDialog}>取消</button>
          <button type="submit" className="ps-submit-button" disabled={locked}>
            {pending ? <LoaderCircle className="ps-spinner" size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
            {pending ? '正在创建…' : '选择位置并创建'}
          </button>
        </div>
      </form>
    </dialog>
  </div>;
}
