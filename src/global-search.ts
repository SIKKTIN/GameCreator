/** A rebuildable, project-scoped index. Never reads disk, credentials or file contents. */
export type SearchTarget = { module: string; id: string; parent?: string; kind?: string; scope?: string };
export type SearchEntry = { key: string; title: string; path: string; body: string; archived: boolean; status: string; target: SearchTarget; refs: string[]; unavailable?: string };
export type SearchSources = Partial<Record<'project'|'gameplay'|'core'|'functional'|'art'|'prototype'|'maps'|'stories'|'narrative'|'schedule'|'tasks'|'data'|'definitions'|'enums'|'analysis', unknown>>;
type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const list = (v: unknown): Row[] => Array.isArray(v) ? v.map(row) : [];
const str = (v: unknown) => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
const name = (v: Row) => str(v.title || v.name || v.label || v.key || v.id);
const ignored = /^(schema|id|createdAt|updatedAt|storagePath|projectPath|x|y|width|height|color|background|fontSize|revision|updatedBy|fileId|versionId|.*Ids?|.*At)$/;
function content(v: unknown, depth = 0): string {
  if (depth > 12 || v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return str(v);
  if (Array.isArray(v)) return v.map(x => content(x, depth + 1)).filter(Boolean).join('\n');
  return Object.entries(row(v)).filter(([k]) => !ignored.test(k)).map(([,x]) => content(x, depth + 1)).filter(Boolean).join('\n');
}
function references(v: unknown, depth = 0): string[] {
  if (depth > 12 || !v || typeof v !== 'object') return [];
  if (Array.isArray(v)) return v.flatMap(x => references(x, depth + 1));
  if(row(v).sourceOnly===true)return [];
  return Object.entries(row(v)).flatMap(([k,x]) => k !== 'id' && /Ids?$/.test(k) ? (Array.isArray(x) ? x.map(str) : [str(x)]).filter(Boolean) : references(x, depth + 1));
}
export const targetKey = (t: SearchTarget) => JSON.stringify([t.module,t.kind || '',t.parent || '',t.id,t.scope || '']);
export function buildSearchIndex(s: SearchSources): SearchEntry[] {
  const out: SearchEntry[] = [];
  function add(module: string, value: Row, options: {kind?:string;parent?:string;scope?:string;path?:string;archived?:boolean;id?:string;title?:string;omit?:string[];unavailable?:string} = {}) {
    const id = options.id ?? str(value.id || value.key || value.name), target = {module,id,parent:options.parent,kind:options.kind,scope:options.scope};
    const body = content(Object.fromEntries(Object.entries(value).filter(([k]) => !options.omit?.includes(k))));
    out.push({key:targetKey(target),title:options.title || name(value) || '未命名条目',path:[module,options.path].filter(Boolean).join(' / '),body,archived:options.archived || value.archived === true,status:str(value.status),target,refs:references(value),unavailable:options.unavailable});
  }
  if(s.project) add('项目概览',row(s.project),{id:'project',title:str(row(s.project).name)||'项目基本信息'});
  const gp=row(s.gameplay), categories=list(gp.categories);
  for(const d of list(gp.designs)) {
    const category=name(categories.find(c=>c.id===d.categoryId)||{})||'未分类';
    add('玩法设计',d,{kind:'design',path:category,omit:['conditionRules','stateFlow','timeline','space']});
    for(const [field,kind] of [['conditionRules','rule'],['states','state']] as const) for(const v of list(field==='states'?row(d.stateFlow).states:d[field])) add('玩法设计',v,{kind,parent:str(d.id),path:category+' / '+name(d),archived:d.archived===true});
    for(const v of list(row(d.timeline).events)) add('玩法设计',v,{kind:'event',parent:str(d.id),path:category+' / '+name(d),archived:d.archived===true});
    for(const v of list(row(d.space).objects)) add('玩法设计',v,{kind:'object',parent:str(d.id),path:category+' / '+name(d),archived:d.archived===true});
    // Space and timeline metadata (including rooms) remains searchable on its owner.
    const owner=out.find(e=>e.target.module==='玩法设计'&&e.target.id===d.id&&e.target.kind==='design');
    if(owner) owner.body+='\n'+content({...row(d.stateFlow),states:undefined})+'\n'+content({...row(d.space),objects:undefined})+'\n'+content({...row(d.timeline),events:undefined});
  }
  for(const g of list(row(s.core).graphs)) {
    add('玩法核心',g,{kind:'graph',omit:['nodes','edges']});
    for(const v of list(g.nodes)) add('玩法核心',v,{kind:'node',parent:str(g.id),path:name(g)});
    for(const v of list(g.edges)) add('玩法核心',v,{kind:'edge',parent:str(g.id),path:name(g),title:str(v.label)||'流程连线'});
  }
  const fs=row(s.functional), systems=list(fs.systems);
  for(const v of systems) add('功能系统',v,{kind:'system'});
  for(const v of list(fs.capabilities)) {const owner=systems.find(x=>x.id===v.systemId);add('功能系统',v,{kind:'capability',path:name(owner||{}),archived:owner?.archived===true});}
  const art=row(s.art), library=row(art.library), artCategories=list(library.categories);
  for(const [field,kind] of [['requirements','requirement'],['assets','asset']] as const) for(const v of list(art[field])) {
    const category=artCategories.find(c=>c.id===row(library[field])[str(v.id)]);
    add('素材资产',v,{kind,path:name(category||{})||str(v.category)||'未分类'});
  }
  for(const g of list(row(s.prototype).scenes)) {
    add('原型设计',g,{kind:'scene',omit:['elements']});
    for(const v of list(g.elements)) add('原型设计',v,{kind:'element',parent:str(g.id),path:name(g)});
  }
  const maps=row(s.maps), disabled=maps.enabled===false?'地图设计已关闭，请在工作区设置中启用。':undefined;
  for(const g of list(maps.maps)) {
    add('地图设计',g,{kind:'map',omit:['objects'],unavailable:disabled});
    for(const v of list(g.objects)) add('地图设计',v,{kind:'object',parent:str(g.id),path:name(g),unavailable:disabled});
  }
  for(const v of list(maps.connections)) add('地图设计',v,{kind:'connection',unavailable:disabled});
  for(const v of list(s.stories)) add('故事文档',v,{path:str(v.category)});
  const narrative=row(s.narrative), storyDisabled=narrative.enabled===false?'故事编排已关闭，请在工作区设置中启用。':undefined;
  for(const g of list(narrative.stories)) {
    add('故事编排',g,{kind:'story',omit:['nodes'],unavailable:storyDisabled});
    for(const v of list(g.nodes)) add('故事编排',v,{kind:'node',parent:str(g.id),path:name(g),archived:g.archived===true,unavailable:storyDisabled});
  }
  for(const v of list(narrative.characters)) add('故事编排',v,{kind:'character',unavailable:storyDisabled});
  for(const [field,kind] of [['tasks','task'],['milestones','milestone']] as const) for(const v of list(row(s.schedule)[field])) add('项目排期',v,{kind});
  for(const v of list(row(s.tasks).tasks)) add('任务与流程',v,{kind:'task'});
  for(const v of list(row(s.analysis).plans)) add('数值分析',v,{kind:'plan',omit:['snapshots']});
  const data=row(s.data), columns=row(data.columns), defs=list(s.definitions);
  for(const [key,rows] of Object.entries(row(data.datasets))) {
    const def=defs.find(d=>d.key===key), title=name(def||{})||key;
    add('数据配置',{key,name:title,columns:columns[key]},{kind:'table',id:key});
    for(const v of list(rows)) add('数据配置',v,{kind:'record',parent:key,path:title,title:str(v.name||v.title||v.id)});
  }
  for(const g of list(row(s.enums).groups)) {
    add('枚举定义',g,{kind:'enum',scope:str(g.source),id:str(g.name),omit:['members']});
    for(const v of list(g.members)) add('枚举定义',{key:v.key,comment:v.comment},{kind:'member',scope:str(g.source),parent:str(g.name),id:str(v.key),path:str(g.name)});
  }
  // Resolve stored IDs only when unambiguous; identical IDs in different tables
  // or child collections must not create a false relationship.
  const byId=new Map<string,SearchEntry[]>();
  for(const entry of out)byId.set(entry.target.id,[...(byId.get(entry.target.id)||[]),entry]);
  for(const entry of out)entry.refs=[...new Set(entry.refs.flatMap(id=>{const found=byId.get(id);return found?.length===1?[found[0].key]:[];}))];
  const find=(module:string,id:unknown,kind?:string,parent?:unknown)=>out.find(e=>e.target.module===module&&e.target.id===id&&(!kind||e.target.kind===kind)&&(!parent||e.target.parent===parent));
  const link=(a:SearchEntry|undefined,b:SearchEntry|undefined)=>{if(a&&b&&a!==b&&!a.refs.includes(b.key))a.refs.push(b.key);};
  for(const usage of list(fs.usages))link(find('功能系统',usage.capabilityId,'capability'),find('玩法设计',usage.sourceId||usage.gameplayId,str(usage.sourceKind)||'design',usage.sourceId?usage.gameplayId:undefined));
  for(const dependency of list(fs.dependencies))link(find('功能系统',dependency.fromId,'capability'),find('功能系统',dependency.toId,'capability'));
  for(const binding of list(art.links))link(find('素材资产',binding.requirementId,'requirement'),find('素材资产',binding.assetId,'asset'));
  for(const capability of list(fs.capabilities))for(const config of list(capability.configRefs))link(find('功能系统',capability.id,'capability'),find('数据配置',config.rowId||config.datasetKey,config.rowId?'record':'table',config.rowId?config.datasetKey:undefined));
  return out;
}
export const searchTerms = (query: string) => [...new Set(query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean))].slice(0,20);
export function searchEntries(entries: SearchEntry[], query: string, module = '', archived = false) {
  const terms=searchTerms(query); if(!terms.length)return [];
  return entries.flatMap(entry=>{
    if(module && entry.target.module!==module || !archived && entry.archived)return [];
    const title=entry.title.toLocaleLowerCase(), id=entry.target.id.toLocaleLowerCase(), body=entry.body.toLocaleLowerCase(), path=entry.path.toLocaleLowerCase();
    if(!terms.every(t=>(title+'\n'+id+'\n'+path+'\n'+body).includes(t)))return [];
    const q=query.trim().toLocaleLowerCase(), score=title===q||id===q?1000:terms.every(t=>title.includes(t))?500:terms.some(t=>title.includes(t))?200:terms.every(t=>path.includes(t))?100:10;
    const offsets=terms.map(t=>body.indexOf(t)).filter(x=>x>=0), start=Math.max(0,(offsets.length?Math.min(...offsets):0)-60);
    return [{entry,score,snippet:(start?'…':'')+entry.body.slice(start,start+260)+(entry.body.length>start+260?'…':'')}];
  }).sort((a,b)=>b.score-a.score||a.entry.title.localeCompare(b.entry.title,'zh-CN'));
}
export function relatedEntries(entry: SearchEntry, entries: SearchEntry[]) {
  return entries.filter(other=>other.key!==entry.key && (entry.refs.includes(other.key)||other.refs.includes(entry.key)));
}
