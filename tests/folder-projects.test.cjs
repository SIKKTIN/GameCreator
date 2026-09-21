const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {createWorkspaceStorage} = require('../desktop/test-workspaces.cjs');
const {createFolderProjects} = require('../desktop/folder-projects.cjs');
const {createArtFiles} = require('../desktop/art-files.cjs');
const CATALOG='gamecreator.projects.v1';
const config={engine:'godot-gdscript',projectPath:'E:/engine',enumPath:'.',dataPath:'data',outputFormat:'json',autoSync:false,backupBeforeSync:true};
const item=(name='A')=>({id:'project-'+randomUUID(),name,config:{...config},initialContent:'empty'});
const key=(p,section='project')=>'gamecreator.workspace.v1:'+p.id+':'+section;
function setup(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gc-folder-model-'));
  const dataDirectory=path.join(root,'app'),legacyStorage=createWorkspaceStorage(dataDirectory);
  const service=createFolderProjects({dataDirectory,legacyStorage});
  t.after(()=>{service.close();assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  const publish=(p)=>service.storage.setItem(CATALOG,JSON.stringify({schema:2,mode:'project',activeId:p.id,projects:[p]}));
  return {root,dataDirectory,legacyStorage,service,publish};
}
test('migration retains identity, engine binding, all archives and all material versions; edits save in place',async t=>{
  const f=setup(t),p=item();f.publish(p);
  f.legacyStorage.setItem(key(p),JSON.stringify({name:'A'}));
  f.legacyStorage.setItem(key(p,'future-module'),JSON.stringify({unknown:'preserved'}));
  const source=path.join(f.root,'material.txt');fs.writeFileSync(source,'asset bytes');
  const files=await createArtFiles(f.dataDirectory).importFiles('project:'+p.id,[source]);
  f.legacyStorage.setItem(key(p,'art-assets'),JSON.stringify({assets:[{versions:[{files}]}]}));
  const expected=[{key:key(p),value:f.legacyStorage.getItem(key(p))}];
  const saved=f.service.create(path.join(f.root,'My project'),p,[],p.id,expected);f.publish(saved);
  assert.equal(saved.id,p.id);assert.deepEqual(saved.config,config);
  f.service.storage.setItem(key(p),JSON.stringify({name:'Edited'}));
  assert.equal(JSON.parse(f.legacyStorage.getItem(key(p))).name,'A');
  assert.equal(JSON.parse(f.service.storage.getItem(key(p))).name,'Edited');
  assert.equal(JSON.parse(f.service.storage.getItem(key(p,'future-module'))).unknown,'preserved');
  const art=createArtFiles(f.dataDirectory,{resolveWorkspaceDirectory:f.service.assetDirectory});
  const bytes=await art.readBytes('project:'+p.id,files[0].storagePath);assert.ok(bytes);
  assert.equal(fs.readFileSync(path.join(saved.folderPath,'assets',files[0].storagePath),'utf8'),'asset bytes');
  const more=await art.importFiles('project:'+p.id,[source]);assert.ok(fs.existsSync(path.join(saved.folderPath,'assets',more[0].storagePath)));
  const renamed={...saved,name:'Renamed',config:{...config,projectPath:'D:/engine2'}};f.publish(renamed);
  assert.deepEqual(f.service.open(saved.folderPath).config,renamed.config);
});
test('save as is independent and a moved folder reopens without original application cache',t=>{
  const f=setup(t),p=item(),saved=f.service.create(path.join(f.root,'original'),p,[{key:key(p),value:'{"name":"A"}'}]);f.publish(saved);
  const copy=item('Copy'),savedCopy=f.service.create(path.join(f.root,'copy'),copy,[],p.id);f.publish(savedCopy);
  f.service.storage.setItem(key(copy),'"copy-only"');
  f.service.close();
  const moved=path.join(f.root,'moved');fs.renameSync(saved.folderPath,moved);
  const otherData=path.join(f.root,'new-computer');const other=createFolderProjects({dataDirectory:otherData,legacyStorage:createWorkspaceStorage(otherData)});
  t.after(()=>other.close());
  const reopened=other.open(moved);assert.equal(reopened.id,p.id);
  other.storage.setItem(CATALOG,JSON.stringify({schema:2,mode:'project',activeId:p.id,projects:[reopened]}));
  assert.equal(other.storage.getItem(key(p)),'{"name":"A"}');
  assert.equal(f.service.storage.getItem(key(copy)),'"copy-only"');other.close();
});
test('offline folder never falls back to or overwrites the app archive; nonempty targets are refused',t=>{
  const f=setup(t),p=item();f.publish(p);f.legacyStorage.setItem(key(p),'"backup"');
  const saved=f.service.create(path.join(f.root,'project'),p,[],p.id);f.publish(saved);f.service.close();
  fs.renameSync(saved.folderPath,saved.folderPath+'-offline');
  assert.throws(()=>f.service.storage.getItem(key(p)));assert.throws(()=>f.service.storage.setItem(key(p),'"lost"'));
  assert.equal(f.legacyStorage.getItem(key(p)),'"backup"');assert.equal(fs.existsSync(saved.folderPath),false);
  assert.throws(()=>f.service.create(saved.folderPath+'-offline',item()),/已存在/);
});
test('active writer is excluded and removing from recents leaves project files intact',t=>{
  const f=setup(t),p=item(),saved=f.service.create(path.join(f.root,'project'),p);f.publish(saved);
  const other=createFolderProjects({dataDirectory:path.join(f.root,'other'),legacyStorage:createWorkspaceStorage(path.join(f.root,'other'))});t.after(()=>other.close());
  assert.throws(()=>other.open(saved.folderPath),/另一个客户端/);
  f.service.storage.setItem(CATALOG,JSON.stringify({schema:2,mode:'project',activeId:'',projects:[]}));
  assert.ok(fs.existsSync(path.join(saved.folderPath,'project.gamecreator')));
  assert.equal(other.open(saved.folderPath).id,p.id);other.close();
});
test('changed snapshots and missing material versions abort publication without exposing partial projects',t=>{
  const f=setup(t),p=item();f.publish(p);f.legacyStorage.setItem(key(p),'1');
  assert.throws(()=>f.service.create(path.join(f.root,'wrong'),p,[],p.id,[{key:key(p),value:'0'}]),/已变化/);
  const file={storagePath:randomUUID()+'.png',size:10};
  assert.throws(()=>f.service.create(path.join(f.root,'missing'),p,[{key:key(p,'art-assets'),value:JSON.stringify({assets:[{versions:[{files:[file]}]}]})}]));
  assert.equal(fs.existsSync(path.join(f.root,'missing')),false);
  assert.equal(fs.readdirSync(f.root).some(name=>name.endsWith('.tmp')),false);
});
test('old portable packages upgrade in place, retaining their original manifest and assets',t=>{
  const f=setup(t),directory=path.join(f.root,'old-package');fs.mkdirSync(directory);fs.mkdirSync(path.join(directory,'assets'));
  fs.writeFileSync(path.join(directory,'manifest.json'),'legacy-backup');
  const saved=f.service.upgradeLegacy(directory,{project:{name:'Old',config,defaultTablesVersion:1},archives:{project:{name:'Old'},'art-assets':{assets:[]}}});f.publish(saved);
  assert.equal(saved.folderPath,directory);assert.equal(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'),'legacy-backup');
  assert.equal(JSON.parse(f.service.storage.getItem(key(saved))).name,'Old');
  assert.equal(JSON.parse(f.service.storage.getItem(key(saved,'default-table-migration'))).state,'done');
});
