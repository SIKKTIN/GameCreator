import {useState} from 'react';
import {jsonType,parseJson,safeKey,type Json} from '../shared/data-sync.mjs';
import type {ProjectData} from './data-model';
import './data-sync.css';
export function JsonObjectEditor({data,table,onChange}:{data:ProjectData;table:string;onChange:(v:ProjectData)=>Promise<boolean>}) {
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  const rows=data.datasets[table];
  const save=async(next:typeof rows)=>{setBusy(true);setError('');try{const ok=await onChange({...data,datasets:{...data.datasets,[table]:next}});if(!ok)setError('未保存，请检查配置保存状态');return ok;}catch(e){setError(String(e));return false;}finally{setBusy(false);}};
  return <section className="json-object-editor" aria-label="对象配置编辑器"><h2>{table}</h2><p>对象配置 · 字段 / 类型 / 值。数组和对象可以展开查看；编辑时使用 JSON，字符串保留双引号。</p>{error&&<p role="alert">{error}</p>}
    <div className="json-object-fields">{rows.map(row=><ObjectField key={row.id+':'+row.value} name={row.id} text={row.value} disabled={busy} onSave={async value=>save(rows.map(r=>r===row?{...row,type:jsonType(value),value:JSON.stringify(value)}:r))} onDelete={()=>{if(window.confirm('删除对象字段 '+row.id+'？导出时还会要求确认删除。'))void save(rows.filter(r=>r!==row));}}/>)}</div>
    <AddObjectField disabled={busy} onAdd={async(id,value)=>{if(!safeKey(id)||rows.some(r=>r.id===id))throw new Error('字段名为空、重复或不可用');return save([...rows,{id,type:jsonType(value),value:JSON.stringify(value)}]);}}/>
  </section>;
}
function ObjectField({name,text,disabled,onSave,onDelete}:{name:string;text:string;disabled:boolean;onSave:(v:Json)=>Promise<boolean>;onDelete:()=>void}) {
  const [editing,setEditing]=useState(false),[draft,setDraft]=useState(text),[error,setError]=useState('');
  let value:Json;try{value=parseJson(text);}catch{value=text;}
  return <article className="json-object-field"><div><code>{name}</code><small>{jsonType(value)}</small><button disabled={disabled} onClick={()=>setEditing(!editing)}>{editing?'收起编辑':'编辑值'}</button><button disabled={disabled} onClick={onDelete}>删除字段</button></div><JsonTree value={value}/>{editing&&<><textarea aria-label={'编辑 '+name} value={draft} onChange={e=>setDraft(e.target.value)} disabled={disabled} spellCheck={false}/>{error&&<p role="alert">{error}</p>}<button disabled={disabled} onClick={async()=>{try{if(await onSave(parseJson(draft)))setEditing(false);}catch(e){setError(String(e));}}}>保存字段</button></>}</article>;
}
function AddObjectField({disabled,onAdd}:{disabled:boolean;onAdd:(id:string,value:Json)=>Promise<boolean>}) {
  const [name,setName]=useState(''),[value,setValue]=useState('null'),[error,setError]=useState('');
  return <details className="json-object-field"><summary>添加对象字段</summary><label>字段名<input aria-label="新对象字段名" value={name} onChange={e=>setName(e.target.value)}/></label><textarea aria-label="新对象字段 JSON 值" value={value} onChange={e=>setValue(e.target.value)}/>{error&&<p role="alert">{error}</p>}<button disabled={disabled} onClick={async()=>{try{if(await onAdd(name,parseJson(value))){setName('');setValue('null');setError('');}}catch(e){setError(String(e));}}}>添加字段</button></details>;
}
function JsonTree({value,name}:{value:Json;name?:string}) {
  const entries=value&&typeof value==='object'?Object.entries(value):null;
  return entries?<details className="json-tree"><summary>{name?name+'：':''}{Array.isArray(value)?'数组':'对象'} · {entries.length} 项</summary>{entries.map(([key,v])=><JsonTree key={key} name={key} value={v}/>)}</details>:<p className="json-tree">{name?name+'：':''}<code>{JSON.stringify(value)}</code></p>;
}
