export const engines = {
  'oasis-lua': {name:'绿洲启元 · Lua',language:'Lua',extension:'.lua',enumPath:'Script/Const',dataPath:'Script/Config',outputFormat:'lua'},
  'godot-gdscript': {name:'Godot 4 · GDScript',language:'GDScript',extension:'.gd',enumPath:'.',dataPath:'data/generated',outputFormat:'json'},
};
export function engineInfo(id='oasis-lua') { if(!Object.prototype.hasOwnProperty.call(engines,id))throw new Error('不支持的引擎：'+id);return engines[id]; }
export function relativeEnginePath(value,engine='oasis-lua') {const path=value.trim().replaceAll('\\','/');return engine==='godot-gdscript'&&path.startsWith('res://')?path.slice(6)||'.':path;}
export function validateEngineConfig(config) {
 if(!config||typeof config!=='object')throw new Error('引擎配置无效');
 const check=(profile,id)=>{const info=engineInfo(id);if(!profile||['projectPath','enumPath','dataPath','outputFormat'].some(k=>typeof profile[k]!=='string')||typeof profile.autoSync!=='boolean'||typeof profile.backupBeforeSync!=='boolean'||id==='godot-gdscript'&&profile.outputFormat!==info.outputFormat)throw new Error('引擎目录或输出格式无效');};
 check(config,config.engine);
 if(config.profiles!==undefined){if(!config.profiles||typeof config.profiles!=='object'||Array.isArray(config.profiles))throw new Error('引擎历史配置无效');for(const [id,p]of Object.entries(config.profiles))check(p,id);}
 return config;
}
export function engineSourceKey(source) {const clean=p=>p.trim().replaceAll('\\','/').replace(/\/+$/,'');return JSON.stringify([source.engine||'oasis-lua',clean(source.projectPath),relativeEnginePath(source.enumPath,source.engine||'oasis-lua').replace(/\/+$/,'')||'.']);}
export function sameEngineSource(a,b) {return !!a&&!!b&&engineSourceKey(a)===engineSourceKey(b);}
export function portableEngineConfig(config) {validateEngineConfig(config);return {...config,projectPath:'',autoSync:false,...(config.profiles?{profiles:Object.fromEntries(Object.entries(config.profiles).map(([id,p])=>[id,{...p,projectPath:'',autoSync:false}]))}:{})};}

export function validateEngineScanMetadata(scan) {
 if(!scan||typeof scan!=='object')throw new Error('枚举来源信息无效');
 if(scan.engine!==undefined)engineInfo(scan.engine);
 if(scan.incomplete!==undefined&&typeof scan.incomplete!=='boolean')throw new Error('枚举扫描完整性信息无效');
 for(const group of scan.groups||[]){if(group.engine!==undefined)engineInfo(group.engine);if(group.engine==='godot-gdscript'&&group.members?.some(m=>!Number.isSafeInteger(m.value)))throw new Error('Godot 枚举值必须为可精确表示的整数');}
}
