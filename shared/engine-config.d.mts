export type EngineProfile={projectPath:string;enumPath:string;dataPath:string;outputFormat:string;autoSync:boolean;backupBeforeSync:boolean};
export type EngineSettings=EngineProfile & {engine:string;profiles?:Record<string,EngineProfile>};
export type EngineSource={engine?:string;projectPath:string;enumPath:string};
export const engines:Record<string,{name:string;language:string;extension:string;enumPath:string;dataPath:string;outputFormat:string}>;
export function engineInfo(id?:string):typeof engines[string];
export function relativeEnginePath(value:string,engine?:string):string;
export function validateEngineConfig<T extends EngineSettings>(config:T):T;
export function engineSourceKey(source:EngineSource):string;
export function sameEngineSource(a:EngineSource|null|undefined,b:EngineSource|null|undefined):boolean;
export function portableEngineConfig<T extends EngineSettings>(config:T):T;

export function validateEngineScanMetadata(scan:unknown):void;
