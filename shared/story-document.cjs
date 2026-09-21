function storyExtras(input,fallback={},reject=message=>{throw new Error(message);}) {
  if(!input||typeof input!=='object'||Array.isArray(input))return reject('故事文档格式无效');
  const result={};
  for(const key of ['archived','format','references']) {
    const value=input[key]===undefined?fallback[key]:input[key];if(value===undefined)continue;
    if(key==='archived'&&typeof value!=='boolean'||key==='format'&&!['plain','markdown'].includes(value))reject('故事文档属性无效');
    if(key==='references') {
      if(!Array.isArray(value)||value.length>200)reject('故事引用格式无效');const seen=new Set();
      for(const r of value){if(!r||!['story','gameplay','capability','requirement','asset','map','character','narrative','task'].includes(r.kind)||typeof r.targetId!=='string'||!r.targetId.trim()||r.targetId.length>1000||typeof r.label!=='string'||r.label.length>2000||r.sourceOnly!==undefined&&typeof r.sourceOnly!=='boolean')reject('故事引用格式无效');const id=r.kind+':'+r.targetId;if(seen.has(id))reject('故事引用重复');seen.add(id);}
    }
    result[key]=value;
  }
  return result;
}

module.exports={storyExtras};
