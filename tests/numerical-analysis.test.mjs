import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {parseExpression,evaluateExpression} from '../src/analysis-expression.ts';
import {diceChance,resolveNarrativeCheck,narrativeCheckChance} from '../src/story-check.ts';
import {emptyNumericalAnalysis,newAnalysisPlan,validateNumericalAnalysis,runAnalysis,snapshotAnalysis,numericCell,analysisCsv,readNumericalAnalysis,writeNumericalAnalysis,planFromStoryCheck} from '../src/numerical-analysis.ts';
import {analysisExamples} from '../src/analysis-examples.ts';
import {emptyStoryOrchestration} from '../src/story-orchestration.ts';
import {preparePrototypeProject,writePrototypeProject,validatePrototypeExample} from '../src/prototype-import.ts';
import {captureProjectPackage,prepareProjectPackageImport,writeProjectPackageImport,validateProjectPackage} from '../src/project-package.ts';
const example=async name=>JSON.parse(await fs.readFile(new URL('../examples/prototypes/'+name+'.json',import.meta.url),'utf8'));
const sources=e=>({data:e.data,narrative:e.storyOrchestration??emptyStoryOrchestration()});
const evalx=(s,vars={})=>evaluateExpression(parseExpression(s),n=>{if(!Object.hasOwn(vars,n))throw new Error('unknown');return vars[n];},(fn,a)=>diceChance(...a));
test('bounded expression parser: precedence, lazy conditional, finite math and forbidden code',()=>{
  assert.equal(evalx('-2^2 + 2^3^2'),508);assert.equal(evalx('ceil(hp/damage)',{hp:21,damage:5}),5);
  assert.equal(evalx('if(0, 1/0, clamp(-4,0,10))'),0);assert.equal(evalx('1e2 + .5'),100.5);
  for(const s of ['','1/0','sqrt(-1)','2^2000','min()','round(1,2)','clamp(2,3,1)','globalThis.process','constructor()','(()=>1)()','Math.random()','1;2','(1','1 2','abs(1,)','('.repeat(45)+'1'+')'.repeat(45)])assert.throws(()=>evalx(s),s);
  assert.ok(Math.abs(evalx('diceChance(3,9,2,6,1)')-26/36)<1e-12);
});
test('exact dice probabilities match playable outcomes including modifiers, criticals and thresholds',()=>{
  for(const sides of [2,6,20])for(const criticals of [false,true])for(const difficulty of [-20,3,9,19,100]){
    const c={mode:'dice',diceCount:2,diceSides:sides,criticals,difficulty,variableId:'skill',modifiers:[{condition:{groups:[[{variableId:'gear',op:'eq',value:1}]]},value:2}]};
    let success=0;for(let a=1;a<=sides;a++)for(let b=1;b<=sides;b++)success+=+resolveNarrativeCheck(c,{skill:3,gear:1},[a,b]).success;
    assert.ok(Math.abs(narrativeCheckChance(c,{skill:3,gear:1})-success/(sides*sides))<1e-12);
  }
  assert.ok(Math.abs(diceChance(-1000,99,2,6,1)-1/36)<1e-12);assert.ok(Math.abs(diceChance(1000,0,2,6,1)-35/36)<1e-12);
  const c={mode:'threshold',variableId:'s',difficulty:4,modifiers:[]};assert.equal(narrativeCheckChance(c,{s:4}),1);assert.equal(resolveNarrativeCheck(c,{s:3},[]).success,false);
  assert.throws(()=>diceChance(0,1,100,6,1));assert.throws(()=>diceChance(0,1,2,6,2));assert.ok(diceChance(0,500,10,100,1)>0);
});
test('numeric bindings preserve zero, reject malformed values and validate range/type/unit',async()=>{
  assert.equal(numericCell('0','number'),0);assert.equal(numericCell('25%','percent'),.25);assert.equal(numericCell('0.25','percent'),.25);
  for(const s of ['',' ','25hp','1,000','0x10','Infinity','NaN'])assert.throws(()=>numericCell(s,'number'));
  assert.throws(()=>numericCell('20%','number'));
  const e=await example('hollow-knight'),p=e.numericalAnalysis.plans[0],s=sources(e),before=JSON.stringify(e);
  assert.equal(runAnalysis(p,s).rows[0].values.hits,2);assert.equal(runAnalysis(p,s).rows[0].values.time,.4);
  const bad=structuredClone(p);bad.parameters[1].unit='金币';assert.match(runAnalysis(bad,s).rows[0].errors.join(),/单位不匹配/);
  bad.parameters[1].unit='HP';bad.parameters[1].type='integer';bad.variants=[{id:'v',name:'非整数',overrides:{damage:2.5}}];assert.match(runAnalysis(bad,s,'v').rows[0].errors.join(),/有效范围/);
  bad.parameters[1].binding.rowId='deleted';assert.match(runAnalysis(bad,s).rows[0].errors.join(),/记录已失效/);
  const dup=structuredClone(s);dup.data.datasets.hk_enemies.push(dup.data.datasets.hk_enemies[0]);assert.match(runAnalysis(p,dup).errors.join(),/重复/);
  assert.equal(JSON.stringify(e),before);
});
test('cross-table joins, sweeps, dependencies, bounds and snapshots use current source data',async()=>{
  const e=await example('stardew-valley'),p=e.numericalAnalysis.plans[0],s=sources(e);
  assert.deepEqual(runAnalysis(p,s).rows.map(r=>r.values.profit),[10,16]);
  p.metrics.push({id:'double',name:'双倍',formula:'profit*2',unit:'金币',minimum:null,maximum:25});
  assert.ok(runAnalysis(p,s).rows[1].outside.includes('double'));
  const snapshot=snapshotAnalysis(p,s);assert.equal(snapshot.signature,runAnalysis(p,s).signature);
  s.data.datasets.farm_items.find(r=>r.id==='turnip').sell='22';assert.notEqual(snapshot.signature,runAnalysis(p,s).signature);assert.equal(snapshot.rows[0].values.profit,10);
  p.sweep={parameterId:'plots',start:1,end:3,step:1};assert.equal(runAnalysis(p,s).rows.length,6);
  p.sweep.step=0;assert.match(runAnalysis(p,s).errors.join(),/步长/);p.sweep=null;
  p.metrics[0].formula='double';assert.match(runAnalysis(p,s).rows[0].errors.join(),/循环依赖/);assert.throws(()=>snapshotAnalysis(p,s));
  p.metrics[0].formula='deleted';assert.match(runAnalysis(p,s).rows[0].errors.join(),/未知参数/);
});
test('all five examples calculate base and variants without mutating sources; narrative rules stay live',async()=>{
  for(const name of ['hollow-knight','stardew-valley','plants-vs-zombies','disco-elysium','vampire-survivors']){
    const e=await example(name),before=JSON.stringify(e);validatePrototypeExample(e);validateNumericalAnalysis(e.numericalAnalysis);
    for(const p of e.numericalAnalysis.plans)for(const variant of ['',...p.variants.map(v=>v.id)]){const r=runAnalysis(p,sources(e),variant);assert.deepEqual(r.errors,[],p.name);assert.ok(r.rows.length>0);assert.deepEqual(r.rows.flatMap(row=>row.errors),[],p.name);}
    assert.equal(JSON.stringify(e),before);
    const added=analysisExamples(name,sources(e));assert.ok(added.length);assert.notEqual(added[0].id,e.numericalAnalysis.plans[0].id);
  }
  const e=await example('disco-elysium'),s=sources(e),story=s.narrative.stories[0],p=planFromStoryCheck(story,story.checks[0].id),snap=snapshotAnalysis(p,s);
  story.checks[0].difficulty+=3;assert.notEqual(runAnalysis(p,s).signature,snap.signature);
  s.narrative.enabled=false;assert.match(runAnalysis(p,s).errors.join(),/未启用/);
});
test('archive conflict, corruption, failed writes, validation and CSV spreadsheet escaping',()=>{
  const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)},p=newAnalysisPlan('测试'),store={schema:1,plans:[p]};
  assert.deepEqual(readNumericalAnalysis(storage,'a').store,emptyNumericalAnalysis());const raw=writeNumericalAnalysis(storage,'a',null,store);
  assert.throws(()=>writeNumericalAnalysis(storage,'a',null,store),/其他窗口/);assert.equal(storage.getItem('a'),raw);
  assert.throws(()=>writeNumericalAnalysis({...storage,setItem(){throw new Error('disk full');}},'a',raw,emptyNumericalAnalysis()));assert.equal(storage.getItem('a'),raw);
  storage.setItem('a','broken');assert.throws(()=>readNumericalAnalysis(storage,'a'));assert.throws(()=>writeNumericalAnalysis(storage,'a','broken',store));
  for(const v of [{schema:1,plans:[{...p,id:'__proto__'}]},{schema:2,plans:[]},{schema:1,plans:[p,p]},{schema:1,plans:[{...p,sweep:{parameterId:'p',start:0,end:1,step:Infinity}}]}])assert.throws(()=>validateNumericalAnalysis(v));
  const csv=analysisCsv({...p,metrics:[{id:'m',name:'=BAD',unit:''}]},[{label:'=HYPERLINK("x")',inputs:{},values:{m:2},errors:[],outside:[]}]);assert.ok(csv.includes("'=BAD"));assert.ok(csv.includes("'=HYPERLINK"));
});
test('analysis archives travel through prototype import, legacy folders and desktop round trip',async t=>{
  const config={engine:'oasis-lua',projectPath:'',enumPath:'Script/Const',dataPath:'Script/Config',outputFormat:'lua',autoSync:false,backupBeforeSync:true};
  const catalog={schema:2,activeId:'',mode:'project',projects:[]},values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
  const e=await example('stardew-valley'),prepared=preparePrototypeProject(catalog,e,'分析项目');writePrototypeProject(storage,prepared);storage.setItem('gamecreator.projects.v1',JSON.stringify(prepared.catalog));
  const snapshot=captureProjectPackage(storage,prepared.project);assert.deepEqual(snapshot.document.archives['numerical-analysis'],e.numericalAnalysis);
  const old=structuredClone(snapshot.document);delete old.archives['numerical-analysis'];assert.deepEqual(validateProjectPackage(old).archives['numerical-analysis'],emptyNumericalAnalysis());
  const imported=prepareProjectPackageImport(prepared.catalog,snapshot.document,'另一个项目');writeProjectPackageImport(storage,imported);storage.setItem('gamecreator.projects.v1',JSON.stringify(imported.catalog));assert.deepEqual(captureProjectPackage(storage,imported.project).document.archives['numerical-analysis'],e.numericalAnalysis);
  storage.setItem('gamecreator.projects.v1',JSON.stringify(prepared.catalog));
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gc-analysis-package-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const {createProjectPackages}=createRequire(import.meta.url)('../desktop/project-package.cjs');const service=createProjectPackages({dataDirectory:path.join(dir,'data'),storage}),args={directory:path.join(dir,'export'),projectId:prepared.project.id,...snapshot};
  await service.exportFolder(args);assert.deepEqual((await service.readFolder(args.directory)).document.archives['numerical-analysis'],e.numericalAnalysis);
  const invalid=structuredClone(snapshot.document);invalid.archives['numerical-analysis'].plans[0].parameters[0].value='bad';await assert.rejects(service.exportFolder({...args,directory:path.join(dir,'invalid'),document:invalid}));
});
