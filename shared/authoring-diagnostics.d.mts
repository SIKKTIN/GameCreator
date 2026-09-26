export type AuthoringDiagnostic={code:string;scope:string;module:string;operationId:string;path:string;message:string;expected?:string;actual?:string};
export function authoringError(error:unknown,scope?:string,module?:string,operations?:{id:string;module:string;path:string}[]):Error & {code:string;scope:string;diagnostics:AuthoringDiagnostic[]};
