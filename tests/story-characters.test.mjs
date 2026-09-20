import test from 'node:test';
import assert from 'node:assert/strict';
import {createNarrative,validateStoryOrchestration,storyOrchestrationMarkdown,readStoryOrchestration,copyNarrative} from '../src/story-orchestration.ts';
import {withCharacterLibrary,resolveStoryActors,addCharacterToStory,removeStoryCharacter,createStoryCharacter,storyValueText} from '../src/story-characters.ts';
import {startStory,chooseStoryOption} from '../src/story-playthrough.ts';
import {validateProjectPackage,captureProjectPackage} from '../src/project-package.ts';
import {defaultCatalog} from '../src/project-catalog.ts';
const fixture=()=>{const story=createNarrative('星舰返航');story.nodes[0].text='通讯台亮起。';story.actors=[{id:'captain',name:'船长',description:'寻找归途'},{id:'voice:radio',name:'通讯广播',description:'播报航道'}];story.nodes[0].speakerId='captain';return {schema:1,enabled:true,stories:[story]};};
test('legacy speakers migrate without disk writes, story ID rewrites, or unrelated same-name people being merged',()=>{
 const old=fixture(),copy=copyNarrative(old.stories[0]);old.stories.push(copy);const raw=JSON.stringify(old);
 const read=readStoryOrchestration({getItem:()=>raw},'story');assert.equal(JSON.stringify(old),raw);assert.equal(read.raw,raw);assert.equal(read.store.characters.length,2);
 assert.equal(read.store.stories[0].actors[1].kind,'voice');assert.equal(read.store.stories[0].nodes[0].speakerId,'captain');assert.notEqual(read.store.stories[0].actors[0].characterId,read.store.stories[1].actors[0].characterId);
 assert.deepEqual(withCharacterLibrary(read.store),read.store);validateStoryOrchestration(read.store);
});
test('shared project characters update across stories, including exports, and cannot be deleted while referenced',()=>{
 let store=withCharacterLibrary(fixture()),character=store.characters[0];store.stories.push(createNarrative('空间站重逢'));store=addCharacterToStory(store,store.stories[1].id,character.id);
 store.characters[0].name='阿遥';store.characters[0].background='出生于轨道居所';store.characters[0].portrait={assetId:'portrait',versionId:'v1',fileId:'f1'};
 assert.equal(resolveStoryActors(store,store.stories[0]).actors[0].name,'阿遥');assert.equal(resolveStoryActors(store,store.stories[1]).actors[0].name,'阿遥');assert.throws(()=>removeStoryCharacter(store,character.id),/仍有关联/);
 const copied=copyNarrative(store.stories[1]);assert.equal(copied.actors[0].characterId,character.id);assert.match(storyOrchestrationMarkdown(store),/出生于轨道居所/);
 const other=createStoryCharacter('导航员');store.characters.push(other);store.relationships.push({id:'r1',fromId:character.id,toId:other.id,label:'共同航行',description:'互相信任',secret:'曾经分离',directed:false});assert.throws(()=>removeStoryCharacter(store,other.id),/仍有关联/);
 const config={engine:'oasis-lua',projectPath:'E:/Space',enumPath:'Script/Const',dataPath:'Script/Config',outputFormat:'lua',autoSync:false,backupBeforeSync:true},catalog=defaultCatalog(config,'星舰');catalog.projects[0].initialContent='empty';
 const values=new Map([['gamecreator.projects.v1',JSON.stringify(catalog)],['gamecreator.workspace.v1:'+catalog.activeId+':story-orchestration',JSON.stringify(store)]]);
 const restored=validateProjectPackage(captureProjectPackage({getItem:k=>values.get(k)??null},catalog.projects[0]).document).archives['story-orchestration'];assert.deepEqual(restored,store);
});
test('custom speaker types and named flags are generic; malformed profiles, dice, and states are rejected',()=>{
 const store=withCharacterLibrary(fixture()),story=store.stories[0];story.actors[1].voiceType='舰载系统';story.variables=[{id:'airlock',name:'气闸已打开',category:'航行',initial:0,minimum:0,maximum:1,kind:'flag',trueLabel:'已打开',falseLabel:'已关闭'}];
 assert.equal(storyValueText(story.variables[0],0),'已关闭');assert.equal(storyValueText(story.variables[0],1),'已打开');validateStoryOrchestration(store);
 for(const mutate of [s=>s.characters[0].position.x=Infinity,s=>s.characters[0].color='url(bad)',s=>s.characters[0].portrait={assetId:1},s=>s.stories[0].variables[0].initial=2,s=>s.stories[0].actors[1].kind='unknown']){const broken=structuredClone(store);mutate(broken);assert.throws(()=>validateStoryOrchestration(broken));}
});
test('legacy 0–1 numeric ranges remain numeric, including fractional probabilities',()=>{
 const store=fixture(),story=store.stories[0];story.variables=[{id:'probability',name:'成功概率',category:'参数',initial:0.5,minimum:0,maximum:1}];
 const migrated=withCharacterLibrary(store);assert.equal(storyValueText(migrated.stories[0].variables[0],0.5),'0.5');assert.equal(startStory(migrated.stories[0]).current.state.probability,0.5);
});
test('threshold and custom dice checks work outside the detective template and preserve atomic preview behavior',()=>{
 const story=createNarrative('打开空间站气闸'),start=story.nodes[0];start.text='能源不足时另寻入口';story.variables=[{id:'power',name:'能源',category:'资源',initial:5,minimum:0,maximum:10}];
 story.nodes.push({...start,id:'pass',title:'入口',kind:'ending'}, {...start,id:'fail',title:'绕行',kind:'ending'});
 story.checks=[{id:'power-check',name:'能源检查',variableId:'power',difficulty:6,retry:'always',retryVariableIds:[],successId:'pass',failureId:'fail',successEffects:[],failureEffects:[],modifiers:[],notes:'',mode:'threshold'}];
 story.choices=[{id:'open',fromId:start.id,toId:'',label:'启动气闸',condition:{groups:[]},effects:[],once:false,passive:false,cost:0,checkId:'power-check'}];
 assert.equal(chooseStoryOption(story,startStory(story),'open',[6,6]).current.nodeId,'fail');assert.equal(chooseStoryOption(story,startStory(story,{power:6}),'open',[]).current.nodeId,'pass');
 story.checks[0]={...story.checks[0],mode:'dice',diceCount:1,diceSides:20,criticals:false,difficulty:15};const before=startStory(story);
 assert.equal(chooseStoryOption(story,before,'open',[10]).current.nodeId,'pass');assert.throws(()=>chooseStoryOption(story,before,'open',[6,6]),/1颗骰子/);assert.equal(before.current.nodeId,start.id);
 story.checks[0].difficulty=100;story.checks[0].criticals=true;assert.equal(chooseStoryOption(story,before,'open',[20]).current.nodeId,'pass');story.checks[0].criticals=false;assert.equal(chooseStoryOption(story,before,'open',[20]).current.nodeId,'fail');
 for(const p of [{diceCount:0},{diceSides:1},{mode:'other'}])assert.throws(()=>validateStoryOrchestration({schema:1,enabled:true,stories:[{...story,checks:[{...story.checks[0],...p}]}]}));
 story.variables.push({id:'ready',name:'准备就绪',category:'航行',initial:0,minimum:0,maximum:1,kind:'flag'});story.choices[0].effects=[{variableId:'power',op:'add',value:-1},{variableId:'ready',op:'set',value:0.5}];const atomic=startStory(story);
 assert.throws(()=>chooseStoryOption(story,atomic,'open','success'),/是／否状态/);assert.equal(atomic.current.state.power,5);assert.equal(atomic.current.state.ready,0);assert.throws(()=>startStory(story,{ready:0.5}),/初始状态/);
});
