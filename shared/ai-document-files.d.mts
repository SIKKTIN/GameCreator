export type DocumentFile = {path:string;content:string};
export function validName(value:unknown,label?:string):string;
export function markdownName(value:string):string;
export function defaultFolderName(projectName:string,date?:Date):string;
export function validateDocumentFiles(input:unknown):{folderName:string;files:DocumentFile[]};
