import { initialMilestones, initialProject } from './project-defaults.ts';
import type { SavedProject } from './project-catalog.ts';

export type OverviewInfo = { name: string; genre: string; platform: string; version: string; status: string; description: string };
export type MilestoneFields = { title: string; owner: string; due: string; status: 'planned' | 'active' | 'done' };
export type TeamRecord<F> = { id: string; fields: F; revision: number; updatedAt: string | null; updatedBy: string | null; initialized?: boolean };
export type OverviewPublication = { info: OverviewInfo; milestones: MilestoneFields[] };
export type LocalOverviewPreview = OverviewPublication & { signature: string };
export const sameRecordFields = (a: unknown, b: unknown) => {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return a === b;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => Object.prototype.hasOwnProperty.call(right, key) && left[key] === right[key]);
};
export const overviewLabels: Record<keyof OverviewInfo, string> = { name:'项目名称',genre:'项目类型',platform:'目标平台',version:'当前版本',status:'项目状态',description:'项目简介' };
export const overviewLimits = { name:100,genre:80,platform:120,version:80,status:80,description:10000 };
export const milestoneLabels: Record<keyof MilestoneFields,string> = { title:'里程碑名称',owner:'负责人',due:'日期',status:'里程碑状态' };
const text = (value: unknown, label: string, limit: number, required = false) => {
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) throw new Error(`${label}无效或过长`);
  return required ? value.trim() : value;
};
export function normalizeInfo(input: unknown, draft = false, nameLimit = 100): OverviewInfo {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('项目基本信息格式异常');
  const value = input as OverviewInfo;
  return Object.fromEntries((Object.keys(overviewLabels) as (keyof OverviewInfo)[]).map(key =>
    [key,text(value[key],overviewLabels[key],key === 'name' ? nameLimit : overviewLimits[key],key === 'name' && !draft)])) as OverviewInfo;
}
export function normalizeMilestone(input: unknown, draft = false): MilestoneFields {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('里程碑格式异常');
  const value = input as MilestoneFields;
  if (!['planned','active','done'].includes(value.status)) throw new Error('里程碑状态无效');
  return { title:text(value.title,'里程碑名称',160,!draft), owner:text(value.owner,'负责人',80),due:text(value.due,'日期',40),status:value.status };
}
export function readLocalOverview(storage: Pick<Storage,'getItem'>, project: SavedProject): LocalOverviewPreview {
  const raw = storage.getItem(`gamecreator.workspace.v1:${project.id}:project`);
  let metadata: unknown, milestones: unknown;
  try {
    metadata = raw === null ? {} : JSON.parse(raw);
    const milestoneRaw = storage.getItem(`gamecreator.workspace.v1:${project.id}:milestones`);
    milestones = milestoneRaw === null ? (project.initialContent === 'legacy' ? initialMilestones : []) : JSON.parse(milestoneRaw);
  } catch { throw new Error('本地概览存档读取失败，请修复后重试。'); }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('本地项目概览存档格式异常');
  const defaults = project.initialContent === 'legacy' ? initialProject : { ...initialProject,name:project.name,version:'v0.1.0',description:'' };
  const info = normalizeInfo({ ...defaults,name:project.name,...metadata },false,1000);
  if (!Array.isArray(milestones) || milestones.length > 200) throw new Error('本地里程碑存档异常，最多支持 200 项。');
  const value = { info, milestones: milestones.map(item => normalizeMilestone(item)) };
  return { ...value, signature:JSON.stringify(value) };
}
