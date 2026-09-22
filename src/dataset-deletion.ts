import type { ProjectData } from './data-model.ts';
import type { GameplayStore } from './gameplay.ts';
import type { FunctionalStore } from './functional-systems.ts';
import type { TaskFlowStore } from './task-flow.ts';
import type { NumericalAnalysisStore } from './numerical-analysis.ts';

export type DatasetDeletionSources = {
  gameplay: Pick<GameplayStore, 'designs'>; functional: FunctionalStore;
  tasks: TaskFlowStore; analysis: NumericalAnalysisStore;
};

export function datasetReferences(data: ProjectData, key: string, sources: DatasetDeletionSources): string[] {
  // Archived designs still own references. Self-references disappear with the table.
  return [
    ...Object.entries(data.columns).filter(([table]) => table !== key).flatMap(([table, columns]) =>
      columns.filter(c => c.type === 'reference' && c.reference === key).map(c => '配置表 / ' + table + ' / ' + c.label)),
    ...sources.gameplay.designs.filter(d => d.links.some(l => l.kind === 'dataset' && l.targetId === key)).map(d => '玩法设计 / ' + d.title),
    ...sources.functional.capabilities.filter(c => c.configRefs.some(r => r.datasetKey === key)).map(c => '功能系统 / ' + c.name),
    ...sources.tasks.tasks.filter(t => t.references.some(r => r.kind === 'table' && r.targetId === key)).map(t => '任务与流程 / ' + t.title),
    ...sources.analysis.plans.filter(p => p.batch?.table === key || p.parameters.some(v => v.binding.kind === 'cell' && v.binding.table === key)).map(p => '数值分析 / ' + p.name),
  ];
}

export function removeDataset(data: ProjectData, key: string, references: string[]): ProjectData {
  if (!Object.prototype.hasOwnProperty.call(data.datasets, key)) throw new Error('配置表不存在，请重新打开表目录');
  if (references.length) throw new Error('请先解除以下引用，再删除：\n' + references.join('\n'));
  const next = { ...data, datasets: { ...data.datasets }, columns: { ...data.columns } };
  delete next.datasets[key]; delete next.columns[key];
  if (data.jsonFormats) { next.jsonFormats = { ...data.jsonFormats }; delete next.jsonFormats[key]; }
  return next;
}

