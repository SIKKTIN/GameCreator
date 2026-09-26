import { useCallback, useEffect, useRef, useState } from 'react';
import { readUiPreferences, updateUiPreferences } from './ui-preferences';

// This is a device preference. It must not follow a project or enter project exports.
export function useWorkspaceNavigation() {
  const [visible, setVisible] = useState(() => readUiPreferences().navigationVisible);
  const current = useRef(visible);
  const [saveError, setSaveError] = useState(false);
  const toggle = () => {
    const next = !current.current;
    current.current = next; setVisible(next);
    try {
      updateUiPreferences({ navigationVisible: next });
      setSaveError(false);
    } catch {
      // A preference write failure must not prevent opening the navigation again.
      setSaveError(true);
    }
  };
  return { visible, toggle, saveError };
}

export function useWorkspaceNavigationGroups(active: string, activeGroup?: string) {
  const [collapsed, setCollapsed] = useState(() => readUiPreferences().collapsedNavigationGroups ?? []);
  const current = useRef(collapsed);
  const [saveError, setSaveError] = useState(false);
  const save = useCallback((next: string[]) => {
    current.current = next; setCollapsed(next);
    try {
      updateUiPreferences({ collapsedNavigationGroups: next });
      setSaveError(false);
    } catch { setSaveError(true); }
  }, []);
  useEffect(() => {
    if (activeGroup && current.current.includes(activeGroup)) save(current.current.filter(id => id !== activeGroup));
  }, [active, activeGroup, save]);
  const toggle = (id: string) => save(current.current.includes(id) ? current.current.filter(item => item !== id) : [...current.current, id]);
  return { collapsed, toggle, saveError };
}
