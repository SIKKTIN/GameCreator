// Read-only structural checks. Similar names are review hints, never automatic merges.
export function checkProjectStructure({gameplay,core,functional,schedule}={}){
  const issues=[],list=v=>Array.isArray(v)?v:[],live=xs=>list(xs).filter(x=>!x.archived);
  const add=(severity,module,id,message)=>issues.push({severity,module,id,message});
  const version=/^\s*v?\d+\.\d+(?:\.\d+)?(?:\s*[|｜·:：-]\s*|\s+)/i;
  const name=x=>String(x.title||x.name||''),normalized=x=>name(x).replace(version,'').replace(/\s+/g,'').toLocaleLowerCase();
  function inspect(module,kind,items,versionContainer=false){
    const seenIds=new Set(),names=new Map();
    for(const x of items){
      if(seenIds.has(x.id))add('error',module,kind+':id:'+x.id,'存在重复 ID：'+x.id+'，请核对条目身份。');seenIds.add(x.id);
      if(x.archived)continue;
      if(versionContainer&&version.test(name(x)))add('warning',module,kind+':version:'+x.id,'“'+name(x)+'”使用版本号组织内容，请确认分类或层级表达的是业务职责。');
      const n=normalized(x);if(n){if(names.has(n))add('warning',module,kind+':name:'+x.id,'“'+name(x)+'”与“'+names.get(n)+'”名称相近，请复核是否重复定义。');else names.set(n,name(x));}
    }
  }
  if(gameplay){
    inspect('玩法设计','category',list(gameplay.categories),true);inspect('玩法设计','design',list(gameplay.designs));
    const ids=new Set(list(gameplay.categories).map(x=>x.id));
    for(const d of live(gameplay.designs))if(d.categoryId&&!ids.has(d.categoryId))add('error','玩法设计',d.id,'“'+name(d)+'”的玩法分类已不存在。');
  }
  if(core){
    inspect('玩法核心','graph',list(core.graphs),true);
    const graphs=new Set(list(core.graphs).map(x=>x.id)),designs=gameplay&&new Set(live(gameplay.designs).map(x=>x.id));
    if(!graphs.has(core.rootId))add('error','玩法核心','root','入口流程已不存在。');
    for(const g of list(core.graphs)){
      inspect('玩法核心','node:'+g.id,list(g.nodes));const nodes=new Set(list(g.nodes).map(x=>x.id));
      for(const e of list(g.edges))if(!nodes.has(e.fromId)||!nodes.has(e.toId))add('error','玩法核心','edge:'+e.id,'“'+name(g)+'”存在失效的流程连线。');
      for(const n of list(g.nodes)){
        if(n.childGraphId&&!graphs.has(n.childGraphId))add('error','玩法核心','child:'+n.id,'“'+name(n)+'”的子流程已不存在。');
        if(designs&&list(n.gameplayIds).some(id=>!designs.has(id)))add('error','玩法核心','design:'+n.id,'“'+name(n)+'”引用了不存在或已归档的玩法。');
      }
    }
  }
  if(functional){
    inspect('功能系统','system',list(functional.systems),true);inspect('功能系统','capability',list(functional.capabilities));
    const systems=new Map(list(functional.systems).map(x=>[x.id,x])),capabilities=new Set(live(functional.capabilities).filter(c=>!systems.get(c.systemId)?.archived).map(x=>x.id));
    for(const c of live(functional.capabilities))if(!systems.has(c.systemId))add('error','功能系统','system:'+c.id,'“'+name(c)+'”的所属系统已不存在。');
    const designs=gameplay&&new Set(live(gameplay.designs).map(x=>x.id));
    for(const u of list(functional.usages))if(!capabilities.has(u.capabilityId)||designs&&!designs.has(u.gameplayId))add('error','功能系统','usage:'+u.id,'玩法与功能的关联包含不存在或已归档的条目。');
    for(const d of list(functional.dependencies))if(!capabilities.has(d.fromId)||!capabilities.has(d.toId))add('error','功能系统','dependency:'+d.id,'功能依赖包含不存在或已归档的功能。');
  }
  if(schedule){
    inspect('项目排期','task',list(schedule.tasks));inspect('项目排期','milestone',list(schedule.milestones));
    const tasks=new Set(list(schedule.tasks).map(x=>x.id)),milestones=new Set(list(schedule.milestones).map(x=>x.id));
    for(const t of list(schedule.tasks)){
      if(t.milestoneId&&!milestones.has(t.milestoneId))add('error','项目排期','milestone:'+t.id,'“'+name(t)+'”所属里程碑已不存在。');
      if(list(t.dependencyIds).some(id=>!tasks.has(id)||id===t.id))add('error','项目排期','dependency:'+t.id,'“'+name(t)+'”有失效或指向自身的任务依赖。');
    }
  }
  return issues;
}
