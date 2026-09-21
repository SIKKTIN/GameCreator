import type {EngineConfig} from './engine';
import type {ArtStore} from './art-assets';
import type {AiDocument} from './ai-export';
import type {SyncSettings} from '../shared/engine-sync.mjs';
export type SyncContext={projectId:string;config:EngineConfig};
export type SyncInput=SyncContext&{settings:SyncSettings;document:AiDocument;art:ArtStore};
export type SyncRow={id:string;path:string;kind:'document'|'asset';label:string;version:string;versionId?:string;placeholder?:boolean;remove?:boolean;status:'added'|'updated'|'removed'|'unchanged'|'conflict';reason:string};
export type SyncHistory={id:string;at:string;status:'success'|'failed';message:string;files:{path:string;action:string;version:string;versionId:string}[];backupDirectory?:string};
export type SyncPlan={token:string;root:string;rows:SyncRow[];warnings:string[];history:SyncHistory[]};
export type EngineSyncAPI={
  preview:(input:SyncInput)=>Promise<SyncPlan>;
  apply:(input:{token:string;decisions:Record<string,'keep'|'replace'>;removals:string[]})=>Promise<SyncHistory>;
  history:(input:SyncContext)=>Promise<{entries:SyncHistory[];interrupted:boolean}>;
  recover:(input:SyncContext)=>Promise<{message:string}>;
  release:(token:string)=>Promise<void>;
};
