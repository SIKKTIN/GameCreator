import { emptyProjectSchedule } from './project-schedule.ts';
import { emptyMapDesign, validateMapDesign, mapIssues, type MapDesignStore } from './map-design.ts';
import { emptyStoryOrchestration, validateStoryOrchestration, narrativeIssues, type StoryOrchestrationStore } from './story-orchestration.ts';
import { emptyPrototypeDesign, validatePrototypeDesign, prototypeIssues, type PrototypeDesignStore } from './prototype-design.ts';
import { emptyTaskFlows, validateTaskFlows, taskFlowIssues, type TaskFlowStore } from './task-flow.ts';
import { addSavedProject, validateCatalog, type ProjectCatalog, type SavedProject } from './project-catalog.ts';
import { emptyGameplayCore, validateGameplayCore, coreIssues, type GameplayCoreStore } from './gameplay-core.ts';
import { validateGameplay, type GameplayStore } from './gameplay.ts';
import { dependencyIssues, stateFlowIssues } from './gameplay-structure.ts';
import { stageIssues } from './gameplay-stage.ts';
import { validateFunctionalSystems, functionalIssues, type FunctionalStore } from './functional-systems.ts';
import { validateArtAssets, validateArtMutation, emptyArtAssets, artIssues, type ArtStore } from './art-assets.ts';
import { emptyStore } from './enum-versions.ts';
import type { ColumnDef, DatasetDef, ProjectData } from './data-model.ts';
import type { StoryDoc } from './story-model.ts';

export type PrototypeExample = {
  schema: 1; name: string; description: string; gameplay: GameplayStore; gameplayCore?: GameplayCoreStore; prototypeDesign?: PrototypeDesignStore; taskFlows?: TaskFlowStore; storyOrchestration?: StoryOrchestrationStore; mapDesign?: MapDesignStore;
  functionalSystems: FunctionalStore; artAssets: ArtStore; data: ProjectData;
  definitions: DatasetDef[]; stories: StoryDoc[];
};
export type PreparedPrototypeProject = {
  catalog: ProjectCatalog; project: SavedProject;
  entries: { key: string; value: string }[];
};
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const sections = ['project-schedule', 'map-design', 'story-orchestration', 'task-flows', 'gameplay', 'gameplay-core', 'prototype-design', 'functional-systems', 'art-assets', 'definitions', 'stories', 'project', 'milestones'] as const;
const workspaceKey = (id: string, section: string) => 'gamecreator.workspace.v1:' + id + ':' + section;
const enumKey = (id: string) => 'gamecreator.enum-versions.v1:' + id;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
function requireValid(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error('原型示例无效：' + detail);
}
function unique(items: unknown, key: string, label: string): asserts items is Record<string, unknown>[] {
  requireValid(Array.isArray(items), label + '必须是列表');
  requireValid(items.every(item => record(item) && nonempty(item[key])), label + '缺少标识');
  requireValid(new Set(items.map(item => item[key])).size === items.length, label + '包含重复标识');
}
function safeKey(value: string) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value); }
function validateColumns(items: unknown, label: string): asserts items is ColumnDef[] {
  unique(items, 'key', label);
  requireValid(items.some(column => column.key === 'id'), label + '缺少 ID 字段');
  for (const column of items) {
    requireValid(safeKey(column.key as string) && nonempty(column.label), label + '字段名称无效');
    requireValid(column.type === undefined || ['text', 'enum', 'reference'].includes(column.type as string), label + '字段类型无效');
    requireValid(column.options === undefined || strings(column.options), label + '枚举选项无效');
    for (const key of ['enumId', 'enumName', 'reference']) requireValid(column[key] === undefined || typeof column[key] === 'string', label + '绑定无效');
    requireValid(!column.enumId, label + '不能依赖外部引擎枚举');
    if (column.type === 'enum') requireValid(Array.isArray(column.options) && column.options.length > 0, label + '缺少本地枚举选项');
    if (column.type === 'reference') requireValid(nonempty(column.reference), label + '缺少引用表');
  }
}

/** Built-in examples are portable design baselines, never machine-specific project backups. */
export function validatePrototypeExample(value: unknown): PrototypeExample {
  requireValid(record(value), '内容必须是对象');
  const fields = ['schema', 'name', 'description', 'gameplay', 'functionalSystems', 'artAssets', 'data', 'definitions', 'stories'];
  requireValid(fields.every(field => Object.prototype.hasOwnProperty.call(value, field)) && Object.keys(value).every(field => [...fields, 'gameplayCore', 'prototypeDesign', 'taskFlows', 'storyOrchestration', 'mapDesign'].includes(field)), '包含缺失字段或非便携配置');
  requireValid(value.schema === 1 && nonempty(value.name) && nonempty(value.description), '版本或名称无效');
  requireValid(record(value.gameplay) && value.gameplay.schema === 3, '玩法版本无效');
  const gameplay = validateGameplay(value.gameplay);
  if (Object.prototype.hasOwnProperty.call(value, 'mapDesign')) validateMapDesign(value.mapDesign);
  if (Object.prototype.hasOwnProperty.call(value, 'gameplayCore')) {
    const core = validateGameplayCore(value.gameplayCore);
    requireValid(coreIssues(core, gameplay.designs).length === 0, '玩法核心包含失效的关联或未连接的节点');
  }
  const functional = validateFunctionalSystems(value.functionalSystems);
  const art = validateArtAssets(value.artAssets);
  validateArtMutation(emptyArtAssets(), art);
  if (Object.prototype.hasOwnProperty.call(value, 'prototypeDesign')) {
    const prototype = validatePrototypeDesign(value.prototypeDesign);
    requireValid(prototypeIssues(prototype, gameplay.designs, value.gameplayCore ? validateGameplayCore(value.gameplayCore) : emptyGameplayCore(), art, value.mapDesign ? validateMapDesign(value.mapDesign) : emptyMapDesign()).length === 0, '原型设计含有失效引用');
  }

  unique(value.stories, 'id', '故事文档');
  for (const story of value.stories) {
    requireValid(['title', 'category', 'status', 'updated', 'summary', 'content'].every(key => typeof story[key] === 'string'), '故事文档内容无效');
    requireValid(strings(story.tags) && strings(story.outlines) && record(story.relations) &&
      ['characters', 'locations', 'systems'].every(key => strings((story.relations as Record<string, unknown>)[key])), '故事文档关系无效');
  }
  unique(value.definitions, 'key', '配置表目录');
  requireValid(record(value.data) && record(value.data.datasets) && record(value.data.columns), '配置数据不完整');
  const tableKeys = value.definitions.map(definition => definition.key as string);
  requireValid(Object.keys(value.data.datasets).sort().join(',') === [...tableKeys].sort().join(',') &&
    Object.keys(value.data.columns).sort().join(',') === [...tableKeys].sort().join(','), '配置表目录与数据不一致');
  for (const definition of value.definitions) {
    const key = definition.key as string;
    requireValid(safeKey(key) && nonempty(definition.label) && typeof definition.badge === 'string', '配置表名称无效');
    validateColumns(definition.columns, key);
    const columns = value.data.columns[key];
    validateColumns(columns, key);
    requireValid(JSON.stringify(definition.columns) === JSON.stringify(columns), key + '字段定义与数据不一致');
    const rows = value.data.datasets[key];
    unique(rows, 'id', key + '记录');
    const columnKeys = new Set(columns.map(column => column.key));
    for (const row of rows) {
      requireValid(Object.values(row).every(field => typeof field === 'string') && Object.keys(row).every(field => columnKeys.has(field)), key + '记录字段无效');
      requireValid(columns.every(column => typeof row[column.key] === 'string'), key + '记录字段不完整');
    }
  }
  const example = value as unknown as PrototypeExample;
  for (const definition of example.definitions) {
    for (const column of example.data.columns[definition.key]) {
      if (column.type === 'reference') requireValid(tableKeys.includes(column.reference!), definition.key + '引用表不存在');
      for (const row of example.data.datasets[definition.key]) {
        if (column.type === 'reference') requireValid(example.data.datasets[column.reference!].some(target => target.id === row[column.key]), definition.key + '/' + row.id + '引用记录不存在');
        if (column.type === 'enum') requireValid(column.options!.includes(row[column.key]), definition.key + '/' + row.id + '枚举成员不存在');
      }
    }
  }
  requireValid(gameplay.designs.length > 0, '缺少玩法设计');
  const storyIds = new Set(example.stories.map(story => story.id));
  for (const design of gameplay.designs) {
    const issues = [...dependencyIssues(design, gameplay.designs), ...stateFlowIssues(design.stateFlow), ...stageIssues(design, gameplay.designs)];
    requireValid(issues.length === 0, design.title + '：' + issues.join('；'));
    requireValid(design.links.every(link => link.kind === 'story' ? storyIds.has(link.targetId) : tableKeys.includes(link.targetId)), design.title + '的故事或配置表引用不存在');
    requireValid(design.status === '草稿' && design.prototype.every(item => !item.done) && design.checks.every(check => check.result === '未测试' && check.actual === ''), '示例不能包含已完成或已测试的原型记录');
  }
  const references = [...functionalIssues(functional, { designs: gameplay.designs, data: example.data, definitions: example.definitions }),
    ...artIssues(art, { designs: gameplay.designs, functional })];
  requireValid(references.length === 0, references.join('；'));
  requireValid(functional.capabilities.every(capability => capability.status === '待开发'), '示例不能包含已开发功能');
  requireValid(art.requirements.every(requirement => requirement.status === '待制作' && requirement.owner === '' && requirement.dueDate === ''), '示例美术需求必须保持未分配、待制作');
  requireValid(art.assets.every(asset => asset.versions.length === 0 && asset.adoptedVersionId === ''), '示例不能携带本地交付文件或采用版本');
  if (Object.prototype.hasOwnProperty.call(value, 'taskFlows')) {
    const tasks = validateTaskFlows(value.taskFlows);
    requireValid(taskFlowIssues(tasks, { designs: gameplay.designs, capabilities: functional.capabilities, stories: example.stories, assets: art.assets, definitions: example.definitions, data: example.data }).length === 0, '任务与流程包含未完成设计或失效引用');
    requireValid(tasks.tasks.every(t => t.status === '草稿' && !t.archived), '示例任务必须保持草稿');
  }
  if (Object.prototype.hasOwnProperty.call(value, 'storyOrchestration')) {
    const narrative = validateStoryOrchestration(value.storyOrchestration);
    requireValid(narrative.stories.every(s => narrativeIssues(s, example.taskFlows?.tasks ?? []).length === 0), '故事编排包含失效引用或不完整片段');
  }
  if (example.mapDesign) requireValid(mapIssues(example.mapDesign, gameplay.designs, {
    gameplay: gameplay.designs.map(d=>({id:d.id,name:d.title})), task:(example.taskFlows?.tasks??[]).map(t=>({id:t.id,name:t.title})),
    story:example.stories.map(s=>({id:s.id,name:s.title})), character:(example.storyOrchestration?.characters??[]).map(c=>({id:c.id,name:c.name})),
    asset:art.assets.map(a=>({id:a.id,name:a.name})), prototype:example.prototypeDesign?.scenes??[]
  }).length===0, '地图设计包含失效引用');
  return example;
}

/** Prepare all serialized archives before doing any writes; stable module IDs are project-scoped. */
export function preparePrototypeProject(catalog: ProjectCatalog, value: unknown, name: string): PreparedPrototypeProject {
  validateCatalog(catalog);
  requireValid(typeof name === 'string' && !!name.trim() && name.trim().length <= 100, '项目名称须为 1 至 100 个字符');
  const example = validatePrototypeExample(value);
  const next = addSavedProject(catalog, name);
  const project = next.projects.find(item => item.id === next.activeId)!;
  const archives = {
    'project-schedule': emptyProjectSchedule(),
    'map-design': example.mapDesign ?? emptyMapDesign(),
    'story-orchestration': example.storyOrchestration ?? emptyStoryOrchestration(), 'task-flows': example.taskFlows ?? emptyTaskFlows(), gameplay: example.gameplay, 'gameplay-core': example.gameplayCore ?? emptyGameplayCore(), 'prototype-design': example.prototypeDesign ?? emptyPrototypeDesign(), 'functional-systems': example.functionalSystems, 'art-assets': example.artAssets,
    definitions: example.definitions, stories: example.stories,
    project: { name: project.name, description: example.description, genre: '未指定', platform: '未指定', version: 'v0.1.0', status: '原型设计' },
    milestones: [],
  };
  const entries = sections.map(section => ({ key: workspaceKey(project.id, section), value: JSON.stringify(archives[section]) }));
  entries.push({ key: enumKey(project.id), value: JSON.stringify(emptyStore(example.data)) });
  return { catalog: next, project, entries };
}

/** Caller publishes the catalog only after this succeeds, under the project catalog lock.
 * A failed import may leave unreachable archives under its fresh UUID; it never publishes
 * a partial project or deletes/overwrites existing content. Retry prepares a new identity.
 */
export function writePrototypeProject(storage: StorageLike, prepared: PreparedPrototypeProject): void {
  const { project, entries } = prepared;
  requireValid(/^project-[0-9a-f-]{36}$/.test(project.id) && project.initialContent === 'empty' && project.config.projectPath === '', '导入目标必须是新的本地项目');
  const expected = [...sections.map(section => workspaceKey(project.id, section)), enumKey(project.id)];
  requireValid(entries.length === expected.length && new Set(entries.map(entry => entry.key)).size === expected.length &&
    entries.every(entry => expected.includes(entry.key) && typeof entry.value === 'string'), '导入存档范围无效');
  for (const entry of entries) {
    if (storage.getItem(entry.key) !== null) throw new Error('导入目标已有数据，已停止写入，请重新创建项目');
  }
  for (const entry of entries) {
    if (storage.getItem(entry.key) !== null) throw new Error('导入目标已被其他操作更新，请重新创建项目');
    storage.setItem(entry.key, entry.value);
  }
}
