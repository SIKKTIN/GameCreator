import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createRequire} from 'node:module';
import {materialPromptDraft,materialPromptText} from '../src/material-prompt.ts';
import {createArtRequirement,emptyArtAssets,validateArtAssets,validateArtMutation,readArtAssets,writeArtAssets,artAssetsMarkdown} from '../src/art-assets.ts';
import {preparePrototypeProject,writePrototypeProject} from '../src/prototype-import.ts';
import {captureProjectPackage,validateProjectPackage,prepareProjectPackageImport,writeProjectPackageImport} from '../src/project-package.ts';
const require=createRequire(import.meta.url),{createWorkspaceStorage}=require('../desktop/test-workspaces.cjs'),{createProjectPackages}=require('../desktop/project-package.cjs');
const fixture=()=>{const r=createArtRequirement('玩家站立图');return {...emptyArtAssets(),requirements:[{...r,category:'角色',description:'小型角色，清晰剪影',specification:'侧视，透明背景，128×128',acceptance:'缩小仍可辨识'}]};};
test('old requirements stay unchanged and optional prompts validate strictly',()=>{
 const s=fixture(),raw=JSON.stringify(s);let writes=0;const storage={getItem:()=>raw,setItem:()=>writes++};assert.deepEqual(readArtAssets(storage,'art').store,s);assert.equal(writes,0);assert.equal(materialPromptText(s.requirements[0].generationPrompt),'');
 for(const v of [null,'x',[],{}, {prompt:'x'},{prompt:'x',negative:42}])assert.throws(()=>validateArtAssets({...s,requirements:[{...s.requirements[0],generationPrompt:v}]}));
 assert.doesNotThrow(()=>validateArtAssets({...s,requirements:[{...s.requirements[0],generationPrompt:{prompt:'',negative:''}}]}));
});
test('drafts use requirement text and type-specific guidance without overwriting stored prompts',()=>{
 const r={...fixture().requirements[0],generationPrompt:{prompt:'保留手写描述',negative:'不要文字\n不要水印'}},before=structuredClone(r),draft=materialPromptDraft(r,'角色');
 for(const text of [r.name,r.description,r.specification,r.acceptance])assert.ok(draft.prompt.includes(text));assert.equal(draft.negative,r.generationPrompt.negative);assert.deepEqual(r,before);
 const audio=materialPromptDraft({...r,name:'夜晚环境音乐',category:'其他',specification:'60 秒，可循环',acceptance:'衔接无跳变'},'音频');assert.ok(audio.prompt.includes('音频素材'));assert.ok(!audio.prompt.includes('风格、视角、构图'));
 const animation=materialPromptDraft({...r,category:'动画'});assert.ok(animation.prompt.includes('动作阶段'));assert.ok(animation.prompt.includes('各帧'));
 assert.equal(materialPromptText({prompt:'主体\n第二行',negative:'不要背景'}),'主体\n第二行\n\n避免内容：\n不要背景');
 assert.equal(materialPromptText({prompt:' ',negative:''}),'');
});
test('prompt edits obey archived immutability and stale-write protection',()=>{
 const s=fixture(),next=structuredClone(s);next.requirements[0].generationPrompt={prompt:'剪影',negative:'无字'};assert.doesNotThrow(()=>validateArtMutation(s,next));
 const archived=structuredClone(s);archived.requirements[0].archived=true;assert.throws(()=>validateArtMutation(archived,{...next,requirements:[{...next.requirements[0],archived:true}]}),/已归档/);
 let raw=JSON.stringify(s);const storage={getItem:()=>raw,setItem:(k,v)=>{raw=v;}};writeArtAssets(storage,'a',raw,next);assert.throws(()=>writeArtAssets(storage,'a',JSON.stringify(s),next),/其他窗口/);
 const markdown=artAssetsMarkdown(next,{designs:[],functional:{schema:1,systems:[],capabilities:[],bindings:[]}});assert.ok(markdown.includes('## 素材资产'));assert.ok(markdown.includes('素材生成提示词：\n剪影\n\n避免内容：\n无字'));
});
test('real folder export/import preserves both prompt fields and rejects malformed prompts at desktop boundary',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-material-prompts-'));try{
 const storage=createWorkspaceStorage(path.join(dir,'data')),api=createProjectPackages({dataDirectory:path.join(dir,'data'),storage});
 const e=JSON.parse(await fs.readFile(new URL('../examples/prototypes/hollow-knight.json',import.meta.url),'utf8')),p=preparePrototypeProject({schema:2,activeId:'',mode:'project',projects:[]},e,'素材排期');writePrototypeProject(storage,p);storage.setItem('gamecreator.projects.v1',JSON.stringify(p.catalog));
 const key='gamecreator.workspace.v1:'+p.project.id+':art-assets',a=JSON.parse(storage.getItem(key));a.requirements[0].generationPrompt={prompt:'透明背景\n清晰剪影',negative:'无文字'};storage.setItem(key,JSON.stringify(a));
 const captured=captureProjectPackage(storage,p.project),folder=path.join(dir,'export');await api.exportFolder({projectId:p.project.id,directory:folder,...captured});const loaded=validateProjectPackage((await api.readFolder(folder)).document);assert.deepEqual(loaded.archives['art-assets'],a);
 const copy=prepareProjectPackageImport(p.catalog,loaded,'素材副本');writeProjectPackageImport(storage,copy);assert.deepEqual(JSON.parse(storage.getItem('gamecreator.workspace.v1:'+copy.project.id+':art-assets')),a);
 assert.deepEqual(loaded.archives['project-schedule'],e.projectSchedule);
 const bad=structuredClone(captured.document);bad.archives['art-assets'].requirements[0].generationPrompt={prompt:123,negative:''};assert.throws(()=>validateProjectPackage(bad));await assert.rejects(api.exportFolder({projectId:p.project.id,directory:path.join(dir,'bad'),document:bad,expectedEntries:captured.expectedEntries}),/提示词/);
 }finally{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('gc-material-prompts-'));await fs.rm(dir,{recursive:true,force:true});}
});
