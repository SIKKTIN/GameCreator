import type {ProjectScheduleStore,ProductionTask} from '../src/project-schedule.ts';
export type AiPermission='progress'|'review'|'propose'|'spec_change'|'project_write';
export type AiDeveloperProfile={projectModules?:string[];positionIds:string[];taskIds:string[];scope:'assigned'|'positions'|'project';expiresAt:string};
export type AiMember={developer?:AiDeveloperProfile;id:string;name:string;roles:string[];duties:string;active:boolean;scope:'project'|'assigned';permissions:AiPermission[];createdAt:string};
export type AiAssignment={primaryId:string;collaboratorIds:string[];reviewerId:string};
export type AiPosition={id:string;name:string;duties:string;active:boolean;taskKinds:string[]};
export type AiCredential={persistent?:true;positionIds?:string[];workDescription?:string;id:string;projectId:string;memberId:string;name:string;publicKey:string;permissions:AiPermission[];taskIds:string[];createdAt:string;expiresAt:string;revokedAt:string};
export type AiPersonnel={positionPreset?:PositionPresetId;positions?:AiPosition[];schema:1;members:AiMember[];credentials:AiCredential[]};
export const aiRoles:string[];
export const aiPermissionLabels:Record<AiPermission,string>;
export function nextAiName(members:AiMember[],role:string):string;
export function newAiMember(members:AiMember[],role?:string):AiMember;
export function defaultAiTeam():AiPersonnel;
export function taskAssignment(task:ProductionTask):AiAssignment;
export function memberTasks(schedule:ProjectScheduleStore,id:string):ProductionTask[];
export function normalizePersonnelSchedule(schedule:ProjectScheduleStore):ProjectScheduleStore;
export function suggestAssignments(schedule:ProjectScheduleStore):{taskId:string;memberId:string;reason:string}[];
export function applyAssignments(schedule:ProjectScheduleStore,assignments:{taskId:string;memberId:string}[]):ProjectScheduleStore;
export function personnelMarkdown(schedule:ProjectScheduleStore,onlyMemberId?:string):string;

export function defaultAiPositions():AiPosition[];
export function defaultWorkTeam():AiPersonnel;
export function positionsOf(schedule:ProjectScheduleStore):AiPosition[];
export function taskPositionIds(schedule:ProjectScheduleStore,task:ProductionTask):string[];
export function positionTasks(schedule:ProjectScheduleStore,positionId:string):ProductionTask[];
export function credentialTasks(schedule:ProjectScheduleStore,key:AiCredential):ProductionTask[];
export function workAssignees(schedule:ProjectScheduleStore,taskId:string,projectId?:string):AiCredential[];
export function positionsMarkdown(schedule:ProjectScheduleStore):string;
export function credentialMarkdown(schedule:ProjectScheduleStore,key:AiCredential):string;

export type DeveloperInput={projectId:string;credentialId?:string;memberId?:string;schedule?:ProjectScheduleStore;name?:string;duties?:string;permissions?:AiPermission[];active?:boolean;profile?:AiDeveloperProfile};
export function credentialExpiry(schedule:ProjectScheduleStore,key:AiCredential):string;
export function credentialState(schedule:ProjectScheduleStore,key:AiCredential,projectId:string):string;
export function developerMayAccess(schedule:ProjectScheduleStore,member:AiMember,task:ProductionTask):boolean;

export type PositionPresetId='basic'|'production';
export const positionPresets:{id:PositionPresetId;name:string;count:number;description:string}[];
export function presetPositions(id:PositionPresetId):AiPosition[];
export function positionPresetState(schedule:ProjectScheduleStore):{id:PositionPresetId;customized:boolean};
export function previewPositionPreset(schedule:ProjectScheduleStore,id:PositionPresetId):{changes:{id:string;before?:AiPosition;after:AiPosition}[];taskChanges:{taskId:string;title:string;from:string[];to:string[]}[];affectedDevelopers:string[];affectedCredentials:number;next:ProjectScheduleStore};

export function legacyRolePositionIds(schedule:ProjectScheduleStore,roles:string[]):string[];
