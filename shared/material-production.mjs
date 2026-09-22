export function validateProductionDocs(value) {
  if(value===undefined)return [];
  if(!Array.isArray(value))throw new Error('制作方案必须是文档列表');
  const ids=new Set(),tokens=/^[0-9a-f-]{36}\.[a-z0-9]{1,12}$/;
  for(const doc of value){
    if(!doc||['id','title','category','content','createdAt','updatedAt'].some(k=>typeof doc[k]!=='string')||!doc.id||ids.has(doc.id)||!Number.isFinite(Date.parse(doc.createdAt))||!Number.isFinite(Date.parse(doc.updatedAt)))throw new Error('制作方案文档格式无效');
    ids.add(doc.id);
    for(const k of ['requirementIds','assetIds'])if(!Array.isArray(doc[k])||doc[k].some(id=>typeof id!=='string'||!id)||new Set(doc[k]).size!==doc[k].length)throw new Error('制作方案关联无效');
    if(!Array.isArray(doc.images)||doc.images.some(f=>!f||['id','name','mime','storagePath'].some(k=>typeof f[k]!=='string')||!/^image\/(png|jpeg|gif|webp|bmp|avif)$/.test(f.mime)||!tokens.test(f.storagePath)||!Number.isSafeInteger(f.size)||f.size<0)||new Set(doc.images.map(f=>f.storagePath)).size!==doc.images.length)throw new Error('制作方案图片记录无效');
  }
  return value;
}
export const productionTemplate = '## 方案目标\n\n说明这份方案要解决什么问题，以及适用的素材。\n\n## 技术与工具选择\n\n记录采用的制作方式、工具和选择依据。\n\n## 制作步骤\n\n描述素材拆分、制作与复用方法。\n\n## 交付与引擎接入\n\n说明文件格式、目录、命名及接入方式。\n\n## 注意事项\n\n记录限制、已验证结果与待解决的问题。\n';
