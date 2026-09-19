import { useRef, useState } from 'react';
import { workspaceStorage } from './workspace-storage';
import { logDebug } from './debug-log';

const preferenceKey = 'gamecreator.ui-preferences.v1';
function initialVisibility() {
  try {
    const value: unknown = JSON.parse(workspaceStorage.getItem(preferenceKey) ?? 'null');
    if (value && typeof value === 'object' && 'schema' in value && value.schema === 1 &&
        'navigationVisible' in value && typeof value.navigationVisible === 'boolean') return value.navigationVisible;
  } catch (error) { logDebug('读取导航偏好', 'error', String(error)); }
  return true;
}

// This is a device preference. It must not follow a project or enter project exports.
export function useWorkspaceNavigation() {
  const [visible, setVisible] = useState(initialVisibility);
  const current = useRef(visible);
  const [saveError, setSaveError] = useState(false);
  const toggle = () => {
    const next = !current.current;
    current.current = next; setVisible(next);
    try {
      workspaceStorage.setItem(preferenceKey, JSON.stringify({ schema: 1, navigationVisible: next }));
      setSaveError(false);
    } catch {
      // A preference write failure must not prevent opening the navigation again.
      setSaveError(true);
    }
  };
  return { visible, toggle, saveError };
}
