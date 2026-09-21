import type {StoryDoc,StoryReference} from './story-model';
import type {StoryTarget} from './story-library';
import type {GameplayStore} from './gameplay';
import type {FunctionalStore} from './functional-systems';
import type {ArtStore} from './art-assets';
import type {MapDesignStore} from './map-design';
import type {StoryOrchestrationStore} from './story-orchestration';
import type {TaskFlowStore} from './task-flow';
type Sources={stories:StoryDoc[];gameplay?:GameplayStore;functional?:FunctionalStore;art?:ArtStore;maps?:MapDesignStore;narrative?:StoryOrchestrationStore;tasks?:TaskFlowStore};
export function storyTargets(s:Sources):StoryTarget[]{const out:StoryTarget[]=[];const add=(kind:StoryReference['kind'],targetId:string,label:string,unavailable=false)=>out.push({kind,targetId,label,unavailable});
 s.stories.forEach(d=>add('story',d.id,d.title));s.gameplay?.designs.forEach(d=>add('gameplay',d.id,d.title));s.functional?.capabilities.forEach(d=>add('capability',d.id,d.name));s.art?.requirements.forEach(d=>add('requirement',d.id,d.name));s.art?.assets.forEach(d=>add('asset',d.id,d.name));s.maps?.maps.forEach(d=>add('map',d.id,d.name,!s.maps?.enabled));s.narrative?.stories.forEach(d=>add('narrative',d.id,d.title,!s.narrative?.enabled));s.narrative?.characters?.forEach(d=>add('character',d.id,d.name,!s.narrative?.enabled));s.tasks?.tasks.forEach(d=>add('task',d.id,d.title));return out;}
export function incomingStories(s:Sources,id:string):StoryTarget[]{const all=storyTargets(s),result:StoryTarget[]=[];const add=(kind:StoryReference['kind'],targetId:string)=>{const t=all.find(t=>t.kind===kind&&t.targetId===targetId);if(t&&!result.some(r=>r.kind===kind&&r.targetId===targetId))result.push(t);};
 s.stories.filter(d=>d.references?.some(r=>!r.sourceOnly&&r.kind==='story'&&r.targetId===id)).forEach(d=>add('story',d.id));s.gameplay?.designs.filter(d=>d.links.some(r=>r.kind==='story'&&r.targetId===id)).forEach(d=>add('gameplay',d.id));s.maps?.maps.filter(d=>d.objects.some(o=>o.references.some(r=>r.kind==='story'&&r.targetId===id))).forEach(d=>add('map',d.id));s.tasks?.tasks.filter(d=>d.references.some(r=>r.kind==='story'&&r.targetId===id)).forEach(d=>add('task',d.id));return result;}
