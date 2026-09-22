import {readDevelopmentTools} from './development-tools.ts';
import {readProjectSchedule} from './project-schedule.ts';
import {normalizeSchedulePublication,type ScheduleSource} from './team-schedule-model.ts';
import {initialMilestones} from './project-defaults.ts';
import type {SavedProject} from './project-catalog.ts';
import {readGameplay} from './gameplay.ts';
import {readFunctionalSystems} from './functional-systems.ts';
import {readArtAssets} from './art-assets.ts';
import {readMapDesign} from './map-design.ts';
import {readPrototypeDesign} from './prototype-design.ts';

export function readLocalSchedule(storage:Pick<Storage,'getItem'>,project:SavedProject) {
  const prefix=`gamecreator.workspace.v1:${project.id}:`,store=readProjectSchedule(storage,prefix+'project-schedule',prefix+'milestones',project.initialContent==='legacy'?initialMilestones:[]).store;
  const used=new Set(store.tasks.flatMap(t=>t.references.map(r=>r.kind))),references:ScheduleSource[]=[];
  if(used.has('gameplay'))references.push(...readGameplay(storage,prefix+'gameplay').store.designs.map(d=>({kind:'gameplay' as const,targetId:d.id,name:d.title})));
  if(used.has('tool'))references.push(...readDevelopmentTools(storage,prefix+'development-tools').store.tools.map(t=>({kind:'tool' as const,targetId:t.id,name:t.name})));
  if(used.has('capability'))references.push(...readFunctionalSystems(storage,prefix+'functional-systems').store.capabilities.map(c=>({kind:'capability' as const,targetId:c.id,name:c.name})));
  if(used.has('requirement')||used.has('asset')){const art=readArtAssets(storage,prefix+'art-assets').store;references.push(...art.requirements.map(r=>({kind:'requirement' as const,targetId:r.id,name:r.name})),...art.assets.map(a=>({kind:'asset' as const,targetId:a.id,name:a.name})));}
  if(used.has('map'))references.push(...readMapDesign(storage,prefix+'map-design').store.maps.map(m=>({kind:'map' as const,targetId:m.id,name:m.name})));
  if(used.has('prototype'))references.push(...readPrototypeDesign(storage,prefix+'prototype-design').store.scenes.map(s=>({kind:'prototype' as const,targetId:s.id,name:s.name})));
  const schedule=normalizeSchedulePublication({store,references});return {schedule,signature:JSON.stringify(schedule)};
}
