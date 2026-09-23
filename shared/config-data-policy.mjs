import {frameworkLibrary} from './program-framework-library.mjs';
import {dataDirectory} from './data-sync.mjs';

export const policyExportPath = '模块/config-data-policy.md';
export const policySyncPath = 'config-data-policy.md';
export function configDataPolicyMarkdown(config) {
  const document = frameworkLibrary.documents.find(d => d.id === 'config-data-policy');
  if (!document) throw new Error('缺少配置数据管理与同步规范');
  let directory = '', invalid = '';
  try {directory = dataDirectory(config.dataPath);} catch {invalid = '未配置或目录无效，请在数据同步中设置后重新生成。';}
  const root = String(config.projectPath || '').trim().replaceAll('\\','/').replace(/\/+$/, '');
  const escape = value => String(value).replaceAll('|','\\|').replace(/[\r\n]/g,' ');
  const rows = [
    ['引擎',config.engine || '未配置'], ['工程根目录',root || '未连接工程'],
    ['数据相对目录',directory || invalid], ['配置落点',root && directory ? root + '/' + directory : '尚未确定，不得猜测路径'],
    ['项目输出格式',config.outputFormat || '未设置'],
    ['当前数据同步能力',config.outputFormat === 'json' ? 'JSON；直接读取指定目录，不递归扫描子目录' : '仅支持 JSON；当前格式不适用于数据同步，请调整设置后重新生成'],
    ['规范适用范围','本项目纳入 GameCreator 数据同步管理的配置文件；不包含运行状态、玩家存档、缓存或素材资源'],
  ];
  const body = document.content.replace('[返回目录](../README.md)\n','').replace(/^# 配置数据管理与同步规范\n/, '').trim();
  return '# 配置数据管理与同步规范\n\n## 当前项目目录约定\n\n| 配置项 | 当前保存值 |\n| --- | --- |\n' + rows.map(([key,value]) => '| '+key+' | '+escape(value)+' |').join('\n') + '\n\n以上为生成时的设置快照。目录是否存在、资源是否已同步及程序是否已加载，需要实际验证。\n\n' + body + '\n';
}
