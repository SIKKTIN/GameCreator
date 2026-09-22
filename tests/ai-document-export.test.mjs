import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {buildAiDocument,buildAiMarkdown,buildAiDocumentFiles,aiModules} from '../src/ai-export.ts';
import {buildDocumentZip} from '../src/ai-document-zip.ts';
import {defaultFolderName,markdownName,validateDocumentFiles} from '../shared/ai-document-files.mjs';
const config={engine:'test',projectPath:'',enumPath:'',dataPath:'',outputFormat:'lua',autoSync:false};
const args=e=>[{name:e.name,description:e.description,genre:'',platform:'',version:'v1',status:'草稿'},e.stories,e.data,e.definitions,config,{scan:null,active:null},e.gameplay.designs,e.functionalSystems,e.artAssets,e.gameplayCore,e.prototypeDesign,e.taskFlows,e.storyOrchestration,e.mapDesign,e.gameplay.categories,e.projectSchedule,e.numericalAnalysis,undefined,e.developmentTools];
for(const slug of ['plants-vs-zombies','stardew-valley','hollow-knight','disco-elysium','vampire-survivors']) {
  test(slug+': shared sections retain all content in the full and separate documents',async()=>{
    const e=JSON.parse(await fs.readFile(new URL('../examples/prototypes/'+slug+'.json',import.meta.url),'utf8')),before=JSON.stringify(e);
    const doc=buildAiDocument(...args(e)),bundle=buildAiDocumentFiles(doc,{folderName:'设计资料',summaryName:'完整 内容（终稿）',moduleNames:{gameplay:'玩法 #规则 [v1]'}});
    assert.equal(bundle.files.length,doc.sections.length+1);assert.equal(bundle.files[0].path,'完整 内容（终稿）.md');
    assert.equal(doc.sections.some(s=>s.id==='narrative'),!!e.storyOrchestration?.enabled);assert.equal(doc.sections.some(s=>s.id==='maps'),!!e.mapDesign?.enabled);
    for(const [i,section] of doc.sections.entries()) {
      assert.ok(bundle.files[0].content.includes(section.body));assert.ok(bundle.files[i+1].content.endsWith(section.body+'\n'));
      assert.ok(bundle.files[i+1].content.includes(doc.generatedAt));assert.ok(bundle.files[i+1].content.includes(doc.projectName));
      const link=bundle.files[0].content.match(new RegExp('\\['+section.label+'\\]\\(<([^>]+)>\\)'));
      assert.ok(link);assert.equal(decodeURIComponent(link[1]),bundle.files[i+1].path);
    }
    const legacy=buildAiMarkdown(...args(e));for(const section of doc.sections)assert.ok(legacy.includes(section.body));
    assert.equal(JSON.stringify(e),before);
  });
}
test('empty projects export every always-on module and clearly mark empty content',()=>{
  const doc=buildAiDocument({name:'空白项目',genre:'',version:'',status:'',platform:'',description:''},[],{datasets:{},columns:{}},[],config,{scan:null});
  assert.equal(doc.sections.length,aiModules.length-2);
  for(const id of ['stories','data','enum-definitions','prototype','functional','art','gameplay'])assert.match(doc.sections.find(s=>s.id===id).body,/暂无/);
});
test('file names, Unicode duplicates and traversal are validated consistently',()=>{
  const base={folderName:'项目 AI 文档',files:[{path:'总览.md',content:'内容'},{path:'模块/玩法.md',content:'正文'}]};
  assert.equal(markdownName('中文 名称'),'中文 名称.md');assert.equal(markdownName('设计.MD'),'设计.MD');
  for(const name of ['','../escape','x\\y','CON.md','LPT1','bad:ads','name.','尾部 ','\u0000.md'])assert.throws(()=>markdownName(name));
  for(const bad of ['/outside.md','../outside.md','模块/../../outside.md','模块/目录/文件.md','模块/CON.md','模块/run.exe'])assert.throws(()=>validateDocumentFiles({...base,files:[base.files[0],{path:bad,content:''}]}));
  assert.throws(()=>validateDocumentFiles({...base,files:[...base.files,{path:'模块/玩法.MD',content:''}]}),/重复/);
  assert.match(defaultFolderName('坏/路径:名',new Date(2026,8,21,10,2,3)),/^坏-路径-名-AI文档-2026-09-21-100203$/);
});
test('browser ZIP round-trips Unicode paths and content using Python zipfile',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-ai-zip-'));
  try {
    const files=[{path:'总览.md',content:'# 总文档\n中文与 emoji 🎮\n'},{path:'模块/玩法 #1.md',content:'## 规则\n跳跃 → 落地\n'}],filename=path.join(dir,'documents.zip');
    await fs.writeFile(filename,buildDocumentZip('项目 文档',files));
    const result=execFileSync('python',['-c',"import zipfile,json,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps({n:z.read(n).decode('utf-8') for n in z.namelist()}))",filename],{encoding:'utf8'});
    assert.deepEqual(JSON.parse(result),Object.fromEntries(files.map(f=>['项目 文档/'+f.path,f.content])));
  } finally {assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));await fs.rm(dir,{recursive:true,force:true});}
});
