export type FrameworkDocument = {id:string;path:string;title:string;group:string;kind:'base'|'extension'|'engine'|'reference';content:string};
export const frameworkLibrary:{id:string;version:string;title:string;documents:FrameworkDocument[]};
