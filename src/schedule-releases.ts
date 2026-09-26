import type { ProductionMilestone, ProductionRelease, ProjectScheduleStore } from './project-schedule.ts';

const versionPrefix = /^\s*(v\d+(?:\.\d+){1,3}(?:-[a-z0-9.]+)?)\s*[·|｜:：-]\s*(?=\S)/i;

// Reading old plans is non-destructive. Explicit releases (even []) end inference.
export function withScheduleReleases(store: ProjectScheduleStore): ProjectScheduleStore {
  if (store.releases !== undefined) return store;
  const groups = new Map<string, ProductionMilestone[]>();
  for (const m of store.milestones) {
    const version = versionPrefix.exec(m.title)?.[1].toLowerCase();
    if (version && m.releaseId === undefined) groups.set(version, [...(groups.get(version) ?? []), m]);
  }
  if (!groups.size) return store;
  const used = new Set([...store.tasks, ...store.milestones].map(r => r.id));
  const releases: ProductionRelease[] = [], assignments = new Map<string, { id: string; shared: string }>();
  for (const [title, milestones] of groups) {
    let id = 'legacy-release-' + title;
    while (used.has(id)) id += '-version';
    used.add(id);
    const shared = milestones.length > 1 && milestones[0].description.trim() && milestones.every(m => m.description === milestones[0].description) ? milestones[0].description : '';
    releases.push({ id, title, description: shared });
    for (const m of milestones) assignments.set(m.id, { id, shared });
  }
  return { ...store, releases, milestones: store.milestones.map(m => {
    const group = assignments.get(m.id);
    return group ? { ...m, releaseId: group.id, description: group.shared ? '' : m.description } : { ...m, releaseId: m.releaseId ?? '' };
  }) };
}

export function removeScheduleRelease(store: ProjectScheduleStore, id: string): ProjectScheduleStore {
  return { ...store, releases: (store.releases ?? []).filter(r => r.id !== id), milestones: store.milestones.map(m => m.releaseId === id ? { ...m, releaseId: '' } : m) };
}

export function scheduleReleaseGroups(store: ProjectScheduleStore) {
  const groups = (store.releases ?? []).map(release => ({ release, milestones: store.milestones.filter(m => m.releaseId === release.id) }));
  const latest = (items: ProductionMilestone[]) => items.reduce((date, m) => m.due > date ? m.due : date, '');
  groups.sort((a, b) => latest(b.milestones).localeCompare(latest(a.milestones)) || b.release.title.localeCompare(a.release.title, undefined, { numeric: true }));
  const known = new Set(groups.map(g => g.release.id));
  const ungrouped = store.milestones.filter(m => !m.releaseId || !known.has(m.releaseId));
  return [...groups, ...(ungrouped.length ? [{ release: null, milestones: ungrouped }] : [])];
}

export function milestoneDisplayTitle(m: ProductionMilestone, release?: ProductionRelease | null) {
  const prefix = versionPrefix.exec(m.title);
  return prefix && release?.title.toLowerCase() === prefix[1].toLowerCase() ? m.title.slice(prefix[0].length) : m.title;
}
