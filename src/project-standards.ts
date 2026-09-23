export * from '../shared/project-standards.mjs';
import {emptyProjectStandards,validateProjectStandards,type ProjectStandardsStore} from '../shared/project-standards.mjs';
export function readProjectStandards(storage:Pick<Storage,'getItem'>,key:string){const raw=storage.getItem(key);return{raw,store:raw===null?emptyProjectStandards():validateProjectStandards(JSON.parse(raw))};}
export function writeProjectStandards(storage:Pick<Storage,'getItem'|'setItem'>,key:string,expected:string|null,store:ProjectStandardsStore){
  const raw=JSON.stringify(validateProjectStandards(store));
  if(storage.getItem(key)!==expected)throw new Error('项目规范已在其他窗口更新，请备份草稿后重新读取');
  storage.setItem(key,raw);return raw;
}
