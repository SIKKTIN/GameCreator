export {assertDispatch,dispatchTask} from '../shared/task-inbox.mjs';
import {captureProjectPackage,validateProjectPackage,type ProjectPackageDocument} from './project-package.ts';
import type {SavedProject} from './project-catalog.ts';
import {createGameplay,gameplayStatuses,gameplayResults,type LoopStep,type PrototypeItem,type GameplayCheck} from './gameplay.ts';
import {createCoreNode,createCoreEdge,coreNodeKinds} from './gameplay-core.ts';
import {createPrototypeScene,createPrototypeElement} from './prototype-design.ts';
import {createFunctionalSystem,createCapability} from './functional-systems.ts';
import {createProductionTask,createProductionMilestone} from './project-schedule.ts';
import {createArtRequirement,createArtAsset} from './art-assets.ts';
import {createTask,createTaskStage,type TaskObjective,type TaskTransition} from './task-flow.ts';
import {createNarrative,type StoryActor,type StoryVariable,type StoryScene,type NarrativeNode,type StoryChoice,type NarrativeCheck} from './story-orchestration.ts';
import {createDesignMap,type MapLayer,type MapObject,type MapConnection} from './map-design.ts';
import {newAnalysisPlan,type AnalysisParameter,type AnalysisMetric,type AnalysisVariant} from './numerical-analysis.ts';
import {createDevelopmentTool} from '../shared/development-tools.mjs';
import {emptyArtStyle} from '../shared/art-style.mjs';
import {createStoryCharacter} from './story-characters.ts';
import {createRule,createState,createTransition,gameplayStateKinds,dependencyKinds,conditionOperators,type GameplayDependency,type RuleCondition,type RuleAction} from './gameplay-structure.ts';
import {createStageObject,createTrack,createTimelineEvent,stageKinds,stageColors} from './gameplay-stage.ts';
import {createSpatialRoom} from './spatial-layout.ts';
import {authoringError} from '../shared/authoring-diagnostics.mjs';
import {authoringPreview,validateAuthoringProposal,authoringModules} from '../shared/project-authoring.mjs';
import {assertContentReferences} from '../shared/authoring-references.mjs';
import {artLibrary} from './art-library.ts';
import {emptyArtAssets} from './art-assets.ts';
export {assertArtPermission,validArtPermissions} from '../shared/art-permissions.mjs';
export {validModuleGrants} from '../shared/project-authoring.mjs';
export {authoringModules,moduleGrants,authoringPreview,canonical,validateAuthoringProposal} from '../shared/project-authoring.mjs';
export {assertContentReferences} from '../shared/authoring-references.mjs';
export {gamecreatorGuide,guideVersion,authoringReadme} from '../shared/gamecreator-guide.mjs';
export {captureProjectPackage} from './project-package.ts';
export {authoringError} from '../shared/authoring-diagnostics.mjs';
export const contentModelVersion='2026-09-26.1';
export function validateContentBatch(archives:ProjectPackageDocument['archives']) {return validateProjectPackage({...emptyContentDocument(),archives});}
export function authoringTemplates(){return {
 gameplayLoopStep:{id:crypto.randomUUID(),text:''} satisfies LoopStep,
 gameplayPrototypeItem:{id:crypto.randomUUID(),text:'',done:false} satisfies PrototypeItem,
 gameplayCheck:{id:crypto.randomUUID(),question:'',steps:'',expected:'',actual:'',result:'未测试'} satisfies GameplayCheck,
 gameplayDependency:{id:crypto.randomUUID(),targetId:'',kind:'depends',note:''} satisfies GameplayDependency,
 gameplayRuleCondition:{id:crypto.randomUUID(),subject:'',operator:'eq',value:''} satisfies RuleCondition,
 gameplayRuleAction:{id:crypto.randomUUID(),text:''} satisfies RuleAction,
 gameplayTimelineTrack:createTrack(),gameplayTimelineEvent:createTimelineEvent(''),gameplayStageObject:createStageObject('actor',1,1),
 coreEdge:createCoreEdge('替换为起点ID','替换为终点ID'),spatialRoom:createSpatialRoom(0),
 taskObjective:{id:crypto.randomUUID(),title:'',condition:'',target:1} satisfies TaskObjective,taskTransition:{id:crypto.randomUUID(),fromId:'',toId:'',label:'',condition:''} satisfies TaskTransition,
 mapLayer:{id:crypto.randomUUID(),name:'新图层',visible:true,locked:false} satisfies MapLayer,mapObject:{id:crypto.randomUUID(),name:'新对象',kind:'note',layerId:'',x:0,y:0,width:1,height:1,color:'violet',notes:'',references:[]} satisfies MapObject,
 mapConnection:{id:crypto.randomUUID(),name:'区域通路',from:'',to:'',fromObjectId:'',toObjectId:'',direction:'both',kind:'passage',condition:''} satisfies MapConnection,
 narrativeActor:{id:crypto.randomUUID(),name:'新发言者',description:'',kind:'character',characterId:''} satisfies StoryActor,
 narrativeVariable:{id:crypto.randomUUID(),name:'新状态',category:'故事',initial:0,minimum:0,maximum:1,kind:'flag',trueLabel:'是',falseLabel:'否',characterId:''} satisfies StoryVariable,
 narrativeScene:{id:crypto.randomUUID(),title:'新场景',chapter:'',description:''} satisfies StoryScene,
 narrativeNode:{id:crypto.randomUUID(),sceneId:'',title:'新片段',kind:'narration',speakerId:'',text:'',outcome:'',taskStatus:'unchanged',taskIds:[]} satisfies NarrativeNode,
 narrativeChoice:{id:crypto.randomUUID(),fromId:'',toId:'',label:'继续',condition:{groups:[]},effects:[],once:false,passive:false,cost:0,checkId:''} satisfies StoryChoice,
 narrativeCheck:{id:crypto.randomUUID(),name:'新检定',variableId:'',difficulty:1,retry:'always',retryVariableIds:[],successId:'',failureId:'',successEffects:[],failureEffects:[],modifiers:[],notes:''} satisfies NarrativeCheck,
 narrativeCondition:{variableId:'',op:'eq',value:0},narrativeEffect:{variableId:'',op:'set',value:1},
 analysisParameter:{id:crypto.randomUUID(),name:'参数',unit:'',type:'number',value:0,minimum:null,maximum:null,binding:{kind:'constant'}} satisfies AnalysisParameter,
 analysisMetric:{id:crypto.randomUUID(),name:'指标',unit:'',formula:'0',minimum:null,maximum:null} satisfies AnalysisMetric,
 analysisVariant:{id:crypto.randomUUID(),name:'方案',overrides:{}} satisfies AnalysisVariant,
 artSource:{id:crypto.randomUUID(),kind:'gameplay',targetId:'',sourceKind:'design',sourceId:'',note:''},artLink:{id:crypto.randomUUID(),requirementId:'',assetId:'',note:''},
 artPaletteColor:{id:crypto.randomUUID(),name:'主色',color:'#7258d9',usage:''},artStyleReference:{id:crypto.randomUUID(),title:'参考',source:'',take:'',avoid:''},artCategoryStyle:{id:'替换为素材分类ID',rules:''},
 functionalDependency:{id:crypto.randomUUID(),fromId:'',toId:'',kind:'call',note:''},functionalUsage:{id:crypto.randomUUID(),gameplayId:'',capabilityId:'',note:'',sourceKind:'design',sourceId:''},functionalConfigReference:{id:crypto.randomUUID(),datasetKey:'',rowId:'',columnKey:'',note:''},
 artStyle:emptyArtStyle(),character:createStoryCharacter('新角色'),gameplayRule:createRule(),gameplayState:createState(),gameplayTransition:createTransition(),
 artLibrary:artLibrary(emptyArtAssets()),productionDoc:{id:crypto.randomUUID(),title:'新制作方案',category:'',content:'',requirementIds:[],assetIds:[],images:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},
 gameplay:createGameplay('新玩法'),coreNode:createCoreNode('activity'),prototypeScene:createPrototypeScene(),prototypeElement:createPrototypeElement('button'),
 system:createFunctionalSystem('新系统'),capability:createCapability('替换为系统ID','新功能'),productionTask:createProductionTask('新任务'),milestone:createProductionMilestone('新里程碑'),
 requirement:createArtRequirement('新素材'),asset:createArtAsset('新资产'),playerTask:createTask('新玩家任务'),taskStage:createTaskStage(),narrative:createNarrative('新故事'),map:createDesignMap(),analysis:newAnalysisPlan(),tool:createDevelopmentTool('新工具'),
 definition:{key:'example',label:'示例表',badge:'配置',columns:[{key:'id',label:'ID'},{key:'name',label:'名称'}]},story:{id:crypto.randomUUID(),title:'新文档',category:'世界观',status:'草稿',updated:'',summary:'',content:'',tags:[],outlines:[],relations:{characters:[],locations:[],systems:[]}},
};}
export function authoringTemplateOptions(){return {modelVersion:contentModelVersion,notes:'模板是单个条目的起始值，不是完整 Schema。替换 ID、补齐引用后运行 validate；字段合法值以同源校验器为准。',enums:{'gameplay.status':gameplayStatuses,'gameplay.checks.result':gameplayResults,'gameplay.stateFlow.states.kind':gameplayStateKinds,'gameplay.dependencies.kind':Object.keys(dependencyKinds),'gameplay.conditionRules.conditions.operator':Object.keys(conditionOperators),'gameplay.space.objects.kind':Object.keys(stageKinds),'gameplay.space.objects.color':Object.keys(stageColors),'gameplay-core.nodes.kind':coreNodeKinds},initialWorkflow:{'gameplay.status':'草稿','gameplay.prototype.done':false,'gameplay.checks.actual':'','gameplay.checks.result':'未测试','project-schedule.tasks.status':'待开始','project-schedule.milestones.status':'计划中','functional-systems.capabilities.status':'待开发','development-tools.tools.status':'待开发','art-assets.requirements.status':'待制作'},paths:{gameplayLoopStep:'/designs/@ID/loop',gameplayPrototypeItem:'/designs/@ID/prototype',gameplayCheck:'/designs/@ID/checks',gameplayDependency:'/designs/@ID/dependencies',gameplayRuleCondition:'/designs/@ID/conditionRules/@ID/conditions',gameplayRuleAction:'/designs/@ID/conditionRules/@ID/actions',gameplayTimelineTrack:'/designs/@ID/timeline/tracks',gameplayTimelineEvent:'/designs/@ID/timeline/events',coreEdge:'/graphs/@ID/edges'}};}

type Archives=ProjectPackageDocument['archives'];
type Proposal={operations:{id:string;module:string;path:string}[]};
function checkArchives(archives:Archives,scope:string,operations:Proposal['operations']=[]) {
 const errors=[];
 for(const module of Object.keys(authoringModules))try{validateContentArchive(module,archives[module as keyof Archives]);}catch(e){errors.push(...authoringError(e,scope,module,operations).diagnostics);}
 if(errors.length)throw authoringError({diagnostics:errors},scope);
 try{validateContentBatch(archives);}catch(e){throw authoringError(e,scope);}
}
/** The offline CLI and desktop preview share this entire candidate validation pipeline. */
export function validateContentChange(proposal:unknown,base:Archives,current:Archives=base,decisions:Record<string,string>={}){
 try{validateAuthoringProposal(proposal);}catch(e){throw authoringError(e,'proposal');}
 const p=proposal as Proposal;
 checkArchives(base,'baseline');if(current!==base)checkArchives(current,'current');
 const result=authoringPreview(proposal,base,current,decisions) as {incoming:Archives;next:Archives;unresolved:number;rows:unknown[]};
 checkArchives(result.incoming,'candidate',p.operations);
 try{assertContentReferences(base,result.incoming);}catch(e){throw authoringError(e,'reference');}
 if(!result.unresolved){checkArchives(result.next,'candidate',p.operations);try{assertContentReferences(current,result.next);}catch(e){throw authoringError(e,'reference');}}
 return result;
}

// Bundle the same validators used by the editor; do not maintain a second permissive write schema.
let empty:ProjectPackageDocument;
export function emptyContentDocument(){
 if(!empty)empty=captureProjectPackage({getItem:()=>null},{id:'content-model',name:'项目',initialContent:'empty',config:{engine:'godot-gdscript',projectPath:'',enumPath:'.',dataPath:'data/generated',outputFormat:'json',autoSync:false,backupBeforeSync:true}} as SavedProject).document;
 return structuredClone(empty);
}
export function validateContentArchive(module:string,value:unknown){
 const document=emptyContentDocument();
 if(!Object.prototype.hasOwnProperty.call(document.archives,module))throw new Error('不支持的项目内容模块');
 const candidate={...document,archives:{...document.archives,[module]:value}};
 validateProjectPackage(candidate);
 return value;
}
