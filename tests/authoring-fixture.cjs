const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createFolderProjects}=require('../desktop/folder-projects.cjs'),{createWorkspaceStorage}=require('../desktop/test-workspaces.cjs'),{createProjectAuthoring}=require('../desktop/project-authoring.cjs'),{createDeveloperService}=require('../desktop/ai-developers.cjs'),{signFeedback}=require('../shared/ai-feedback-client.cjs'),model=require('../desktop/project-content-model.cjs');
async function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gc-authoring-')),dataDirectory=path.join(root,'data'),folders=createFolderProjects({legacyStorage:createWorkspaceStorage(dataDirectory),dataDirectory}),storage=folders.storage;
 const project=folders.create(path.join(root,'prototype'),{id:'project-'+randomUUID(),name:'全新原型',initialContent:'empty',config:{engine:'godot-gdscript',projectPath:'',enumPath:'.',dataPath:'data/generated',outputFormat:'json',autoSync:false,backupBeforeSync:true}});
 storage.setItem('gamecreator.projects.v1',JSON.stringify({schema:2,projects:[project],activeId:project.id,mode:'project'}));
 const sk='gamecreator.workspace.v1:'+project.id+':project-schedule',s=model.emptyContentDocument().archives['project-schedule'];s.personnel=(await import('../shared/ai-personnel.mjs')).defaultWorkTeam();storage.setItem(sk,JSON.stringify(s));
 const secrets=new Map(),developers=createDeveloperService({storage,vault:{put:s=>secrets.set(s.credentialId,s),get:(_,id)=>secrets.get(id),has:(_,id)=>secrets.has(id),remove:(_,id)=>secrets.delete(id)}});
 const {credential,memberId}=await developers.change('create',{projectId:project.id,schedule:s,name:'制作人',duties:'从零编写原型',permissions:['project_write'],profile:{positionIds:['producer'],taskIds:[],scope:'project',expiresAt:'',projectModules:Object.keys(model.authoringModules)}}),secret=developers.read({projectId:project.id,credentialId:credential.id});
 const service=createProjectAuthoring({storage,folders}),input=()=>({projectId:project.id,expectedEntries:model.captureProjectPackage(storage,project).expectedEntries}),run=(op,extra={})=>service.run(op,{...input(),...extra});
 run('export');
 const read=(rel)=>JSON.parse(fs.readFileSync(path.join(project.folderPath,rel),'utf8'));
 const draft=ops=>({format:'gamecreator-content-change',schema:1,id:randomUUID(),projectId:project.id,snapshotId:read('ai/project.json').snapshotId,intent:'project_change',target:{kind:'module',id:ops[0].module},summary:'搭建最小原型内容',compatibility:{reuse:'复用默认根流程与项目规范',modify:'完善概述',add:'按职责新增内容',archive:'无'},operations:ops});
 const submit=p=>{const signed=signFeedback(p,secret);fs.writeFileSync(path.join(project.folderPath,'ai/changes',p.id+'.json'),JSON.stringify(signed));return signed;};
 const close=()=>{folders.close();if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('gc-authoring-'))throw new Error('Unsafe cleanup');fs.rmSync(root,{recursive:true,force:true});};
 return {root,project,folders,storage,sk,developers,credential,memberId,secret,service,input,run,read,draft,submit,close,model};
}
function initialOperations(){
 const t=model.authoringTemplates(),g={...t.gameplay,id:'play'},system={...t.system,id:'sys'},capability={...t.capability,id:'cap',systemId:'sys'},milestone={...t.milestone,id:'m1'},task={...t.productionTask,id:'work',milestoneId:'m1',references:[{kind:'gameplay',targetId:'play'},{kind:'capability',targetId:'cap'},{kind:'requirement',targetId:'art'}]},art={...t.requirement,id:'art'},tool={...t.tool,id:'tool',capabilityIds:['cap']},node={...t.coreNode,id:'loop',gameplayIds:['play']},definition={...t.definition,key:'units'};
 const add=(module,path,value)=>({module,path,value,op:'add'});
 return [
 {module:'project',op:'set',path:'/description',value:'一个可验证玩法与交付的最小原型。'},add('project-standards','/moduleNotes/core','先复用现有循环'),
 add('gameplay','/designs/@play',g),add('functional-systems','/systems/@sys',system),add('functional-systems','/capabilities/@cap',capability),add('gameplay-core','/graphs/@root/nodes/@loop',node),
 add('project-schedule','/milestones/@m1',milestone),add('project-schedule','/tasks/@work',task),add('art-assets','/requirements/@art',art),add('development-tools','/tools/@tool',tool),
 add('art-assets','/style',{...t.artStyle,draft:{...t.artStyle.draft,direction:'简洁的平面插画'}}),add('art-assets','/productionDocs',[{...t.productionDoc,requirementIds:['art']}]),{module:'program-framework',op:'set',path:'/enabled',value:true},
 add('definitions','/@units',definition),add('enum-versions','/data/columns/units',definition.columns),add('enum-versions','/data/datasets/units',[{id:'unit-1',name:'角色'}]),
 add('stories','/@story',{...t.story,id:'story'}),add('prototype-design','/scenes/@scene',{...t.prototypeScene,id:'scene',sourceDesignId:'play'}),add('task-flows','/tasks/@quest',{...t.playerTask,id:'quest'}),
 add('story-orchestration','/stories/@narrative',{...t.narrative,id:'narrative',taskIds:['quest']}),{module:'story-orchestration',op:'set',path:'/enabled',value:true},
 add('map-design','/maps/@map',{...t.map,id:'map'}),{module:'map-design',op:'set',path:'/enabled',value:true},add('numerical-analysis','/plans/@balance',{...t.analysis,id:'balance',gameplayId:'play'})
 ].map((o,i)=>({...o,id:'op-'+i}));
}
module.exports={fixture,initialOperations};
