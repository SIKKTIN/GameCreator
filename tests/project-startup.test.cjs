const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./authoring-fixture.cjs'),{createEngineSync}=require('../desktop/engine-sync.cjs'),{createProjectStartup}=require('../desktop/project-startup.cjs');
async function setup(t){
 const f=await fixture();t.after(f.close);const engine=path.join(f.root,'engine');fs.mkdirSync(engine);fs.writeFileSync(path.join(engine,'project.godot'),'config_version=5');
 f.project.config.projectPath=engine;const catalog=JSON.parse(f.storage.getItem('gamecreator.projects.v1'));catalog.projects[0].config=f.project.config;f.storage.setItem('gamecreator.projects.v1',JSON.stringify(catalog));
 const sync=createEngineSync({storage:f.storage,artFiles:{}}),startup=createProjectStartup({storage:f.storage,folders:f.folders,developers:f.developers,engineSync:sync});
 const input=()=>({...f.input(),document:{projectName:f.project.name,version:'1',sections:[{id:'overview',label:'项目概览',body:'原型设计'},{id:'standards',label:'项目规范',body:'先复用，再扩展'},{id:'art',label:'素材资产',body:'角色文档'}]},collaboration:{schedule:JSON.parse(f.storage.getItem(f.sk)),tools:{schema:1,tools:[]}},art:{assets:[]}});
 return {...f,engine,sync,startup,input,preview:(extra={})=>startup.run('preview',{...input(),...extra})};
}
test('initialization exports engine workflow, grouped docs and private credentials; repeat preserves identities and secrets',async t=>{
 const f=await setup(t),p=await f.preview();assert.equal(p.blockers.length,0);assert.equal(JSON.stringify(p).includes(f.secret.privateKey),false);
 const result=await f.startup.run('initialize',{projectId:f.project.id,token:p.plan.token});assert.ok(result.initializedAt);
 const credentialFile=path.join(f.engine,'gamecreator/personal',f.memberId+'.json');assert.equal(JSON.parse(fs.readFileSync(credentialFile)).privateKey,f.secret.privateKey);
 assert.match(fs.readFileSync(path.join(f.engine,'.gitignore'),'utf8'),/\/gamecreator\/personal\//);
 assert.ok(fs.existsSync(path.join(f.engine,'gamecreator/personal/.gdignore')));
 const readme=fs.readFileSync(path.join(f.engine,'docs/gamecreator/README.md'),'utf8');assert.ok(readme.includes(f.project.folderPath));assert.match(readme,/ai\/changes/);assert.match(readme,/gamecreator\/feedback/);assert.match(readme,/modules\/content\/art.md/);
 const project=JSON.parse(fs.readFileSync(path.join(f.engine,'gamecreator/project.json')));assert.equal(project.authoring.projectDirectory,f.project.folderPath);
 assert.ok(fs.existsSync(path.join(f.project.folderPath,'ai/submit-change.cjs')));
 const mtime=fs.statSync(credentialFile).mtimeMs,next=await f.preview();assert.ok(next.plan.rows.every(r=>r.status==='unchanged'));
 await f.startup.run('initialize',{projectId:f.project.id,token:next.plan.token});assert.equal(fs.statSync(credentialFile).mtimeMs,mtime);assert.equal(JSON.parse(f.storage.getItem(f.sk)).personnel.credentials.length,1);
 for(const file of fs.readdirSync(path.join(f.engine,'.gamecreator-sync'),{recursive:true})){const full=path.join(f.engine,'.gamecreator-sync',file);if(fs.statSync(full).isFile())assert.equal(fs.readFileSync(full).includes(Buffer.from(f.secret.privateKey)),false,'private key leaked into sync history');}
});
test('custom entry directory links canonical feedback; existing readme and gitignore remain reviewable',async t=>{
 const f=await setup(t);fs.mkdirSync(path.join(f.engine,'team'));fs.writeFileSync(path.join(f.engine,'team/README.md'),'User instructions');fs.writeFileSync(path.join(f.engine,'.gitignore'),'builds/\n');
 const p=await f.preview({entryDirectory:'team'});assert.ok(p.plan.rows.some(r=>r.path==='team/README.md'&&r.status==='conflict'));
 await assert.rejects(f.startup.run('initialize',{projectId:f.project.id,token:p.plan.token}),/冲突/);
 await f.startup.run('initialize',{projectId:f.project.id,token:p.plan.token,decisions:{'team/README.md':'keep'}});
 assert.equal(fs.readFileSync(path.join(f.engine,'team/README.md'),'utf8'),'User instructions');assert.match(fs.readFileSync(path.join(f.engine,'.gitignore'),'utf8'),/^builds\/\n/);assert.ok(fs.existsSync(path.join(f.engine,'team/personal',f.memberId+'.json')));
});
test('producer scope, revoked credentials, changed sources and conflicting private files block initialization',async t=>{
 const f=await setup(t),p=await f.preview();let s=JSON.parse(f.storage.getItem(f.sk));s.personnel.credentials[0].revokedAt=new Date().toISOString();f.storage.setItem(f.sk,JSON.stringify(s));
 await assert.rejects(f.startup.run('initialize',{projectId:f.project.id,token:p.plan.token}),/制作人|令牌/);assert.equal(fs.existsSync(path.join(f.engine,'gamecreator')),false);
 s.personnel.credentials[0].revokedAt='';s.personnel.members[0].developer.scope='assigned';f.storage.setItem(f.sk,JSON.stringify(s));assert.ok((await f.startup.run('status',f.input())).blockers.some(b=>b.includes('制作人')));
 s.personnel.members[0].developer.scope='project';f.storage.setItem(f.sk,JSON.stringify(s));const next=await f.preview();fs.mkdirSync(path.join(f.engine,'gamecreator/personal'),{recursive:true});fs.writeFileSync(path.join(f.engine,'gamecreator/personal',f.memberId+'.json'),'foreign content');
 await assert.rejects(f.startup.run('initialize',{projectId:f.project.id,token:next.plan.token}),/凭证目标/);assert.equal(fs.existsSync(path.join(f.engine,'docs')),false);
 await assert.rejects(f.preview({entryDirectory:'../outside'}));await assert.rejects(f.preview({entryDirectory:'docs/gamecreator'}),/重叠/);await assert.rejects(f.preview({entryDirectory:'DOCS/GameCreator'}),/重叠/);await assert.rejects(f.preview({entryDirectory:'GameCreator/feedback'}),/协作入口/);
});
test('grouped document migration retains modified old files until an explicit removal',async t=>{
 const f=await setup(t),p=await f.preview();await f.startup.run('initialize',{projectId:f.project.id,token:p.plan.token});
 const manifestPath=path.join(f.engine,'.gamecreator-sync/manifest.json'),m=JSON.parse(fs.readFileSync(manifestPath)),record=m.files.find(r=>r.id==='document:art');
 const oldPath='docs/gamecreator/modules/art.md';fs.renameSync(path.join(f.engine,record.path),path.join(f.engine,oldPath));record.path=oldPath;fs.writeFileSync(manifestPath,JSON.stringify(m));fs.writeFileSync(path.join(f.engine,oldPath),'manual historical note');
 const next=await f.preview(),old=next.plan.rows.find(r=>r.path===oldPath);assert.equal(old.remove,true);assert.equal(old.status,'conflict');
 await f.startup.run('initialize',{projectId:f.project.id,token:next.plan.token,decisions:{[oldPath]:'keep'}});assert.equal(fs.readFileSync(path.join(f.engine,oldPath),'utf8'),'manual historical note');assert.ok(fs.existsSync(path.join(f.engine,'docs/gamecreator/modules/content/art.md')));
});

test('ordinary synchronization maintains the initialized entry and updates its workflow links',async t=>{
 const f=await setup(t),p=await f.preview({entryDirectory:'team'});await f.startup.run('initialize',{projectId:f.project.id,token:p.plan.token});
 const settings=JSON.parse(f.storage.getItem('gamecreator.workspace.v1:'+f.project.id+':engine-sync-'+f.project.config.engine));
 const next=await f.sync.preview({...f.input(),config:f.project.config,settings});const entry=next.rows.find(r=>r.path==='team/README.md');assert.equal(entry.status,'unchanged');assert.equal(!!entry.remove,false);f.sync.release(next.token);
 const moved=await f.sync.preview({...f.input(),config:f.project.config,settings:{...settings,docsDirectory:'design-docs'}});assert.equal(moved.rows.find(r=>r.path==='team/README.md').status,'updated');
 await f.sync.apply({token:moved.token,decisions:{},removals:[]});assert.match(fs.readFileSync(path.join(f.engine,'team/README.md'),'utf8'),/design-docs/);
 await assert.rejects(f.sync.preview({...f.input(),config:f.project.config,settings:{...settings,docsDirectory:'Team'}}),/重叠/);
});
