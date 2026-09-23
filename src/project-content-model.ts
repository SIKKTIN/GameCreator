import {captureProjectPackage,validateProjectPackage,type ProjectPackageDocument} from './project-package.ts';
import type {SavedProject} from './project-catalog.ts';

// Bundle the same validators used by the editor; do not maintain a second permissive write schema.
let empty:ProjectPackageDocument;
export function emptyContentDocument(){
 if(!empty)empty=captureProjectPackage({getItem:()=>null},{id:'content-model',name:'项目',initialContent:'empty',config:{engine:'godot-gdscript',projectPath:'',enumPath:'.',dataPath:'data/generated',outputFormat:'json',autoSync:false,backupBeforeSync:true}} as SavedProject).document;
 return structuredClone(empty);
}
export function validateContentArchive(module:string,value:unknown){
 const document=emptyContentDocument();
 if(!Object.prototype.hasOwnProperty.call(document.archives,module))throw new Error('不支持的项目内容模块');
 const candidate={...document,archives:{...document.archives,[module]:value}};
 validateProjectPackage(candidate);
 return value;
}
