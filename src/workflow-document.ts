import {buildAiDocument} from './ai-export';
import type {ProjectPackageDocument} from './project-package';
import type {EngineConfig} from './engine';
import type {EnumRegistry} from './useEnumRegistry';

// Use the same document builders for UI exports and authenticated workflow tools.
export function workflowDocument(a:ProjectPackageDocument['archives'],config:EngineConfig){
 const versions=a['enum-versions'],active=versions.snapshots.find(s=>s.id===versions.activeId);
 return buildAiDocument(a.project,a.stories,versions.data,a.definitions,config,{active,scan:active?.scan} as EnumRegistry,
  a.gameplay.designs,a['functional-systems'],a['art-assets'],a['gameplay-core'],a['prototype-design'],a['task-flows'],a['story-orchestration'],a['map-design'],a.gameplay.categories||[],a['project-schedule'],a['numerical-analysis'],a['program-framework'],a['development-tools'],a['project-standards']);
}
