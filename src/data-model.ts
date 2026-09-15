import type { EnumGroup, EnumScan } from './engine';

export type DatasetKey = 'items' | 'characters' | 'skills' | 'economy' | 'shop';
// Bound enum cells store member keys; resolveEnumValue returns the original Lua type.
export type DataRecord = Record<string, string> & { id: string };
export type ColumnDef = {
  key: string; label: string; type?: 'text' | 'enum' | 'reference';
  options?: string[]; enumName?: string; enumId?: string; reference?: DatasetKey;
};
export type DatasetDef = { key: DatasetKey; label: string; badge: string; columns: ColumnDef[] };
export type ProjectData = {
  datasets: Record<DatasetKey, DataRecord[]>;
  columns: Record<DatasetKey, ColumnDef[]>;
};
export type RegistrySnapshot = { scan: EnumScan | null; ready: boolean };

export function projectIdentity(projectPath: string) {
  return projectPath.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function enumId(group: EnumGroup) {
  return group.source.replace(/\\/g, '/').replace(/\.lua$/i, '').replace(/\//g, '.') +
    '#' + group.name.split('.').slice(1).join('.');
}

export function findEnum(column: ColumnDef, registry: RegistrySnapshot) {
  return registry.scan?.groups.find((group) => enumId(group) === column.enumId);
}

export function formatLuaValue(value: string | number) {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

export function resolveEnumValue(column: ColumnDef, key: string, registry: RegistrySnapshot): string | number | undefined {
  if (column.type !== 'enum' || !column.enumId || !registry.ready) return undefined;
  return findEnum(column, registry)?.members.find((member) => member.key === key)?.value;
}

export function enumOptions(column: ColumnDef, registry: RegistrySnapshot) {
  if (column.enumId) return (findEnum(column, registry)?.members ?? []).map((member) => ({
    key: member.key, label: member.key + ' = ' + formatLuaValue(member.value),
  }));
  return (column.options ?? []).map((key) => ({ key, label: key }));
}

export function validateCell(column: ColumnDef, value: string, data: ProjectData, registry: RegistrySnapshot) {
  if (column.type === 'enum') {
    if (column.enumId && !registry.ready) return '枚举定义待同步，暂时无法校验';
    if (column.enumId && !findEnum(column, registry)) return '绑定的枚举已不存在，请重新绑定';
    if (!column.enumId && !column.options?.length) return '请先为字段绑定 Lua 枚举';
  }
  if (!value?.trim() || value === '待配置') return '请填写字段值';
  if (column.type === 'enum' && !enumOptions(column, registry).some((option) => option.key === value)) {
    return '未知枚举成员：' + value + '，请重新选择';
  }
  if (column.type === 'reference' && (!column.reference ||
    !data.datasets[column.reference].some((record) => record.id === value))) return '引用记录不存在：' + value;
  return '';
}

export function validateRow(row: DataRecord, columns: ColumnDef[], data: ProjectData, registry: RegistrySnapshot) {
  return columns.map((column) => ({ column, message: validateCell(column, row[column.key], data, registry) }))
    .filter((issue) => issue.message);
}
