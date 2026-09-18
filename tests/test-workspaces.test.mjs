import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { buildTestWorkspace } from '../src/test-scenarios.ts';
import { diffEnums, snapshotById, decideChanges, syncApprovedChanges } from '../src/enum-versions.ts';
const require=createRequire(import.meta.url);
const {createWorkspaceStorage,prepareTestWorkspace,scenarios}=require('../desktop/test-workspaces.cjs');
const root=path.resolve(import.meta.dirname,'..');
test('all preset scenarios use real Lua scans and isolated archives; reset creates a fresh run',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'gamecreator-scenarios-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const storage=createWorkspaceStorage(directory);
  const formalKey='gamecreator.enum-versions.v1:e:/formal';
  storage.setItem(formalKey,'{"official":"untouched"}');
  const expected={first:[1,0,0],unchanged:[0,0,0],added:[1,0,0],removed:[0,1,0],modified:[0,0,1],mixed:[1,1,1],referenced:[0,1,0],error:[0,0,0]};
  const ids=new Set();
  for(const scenario of scenarios){
    const prepared=await prepareTestWorkspace(root,directory,scenario);
    assert.ok(prepared.config.projectPath.startsWith(path.join(directory,'test-workspaces')));
    assert.ok(!ids.has(prepared.id));ids.add(prepared.id);
    const built=await buildTestWorkspace(prepared,'admin');
    assert.deepEqual(Object.values(built.session.expectedChanges),expected[scenario]);
    assert.equal(Boolean(built.store.activeId),scenario!=='first');
    storage.setItem(built.key,JSON.stringify(built.store));
    assert.ok(storage.info(built.key).directory.startsWith(path.join(directory,'test-workspaces',prepared.id)));
    assert.equal(createWorkspaceStorage(directory).getItem(built.key),JSON.stringify(built.store));
    if(scenario==='referenced'){
      const changes=diffEnums(snapshotById(built.store,built.store.activeId).scan,prepared.incoming);
      await assert.rejects(syncApprovedChanges(decideChanges(built.store,changes.map(change=>change.id),true,'admin')),/数据配置/);
    }
  }
  const reset=await prepareTestWorkspace(root,directory,'mixed');
  assert.ok(!ids.has(reset.id));
  assert.equal(storage.getItem(formalKey),'{"official":"untouched"}');
  await assert.rejects(prepareTestWorkspace(root,directory,'../../formal'),/未知/);
  assert.throws(()=>storage.setItem('gamecreator.workspace.v1:'+path.join(directory,'test-workspaces').replaceAll('\\','/').toLowerCase()+'/../formal:project','{}'),/路径无效/);
});
