import {emptyArtStyle} from './art-style.ts';
import type {ArtStore} from './art-assets';
export function applyReferenceBoard(store:ArtStore,id:string):ArtStore{
 const board=store.referenceBoards?.find(b=>b.id===id);if(!board)throw new Error('参考板已移除');
 const refs=board.references.filter(r=>r.active);if(refs.some(r=>!r.use.trim()||!r.take.trim()))throw new Error('请先填写每张参考图的用途与借鉴内容');
 const style=store.style||emptyArtStyle(),ids=new Set(board.references.map(r=>'reference-'+r.id)),start='【参考板 '+board.id+'】',end='【参考板结束】';
 const clean=(rules:string)=>{const a=rules.indexOf(start),b=rules.indexOf(end,a);return a>=0&&b>=0?(rules.slice(0,a)+rules.slice(b+end.length)).trim():rules;};
 const categories=style.draft.categories.map(c=>({...c,rules:clean(c.rules)}));
 const references=style.draft.references.filter(r=>!ids.has(r.id));
 if(board.categoryId){const old=categories.find(c=>c.id===board.categoryId)?.rules||'',section=refs.length?[start,board.name,...refs.map(r=>r.metadata.name+'：'+(r.strength==='required'?'必须遵守':'仅供启发')+'；用途：'+r.use+'；借鉴：'+r.take+'；排除：'+r.avoid),end].join('\n'):'';const rules=[old,section].filter(Boolean).join('\n');return {...store,style:{...style,draft:{...style.draft,references,categories:[...categories.filter(c=>c.id!==board.categoryId),{id:board.categoryId,rules}]}}};}
 return {...store,style:{...style,draft:{...style.draft,categories,references:[...references,...refs.map(r=>({id:'reference-'+r.id,title:(board.name+' / '+r.metadata.name).slice(0,200),source:r.metadata.source||'项目参考图 '+r.image.storagePath,take:(r.strength==='required'?'必须遵守':'仅供启发')+'；用途：'+r.use+'；'+r.take,avoid:r.avoid}))]}}};
}
