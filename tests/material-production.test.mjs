import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {validateProductionDocs,productionTemplate} from '../shared/material-production.mjs';
import {emptyArtAssets,createArtAsset,validateArtAssets,artAssetsMarkdown} from '../src/art-assets.ts';
import {removeArtItem} from '../src/art-deletion.ts';
import {captureProjectPackage,prepareProjectPackageImport,writeProjectPackageImport} from '../src/project-package.ts';
const require=createRequire(import.meta.url),{createWorkspaceStorage}=require('../desktop/test-workspaces.cjs'),{createArtFiles}=require('../desktop/art-files.cjs'),{createProjectPackages}=require('../desktop/project-package.cjs'),{createEngineSync}=require('../desktop/engine-sync.cjs');
const now=new Date().toISOString(),doc=()=>({id:'doc',title:'僵尸骨骼动画',category:'动画制作',content:productionTemplate,requirementIds:[],assetIds:[],images:[],createdAt:now,updatedAt:now});
test('old archives stay valid; freeform documents validate references and managed image paths',()=>{
 assert.equal(validateArtAssets(emptyArtAssets()).productionDocs,undefined);assert.deepEqual(validateProductionDocs(undefined),[]);
 assert.equal(validateProductionDocs([doc()])[0].content,productionTemplate);
 for(const broken of [[doc(),doc()],[{...doc(),assetIds:['a','a']}],[{...doc(),images:[{id:'f',name:'bad',mime:'image/png',storagePath:'../../bad.png',size:1}]}]])assert.throws(()=>validateProductionDocs(broken));
});
test('document references protect linked material cards; Markdown includes freeform technical content',()=>{
 const asset=createArtAsset('僵尸'),store={...emptyArtAssets(),assets:[asset],productionDocs:[{...doc(),assetIds:[asset.id]}]};
 assert.throws(()=>removeArtItem(store,{kind:'asset',id:asset.id}),/制作方案/);
 const markdown=artAssetsMarkdown(store,{designs:[],functional:{systems:[],capabilities:[],dependencies:[]}});assert.match(markdown,/制作方案/);assert.match(markdown,/技术与工具选择/);assert.match(markdown,/关联资产：僵尸/);
});
test('document-only images survive portable archives and sync with documents when asset delivery is disabled',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-production-'));t.after(async()=>{assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));await fs.rm(dir,{recursive:true,force:true});});
 const data=path.join(dir,'data'),storage=createWorkspaceStorage(data),id='project-'+crypto.randomUUID(),config={engine:'godot-gdscript',projectPath:'',enumPath:'.',dataPath:'data',outputFormat:'json',autoSync:false,backupBeforeSync:true};
 const project={id,name:'文档项目',config,initialContent:'empty'},catalog={schema:2,mode:'project',activeId:id,projects:[project]};storage.setItem('gamecreator.projects.v1',JSON.stringify(catalog));
 const source=path.join(dir,'rig.png');const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aV8AAAAASUVORK5CYII=','base64');await fs.writeFile(source,png);
 const artFiles=createArtFiles(data),files=await artFiles.importFiles('project:'+id,[source]),art={...emptyArtAssets(),productionDocs:[{...doc(),images:files,content:'## 分件\n\n![骨架](material-image:'+files[0].storagePath+')\n\n```gdscript\nplay("walk")\n```'}]};storage.setItem('gamecreator.workspace.v1:'+id+':art-assets',JSON.stringify(art));
 const packages=createProjectPackages({dataDirectory:data,storage}),directory=path.join(dir,'portable');await packages.exportFolder({projectId:id,directory,...captureProjectPackage(storage,project)});
 assert.deepEqual(await fs.readFile(path.join(directory,'assets',files[0].storagePath)),png);
 const opened=await packages.prepareImport(directory),prepared=prepareProjectPackageImport(catalog,opened.document,'副本');await packages.restoreAssets({token:opened.token,projectId:prepared.project.id});writeProjectPackageImport(storage,prepared);assert.deepEqual(JSON.parse(storage.getItem('gamecreator.workspace.v1:'+prepared.project.id+':art-assets')).productionDocs,art.productionDocs);
 const engine=path.join(dir,'engine');await fs.mkdir(engine);await fs.writeFile(path.join(engine,'project.godot'),'config_version=5');
 const sync=createEngineSync({artFiles}),input={projectId:id,config:{...config,projectPath:engine},settings:{documents:true,assets:false,includePlaceholders:false,docsDirectory:'docs/design',assetsDirectory:'assets/design',modules:['art']},document:{projectName:project.name,version:'v1',sections:[{id:'art',label:'素材资产',body:artAssetsMarkdown(art,{designs:[],functional:{systems:[],capabilities:[],dependencies:[]}})}]},art};
 const plan=await sync.preview(input),image=plan.rows.find(r=>r.id.startsWith('document:production-image:'));assert.ok(image);await sync.apply({token:plan.token,decisions:{},removals:[]});
 assert.deepEqual(await fs.readFile(path.join(engine,image.path)),png);assert.match(await fs.readFile(path.join(engine,'docs/design/modules/art.md'),'utf8'),new RegExp('../media/'+files[0].storagePath));
 const excluded=await sync.preview({...input,settings:{...input.settings,modules:[]}});assert.ok(!excluded.rows.some(r=>r.status==='added'&&r.id.startsWith('document:production-image:')));
});
