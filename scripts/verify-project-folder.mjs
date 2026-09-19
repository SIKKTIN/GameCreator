// Restore a portable folder into throwaway storage and compare all archives and original file bytes.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { validateProjectPackage, prepareProjectPackageImport, writeProjectPackageImport, captureProjectPackage } from '../src/project-package.ts';
import { PROJECT_CATALOG_KEY } from '../src/project-catalog.ts';
const require = createRequire(import.meta.url);
const { createWorkspaceStorage } = require('../desktop/test-workspaces.cjs');
const { createProjectPackages } = require('../desktop/project-package.cjs');
const { workspaceHash, createArtFiles } = require('../desktop/art-files.cjs');
if (process.argv.length !== 3) throw new Error('用法：node scripts/verify-project-folder.mjs <项目文件夹>');
const source = path.resolve(process.argv[2]);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-package-check-'));
try {
  const storage = createWorkspaceStorage(temporary), packages = createProjectPackages({dataDirectory: temporary, storage});
  const selected = await packages.prepareImport(source), document = validateProjectPackage(selected.document);
  const old = {id:'project-verification-baseline',name:'验证基准',config:document.project.config,initialContent:'empty'};
  const catalog = {schema:2,activeId:old.id,mode:'project',projects:[old]};
  storage.setItem(PROJECT_CATALOG_KEY, JSON.stringify(catalog));
  const prepared = prepareProjectPackageImport(catalog, document, document.project.name);
  await packages.restoreAssets({token:selected.token,projectId:prepared.project.id});
  writeProjectPackageImport(storage, prepared);
  storage.setItem(PROJECT_CATALOG_KEY, JSON.stringify(prepared.catalog));
  packages.release(selected.token);
  // Use a fresh storage instance, just as after restarting the client.
  const reopened = createWorkspaceStorage(temporary);
  const restored = captureProjectPackage(reopened, prepared.project).document;
  assert.deepEqual(restored.archives, {...document.archives,project:{...document.archives.project,name:document.project.name}});
  assert.equal(restored.project.config.projectPath, ''); assert.equal(restored.project.config.autoSync, false);
  const files = new Map(document.archives['art-assets'].assets.flatMap(asset => asset.versions.flatMap(version => version.files)).map(file => [file.storagePath,file]));
  let previews = 0;
  for (const [token, file] of files) {
    const a = await fs.readFile(path.join(source, 'assets', token));
    const b = await fs.readFile(path.join(temporary, 'art-files', workspaceHash('project:'+prepared.project.id), token));
    assert.equal(b.length, file.size);
    assert.equal(createHash('sha256').update(a).digest('hex'), createHash('sha256').update(b).digest('hex'));
    if (file.mime.startsWith('image/')) {
      try { if (await createArtFiles(temporary).readPreview('project:'+prepared.project.id, token)) previews++; } catch { /* Original files can be valid deliveries without a supported raster preview. */ }
    }
  }
  console.log(JSON.stringify({project:document.project.name,archives:Object.keys(document.archives).length,files:files.size,previews,restoredAndReopened:true},null,2));
} finally {
  // Only this mkdtemp directory can be removed, never the source folder or user archive directory.
  const resolved = path.resolve(temporary);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('gc-package-check-') || resolved === source) throw new Error('验证临时目录边界异常，已停止清理');
  await fs.rm(resolved,{recursive:true,force:true});
}
