export {frameworkLibrary} from '../shared/program-framework-library.mjs';
export type {FrameworkDocument} from '../shared/program-framework-library.mjs';
export {frameworkExtensions,emptyProgramFramework,validateProgramFramework,adoptedFrameworkDocuments,programFrameworkMarkdown,resolveFrameworkLink} from '../shared/program-framework.mjs';
export type {ProgramFrameworkStore} from '../shared/program-framework.mjs';

import {emptyProgramFramework,validateProgramFramework,type ProgramFrameworkStore} from '../shared/program-framework.mjs';
type StorageLike=Pick<Storage,'getItem'|'setItem'>;
export function readProgramFramework(storage:StorageLike,key:string){
  const raw=storage.getItem(key);return {raw,store:raw===null?emptyProgramFramework():validateProgramFramework(JSON.parse(raw))};
}
export function writeProgramFramework(storage:StorageLike,key:string,previous:string|null,store:ProgramFrameworkStore){
  const raw=JSON.stringify(validateProgramFramework(store));
  if(storage.getItem(key)!==previous)throw new Error('程序框架已在其他窗口更新，请先导出草稿，再重新读取');
  storage.setItem(key,raw);return raw;
}
