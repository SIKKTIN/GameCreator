import type {ProjectData} from '../src/data-model';
import type {VersionStore} from '../src/enum-versions';
import type {EnumScan,EngineConfig} from '../src/engine';
export type DataRelease={id:string;at:string;version:string;note:string;data:ProjectData;scan:EnumScan|null;connection:EngineConfig};
export type DataReleases={schema:1;activeId:string;releases:DataRelease[]};
export function validateDataReleases(store:unknown):void;
export function releaseDiff(data:ProjectData,previous?:ProjectData):{table:string;kind:string;fields:string[];added:number;removed:number;changed:number}[];
export function publishData(store:VersionStore,input:{id:string;at:string;version:string;note:string;verified:boolean;connection:EngineConfig}):VersionStore;
export function restoreDataRelease(store:VersionStore,id:string):VersionStore;
