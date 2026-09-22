export type SyncSettings={documents:boolean;assets:boolean;collaboration:boolean;includePlaceholders:boolean;docsDirectory:string;assetsDirectory:string;modules:string[]};
export const defaultSyncSettings:SyncSettings;
export function syncPath(value:unknown):string;
export function syncSettings(value:unknown):SyncSettings;
export type SyncDocument={id:string;path:string;content:string};
export function syncDocuments(document:import('../src/ai-export').AiDocument,modules:string[]):SyncDocument[];
export function adoptedSyncAssets(store:import('../src/art-assets').ArtStore,includePlaceholders:boolean):{assets:{id:string;name:string;versionId:string;versionName:string;placeholder:boolean;files:import('../src/art-assets').ArtFile[]}[];warnings:string[]};
