const {createHash,randomUUID}=require('node:crypto');
const {emptyScheduleSnapshot,normalizeSchedulePublication,scheduleRecords,sameScheduleRecord,applyScheduleChanges,scheduleStructureErrors,legacyScheduleMilestone,overviewScheduleMilestone}=require('../src/team-schedule-model.ts');
const {milestoneAcceptance,invalidateMilestoneAcceptance}=require('../src/schedule-acceptance.ts');

function createScheduleStore(db,{fail,overview,gameplay}) {
  db.exec(`CREATE TABLE IF NOT EXISTS schedule_projects(project_id TEXT PRIMARY KEY REFERENCES projects(id),refs TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS schedule_records(project_id TEXT NOT NULL REFERENCES projects(id),id TEXT NOT NULL,kind TEXT NOT NULL,fields TEXT,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,updated_by TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(project_id,id));
    CREATE TABLE IF NOT EXISTS schedule_history(project_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,snapshot TEXT NOT NULL,PRIMARY KEY(project_id,id,revision),FOREIGN KEY(project_id,id) REFERENCES schedule_records(project_id,id));
    CREATE TABLE IF NOT EXISTS schedule_operations(project_id TEXT NOT NULL REFERENCES projects(id),user_id TEXT NOT NULL REFERENCES users(id),request_id TEXT NOT NULL,signature TEXT NOT NULL,PRIMARY KEY(project_id,user_id,request_id));`);
  const read=project=>{
    const meta=db.prepare('SELECT * FROM schedule_projects WHERE project_id=?').get(project);
    if(!meta) {
      const old=overview.read(project).milestones;
      return {...emptyScheduleSnapshot(),store:{schema:1,tasks:[],milestones:old.map(r=>legacyScheduleMilestone(r.id,r.fields))},versions:Object.fromEntries(old.map(r=>[r.id,r.revision])),stamps:Object.fromEntries(old.map(r=>[r.id,{updatedAt:r.updatedAt,updatedBy:r.updatedBy}]))};
    }
    const rows=db.prepare('SELECT r.*,u.username FROM schedule_records r JOIN users u ON u.id=r.updated_by WHERE project_id=? ORDER BY r.id').all(project);
    return {initialized:true,store:{schema:1,tasks:rows.filter(r=>r.kind==='task'&&r.fields!==null).map(r=>JSON.parse(r.fields)),milestones:rows.filter(r=>r.kind==='milestone'&&r.fields!==null).map(r=>JSON.parse(r.fields))},references:JSON.parse(meta.refs),versions:Object.fromEntries(rows.map(r=>[r.id,r.revision])),stamps:Object.fromEntries(rows.map(r=>[r.id,{updatedAt:r.updated_at,updatedBy:r.username}]))};
  };
  const normalize=input=>{try{return normalizeSchedulePublication(input);}catch(e){fail(400,e.message);}};
  const write=(project,kind,id,fields,revision,user,stamp)=>{
    const updatedAt=stamp?.updatedAt??new Date().toISOString(),updatedBy=stamp?.updatedBy??db.prepare('SELECT username FROM users WHERE id=?').get(user).username;
    db.prepare(`INSERT INTO schedule_records VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id,id) DO UPDATE SET fields=excluded.fields,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).run(project,id,kind,fields?JSON.stringify(fields):null,revision,updatedAt,user);
    db.prepare('INSERT INTO schedule_history VALUES(?,?,?,?)').run(project,id,revision,JSON.stringify({kind,id,fields,revision,updatedAt,updatedBy}));
    if(kind==='milestone') {
      if(fields) db.prepare(`INSERT INTO project_milestones VALUES(?,?,?,?,?,?) ON CONFLICT(project_id,id) DO UPDATE SET fields=excluded.fields,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).run(project,id,JSON.stringify(overviewScheduleMilestone(fields)),revision,updatedAt,user);
      else db.prepare('DELETE FROM project_milestones WHERE project_id=? AND id=?').run(project,id);
    }
  };
  const adopt=(project,current,user)=>{
    if(current.initialized)return;
    db.prepare("INSERT INTO schedule_projects VALUES(?,'[]')").run(project);
    for(const m of current.store.milestones) {
      const original=db.prepare('SELECT updated_by FROM project_milestones WHERE project_id=? AND id=?').get(project,m.id);
      write(project,'milestone',m.id,m,current.versions[m.id],original?.updated_by??user,current.stamps[m.id]);
    }
  };
  const initialize=(project,input,user)=>{
    const current=read(project);
    if(current.initialized||current.store.milestones.length)fail(409,'团队已有里程碑或排期，请直接在团队中维护，不能用本地内容覆盖');
    const value=normalize(input);
    db.prepare('INSERT INTO schedule_projects VALUES(?,?)').run(project,JSON.stringify(value.references));
    for(const m of value.store.milestones)write(project,'milestone',m.id,m,1,user);
    for(const t of value.store.tasks)write(project,'task',t.id,t,1,user);
    overview.activity(project,user,'从本地项目初始化了项目排期');return read(project);
  };
  const update=(project,input,user)=>{
    const current=read(project),changes=input.changes;
    if(typeof input.requestId!=='string'||!input.requestId.trim()||input.requestId.length>200||!Array.isArray(changes)||changes.length>2200||changes.some(c=>!c||!['task','milestone'].includes(c.kind)||typeof c.id!=='string'||!c.id.trim()||c.id.length>200||!Number.isSafeInteger(c.revision)||c.revision<0||(c.fields!==null&&(!c.fields||c.fields.id!==c.id)))||new Set(changes.map(c=>c.id)).size!==changes.length)fail(400,'排期提交格式无效');
    const signature=createHash('sha256').update(JSON.stringify(changes)).digest('hex'),prior=db.prepare('SELECT signature FROM schedule_operations WHERE project_id=? AND user_id=? AND request_id=?').get(project,user,input.requestId);
    if(prior){if(prior.signature!==signature)fail(409,'提交请求的内容已变化，请重新提交');return current;}
    const conflict=message=>fail(409,message??'任务或里程碑已有新的团队版本，请对照后提交',{currentRecord:current});
    if(changes.some(c=>c.revision!==(current.versions[c.id]??0)))conflict();
    for(const c of changes){const old=db.prepare('SELECT kind FROM schedule_records WHERE project_id=? AND id=?').get(project,c.id);if(old&&old.kind!==c.kind||current.store.milestones.some(m=>m.id===c.id)&&c.kind!=='milestone')fail(400,'不能更改排期记录类型');}
    let candidate;try{candidate=applyScheduleChanges(current.store,changes);}catch(e){fail(400,e.message);}
    candidate=normalize({store:candidate,references:current.references}).store;
    for(const milestone of candidate.milestones) {
      const state=milestoneAcceptance(candidate,milestone.id);
      if(milestone.status==='已验收'&&current.store.milestones.find(m=>m.id===milestone.id)?.status!=='已验收'&&state.total&&!state.ready)conflict('里程碑任务尚未全部完成，请重新核对验收');
    }
    candidate=invalidateMilestoneAcceptance(current.store,candidate);
    const oldErrors=new Set(scheduleStructureErrors(current.store));
    if(scheduleStructureErrors(candidate).some(e=>!oldErrors.has(e)))conflict('前置任务或里程碑已变化，请核对依赖和删除范围');
    const oldRefs=new Set(current.store.tasks.flatMap(t=>t.references.map(r=>t.id+':'+r.kind+':'+r.targetId))),designs=new Set(gameplay.read(project).store.designs.filter(d=>!d.archived).map(d=>d.id));
    for(const t of candidate.tasks)for(const r of t.references)if(!oldRefs.has(t.id+':'+r.kind+':'+r.targetId)&&(r.kind!=='gameplay'||!designs.has(r.targetId)))fail(400,'新增排期关联只能选择当前团队中可用的玩法文档');
    const before=new Map(scheduleRecords(current.store).map(r=>[r.id,r])),after=new Map(scheduleRecords(candidate).map(r=>[r.id,r]));
    const effective=[...changes];
    for(const m of candidate.milestones)if(!effective.some(c=>c.id===m.id)&&!sameScheduleRecord(before.get(m.id),m))effective.push({id:m.id,kind:'milestone',revision:current.versions[m.id]??0});
    const changed=effective.filter(c=>!sameScheduleRecord(before.get(c.id),after.get(c.id)));
    if(changed.length){adopt(project,current,user);for(const c of changed)write(project,c.kind,c.id,after.get(c.id)??null,c.revision+1,user);overview.activity(project,user,'更新了项目排期：'+changed.length+' 项');}
    db.prepare('INSERT INTO schedule_operations VALUES(?,?,?,?)').run(project,user,input.requestId,signature);return read(project);
  };
  const updateLegacyMilestone=(project,id,input,user)=>{
    if(typeof id!=='string'||!id.trim()||id.length>200)fail(400,'里程碑标识无效');
    const current=read(project),old=current.store.milestones.find(m=>m.id===id);
    const fields=overview.publicationFields({info:{name:'',genre:'',platform:'',version:'',status:'',description:''},milestones:[input.fields]},'validation').milestones[0];
    if(input.revision !== (current.versions[id]??0))fail(409,'这个里程碑已被其他成员更新，请处理冲突。',{currentRecord:overview.read(project).milestones.find(m=>m.id===id)??null});
    const converted=legacyScheduleMilestone(id,fields);
    const full={...converted,...old,title:fields.title,owner:fields.owner,due:converted.due,status:converted.status};
    update(project,{requestId:randomUUID(),changes:[{id,kind:'milestone',revision:input.revision,fields:full}]},user);
    db.prepare("INSERT INTO project_overviews VALUES (?,'{}',0,1,NULL,NULL) ON CONFLICT(project_id) DO UPDATE SET initialized=1").run(project);
    return overview.read(project).milestones.find(m=>m.id===id);
  };
  const history=project=>db.prepare('SELECT snapshot FROM schedule_history WHERE project_id=? ORDER BY rowid DESC LIMIT 50').all(project).map(r=>JSON.parse(r.snapshot));
  return {read,initialize,update,updateLegacyMilestone,history};
}
module.exports={createScheduleStore};
