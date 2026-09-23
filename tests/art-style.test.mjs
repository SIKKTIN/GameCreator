import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {emptyArtAssets,createArtRequirement,createArtAsset,validateArtAssets,validateArtMutation,artAssetsMarkdown,readArtAssets,writeArtAssets} from '../src/art-assets.ts';
import {emptyArtStyle,confirmArtStyle,currentArtStyle,styleDraftChanged,styleReviewState,reviewArtStyle,itemStyleMarkdown,productionStyleMarkdown,validateArtStyle,validateStyleItem} from '../src/art-style.ts';
import {artLibrary,assignArtCategory,saveArtCategory,removeArtCategory} from '../src/art-library.ts';
import {addMaterialRequirements} from '../src/material-items.ts';
import {assertContentChange,applyProjectRows} from '../shared/project-changes.mjs';
import {preparePrototypeProject,writePrototypeProject} from '../src/prototype-import.ts';
import {captureProjectPackage,prepareProjectPackageImport,writeProjectPackageImport} from '../src/project-package.ts';
import {buildSearchIndex,searchEntries} from '../src/global-search.ts';
const memory=()=>{const values=new Map();return{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};};
function fixture(){
 const r={...createArtRequirement('角色测试'),status:'已通过'},a=createArtAsset('场景测试');let s={...emptyArtAssets(),requirements:[r],assets:[a]};s=saveArtCategory(s,'外景','');const cat=s.library.categories.find(c=>c.name==='角色').id,scene=s.library.categories.at(-1).id;
 s=assignArtCategory(assignArtCategory(s,'requirement',r.id,cat),'asset',a.id,scene);s.style=emptyArtStyle();s.style.draft.direction='纸片与水彩';s.style.draft.categories=[{id:cat,rules:'角色比例二头身'},{id:scene,rules:'远景保持低对比'}];s.style=confirmArtStyle(s.style,'首次确定基准');return{s,r,a,cat,scene};
}
test('legacy projects stay untouched and unspecified art never acquires a guessed style',()=>{
 const storage=memory(),raw=JSON.stringify(emptyArtAssets());storage.setItem('art',raw);const {store}=readArtAssets(storage,'art');assert.equal(store.style,undefined);assert.equal(styleDraftChanged(store.style),false);assert.equal(currentArtStyle(store.style),undefined);assert.doesNotThrow(()=>validateArtAssets(store));assert.equal(storage.getItem('art'),raw);assert.match(artAssetsMarkdown(store,{designs:[],functional:{systems:[],capabilities:[]}}),/美术风格待确定/);
 const blank=emptyArtStyle();assert.throws(()=>confirmArtStyle(blank,'基准'),/整体风格/);blank.draft.direction='纸片';assert.throws(()=>confirmArtStyle(blank,''),/原因/);const v=confirmArtStyle(blank,'明确方向');assert.equal(v.versions[0].definition.view,'');assert.throws(()=>confirmArtStyle(v,'再确认'),/一致/);
});
test('drafts, category supplements, exceptions and global revisions invalidate only relevant reviews',()=>{
 const {s,r,a,cat,scene}=fixture();r.styleReview=reviewArtStyle(s.style,r,cat);a.styleReview=reviewArtStyle(s.style,a,scene);
 assert.equal(styleReviewState(s.style,r,cat),'reviewed');s.style.draft.direction='仍在讨论的风格';assert.equal(styleReviewState(s.style,r,cat),'reviewed');assert.doesNotMatch(itemStyleMarkdown(s,'requirement',r.id),/仍在讨论/);
 s.style.draft.direction='纸片与水彩';s.style.draft.categories[1].rules='远景使用冷色';s.style=confirmArtStyle(s.style,'只调整外景');assert.equal(styleReviewState(s.style,r,cat),'reviewed');assert.equal(styleReviewState(s.style,a,scene),'changed');
 s.style.draft.mood='宁静';s.style=confirmArtStyle(s.style,'整体氛围');assert.equal(styleReviewState(s.style,r,cat),'changed');assert.equal(r.status,'已通过');
 r.styleException={requirements:'此角色三头身',reason:''};assert.throws(()=>reviewArtStyle(s.style,r,cat),/原因/);r.styleException.reason='首领体型识别';r.styleReview=reviewArtStyle(s.style,r,cat);assert.equal(styleReviewState(s.style,r,cat),'reviewed');r.styleException.requirements='四头身';assert.equal(styleReviewState(s.style,r,cat),'changed');assert.equal(styleReviewState(s.style,r,scene),'changed');
});
test('confirmed baselines are immutable and malformed colors, references and reviews cannot be persisted',()=>{
 const {s,r}=fixture();const next=structuredClone(s);next.style.draft.palette.push({id:'p',name:'强调',color:'#84ab92',usage:'可交互内容'});next.style=confirmArtStyle(next.style,'增加强调色');assert.doesNotThrow(()=>validateArtMutation(s,next));assert.equal(next.requirements[0].status,'已通过');
 for(const mutate of [v=>v.style.versions[0].note='覆盖历史',v=>v.style.versions=[],v=>delete v.style,v=>v.style.versions.push({...v.style.versions[0],revision:2,definition:{...v.style.draft,direction:'与草稿不同'}})]){const bad=structuredClone(s);mutate(bad);assert.throws(()=>validateArtMutation(s,bad),/版本|草稿/);}
 const bad=structuredClone(next);bad.style.draft.palette[0].color='url(javascript:x)';assert.throws(()=>validateArtAssets(bad),/美术风格/);assert.throws(()=>validateArtStyle({...s.style,unknown:true}),/存档/);assert.throws(()=>validateStyleItem({...r,styleReview:{revision:0,categoryId:'',at:new Date().toISOString(),exception:{requirements:'',reason:''}}}),/复核/);
});
test('category rename retains review while reassignment requires it; standalone conversion preserves style',()=>{
 let {s,r,a,cat,scene}=fixture();r.styleReview=reviewArtStyle(s.style,r,cat);a.styleException={requirements:'特殊剪影',reason:'区域辨识'};a.styleReview=reviewArtStyle(s.style,a,scene);
 s=saveArtCategory(s,'人物','',cat);assert.match(itemStyleMarkdown(s,'requirement',r.id),/所属分类：人物/);assert.equal(styleReviewState(s.style,r,cat),'reviewed');const converted=addMaterialRequirements(s,a.id);const requirement=converted.store.requirements.at(-1);assert.deepEqual(requirement.styleException,a.styleException);assert.deepEqual(requirement.styleReview,a.styleReview);
 s=removeArtCategory(s,cat);assert.match(itemStyleMarkdown(s,'requirement',r.id),/风格已更新/);assert.doesNotThrow(()=>validateArtAssets(s));
});
test('item and production documents use effective category context, preserve prompts and mark draft separately',()=>{
 const {s,r,a}=fixture();r.generationPrompt={prompt:'用户写好的提示词',negative:'不要文字'};r.styleException={requirements:'主角保留金边',reason:'定位辨识'};
 const doc={id:'doc',title:'角色制作方案',category:'',content:'制作分件',requirementIds:[r.id],assetIds:[],images:[],createdAt:r.createdAt,updatedAt:r.updatedAt};s.productionDocs=[doc];s.style.draft.direction='尚未批准的写实';
 const item=itemStyleMarkdown(s,'requirement',r.id);assert.match(item,/二头身/);assert.match(item,/主角保留金边/);assert.doesNotMatch(item,/远景|尚未批准的写实/);assert.equal(productionStyleMarkdown(s,doc),item);assert.match(itemStyleMarkdown(s,'asset',a.id),/远景保持低对比/);
 const markdown=artAssetsMarkdown(s,{designs:[],functional:{systems:[],capabilities:[]}});assert.match(markdown,/待确认草稿（不作为当前制作标准）/);assert.match(markdown,/用户写好的提示词/);assert.match(markdown,/纸片与水彩/);assert.equal(r.generationPrompt.prompt,'用户写好的提示词');
 const result=searchEntries(buildSearchIndex({art:s}),'纸片与水彩');assert.ok(result.some(e=>e.entry.target.kind==='style'));
 s.links.push({id:'link',requirementId:r.id,assetId:a.id,note:'旧交付资源'});assert.match(productionStyleMarkdown(s,{...doc,requirementIds:[],assetIds:[a.id]}),/主角保留金边/);
});
test('project feedback may propose draft edits but cannot confirm baselines or fabricate review',()=>{
 const {s,r,cat}=fixture(),next=structuredClone(s);next.style.draft.direction='反馈提出的方向';assert.doesNotThrow(()=>assertContentChange('art-assets',s,next,['/style/draft/direction']));
 next.style=confirmArtStyle(next.style,'绕过确认');assert.throws(()=>assertContentChange('art-assets',s,next,['/style']),/历史/);const reviewed=structuredClone(s);reviewed.requirements[0].styleReview=reviewArtStyle(s.style,r,cat);assert.throws(()=>assertContentChange('art-assets',s,reviewed,['/requirements/@'+r.id]),/历史/);
 assert.throws(()=>applyProjectRows('art-assets',s,[{field:'/style/versions',state:'updated',incoming:JSON.stringify(s.style.versions)}]),/独立/);
});
test('portable project roundtrip preserves style, review and old art data; stale writes are rejected',()=>{
 const example=JSON.parse(fs.readFileSync(new URL('../examples/prototypes/plants-vs-zombies.json',import.meta.url),'utf8')),storage=memory(),p=preparePrototypeProject({schema:2,projects:[],mode:'project',activeId:''},example,'风格项目');writePrototypeProject(storage,p);const key='gamecreator.workspace.v1:'+p.project.id+':art-assets',raw=storage.getItem(key),s=JSON.parse(raw),original=structuredClone(s);
 s.style=fixture().s.style;const r=s.requirements[0];r.styleReview=reviewArtStyle(s.style,r,artLibrary(s).requirements[r.id]);writeArtAssets(storage,key,raw,s);assert.throws(()=>writeArtAssets(storage,key,raw,s),/其他窗口/);
 const pkg=captureProjectPackage(storage,p.project),restored=prepareProjectPackageImport(p.catalog,pkg.document,'副本');writeProjectPackageImport(storage,restored);assert.deepEqual(JSON.parse(storage.getItem('gamecreator.workspace.v1:'+restored.project.id+':art-assets')),s);assert.deepEqual(s.assets,original.assets);assert.deepEqual(s.links,original.links);assert.equal(s.requirements[0].status,original.requirements[0].status);
});
