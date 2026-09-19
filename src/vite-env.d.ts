/// <reference types="vite/client" />
interface Window {
  desktopClient?: {
    platform: string; localFiles: boolean;
    storage?: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void; info?: (key: string) => { directory: string; file: string; modifiedAt: string | null } };
    artFiles?: {
      importFiles: (workspaceId: string) => Promise<import('./art-assets').ArtFile[] | null>;
      readPreview: (workspaceId: string, storagePath: string) => Promise<{ dataUrl: string } | null>;
      reveal: (workspaceId: string, storagePath: string) => Promise<void>;
    };
    pickProjectDirectory?: () => Promise<string | null>;
    validateProjectLocation?: (input: { projectPath: string; enumPath: string }) => Promise<{ projectPath: string; enumPath: string }>;
    prepareTestWorkspace?: (scenario: import('./test-scenarios').TestScenarioId) => Promise<import('./test-scenarios').PreparedTest>;
    writeMarkdown?: (filename: string, content: string) => Promise<string>;
  };
}
