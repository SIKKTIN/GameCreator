// Run after npm run build. Requires Playwright, optionally via GAMECREATOR_PLAYWRIGHT_PATH.
const {_electron} = require(process.env.GAMECREATOR_PLAYWRIGHT_PATH || 'playwright');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
(async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'gamecreator-restart-'));
  const profile=path.join(directory,'profile');
  await fs.mkdir(profile);
  const env={...process.env,GAMECREATOR_USER_DATA_DIR:profile,GAMECREATOR_DATA_DIR:path.join(directory,'data')};
  delete env.ELECTRON_RUN_AS_NODE;
  const executablePath=require('electron');
  let instance;
  const launch=async(file)=>{
    instance=await _electron.launch({executablePath,args:[path.join(root,file)],env});
    const deadline=Date.now()+45000;
    while(Date.now()<deadline){
      const page=instance.windows().find(page=>/^http:\/\/127\.0\.0\.1:\d+\/$/.test(page.url()));
      if(page)return page;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    throw new Error('Main window did not open');
  };
  try {
    const {emptyStore,makeSnapshot,stageSnapshot,publishRelease,decideChanges,diffEnums}=await import(pathToFileURL(path.join(root,'src/enum-versions.ts')));
    const project='E:/Fixture';
    const group={name:'Const_Test.Mode',source:'Script/Const/Const_Test.lua',line:1,comment:'重启测试',valueType:'number',
      members:[{key:'A',value:1,line:2,comment:'成员 A'},{key:'B',value:2,line:3,comment:'成员 B'}]};
    const scan={projectPath:project,enumPath:'Script/Const',files:[group.source],groups:[group],orderTables:[],dynamic:[],counts:{files:1,groups:1,members:2}};
    const data={columns:{},datasets:{}};
    for(const key of ['items','characters','skills','economy','shop']){
      data.columns[key]=[{key:'id',label:'ID'},{key:'name',label:'名称'}];data.datasets[key]=[];
    }
    data.datasets.items=[{id:'persist_1',name:'旧版已保存'}];
    const seeded=stageSnapshot(emptyStore(data),await makeSnapshot(scan,'source'));
    const version=await publishRelease(decideChanges(seeded,diffEnums(null,scan).map(change=>change.id),true,'admin'));
    version.revision=7;
    const key='gamecreator.enum-versions.v1:e:/fixture';
    let page=await launch('tests/fixtures/persistence-legacy.cjs');
    const legacyUrl=page.url();
    await page.evaluate(({key,version})=>{
      localStorage.setItem(key,JSON.stringify(version));
      localStorage.setItem('gamecreator.engine-config.v1',JSON.stringify({engine:'oasis-lua',projectPath:'E:/Fixture',enumPath:'Script/Const',dataPath:'Script/Config',outputFormat:'lua',autoSync:false,backupBeforeSync:true}));
    },{key,version});
    await instance.evaluate(({session})=>session.defaultSession.flushStorageData());
    await instance.close();instance=null;
    page=await launch('desktop/main.cjs');
    const firstUrl=page.url();
    assert.notEqual(firstUrl,legacyUrl);
    await page.getByRole('button',{name:'进入本地工作区',exact:true}).click();
    await page.getByRole('button',{name:'枚举定义',exact:true}).click();
    await page.getByRole('heading',{name:'Const_Test.Mode',exact:true}).waitFor();
    const migrated=await page.evaluate(key=>JSON.parse(window.desktopClient.storage.getItem(key)),key);
    assert.equal(migrated.activeId,version.activeId);
    assert.equal(migrated.revision,7);
    assert.equal(migrated.data.datasets.items[0].name,'旧版已保存');
    await page.getByRole('button',{name:'数据配置',exact:true}).click();
    await page.getByRole('textbox',{name:'persist_1 · 名称',exact:true}).fill('重启后仍保留');
    await page.getByRole('button',{name:'故事文档',exact:true}).click();
    await page.locator('.story-title-input').fill('持久化故事');
    await page.getByRole('button',{name:'项目概览',exact:true}).click();
    await page.getByRole('textbox',{name:'项目名称',exact:true}).fill('持久化项目');
    await page.getByRole('button',{name:'添加里程碑',exact:true}).click();
    const firstStored=await page.evaluate(key=>JSON.parse(window.desktopClient.storage.getItem(key)),key);
    assert.equal(firstStored.data.datasets.items[0].name,'重启后仍保留');
    const originOne=page.url();
    await instance.close();instance=null;
    page=await launch('desktop/main.cjs');
    assert.notEqual(page.url(),originOne);
    await page.getByRole('button',{name:'进入本地工作区',exact:true}).click();
    await page.getByRole('button',{name:'枚举定义',exact:true}).click();
    await page.getByRole('heading',{name:'Const_Test.Mode',exact:true}).waitFor();
    await page.getByRole('button',{name:'数据配置',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'persist_1 · 名称',exact:true}).inputValue(),'重启后仍保留');
    await page.getByRole('button',{name:'故事文档',exact:true}).click();
    assert.equal(await page.locator('.story-title-input').inputValue(),'持久化故事');
    await page.getByRole('button',{name:'项目概览',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'项目名称',exact:true}).inputValue(),'持久化项目');
    assert.equal(await page.locator('.milestone').count(),4);
    const finalStored=await page.evaluate(key=>JSON.parse(window.desktopClient.storage.getItem(key)),key);
    assert.equal(finalStored.activeId,version.activeId);
    assert.equal(finalStored.revision,firstStored.revision);
    assert.deepEqual(finalStored.releases,JSON.parse(JSON.stringify(version.releases)));
    console.log('PASS: legacy migration; stable enum/review history; edited data, project, milestones and story persist across different-port desktop restarts.');
  } finally {
    if(instance)await instance.close();
    await fs.rm(directory,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
