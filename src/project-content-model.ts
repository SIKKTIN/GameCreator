import {captureProjectPackage,validateProjectPackage,type ProjectPackageDocument} from './project-package.ts';
import type {SavedProject} from './project-catalog.ts';
import {createGameplay} from './gameplay.ts';
import {createCoreNode} from './gameplay-core.ts';
import {createPrototypeScene,createPrototypeElement} from './prototype-design.ts';
import {createFunctionalSystem,createCapability} from './functional-systems.ts';
import {createProductionTask,createProductionMilestone} from './project-schedule.ts';
import {createArtRequirement,createArtAsset} from './art-assets.ts';
import {createTask,createTaskStage} from './task-flow.ts';
import {createNarrative} from './story-orchestration.ts';
import {createDesignMap} from './map-design.ts';
import {newAnalysisPlan} from './numerical-analysis.ts';
import {createDevelopmentTool} from '../shared/development-tools.mjs';
import {emptyArtStyle} from '../shared/art-style.mjs';
import {createStoryCharacter} from './story-characters.ts';
import {createRule,createState,createTransition} from './gameplay-structure.ts';
import {artLibrary} from './art-library.ts';
import {emptyArtAssets} from './art-assets.ts';
export {validModuleGrants} from '../shared/project-authoring.mjs';
export {authoringModules,moduleGrants,authoringPreview,canonical,validateAuthoringProposal} from '../shared/project-authoring.mjs';
export {assertContentReferences} from '../shared/authoring-references.mjs';
export {gamecreatorGuide,guideVersion} from '../shared/gamecreator-guide.mjs';
export {captureProjectPackage} from './project-package.ts';
export function validateContentBatch(archives:ProjectPackageDocument['archives']) {return validateProjectPackage({...emptyContentDocument(),archives});}
export function authoringTemplates(){return {
 artStyle:emptyArtStyle(),character:createStoryCharacter('新角色'),gameplayRule:createRule(),gameplayState:createState(),gameplayTransition:createTransition(),
 artLibrary:artLibrary(emptyArtAssets()),productionDoc:{id:crypto.randomUUID(),title:'新制作方案',category:'',content:'',requirementIds:[],assetIds:[],images:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},
 gameplay:createGameplay('新玩法'),coreNode:createCoreNode('activity'),prototypeScene:createPrototypeScene(),prototypeElement:createPrototypeElement('button'),
 system:createFunctionalSystem('新系统'),capability:createCapability('替换为系统ID','新功能'),productionTask:createProductionTask('新任务'),milestone:createProductionMilestone('新里程碑'),
 requirement:createArtRequirement('新素材'),asset:createArtAsset('新资产'),playerTask:createTask('新玩家任务'),taskStage:createTaskStage(),narrative:createNarrative('新故事'),map:createDesignMap(),analysis:newAnalysisPlan(),tool:createDevelopmentTool('新工具'),
 definition:{key:'example',label:'示例表',badge:'配置',columns:[{key:'id',label:'ID'},{key:'name',label:'名称'}]},story:{id:crypto.randomUUID(),title:'新文档',category:'世界观',status:'草稿',updated:'',summary:'',content:'',tags:[],outlines:[],relations:{characters:[],locations:[],systems:[]}},
};}

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
