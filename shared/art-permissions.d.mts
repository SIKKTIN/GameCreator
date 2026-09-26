import type {AiMember} from './ai-personnel.mjs';
export type ArtPermission='style'|'details'|'technical'|'propose'|'dispatch';
export const artPermissionLabels:Record<ArtPermission,string>;
export function validArtPermissions(value:unknown):boolean;
export function recommendedArtPermissions(ids:string[]):ArtPermission[];
export function artGrants(member?:AiMember):ArtPermission[];
export function assertArtPermission(member:AiMember,before:unknown,after:unknown):void;
export function artPermissionsMarkdown(member:AiMember):string;
