/// <reference types="vite/client" />
interface Window {
  desktopClient?: {
    platform: string; localFiles: boolean;
    auth?: { session: () => { username: string; role: 'admin' | 'user' } | null; login: (input: { username: string; password: string }) => { username: string; role: 'admin' | 'user' }; logout: () => void };
    collaborationHost?: {
      status: () => Promise<import('./ServerManager').HostStatus>;
      start: () => Promise<import('./ServerManager').HostStatus>;
      stop: () => Promise<import('./ServerManager').HostStatus>;
    };
    storage?: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void; info?: (key: string) => { directory: string; file: string; modifiedAt: string | null } };
    artFiles?: {
      importFiles: (workspaceId: string) => Promise<import('./art-assets').ArtFile[] | null>;
      readPreview: (workspaceId: string, storagePath: string) => Promise<{ dataUrl: string } | null>;
      reveal: (workspaceId: string, storagePath: string) => Promise<void>;
    };
    projectPackages?: {
      exportFolder: (input: { projectId: string; document: import('./project-package').ProjectPackageDocument; expectedEntries: { key: string; value: string | null }[] }) => Promise<{ directory: string; fileCount: number } | null>;
      chooseImport: () => Promise<{ token: string; document: unknown } | null>;
      restoreAssets: (input: { token: string; projectId: string }) => Promise<void>;
      release: (token: string) => Promise<void>;
    };
    pickProjectDirectory?: () => Promise<string | null>;
    validateProjectLocation?: (input: { projectPath: string; enumPath: string }) => Promise<{ projectPath: string; enumPath: string }>;
    prepareTestWorkspace?: (scenario: import('./test-scenarios').TestScenarioId) => Promise<import('./test-scenarios').PreparedTest>;
    writeMarkdown?: (filename: string, content: string) => Promise<string>;
  };
}
