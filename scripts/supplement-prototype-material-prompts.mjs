import { validateArtAssets, validateArtMutation } from '../src/art-assets.ts';
/** Explicit supplementation only: user-written prompts and changed/archived requirements are preserved. */
export function supplementPrototypeMaterialPrompts(value, templates, now = new Date().toISOString()) {
  const store=structuredClone(validateArtAssets(value)),source=new Map();
  for(const template of templates)for(const requirement of template.requirements){if(source.has(requirement.id))throw new Error('示例需求标识重复');source.set(requirement.id,requirement);}
  const report={filled:[],preserved:[],changed:[],archived:[]};
  for(const r of store.requirements){
    const baseline=source.get(r.id);if(!baseline)continue;
    if(r.archived){report.archived.push(r.id);continue;}
    if(r.generationPrompt?.prompt?.trim()||r.generationPrompt?.negative?.trim()){report.preserved.push(r.id);continue;}
    if(['name','category','description','specification','acceptance'].some(k=>r[k]!==baseline[k])){report.changed.push(r.id);continue;}
    if(!baseline.generationPrompt?.prompt?.trim()||!baseline.generationPrompt?.negative?.trim())throw new Error('示例提示词尚未完整填写');
    r.generationPrompt=structuredClone(baseline.generationPrompt);r.updatedAt=now;report.filled.push(r.id);
  }
  validateArtMutation(value,store);return {store,...report};
}
