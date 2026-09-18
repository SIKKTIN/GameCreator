import type { EngineConfig, EnumScan } from './engine';
import { enumId, projectIdentity, type ProjectData } from './data-model.ts';
import { emptyStore, stageSnapshot, makeSnapshot, prepareScan, decideChanges, diffEnums, publishRelease } from './enum-versions.ts';

export const testScenarios = [
  { id: 'first', name: '首次导入', expected: '没有稳定版本；同意并同步后才出现枚举定义。' },
  { id: 'unchanged', name: '无变化', expected: '来源与已发布定义一致，新增、删除、修改均为 0。' },
  { id: 'added', name: '新增成员', expected: 'C 显示绿色；同步前定义仍只有 A、B。' },
  { id: 'removed', name: '删除成员', expected: 'B 显示红色；同意同步后从定义中移除。' },
  { id: 'modified', name: '修改成员', expected: 'A 显示黄色；只读差异为 1 → 11。' },
  { id: 'mixed', name: '混合变化', expected: '新增 C、删除 B、修改 A；可部分同意，核对部分同步结果。' },
  { id: 'referenced', name: '删除被引用成员', expected: 'B 被测试记录使用，同意删除后同步仍被阻止；先到数据配置将引用改为 A。' },
  { id: 'error', name: '异常来源', expected: '目录不存在，检测失败；已发布的 A、B 仍可查看和使用。' },
] as const;
export type TestScenarioId = typeof testScenarios[number]['id'];
export type PreparedTest = { id: string; scenario: TestScenarioId; config: EngineConfig; baseline: EnumScan | null; incoming: EnumScan | null };
export type TestSession = { id: string; scenario: TestScenarioId; config: EngineConfig; baselineId: string | null;
  expectedChanges: { added: number; removed: number; modified: number }; createdAt: string };
export async function buildTestWorkspace(prepared: PreparedTest, username: string) {
  const data: ProjectData = { datasets: {}, columns: {} };
  for (const table of ['items', 'characters', 'skills', 'economy', 'shop']) {
    data.datasets[table] = []; data.columns[table] = [{ key: 'id', label: 'ID' }, { key: 'name', label: '名称' }];
  }
  const group = prepared.baseline?.groups[0] ?? prepared.incoming?.groups[0];
  data.columns.items.push({ key: 'mode', label: '测试枚举', type: 'enum', enumId: group ? enumId(group) : '' });
  data.datasets.items.push({ id: 'test_item', name: '测试记录', mode: prepared.scenario === 'referenced' ? 'B' : 'A' });
  let store = emptyStore(data);
  const baseline = prepared.baseline ? prepareScan(prepared.baseline) : null;
  const incoming = prepared.incoming ? prepareScan(prepared.incoming) : null;
  if (baseline) {
    store = stageSnapshot(store, await makeSnapshot(baseline, 'source'));
    store = await publishRelease(decideChanges(store, diffEnums(null, baseline).map(change => change.id), true, username + '（测试基线）'));
  }
  const baselineId = store.activeId;
  if (incoming) store = stageSnapshot(store, await makeSnapshot(incoming, 'source'));
  const changes = incoming ? diffEnums(baseline, incoming) : [];
  const session: TestSession = { id: prepared.id, scenario: prepared.scenario, config: prepared.config, baselineId,
    expectedChanges: { added: changes.filter(change => change.kind.startsWith('add-')).length,
      removed: changes.filter(change => change.kind.startsWith('remove-')).length,
      modified: changes.filter(change => !change.kind.startsWith('add-') && !change.kind.startsWith('remove-')).length },
    createdAt: new Date().toISOString() };
  return { key: 'gamecreator.enum-versions.v1:' + projectIdentity(prepared.config.projectPath), store, session };
}
