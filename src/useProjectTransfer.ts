import { useEffect, useRef, useState, type RefObject } from 'react';
import { beforeLogoutEvent } from './auth';
import { leaveTeamEvent } from './team-api';
import { logDebug } from './debug-log';
import { workspaceStorage } from './workspace-storage';
import { captureProjectPackage, prepareProjectPackageImport, validateProjectPackage, writeProjectPackageImport } from './project-package';
import type { SavedProject } from './project-catalog';
import type { useProjectCatalog } from './useProjectCatalog';
import type { ProjectTransferState } from './ProjectPackageDialog';

const message = (error: unknown) => error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);

export function useProjectTransfer({ projects, lock, allowed, allowSwitch, onImported }: {
  projects: ReturnType<typeof useProjectCatalog>; lock: RefObject<boolean>; allowed: boolean;
  allowSwitch: () => boolean; onImported: () => void;
}) {
  const [state, setState] = useState<ProjectTransferState | null>(null);
  const operating = useRef(false);
  const exporting = useRef<SavedProject | null>(null);
  const token = useRef<string | null>(null);
  const service = window.desktopClient?.projectPackages;
  const enabled = !!service && allowed;
  const busy = !!state?.busy;
  useEffect(() => {
    const guard = (event: Event) => { if (operating.current) event.preventDefault(); };
    const closing = (event: BeforeUnloadEvent) => { if (operating.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener(beforeLogoutEvent, guard);
    window.addEventListener(leaveTeamEvent, guard);
    window.addEventListener('beforeunload', closing);
    return () => {
      window.removeEventListener(beforeLogoutEvent, guard);
      window.removeEventListener(leaveTeamEvent, guard);
      window.removeEventListener('beforeunload', closing);
    };
  }, []);
  function release() {
    if (token.current) void service?.release(token.current).catch(() => {});
    token.current = null;
  }
  function close() {
    if (operating.current) return;
    release(); setState(null); exporting.current = null;
  }
  async function choose(mode: 'import' | 'export', project?: SavedProject) {
    if (!enabled || !service || lock.current || projects.blocked || !allowSwitch()) return;
    release();
    lock.current = true; operating.current = true;
    setState({ mode, busy: true });
    try {
      if (mode === 'export') {
        const source = project ?? exporting.current;
        if (!source) throw new Error('请选择需要导出的本地项目');
        exporting.current = source;
        const snapshot = captureProjectPackage(workspaceStorage, source);
        const result = await service.exportFolder({ projectId: source.id, ...snapshot });
        if (!result) { setState(null); return; }
        setState({ mode, busy: false, ...result });
        logDebug('导出项目', 'success', result.directory);
      } else {
        const selected = await service.chooseImport();
        if (!selected) { setState(null); return; }
        token.current = selected.token;
        const document = validateProjectPackage(selected.document);
        setState({ mode, busy: false, document, token: selected.token });
      }
    } catch (error) {
      release(); setState({ mode, busy: false, error: message(error) });
      logDebug(mode === 'export' ? '导出项目' : '读取项目文件夹', 'error', message(error));
    } finally { lock.current = false; operating.current = false; }
  }
  async function importProject(name: string) {
    if (!enabled || !service || lock.current || !state?.document || !state.token || !allowSwitch()) return;
    lock.current = true; operating.current = true;
    setState({ ...state, busy: true, error: '' });
    let creationError: unknown;
    try {
      const original = JSON.stringify(projects.catalog);
      const prepared = prepareProjectPackageImport(projects.catalog, state.document, name);
      await service.restoreAssets({ token: state.token, projectId: prepared.project.id });
      const saved = projects.commit(current => {
        try {
          if (JSON.stringify(current) !== original) throw new Error('项目列表已更新，请重新导入');
          writeProjectPackageImport(workspaceStorage, prepared);
          return prepared.catalog;
        } catch (error) { creationError = error; throw error; }
      });
      if (!saved) throw new Error(creationError ? message(creationError) : '项目列表未能保存，请检查存储状态后重试。');
      release(); setState(null); onImported();
      logDebug('导入项目', 'success', name);
    } catch (error) {
      setState({ ...state, busy: false, error: message(error) });
      logDebug('导入项目', 'error', message(error));
    } finally { lock.current = false; operating.current = false; }
  }
  return { state, busy, enabled, close, importProject,
    openImport: () => { void choose('import'); },
    openExport: (project: SavedProject) => { void choose('export', project); },
    reselect: () => { if (state) void choose(state.mode); },
  };
}
