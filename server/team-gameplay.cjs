const {createHash}=require('node:crypto');
const {emptyGameplaySnapshot,normalizeGameplayPublication,gameplayContent,sameGameplay,equalGameplayValue,applyGameplayPatch,gameplayReferenceErrors}=require('../src/team-gameplay-model.ts');

function createGameplayStore(db,{fail,activity}){
  db.exec(`CREATE TABLE IF NOT EXISTS gameplay_projects(project_id TEXT PRIMARY KEY REFERENCES projects(id),categories TEXT NOT NULL,category_revision INTEGER NOT NULL,refs TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS gameplay_documents(project_id TEXT NOT NULL REFERENCES projects(id),id TEXT NOT NULL,fields TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,updated_by TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(project_id,id));
    CREATE TABLE IF NOT EXISTS gameplay_history(project_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,snapshot TEXT NOT NULL,PRIMARY KEY(project_id,id,revision),FOREIGN KEY(project_id,id) REFERENCES gameplay_documents(project_id,id));
    CREATE TABLE IF NOT EXISTS gameplay_operations(project_id TEXT NOT NULL REFERENCES projects(id),user_id TEXT NOT NULL REFERENCES users(id),request_id TEXT NOT NULL,signature TEXT NOT NULL,PRIMARY KEY(project_id,user_id,request_id));`);
  const read=project=>{
    const meta=db.prepare('SELECT * FROM gameplay_projects WHERE project_id=?').get(project);if(!meta)return emptyGameplaySnapshot();
    const rows=db.prepare('SELECT d.*,u.username FROM gameplay_documents d JOIN users u ON u.id=d.updated_by WHERE project_id=? ORDER BY d.id').all(project);
    return{initialized:true,categoryRevision:meta.category_revision,store:{schema:3,categories:JSON.parse(meta.categories),designs:rows.map(r=>JSON.parse(r.fields))},references:JSON.parse(meta.refs),
      versions:Object.fromEntries(rows.map(r=>[r.id,r.revision])),stamps:Object.fromEntries(rows.map(r=>[r.id,{updatedAt:r.updated_at,updatedBy:r.username}]))};
  };
  const normalize=input=>{try{return normalizeGameplayPublication(input);}catch(e){fail(400,e.message);}};
  const write=(project,design,revision,user)=>{
    const updatedAt=new Date().toISOString(),fields={...design,createdAt:revision===1?updatedAt:design.createdAt,updatedAt};
    db.prepare(`INSERT INTO gameplay_documents VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,id) DO UPDATE SET fields=excluded.fields,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).run(project,design.id,JSON.stringify(fields),revision,updatedAt,user);
    const updatedBy=db.prepare('SELECT username FROM users WHERE id=?').get(user).username;
    db.prepare('INSERT INTO gameplay_history VALUES(?,?,?,?)').run(project,design.id,revision,JSON.stringify({design:fields,revision,updatedAt,updatedBy}));
  };
  const initialize=(project,input,user,source)=>{
    if(read(project).initialized)fail(409,'团队玩法设计已开始编辑，不能再用本地内容覆盖');
    const value=normalize(input);
    // Published stories have their own server IDs. Resolve by the durable source mapping,
    // never by title; an unavailable local story keeps its explicit source reference.
    value.store.designs=value.store.designs.map(d=>({...d,links:d.links.map(l=>{
      if(l.kind!=='story')return l;
      const mapped=db.prepare('SELECT story_id FROM story_imports WHERE project_id=? AND source_key=?').get(project,JSON.stringify([source.sourceInstanceId,source.sourceProjectId,l.targetId]));
      return mapped?{...l,targetId:mapped.story_id}:l;
    })}));
    value.references=value.references.map(r=>{
      if(r.kind!=='story')return r;
      const mapped=db.prepare('SELECT story_id FROM story_imports WHERE project_id=? AND source_key=?').get(project,JSON.stringify([source.sourceInstanceId,source.sourceProjectId,r.targetId]));
      return mapped?{...r,targetId:mapped.story_id}:r;
    });
    db.prepare('INSERT INTO gameplay_projects VALUES(?,?,1,?)').run(project,JSON.stringify(value.store.categories??[]),JSON.stringify(value.references));
    value.store.designs.forEach(d=>write(project,d,1,user));activity(project,user,'从本地项目初始化了玩法设计');return read(project);
  };
  const update=(project,input,user)=>{
    const current=read(project),changes=input.changes,categories=input.categories;
    if(typeof input.requestId!=='string'||!input.requestId.trim()||input.requestId.length>200||!Array.isArray(changes)||changes.length>500||
      changes.some(c=>!c||typeof c.id!=='string'||c.id.length>200||!Number.isSafeInteger(c.revision)||c.revision<0||!c.design||c.design.id!==c.id)||new Set(changes.map(c=>c.id)).size!==changes.length||
      (categories!==undefined&&(!categories||!Number.isSafeInteger(categories.revision)||categories.revision<0||!Array.isArray(categories.items))))fail(400,'玩法设计提交格式无效');
    let signature,candidate;
    try{
      signature=createHash('sha256').update(JSON.stringify({changes:changes.map(c=>({...c,design:gameplayContent(c.design)})),categories})).digest('hex');
      candidate=normalize({store:applyGameplayPatch(current.store,{changes,categories}),references:current.references}).store;
    }catch(e){if(e.status)throw e;fail(400,e.message);}
    const previous=db.prepare('SELECT signature FROM gameplay_operations WHERE project_id=? AND user_id=? AND request_id=?').get(project,user,input.requestId);
    if(previous){if(previous.signature!==signature)fail(409,'提交请求的内容已变化，请重新提交');return current;}
    if(changes.some(c=>c.revision!==(current.versions[c.id]??0))||(categories&&categories.revision!==current.categoryRevision))fail(409,'玩法设计已有团队新版本，请处理冲突后再保存',{currentRecord:current});
    const stories=db.prepare('SELECT id FROM stories WHERE project_id=?').all(project).map(s=>s.id);
    const oldErrors=gameplayReferenceErrors(current.store,stories,current.references),newErrors=gameplayReferenceErrors(candidate,stories,current.references);
    for(const [key,message]of newErrors)if(!oldErrors.has(key))fail(409,message+'。请读取团队最新内容并处理关联。',{currentRecord:current});
    const effective=changes.filter(c=>!sameGameplay(current.store.designs.find(d=>d.id===c.id),c.design)),categoryChanged=!!categories&&!equalGameplayValue(categories.items,current.store.categories??[]);
    if(effective.length||categoryChanged){
      if(!current.initialized)db.prepare("INSERT INTO gameplay_projects VALUES(?,'[]',0,'[]')").run(project);
      if(categoryChanged)db.prepare('UPDATE gameplay_projects SET categories=?,category_revision=category_revision+1 WHERE project_id=?').run(JSON.stringify(categories.items),project);
      for(const c of effective){
        const old=current.store.designs.find(d=>d.id===c.id),design=structuredClone(candidate.designs.find(d=>d.id===c.id));
        if(old){
          design.createdAt=old.createdAt;
          if(design.space.spatial){const original=old.space.spatial;design.space.spatial.view=original?.view??'grid';design.space.spatial.rooms=design.space.spatial.rooms.map(r=>{const before=original?.rooms.find(o=>o.id===r.id);return before?{...r,x:before.x,y:before.y,view:before.view}:r;});}
        }
        write(project,design,c.revision+1,user);
      }
      activity(project,user,`更新了玩法设计：${effective.length} 份文档${categoryChanged?'及分类':''}`);
    }
    db.prepare('INSERT INTO gameplay_operations VALUES(?,?,?,?)').run(project,user,input.requestId,signature);return read(project);
  };
  const history=(project,id)=>db.prepare('SELECT snapshot FROM gameplay_history WHERE project_id=? AND id=? ORDER BY revision DESC LIMIT 30').all(project,id).map(r=>JSON.parse(r.snapshot));
  const validateCoreReferences=(project,before,after)=>{
    const old=new Set(before.graphs.flatMap(g=>g.nodes.flatMap(n=>n.gameplayIds.map(id=>JSON.stringify([g.id,n.id,id])))));
    for(const g of after.graphs)for(const n of g.nodes)for(const id of n.gameplayIds)if(!old.has(JSON.stringify([g.id,n.id,id]))&&!db.prepare('SELECT 1 FROM gameplay_documents WHERE project_id=? AND id=?').get(project,id))fail(409,'关联的团队玩法不存在，请刷新后重新选择');
  };
  return{read,initialize,update,history,validateCoreReferences};
}
module.exports={createGameplayStore};
