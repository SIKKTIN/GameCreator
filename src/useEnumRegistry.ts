import { logDebug } from './debug-log';
import { workspaceStorage } from './workspace-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { scanEngineProject, type EngineConfig } from './engine';
import { projectIdentity, type ProjectData } from './data-model';
import {
  decideChanges, syncApprovedChanges, upgradeApprovalReview, diffEnums, emptyStore, exportIssues, makeSnapshot, planRelease, prepareScan,
  rollback, rollbackPlan, snapshotById, stageSnapshot, replaceProjectData, type VersionStore,
} from './enum-versions';
import { readVersions, writeVersions } from './enum-storage';

export function useEnumRegistry(config: EngineConfig, initial: ProjectData, username = '本地用户', workspaceId = projectIdentity(config.projectPath)) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const key = 'gamecreator.enum-versions.v1:' + workspaceId;
  const sourceConfigured = !!config.projectPath.trim() && !!config.enumPath.trim();
  const loaded = useMemo(() => {
    try { return { store: upgradeApprovalReview(readVersions(workspaceStorage, key, initial)), error: '' }; }
    catch (reason) { return { store: emptyStore(initial), error: '版本存档读取失败：' + String(reason) }; }
  }, [key, initial]);
  const [frame, setFrame] = useState({ key, store: loaded.store });
  const store = frame.key === key ? frame.store : loaded.store;
  const latest = useRef({ key, store });
  latest.current = { key, store };
  const [scanState, setScanState] = useState({ key, loading: false, error: '' });
  const [actionState, setActionState] = useState({ key, busy: false, error: '' });
  const request = useRef<{ generation: number; controller?: AbortController }>({ generation: 0 });

  const mutate = useCallback(async (operation: (current: VersionStore) => VersionStore | Promise<VersionStore>, action = '保存枚举') => {
    setActionState({ key, busy: true, error: '' });
    try {
      if (!navigator.locks) throw new Error('当前浏览器不支持版本写入锁，请使用本地 Chrome/Edge 页面');
      await navigator.locks.request(key, async () => {
        if (!mounted.current || latest.current.key !== key) throw new Error('工程已切换，已取消操作');
        const previous = latest.current.store;
        const disk = readVersions(workspaceStorage, key, initial);
        if (disk.revision !== previous.revision) throw new Error('其他页面已更新版本，请重新载入后审核');
        const next = await operation(previous);
        if (!mounted.current || latest.current.key !== key) throw new Error('工程已切换，已取消操作');
        const committed = writeVersions(workspaceStorage, key, previous.revision, next);
        latest.current = { key, store: committed };
        setFrame({ key, store: committed });
      });
      setActionState({ key, busy: false, error: '' });
      logDebug(action, 'success', '修订号 ' + latest.current.store.revision, key);
      return true;
    } catch (reason) {
      setActionState({ key, busy: false, error: '操作未保存：' + (reason instanceof Error ? reason.message : String(reason)) });
      logDebug(action, 'error', String(reason), key);
      return false;
    }
  }, [key, initial]);

  const refresh = useCallback(async () => {
    request.current.controller?.abort();
    if (!sourceConfigured) {
      request.current.generation += 1;
      setScanState({ key, loading: false, error: '' });
      return;
    }
    const controller = new AbortController();
    const generation = ++request.current.generation;
    request.current.controller = controller;
    setScanState({ key, loading: true, error: '' });
    try {
      const scan = prepareScan(await scanEngineProject(config, controller.signal));
      const source = await makeSnapshot(scan, 'source');
      if (controller.signal.aborted || generation !== request.current.generation) return;
      await mutate((current) => {
        if (controller.signal.aborted) throw new Error('扫描已取消');
        const next = stageSnapshot(current, source);
        return next;
      }, '扫描与导入');
      if (generation === request.current.generation) setScanState({ key, loading: false, error: '' });
    } catch (reason) {
      if (controller.signal.aborted || generation !== request.current.generation) return;
      logDebug('扫描', 'error', String(reason), key);
      setScanState({ key, loading: false, error: '扫描失败：' + (reason instanceof Error ? reason.message : String(reason)) });
    }
  }, [key, config.projectPath, config.enumPath, sourceConfigured, mutate]);

  useEffect(() => {
    setFrame({ key, store: loaded.store });
    const receive = (event: StorageEvent) => {
      if (event.key !== key) return;
      try {
        const next = upgradeApprovalReview(readVersions(workspaceStorage, key, initial));
        latest.current = { key, store: next };
        setFrame({ key, store: next });
      } catch (reason) { setActionState({ key, busy: false, error: String(reason) }); }
    };
    window.addEventListener('storage', receive);
    return () => window.removeEventListener('storage', receive);
  }, [key, loaded, initial]);

  useEffect(() => {
    const sources = latest.current.store.snapshots.filter((snapshot) => snapshot.kind === 'source');
    const last = sources[sources.length - 1];
    const path = config.enumPath.trim().replace(/\\/g, '/');
    if (!sourceConfigured) setScanState({ key, loading: false, error: '' });
    else if (!last || projectIdentity(last.scan.projectPath) !== projectIdentity(config.projectPath) || last.scan.enumPath !== path) void refresh();
    return () => { request.current.controller?.abort(); request.current.generation += 1; };
  }, [key, config.projectPath, config.enumPath, sourceConfigured, refresh]);

  const active = snapshotById(store, store.activeId);
  const candidate = snapshotById(store, store.candidateId);
  const review = candidate ? store.reviews[candidate.id] : null;
  const sources = store.snapshots.filter((snapshot) => snapshot.kind === 'source');
  const lastSource = sources[sources.length - 1];
  const publish = () => mutate((current) => {
    if (current.candidateId !== candidate?.id || current.activeId !== store.activeId) throw new Error('审核基准版本已变化，请重新审核');
    return syncApprovedChanges(current);
  }, '同步');
  const plan = planRelease(store);
  const blockingIssues = exportIssues(store.data, active?.scan ?? null);
  return {
    key, store, sourceConfigured, data: store.data, active, candidate, review,
    scan: active?.scan ?? null, ready: !!active,
    latestScan: lastSource?.scan ?? null, updatedAt: active?.createdAt ?? '',
    changes: candidate ? diffEnums(active?.scan ?? null, candidate.scan) : [],
    plan, rollbackPlan: rollbackPlan(store), blockingIssues, canExport: blockingIssues.length === 0,
    loading: scanState.key === key && scanState.loading,
    busy: actionState.key === key && actionState.busy,
    error: (actionState.key === key ? actionState.error : '') || (scanState.key === key ? scanState.error : '') || loaded.error,
    refresh, publish,
    decide: (ids: string[], agree: boolean) => mutate(current => {
      if (current.candidateId !== candidate?.id || current.activeId !== store.activeId) throw new Error('候选版本已变化，请重新检查');
      return decideChanges(current, ids, agree, username);
    }, '审核决定'),
    updateData: (data: ProjectData) => mutate((current) => replaceProjectData(current, store.data, data), '配置编辑'),
    rollback: () => mutate((current) => rollback(current), '回退'),
  };
}
export type EnumRegistry = ReturnType<typeof useEnumRegistry>;
