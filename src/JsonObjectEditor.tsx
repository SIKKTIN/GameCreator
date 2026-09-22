import {useId, useRef, useState} from 'react';
import {Database, Pencil, Plus, Search, Trash2, X} from 'lucide-react';
import {jsonType, parseJson, safeKey, type Json} from '../shared/data-sync.mjs';
import type {ProjectData} from './data-model';
import './json-object-editor.css';

export function JsonObjectEditor({data, table, label = table, onChange}: {data: ProjectData; table: string; label?: string; onChange: (v: ProjectData) => Promise<boolean>}) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(''), [type, setType] = useState('all'), [adding, setAdding] = useState(false);
  const addTrigger = useRef<HTMLButtonElement>(null);
  const rows = data.datasets[table] ?? [];
  const visible = rows.filter(row => (row.id + ' ' + row.value).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && (type === 'all' || row.type === type));
  const save = async (next: typeof rows) => {
    setBusy(true); setError('');
    try {
      const ok = await onChange({...data, datasets: {...data.datasets, [table]: next}});
      if (!ok) setError('未保存，请检查配置保存状态');
      return ok;
    } catch (e) {setError(String(e)); return false;}
    finally {setBusy(false);}
  };
  const closeAdd = () => {setAdding(false); addTrigger.current?.focus();};
  return <section className="json-object-editor data-editor" aria-label="对象配置编辑器" aria-busy={busy}>
    <div className="data-table-heading"><div className="view-title"><Database size={20}/><h2>{label}</h2></div><div className="data-table-meta"><code>{table}</code><span>对象配置 · {rows.length} 个字段</span></div></div>
    <div className="data-toolbar">
      <div className="data-tools"><label className="data-search"><Search size={15}/><input aria-label="搜索对象字段" placeholder="搜索字段或值…" value={query} onChange={e => setQuery(e.target.value)}/></label>
        <select aria-label="对象字段类型筛选" value={type} onChange={e => setType(e.target.value)}><option value="all">全部类型</option>{['string', 'number', 'boolean', 'null', 'array', 'object'].map(value => <option key={value} value={value}>{value}</option>)}</select></div>
      <div className="data-tools"><button ref={addTrigger} type="button" className="primary" disabled={busy} aria-expanded={adding} onClick={() => setAdding(!adding)}><Plus size={15}/>新增字段</button></div>
    </div>
    {error && <p className="data-status-error" role="alert">{error}</p>}
    {adding && <AddObjectField disabled={busy} onClose={closeAdd} onAdd={async (id, value) => {
      if (!safeKey(id) || rows.some(row => row.id === id)) throw new Error('字段名为空、重复或不可用');
      const ok = await save([...rows, {id, type: jsonType(value), value: JSON.stringify(value)}]);
      if (ok) {setQuery(''); setType('all'); closeAdd();}
      return ok;
    }}/>}
    <div className="data-table-wrap">
      <table className="data-table json-object-table" aria-label={label + ' 对象字段'}>
        <colgroup><col className="json-field-column"/><col className="json-type-column"/><col/><col className="json-actions-column"/></colgroup>
        <thead><tr><th scope="col">字段</th><th scope="col">类型</th><th scope="col">值</th><th scope="col">操作</th></tr></thead>
        <tbody>{visible.map(row => <ObjectField key={row.id + ':' + row.value} name={row.id} text={row.value} disabled={busy}
          onSave={async value => save(rows.map(r => r === row ? {...row, type: jsonType(value), value: JSON.stringify(value)} : r))}
          onDelete={() => {if (window.confirm('删除对象字段 ' + row.id + '？导出时还会要求确认删除。')) void save(rows.filter(r => r !== row));}}/>)}</tbody>
      </table>
      {!visible.length && <div className="data-table-empty"><h3>{rows.length ? '没有匹配的字段' : '这个对象还没有字段'}</h3><p>{rows.length ? '调整搜索内容或类型筛选，查看其他字段。' : '点击「新增字段」开始配置。'}</p>{rows.length > 0 && <button type="button" onClick={() => {setQuery(''); setType('all');}}>清除筛选</button>}</div>}
    </div>
    <div className="table-foot"><span>显示 {visible.length} / {rows.length} 个字段</span><span>数组和对象可展开查看</span></div>
  </section>;
}

function ObjectField({name, text, disabled, onSave, onDelete}: {name: string; text: string; disabled: boolean; onSave: (v: Json) => Promise<boolean>; onDelete: () => void}) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(text), [error, setError] = useState('');
  const hintId = useId(), editTrigger = useRef<HTMLButtonElement>(null);
  let value: Json; try {value = parseJson(text);} catch {value = text;}
  const cancel = () => {setEditing(false); setDraft(text); setError(''); editTrigger.current?.focus();};
  return <tr className={'json-object-field' + (editing ? ' selected' : '')}>
    <td><code className="json-field-name">{name}</code></td><td><span className="json-type">{jsonType(value)}</span></td>
    <td>{editing ? <div className="json-value-editor" onKeyDown={e => {if (e.key === 'Escape' && !disabled) {e.stopPropagation(); cancel();}}}>
      <textarea autoFocus aria-label={'编辑 ' + name} aria-describedby={hintId} aria-invalid={!!error} value={draft} onChange={e => {setDraft(e.target.value); setError('');}} disabled={disabled} spellCheck={false}/>
      <small id={hintId}>使用 JSON 格式，字符串需保留双引号。</small>{error && <p className="data-status-error" role="alert">{error}</p>}
      <div className="data-tools"><button type="button" disabled={disabled} onClick={cancel}>取消</button><button type="button" className="primary" disabled={disabled} onClick={async () => {try {if (await onSave(parseJson(draft))) setEditing(false);} catch (e) {setError(String(e));}}}>保存字段</button></div>
    </div> : <JsonTree value={value}/>}</td>
    <td><div className="json-field-actions"><button ref={editTrigger} type="button" disabled={disabled} aria-label={editing ? '收起编辑' : '编辑值'} title={(editing ? '收起编辑 ' : '编辑 ') + name} aria-expanded={editing} onClick={() => {if (editing) cancel(); else {setDraft(text); setError(''); setEditing(true);}}}>{editing ? <X size={15}/> : <Pencil size={15}/>}</button><button type="button" className="json-delete-field" disabled={disabled} aria-label="删除字段" title={'删除字段 ' + name} onClick={onDelete}><Trash2 size={15}/></button></div></td>
  </tr>;
}

function AddObjectField({disabled, onAdd, onClose}: {disabled: boolean; onAdd: (id: string, value: Json) => Promise<boolean>; onClose: () => void}) {
  const [name, setName] = useState(''), [value, setValue] = useState('null'), [error, setError] = useState('');
  return <form className="json-add-field" aria-label="添加对象字段" onSubmit={async e => {e.preventDefault(); if (disabled) return; setError(''); try {await onAdd(name, parseJson(value));} catch (e) {setError(String(e));}}}>
    <label>字段名<input autoFocus aria-label="新对象字段名" value={name} disabled={disabled} onChange={e => setName(e.target.value)}/></label>
    <label>值（JSON）<textarea aria-label="新对象字段 JSON 值" value={value} disabled={disabled} spellCheck={false} onChange={e => setValue(e.target.value)}/></label>
    {error && <p className="data-status-error" role="alert">{error}</p>}
    <div className="data-tools"><button type="button" disabled={disabled} onClick={onClose}>取消</button><button type="submit" className="primary" disabled={disabled}>添加字段</button></div>
  </form>;
}

function JsonTree({value, name}: {value: Json; name?: string}) {
  const entries = value && typeof value === 'object' ? Object.entries(value) : null;
  return entries ? <details className="json-tree"><summary>{name ? name + '：' : ''}{Array.isArray(value) ? '数组' : '对象'} · {entries.length} 项</summary><div className="json-tree-children">{entries.map(([key, v]) => <JsonTree key={key} name={key} value={v}/>)}</div></details>
    : <div className="json-tree-value">{name !== undefined && <span>{name}：</span>}<code>{JSON.stringify(value)}</code></div>;
}
