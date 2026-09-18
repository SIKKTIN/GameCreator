/// <reference types="vite/client" />
interface Window {
  desktopClient?: {
    platform: string; localFiles: boolean;
    storage?: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void; info?: (key: string) => { directory: string; file: string; modifiedAt: string | null } };
    pickProjectDirectory?: () => Promise<string | null>;
    validateProjectLocation?: (input: { projectPath: string; enumPath: string }) => Promise<{ projectPath: string; enumPath: string }>;
    prepareTestWorkspace?: (scenario: import('./test-scenarios').TestScenarioId) => Promise<import('./test-scenarios').PreparedTest>;
    writeMarkdown?: (filename: string, content: string) => Promise<string>;
  };
}
