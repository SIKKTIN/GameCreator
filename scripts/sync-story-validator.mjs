// Keep the Electron package boundary aligned with the renderer's self-contained validator.
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/story-orchestration.ts',import.meta.url),'utf8');
const file=ts.createSourceFile('story-orchestration.ts',source,ts.ScriptTarget.Latest,true);
const fn=file.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='validateStoryOrchestration');
if(!fn)throw new Error('Story validator not found');
const code=ts.transpileModule(fn.getText(file).replace('export function validateStoryOrchestration','function validateStoryArchive'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText.trim();
const target=new URL('../desktop/project-package.cjs',import.meta.url),desktop=fs.readFileSync(target,'utf8');
const start=desktop.indexOf('function validateStoryArchive('),end=desktop.indexOf('\nfunction validateDocument(',start);
if(start<0||end<0)throw new Error('Desktop validator boundary not found');
fs.writeFileSync(target,desktop.slice(0,start)+code+'\n'+desktop.slice(end));
