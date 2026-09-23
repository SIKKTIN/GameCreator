export type StandardsSources={gameplay?:unknown;core?:unknown;functional?:unknown;schedule?:unknown};
export type StandardsIssue={severity:'error'|'warning';module:string;id:string;message:string};
export function checkProjectStructure(sources:StandardsSources):StandardsIssue[];
