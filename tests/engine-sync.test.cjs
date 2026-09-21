const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createEngineSync}=require('../desktop/engine-sync.cjs'),{createArtFiles}=require('../desktop/art-files.cjs');
const {createHash}=require('node:crypto');
const digest=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t,options={}) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-engine-sync-'));assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const engine=path.join(dir,'engine'),data=path.join(dir,'data');await fs.mkdir(engine);await fs.writeFile(path.join(engine,'project.godot'),'config_version=5');
  const artFiles=createArtFiles(data),api=createEngineSync({artFiles,...options});
  const input={projectId:'sync-test',config:{engine:'godot-gdscript',projectPath:engine},settings:{documents:true,assets:true,includePlaceholders:true,docsDirectory:'docs/gamecreator',assetsDirectory:'assets/gamecreator',modules:['gameplay','stories']},document:{projectName:'测试原型',version:'v1',generatedAt:'changing',sections:[{id:'gameplay',label:'玩法设计',body:'## 玩法\n\n选择 → 挑战 → 奖励'},{id:'stories',label:'故事文档',body:'## 故事\n\n文档内容'}]},art:{assets:[]}};
  async function asset(name,bytes,placeholder=false){const original=path.join(dir,name);await fs.writeFile(original,bytes);const files=await artFiles.importFiles('project:sync-test',[original]);return {id:'plant',name:'植物贴图',adoptedVersionId:'v1',versions:[{id:'v1',name:'第一版',placeholder,review:'已通过',files}],archived:false};}
  const preview=()=>api.preview(input),apply=p=>api.apply({token:p.token});
  return {dir,engine,data,api,input,asset,preview,apply,read:rel=>fs.readFile(path.join(engine,rel),'utf8')};
}
test('real adopted files and selected deterministic Markdown are delivered; repeat and restart are no-ops',async t=>{
  const f=await fixture(t);f.input.art.assets.push(await f.asset('植物.png','PNG original bytes'));
  const p=await f.preview();assert.equal(p.rows.length,4);assert.ok(p.rows.every(r=>r.status==='added'));assert.equal(await fs.stat(path.join(f.engine,'.gamecreator-sync')).catch(()=>null),null);
  const result=await f.apply(p);assert.equal(result.files.length,4);assert.equal(await f.read(p.rows.find(r=>r.kind==='asset').path),'PNG original bytes');assert.match(await f.read('docs/gamecreator/modules/gameplay.md'),/选择/);assert.match(await f.read('docs/gamecreator/README.md'),/modules\/stories.md/);
  f.input.document.generatedAt='new time';assert.ok((await f.preview()).rows.every(r=>r.status==='unchanged'));
  const restarted=createEngineSync({artFiles:createArtFiles(f.data)});assert.equal((await restarted.history(f.input)).entries.length,1);assert.ok((await restarted.preview(f.input)).rows.every(r=>r.status==='unchanged'));
  await assert.rejects(f.apply(p),/过期/);
});
test('adopted version update keeps stable single-file path even if original filename changes and saves original backup',async t=>{
  const f=await fixture(t),a=await f.asset('plant-v1.png','before');f.input.art.assets=[a];const p=await f.preview();await f.apply(p);const target=p.rows.find(r=>r.kind==='asset').path;
  const b=await f.asset('plant-v2.png','after');a.versions.push({...b.versions[0],id:'v2',name:'第二版'});a.adoptedVersionId='v2';const next=await f.preview(),row=next.rows.find(r=>r.kind==='asset');assert.equal(row.path,target);assert.equal(row.status,'updated');const result=await f.apply(next);assert.equal(await f.read(target),'after');assert.equal(await fs.readFile(path.join(result.backupDirectory,'files/0'),'utf8'),'before');assert.equal(result.files[0].versionId,'v2');
});
test('different adopted version with identical bytes still records the version; non-adopted versions never copy',async t=>{
  const f=await fixture(t),a=await f.asset('same.png','same');f.input.art.assets=[a];await f.apply(await f.preview());a.versions.push({...a.versions[0],id:'v2',name:'第二版'});a.adoptedVersionId='v2';const p=await f.preview();assert.equal(p.rows.filter(r=>r.status==='updated').length,1);await f.apply(p);assert.ok((await f.preview()).rows.every(r=>r.status==='unchanged'));
});
test('scope exclusions preserve previous delivery; module removal is opt-in and only touches managed files',async t=>{
  const f=await fixture(t);await f.apply(await f.preview());await fs.writeFile(path.join(f.engine,'docs/gamecreator/manual.md'),'manual');f.input.settings.modules=['gameplay'];let p=await f.preview();assert.equal(p.rows.find(r=>r.path.endsWith('stories.md')).status,'removed');await f.apply(p);assert.match(await f.read('docs/gamecreator/modules/stories.md'),/文档内容/);
  p=await f.preview();const removal=p.rows.find(r=>r.status==='removed');await f.api.apply({token:p.token,removals:[removal.path]});assert.equal(await fs.stat(path.join(f.engine,removal.path)).catch(()=>null),null);assert.equal(await f.read('docs/gamecreator/manual.md'),'manual');
  f.input.settings.documents=false;p=await f.preview();assert.equal(p.rows.length,0);assert.match(await f.read('docs/gamecreator/README.md'),/测试原型/);
});
test('conflicts require a decision; keep does not adopt manual edits, replace backs up the external content',async t=>{
  const f=await fixture(t);await f.apply(await f.preview());const target='docs/gamecreator/modules/gameplay.md';await fs.writeFile(path.join(f.engine,target),'external edit');f.input.document.sections[1].body='changed story';let p=await f.preview();assert.equal(p.rows.find(r=>r.path===target).status,'conflict');await assert.rejects(f.apply(p),/处理所有冲突/);
  await f.api.apply({token:p.token,decisions:{[target]:'keep'}});assert.equal(await f.read(target),'external edit');p=await f.preview();assert.equal(p.rows.find(r=>r.path===target).status,'conflict');const result=await f.api.apply({token:p.token,decisions:{[target]:'replace'}});assert.match(await f.read(target),/选择/);assert.equal(await fs.readFile(path.join(result.backupDirectory,'files/0'),'utf8'),'external edit');
});
test('an existing unmanaged file is a conflict even when its contents match',async t=>{
  const f=await fixture(t);await fs.mkdir(path.join(f.engine,'docs/gamecreator'),{recursive:true});await fs.writeFile(path.join(f.engine,'docs/gamecreator/README.md'),'user doc');const p=await f.preview();assert.equal(p.rows.find(r=>r.path.endsWith('README.md')).status,'conflict');await assert.rejects(f.apply(p));assert.equal(await f.read('docs/gamecreator/README.md'),'user doc');
});
test('post-preview edits, other synchronization commits and replaced project roots invalidate the snapshot',async t=>{
  const f=await fixture(t);await f.apply(await f.preview());f.input.document.sections[0].body='new';let p=await f.preview();await fs.writeFile(path.join(f.engine,'docs/gamecreator/modules/gameplay.md'),'intervening edit');await assert.rejects(f.apply(p),/预览后/);assert.equal(await f.read('docs/gamecreator/modules/gameplay.md'),'intervening edit');
  p=await f.preview();const newer=await f.preview();await f.api.apply({token:newer.token,decisions:{'docs/gamecreator/modules/gameplay.md':'replace'}});await assert.rejects(f.api.apply({token:p.token,decisions:{'docs/gamecreator/modules/gameplay.md':'replace'}}),/记录已改变/);
  const q=await f.preview();f.input.document.sections[0].body='yet another';const q2=await f.preview();await fs.rename(f.engine,f.engine+'-old');await fs.mkdir(f.engine);await assert.rejects(f.apply(q2),/目录已被替换/);f.api.release(q.token);
});
test('failed multi-file write rolls back both updates and additions and retains a failed record',async t=>{
  let fail=false;const f=await fixture(t,{beforeWrite:async index=>{if(fail&&index===1)throw new Error('simulated disk failure');}});await f.apply(await f.preview());const before=await f.read('docs/gamecreator/modules/gameplay.md');f.input.document.sections[0].body='changed';f.input.document.sections[1].body='changed too';fail=true;
  await assert.rejects(f.apply(await f.preview()),/已恢复写入前/);assert.equal(await f.read('docs/gamecreator/modules/gameplay.md'),before);assert.equal((await f.api.history(f.input)).entries[0].status,'failed');assert.equal((await f.api.history(f.input)).interrupted,false);
});
test('paths reject traversal, collisions, reserved names and document/asset overlap before writing',async t=>{
  const f=await fixture(t);for(const docsDirectory of ['../outside','/absolute','C:/root','.git/output','x/../y','CON','assets/gamecreator/inside','docs//child']){f.input.settings.docsDirectory=docsDirectory;await assert.rejects(f.preview());}assert.equal(await fs.stat(path.join(f.engine,'.gamecreator-sync')).catch(()=>null),null);
});
test('linked output directories and hardlinked files are rejected without touching external content',async t=>{
  const f=await fixture(t),outside=path.join(f.dir,'outside');await fs.mkdir(outside);await fs.symlink(outside,path.join(f.engine,'docs'),process.platform==='win32'?'junction':'dir');await assert.rejects(f.preview(),/链接/);assert.deepEqual(await fs.readdir(outside),[]);await fs.unlink(path.join(f.engine,'docs'));
  await fs.mkdir(path.join(f.engine,'docs/gamecreator'),{recursive:true});const external=path.join(outside,'original');await fs.writeFile(external,'unchanged');await fs.link(external,path.join(f.engine,'docs/gamecreator/README.md'));await assert.rejects(f.preview(),/链接/);assert.equal(await fs.readFile(external,'utf8'),'unchanged');
});
test('missing files and unapproved adopted releases fail; placeholders can be excluded',async t=>{
  const f=await fixture(t),a=await f.asset('placeholder.png','bytes',true);f.input.art.assets=[a];f.input.settings.includePlaceholders=false;let p=await f.preview();assert.equal(p.rows.filter(r=>r.kind==='asset').length,0);assert.equal(p.warnings.length,1);
  f.input.settings.includePlaceholders=true;a.versions[0].placeholder=false;a.versions[0].review='待审核';await assert.rejects(f.preview(),/审核/);a.versions[0].review='已通过';a.versions[0].files[0].storagePath='00000000-0000-4000-8000-000000000000.png';await assert.rejects(f.preview(),/丢失/);
});
test('one engineering project cannot silently be claimed by another project or engine adapter',async t=>{
  const f=await fixture(t);await f.apply(await f.preview());await assert.rejects(f.api.preview({...f.input,projectId:'other'}),/另一个项目/);await assert.rejects(f.api.preview({...f.input,config:{...f.input.config,engine:'oasis-lua'}}),/另一个项目/);
});
test('binding inspection is read-only, distinguishes owners and engines, and cancellation changes nothing',async t=>{
 const f=await fixture(t);
 assert.equal((await f.api.binding(f.input)).status,'unbound');assert.equal(await fs.stat(path.join(f.engine,'.gamecreator-sync')).catch(()=>null),null);
 await f.apply(await f.preview());const raw=await f.read('.gamecreator-sync/manifest.json');
 assert.equal((await f.api.binding(f.input)).status,'current');
 const other={...f.input,projectId:'new-project'},review=await f.api.binding(other);
 assert.equal(review.status,'project-mismatch');assert.equal(review.ownerProjectId,f.input.projectId);assert.equal(review.projectId,other.projectId);assert.equal(review.fileCount,3);assert.equal(review.historyCount,1);assert.ok(review.token);
 f.api.release(review.token);await assert.rejects(f.api.rebind({token:review.token}),/过期/);assert.equal(await f.read('.gamecreator-sync/manifest.json'),raw);
 const engine=await f.api.binding({...other,config:{...other.config,engine:'oasis-lua'}});assert.equal(engine.status,'engine-mismatch');assert.equal(engine.token,undefined);assert.match(engine.reason,/引擎/);
});

test('explicit rebind preserves exact old manifest, file records, manual changes and history; new owner can preview after restart',async t=>{
 const f=await fixture(t);await f.apply(await f.preview());const oldRaw=await f.read('.gamecreator-sync/manifest.json'),old=JSON.parse(oldRaw);
 const target='docs/gamecreator/modules/gameplay.md';await fs.writeFile(path.join(f.engine,target),'manual changes');
 f.input.document.sections[1].body='new story';const oldPlan=await f.preview(),other={...f.input,projectId:'migrated-project'};
 const review=await f.api.binding(other),result=await f.api.rebind({token:review.token});
 const next=JSON.parse(await f.read('.gamecreator-sync/manifest.json'));
 assert.equal(next.projectId,other.projectId);assert.equal(next.engine,old.engine);assert.deepEqual(next.files,old.files);assert.deepEqual(next.history.slice(1),old.history);
 assert.equal(result.kind,'rebind');assert.equal(result.fromProjectId,old.projectId);assert.equal(result.toProjectId,other.projectId);assert.equal(result.files.length,0);
 assert.equal(await fs.readFile(path.join(result.backupDirectory,'before-manifest.json'),'utf8'),oldRaw);assert.equal(await f.read(target),'manual changes');
 await assert.rejects(f.api.apply({token:oldPlan.token,decisions:{[target]:'replace'}}),/过期/);await assert.rejects(f.preview(),/另一个项目/);await assert.rejects(f.api.rebind({token:review.token}),/过期/);
 const reopened=createEngineSync({artFiles:createArtFiles(f.data)});assert.equal((await reopened.binding(other)).status,'current');assert.equal((await reopened.history(other)).entries.length,2);
 const plan=await reopened.preview(other);assert.equal(plan.rows.find(r=>r.path===target).status,'conflict');assert.equal(plan.rows.find(r=>r.path.endsWith('stories.md')).status,'updated');assert.equal(plan.rows.some(r=>r.status==='added'),false);
 assert.equal(await f.read(target),'manual changes');
});

test('rebind rejects changed manifests, pending journals, locks and replaced roots without taking ownership',async t=>{
 const f=await fixture(t);await f.apply(await f.preview());const other={...f.input,projectId:'new-project'},raw=await f.read('.gamecreator-sync/manifest.json');
 let review=await f.api.binding(other);await fs.writeFile(path.join(f.engine,'.gamecreator-sync/manifest.json'),raw+'\n');await assert.rejects(f.api.rebind({token:review.token}),/记录已改变/);assert.equal(await f.read('.gamecreator-sync/manifest.json'),raw+'\n');
 review=await f.api.binding(other);await fs.writeFile(path.join(f.engine,'.gamecreator-sync/pending.json'),'{}');assert.equal((await f.api.binding(other)).token,undefined);await assert.rejects(f.api.rebind({token:review.token}),/未完成/);await fs.unlink(path.join(f.engine,'.gamecreator-sync/pending.json'));
 review=await f.api.binding(other);await fs.writeFile(path.join(f.engine,'.gamecreator-sync/lock'),JSON.stringify({pid:process.pid}));assert.equal((await f.api.binding(other)).token,undefined);await assert.rejects(f.api.rebind({token:review.token}),/工程正在同步/);await fs.unlink(path.join(f.engine,'.gamecreator-sync/lock'));
 assert.equal(JSON.parse(await f.read('.gamecreator-sync/manifest.json')).projectId,f.input.projectId);
 review=await f.api.binding(other);await fs.rename(f.engine,f.engine+'-old');await fs.mkdir(f.engine);await assert.rejects(f.api.rebind({token:review.token}),/目录已被替换/);
});

test('failed rebind can retry while a concurrent manifest change is preserved',async t=>{
 let fail=true,change=false;let f;
 f=await fixture(t,{beforeRebind:async()=>{if(fail)throw Error('rebind disk failure');if(change)await fs.writeFile(path.join(f.engine,'.gamecreator-sync/manifest.json'),oldRaw+'\n');}});
 await f.apply(await f.preview());const oldRaw=await f.read('.gamecreator-sync/manifest.json'),other={...f.input,projectId:'new-project'},review=await f.api.binding(other);
 await assert.rejects(f.api.rebind({token:review.token}),/disk failure/);assert.equal(await f.read('.gamecreator-sync/manifest.json'),oldRaw);assert.equal(await fs.stat(path.join(f.engine,'.gamecreator-sync/lock')).catch(()=>null),null);
 fail=false;change=true;await assert.rejects(f.api.rebind({token:review.token}),/记录已改变/);assert.equal(await f.read('.gamecreator-sync/manifest.json'),oldRaw+'\n');
 change=false;const refreshed=await f.api.binding(other);await f.api.rebind({token:refreshed.token});assert.equal(JSON.parse(await f.read('.gamecreator-sync/manifest.json')).projectId,other.projectId);
});

test('corrupt manifests are never offered for rebind',async t=>{
 const f=await fixture(t);await f.apply(await f.preview());const raw=await f.read('.gamecreator-sync/manifest.json');
 for(const mutate of [m=>m.schema=99,m=>m.files[0].path='../outside.md',m=>m.files[0].hash='invalid',m=>m.history[0].status='broken',m=>m.projectId='']) {
   const m=JSON.parse(raw);mutate(m);const changed=JSON.stringify(m);await fs.writeFile(path.join(f.engine,'.gamecreator-sync/manifest.json'),changed);
   await assert.rejects(f.api.binding({...f.input,projectId:'new-project'}));assert.equal(await f.read('.gamecreator-sync/manifest.json'),changed);
 }
});

test('expired rebind reviews cannot write',async t=>{
 const f=await fixture(t);await f.apply(await f.preview());const review=await f.api.binding({...f.input,projectId:'new-project'}),raw=await f.read('.gamecreator-sync/manifest.json'),now=Date.now;
 try {Date.now=()=>now()+600001;await assert.rejects(f.api.rebind({token:review.token}),/过期/);}finally{Date.now=now;}
 assert.equal(await f.read('.gamecreator-sync/manifest.json'),raw);
});

test('Oasis receives docs and assets without Godot ignore files',async t=>{
  const f=await fixture(t);f.input.config.engine='oasis-lua';const p=await f.preview();assert.equal(p.rows.length,3);await f.apply(p);assert.match(await f.read('docs/gamecreator/modules/stories.md'),/故事/);
});
test('interrupted writes recover from validated journal and backups; preserve subsequent external edits',async t=>{
  const f=await fixture(t);await f.apply(await f.preview());const target='docs/gamecreator/modules/gameplay.md',before=await fs.readFile(path.join(f.engine,target));const id='11111111-1111-4111-8111-111111111111',folder=path.join(f.engine,'.gamecreator-sync/history',id);await fs.mkdir(path.join(folder,'files'),{recursive:true});await fs.writeFile(path.join(folder,'files/0'),before);await fs.writeFile(path.join(f.engine,target),'partial new bytes');
  const journal={schema:1,id,ops:[{index:0,path:target,before:digest(before),after:digest('partial new bytes')}]};await fs.writeFile(path.join(f.engine,'.gamecreator-sync/pending.json'),JSON.stringify(journal));await assert.rejects(f.preview(),/未完成/);assert.match((await f.api.recover(f.input)).message,/完成/);assert.equal(await f.read(target),before.toString());
  await fs.writeFile(path.join(f.engine,'.gamecreator-sync/pending.json'),JSON.stringify(journal));await fs.writeFile(path.join(f.engine,target),'external after crash');await assert.rejects(f.api.recover(f.input),/外部改动/);assert.equal(await f.read(target),'external after crash');
});
test('directory relocation preserves unconfirmed old files and tracks both until explicit removal',async t=>{
  const f=await fixture(t);f.input.art.assets=[await f.asset('plant.png','p')];await f.apply(await f.preview());f.input.settings.docsDirectory='design-docs';f.input.settings.assetsDirectory='delivered';const p=await f.preview();assert.ok(p.rows.some(r=>r.remove));await f.apply(p);const q=await f.preview();assert.ok(q.rows.some(r=>r.remove));assert.equal(q.rows.filter(r=>r.status==='added').length,0);await f.api.apply({token:q.token,removals:q.rows.filter(r=>r.remove).map(r=>r.path)});assert.ok((await f.preview()).rows.every(r=>r.status==='unchanged'));
});

test('recovery removes an exclusively staged new file when interrupted between link and unlink',async t=>{
 const f=await fixture(t);await f.apply(await f.preview());
 const id='22222222-2222-4222-8222-222222222222',folder=path.join(f.engine,'.gamecreator-sync/history',id);await fs.mkdir(path.join(folder,'next'),{recursive:true});
 const target='docs/gamecreator/new.md',staged=path.join(folder,'next/0');await fs.writeFile(staged,'new bytes');await fs.link(staged,path.join(f.engine,target));
 await fs.writeFile(path.join(f.engine,'.gamecreator-sync/pending.json'),JSON.stringify({schema:1,id,ops:[{index:0,path:target,before:null,after:digest('new bytes')}]}));
 await f.api.recover(f.input);assert.equal(await fs.stat(path.join(f.engine,target)).catch(()=>null),null);assert.equal((await f.api.history(f.input)).interrupted,false);
});
test('source files remain isolated by workspace and snapshots are immutable after preview',async t=>{
 const f=await fixture(t),a=await f.asset('plant.png','first bytes');f.input.art.assets=[a];const p=await f.preview();f.input.document.sections[0].body='mutated after preview';a.name='renamed after preview';await f.apply(p);
 assert.match(await f.read('docs/gamecreator/modules/gameplay.md'),/选择/);await assert.rejects(f.api.preview({...f.input,projectId:'unrelated',config:{...f.input.config,projectPath:await fs.mkdtemp(path.join(f.dir,'other-')),engine:'oasis-lua'}}),/丢失/);
});

test('Godot documents stay visible and legacy ignore removal is reviewed, backed up, and never recreated',async t=>{
 const f=await fixture(t);await f.apply(await f.preview());const ignore='docs/gamecreator/.gdignore';assert.equal(await fs.stat(path.join(f.engine,ignore)).catch(()=>null),null);
 const bytes='# Development documentation; not a runtime resource.\n';await fs.writeFile(path.join(f.engine,ignore),bytes);const mpath=path.join(f.engine,'.gamecreator-sync/manifest.json'),m=JSON.parse(await fs.readFile(mpath,'utf8'));m.files.push({id:'document:ignore',path:ignore,kind:'document',label:'old',version:'',hash:digest(bytes)});await fs.writeFile(mpath,JSON.stringify(m));
 const p=await f.preview();assert.ok(p.warnings.some(w=>w.includes(ignore)));assert.equal(p.rows.find(r=>r.path===ignore).status,'removed');await assert.rejects(f.apply(p),/没有需要/);const result=await f.api.apply({token:p.token,removals:[ignore]});assert.equal(await fs.stat(path.join(f.engine,ignore)).catch(()=>null),null);assert.equal(await fs.readFile(path.join(result.backupDirectory,'files/0'),'utf8'),bytes);assert.ok((await f.preview()).rows.every(r=>r.status==='unchanged'));
 await fs.writeFile(path.join(f.engine,'docs/.gdignore'),'user ignore');const next=await f.preview();assert.ok(next.warnings.some(w=>w.includes('docs/.gdignore')));assert.equal(next.rows.some(r=>r.path==='docs/.gdignore'),false);assert.equal(await f.read('docs/.gdignore'),'user ignore');
});
