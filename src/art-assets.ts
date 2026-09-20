import { validateArtLibrary, artLibrary, artCategoryId, artCategoryName, type ArtLibrary } from './art-library.ts';
import { objectGeometry, spatialObjectLocation } from './spatial-layout.ts';
import type { GameplayDesign } from './gameplay';
import type { FunctionalStore } from './functional-systems';

export const artCategories = ['角色', '场景', '动画', '特效', 'UI', '图标', '其他'] as const;
export const artPriorities = ['普通', '高', '低'] as const;
export const artRequirementStatuses = ['待制作', '制作中', '待审核', '需修改', '已通过'] as const;
export const artReviewStatuses = ['待审核', '需修改', '已通过'] as const;
export type ArtSource = { id: string; kind: 'gameplay' | 'capability'; targetId: string; sourceKind: 'design' | 'rule' | 'state' | 'event' | 'object'; sourceId: string; note: string };
export type ArtRequirement = { id: string; name: string; category: typeof artCategories[number]; description: string; specification: string; acceptance: string; owner: string; dueDate: string; priority: typeof artPriorities[number]; status: typeof artRequirementStatuses[number]; archived: boolean; sources: ArtSource[]; createdAt: string; updatedAt: string };
export type ArtFile = { id: string; name: string; size: number; mime: string; storagePath: string };
export type ArtVersion = { id: string; name: string; notes: string; placeholder: boolean; review: typeof artReviewStatuses[number]; feedback: string; files: ArtFile[]; createdAt: string };
export type ArtAsset = { id: string; name: string; description: string; versions: ArtVersion[]; adoptedVersionId: string; archived: boolean; createdAt: string; updatedAt: string };
export type ArtLink = { id: string; requirementId: string; assetId: string; note: string };
export type ArtStore = { library?: ArtLibrary; schema: 1; requirements: ArtRequirement[]; assets: ArtAsset[]; links: ArtLink[] };
export type ArtSources = { designs: GameplayDesign[]; functional: FunctionalStore };
export const emptyArtAssets = (): ArtStore => ({ schema: 1, requirements: [], assets: [], links: [] });
export function createArtRequirement(name: string): ArtRequirement {
  if (!name.trim()) throw new Error('请输入美术需求名称');
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), name: name.trim(), category: '其他', description: '', specification: '', acceptance: '', owner: '', dueDate: '', priority: '普通', status: '待制作', archived: false, sources: [], createdAt: now, updatedAt: now };
}
export function createArtAsset(name: string): ArtAsset {
  if (!name.trim()) throw new Error('请输入美术资产名称');
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), name: name.trim(), description: '', versions: [], adoptedVersionId: '', archived: false, createdAt: now, updatedAt: now };
}
export function validateArtAssets(value: unknown): ArtStore {
  const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
  const strings = (x: Record<string, unknown>, keys: string[]) => keys.every(k => typeof x[k] === 'string');
  const date = (x: unknown) => typeof x === 'string' && Number.isFinite(Date.parse(x));
  const due = (x: unknown) => x === '' || (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && date(x) && new Date(x).toISOString().slice(0, 10) === x);
  const list = (xs: unknown, check: (x: Record<string, unknown>) => boolean): boolean => {
    if (!Array.isArray(xs)) return false; const seen = new Set<string>();
    return xs.every(x => { if (!record(x) || typeof x.id !== 'string' || !x.id.trim() || seen.has(x.id) || !check(x)) return false; seen.add(x.id); return true; });
  };
  if (!record(value) || value.schema !== 1 ||
    !list(value.requirements, r => strings(r, ['name', 'description', 'specification', 'acceptance', 'owner', 'dueDate']) && artCategories.includes(r.category as ArtRequirement['category']) && artPriorities.includes(r.priority as ArtRequirement['priority']) && artRequirementStatuses.includes(r.status as ArtRequirement['status']) && typeof r.archived === 'boolean' && date(r.createdAt) && date(r.updatedAt) && due(r.dueDate) &&
      list(r.sources, s => strings(s, ['targetId', 'sourceId', 'note']) && ['gameplay', 'capability'].includes(s.kind as string) && ['design', 'rule', 'state', 'event', 'object'].includes(s.sourceKind as string) && (s.sourceKind !== 'design' || s.sourceId === '') && (s.kind !== 'capability' || s.sourceKind === 'design' && s.sourceId === ''))) ||
    !list(value.assets, a => strings(a, ['name', 'description', 'adoptedVersionId']) && typeof a.archived === 'boolean' && date(a.createdAt) && date(a.updatedAt) &&
      list(a.versions, v => strings(v, ['name', 'notes', 'feedback']) && typeof v.placeholder === 'boolean' && artReviewStatuses.includes(v.review as ArtVersion['review']) && date(v.createdAt) &&
        list(v.files, f => strings(f, ['name', 'mime', 'storagePath']) && !!(f.storagePath as string).trim() && typeof f.size === 'number' && Number.isSafeInteger(f.size) && f.size >= 0))) ||
    !list(value.links, l => strings(l, ['requirementId', 'assetId', 'note']))) throw new Error('美术资产存档格式异常，已停止写入');
  if (Object.prototype.hasOwnProperty.call(value, 'library')) validateArtLibrary(value.library, value as unknown as ArtStore);
  return value as ArtStore;
}
export function readArtAssets(storage: Pick<Storage, 'getItem'>, key: string) {
  const raw = storage.getItem(key);
  return { raw, store: raw === null ? emptyArtAssets() : validateArtAssets(JSON.parse(raw)) };
}
export const canAdoptVersion = (version: ArtVersion): boolean => version.files.length > 0 && (version.placeholder || version.review === '已通过');
export function artRequirementReadiness(requirementId: string, store: ArtStore): { ready: boolean; issues: string[] } {
  const requirement = store.requirements.find(r => r.id === requirementId);
  if (!requirement) return { ready: false, issues: ['需求已失效（' + requirementId + '）'] };
  const links = store.links.filter(l => l.requirementId === requirementId), issues: string[] = [];
  if (!links.length) issues.push('至少需要关联一个美术资产');
  for (const link of links) {
    const asset = store.assets.find(a => a.id === link.assetId);
    if (!asset) { issues.push('关联资产已失效（' + link.assetId + '）'); continue; }
    const version = asset.versions.find(v => v.id === asset.adoptedVersionId);
    if (!version) issues.push(asset.name + '：尚未采用有效版本');
    else if (version.placeholder) issues.push(asset.name + '：当前采用占位版本，不能作为正式通过');
    else if (version.review !== '已通过') issues.push(asset.name + '：当前采用正式版本尚未审核通过');
    else if (!version.files.length) issues.push(asset.name + '：当前采用版本没有文件');
  }
  return { ready: issues.length === 0, issues: [...new Set(issues)] };
}
const withoutArchive = <T extends { archived: boolean; updatedAt: string }>(item: T) => {
  const { archived: _archived, updatedAt: _updatedAt, ...content } = item; return JSON.stringify(content);
};
const immutableVersion = (version: ArtVersion) => { const { review: _review, feedback: _feedback, ...content } = version; return JSON.stringify(content); };
// Separate semantic rejection from a persistence failure so an invalid approval never becomes an unsaved draft.
export function validateArtMutation(previous: ArtStore, next: ArtStore): ArtStore {
  validateArtAssets(next);
  for (const requirement of previous.requirements) {
    const changed = next.requirements.find(r => r.id === requirement.id);
    if (!changed) throw new Error('美术需求保留历史，请使用归档');
    if (requirement.archived && withoutArchive(requirement) !== withoutArchive(changed)) throw new Error('美术需求已归档，请先恢复后再修改：' + requirement.name);
  }
  for (const asset of previous.assets) {
    const changed = next.assets.find(a => a.id === asset.id);
    if (!changed) throw new Error('美术资产保留历史，请使用归档');
    if (asset.archived && withoutArchive(asset) !== withoutArchive(changed)) throw new Error('美术资产已归档，请先恢复后再修改：' + asset.name);
    for (const version of asset.versions) {
      const changedVersion = changed.versions.find(v => v.id === version.id);
      if (!changedVersion || immutableVersion(version) !== immutableVersion(changedVersion)) throw new Error('已有版本内容与文件不可修改或删除，请上传新增版本：' + asset.name + ' / ' + version.name);
      if (!version.placeholder && asset.adoptedVersionId === version.id && changed.adoptedVersionId === version.id && changedVersion.review !== '已通过') throw new Error('当前采用的正式版本不能撤回审核，请先取消采用：' + asset.name);
    }
  }
  for (const asset of next.assets) {
    const previousAsset = previous.assets.find(a => a.id === asset.id);
    if (asset.adoptedVersionId && (!previousAsset || asset.adoptedVersionId !== previousAsset.adoptedVersionId)) {
      const version = asset.versions.find(v => v.id === asset.adoptedVersionId);
      if (!version || !canAdoptVersion(version)) throw new Error('只能采用有文件的占位版本或已通过审核的正式版本：' + asset.name);
    }
  }
  const archivedEndpoint = (link: ArtLink, store: ArtStore) => !!(store.requirements.find(r => r.id === link.requirementId)?.archived || store.assets.find(a => a.id === link.assetId)?.archived);
  for (const old of previous.links) {
    const changed = next.links.find(l => l.id === old.id);
    if ((!changed || JSON.stringify(changed) !== JSON.stringify(old)) && archivedEndpoint(old, previous)) throw new Error('关联的需求或资产已归档，请先恢复后再更改关联');
  }
  const linkPairs = new Set<string>();
  for (const link of next.links) {
    const old = previous.links.find(l => l.id === link.id);
    if ((!old || JSON.stringify(old) !== JSON.stringify(link)) && archivedEndpoint(link, next)) throw new Error('不能为已归档需求或资产新增或更改关联');
    const pair = JSON.stringify([link.requirementId, link.assetId]);
    if (linkPairs.has(pair)) throw new Error('同一美术需求与资产不能重复关联');
    linkPairs.add(pair);
  }
  for (const requirement of next.requirements) if (requirement.status === '已通过') {
    const readiness = artRequirementReadiness(requirement.id, next);
    if (!readiness.ready) throw new Error('需求“' + requirement.name + '”不能保持已通过，请先调整需求状态：' + readiness.issues.join('；'));
  }
  return next;
}
export function writeArtAssets(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, expected: string | null, store: ArtStore): string {
  const current = storage.getItem(key);
  const previous = current === null ? emptyArtAssets() : validateArtAssets(JSON.parse(current));
  if (current !== expected) throw new Error('其他窗口已更新美术资产，当前草稿已保留，请先处理版本冲突');
  const raw = JSON.stringify(validateArtMutation(previous, validateArtAssets(store)));
  storage.setItem(key, raw); return raw;
}

const sourceKinds = { design: '整体说明', rule: '条件规则', state: '状态', event: '时间事件', object: '空间对象' } as const;
function sourceParts(source: ArtSource, sources: ArtSources) {
  const issues: string[] = [];
  if (source.kind === 'capability') {
    const capability = sources.functional.capabilities.find(c => c.id === source.targetId);
    const system = sources.functional.systems.find(s => s.id === capability?.systemId);
    if (!capability) issues.push('功能来源已失效（' + (source.targetId || '尚未选择') + '）');
    else {
      if (!system) issues.push('来源功能的所属系统已失效：' + capability.name);
      if (capability.archived || system?.archived) issues.push('功能来源已归档：' + capability.name);
    }
    return { title: capability ? (system?.name || '所属系统已失效') + ' / ' + (capability.name || '未命名功能') : '功能已失效（' + (source.targetId || '尚未选择') + '）', detail: capability?.purpose || '', issues };
  }
  const design = sources.designs.find(d => d.id === source.targetId);
  if (!design) { issues.push('玩法来源已失效（' + (source.targetId || '尚未选择') + '）'); return { title: '玩法已失效（' + (source.targetId || '尚未选择') + '）', detail: '', issues }; }
  if (design.archived) issues.push('玩法来源已归档：' + design.title);
  const specific = source.sourceKind === 'rule' ? design.conditionRules.find(r => r.id === source.sourceId) : source.sourceKind === 'state' ? design.stateFlow.states.find(s => s.id === source.sourceId) : source.sourceKind === 'event' ? design.timeline.events.find(e => e.id === source.sourceId) : source.sourceKind === 'object' ? design.space.objects.find(o => o.id === source.sourceId) : undefined;
  if (source.sourceKind !== 'design' && !specific) issues.push(sourceKinds[source.sourceKind] + '来源已失效（' + (source.sourceId || '尚未选择') + '）');
  let detail = design.summary;
  if (source.sourceKind === 'rule') {
    const rule = design.conditionRules.find(r => r.id === source.sourceId);
    detail = rule ? '触发：' + rule.trigger + '；动作：' + rule.actions.map(a => a.text).join('；') : '';
  } else if (source.sourceKind === 'state') detail = design.stateFlow.states.find(s => s.id === source.sourceId)?.description || '';
  else if (source.sourceKind === 'event') {
    const event = design.timeline.events.find(e => e.id === source.sourceId);
    detail = event ? `开始 ${event.start} 秒，持续 ${event.duration} 秒；条件：${event.condition || '无附加条件'}；${event.notes}` : '';
  } else if (source.sourceKind === 'object') {
    const object = design.space.objects.find(o => o.id === source.sourceId);
    detail = object ? `${!object.geometry && !object.roomId && object.anchor === 'cell' ? `R${object.row} / C${object.column}` : spatialObjectLocation(object, design.space)}，${objectGeometry(object, design.space).width}×${objectGeometry(object, design.space).height} ${design.space.unit}；${object.notes}` : '';
  }
  return { title: (design.title || '未命名玩法') + ' / ' + sourceKinds[source.sourceKind] + (source.sourceKind === 'design' ? '' : '：' + (specific ? specific.name || '未命名来源' : '来源已失效（' + (source.sourceId || '尚未选择') + '）')), detail, issues };
}
export function artSourceText(source: ArtSource, sources: ArtSources): string {
  const resolved = sourceParts(source, sources);
  const archived = resolved.issues.some(i => i.includes('已归档'));
  return resolved.title + (archived ? '（已归档）' : '');
}
export function artIssues(store: ArtStore, sources: ArtSources): string[] {
  const issues: string[] = [], pairs = new Set<string>();
  for (const requirement of store.requirements) {
    if (!requirement.name.trim()) issues.push('有美术需求尚未命名');
    const seen = new Set<string>();
    for (const source of requirement.sources) {
      const tuple = JSON.stringify([source.kind, source.targetId, source.sourceKind, source.sourceId]);
      if (seen.has(tuple)) issues.push('需求存在重复来源：' + requirement.name + ' / ' + artSourceText(source, sources));
      seen.add(tuple); issues.push(...sourceParts(source, sources).issues.map(i => requirement.name + '：' + i));
    }
    if (requirement.status === '已通过') issues.push(...artRequirementReadiness(requirement.id, store).issues.map(i => '已通过需求“' + requirement.name + '”：' + i));
  }
  for (const asset of store.assets) {
    if (!asset.name.trim()) issues.push('有美术资产尚未命名');
    for (const version of asset.versions) if (!version.files.length) issues.push(asset.name + ' / ' + version.name + '：版本没有文件');
    if (asset.adoptedVersionId) {
      const adopted = asset.versions.find(v => v.id === asset.adoptedVersionId);
      if (!adopted) issues.push(asset.name + '：采用版本已失效（' + asset.adoptedVersionId + '）');
      else if (!canAdoptVersion(adopted)) issues.push(asset.name + '：当前采用版本不满足采用条件');
    }
  }
  for (const link of store.links) {
    const requirement = store.requirements.find(r => r.id === link.requirementId), asset = store.assets.find(a => a.id === link.assetId);
    const pair = JSON.stringify([link.requirementId, link.assetId]);
    if (pairs.has(pair)) issues.push('重复需求资产关联：' + link.requirementId + ' → ' + link.assetId); pairs.add(pair);
    if (!requirement) issues.push('关联需求已失效（' + (link.requirementId || '尚未选择') + '）');
    else if (requirement.archived) issues.push('关联需求已归档：' + requirement.name);
    if (!asset) issues.push('关联资产已失效（' + (link.assetId || '尚未选择') + '）');
    else if (asset.archived) issues.push('关联资产已归档：' + asset.name);
  }
  return [...new Set(issues)];
}

const text = (value: string) => value.trim() || '待补充';
const adoptedText = (asset: ArtAsset) => {
  const version = asset.versions.find(v => v.id === asset.adoptedVersionId);
  return version ? text(version.name) + ' [版本 ID：' + version.id + '] · ' + (version.placeholder ? '占位' : '正式') + ' · ' + version.review : asset.adoptedVersionId ? '采用版本已失效（' + asset.adoptedVersionId + '）' : '尚未采用';
};
export function artReferencesMarkdown(kind: 'gameplay' | 'capability', id: string, store: ArtStore, sources: ArtSources): string {
  const requirements = store.requirements.filter(r => r.sources.some(s => s.kind === kind && s.targetId === id));
  const lines = ['#### 美术需求与资产', ''];
  if (!requirements.length) lines.push('暂无关联美术需求。');
  for (const requirement of requirements) {
    lines.push(`- ${text(requirement.name)} [需求 ID：${requirement.id}] · ${requirement.status}${requirement.archived ? '（已归档）' : ''}`);
    for (const source of requirement.sources.filter(s => s.kind === kind && s.targetId === id)) lines.push('  - 来源：' + artSourceText(source, sources) + '；' + text(source.note));
    for (const link of store.links.filter(l => l.requirementId === requirement.id)) {
      const asset = store.assets.find(a => a.id === link.assetId);
      lines.push('  - 资产：' + (asset ? text(asset.name) : '已失效') + ' [资产 ID：' + link.assetId + ']；' + (asset ? adoptedText(asset) : '关联已失效') + (asset?.archived ? '（资产已归档）' : ''));
    }
  }
  return lines.join('\n') + '\n';
}
export function artAssetsMarkdown(store: ArtStore, sources: ArtSources): string {
  const lines = ['## 美术资产', '', '> 需求与资产独立维护，一个资产可以服务多个需求。占位版本可用于原型，但不代表正式验收完成。', '', '### 美术需求', ''];
  if (!store.requirements.length) lines.push('暂无美术需求。', '');
  for (const requirement of store.requirements) {
    lines.push('#### ' + text(requirement.name), '', '- 需求 ID：' + requirement.id, '- 所属分类：' + artCategoryName(artLibrary(store), artCategoryId(artLibrary(store), 'requirement', requirement.id)), '- 分类：' + requirement.category, '- 状态：' + requirement.status + (requirement.archived ? '（已归档）' : ''), '- 优先级：' + requirement.priority, '- 负责人：' + text(requirement.owner), '- 截止日期：' + (requirement.dueDate || '未设置'), '', '需求说明：', text(requirement.description), '', '制作规格：', text(requirement.specification), '', '验收标准：', text(requirement.acceptance), '', '需求来源：');
    if (!requirement.sources.length) lines.push('- 尚未关联来源。');
    for (const source of requirement.sources) {
      const resolved = sourceParts(source, sources);
      lines.push(`- ${artSourceText(source, sources)} [${source.kind === 'gameplay' ? '玩法' : '功能'} ID：${source.targetId}；来源 ID：${source.sourceId || '整体'}]；用途：${text(source.note)}`);
      if (resolved.detail) lines.push('  需求上下文：' + resolved.detail);
    }
    lines.push('', '关联资产：');
    const links = store.links.filter(l => l.requirementId === requirement.id);
    if (!links.length) lines.push('- 暂无关联资产。');
    for (const link of links) {
      const asset = store.assets.find(a => a.id === link.assetId);
      lines.push(`- ${asset ? text(asset.name) : '资产已失效'} [资产 ID：${link.assetId}]；${asset ? adoptedText(asset) : '无有效采用版本'}；用途：${text(link.note)}`);
    }
    const readiness = artRequirementReadiness(requirement.id, store);
    lines.push('', '正式版本就绪检查：' + (readiness.ready ? '关联资产全部采用了已通过的正式版本；需求最终状态仍由人工确认。' : readiness.issues.join('；')), '');
  }
  lines.push('### 资产库', '');
  if (!store.assets.length) lines.push('暂无美术资产。', '');
  for (const asset of store.assets) {
    lines.push('#### ' + text(asset.name), '', '- 资产 ID：' + asset.id, '- 所属分类：' + artCategoryName(artLibrary(store), artCategoryId(artLibrary(store), 'asset', asset.id)), '- 归档：' + (asset.archived ? '是' : '否'), '- 当前采用：' + adoptedText(asset), '', text(asset.description), '', '服务需求：');
    const links = store.links.filter(l => l.assetId === asset.id);
    if (!links.length) lines.push('- 暂无关联需求。');
    for (const link of links) {
      const requirement = store.requirements.find(r => r.id === link.requirementId);
      lines.push(`- ${requirement ? text(requirement.name) : '需求已失效'} [需求 ID：${link.requirementId}]；${text(link.note)}`);
    }
    lines.push('', '版本历史：');
    if (!asset.versions.length) lines.push('- 尚未上传版本。');
    for (const version of asset.versions) {
      lines.push('', '##### ' + text(version.name), '', '- 版本 ID：' + version.id, '- 类型：' + (version.placeholder ? '占位版本' : '正式版本'), '- 审核：' + version.review, '- 采用：' + (asset.adoptedVersionId === version.id ? '是' : '否'), '- 创建时间：' + version.createdAt, '', '版本说明：' + text(version.notes), '', '审核反馈：' + text(version.feedback), '', '文件：');
      if (!version.files.length) lines.push('- 无文件。');
      for (const file of version.files) lines.push(`- ${file.name} [文件 ID：${file.id}] · ${file.size} 字节 · ${file.mime || '未知类型'}；存储标识：${file.storagePath}`);
    }
    lines.push('');
  }
  const lost = store.links.filter(l => !store.requirements.some(r => r.id === l.requirementId) && !store.assets.some(a => a.id === l.assetId));
  if (lost.length) lines.push('### 两端失效的资产关联', '', ...lost.map(l => `- 需求 ${l.requirementId} → 资产 ${l.assetId}；${text(l.note)}`), '');
  const issues = artIssues(store, sources);
  if (issues.length) lines.push('### 美术引用与审核检查', '', ...issues.map(i => '- ' + i), '');
  return lines.join('\n');
}
