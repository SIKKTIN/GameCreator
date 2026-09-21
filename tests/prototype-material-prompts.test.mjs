import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {validatePrototypeExample,preparePrototypeProject} from '../src/prototype-import.ts';
import {supplementPrototypeMaterialPrompts} from '../scripts/supplement-prototype-material-prompts.mjs';
const counts={'plants-vs-zombies':20,'stardew-valley':23,'hollow-knight':26,'disco-elysium':22,'vampire-survivors':26};
const examples=Object.entries(counts).map(([slug,count])=>({slug,count,e:JSON.parse(fs.readFileSync(new URL('../examples/prototypes/'+slug+'.json',import.meta.url),'utf8'))}));
for(const {slug,count,e}of examples)test(slug+': every requirement has specific prompts covering linked deliveries',()=>{
 validatePrototypeExample(e);assert.equal(e.artAssets.requirements.length,count);const prompts=new Set();
 for(const r of e.artAssets.requirements){const p=r.generationPrompt;assert.ok(p.prompt.length>250&&p.negative.length>20);assert.ok(p.prompt.includes(r.name));assert.ok(p.prompt.includes('本项具体表现：'));assert.ok(p.prompt.includes(r.acceptance));prompts.add(p.prompt);
  for(const l of e.artAssets.links.filter(l=>l.requirementId===r.id))assert.ok(p.prompt.includes(e.artAssets.assets.find(a=>a.id===l.assetId).name),'linked asset must have a deliverable in prompt');
  assert.equal(r.status,'待制作');assert.equal(r.owner,'');
 }
 assert.equal(prompts.size,count);assert.ok(e.artAssets.assets.every(a=>a.versions.length===0&&!a.adoptedVersionId));
 const p=preparePrototypeProject({schema:2,activeId:'',mode:'project',projects:[]},e,'提示词样例');assert.deepEqual(JSON.parse(p.entries.find(x=>x.key.endsWith(':art-assets')).value),e.artAssets);
});
test('sound and music instructions use audio deliverables, not visual defaults',()=>{
 const audio=examples.find(x=>x.slug==='vampire-survivors').e.artAssets.requirements.filter(r=>/音效|音乐/.test(r.name));assert.equal(audio.length,2);
 for(const r of audio){assert.ok(r.generationPrompt.prompt.includes('48kHz'));assert.ok(!/透明底|透明PNG|sRGB|视角、构图/.test(r.generationPrompt.prompt));}
 assert.ok(audio.find(r=>r.name.includes('音乐')).generationPrompt.prompt.includes('各段不需长达10分钟'));
});
test('explicit supplementation preserves manual/partial prompts, customized requirements, archived content and references',()=>{
 const e=examples[2].e,old=structuredClone(e.artAssets);old.requirements.forEach(r=>delete r.generationPrompt);old.requirements[0].generationPrompt={prompt:'手写版本',negative:''};old.requirements[1].generationPrompt={prompt:'',negative:'手写避免内容'};old.requirements[2].description+='用户补充';old.requirements[3].archived=true;
 const before=structuredClone(old),result=supplementPrototypeMaterialPrompts(old,[e.artAssets],'2026-09-21T01:00:00.000Z');assert.deepEqual(old,before);assert.equal(result.filled.length,22);assert.equal(result.preserved.length,2);assert.equal(result.changed.length,1);assert.equal(result.archived.length,1);
 for(let i=0;i<4;i++)assert.deepEqual(result.store.requirements[i],before.requirements[i]);assert.deepEqual(result.store.assets,before.assets);assert.deepEqual(result.store.links,before.links);
 const repeat=supplementPrototypeMaterialPrompts(result.store,[e.artAssets]);assert.equal(repeat.filled.length,0);assert.deepEqual(repeat.store,result.store);
 const strip=s=>({...s,requirements:s.requirements.map(r=>{const {generationPrompt,updatedAt,...rest}=r;return rest;})});assert.deepEqual(strip(result.store),strip(before));
});
