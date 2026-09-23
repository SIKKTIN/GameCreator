import test from 'node:test';
import assert from 'node:assert/strict';
import {configDataPolicyMarkdown,policyExportPath} from '../shared/config-data-policy.mjs';
import {buildAiDocument,buildAiDocumentFiles,buildAiMarkdown} from '../src/ai-export.ts';
import {syncDocuments} from '../shared/engine-sync.mjs';
import {frameworkLibrary} from '../shared/program-framework-library.mjs';
const config={engine:'godot-gdscript',projectPath:'E:/Games/Prototype',dataPath:'res://balance/tables/',outputFormat:'json',enumPath:'.',autoSync:false,backupBeforeSync:true};
const args=c=>[{name:'通用项目',version:'1',genre:'',platform:'',status:'',description:''},[],{datasets:{},columns:{}},[],c,{scan:null}];
test('policy uses the one library source with normalized per-project settings and no game-specific objects',()=>{
 const source=frameworkLibrary.documents.find(d=>d.id==='config-data-policy');assert.equal(source.group,'开发规范');assert.equal(source.kind,'reference');
 const text=configDataPolicyMarkdown(config);assert.match(text,/E:\/Games\/Prototype\/balance\/tables/);assert.doesNotMatch(text,/植物|僵尸|data\/generated/);assert.ok(text.includes('## 7. 交付检查'));assert.doesNotMatch(text,/返回目录/);
 const changed=configDataPolicyMarkdown({...config,projectPath:'D:/New',dataPath:'settings/config'});assert.match(changed,/D:\/New\/settings\/config/);assert.doesNotMatch(changed,/balance\/tables/);
});
test('unconfigured or unsupported settings are explained without inventing a usable location',()=>{
 const text=configDataPolicyMarkdown({...config,projectPath:'',dataPath:'../outside',outputFormat:'lua'});assert.match(text,/未连接工程/);assert.match(text,/尚未确定/);assert.match(text,/当前格式不适用于数据同步/);assert.doesNotMatch(text,/Prototype\/outside/);
});
test('non-adopting projects always export the policy, even with only a non-framework module selected for sync',()=>{
 const doc=buildAiDocument(...args(config));assert.match(doc.sections.find(s=>s.id==='framework').body,/未采用/);
 const bundle=buildAiDocumentFiles(doc,{folderName:'文档',summaryName:'总览',moduleNames:{}});assert.ok(bundle.files[0].content.includes(doc.configDataPolicy));assert.ok(bundle.files.find(f=>f.path===policyExportPath).content.includes(doc.configDataPolicy));assert.ok(buildAiMarkdown(...args(config)).includes(doc.configDataPolicy));
 const files=syncDocuments(doc,['overview']);assert.deepEqual(files.map(f=>f.path),['README.md','modules/overview.md','config-data-policy.md']);assert.match(files[0].content,/config-data-policy.md/);assert.ok(files[2].content.includes(doc.configDataPolicy));
 assert.deepEqual(syncDocuments({...doc,generatedAt:'different'},['overview']),files);
 assert.throws(()=>buildAiDocumentFiles(doc,{folderName:'文档',summaryName:'总览',moduleNames:{overview:'config-data-policy.md'}}),/重复/);
});
