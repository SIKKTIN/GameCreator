import { emptyPrototypeDesign, validatePrototypeDesign, type PrototypeDesignStore } from './prototype-design.ts';
import { emptyTaskFlows, validateTaskFlows, type TaskFlowStore } from './task-flow.ts';
import { PROJECT_CATALOG_KEY, addSavedProject, validateCatalog, type ProjectCatalog, type SavedProject } from './project-catalog.ts';
import { emptyGameplayCore, validateGameplayCore, type GameplayCoreStore } from './gameplay-core.ts';
import { emptyGameplay, validateGameplay, type GameplayStore } from './gameplay.ts';
import { emptyFunctionalSystems, validateFunctionalSystems, type FunctionalStore } from './functional-systems.ts';
import { emptyArtAssets, validateArtAssets, type ArtStore } from './art-assets.ts';
import { emptyStore, type VersionStore } from './enum-versions.ts';
import { readVersions } from './enum-storage.ts';
import { defaultTableMigrationKey } from './default-table-migration.ts';
import { normalizeDataViewState, type DataViewState } from './data-view-state.ts';
import { datasetDefinitions, initialData, initialMilestones, initialProject, emptyDatasetDefinitions, emptyProjectData, type Milestone } from './project-defaults.ts';
import { initialStoryDocs, type StoryDoc } from './story-model.ts';
import type { EngineConfig } from './engine.ts';
import type { ColumnDef, DatasetDef } from './data-model.ts';

export type ProjectPackageDocument = {
  schema: 1;
  project: { name: string; config: EngineConfig; defaultTablesVersion?: 1 };
  archives: {
    'task-flows': TaskFlowStore; gameplay: GameplayStore; 'gameplay-core': GameplayCoreStore; 'prototype-design': PrototypeDesignStore; 'functional-systems': FunctionalStore; 'art-assets': ArtStore;
    definitions: DatasetDef[]; stories: StoryDoc[]; project: typeof initialProject;
    milestones: Milestone[]; 'enum-versions': VersionStore; 'data-view'?: DataViewState;
  };
};
export type ProjectPackageSnapshot = {
  document: ProjectPackageDocument;
  expectedEntries: { key: string; value: string | null }[];
};
export type PreparedProjectPackageImport = {
  catalog: ProjectCatalog; project: SavedProject; entries: { key: string; value: string }[]; defaultTablesVersion?: 1;
};
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export const projectPackageSections = ['task-flows', 'gameplay', 'gameplay-core', 'prototype-design', 'functional-systems', 'art-assets', 'definitions', 'stories', 'project', 'milestones', 'enum-versions'] as const;
const workspaceKey = (id: string, section: string) => section === 'enum-versions' ? 'gamecreator.enum-versions.v1:' + id : 'gamecreator.workspace.v1:' + id + ':' + section;
const completedDefaultTableMigration = JSON.stringify({ schema: 1, state: 'done', removed: [] });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const fields = (value: Record<string, unknown>, keys: string[]) => keys.every(key => typeof value[key] === 'string');
const safeKey = (key: string) => !!key && !['__proto__', 'constructor', 'prototype'].includes(key);
function requireValid(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error('项目文件夹内容无效：' + detail);
}
function unique(items: unknown, key: string, label: string): asserts items is Record<string, unknown>[] {
  requireValid(Array.isArray(items), label + '必须是列表');
  requireValid(items.every(item => record(item) && typeof item[key] === 'string' && !!item[key]), label + '缺少标识');
  requireValid(new Set(items.map(item => item[key])).size === items.length, label + '包含重复标识');
}
function validateColumns(items: unknown, label: string): asserts items is ColumnDef[] {
  unique(items, 'key', label);
  requireValid(items.some(column => column.key === 'id'), label + '缺少 ID 字段');
  for (const column of items) {
    requireValid(safeKey(column.key as string) && typeof column.label === 'string', label + '字段名称无效');
    requireValid(column.type === undefined || ['text', 'enum', 'reference'].includes(column.type as string), label + '字段类型无效');
    requireValid(column.options === undefined || strings(column.options), label + '枚举选项无效');
    for (const key of ['enumId', 'enumName', 'reference']) requireValid(column[key] === undefined || typeof column[key] === 'string', label + '绑定无效');
  }
}
function validateVersions(value: unknown): VersionStore {
  requireValid(record(value) && value.schema === 1 && Number.isSafeInteger(value.revision) && (value.revision as number) >= 0, '枚举存档版本无效');
  requireValid(record(value.data) && record(value.data.columns) && record(value.data.datasets), '配置数据不完整');
  const tableKeys = Object.keys(value.data.datasets);
  requireValid(tableKeys.every(safeKey) && tableKeys.sort().join('\0') === Object.keys(value.data.columns).sort().join('\0'), '配置字段与数据表不一致');
  for (const key of tableKeys) {
    validateColumns(value.data.columns[key], key);
    const rows = value.data.datasets[key];
    requireValid(Array.isArray(rows) && rows.every(row => record(row) && typeof row.id === 'string' && Object.keys(row).every(safeKey) && Object.values(row).every(field => typeof field === 'string')), key + '记录结构无效');
  }
  unique(value.snapshots, 'id', '枚举快照');
  for (const snapshot of value.snapshots) {
    requireValid(fields(snapshot, ['id', 'createdAt', 'checksum']) && ['source', 'release'].includes(snapshot.kind as string) && record(snapshot.scan), '枚举快照结构无效');
    const scan = snapshot.scan;
    requireValid(fields(scan, ['projectPath', 'enumPath']) && strings(scan.files) && Array.isArray(scan.groups) && Array.isArray(scan.orderTables) && Array.isArray(scan.dynamic) && record(scan.counts), '枚举扫描结构无效');
    requireValid(['files', 'groups', 'members'].every(key => Number.isSafeInteger((scan.counts as Record<string, unknown>)[key]) && ((scan.counts as Record<string, unknown>)[key] as number) >= 0), '枚举数量无效');
    for (const group of scan.groups) {
      requireValid(record(group) && fields(group, ['name', 'source', 'valueType', 'comment']) && Number.isFinite(group.line) && Array.isArray(group.members), '枚举组结构无效');
      for (const member of group.members) requireValid(record(member) && fields(member, ['key', 'comment']) && Number.isFinite(member.line) && (typeof member.value === 'string' || typeof member.value === 'number' && Number.isFinite(member.value)), '枚举成员结构无效');
    }
    for (const order of scan.orderTables) requireValid(record(order) && fields(order, ['name', 'source', 'detail']) && strings(order.keys), '枚举顺序结构无效');
    for (const dynamic of scan.dynamic) requireValid(record(dynamic) && fields(dynamic, ['name', 'source', 'detail']) && Number.isFinite(dynamic.line), '动态枚举结构无效');
  }
  requireValid((value.activeId === null || typeof value.activeId === 'string') && (value.candidateId === null || typeof value.candidateId === 'string') && record(value.reviews), '枚举版本指针无效');
  for (const [id, review] of Object.entries(value.reviews)) {
    requireValid(safeKey(id) && record(review) && (review.baseId === null || typeof review.baseId === 'string') && ['draft', 'approved', 'rejected', 'archived'].includes(review.status as string) && strings(review.selected) && strings(review.acknowledged) && fields(review, ['reviewer', 'note']) && record(review.migrations), '枚举审核结构无效');
    requireValid((review.approvalOnly === undefined || typeof review.approvalOnly === 'boolean') && (review.declined === undefined || strings(review.declined)), '枚举审核决定无效');
    for (const [key, migration] of Object.entries(review.migrations)) requireValid(safeKey(key) && record(migration) && ['replace', 'retain'].includes(migration.mode as string) && (migration.target === undefined || typeof migration.target === 'string'), '枚举迁移规则无效');
  }
  unique(value.releases, 'id', '枚举发布记录');
  for (const release of value.releases) {
    requireValid(fields(release, ['id', 'toId', 'createdAt', 'reviewer', 'note']) && (release.fromId === null || typeof release.fromId === 'string') && (release.sourceId === undefined || typeof release.sourceId === 'string') && ['publish', 'rollback'].includes(release.kind as string) && Array.isArray(release.accepted) && Array.isArray(release.patches), '枚举发布结构无效');
    for (const change of release.accepted) requireValid(record(change) && fields(change, ['id', 'groupId', 'name']) && ['add-group', 'remove-group', 'add-member', 'remove-member', 'value', 'comment', 'group-info', 'order'].includes(change.kind as string) && ['low', 'high'].includes(change.risk as string) && (change.member === undefined || typeof change.member === 'string') && ['before', 'after'].every(key => change[key] === undefined || typeof change[key] === 'string' || typeof change[key] === 'number' && Number.isFinite(change[key])), '枚举变更记录结构无效');
    for (const patch of release.patches) requireValid(record(patch) && fields(patch, ['table', 'rowId', 'field', 'before', 'after']), '数据迁移记录结构无效');
  }
  return readVersions({ getItem: () => JSON.stringify(value), setItem: () => { throw new Error('只读校验'); } }, '', initialData);
}

/** Validate archive shape, not design completeness: unresolved draft references remain editable. */
export function validateProjectPackage(value: unknown): ProjectPackageDocument {
  requireValid(record(value) && value.schema === 1 && record(value.project) && record(value.archives), '不支持的格式或版本');
  requireValid(Object.keys(value).every(key => ['schema', 'project', 'archives'].includes(key)), '不支持的顶层字段');
  const project = value.project, archives = value.archives;
  requireValid(project.defaultTablesVersion === undefined || project.defaultTablesVersion === 1, '不支持的配置表版本');
  requireValid(typeof project.name === 'string' && !!project.name.trim() && record(project.config), '项目名称或引擎配置无效');
  requireValid(fields(project.config, ['engine', 'projectPath', 'enumPath', 'dataPath', 'outputFormat']) && typeof project.config.autoSync === 'boolean' && typeof project.config.backupBeforeSync === 'boolean', '引擎配置不完整');
  requireValid(projectPackageSections.filter(section => section !== 'gameplay-core' && section !== 'prototype-design' && section !== 'task-flows').every(section => Object.prototype.hasOwnProperty.call(archives, section)) && Object.keys(archives).every(key => [...projectPackageSections, 'data-view'].includes(key as typeof projectPackageSections[number])), '项目模块缺失或版本不受支持');
  const gameplay = validateGameplay(archives.gameplay);
  validateFunctionalSystems(archives['functional-systems']);
  const art = validateArtAssets(archives['art-assets']);
  const fileMetadata = new Map<string, string>();
  for (const asset of art.assets) for (const version of asset.versions) for (const file of version.files) {
    requireValid(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,12}$/.test(file.storagePath), '美术文件路径无效：' + file.name);
    const metadata = JSON.stringify([file.size, file.mime]);
    requireValid(!fileMetadata.has(file.storagePath) || fileMetadata.get(file.storagePath) === metadata, '相同美术文件的元数据不一致');
    fileMetadata.set(file.storagePath, metadata);
  }
  validateVersions(archives['enum-versions']);
  unique(archives.definitions, 'key', '配置表目录');
  for (const definition of archives.definitions) {
    requireValid(safeKey(definition.key as string) && fields(definition, ['label', 'badge']), '配置表名称无效');
    validateColumns(definition.columns, definition.key as string);
  }
  unique(archives.stories, 'id', '故事文档');
  for (const story of archives.stories) requireValid(fields(story, ['title', 'category', 'status', 'updated', 'summary', 'content']) && strings(story.tags) && strings(story.outlines) && record(story.relations) && ['characters', 'locations', 'systems'].every(key => strings((story.relations as Record<string, unknown>)[key])), '故事文档结构无效');
  requireValid(record(archives.project) && fields(archives.project, ['name', 'genre', 'platform', 'version', 'status', 'description']), '项目资料不完整');
  requireValid(Array.isArray(archives.milestones) && archives.milestones.every(item => record(item) && fields(item, ['title', 'owner', 'due']) && ['done', 'active', 'planned'].includes(item.status as string)), '里程碑结构无效');
  const normalized = structuredClone(value) as unknown as ProjectPackageDocument;
  normalized.archives['task-flows'] = Object.prototype.hasOwnProperty.call(archives, 'task-flows') ? structuredClone(validateTaskFlows(archives['task-flows'])) : emptyTaskFlows();
  normalized.archives.gameplay = structuredClone(gameplay);
  normalized.archives['gameplay-core'] = Object.prototype.hasOwnProperty.call(archives, 'gameplay-core') ? structuredClone(validateGameplayCore(archives['gameplay-core'])) : emptyGameplayCore();
  normalized.archives['prototype-design'] = Object.prototype.hasOwnProperty.call(archives, 'prototype-design') ? structuredClone(validatePrototypeDesign(archives['prototype-design'])) : emptyPrototypeDesign();
  if (Object.prototype.hasOwnProperty.call(archives, 'data-view')) normalized.archives['data-view'] = normalizeDataViewState(archives['data-view']);
  return normalized;
}

/** Capture every raw value once; the desktop writer rechecks these before publishing the folder. */
export function captureProjectPackage(storage: Pick<Storage, 'getItem'>, project: SavedProject): ProjectPackageSnapshot {
  const catalogRaw = storage.getItem(PROJECT_CATALOG_KEY);
  if (catalogRaw !== null) {
    const catalog = validateCatalog(JSON.parse(catalogRaw));
    const current = catalog.projects.find(item => item.id === project.id);
    requireValid(current && JSON.stringify(current) === JSON.stringify(project), '项目资料已变化，请重新打开导出');
  }
  const expectedEntries: ProjectPackageSnapshot['expectedEntries'] = [{ key: PROJECT_CATALOG_KEY, value: catalogRaw }];
  const migrationKey = defaultTableMigrationKey(project.id), migrationRaw = storage.getItem(migrationKey);
  let defaultTablesVersion: 1 | undefined;
  if (migrationRaw !== null) {
    let migration: unknown;
    try { migration = JSON.parse(migrationRaw); } catch { requireValid(false, '配置表清理记录损坏，请先重新打开项目'); }
    requireValid(record(migration) && migration.schema === 1 && ['pending', 'done'].includes(migration.state as string) &&
      strings(migration.removed) && new Set(migration.removed).size === migration.removed.length &&
      migration.removed.every(key => datasetDefinitions.some(definition => definition.key === key)), '配置表清理记录无效');
    requireValid(migration.state === 'done', '配置表清理尚未完成，请先重新打开项目完成恢复');
    defaultTablesVersion = 1;
    expectedEntries.push({ key: migrationKey, value: migrationRaw });
  }
  const read = (section: string, fallback: unknown) => {
    const key = workspaceKey(project.id, section), raw = storage.getItem(key);
    expectedEntries.push({ key, value: raw });
    return raw === null ? structuredClone(fallback) : JSON.parse(raw);
  };
  const empty = project.initialContent === 'empty';
  const archives = {
    'task-flows': read('task-flows', emptyTaskFlows()), gameplay: read('gameplay', emptyGameplay()), 'gameplay-core': read('gameplay-core', emptyGameplayCore()), 'prototype-design': read('prototype-design', emptyPrototypeDesign()), 'functional-systems': read('functional-systems', emptyFunctionalSystems()),
    'art-assets': read('art-assets', emptyArtAssets()), definitions: read('definitions', empty ? emptyDatasetDefinitions : datasetDefinitions),
    stories: read('stories', empty ? [] : initialStoryDocs),
    project: read('project', empty ? { ...initialProject, name: project.name, version: 'v0.1.0', description: '' } : { ...initialProject, name: project.name }),
    milestones: read('milestones', empty ? [] : initialMilestones), 'enum-versions': read('enum-versions', emptyStore(empty ? emptyProjectData : initialData)),
  };
  const viewKey = workspaceKey(project.id, 'data-view'), viewRaw = storage.getItem(viewKey);
  expectedEntries.push({ key: viewKey, value: viewRaw });
  let view: DataViewState | undefined;
  if (viewRaw !== null) { try { view = normalizeDataViewState(JSON.parse(viewRaw)); } catch { view = normalizeDataViewState(null); } }
  const document = validateProjectPackage({ schema: 1, project: { name: project.name, config: { ...project.config, projectPath: '', autoSync: false }, ...(defaultTablesVersion ? { defaultTablesVersion } : {}) }, archives: { ...archives, ...(view ? { 'data-view': view } : {}) } });
  return { document, expectedEntries };
}

export function prepareProjectPackageImport(catalog: ProjectCatalog, value: unknown, name: string): PreparedProjectPackageImport {
  validateCatalog(catalog);
  requireValid(typeof name === 'string' && !!name.trim() && name.trim().length <= 100, '项目名称须为 1 至 100 个字符');
  const document = validateProjectPackage(value);
  const next = addSavedProject(catalog, name);
  const project = next.projects.find(item => item.id === next.activeId)!;
  project.config = { ...document.project.config, projectPath: '', autoSync: false };
  const archives = { ...document.archives, project: { ...document.archives.project, name: project.name } };
  const entries = Object.entries(archives).map(([section, content]) => ({ key: workspaceKey(project.id, section), value: JSON.stringify(content) }));
  if (document.project.defaultTablesVersion === 1) entries.push({ key: defaultTableMigrationKey(project.id), value: completedDefaultTableMigration });
  return { catalog: validateCatalog(next), project, entries, ...(document.project.defaultTablesVersion === 1 ? { defaultTablesVersion: 1 as const } : {}) };
}

/** Publish the new catalog only after all archives and managed art files have been written. */
export function writeProjectPackageImport(storage: StorageLike, prepared: PreparedProjectPackageImport): void {
  const { project, entries } = prepared;
  requireValid(/^project-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(project.id) && project.initialContent === 'empty' && project.config.projectPath === '' && !project.config.autoSync, '导入目标必须是新的本地项目');
  const required = projectPackageSections.map(section => workspaceKey(project.id, section));
  requireValid(prepared.defaultTablesVersion === undefined || prepared.defaultTablesVersion === 1, '不支持的配置表版本');
  if (prepared.defaultTablesVersion === 1) {
    const markerKey = defaultTableMigrationKey(project.id);
    requireValid(entries.some(entry => entry.key === markerKey && entry.value === completedDefaultTableMigration), '配置表版本标记缺失或无效');
    required.push(markerKey);
  }
  const allowed = [...required, workspaceKey(project.id, 'data-view')];
  requireValid(new Set(entries.map(entry => entry.key)).size === entries.length && required.every(key => entries.some(entry => entry.key === key)) && entries.every(entry => allowed.includes(entry.key) && typeof entry.value === 'string'), '导入存档范围无效');
  for (const entry of entries) requireValid(storage.getItem(entry.key) === null, '导入目标已有数据，请重新导入');
  for (const entry of entries) {
    requireValid(storage.getItem(entry.key) === null, '导入目标已被其他操作更新，请重新导入');
    storage.setItem(entry.key, entry.value);
  }
}
