const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createCollaborationServer } = require('../server/collaboration.cjs');
const info = {name:'协作项目',genre:'叙事冒险',platform:'PC',version:'v0.2',status:'制作中',description:'共享简介'};
const milestone = {title:'首个原型',owner:'Alice',due:'2026/10/20',status:'planned'};
const source = {sourceInstanceId:'overview-client',sourceProjectId:'local-project'};
const publication = () => ({...source,name:'发布时指定名称',members:[{userId:'admin',role:'admin'},{userId:'bob',role:'editor',permissions:{overview:'edit',stories:'inherit'}}],stories:[],overview:{info,milestones:[milestone]}});
async function fixture(run) {
  const prefix=path.join(os.tmpdir(),'gc-overview-'),directory=fs.mkdtempSync(prefix);
  let service=await createCollaborationServer({directory,port:0});
  const request=async(route,token,method='GET',body)=>{
    const response=await fetch(service.url+'/api/team'+route,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+(token||'')},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  };
  const login=async user=>(await request('/login','','POST',{username:user,password:user+'123'})).data.token;
  const restart=async(edit)=>{const id=service.serverId;await service.close();if(edit){const db=new DatabaseSync(path.join(directory,'team.sqlite'));try{edit(db);}finally{db.close();}}service=await createCollaborationServer({directory,port:0});assert.equal(service.serverId,id);};
  try{await run({request,login,restart,directory});}finally{await service.close();assert.ok(path.resolve(directory).startsWith(path.resolve(prefix)));fs.rmSync(directory,{recursive:true,force:true});}
}
test('overview migration is additive and preserves existing project names, memberships, stories and history',()=>fixture(async({request,login,restart,directory})=>{
  const db=new DatabaseSync(path.join(directory,'team.sqlite'));
  const before=Object.fromEntries(['projects','members','stories','history'].map(table=>[table,db.prepare('SELECT * FROM '+table).all()]));db.close();
  await restart(db=>db.exec('DROP TABLE project_overviews; DROP TABLE project_milestones; DROP TABLE project_activity;'));
  const token=await login('admin'), result=await request('/projects/team-demo/overview',token);
  assert.equal(result.status,200);assert.equal(result.data.info.revision,0);assert.equal(result.data.info.initialized,false);
  assert.deepEqual(result.data.info.fields,{genre:'',platform:'',version:'',status:'',description:'',name:'多人协作验证项目'});
  assert.deepEqual(result.data.milestones,[]);assert.deepEqual(result.data.activity,[]);
  const after=new DatabaseSync(path.join(directory,'team.sqlite'));
  try{for(const [table,rows]of Object.entries(before))assert.deepEqual(after.prepare('SELECT * FROM '+table).all(),rows);}finally{after.close();}
}));
test('basic info and individual milestones commit independently, reject conflicts, update directory names and record real activity',()=>fixture(async({request,login,restart})=>{
  let admin=await login('admin');const alice=await login('alice'),bob=await login('bob'),viewer=await login('viewer'),route='/projects/team-demo';
  const grant=await request(route+'/members',admin,'PUT',{revision:1,members:[{userId:'admin',role:'admin'},{userId:'viewer',role:'viewer'},...['alice','bob'].map(userId=>({userId,role:'editor',permissions:{overview:'edit',stories:'inherit'}}))]});assert.equal(grant.status,200);
  const first=randomUUID(),second=randomUUID();
  const independent=await Promise.all([
    request(route+'/overview',alice,'PUT',{revision:0,fields:info}),
    request(route+'/milestones/'+first,bob,'PUT',{revision:0,fields:milestone}),
    request(route+'/milestones/'+second,alice,'PUT',{revision:0,fields:{...milestone,title:'第二项'}}),
  ]);assert.deepEqual(independent.map(row=>row.status),[200,200,200]);
  const concurrent=await Promise.all([
    request(route+'/overview',alice,'PUT',{revision:1,fields:{...info,description:'Alice'}}),
    request(route+'/overview',bob,'PUT',{revision:1,fields:{...info,description:'Bob'}}),
  ]);assert.deepEqual(concurrent.map(row=>row.status).sort(),[200,409]);
  assert.equal(concurrent.find(row=>row.status===409).data.currentRecord.revision,2);
  const milestoneRace=await Promise.all([
    request(route+'/milestones/'+first,alice,'PUT',{revision:1,fields:{...milestone,status:'done'}}),
    request(route+'/milestones/'+first,bob,'PUT',{revision:1,fields:{...milestone,owner:'Bob'}}),
  ]);assert.deepEqual(milestoneRace.map(row=>row.status).sort(),[200,409]);
  assert.equal(milestoneRace.find(row=>row.status===409).data.currentRecord.id,first);
  const read=(await request(route+'/overview',viewer)).data;
  assert.equal(read.activity.length,6,'Only successful writes and the explicit permission grant create activity');assert.ok(read.activity.filter(row=>row.title!=='更新了项目成员配置').every(row=>['alice','bob'].includes(row.actor)));
  assert.equal((await request('/projects',bob)).data.projects[0].name,info.name);
  assert.equal((await request(route+'/stories/world',bob)).data.story.revision,1);
  for(const endpoint of ['/overview','/milestones/'+first])assert.equal((await request(route+endpoint,viewer,'PUT',{revision:2,fields:info,role:'admin'})).status,403);
  assert.equal((await request(route+'/overview',bob,'PUT',{revision:2,fields:{...info,description:'x'.repeat(10001)}})).status,400);
  const privateProject=await request('/projects',admin,'POST',{name:'私有',requestId:randomUUID(),members:[{userId:'admin',role:'admin'}]});
  assert.equal((await request('/projects/'+privateProject.data.project.id+'/overview',bob)).status,403);
  assert.equal((await request('/projects/'+privateProject.data.project.id+'/milestones/'+first,bob,'PUT',{revision:0,fields:milestone})).status,403);
  await request(route+'/members',admin,'PUT',{revision:2,members:[{userId:'admin',role:'admin'}]});
  assert.equal((await request(route+'/overview',bob)).status,403);assert.equal((await request(route+'/milestones/'+second,alice,'PUT',{revision:1,fields:milestone})).status,403);
  await restart();admin=await login('admin');const persisted=(await request(route+'/overview',admin)).data;
  assert.deepEqual(persisted.info,read.info);assert.deepEqual(persisted.milestones,read.milestones);assert.equal(persisted.activity.length,7);
}));
test('publication includes overview atomically; retry and old-client publication never overwrite initialized team content',()=>fixture(async({request,login})=>{
  const admin=await login('admin');
  const bad={...publication(),overview:{info,milestones:[milestone,{...milestone,title:''}]}};
  assert.equal((await request('/publications',admin,'POST',bad)).status,400);assert.equal((await request('/publications/lookup',admin,'POST',source)).data.publication,null);
  const result=await request('/publications',admin,'POST',publication());assert.equal(result.status,201);assert.equal(result.data.overviewInitialized,true);
  const route='/projects/'+result.data.project.id,view=(await request(route+'/overview',admin)).data;
  assert.deepEqual(view.info.fields,{...info,name:publication().name});assert.equal(view.milestones.length,1);assert.notEqual(view.milestones[0].id,'0');
  assert.equal(view.activity.length,1);
  await request(route+'/overview',admin,'PUT',{revision:1,fields:{...view.info.fields,description:'团队修改'}});
  const repeat=await request('/publications',admin,'POST',{...publication(),overview:{info:{...info,description:'不应覆盖'},milestones:[]}});
  assert.equal(repeat.status,200);assert.equal((await request(route+'/overview',admin)).data.info.fields.description,'团队修改');
  assert.equal((await request('/publications/overview',admin,'POST',{...source,overview:publication().overview})).status,409);
  const legacy=publication();delete legacy.overview;legacy.sourceProjectId='legacy';
  const old=await request('/publications',admin,'POST',legacy);assert.equal(old.status,201);assert.equal(old.data.overviewInitialized,false);
  assert.equal((await request('/projects/'+old.data.project.id+'/overview',admin)).data.info.fields.description,'');
}));
test('one-time supplement preserves name and stories, survives restart and cannot race over team edits',()=>fixture(async({request,login,restart})=>{
  let admin=await login('admin');const bob=await login('bob');const legacy=publication();delete legacy.overview;
  const created=await request('/publications',admin,'POST',legacy),route='/projects/'+created.data.project.id;
  const payload={...source,overview:publication().overview};
  const competing=await Promise.all([request('/publications/overview',admin,'POST',payload),request('/publications/overview',admin,'POST',payload)]);
  assert.deepEqual(competing.map(row=>row.status).sort(),[200,409]);
  assert.equal((await request(route+'/overview',bob)).data.info.fields.name,legacy.name);
  assert.equal((await request(route+'/overview',bob)).data.milestones.length,1);
  assert.equal((await request('/publications/overview',bob,'POST',payload)).status,403);
  const old=await request('/publications',admin,'POST',{...legacy,sourceProjectId:'race'}),oldRoute='/projects/'+old.data.project.id;
  const race=await Promise.all([
    request('/publications/overview',admin,'POST',{...payload,sourceProjectId:'race'}),
    request(oldRoute+'/overview',bob,'PUT',{revision:0,fields:info}),
  ]);assert.deepEqual(race.map(row=>row.status).sort(),[200,409]);
  const manual=await request('/publications',admin,'POST',{...legacy,sourceProjectId:'milestone-edited'});
  await request('/projects/'+manual.data.project.id+'/milestones/'+randomUUID(),bob,'PUT',{revision:0,fields:milestone});
  assert.equal((await request('/publications/overview',admin,'POST',{...payload,sourceProjectId:'milestone-edited'})).status,409);
  await restart();admin=await login('admin');assert.equal((await request('/publications/lookup',admin,'POST',source)).data.publication.overviewInitialized,true);
  assert.equal((await request('/publications/overview',admin,'POST',payload)).status,409);
}));
