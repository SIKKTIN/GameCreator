import {record,safeKey,stable,toJson,validateDataSync,validateJson} from './data-sync.mjs';
export function releaseDiff(data,previous) {
  const rows=[];
  for(const table of new Set([...Object.keys(previous?.datasets||{}),...Object.keys(data.datasets)])) {
    const before=previous?.datasets[table],after=data.datasets[table],a=new Map((previous?.columns[table]||[]).map(c=>[c.key,c])),b=new Map((data.columns[table]||[]).map(c=>[c.key,c]));
    const fields=[...new Set([...a.keys(),...b.keys()])].filter(k=>stable(a.get(k))!==stable(b.get(k)));
    if(data.jsonFormats?.[table]?.shape==='object'||previous?.jsonFormats?.[table]?.shape==='object'){
      const oldTypes=new Map((before||[]).map(r=>[r.id,r.type])),newTypes=new Map((after||[]).map(r=>[r.id,r.type]));
      for(const k of new Set([...oldTypes.keys(),...newTypes.keys()]))if(oldTypes.get(k)!==newTypes.get(k)&&!fields.includes(k))fields.push(k);
    }
    const old=new Map((before||[]).map(r=>[r.id,r])),next=new Map((after||[]).map(r=>[r.id,r]));
    const added=[...next.keys()].filter(id=>!old.has(id)),removed=[...old.keys()].filter(id=>!next.has(id)),changed=[...next.keys()].filter(id=>old.has(id)&&stable(old.get(id))!==stable(next.get(id)));
    if(!before||!after||fields.length||added.length||removed.length||changed.length||stable(previous?.jsonFormats?.[table])!==stable(data.jsonFormats?.[table]))rows.push({table,kind:!before?'新增表':!after?'删除表':'修改',fields,added:added.length,removed:removed.length,changed:changed.length});
  }
  return rows;
}
export function validateDataReleases(store) {
  const state=store.dataReleases;if(state===undefined)return;
  if(!record(state)||state.schema!==1||!Array.isArray(state.releases)||typeof state.activeId!=='string'||!state.releases.some(r=>r?.id===state.activeId))throw new Error('稳定版存档无效');
  const ids=new Set(),versions=new Set();
  for(const r of state.releases){
    if(!record(r)||typeof r.id!=='string'||ids.has(r.id)||typeof r.version!=='string'||!r.version.trim()||versions.has(r.version)||typeof r.note!=='string'||typeof r.at!=='string'||!Number.isFinite(Date.parse(r.at))||!record(r.data?.datasets)||!record(r.data?.columns))throw new Error('稳定版本记录无效');
    ids.add(r.id);versions.add(r.version);validateJson(r.data);
    if(stable(Object.keys(r.data.datasets).sort())!==stable(Object.keys(r.data.columns).sort()))throw new Error('稳定版表结构不完整');
    for(const [table,rows] of Object.entries(r.data.datasets)){const cols=r.data.columns[table];if(!safeKey(table)||!Array.isArray(rows)||!Array.isArray(cols)||cols.some(c=>!record(c)||!safeKey(c.key)||typeof c.label!=='string')||rows.some(row=>!record(row)||typeof row.id!=='string'||Object.values(row).some(v=>typeof v!=='string')))throw new Error('稳定版数据无效');}
    for(const table of Object.keys(r.data.datasets)){
      const cols=r.data.columns[table],rows=r.data.datasets[table];
      if(new Set(cols.map(c=>c.key)).size!==cols.length||new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error('稳定版字段或记录重复');
    }
    if(r.scan!==null&&(!record(r.scan)||!Array.isArray(r.scan.groups)||r.scan.groups.some(g=>!record(g)||typeof g.name!=='string'||typeof g.source!=='string'||!Array.isArray(g.members))))throw new Error('稳定版枚举上下文无效');
    if(!record(r.connection)||typeof r.connection.projectPath!=='string'||typeof r.connection.dataPath!=='string')throw new Error('稳定版工程上下文无效');
    validateDataSync({data:r.data});
  }
}
export function publishData(store,{id,at,version,note,verified,connection}) {
  validateDataReleases(store);
  if(verified!==true)throw new Error('请确认已在引擎验证运行');
  version=String(version||'').trim();note=String(note||'').trim();
  if(!version||version.length>80||!note||note.length>4000)throw new Error('请填写版本号与发布说明（最多 80 / 4000 字）');
  if(store.dataReleases?.releases.some(r=>r.version===version))throw new Error('版本号已存在，请使用新版本号');
  if(!Object.keys(store.data.datasets).length)throw new Error('开发版没有配置表');
  const scan=store.snapshots.find(s=>s.id===store.activeId)?.scan||null;
  for(const table of Object.keys(store.data.datasets))toJson(store.data,table,undefined,scan);
  const release={id,at,version,note,data:structuredClone(store.data),scan:structuredClone(scan),connection:structuredClone(connection)};
  return {...store,dataReleases:{schema:1,activeId:id,releases:[release,...(store.dataReleases?.releases||[])]}};
}
export function restoreDataRelease(store,id) {
  validateDataReleases(store);const r=store.dataReleases?.releases.find(r=>r.id===id);if(!r)throw new Error('稳定版本不存在');
  // Stable snapshots stay immutable; restored development data must be checked against current engine/enums again.
  return {...store,data:structuredClone(r.data),dataSync:{schema:1,bindings:{},history:store.dataSync?.history||[]}};
}
