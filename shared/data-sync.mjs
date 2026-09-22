// JSON transport is separate from the string cells used by the design editor.
export const record = v => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (v,k) => Object.prototype.hasOwnProperty.call(v,k);
export const safeKey = k => typeof k === 'string' && !!k && !['__proto__','prototype','constructor'].includes(k);
export const jsonType = v => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
export const stable = v => v === undefined ? 'undefined' : JSON.stringify(v, (_,x) => record(x) ? Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])) : x);
const equal = (a,b) => stable(a) === stable(b);
export function validateJson(v, depth=0) {
  if(depth>64)throw new Error('JSON 嵌套超过 64 层');
  if(v===null||typeof v==='string'||typeof v==='boolean')return;
  if(typeof v==='number') {if(!Number.isFinite(v)||Number.isInteger(v)&&!Number.isSafeInteger(v))throw new Error('数字超出安全范围，请改用字符串');return;}
  if(Array.isArray(v)){v.forEach(x=>validateJson(x,depth+1));return;}
  if(!record(v))throw new Error('不是有效 JSON 值');
  for(const [k,x] of Object.entries(v)){if(!safeKey(k))throw new Error('不支持的字段名：'+k);validateJson(x,depth+1);}
}
// Reject duplicate keys before JSON.parse can silently discard them.
export function parseJson(text) {
  const tokens=text.replace(/^\uFEFF/,'').match(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g)||[];
  let i=0;
  function walk(depth=0) {
    if(depth>64)throw new Error('JSON 嵌套超过 64 层');
    const t=tokens[i++];
    if(t==='{'){const keys=new Set();if(tokens[i]==='}'){i++;return;}while(i<tokens.length){const k=JSON.parse(tokens[i++]);if(typeof k!=='string'||keys.has(k))throw new Error('JSON 字段重复：'+k);keys.add(k);if(tokens[i++]!==':')throw new Error('JSON 格式无效');walk(depth+1);const end=tokens[i++];if(end==='}')return;if(end!==',')throw new Error('JSON 格式无效');}throw new Error('JSON 对象未结束');}
    if(t==='['){if(tokens[i]===']'){i++;return;}while(i<tokens.length){walk(depth+1);const end=tokens[i++];if(end===']')return;if(end!==',')throw new Error('JSON 格式无效');}throw new Error('JSON 数组未结束');}
    JSON.parse(t);
  }
  walk();if(i!==tokens.length)throw new Error('JSON 格式无效');
  const value=JSON.parse(text.replace(/^\uFEFF/,''));validateJson(value);return value;
}
export function dataDirectory(value) {
  const s=String(value||'').trim().replace(/^res:\/\//,'').replace(/\\/g,'/').replace(/\/+$/,'');
  if(!s||s.length>200||s.split('/').some(p=>!p||p==='.'||p==='..'||/[<>:"|?*\x00-\x1f]/.test(p)||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))||s.split('/').some(p=>['.gamecreator-sync','.godot','.git','gamecreator'].includes(p.toLowerCase())))throw new Error('数据目录必须是工程内的普通子目录，不能使用协作、缓存或同步记录目录');
  return s;
}
export function tableName(filename) {
  const name=filename.replace(/\.json$/i,'');
  if(name===filename||!safeKey(name)||/[\\/:<>"|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))throw new Error('文件名不能作为配置表名：'+filename);
  return name;
}
export function shapeOf(value) {
  validateJson(value);
  const shape=Array.isArray(value)?'array':record(value)&&Array.isArray(value.rows)?'rows':record(value)?'object':null;
  if(!shape)throw new Error('根节点需为对象或记录数组');
  if(shape!=='object') {
    const rows=shape==='rows'?value.rows:value,ids=new Set();
    for(const r of rows){if(!record(r)||typeof r.id!=='string'||!safeKey(r.id)||ids.has(r.id))throw new Error('记录必须包含非空且唯一的字符串 id');ids.add(r.id);}
  }
  return shape;
}
export function validateMapping(mapping) {
  if(!record(mapping)||Object.entries(mapping).some(([a,b])=>!safeKey(a)||!safeKey(b))||new Set(Object.values(mapping)).size!==Object.keys(mapping).length||mapping.id&&mapping.id!=='id')throw new Error('字段映射必须一一对应，id 保持不变');
  return mapping;
}
export function canonical(json,mapping={}) {
  if(json===undefined)return undefined;
  validateMapping(mapping);const shape=shapeOf(json);
  if(shape==='object')return {shape,value:json};
  const source=shape==='rows'?json.rows:json,reverse=Object.fromEntries(Object.entries(mapping).map(([a,b])=>[b,a]));
  const rows=Object.fromEntries(source.map(row=>{
    const converted={};for(const [k,v] of Object.entries(row)){const key=reverse[k]||k;if(own(converted,key))throw new Error('字段映射重名：'+key);converted[key]=v;}return [row.id,converted];
  }));
  const {rows:unused,...metadata}=shape==='rows'?json:{};
  return {shape,metadata,order:source.map(r=>r.id),rows};
}
export function fromCanonical(value,mapping={}) {
  if(value.shape==='object'){shapeOf(value.value);return value.value;}
  const ids=[...new Set([...value.order,...Object.keys(value.rows)])].filter(id=>own(value.rows,id));
  const rows=ids.map(id=>{
    const result={};for(const [k,v] of Object.entries(value.rows[id])){const key=mapping[k]||k;if(own(result,key))throw new Error('字段映射重名：'+key);result[key]=v;}return result;
  });
  const json=value.shape==='rows'?{...value.metadata,rows}:rows;shapeOf(json);return json;
}
function enumMembers(column,scan) {
  return scan?.groups.find(g=>g.source.replace(/\\/g,'/') && (g.engine==='godot-gdscript'?'godot:'+g.source.replace(/\\/g,'/')+'#'+g.name:g.source.replace(/\\/g,'/').replace(/\.lua$/i,'').replace(/\//g,'.')+'#'+g.name.split('.').slice(1).join('.'))===column.enumId)?.members||[];
}
export function toData(data,table,json,mapping={},scan=null) {
  if(!safeKey(table))throw new Error('配置表名无效');
  const c=canonical(json,mapping),old=data.columns[table]||[],next=structuredClone(data);
  if(c.shape==='object') {
    next.columns[table]=[{key:'id',label:'字段'},{key:'type',label:'类型'},{key:'value',label:'值'}];
    next.datasets[table]=Object.entries(c.value).map(([id,v])=>({id,type:jsonType(v),value:JSON.stringify(v)}));
  }else {
    const keys=[...new Set(['id',...Object.values(c.rows).flatMap(Object.keys)])];
    next.columns[table]=keys.map(key=>old.find(col=>col.key===key)||{key,label:key});
    next.datasets[table]=c.order.map(id=>Object.fromEntries(Object.entries(c.rows[id]).map(([k,v])=>{
      const col=old.find(x=>x.key===k);
      if(col?.jsonType&&col.type!=='enum'&&col.jsonType!==jsonType(v))throw new Error(table+'.'+k+' 与已指定的 JSON 类型 '+col.jsonType+' 不一致，请修改类型定义或选择对应类型的值');
      if(col?.type==='enum'&&col.enumId){const member=enumMembers(col,scan).find(m=>equal(m.value,v));if(!member)throw new Error(table+'.'+k+' 的引擎枚举值不存在：'+JSON.stringify(v));return [k,member.key];}
      if(col?.type==='enum'&&(!col.options?.length||!col.options.includes(v)))throw new Error(table+'.'+k+' 不属于已定义枚举选项');
      return [k,typeof v==='string'?v:JSON.stringify(v)];
    })));
  }
  next.jsonFormats={...next.jsonFormats,[table]:{shape:c.shape,template:json,mapping}};
  return next;
}
export function toJson(data,table,mapping,scan=null,remoteTemplate) {
  const format=data.jsonFormats?.[table];mapping=mapping||format?.mapping||{};validateMapping(mapping);
  const template=remoteTemplate??format?.template,source=template===undefined?{shape:'rows',metadata:{},rows:{},order:[]}:canonical(template,mapping);
  if(!data.datasets[table])return undefined;
  if(format?.shape==='object'||source.shape==='object') {
    const value={};for(const row of data.datasets[table]){if(!safeKey(row.id)||own(value,row.id))throw new Error('对象字段名称重复或无效');value[row.id]=parseJson(row.value);if(jsonType(value[row.id])!==row.type)throw new Error(row.id+' 的类型与值不一致');}return value;
  }
  const rows={},cols=data.columns[table];
  const sample=Object.values(source.rows);
  for(const row of data.datasets[table]) {
    if(!safeKey(row.id)||own(rows,row.id))throw new Error(table+' 的 id 重复或为空');
    const result={};
    for(const col of cols) {
      if(!own(row,col.key))continue;
      const text=row[col.key];let value=text;
      const previous=source.rows[row.id];
      const examples=sample.filter(r=>own(r,col.key)).map(r=>r[col.key]);
      const type=col.key==='id'?'string':col.jsonType||(previous&&own(previous,col.key)?jsonType(previous[col.key]):examples.length&&examples.every(v=>jsonType(v)===jsonType(examples[0]))?jsonType(examples[0]):'string');
      if(col.type==='enum'&&col.enumId){const member=enumMembers(col,scan).find(m=>m.key===text);if(!member)throw new Error(table+'.'+col.key+' 请先审核或修复绑定的枚举');value=member.value;}
      else if(col.type==='enum'){if(!col.options?.includes(text))throw new Error(table+'.'+col.key+' 不属于已定义枚举选项');}
      else if(type!=='string'){value=parseJson(text);if(jsonType(value)!==type)throw new Error(table+'/'+row.id+'/'+col.key+' 需要 '+type+' 类型');}
      if(col.type==='reference'&&!data.datasets[col.reference]?.some(r=>r.id===text))throw new Error(table+'/'+row.id+'/'+col.key+' 引用记录不存在');
      result[col.key]=value;
    }
    rows[row.id]=result;
  }
  return fromCanonical({...source,rows,order:data.datasets[table].map(r=>r.id)},mapping);
}
export function diffJson(local,remote,baseline,direction) {
  const differences=[];
  function walk(l,r,bl,br,path=[]) {
    if(equal(l,r))return;
    if(record(l)&&record(r)) {for(const k of new Set([...Object.keys(l),...Object.keys(r)]))walk(l[k],r[k],bl?.[k],br?.[k],[...path,k]);return;}
    const lc=!baseline||!equal(l,bl),rc=!baseline||!equal(r,br);
    // An export must not silently overwrite an engine-only edit.
    const conflict=baseline?(lc&&rc||direction==='export'&&rc):l!==undefined&&r!==undefined;
    const choice=conflict?'':!baseline?(r===undefined?'local':'remote'):rc?'remote':'local';
    differences.push({id:JSON.stringify(path),path,local:l,remote:r,baseLocal:bl,baseRemote:br,conflict,choice,deletion:(choice==='remote'?r:l)===undefined});
  }
  walk(local,remote,baseline?.local,baseline?.remote);
  return differences;
}
export function resolveDiff(local,rows,decisions={}) {
  let output=structuredClone(local);
  for(const row of rows) {
    const decision=decisions[row.id]||{choice:row.choice};
    if(!['local','remote','custom'].includes(decision.choice))throw new Error('请解决所有冲突');
    const value=decision.choice==='custom'?parseJson(decision.value):row[decision.choice];
    if(value===undefined&&!decision.allowDelete)throw new Error('删除需要逐项确认');
    if(!row.path.length){output=structuredClone(value);continue;}
    let target=output;for(const k of row.path.slice(0,-1))target=target[k];
    if(value===undefined)delete target[row.path.at(-1)];else target[row.path.at(-1)]=structuredClone(value);
  }
  return output;
}
export function validateDataSync(store) {
  for(const cols of Object.values(store.data?.columns||{}))for(const c of cols)if(c.jsonType!==undefined&&!['string','number','boolean','null','array','object'].includes(c.jsonType))throw new Error('JSON 字段类型无效');
  const formats=store.data?.jsonFormats;
  if(formats!==undefined){if(!record(formats))throw new Error('JSON 格式存档无效');for(const [table,f] of Object.entries(formats)){if(!safeKey(table)||!record(f)||shapeOf(f.template)!==f.shape)throw new Error('JSON 配置结构无效');validateMapping(f.mapping);}}
  if(store.dataSync!==undefined){const s=store.dataSync;if(s.schema!==1||!record(s.bindings)||!Array.isArray(s.history))throw new Error('数据同步存档无效');for(const [table,b] of Object.entries(s.bindings)){if(!safeKey(table)||typeof b.scope!=='string'||!record(b.baseline))throw new Error('数据绑定无效');validateMapping(b.mapping);validateJson(b.baseline);}for(const h of s.history)if(!h||!/^[-a-f0-9]{36}$/.test(h.id)||!['import','export','undo'].includes(h.direction)||!Array.isArray(h.tables)||typeof h.at!=='string')throw new Error('数据同步记录无效');}
}
