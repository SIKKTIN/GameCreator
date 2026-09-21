import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { scanEngineDirectory,validateEngineProject } from './server/engine-adapters.mjs';

const engineApi: Plugin = {
  name: 'gamecreator-engine-api',
  configureServer(server) {
    server.middlewares.use('/api/engine', async (request, response, next) => {
      if (request.method !== 'GET' || !request.url || !['/scan','/validate'].includes(new URL(request.url,'http://localhost').pathname)) return next();
      try {
        const query = new URL(request.url, 'http://localhost').searchParams;
        const projectPath = query.get('projectPath')?.trim();
        const enumPath = query.get('enumPath')?.trim();
        if (!projectPath || !enumPath) throw new Error('项目目录和枚举目录不能为空');
        const result = await (new URL(request.url,'http://localhost').pathname==='/validate'?validateEngineProject:scanEngineDirectory)(projectPath, enumPath, query.get('engine')||'oasis-lua');
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(JSON.stringify(result));
      } catch (error) {
        response.statusCode = 400;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : '工程扫描失败' }));
      }
    });
  },
};

export default defineConfig({ plugins: [react(), engineApi] });
