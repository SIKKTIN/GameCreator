import type { StoryVariable } from './story-orchestration';
import { isStoryFlag } from './story-characters';
export function Text({ label, value, onChange, rows }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return <label className="gp-field">{label}{rows ? <textarea aria-label={label} rows={rows} value={value} onChange={e=>onChange(e.target.value)} /> : <input aria-label={label} value={value} onChange={e=>onChange(e.target.value)} />}</label>;
}
export function NumberField({ label, value, onChange, min }: { label: string; value: number; onChange: (v: number) => void; min?: number }) {
  return <label className="gp-field">{label}<input aria-label={label} type="number" min={min} value={value} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n))onChange(n);}} /></label>;
}
export function Select({ label, value, options, onChange, blank = '请选择' }: { label: string; value: string; options: {id:string;name:string}[]; onChange:(v:string)=>void; blank?:string }) {
  return <label className="gp-field">{label}<select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}><option value="">{blank}</option>{value && !options.some(o=>o.id===value) && <option value={value}>已失效：{value}</option>}{options.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>;
}
export function StoryValueField({variable,label,value,onChange}:{variable?:StoryVariable;label:string;value:number;onChange:(value:number)=>void}) {
  return variable && isStoryFlag(variable) ? <label className="gp-field">{label}<select aria-label={label} value={value} onChange={e=>onChange(Number(e.target.value))}>{value!==0&&value!==1&&<option value={value}>待修复：{value}</option>}<option value={0}>{variable.falseLabel||'否'}</option><option value={1}>{variable.trueLabel||'是'}</option></select></label> : <NumberField label={label} value={value} onChange={onChange}/>;
}
