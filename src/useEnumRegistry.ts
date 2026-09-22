import {sameEngineSource,engineSourceKey} from '../shared/engine-config.mjs';
import { logDebug } from './debug-log';
import { workspaceStorage } from './workspace-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { scanEngineProject, type EngineConfig } from './engine';
import { projectIdentity, type ProjectData } from './data-model';
import {
  confirmEnumSource, decideChanges, syncApprovedChanges, upgradeApprovalReview, diffEnums, emptyStore, exportIssues, makeSnapshot, planRelease, prepareScan,
  rollback, rollbackPlan, snapshotById, stageSnapshot, replaceProjectData, type VersionStore,
} from './enum-versions';
import { readVersions, writeVersions } from './enum-storage';

export function useEnumRegistry(config: EngineConfig, initial: ProjectData, username = '本地用户', workspaceId = projectIdentity(config.projectPath)) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const key = 'gamecreator.enum-versions.v1:' + workspaceId;
  const configNow=useRef(config);configNow.current=config;
  const sourceKey=engineSourceKey(config);
  const sourceConfigured = !!config.projectPath.trim() && !!config.enumPath.trim();
  const loaded = useMemo(() => {
    try { return { store: upgradeApprovalReview(readVersions(workspaceStorage, key, initial)), error: '' }; }
    catch (reason) { return { store: emptyStore(initial), error: '版本存档读取失败：' + String(reason) }; }
  }, [key, initial]);
  const [frame, setFrame] = useState({ key, store: loaded.store });
  const store = frame.key === key ? frame.store : loaded.store;
  const latest = useRef({ key, store });
  latest.current = { key, store };
  const [scanState, setScanState] = useState({ key:sourceKey, loading: false, error: '' });
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
      setScanState({ key:sourceKey, loading: false, error: '' });
      return;
    }
    const controller = new AbortController();
    const generation = ++request.current.generation;
    request.current.controller = controller;
    setScanState({ key:sourceKey, loading: true, error: '' });
    try {
      const scan = prepareScan(await scanEngineProject(config, controller.signal));
      const source = await makeSnapshot(scan, 'source');
      if (controller.signal.aborted || generation !== request.current.generation) return;
      await mutate((current) => {
        if (controller.signal.aborted||!sameEngineSource(config,configNow.current)) throw new Error('扫描已取消');
        const next = stageSnapshot(current, source);
        return next;
      }, '扫描与导入');
      if (generation === request.current.generation) setScanState({ key:sourceKey, loading: false, error: '' });
    } catch (reason) {
      if (controller.signal.aborted || generation !== request.current.generation) return;
      logDebug('扫描', 'error', String(reason), key);
      setScanState({ key:sourceKey, loading: false, error: '扫描失败：' + (reason instanceof Error ? reason.message : String(reason)) });
    }
  }, [key, sourceKey, sourceConfigured, mutate]);

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
    if (!sourceConfigured) setScanState({ key:sourceKey, loading: false, error: '' });
    else if (!last || !sameEngineSource(last.scan,config)) void refresh();
    return () => { request.current.controller?.abort(); request.current.generation += 1; };
  }, [key, sourceKey, sourceConfigured, refresh]);

  const active = snapshotById(store, store.activeId);
  const storedCandidate = snapshotById(store, store.candidateId);
  const candidate = sourceConfigured&&sameEngineSource(storedCandidate?.scan,config)?storedCandidate:undefined;
  const review = candidate ? store.reviews[candidate.id] : null;
  const sources = store.snapshots.filter((snapshot) => snapshot.kind === 'source'&&sameEngineSource(snapshot.scan,config));
  const lastSource = sources[sources.length - 1];
  const publish = () => mutate((current) => {
    if (!sameEngineSource(snapshotById(current,current.candidateId)?.scan,configNow.current)||current.candidateId !== candidate?.id || current.activeId !== store.activeId) throw new Error('审核基准版本已变化，请重新审核');
    return syncApprovedChanges(current);
  }, '同步');
  const plan = planRelease(candidate?store:{...store,candidateId:null});
  const sourceWarning=active&&!sameEngineSource(active.scan,config)?'引擎来源已切换，当前枚举定义仍来自旧来源；新扫描结果需重新审核。':active?.scan.groups.some(g=>(g.engine||'oasis-lua')!==config.engine)?'当前版本保留了其他引擎的枚举，请在审核中处理并检查字段绑定。':'';
  const blockingIssues = exportIssues(store.data, active?.scan ?? null);
  return {
    key, store, sourceConfigured, sourceWarning, data: store.data, active, candidate, review,
    scan: active?.scan ?? null, ready: !!active,
    latestScan: lastSource?.scan ?? null, updatedAt: active?.createdAt ?? '',
    changes: candidate ? diffEnums(active?.scan ?? null, candidate.scan) : [],
    plan, rollbackPlan: rollbackPlan(store), blockingIssues, canExport: blockingIssues.length === 0,
    loading: scanState.key === sourceKey && scanState.loading,
    busy: actionState.key === key && actionState.busy,
    error: (actionState.key === key ? actionState.error : '') || (scanState.key === sourceKey ? scanState.error : '') || loaded.error,
    refresh, publish,
    reload: () => {
      if(actionState.busy||scanState.loading)return false;
      try { const next=upgradeApprovalReview(readVersions(workspaceStorage,key,initial));latest.current={key,store:next};setFrame({key,store:next});setActionState({key,busy:false,error:''});return true; }
      catch(reason){setActionState({key,busy:false,error:String(reason)});return false;}
    },
    canConfirmSource:!!candidate&&!!active&&!sameEngineSource(active.scan,candidate.scan)&&!candidate.scan.incomplete&&!diffEnums(active.scan,candidate.scan).length,
    confirmSource:()=>mutate(current=>{if(!sameEngineSource(snapshotById(current,current.candidateId)?.scan,configNow.current))throw new Error('来源已变化');return confirmEnumSource(current,username);},'确认枚举来源'),
    decide: (ids: string[], agree: boolean) => mutate(current => {
      if (!sameEngineSource(snapshotById(current,current.candidateId)?.scan,configNow.current)||current.candidateId !== candidate?.id || current.activeId !== store.activeId) throw new Error('候选版本已变化，请重新检查');
      return decideChanges(current, ids, agree, username);
    }, '审核决定'),
    updateData: (data: ProjectData) => mutate((current) => replaceProjectData(current, store.data, data), '配置编辑'),
    rollback: () => mutate((current) => rollback(current), '回退'),
  };
}
export type EnumRegistry = ReturnType<typeof useEnumRegistry>;
