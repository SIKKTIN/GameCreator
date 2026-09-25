import { useRef, useState } from 'react';
import { workspaceStorage } from './workspace-storage';
import { defaultEngineConfig } from './engine';
import { defaultCatalog, PROJECT_CATALOG_KEY, readProjectCatalog, validateCatalog, type ProjectCatalog } from './project-catalog';
import { logDebug } from './debug-log';

export function useProjectCatalog() {
  const [state, setState] = useState(() => {
    try { return { catalog: readProjectCatalog(workspaceStorage, defaultEngineConfig, 'Project Aurora'), error: '', blocked: false }; }
    catch (error) { return { catalog: defaultCatalog(defaultEngineConfig, 'Project Aurora'), error: String(error), blocked: true }; }
  });
  const latest = useRef(state);
  latest.current = state;
  const commit = (operation: (catalog: ProjectCatalog) => ProjectCatalog) => {
    try {
      if (latest.current.blocked) throw new Error(latest.current.error);
      const disk = workspaceStorage.getItem(PROJECT_CATALOG_KEY);
      if (disk !== null && JSON.stringify(JSON.parse(disk)) !== JSON.stringify(latest.current.catalog)) throw new Error('另一个窗口已更新项目列表，请重新打开软件后再切换');
      const next = validateCatalog(operation(latest.current.catalog));
      // An operation can stage a new project's archives before publishing it.
      // Recheck the catalog so another window's additions are not lost meanwhile.
      if (workspaceStorage.getItem(PROJECT_CATALOG_KEY) !== disk) throw new Error('另一个窗口已更新项目列表，请重新打开软件后重试');
      workspaceStorage.setItem(PROJECT_CATALOG_KEY, JSON.stringify(next));
      latest.current = { catalog: next, error: '', blocked: false };
      setState(latest.current);
      return true;
    } catch (error) {
      latest.current = { ...latest.current, error: String(error) };
      setState(latest.current);
      logDebug('项目切换或设置', 'error', String(error));
      return false;
    }
  };
  const reload = () => {
    try {latest.current={catalog:readProjectCatalog(workspaceStorage,defaultEngineConfig,'Project Aurora'),error:'',blocked:false};setState(latest.current);return true;}
    catch(error){latest.current={...latest.current,error:String(error),blocked:true};setState(latest.current);return false;}
  };
  return { catalog: state.catalog, error: state.error, blocked: state.blocked, commit, reload };
}
