import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Check, CopyPlus, LoaderCircle, X } from 'lucide-react';
import { prototypeExamples, type PrototypeExampleId, type PrototypeImportInput } from './prototype-examples';
import './prototype-import.css';

export type PrototypeImportDialogProps = {
  open: boolean;
  busy: boolean;
  projects: Array<{ name: string }>;
  onClose: () => void;
  onImport: (input: PrototypeImportInput) => Promise<boolean>;
};

function availableProjectName(base: string, projects: Array<{ name: string }>) {
  const names = new Set(projects.map(project => project.name.trim()));
  if (!names.has(base)) return base;
  let copy = base + '（副本）';
  let number = 2;
  while (names.has(copy)) copy = base + '（副本 ' + number++ + '）';
  return copy;
}

export function PrototypeImportDialog({ open, busy, projects, onClose, onImport }: PrototypeImportDialogProps) {
  const [exampleId, setExampleId] = useState<PrototypeExampleId>(prototypeExamples[0].id);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const operationRef = useRef(false);
  const wasOpenRef = useRef(false);
  const nameEditedRef = useRef(false);
  const id = useId();
  const locked = busy || pending;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!wasOpenRef.current) {
        const initial = prototypeExamples[0];
        setExampleId(initial.id);
        setName(availableProjectName(initial.name, projects));
        setError('');
        nameEditedRef.current = false;
      }
      if (!dialog.open) {
        dialog.showModal();
        dialog.querySelector<HTMLInputElement>('input[type="radio"]')?.focus();
      }
    } else if (dialog.open) {
      dialog.close();
    }
    wasOpenRef.current = open;
  }, [open, projects]);

  function closeDialog() {
    if (!locked && !operationRef.current) onClose();
  }

  function selectExample(value: PrototypeExampleId) {
    if (locked) return;
    setExampleId(value);
    const selected = prototypeExamples.find(example => example.id === value)!;
    if (!nameEditedRef.current) setName(availableProjectName(selected.name, projects));
    setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || operationRef.current) return;
    const projectName = name.trim();
    if (!projectName) {
      setError('请填写项目名称。');
      return;
    }
    operationRef.current = true;
    setPending(true);
    setError('');
    try {
      if (await onImport({ exampleId, name: projectName })) onClose();
      else setError('项目尚未创建，请检查保存状态后重试。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '原型示例创建失败，请稍后重试。');
    } finally {
      operationRef.current = false;
      setPending(false);
    }
  }

  return <dialog
    ref={dialogRef}
    className="pi-dialog"
    aria-labelledby={id + '-title'}
    aria-describedby={id + '-description'}
    onCancel={event => { event.preventDefault(); closeDialog(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog();
    }}
  >
    <form onSubmit={event => void submit(event)} aria-busy={locked}>
      <div className="pi-heading">
        <div><span className="pi-kicker">PROTOTYPE EXAMPLES</span><h2 id={id + '-title'}>从原型示例创建项目</h2></div>
        <button type="button" className="pi-close" aria-label="关闭原型示例" disabled={locked} onClick={closeDialog}><X size={19} aria-hidden="true" /></button>
      </div>
      <p id={id + '-description'} className="pi-description">选择一套设计，创建独立的本地项目。玩法设计、功能系统、美术需求、配置数据和故事文档会一起复制，之后可自由修改。</p>
      <fieldset className="pi-example-picker" disabled={locked}>
        <legend>选择原型示例</legend>
        <div className="pi-example-grid">
          {prototypeExamples.map(example => <label className={'pi-example' + (example.id === exampleId ? ' pi-example-selected' : '')} key={example.id}>
            <div className="pi-example-heading">
              <strong>{example.title}</strong>
              <input type="radio" name={id + '-example'} value={example.id} checked={example.id === exampleId} aria-label={example.title} onChange={() => selectExample(example.id)} />
            </div>
            <p>{example.description}</p>
            <dl className="pi-example-counts">
              <div><dt>玩法</dt><dd>{example.counts.gameplay}</dd></div>
              <div><dt>功能系统</dt><dd>{example.counts.systems}</dd></div>
              <div><dt>美术需求</dt><dd>{example.counts.requirements}</dd></div>
              <div><dt>资产条目</dt><dd>{example.counts.assets}</dd></div>
              <div><dt>有数据的表</dt><dd>{example.counts.tables}</dd></div>
              <div><dt>数据记录</dt><dd>{example.counts.records}</dd></div>
            </dl>
            <span className="pi-example-footer">{example.counts.stories} 篇故事文档{example.id === exampleId && <span><Check size={13} aria-hidden="true" />已选择</span>}</span>
          </label>)}
        </div>
      </fieldset>
      <label className="pi-name-field" htmlFor={id + '-name'}>项目名称
        <input id={id + '-name'} required maxLength={100} autoComplete="off" value={name} disabled={locked} onChange={event => { setName(event.target.value); nameEditedRef.current = event.target.value.length > 0; setError(''); }} placeholder="为这份原型起个名字" />
      </label>
      <p className="pi-note">示例提供设计内容，不包含可运行游戏或已交付的美术素材。需要连接游戏工程时，可稍后在“引擎设置”中配置。</p>
      {error && <p className="pi-error" role="alert">{error}</p>}
      <div className="pi-actions">
        <span>创建后自动打开 · 各项目独立保存</span>
        <div>
          <button type="button" className="pi-secondary" disabled={locked} onClick={closeDialog}>取消</button>
          <button type="submit" className="pi-submit" disabled={locked}>
            {locked ? <LoaderCircle size={16} className="pi-spinner" aria-hidden="true" /> : <CopyPlus size={16} aria-hidden="true" />}
            {locked ? '正在创建…' : '创建并打开'}
          </button>
        </div>
      </div>
    </form>
  </dialog>;
}