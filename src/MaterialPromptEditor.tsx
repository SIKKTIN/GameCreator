import { useState } from 'react';
import { Copy, Expand, Minimize2, WandSparkles, X } from 'lucide-react';
import { materialPromptDraft, materialPromptText, type MaterialGenerationPrompt } from './material-prompt';
import type { ArtRequirement } from './art-assets';
export function MaterialPromptEditor({requirement,categoryName,styleContext='',disabled,onChange}:{requirement:ArtRequirement;categoryName:string;styleContext?:string;disabled:boolean;onChange:(value:MaterialGenerationPrompt)=>void}) {
  const value=requirement.generationPrompt ?? {prompt:'',negative:''};
  const [expanded,setExpanded]=useState(false),[preview,setPreview]=useState<MaterialGenerationPrompt|null>(null),[notice,setNotice]=useState(''),[copyError,setCopyError]=useState('');
  const patch=(changes:Partial<MaterialGenerationPrompt>)=>{setNotice('');setCopyError('');onChange({...value,...changes});};
  const copy=async()=>{setCopyError('');setNotice('');try{await navigator.clipboard.writeText([materialPromptText(value),styleContext].filter(Boolean).join('\n\n'));setNotice('提示词已复制');}catch{setCopyError('复制失败，请选中下方文本手动复制。');}};
  return <section className={'gp-card material-prompt-card'+(expanded?' expanded':'')} aria-label="素材生成提示词">
    <div className="gp-card-heading"><div><h3>素材生成提示词</h3><p className="gp-muted">整理素材描述与交付要求，复制到 AI 工具中使用。</p></div><button type="button" className="gp-icon" aria-label={expanded?'收起提示词编辑':'展开提示词编辑'} onClick={()=>setExpanded(!expanded)}>{expanded?<Minimize2 size={17}/>:<Expand size={17}/>}</button></div>
    <div className="material-prompt-actions"><button type="button" className="gp-secondary" disabled={disabled} onClick={()=>{setNotice('');setPreview(materialPromptDraft(requirement,categoryName));}}><WandSparkles size={15}/>从需求整理</button><button type="button" className="gp-secondary" disabled={!materialPromptText(value)} onClick={()=>void copy()}><Copy size={15}/>复制提示词</button><span>可自由编辑，修改需求不会覆盖提示词。</span></div>
    <label className="gp-field">生成提示词<textarea aria-label="生成提示词" rows={expanded?16:6} disabled={disabled} value={value.prompt} onChange={e=>patch({prompt:e.target.value})} placeholder="描述主体、用途与风格，并写明制作要求；也可以先从需求整理一份草稿。"/></label>
    <label className="gp-field">避免内容（可选）<textarea aria-label="避免内容" rows={expanded?5:3} disabled={disabled} value={value.negative} onChange={e=>patch({negative:e.target.value})} placeholder="例如：不要多余文字、不要改变角色比例；音频可注明避免人声或突兀截断。"/></label>
    {styleContext&&<details className="as-inherited"><summary>复制时附带当前适用美术风格</summary><pre>{styleContext}</pre></details>}
    {notice&&<p className="material-prompt-notice" role="status">{notice}</p>}{copyError&&<p className="ar-error" role="alert">{copyError}</p>}
    {preview&&<dialog className="gp-dialog material-prompt-dialog" aria-label="提示词草稿预览" ref={node=>{if(node&&!node.open)node.showModal();}} onCancel={e=>{e.preventDefault();setPreview(null);}}>
      <div className="gp-card-heading"><h2>提示词草稿预览</h2><button type="button" className="gp-icon" aria-label="关闭提示词草稿" onClick={()=>setPreview(null)}><X size={18}/></button></div>
      <p className="gp-muted">根据当前需求整理，可在此修改后使用。{materialPromptText(value)?'使用草稿会替换现有提示词与避免内容。':'关闭预览不会修改需求。'}</p>
      <label className="gp-field">草稿提示词<textarea aria-label="草稿提示词" rows={9} value={preview.prompt} onChange={e=>setPreview({...preview,prompt:e.target.value})}/></label>
      <label className="gp-field">草稿避免内容<textarea aria-label="草稿避免内容" rows={3} value={preview.negative} onChange={e=>setPreview({...preview,negative:e.target.value})}/></label>
      <div className="gp-dialog-actions"><button className="gp-secondary" onClick={()=>setPreview(null)}>取消</button><button className="primary" disabled={disabled} onClick={()=>{onChange(preview);setPreview(null);setNotice('');setCopyError('');}}>使用草稿</button></div>
    </dialog>}
  </section>;
}
