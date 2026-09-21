import fs from 'node:fs/promises';
import path from 'node:path';
import {engineInfo,relativeEnginePath} from '../shared/engine-config.mjs';
import {scanConstDirectory} from './lua-enum-parser.mjs';
import {scanGodotEnums} from './godot-enum-parser.mjs';
export async function validateEngineProject(projectPath,enumPath,engine='oasis-lua') {
 engineInfo(engine);if(typeof projectPath!=='string'||!projectPath.trim()||!path.isAbsolute(projectPath.trim()))throw new Error('请选择或输入完整的工程目录');
 const project=await fs.realpath(projectPath.trim()).catch(()=>{throw new Error('工程目录不存在或无法访问');});if(!(await fs.stat(project)).isDirectory())throw new Error('项目目录必须是文件夹');
 if(typeof enumPath!=='string')throw new Error('枚举目录无效');const sub=relativeEnginePath(enumPath,engine);if(!sub||path.isAbsolute(sub)||/^[A-Za-z]:/.test(sub))throw new Error('枚举目录必须是工程内的相对路径');
 const target=path.resolve(project,sub),relativeTarget=path.relative(project,target);if(relativeTarget==='..'||relativeTarget.startsWith('..'+path.sep)||path.isAbsolute(relativeTarget))throw new Error('枚举目录必须位于工程目录内');let actual;try{actual=await fs.realpath(target);}catch(e){if(e.code!=='ENOENT')throw e;}
 if(actual){const relative=path.relative(project,actual);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('枚举目录必须位于工程目录内');}
 if(engine==='godot-gdscript') {const marker=await fs.readFile(path.join(project,'project.godot'),'utf8').catch(()=>{throw new Error('未找到 project.godot，请选择 Godot 工程根目录');});const version=/^config_version\s*=\s*(\d+)/m.exec(marker);if(version&&Number(version[1])<5)throw new Error('当前支持 Godot 4.x，请升级工程后连接');}
 return {projectPath:project,enumPath:path.relative(project,target).replaceAll('\\','/')||'.'};
}
export async function scanEngineDirectory(projectPath,enumPath,engine='oasis-lua') {const location=await validateEngineProject(projectPath,enumPath,engine);const scan=engine==='godot-gdscript'?await scanGodotEnums(location.projectPath,location.enumPath):await scanConstDirectory(location.projectPath,location.enumPath);return {...scan,engine};}
