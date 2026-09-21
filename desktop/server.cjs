const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { URL } = require('node:url');
const { pathToFileURL } = require('node:url');

async function createDesktopServer({ root }) {
  const parserUrl = pathToFileURL(path.join(root, 'server', 'engine-adapters.mjs')).href;
  const { scanEngineDirectory, validateEngineProject } = await import(parserUrl);
  const distRoot = path.resolve(root, 'dist');
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
  const json = (response, status, body) => { response.statusCode = status; response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.end(JSON.stringify(body)); };
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (['/api/engine/scan','/api/engine/validate'].includes(url.pathname)) {
        if (request.method !== 'GET') return json(response, 405, { error: '只支持 GET' });
        const projectPath = url.searchParams.get('projectPath')?.trim();
        const enumPath = url.searchParams.get('enumPath')?.trim();
        if (!projectPath || !enumPath) return json(response, 400, { error: '项目目录和枚举目录不能为空' });
        try { return json(response, 200, await (url.pathname.endsWith('/validate')?validateEngineProject:scanEngineDirectory)(projectPath, enumPath, url.searchParams.get('engine')||'oasis-lua')); }
        catch (error) { return json(response, 400, { error: error instanceof Error ? error.message : '工程扫描失败' }); }
      }
      const requested = url.pathname === '/' ? '/index.html' : url.pathname;
      const target = path.resolve(distRoot, '.' + requested);
      if (target !== distRoot && !target.startsWith(distRoot + path.sep)) return json(response, 403, { error: '非法路径' });
      let file = target;
      try { if (!(await fsp.stat(file)).isFile()) throw new Error('not file'); }
      catch { file = path.join(distRoot, 'index.html'); }
      response.setHeader('Content-Type', mime[path.extname(file).toLowerCase()] || 'application/octet-stream');
      fs.createReadStream(file).pipe(response);
    } catch (error) { json(response, 500, { error: error instanceof Error ? error.message : '本地服务错误' }); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { server, port, url: `http://127.0.0.1:${port}` };
}

module.exports = { createDesktopServer };
