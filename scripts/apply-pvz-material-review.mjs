import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {reviewPvzMaterials} from './review-pvz-materials.mjs';
import {writeArtAssets} from '../src/art-assets.ts';
const [root,projectId]=process.argv.slice(2);
if(!root||!/^project-[0-9a-f-]{36}$/.test(projectId??''))throw new Error('用法：node scripts/apply-pvz-material-review.mjs <工作树根目录> <项目ID>');
const data=path.join(path.resolve(root),'.gamecreator');
const {createWorkspaceStorage}=createRequire(import.meta.url)('../desktop/test-workspaces.cjs');
const storage=createWorkspaceStorage(data),catalog=JSON.parse(storage.getItem('gamecreator.projects.v1')??'null');
const project=catalog?.projects.find(p=>p.id===projectId);if(!project)throw new Error('指定项目不在此工作树中');
const key='gamecreator.workspace.v1:'+projectId+':art-assets',raw=storage.getItem(key);if(!raw)throw new Error('项目没有素材存档');
const result=reviewPvzMaterials(JSON.parse(raw));
if(JSON.stringify(result.store)===raw){console.log('无需重复修订：'+project.name);process.exit(0);}
const backup=path.join(data,'backups','pvz-material-scope-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,JSON.stringify({projectId,key,raw},null,2),{flag:'wx'});
writeArtAssets(storage,key,raw,result.store);
console.log(JSON.stringify({project:project.name,backup,...result,store:undefined},null,2));
