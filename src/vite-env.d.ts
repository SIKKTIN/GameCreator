/// <reference types="vite/client" />
interface Window { desktopClient?: { platform: string; localFiles: boolean; writeMarkdown?: (filename: string, content: string) => Promise<string> }; }
