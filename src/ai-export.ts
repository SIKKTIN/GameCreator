import {emptyDevelopmentTools,developmentToolsMarkdown,type DevelopmentToolsStore} from './development-tools.ts';
import { markdownName, validateDocumentFiles } from '../shared/ai-document-files.mjs';
import {emptyProgramFramework,programFrameworkMarkdown,type ProgramFrameworkStore} from './program-framework.ts';
import { buildDocumentZip } from './ai-document-zip.ts';
import { emptyNumericalAnalysis, numericalAnalysisMarkdown, type NumericalAnalysisStore } from './numerical-analysis.ts';
import { emptyProjectSchedule, buildScheduleSources, projectScheduleMarkdown, type ProjectScheduleStore } from './project-schedule.ts';
import type { GameplayCategory } from './gameplay-library.ts';
import { emptyMapDesign, mapMarkdown, type MapDesignStore } from './map-design.ts';
import { emptyStoryOrchestration, storyOrchestrationMarkdown, type StoryOrchestrationStore } from './story-orchestration.ts';
import { emptyPrototypeDesign, prototypeMarkdown, type PrototypeDesignStore } from './prototype-design.ts';
import { emptyTaskFlows, taskFlowsMarkdown, type TaskFlowStore } from './task-flow.ts';
import { emptyArtAssets, artAssetsMarkdown, artReferencesMarkdown, type ArtStore } from './art-assets.ts';
import { emptyFunctionalSystems, functionalSystemsMarkdown, gameplayFunctionalMarkdown, type FunctionalStore } from './functional-systems.ts';
import { emptyGameplayCore, gameplayCoreMarkdown, type GameplayCoreStore } from './gameplay-core.ts';
import { gameplayMarkdown, type GameplayDesign } from './gameplay.ts';
import type { EngineConfig } from './engine';
import type { EnumRegistry } from './useEnumRegistry';
import type { DatasetDef, ProjectData } from './data-model';

type ExportProject = { name: string; genre: string; platform: string; version: string; status: string; description: string };
type ExportStory = { archived?:boolean;format?:'plain'|'markdown';references?:{kind:string;targetId:string;label:string}[]; id: string; title: string; category: string; status: string; summary: string; content: string; tags: string[]; outlines: string[]; relations: { characters: string[]; locations: string[]; systems: string[] } };
const bullets = (items: string[]) => items.length ? items.map((item) => `- ${item}`).join('\n') : '- 无';
const table = (headers: string[], rows: string[][]) => [
  `| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.map((cell) => String(cell).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`),
].join('\n');

export function buildAiDocument(project: ExportProject, stories: ExportStory[], data: ProjectData, definitions: DatasetDef[], config: EngineConfig, registry: EnumRegistry, gameplay: GameplayDesign[] = [], functional: FunctionalStore = emptyFunctionalSystems(), art: ArtStore = emptyArtAssets(), core: GameplayCoreStore = emptyGameplayCore(), prototype: PrototypeDesignStore = emptyPrototypeDesign(), tasks: TaskFlowStore = emptyTaskFlows(), narrative: StoryOrchestrationStore = emptyStoryOrchestration(), maps: MapDesignStore = emptyMapDesign(), categories: GameplayCategory[] = [], schedule: ProjectScheduleStore = emptyProjectSchedule(), analysis: NumericalAnalysisStore = emptyNumericalAnalysis(), framework: ProgramFrameworkStore = emptyProgramFramework(), tools: DevelopmentToolsStore = emptyDevelopmentTools()) {
  const sections: AiSection[] = [];
  const add=(id:AiModuleId,body:string,empty=false)=>sections.push({id,label:aiModules.find(m=>m.id===id)!.label,body:body.trim()+(empty?'\n\n暂无内容。':'')});
  add('overview', ['## 项目概览','',`- 类型：${project.genre}`,`- 平台：${project.platform}`,`- 版本：${project.version}`,`- 状态：${project.status}`,'',project.description].join('\n'));
  add('engine',['## 引擎配置','',table(['配置项','值'],[['引擎',config.engine],['工程目录',config.projectPath],['枚举目录',config.enumPath],['数据目录',config.dataPath],['输出格式',config.outputFormat],['自动同步',String(config.autoSync)]])].join('\n'));
  const scan=registry.scan;
  add('enum-versions',['## 稳定枚举版本','',`- 稳定版本：${registry.active?.id??'未建立'}`,`- 来源：${scan?scan.projectPath+'/'+scan.enumPath:'未配置'}`,`- 文件：${scan?.counts.files??0}`,`- 枚举组：${scan?.counts.groups??0}`,`- 成员：${scan?.counts.members??0}`,'','本章节记录已发布版本，未发布的枚举改动不计入配置依据。'].join('\n'));
  const enums=['## 枚举定义',''];
  for (const group of scan?.groups??[]) enums.push(`### ${group.name}`,'',group.comment?`> ${group.comment}`:'',table(['键','值','来源','注释'],group.members.map(member=>[member.key,String(member.value),`${group.source}:${member.line}`,member.comment||''])),'');
  if(scan?.dynamic.length)enums.push('### 动态 ID 提示','',bullets(scan.dynamic.map(item=>`${item.name}（${item.source}:${item.line}）：${item.detail}`)),'');
  add('enum-definitions',enums.join('\n'),!scan?.groups.length&&!scan?.dynamic.length);
  const functionalSources = { designs: gameplay, data, definitions };
  const artSources = { designs: gameplay, functional };
  add('schedule',projectScheduleMarkdown(schedule,buildScheduleSources(gameplay,functional,art,maps,prototype,tools)),!schedule.tasks.length&&!schedule.milestones.length);
  add('core',gameplayCoreMarkdown(core,gameplay),!core.graphs.length);
  add('prototype',prototypeMarkdown(prototype),!prototype.scenes.length);
  add('gameplay',gameplayMarkdown(gameplay,{stories,datasets:definitions},d=>gameplayFunctionalMarkdown(d.id,functional,functionalSources)+'\n'+artReferencesMarkdown('gameplay',d.id,art,artSources),categories),!gameplay.length);
  add('functional',functionalSystemsMarkdown(functional,functionalSources,c=>artReferencesMarkdown('capability',c.id,art,artSources)),!functional.systems.length&&!functional.capabilities.length);
  add('development-tools',developmentToolsMarkdown(tools),!tools.tools.length);
  add('art',artAssetsMarkdown(art,artSources),!art.requirements.length&&!art.assets.length);
  add('tasks',taskFlowsMarkdown(tasks,{designs:gameplay,capabilities:functional.capabilities.map(c=>({...c,archived:c.archived||!!functional.systems.find(s=>s.id===c.systemId)?.archived})),stories,assets:art.assets,definitions,data}),!tasks.tasks.length);
  if(narrative.enabled)add('narrative',storyOrchestrationMarkdown(narrative),!narrative.stories.length&&!narrative.characters?.length);
  if(maps.enabled)add('maps',mapMarkdown(maps,gameplay),!maps.maps.length);
  const lines=['## 故事文档',''];
  for (const story of stories) lines.push(`### ${story.title}`, '', `- 分类：${story.category}`, `- 归档：${story.archived?'是':'否'}`,`- 正文格式：${story.format||'plain'}`,`- 条目引用：${(story.references||[]).map(r=>r.kind+' / '+r.label+' ('+r.targetId+')').join('；')||'无'}`, `- 状态：${story.status}`, '', story.summary, '', story.content, '', `标签：${story.tags.join('、')}`, '', `大纲：${story.outlines.join('、')}`, '');
  add('stories',lines.join('\n'),!stories.length);
  add('analysis',numericalAnalysisMarkdown(analysis,{data,narrative}));
  add('framework',programFrameworkMarkdown(framework,config.engine));
  lines.length=0;lines.push('## 数据配置','');
  for (const definition of definitions) { const rows = (data.datasets[definition.key] ?? []).map((record) => definition.columns.map((column) => String(record[column.key] ?? ''))); lines.push(`### ${definition.label}`, '', table(definition.columns.map((column) => column.label), rows), ''); }
  add('data',lines.join('\n'),!definitions.length);
  sections.sort((a,b)=>aiModules.findIndex(m=>m.id===a.id)-aiModules.findIndex(m=>m.id===b.id));
  return {projectName:project.name,version:project.version,generatedAt:new Date().toISOString(),sections};
}

export const aiModules = [
  {id:'overview',label:'项目概览'}, {id:'schedule',label:'项目排期'}, {id:'core',label:'玩法核心'},
  {id:'gameplay',label:'玩法设计'}, {id:'prototype',label:'原型设计'}, {id:'maps',label:'地图设计'},
  {id:'functional',label:'功能系统'}, {id:'development-tools',label:'开发工具'}, {id:'framework',label:'程序框架'}, {id:'art',label:'素材资产'}, {id:'stories',label:'故事文档'},
  {id:'narrative',label:'故事编排'}, {id:'data',label:'数据配置'}, {id:'enum-definitions',label:'枚举定义'},
  {id:'enum-versions',label:'枚举管理'}, {id:'engine',label:'引擎设置'}, {id:'tasks',label:'任务与流程'},
  {id:'analysis',label:'数值分析'},
] as const;
export type AiModuleId = typeof aiModules[number]['id'];
export type AiSection = {id:AiModuleId;label:string;body:string};
export type AiDocument = {projectName:string;version:string;generatedAt:string;sections:AiSection[]};
export type AiExportNames = {folderName:string;summaryName:string;moduleNames:Partial<Record<AiModuleId,string>>};
const heading=(doc:AiDocument,title:string)=>`# ${doc.projectName}：${title}\n\n> 项目版本：${doc.version||'未填写'}\n> 生成时间：${doc.generatedAt}\n> 本文件由 GameCreator 本地客户端生成，供 AI 检索和协作使用。\n\n`;
export function buildAiMarkdown(...args:Parameters<typeof buildAiDocument>) {
  const doc=buildAiDocument(...args);
  return heading(doc,'AI 项目上下文')+doc.sections.map(s=>s.body).join('\n\n')+'\n';
}
export function buildAiDocumentFiles(doc:AiDocument,names:AiExportNames) {
  const summaryName=markdownName(names.summaryName),paths=doc.sections.map(s=>'模块/'+markdownName(names.moduleNames[s.id]??s.label));
  const link=(text:string,path:string)=>`[${text}](<${path.split('/').map(encodeURIComponent).join('/')}>)`;
  const contents='## 模块文档目录\n\n'+doc.sections.map((s,i)=>'- '+link(s.label,paths[i])).join('\n')+'\n\n';
  return validateDocumentFiles({folderName:names.folderName,files:[
    {path:summaryName,content:heading(doc,'AI 项目上下文')+contents+doc.sections.map(s=>s.body).join('\n\n')+'\n'},
    ...doc.sections.map((s,i)=>({path:paths[i],content:heading(doc,s.label)+link('返回项目完整文档','../'+summaryName)+'\n\n'+s.body+'\n'})),
  ]});
}
export async function saveAiDocumentFiles(bundle:ReturnType<typeof buildAiDocumentFiles>,directory:string) {
  if(window.desktopClient?.aiDocuments)return window.desktopClient.aiDocuments.exportFolder({...bundle,directory});
  const bytes=buildDocumentZip(bundle.folderName,bundle.files),blob=new Blob([bytes],{type:'application/zip'}),url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;link.download=bundle.folderName+'.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  return {directory:bundle.folderName+'.zip',fileCount:bundle.files.length,token:''};
}
