import type {ProjectScheduleStore,ProductionTask} from '../src/project-schedule.ts';
import type {AiMember} from './ai-personnel.mjs';
export function assertDispatch(schedule:ProjectScheduleStore,fromId:string,toId:string,taskId:string):{from:AiMember;to:AiMember;task:ProductionTask};
export function dispatchTask(schedule:ProjectScheduleStore,fromId:string,toId:string,taskId:string,id:string,at?:string):ProjectScheduleStore;
export function taskInbox(schedule:ProjectScheduleStore,memberId?:string):{tasks:ProductionTask[];reviews:ProductionTask[];dispatched:ProductionTask[];proposals:(NonNullable<ProductionTask['proposals']>[number]&{taskId:string;title:string})[]};
export function inboxMarkdown(schedule:ProjectScheduleStore,memberId?:string):string;
