import type { ArtStore } from './art-assets';
export type ArtLibraryCategory = { id: string; name: string; description: string };
export type ArtLibrary = { categories: ArtLibraryCategory[]; requirements: Record<string, string>; assets: Record<string, string> };
export type ArtItemKind = 'requirement' | 'asset';
const defaults = ['角色','敌人与首领','场景','道具','动画','特效','UI','图标','音频'];
/** Derive legacy organization without modifying documents, versions or storage on read. */
export function artLibrary(store: ArtStore): ArtLibrary {
  if (store.library) return store.library;
  const categories = defaults.map((name,i) => ({ id:'art-category-'+i, name, description:'管理'+name+'相关的制作需求与交付资产。' }));
  const requirements: Record<string,string> = {}, assets: Record<string,string> = {};
  for (const r of store.requirements) {
    const name = /音效|音乐|声音预算/.test(r.name) ? '音频' : r.category === '角色' && /僵尸|首领|守卫|敌|爬行虫|守碑虫|残影/.test(r.name) ? '敌人与首领' : r.category;
    requirements[r.id] = categories.find(c=>c.name===name)?.id || '';
  }
  for (const a of store.assets) {
    const ids = [...new Set(store.links.filter(l=>l.assetId===a.id).map(l=>requirements[l.requirementId] || ''))];
    assets[a.id] = ids.length === 1 ? ids[0] : '';
  }
  return { categories, requirements, assets };
}
export const artCategoryId = (library: ArtLibrary, kind: ArtItemKind, id: string) => (kind === 'requirement' ? library.requirements : library.assets)[id] || '';
export const artCategoryName = (library: ArtLibrary, id: string) => library.categories.find(c=>c.id===id)?.name || '未分类';
export function validateArtLibrary(value: unknown, store: ArtStore): void {
  const object = (x: unknown): x is Record<string,unknown> => !!x && typeof x==='object' && !Array.isArray(x);
  const fail = () => { throw new Error('美术分类存档格式异常，已停止写入'); };
  if (!object(value) || !Array.isArray(value.categories) || !object(value.requirements) || !object(value.assets)) return fail();
  const ids=new Set<string>(),names=new Set<string>();
  for(const c of value.categories) {
    if(!object(c)||typeof c.id!=='string'||!c.id.trim()||['all','__proto__','constructor','prototype'].includes(c.id)||ids.has(c.id)||typeof c.name!=='string'||!c.name.trim()||c.name.trim().length>60||names.has(c.name.trim().toLocaleLowerCase())||['未分类','全部分类'].includes(c.name.trim())||typeof c.description!=='string')return fail();
    ids.add(c.id);names.add(c.name.trim().toLocaleLowerCase());
  }
  for(const [mapping,items] of [[value.requirements,store.requirements],[value.assets,store.assets]] as const){
    const itemIds=new Set(items.map(i=>i.id));for(const [id,category]of Object.entries(mapping))if(!itemIds.has(id)||typeof category!=='string'||(category!==''&&!ids.has(category)))return fail();
  }
}
export function assignArtCategory(store: ArtStore, kind: ArtItemKind, id: string, categoryId: string): ArtStore {
  const library=structuredClone(artLibrary(store));
  if(!store[kind==='requirement'?'requirements':'assets'].some(i=>i.id===id))throw new Error('美术条目不存在');
  if(categoryId&&!library.categories.some(c=>c.id===categoryId))throw new Error('美术分类不存在');
  (kind==='requirement'?library.requirements:library.assets)[id]=categoryId;
  return {...store,library};
}
export function saveArtCategory(store: ArtStore, name: string, description: string, id?: string): ArtStore {
  name=name.trim();const library=structuredClone(artLibrary(store));
  if(!name||name.length>60||['未分类','全部分类'].includes(name))throw new Error('分类名称须为 1 至 60 个字符，且不能使用保留名称');
  if(library.categories.some(c=>c.id!==id&&c.name.toLocaleLowerCase()===name.toLocaleLowerCase()))throw new Error('已存在同名分类');
  if(id&&!library.categories.some(c=>c.id===id))throw new Error('分类不存在');
  const category={id:id||crypto.randomUUID(),name,description};
  library.categories=id?library.categories.map(c=>c.id===id?category:c):[...library.categories,category];return {...store,library};
}
export function removeArtCategory(store: ArtStore, id: string): ArtStore {
  const library=structuredClone(artLibrary(store));library.categories=library.categories.filter(c=>c.id!==id);
  for(const map of [library.requirements,library.assets])for(const key of Object.keys(map))if(map[key]===id)map[key]='';
  return {...store,library};
}
export function moveArtCategory(store: ArtStore, id: string, delta: number): ArtStore {
  const library=structuredClone(artLibrary(store)),index=library.categories.findIndex(c=>c.id===id),target=index+delta;
  if(index<0||target<0||target>=library.categories.length)return store;
  const [item]=library.categories.splice(index,1);library.categories.splice(target,0,item);return {...store,library};
}
