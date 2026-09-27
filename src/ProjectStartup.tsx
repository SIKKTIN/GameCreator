// Kept as the typed compatibility boundary for existing project-startup records and IPC.
import type {AiDocument} from './ai-export';
import type {ArtStore} from './art-assets';
import type {CollaborationSource,SyncPlan,SyncHistory} from './engine-sync';
import type {AuthoringInput} from '../shared/project-authoring.mjs';
import type {SyncSettings} from '../shared/engine-sync.mjs';
export type StartupStatus={engineDirectory:string;projectDirectory:string;entryDirectory:string;docsDirectory:string;initializedAt:string;initializedEntry:string;blockers:string[];members:{id:string;name:string;producer:boolean;credentialId?:string;error:string;path:string}[];plan?:SyncPlan;message?:string;files?:string[];history?:SyncHistory[]};
export type ProjectStartupAPI=(operation:'status'|'preview'|'initialize'|'release'|'history',input:{projectId?:string;entryDirectory?:string;docsDirectory?:string;settings?:SyncSettings;expectedEntries?:AuthoringInput['expectedEntries'];document?:AiDocument;art?:ArtStore;collaboration?:CollaborationSource;token?:string;decisions?:Record<string,'keep'|'replace'>;removals?:string[]})=>Promise<Partial<StartupStatus>>;
