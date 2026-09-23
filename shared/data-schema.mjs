import {releaseDiff} from './data-releases.mjs';
import {canonical, record, stable, toJson, validateJson} from './data-sync.mjs';

// A structural contract, not a sample value. Unknown nodes require an explicit engine declaration.
export function inferNode(values) {
  if(!values.length)return {type:'unknown'};
  const types=[...new Set(values.map(v=>v===null?'null':Array.isArray(v)?'array':typeof v))].sort();
  if(types.length!==1||types[0]==='null')return {type:'unknown'};
  const type=types[0];
  if(type==='object') {
    const keys=[...new Set(values.flatMap(Object.keys))].sort();
    return {type,properties:Object.fromEntries(keys.map(k=>[k,inferNode(values.filter(v=>Object.hasOwn(v,k)).map(v=>v[k]))])),required:keys.filter(k=>values.every(v=>Object.hasOwn(v,k)))};
  }
  if(type==='array')return {type,items:inferNode(values.flat())};
  return {type};
}
export function jsonContract(json,mapping={}) {
  const c=canonical(json,mapping);
  if(!c)return null;
  return c.shape==='object'?{shape:c.shape,value:inferNode([c.value])}:{shape:c.shape,record:inferNode(Object.values(c.rows)),metadata:inferNode([c.metadata||{}])};
}
export function developmentContract(data,table,scan=null,mapping) {
  const json=toJson(data,table,mapping,scan),contract=jsonContract(json,mapping||data.jsonFormats?.[table]?.mapping||{});
  if(contract.shape!=='object') {
    const node=contract.record;if(node.type==='unknown'){node.type='object';node.properties={};node.required=[];}
    for(const col of data.columns[table]) {
      if(!node.properties[col.key])node.properties[col.key]={type:col.key==='id'?'string':col.jsonType||'unknown',...(col.jsonType==='array'?{items:{type:'unknown'}}:col.jsonType==='object'?{properties:{},required:[]}: {})};
      if(col.jsonType&&col.type!=='enum'&&node.properties[col.key].type!==col.jsonType)node.properties[col.key]={type:col.jsonType,...(col.jsonType==='array'?{items:{type:'unknown'}}:col.jsonType==='object'?{properties:{},required:[]}: {})};
    }
    node.required=[...new Set([...node.required,'id'])].sort();
  }
  const constraints=Object.fromEntries(data.columns[table].filter(c=>c.type==='enum'||c.type==='reference').map(c=>[c.key,c.type==='reference'?{reference:c.reference||''}:{enumId:c.enumId||'',options:c.options||[],...(c.enumId?{enumValues:scan?.groups.filter(g=>(g.engine==='godot-gdscript'?'godot:'+g.source.replace(/\\/g,'/')+'#'+g.name:g.source.replace(/\\/g,'/').replace(/\.lua$/i,'').replace(/\//g,'.')+'#'+g.name.split('.').slice(1).join('.'))===c.enumId).flatMap(g=>g.members.map(m=>m.value))||[]}: {})}]));
  if(Object.keys(constraints).length)contract.constraints=constraints;
  return contract;
}
function nodeIssues(a,b,path,issues) {
  if(!a||!b){issues.push(path+'：字段缺少或新增');return;}
  if(a.type==='unknown'||b.type==='unknown'){issues.push(path+'：结构无法确认（空表、空数组、null 或混合类型），请补充引擎结构声明');return;}
  if(a.type!==b.type){issues.push(path+'：类型不符 '+a.type+' / '+b.type);return;}
  if(a.type==='object') {
    for(const k of new Set([...Object.keys(a.properties||{}),...Object.keys(b.properties||{})]))nodeIssues(a.properties?.[k],b.properties?.[k],path+'.'+k,issues);
    if(stable([...(a.required||[])].sort())!==stable([...(b.required||[])].sort()))issues.push(path+'：必填字段约定不符');
  } else if(a.type==='array')nodeIssues(a.items,b.items,path+'[]',issues);
}
export function contractIssues(a,b) {
  const issues=[];
  if(!a||!b)return ['引擎缺少配置文件或表，需先完成引擎接入'];
  if(a.shape!==b.shape)return ['JSON 根结构不符：'+a.shape+' / '+b.shape];
  if(a.shape==='object')nodeIssues(a.value,b.value,'对象',issues);
  else {nodeIssues(a.record,b.record,'记录',issues);nodeIssues(a.metadata,b.metadata,'元数据',issues);}
  if(stable(a.constraints||{})!==stable(b.constraints||{}))issues.push('枚举或引用约束不符，请补充或更新引擎结构声明');
  return issues;
}
export function validateContract(c) {
  validateJson(c);
  if(!record(c)||!['object','array','rows'].includes(c.shape))throw new Error('引擎结构声明无效');
  function node(n,depth=0){
    if(depth>40||!record(n)||!['string','number','boolean','null','array','object','unknown'].includes(n.type))throw new Error('字段结构声明无效');
    if(n.type==='object'){if(!record(n.properties)||!Array.isArray(n.required)||n.required.some(k=>!Object.hasOwn(n.properties,k)))throw new Error('对象字段声明无效');Object.values(n.properties).forEach(v=>node(v,depth+1));}
    if(n.type==='array')node(n.items,depth+1);
  }
  if(c.shape==='object')node(c.value);else {node(c.record);node(c.metadata);}
}
export function validateAgainst(json,c,mapping={}) {
  validateContract(c);const v=canonical(json,mapping);if(!v||v.shape!==c.shape)throw new Error('JSON 根结构与声明不符');
  function check(value,n,path) {
    if(n.type==='unknown')throw new Error(path+'：声明仍包含 unknown，请指定实际类型');
    const type=value===null?'null':Array.isArray(value)?'array':typeof value;
    if(type!==n.type)throw new Error(path+'：实际类型 '+type+' 与声明 '+n.type+' 不符');
    if(type==='object'){for(const k of n.required)if(!Object.hasOwn(value,k))throw new Error(path+'.'+k+'：缺少必填字段');for(const k of Object.keys(value)){if(!n.properties[k])throw new Error(path+'.'+k+'：未声明的字段');check(value[k],n.properties[k],path+'.'+k);}}
    if(type==='array')value.forEach((x,i)=>check(x,n.items,path+'['+i+']'));
  }
  if(c.shape==='object')check(v.value,c.value,'对象');else {Object.values(v.rows).forEach(row=>check(row,c.record,row.id));check(v.metadata||{},c.metadata,'元数据');}
}
// Fill only absent evidence from an explicitly authored engine contract. Known evidence must still match.
function fillUnknown(node,declared) {
  if(node.type==='unknown')return declared;
  if(node.type==='array'&&declared?.type==='array')return {...node,items:fillUnknown(node.items,declared.items)};
  if(node.type==='object'&&declared?.type==='object')return {...node,properties:Object.fromEntries(Object.entries(node.properties).map(([k,v])=>[k,fillUnknown(v,declared.properties[k])])),required:declared.required};
  return node;
}
export function checkStructure(data,table,remote,scan=null,mapping={},declaration) {
  const local=toJson(data,table,mapping,scan),expected=developmentContract(data,table,scan,mapping);
  if(remote===undefined)return {issues:contractIssues(expected,null),contract:expected};
  let actual=jsonContract(remote,mapping),target=expected;
  if(declaration){
    validateContract(declaration);validateAgainst(remote,declaration,mapping);validateAgainst(local,declaration,mapping);
    target={...target};for(const k of ['value','record','metadata'])if(target[k])target[k]=fillUnknown(target[k],declaration[k]);
    // Declared fields must equal all development fields, including fields without sample values.
    const issues=contractIssues(target,declaration);if(issues.length)return {issues,contract:target};
    actual=declaration;
  }
  return {issues:contractIssues(target,actual),contract:target};
}
export function schemaDocument(store,context={}) {
  const scan=store.snapshots.find(s=>s.id===store.activeId)?.scan||null;
  return {schema:1,kind:'gamecreator-development-schema',...context,revision:store.revision,changes:releaseDiff(store.data,store.dataReleases?.releases.find(r=>r.id===store.dataReleases?.activeId)?.data),baselineVersion:store.dataReleases?.releases.find(r=>r.id===store.dataReleases?.activeId)?.version||null,instructions:'开发期望结构；不代表引擎已适配。引擎开发者核对实现后，将实际契约写入 _gamecreator/engine-schema.json，kind 为 gamecreator-engine-schema。unknown 需明确类型。此目录不参与配置表扫描。',tables:Object.fromEntries(Object.keys(store.data.datasets).map(table=>[table,describeTable(store.data,table,scan)]))};
}

function describeTable(data,table,scan) {
  const fields=data.columns[table],mapping=data.jsonFormats?.[table]?.mapping||{};
  try{return {contract:developmentContract(data,table,scan),fields,mapping};}
  catch(e){
    // Schema design must remain exportable even before values or enum bindings are filled in.
    const shape=data.jsonFormats?.[table]?.shape||'rows';
    const node={type:'object',properties:Object.fromEntries((shape==='object'?data.datasets[table].map(r=>({key:r.id,jsonType:r.type})):fields).map(c=>[c.key,{type:c.key==='id'?'string':c.jsonType||'unknown',...(c.jsonType==='array'?{items:{type:'unknown'}}:c.jsonType==='object'?{properties:{},required:[]}: {})}])),required:shape==='object'?[]:['id']};
    return {contract:shape==='object'?{shape,value:node}:{shape,record:node,metadata:inferNode([{}])},fields,mapping,warning:e.message};
  }
}
