const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./authoring-fixture.cjs'),{createEngineSync}=require('../desktop/engine-sync.cjs'),{createProjectStartup}=require('../desktop/project-startup.cjs');
async function setup(t){
 const f=await fixture();t.after(f.close);const engine=path.join(f.root,'engine');fs.mkdirSync(engine);fs.writeFileSync(path.join(engine,'project.godot'),'config_version=5');
 f.project.config.projectPath=engine;const catalog=JSON.parse(f.storage.getItem('gamecreator.projects.v1'));catalog.projects[0].config=f.project.config;f.storage.setItem('gamecreator.projects.v1',JSON.stringify(catalog));
 const sync=createEngineSync({storage:f.storage,artFiles:{}}),startup=createProjectStartup({storage:f.storage,folders:f.folders,developers:f.developers,engineSync:sync});
 const input=()=>({...f.input(),document:{projectName:f.project.name,version:'1',sections:[{id:'overview',label:'项目概览',body:'原型设计'},{id:'standards',label:'项目规范',body:'先复用，再扩展'},{id:'art',label:'素材资产',body:'角色文档'}]},collaboration:{schedule:JSON.parse(f.storage.getItem(f.sk)),tools:{schema:1,tools:[]}},art:{assets:[]}});
 return {...f,engine,sync,startup,input,preview:(extra={})=>startup.run('preview',{...input(),...extra})};
}

test('unified preview respects sync scope and shows private credential metadata, rotation and external conflicts',async t=>{
 const f=await setup(t),settings={documents:false,assets:false,collaboration:true,credentials:true,includePlaceholders:true,entryDirectory:'gamecreator',docsDirectory:'design',assetsDirectory:'assets/gamecreator',modules:[]};
 const preview=()=>f.preview({settings,entryDirectory:settings.entryDirectory});
 let p=await preview();assert.ok(p.plan.rows.some(r=>r.kind==='credential'&&r.status==='added'));assert.ok(!JSON.stringify(p).includes(f.secret.privateKey));
 await f.startup.run('initialize',{projectId:f.project.id,token:p.plan.token});
 assert.equal(fs.existsSync(path.join(f.engine,'design/modules/overview.md')),false);assert.ok(fs.existsSync(path.join(f.engine,'design/modules/project-management/standards.md')));
 const sk='gamecreator.workspace.v1:'+f.project.id+':engine-sync-'+f.project.config.engine;assert.equal(JSON.parse(f.storage.getItem(sk)).documents,false);
 let schedule=JSON.parse(f.storage.getItem(f.sk)),m=schedule.personnel.members.find(m=>m.id===f.memberId);
 const rotated=await f.developers.change('rotate',{projectId:f.project.id,memberId:m.id,credentialId:f.credential.id,schedule,name:m.name,duties:m.duties,permissions:m.permissions,active:m.active,profile:m.developer});
 p=await preview();assert.equal(p.plan.rows.find(r=>r.kind==='credential').status,'updated');await f.startup.run('initialize',{token:p.plan.token});
 const file=path.join(f.engine,'gamecreator/personal',m.id+'.json');assert.equal(JSON.parse(fs.readFileSync(file)).credentialId,rotated.credential.id);
 fs.writeFileSync(file,'manual file');p=await preview();const row=p.plan.rows.find(r=>r.kind==='credential');assert.equal(row.status,'conflict');
 await assert.rejects(f.startup.run('initialize',{token:p.plan.token}),/冲突/);
 await f.startup.run('initialize',{token:p.plan.token,decisions:{[row.path]:'keep'}});assert.equal(fs.readFileSync(file,'utf8'),'manual file');
 p=await preview();await f.startup.run('initialize',{token:p.plan.token,decisions:{[row.path]:'replace'}});assert.equal(JSON.parse(fs.readFileSync(file)).credentialId,rotated.credential.id);
 const history=await f.startup.run('history',{projectId:f.project.id});assert.ok(history.history.some(h=>h.files.some(r=>r.action==='kept')));assert.ok(!JSON.stringify(history).includes(f.secret.privateKey));
});

test('credential relocation keeps unconfirmed old paths tracked; revocation can remove the last producer export',async t=>{
 const f=await setup(t);let p=await f.preview();await f.startup.run('initialize',{token:p.plan.token});
 const old='gamecreator/personal/'+f.memberId+'.json',moved='team/personal/'+f.memberId+'.json';
 p=await f.preview({entryDirectory:'team'});assert.equal(p.plan.rows.find(r=>r.path===old).remove,true);await f.startup.run('initialize',{token:p.plan.token});
 assert.ok(fs.existsSync(path.join(f.engine,old)));assert.ok(fs.existsSync(path.join(f.engine,moved)));
 p=await f.preview({entryDirectory:'team'});assert.equal(p.plan.rows.find(r=>r.path===old).remove,true);await f.startup.run('initialize',{token:p.plan.token,removals:[old]});assert.equal(fs.existsSync(path.join(f.engine,old)),false);
 const s=JSON.parse(f.storage.getItem(f.sk));f.developers.revoke({projectId:f.project.id,credentialId:f.credential.id,schedule:s});
 p=await f.preview({entryDirectory:'team'});assert.equal(p.plan.rows.find(r=>r.path===moved).remove,true);await f.startup.run('initialize',{token:p.plan.token,removals:[moved]});assert.equal(fs.existsSync(path.join(f.engine,moved)),false);
 for(const file of fs.readdirSync(path.join(f.engine,'.gamecreator-sync'),{recursive:true})){const full=path.join(f.engine,'.gamecreator-sync',file);if(fs.statSync(full).isFile())assert.ok(!fs.readFileSync(full).includes(Buffer.from(f.secret.privateKey)));}
});

test('case-only entry relocation preserves the same physical credential on Windows',{skip:process.platform!=='win32'},async t=>{
 const f=await setup(t);let p=await f.preview({entryDirectory:'Team'});await f.startup.run('initialize',{token:p.plan.token});
 const old='Team/personal/'+f.memberId+'.json',current='team/personal/'+f.memberId+'.json';
 p=await f.preview({entryDirectory:'team'});assert.ok(!p.plan.rows.some(r=>r.kind==='credential'&&r.remove));
 await f.startup.run('initialize',{token:p.plan.token,removals:[old]});
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.engine,current))).credentialId,f.credential.id);
 const saved=JSON.parse(f.storage.getItem('gamecreator.workspace.v1:'+f.project.id+':project-startup'));
 assert.ok(saved.files[current]);assert.equal(saved.files[old],undefined);
});

test('credential preview rejects changed private files and competing credential-only commits',async t=>{
 const f=await setup(t);let p=await f.preview();await f.startup.run('initialize',{token:p.plan.token});
 const first=await f.preview(),second=await f.preview();await f.startup.run('initialize',{token:first.plan.token});await assert.rejects(f.startup.run('initialize',{token:second.plan.token}),/配置已变化/);
 p=await f.preview();const file=path.join(f.engine,'gamecreator/personal',f.memberId+'.json');fs.writeFileSync(file,'external edit');await assert.rejects(f.startup.run('initialize',{token:p.plan.token}),/凭证目标在预览后发生变化/);assert.equal(fs.readFileSync(file,'utf8'),'external edit');
});

test('partial private writes report failure without secret backups and can be safely previewed again',async t=>{
 const f=await setup(t),schedule=JSON.parse(f.storage.getItem(f.sk));
 const other=await f.developers.change('create',{projectId:f.project.id,schedule,name:'程序',duties:'实现功能',permissions:['progress'],profile:{positionIds:['program'],taskIds:[],scope:'positions',expiresAt:''}});
 const p=await f.preview(),rename=fs.renameSync;
 fs.renameSync=(from,to)=>{if(String(to).endsWith(other.memberId+'.json'))throw new Error('credential disk error');return rename(from,to);};
 try{await assert.rejects(f.startup.run('initialize',{token:p.plan.token}),/凭证同步未完成/);}finally{fs.renameSync=rename;}
 const first=path.join(f.engine,'gamecreator/personal',f.memberId+'.json'),before=fs.readFileSync(first,'utf8');assert.equal(JSON.parse(before).privateKey,f.secret.privateKey);
 const failed=await f.startup.run('history',{projectId:f.project.id});assert.equal(failed.history.at(-1).status,'failed');assert.ok(!JSON.stringify(failed).includes(f.secret.privateKey));
 const retry=await f.preview();await f.startup.run('initialize',{token:retry.plan.token});assert.equal(fs.readFileSync(first,'utf8'),before);assert.equal(JSON.parse(fs.readFileSync(path.join(f.engine,'gamecreator/personal',other.memberId+'.json'))).credentialId,other.credential.id);
 assert.equal(JSON.parse(f.storage.getItem(f.sk)).personnel.credentials.length,2);
});
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

test('project files contain full rules while engine delivery contains only current custom rules, including collaboration-only sync',async t=>{
 const f=await setup(t),key='gamecreator.workspace.v1:'+f.project.id+':project-standards';
 f.storage.setItem(key,JSON.stringify({schema:1,notes:'坐标原点左上，能量按回合结算。',moduleNotes:{art:'角色使用统一色板。',data:'时间字段以毫秒存储。'}}));
 const p=await f.preview();await f.startup.run('initialize',{projectId:f.project.id,token:p.plan.token});
 const standardPath='docs/gamecreator/modules/project-management/standards.md',read=p=>fs.readFileSync(path.join(f.engine,p),'utf8');
 assert.match(read(standardPath),/坐标原点左上/);assert.match(read(standardPath),/统一色板/);assert.match(read(standardPath),/时间字段以毫秒/);assert.doesNotMatch(read(standardPath),/先复用，再扩展/);
 const full=fs.readFileSync(path.join(f.project.folderPath,'PROJECT_STANDARDS.md'),'utf8');assert.match(full,/先复用，再扩展/);assert.match(full,/坐标原点左上/);assert.match(fs.readFileSync(path.join(f.project.folderPath,'README.md'),'utf8'),/PROJECT_STANDARDS.md/);
 assert.equal(fs.existsSync(path.join(f.engine,'gamecreator/GAMECREATOR_GUIDE.md')),false);assert.equal(fs.existsSync(path.join(f.engine,'gamecreator/project-standards.md')),false);
 assert.match(read('gamecreator/README.md'),/\.\.\/docs\/gamecreator\/modules\/project-management\/standards.md/);
 f.storage.setItem(key,JSON.stringify({schema:1,notes:'',moduleNotes:{art:'  '}}));const settings=JSON.parse(f.storage.getItem('gamecreator.workspace.v1:'+f.project.id+':engine-sync-'+f.project.config.engine));
 const next=await f.sync.preview({...f.input(),config:f.project.config,settings:{...settings,documents:false,docsDirectory:'project specs'}});await f.sync.apply({token:next.token,decisions:{},removals:[]});
 const empty=read('project specs/modules/project-management/standards.md');assert.match(empty,/尚未设置/);assert.doesNotMatch(empty,/统一色板|坐标原点|先复用/);assert.match(empty,/协作入口.*gamecreator\/README.md/);assert.equal(fs.existsSync(path.join(f.engine,'project specs/README.md')),false);for(const entry of ['gamecreator/README.md','gamecreator/project-changes.md'])assert.match(read(entry),/\.\.\/project%20specs\/modules\/project-management\/standards\.md/);
});

test('retired engine guide copies require reviewed removal and modified copies retain their content',async t=>{
 const f=await setup(t),p=await f.preview();await f.startup.run('initialize',{projectId:f.project.id,token:p.plan.token});
 const manifestPath=path.join(f.engine,'.gamecreator-sync/manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestPath));
 const hash=v=>require('node:crypto').createHash('sha256').update(v).digest('hex');
 for(const name of ['GAMECREATOR_GUIDE.md','project-standards.md']){const copy={...manifest.files.find(r=>r.kind==='collaboration'),id:'collaboration:'+name,path:'gamecreator/'+name,hash:hash('old managed copy')};manifest.files.push(copy);fs.writeFileSync(path.join(f.engine,copy.path),'old managed copy');}
 fs.writeFileSync(manifestPath,JSON.stringify(manifest));fs.writeFileSync(path.join(f.engine,'gamecreator/project-standards.md'),'manually edited legacy rules');
 const next=await f.preview();assert.equal(next.plan.rows.find(r=>r.path==='gamecreator/project-standards.md').status,'conflict');assert.equal(next.plan.rows.find(r=>r.path==='gamecreator/GAMECREATOR_GUIDE.md').remove,true);
 await f.startup.run('initialize',{projectId:f.project.id,token:next.plan.token,decisions:{'gamecreator/project-standards.md':'keep'},removals:[]});assert.equal(fs.readFileSync(path.join(f.engine,'gamecreator/project-standards.md'),'utf8'),'manually edited legacy rules');assert.ok(fs.existsSync(path.join(f.engine,'gamecreator/GAMECREATOR_GUIDE.md')));
 const again=await f.preview();await f.startup.run('initialize',{projectId:f.project.id,token:again.plan.token,decisions:{'gamecreator/project-standards.md':'keep'},removals:['gamecreator/GAMECREATOR_GUIDE.md']});assert.equal(fs.existsSync(path.join(f.engine,'gamecreator/GAMECREATOR_GUIDE.md')),false);
});
