import type { EngineConfig } from './engine';
import { projectIdentity } from './data-model.ts';

// Keep the existing storage key so upgrades can discover the previous catalog.
export const PROJECT_CATALOG_KEY = 'gamecreator.projects.v1';
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export type SavedProject = { id: string; name: string; config: EngineConfig; initialContent: 'legacy' | 'empty' };
export type ProjectCatalog = { schema: 2; activeId: string; mode: 'project' | 'test'; projects: SavedProject[] };
type LegacyProjectCatalog = Omit<ProjectCatalog, 'schema'> & { schema: 1 };

function validateCatalogVersion(value: ProjectCatalog | LegacyProjectCatalog, schema: 1 | 2) {
  if (!value || value.schema !== schema || !Array.isArray(value.projects) || (schema === 1 && !value.projects.length) ||
      !['project', 'test'].includes(value.mode)) throw new Error('项目列表存档格式异常，已停止写入');
  const ids = new Set<string>();
  for (const project of value.projects) {
    // Historical IDs are normalized paths and remain permanent archive identities,
    // including relative paths accepted by the old catalog. New IDs are UUIDs.
    if (!project || typeof project.id !== 'string' || !project.id || project.id !== projectIdentity(project.id) ||
        typeof project.name !== 'string' || !project.config || typeof project.config.projectPath !== 'string' || ids.has(project.id) ||
        (schema === 1 && (!project.config.projectPath.trim() || project.id !== projectIdentity(project.config.projectPath))) ||
        !['legacy', 'empty'].includes(project.initialContent) ||
        ['engine', 'enumPath', 'dataPath', 'outputFormat'].some(key => typeof project.config[key as keyof EngineConfig] !== 'string') ||
        typeof project.config.autoSync !== 'boolean' || typeof project.config.backupBeforeSync !== 'boolean') {
      throw new Error('项目列表含无效或重复工程，已停止写入');
    }
    ids.add(project.id);
  }
  if (value.projects.length ? !ids.has(value.activeId) : value.activeId !== '' || value.mode !== 'project') throw new Error('项目列表中的当前工程不存在');
}
export function validateCatalog(value: ProjectCatalog): ProjectCatalog {
  validateCatalogVersion(value, 2);
  return value;
}
export function defaultCatalog(config: EngineConfig, name: string): ProjectCatalog {
  const id = projectIdentity(config.projectPath);
  return { schema: 2, activeId: id, mode: 'project', projects: [{ id, name, config: { ...config }, initialContent: 'legacy' }] };
}
export function readProjectCatalog(storage: StorageLike, defaults: EngineConfig, fallbackName: string): ProjectCatalog {
  const raw = storage.getItem(PROJECT_CATALOG_KEY);
  if (raw !== null) {
    const existing = JSON.parse(raw);
    if (existing?.schema !== 1) return validateCatalog(existing);
    // Validate against the original identity contract before relaxing path binding.
    validateCatalogVersion(existing, 1);
    const upgraded = validateCatalog({ ...existing, schema: 2 });
    storage.setItem(PROJECT_CATALOG_KEY, JSON.stringify(upgraded));
    return upgraded;
  }
  const legacyConfig = storage.getItem('gamecreator.engine-config.v1');
  const config: EngineConfig = legacyConfig ? { ...defaults, ...JSON.parse(legacyConfig) } : { ...defaults };
  const result = defaultCatalog(config, fallbackName);
  const id = result.activeId;
  const metadata = storage.getItem('gamecreator.workspace.v1:' + id + ':project');
  if (metadata) {
    const value = JSON.parse(metadata);
    if (typeof value?.name === 'string' && value.name.trim()) result.projects[0].name = value.name;
  }
  // A fresh installation starts without demo tables; existing legacy archives
  // retain their original defaults so upgrading does not replace saved content.
  const hasLegacyContent = legacyConfig !== null || metadata !== null ||
    storage.getItem('gamecreator.enum-versions.v1:' + id) !== null ||
    storage.getItem('gamecreator.dataset-definitions.v1') !== null ||
    ['definitions', 'stories', 'milestones', 'gameplay', 'functional-systems', 'art-assets']
      .some(section => storage.getItem('gamecreator.workspace.v1:' + id + ':' + section) !== null);
  if (!hasLegacyContent) result.projects[0].initialContent = 'empty';
  const testSession = storage.getItem('gamecreator.test-session.v1');
  try { if (testSession && JSON.parse(testSession)) result.mode = 'test'; }
  catch { /* A damaged test session must not block recovery of the formal project. */ }
  validateCatalog(result);
  // Only the pre-existing project's directory inherits the old global table names.
  const definitionsKey = 'gamecreator.workspace.v1:' + id + ':definitions';
  if (storage.getItem(definitionsKey) === null) {
    const definitions = storage.getItem('gamecreator.dataset-definitions.v1');
    if (definitions !== null) {
      if (!Array.isArray(JSON.parse(definitions))) throw new Error('旧配置表目录无效，未迁移项目列表');
      storage.setItem(definitionsKey, definitions);
    }
  }
  storage.setItem(PROJECT_CATALOG_KEY, JSON.stringify(result));
  return result;
}
export function addSavedProject(catalog: ProjectCatalog, name: string): ProjectCatalog {
  if (!name.trim()) throw new Error('请输入项目名称');
  const id = 'project-' + crypto.randomUUID();
  const config: EngineConfig = { engine: 'oasis-lua', projectPath: '', enumPath: 'Script/Const',
    dataPath: 'Script/Config', outputFormat: 'lua', autoSync: false, backupBeforeSync: true };
  return validateCatalog({ ...catalog, mode: 'project', activeId: id,
    projects: [...catalog.projects, { id, name: name.trim(), config, initialContent: 'empty' }] });
}
export function selectSavedProject(catalog: ProjectCatalog, id: string): ProjectCatalog {
  if (!catalog.projects.some(project => project.id === id)) throw new Error('所选项目不存在');
  return { ...catalog, activeId: id, mode: 'project' };
}
export function updateSavedConfig(catalog: ProjectCatalog, id: string, config: EngineConfig): ProjectCatalog {
  if (!catalog.projects.some(project => project.id === id)) throw new Error('当前项目不存在');
  return validateCatalog({ ...catalog, projects: catalog.projects.map(project => project.id === id ? { ...project, config: { ...config } } : project) });
}

/** Remove only the catalog entry. Archives and external project files are retained. */
export function removeSavedProject(catalog: ProjectCatalog, id: string): ProjectCatalog {
  validateCatalog(catalog);
  const index = catalog.projects.findIndex(project => project.id === id);
  if (index < 0) throw new Error('所选项目不存在，可能已被删除');
  const projects = catalog.projects.filter(project => project.id !== id);
  const wasActive = catalog.activeId === id;
  return validateCatalog({ ...catalog, projects,
    activeId: wasActive ? (projects[Math.min(index, projects.length - 1)]?.id ?? '') : catalog.activeId,
    mode: wasActive ? 'project' : catalog.mode });
}
