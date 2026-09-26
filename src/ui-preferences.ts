import { workspaceStorage } from './workspace-storage';
import { logDebug } from './debug-log';

type UiPreferences = { schema: 1; navigationVisible: boolean; collapsedNavigationGroups?: string[] };
const preferenceKey = 'gamecreator.ui-preferences.v1';

export function readUiPreferences(): UiPreferences {
  try {
    const value = JSON.parse(workspaceStorage.getItem(preferenceKey) ?? 'null');
    if (value && typeof value === 'object' && value.schema === 1) {
      return {
        schema: 1,
        navigationVisible: typeof value.navigationVisible === 'boolean' ? value.navigationVisible : true,
        ...(Array.isArray(value.collapsedNavigationGroups) ? {
          collapsedNavigationGroups: [...new Set<string>(value.collapsedNavigationGroups.filter((id: unknown) => typeof id === 'string'))],
        } : {}),
      };
    }
  } catch (error) { logDebug('读取导航偏好', 'error', String(error)); }
  return { schema: 1, navigationVisible: true };
}

// Read the latest preference before saving so independent navigation controls do not overwrite each other.
export function updateUiPreferences(patch: Partial<Omit<UiPreferences, 'schema'>>) {
  workspaceStorage.setItem(preferenceKey, JSON.stringify({ ...readUiPreferences(), ...patch }));
}
