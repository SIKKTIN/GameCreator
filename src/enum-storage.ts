import { emptyStore, type VersionStore } from './enum-versions.ts';
import type { ProjectData } from './data-model';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export function readVersions(storage: StorageLike, key: string, initial: ProjectData): VersionStore {
  const raw = storage.getItem(key);
  if (!raw) return emptyStore(initial);
  const value = JSON.parse(raw) as VersionStore;
  if (value.schema !== 1 || !Number.isInteger(value.revision) || !Array.isArray(value.snapshots) ||
    !Array.isArray(value.releases) || !value.reviews || !value.data?.columns || !value.data?.datasets ||
    (value.activeId && !value.snapshots.some((snapshot) => snapshot.id === value.activeId && snapshot.kind === 'release')) ||
    (value.candidateId && !value.snapshots.some((snapshot) => snapshot.id === value.candidateId && snapshot.kind === 'source'))) {
    throw new Error('版本存档格式异常，已停止写入，避免覆盖现有记录');
  }
  for (const table of ['items', 'characters', 'skills', 'economy', 'shop'] as const) {
    if (!Array.isArray(value.data.columns[table]) || !Array.isArray(value.data.datasets[table])) throw new Error('数据草稿存档不完整');
    if (value.data.columns[table].some((column) => typeof column?.key !== 'string' || typeof column.label !== 'string') ||
      value.data.datasets[table].some((row) => typeof row?.id !== 'string' || Object.values(row).some((field) => typeof field !== 'string'))) {
      throw new Error('数据草稿存档格式异常');
    }
  }
  if (value.snapshots.some((snapshot) => !snapshot || typeof snapshot.id !== 'string' || typeof snapshot.checksum !== 'string' ||
    typeof snapshot.createdAt !== 'string' || !snapshot.scan || !Array.isArray(snapshot.scan.groups) ||
    !Array.isArray(snapshot.scan.files) || !Array.isArray(snapshot.scan.orderTables) || !Array.isArray(snapshot.scan.dynamic) ||
    !snapshot.scan.counts || snapshot.scan.groups.some((group) => typeof group?.name !== 'string' || typeof group.source !== 'string' ||
      !Array.isArray(group.members) || group.members.some((member) => typeof member?.key !== 'string' ||
        (typeof member.value !== 'number' && typeof member.value !== 'string')))) ||
    Object.values(value.reviews).some((review) => !review || !Array.isArray(review.selected) || !Array.isArray(review.acknowledged) ||
      (review.declined !== undefined && (!Array.isArray(review.declined) || review.declined.some(id => typeof id !== 'string'))) ||
      !review.migrations || typeof review.reviewer !== 'string' || typeof review.note !== 'string') ||
    value.releases.some((release) => !release || !Array.isArray(release.patches) || !Array.isArray(release.accepted))) {
    throw new Error('版本快照或审核记录异常，已停止加载');
  }
  return value;
}

// Caller holds a Web Lock across revision checking and the single atomic setItem.
export function writeVersions(storage: StorageLike, key: string, expected: number, next: VersionStore): VersionStore {
  const raw = storage.getItem(key);
  const revision = raw ? (JSON.parse(raw) as VersionStore).revision : 0;
  if (revision !== expected) throw new Error('其他页面已修改此工程，请重新载入最新版本后再操作');
  const committed = { ...next, revision: expected + 1 };
  const serialized = JSON.stringify(committed);
  storage.setItem(key, serialized);
  return JSON.parse(serialized) as VersionStore;
}
