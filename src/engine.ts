import { workspaceStorage } from './workspace-storage.ts';
export type EngineConfig = { engine: string; projectPath: string; enumPath: string; dataPath: string; outputFormat: string; autoSync: boolean; backupBeforeSync: boolean };

export const defaultEngineConfig: EngineConfig = {
  engine: 'oasis-lua',
  projectPath: 'E:/WeGameApps/rail_apps/OasisEraEditor(2001776)/ShadowTrackerExtra/UGCProjects/Withdraw',
  enumPath: 'Script/Const',
  dataPath: 'Scripts/Configs',
  outputFormat: 'lua',
  autoSync: false,
  backupBeforeSync: true,
};

const STORAGE_KEY = 'gamecreator.engine-config.v1';
export function loadEngineConfig(): EngineConfig {
  try {
    const raw = workspaceStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaultEngineConfig, ...JSON.parse(raw) } : defaultEngineConfig;
  } catch { return defaultEngineConfig; }
}
export function persistEngineConfig(config: EngineConfig) {
  workspaceStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export type EnumMember = { key: string; value: string | number; line: number; comment: string };
export type EnumGroup = { name: string; source: string; line: number; valueType: string; members: EnumMember[]; comment: string };
export type EnumScan = { projectPath: string; enumPath: string; files: string[]; groups: EnumGroup[]; orderTables: { name: string; source: string; keys: string[]; detail: string }[]; dynamic: { name: string; source: string; line: number; detail: string }[]; counts: { files: number; groups: number; members: number } };

export async function scanEngineProject(config: EngineConfig, signal?: AbortSignal): Promise<EnumScan> {
  if (!config.projectPath.trim() || !config.enumPath.trim()) throw new Error('请先在引擎设置中配置工程和枚举目录');
  const query = new URLSearchParams({ projectPath: config.projectPath, enumPath: config.enumPath });
  const response = await fetch(`/api/engine/scan?${query}`, { signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? '本地工程连接失败，请确认已通过 Vite 启动开发服务。');
  if (!Array.isArray(payload.groups) || !Array.isArray(payload.files) || !Array.isArray(payload.orderTables) || !Array.isArray(payload.dynamic)) {
    throw new Error('工程扫描接口返回无效结果，请确认本地服务已启动。');
  }
  return payload as EnumScan;
}
