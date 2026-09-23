import type {VersionStore} from './enum-versions';
import type {SyncContext} from './engine-sync';
import type {Canonical,DataDifference,DataSyncHistory,Decision,JsonFormat} from '../shared/data-sync.mjs';
export type DataSyncFile={table:string;file:string;error?:string;mapping?:Record<string,string>;shape?:JsonFormat['shape'];local?:Canonical;remote?:Canonical;differences?:DataDifference[];bound?:boolean;localChanged?:boolean;engineChanged?:boolean;fields?:{local:string[];remote:string[]}};
export type DataSyncPlan={token:string;rows:DataSyncFile[];history:DataSyncHistory[];directory:string};
export type DataSyncInput=SyncContext&{store:VersionStore;direction:'import'|'export';mappings?:Record<string,Record<string,string>>};
export type DataSyncAPI={
 dataSchemaExport:(input:SyncContext&{store:VersionStore})=>Promise<{path:string;tables:number}>;
 dataPublish:(input:{token:string;version:string;note:string;verified:boolean})=>Promise<{version:string}>;
 dataPreview:(input:DataSyncInput)=>Promise<DataSyncPlan>;
 dataApply:(input:{token:string;selections:{table:string;decisions?:Record<string,Decision>}[];automatic?:boolean})=>Promise<DataSyncHistory>;
 dataRecover:(input:SyncContext)=>Promise<{message:string}>;
 dataUndo:(input:SyncContext)=>Promise<{message:string}>;
 dataRelease:(token:string)=>Promise<void>;
};
