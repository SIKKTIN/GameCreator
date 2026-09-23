import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomBytes,randomUUID,createCipheriv,createDecipheriv} from 'node:crypto';
import {defaultWorkTeam,defaultAiTeam,credentialTasks,workAssignees,credentialMarkdown,developerMayAccess} from '../shared/ai-personnel.mjs';
import {createProductionTask,validateProjectSchedule} from '../src/project-schedule.ts';
const require=createRequire(import.meta.url),{createDeveloperService}=require('../desktop/ai-developers.cjs'),{createCredentialVault}=require('../desktop/ai-credential-vault.cjs'),{issueAiCredential,verifyAiFeedback}=require('../desktop/ai-credentials.cjs'),{signFeedback}=require('../shared/ai-feedback-client.cjs'),{validateProjectScheduleArchive}=require('../desktop/project-package.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gc-developer-'));t.after(()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('gc-developer-'));fs.rmSync(root,{recursive:true,force:true});});
 const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},projectId='developer-test',sk='gamecreator.workspace.v1:'+projectId+':project-schedule';
 storage.setItem('gamecreator.projects.v1',JSON.stringify({activeId:projectId,projects:[{id:projectId}]}));
 storage.setItem(sk,JSON.stringify({schema:1,personnel:defaultWorkTeam(),tasks:[{...createProductionTask('程序工作'),id:'program-task'},{...createProductionTask('美术工作'),id:'art-task',kind:'美术'}],milestones:[]}));
 const key=randomBytes(32),safeStorage={isEncryptionAvailable:()=>true,encryptString(text){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv),body=Buffer.concat([c.update(text,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),body]);},decryptString(bytes){const d=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));d.setAuthTag(bytes.subarray(12,28));return Buffer.concat([d.update(bytes.subarray(28)),d.final()]).toString();}};
 const vault=createCredentialVault({directory:root,safeStorage}),service=createDeveloperService({storage,vault}),read=()=>JSON.parse(storage.getItem(sk));
 const input=(extra={})=>({projectId,schedule:read(),name:'开发助手',duties:'持续参与开发',permissions:['progress'],active:true,profile:{positionIds:['program'],taskIds:[],scope:'assigned',expiresAt:''},...extra});
 const draft=(extra={})=>({schema:1,projectId,engine:'godot-gdscript',id:randomUUID(),snapshotId:'f'.repeat(64),target:{kind:'task',id:'program-task'},author:'开发助手',summary:'工作进度',evidence:['验证结果'],changes:{status:'待验收',result:'工作完成'},...extra});
 return{root,storage,sk,projectId,vault,service,safeStorage,read,input,draft};
}
test('zero-task producer keeps a persistent, recopyable encrypted credential without gaining workload',async t=>{
 const f=fixture(t),result=await f.service.change('create',f.input({name:'制作人',permissions:['review','propose'],profile:{positionIds:['producer'],taskIds:[],scope:'project',expiresAt:''}})),identity={projectId:f.projectId,credentialId:result.credential.id};
 const secret=f.service.read(identity);assert.equal(secret.schema,2);assert.equal(secret.privateKey,f.service.read(identity).privateKey);
 assert.equal(createDeveloperService({storage:f.storage,vault:f.vault}).read(identity).privateKey,secret.privateKey);
 const s=f.read(),member=s.personnel.members[0];assert.equal(s.personnel.credentials.length,1);assert.equal(credentialTasks(s,result.credential).length,0);assert.deepEqual(workAssignees(s,'program-task',f.projectId),[]);
 for(const text of [JSON.stringify(s),credentialMarkdown(s,result.credential),fs.readFileSync(path.join(f.root,fs.readdirSync(f.root)[0])).toString()])assert.ok(!text.includes(secret.privateKey));
 assert.equal(verifyAiFeedback(signFeedback(f.draft({intent:'propose',target:{kind:'task',id:'art-task'},changes:{result:'建议'}}),secret),s).verified,true);
 assert.throws(()=>verifyAiFeedback(signFeedback(f.draft(),secret),s),/权限/);assert.ok(developerMayAccess(s,member,s.tasks[1]));validateProjectSchedule(s);validateProjectScheduleArchive(s);
});
test('same key follows current name, task assignments, role scope, permissions, expiry and disabled state',async t=>{
 const f=fixture(t),{credential,memberId}=await f.service.change('create',f.input()),identity={projectId:f.projectId,credentialId:credential.id},secret=f.service.read(identity);
 const verify=(extra={})=>verifyAiFeedback(signFeedback(f.draft(extra),secret),f.read());assert.throws(()=>verify(),/范围/);
 await f.service.change('update',f.input({memberId,profile:{positionIds:['program'],taskIds:['program-task'],scope:'assigned',expiresAt:''}}));assert.ok(verify().verified);assert.equal(f.service.read(identity).privateKey,secret.privateKey);assert.equal(workAssignees(f.read(),'program-task',f.projectId).length,1);
 const update=(extra={})=>f.service.change('update',f.input({memberId,name:'程序负责人',permissions:['review'],profile:{positionIds:['program'],taskIds:[],scope:'positions',expiresAt:''},...extra}));
 await update();assert.throws(()=>verify(),/权限/);assert.equal(verify({intent:'review',changes:{status:'已完成'}}).memberName,'程序负责人');
 const s=f.read();s.tasks.push({...createProductionTask('后续程序'),id:'future'});f.storage.setItem(f.sk,JSON.stringify(s));assert.ok(verify({intent:'review',target:{kind:'task',id:'future'},changes:{status:'已完成'}}).verified);assert.throws(()=>verify({intent:'review',target:{kind:'task',id:'art-task'},changes:{status:'已完成'}}),/范围/);assert.equal(workAssignees(f.read(),'future',f.projectId).length,0);
 await update({active:false});assert.throws(()=>verify({intent:'review',changes:{status:'已完成'}}),/停用/);
 await update({profile:{positionIds:['program'],taskIds:[],scope:'positions',expiresAt:'2020-01-01T00:00:00.000Z'}});assert.throws(()=>verify({intent:'review',changes:{status:'已完成'}}),/过期/);
 await update();assert.ok(verify({intent:'review',changes:{status:'已完成'}}).verified);assert.equal(f.service.read(identity).privateKey,secret.privateKey);assert.equal(f.read().personnel.credentials.length,1);validateProjectSchedule(f.read());validateProjectScheduleArchive(f.read());
});
test('failures roll back only newly created secrets; import verifies identity and rotation preserves developer',async t=>{
 const f=fixture(t),save=f.storage.setItem;f.storage.setItem=()=>{throw new Error('disk failure');};await assert.rejects(f.service.change('create',f.input()),/disk/);assert.deepEqual(fs.readdirSync(f.root),[]);assert.equal(f.read().personnel.members.length,0);f.storage.setItem=save;
 f.safeStorage.isEncryptionAvailable=()=>false;await assert.rejects(f.service.change('create',f.input()),/加密/);assert.deepEqual(fs.readdirSync(f.root),[]);f.safeStorage.isEncryptionAvailable=()=>true;
 const before=f.input(),{credential,memberId}=await f.service.change('create',before),identity={projectId:f.projectId,credentialId:credential.id},secret=f.service.read(identity);await assert.rejects(f.service.change('update',{...before,memberId}),/已变化/);
 f.vault.remove(f.projectId,credential.id);assert.throws(()=>f.service.read(identity),/没有此凭证/);assert.throws(()=>f.service.importSecret(identity,{...secret,projectId:'other'}),/不匹配/);assert.throws(()=>f.service.importSecret(identity,{...secret,privateKey:randomBytes(48).toString('base64')}),/不匹配/);f.service.importSecret(identity,secret);assert.equal(f.service.read(identity).privateKey,secret.privateKey);
 const files=fs.readdirSync(f.root);f.storage.setItem=()=>{throw new Error('disk failure');};await assert.rejects(f.service.change('rotate',f.input({...identity,memberId})),/disk/);assert.deepEqual(fs.readdirSync(f.root),files);assert.equal(f.service.read(identity).privateKey,secret.privateKey);f.storage.setItem=save;
 const next=await f.service.change('rotate',f.input({...identity,memberId}));assert.equal(next.memberId,memberId);assert.notEqual(next.credential.id,credential.id);assert.equal(f.read().personnel.members.length,1);assert.throws(()=>f.service.read(identity),/已撤销/);assert.throws(()=>verifyAiFeedback(signFeedback(f.draft(),secret),f.read()),/已撤销/);
 f.storage.setItem('gamecreator.projects.v1',JSON.stringify({activeId:'other',projects:[{id:f.projectId},{id:'other'}]}));assert.throws(()=>f.service.read({projectId:f.projectId,credentialId:next.credential.id}),/当前项目/);
});
test('legacy credential backup can be imported and recopied without replacing identity or widening scope',async t=>{
 const f=fixture(t),s=f.read();s.personnel=defaultAiTeam();const member=s.personnel.members.find(m=>m.name==='程序A');s.tasks[0].assignment={primaryId:member.id,collaboratorIds:[],reviewerId:''};f.storage.setItem(f.sk,JSON.stringify(s));
 const {secret,credential}=issueAiCredential(f.storage,{projectId:f.projectId,memberId:member.id,name:'历史凭证',expiresAt:new Date(Date.now()+86400000).toISOString(),permissions:['progress'],taskIds:[],schedule:f.read()}),identity={projectId:f.projectId,credentialId:credential.id};assert.throws(()=>f.service.read(identity),/没有此凭证/);
 f.service.importSecret(identity,secret);assert.deepEqual(f.service.read(identity),secret);assert.ok(verifyAiFeedback(signFeedback(f.draft(),secret),f.read()).verified);assert.throws(()=>verifyAiFeedback(signFeedback(f.draft({target:{kind:'task',id:'art-task'}}),secret),f.read()),/范围/);
 f.service.revoke({...identity,schedule:f.read()});assert.throws(()=>f.service.read(identity),/已撤销/);assert.equal(f.read().personnel.members.find(m=>m.id===member.id).name,'程序A');
});

test('deleting revoked and live credentials cleans only their secrets and preserves developer identity and work',async t=>{
 const f=fixture(t),{credential,memberId}=await f.service.change('create',f.input({profile:{positionIds:['program'],taskIds:['program-task'],scope:'assigned',expiresAt:''}})),identity={projectId:f.projectId,credentialId:credential.id},secret=f.service.read(identity);
 const next=await f.service.change('rotate',f.input({...identity,memberId})),latest={projectId:f.projectId,credentialId:next.credential.id},latestSecret=f.service.read(latest),before=f.read();
 f.service.remove({...identity,schedule:before});assert.equal(f.vault.has(f.projectId,credential.id),false);assert.equal(f.read().personnel.credentials.length,1);assert.equal(f.service.read(latest).privateKey,latestSecret.privateKey);assert.deepEqual(f.read().personnel.members,before.personnel.members);assert.deepEqual(f.read().tasks,before.tasks);assert.throws(()=>f.service.read(identity),/不存在/);assert.throws(()=>verifyAiFeedback(signFeedback(f.draft(),secret),f.read()),/无效/);
 f.service.remove({...latest,schedule:f.read()});assert.equal(f.vault.has(f.projectId,next.credential.id),false);assert.equal(f.read().personnel.credentials.length,0);assert.deepEqual(f.read().personnel.members,before.personnel.members);assert.throws(()=>verifyAiFeedback(signFeedback(f.draft(),latestSecret),f.read()),/无效/);
 const reused=await f.service.change('create',f.input({memberId}));assert.equal(reused.memberId,memberId);assert.equal(f.read().personnel.members.length,1);assert.notEqual(reused.credential.id,next.credential.id);
 // Historical credentials can be deleted even when no private copy is on this machine.
 f.vault.remove(f.projectId,reused.credential.id);f.service.remove({projectId:f.projectId,credentialId:reused.credential.id,schedule:f.read()});assert.equal(f.read().personnel.credentials.length,0);
});

test('credential deletion rejects stale or foreign requests; cleanup failures remain revoked and retryable',async t=>{
 const f=fixture(t),{credential}=await f.service.change('create',f.input()),input={projectId:f.projectId,credentialId:credential.id,schedule:f.read()},save=f.storage.setItem,remove=f.vault.remove;
 assert.throws(()=>f.service.remove({...input,schedule:{...input.schedule,tasks:[]}}),/已变化/);assert.throws(()=>f.service.remove({...input,projectId:'other'}),/当前项目/);assert.ok(f.vault.has(f.projectId,credential.id));assert.equal(f.read().personnel.credentials[0].revokedAt,'');
 f.storage.setItem=()=>{throw new Error('disk failure');};assert.throws(()=>f.service.remove(input),/disk failure/);assert.ok(f.vault.has(f.projectId,credential.id));assert.equal(f.read().personnel.credentials[0].revokedAt,'');f.storage.setItem=save;
 f.vault.remove=()=>{throw new Error('cleanup failure');};assert.throws(()=>f.service.remove(input),/已撤销.*重试/);assert.ok(f.read().personnel.credentials[0].revokedAt);assert.ok(f.vault.has(f.projectId,credential.id));f.vault.remove=remove;
 f.storage.setItem=()=>{throw new Error('disk failure');};assert.throws(()=>f.service.remove({...input,schedule:f.read()}),/已撤销.*重试/);assert.ok(f.read().personnel.credentials[0].revokedAt);assert.equal(f.vault.has(f.projectId,credential.id),false);f.storage.setItem=save;
 f.service.remove({...input,schedule:f.read()});assert.equal(f.read().personnel.credentials.length,0);assert.equal(f.read().personnel.members.length,1);assert.throws(()=>f.service.remove({...input,schedule:f.read()}),/不存在/);
});
