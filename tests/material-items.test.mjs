import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {materialItems,materialForTarget,newMaterialItem,addMaterialDelivery,addMaterialRequirements,assignMaterialCategory} from '../src/material-items.ts';
import {emptyArtAssets,createArtAsset,createArtRequirement,validateArtMutation} from '../src/art-assets.ts';
import {artLibrary,assignArtCategory} from '../src/art-library.ts';
import {materialDeletionTargets,materialDeletionReferences,writeArtItemDeletion} from '../src/art-deletion.ts';
function paired(){const r=createArtRequirement('豌豆射手');r.category='角色';const a=createArtAsset('射手交付');return {schema:1,requirements:[r],assets:[a],links:[{id:'link',requirementId:r.id,assetId:a.id,note:''}]};}
test('legacy examples project to items without rewriting categories, identities, links or versions',()=>{
  for(const name of ['plants-vs-zombies','hollow-knight','stardew-valley','disco-elysium','vampire-survivors']){const s=JSON.parse(fs.readFileSync(new URL('../examples/prototypes/'+name+'.json',import.meta.url))).artAssets,before=JSON.stringify(s),items=materialItems(s);assert.equal(items.filter(i=>i.kind==='requirement').length,s.requirements.length);for(const a of s.assets)assert.ok(items.some(i=>i.assets.some(x=>x.id===a.id)));assert.equal(JSON.stringify(s),before);}
});
test('paired content appears once; files and asset names are searchable through the item',()=>{
  const s=paired(),a=s.assets[0];a.versions=[{id:'v1',name:'动画版',notes:'',placeholder:true,review:'待审核',feedback:'',files:[{id:'f',name:'pea-skeleton.json',size:12,mime:'application/json',storagePath:'keep/file.json'}],createdAt:new Date().toISOString()}];
  const items=materialItems(s);assert.equal(items.length,1);assert.equal(items[0].files,1);assert.equal(items[0].versions,1);assert.match(items[0].searchText,/pea-skeleton/);assert.equal(materialForTarget(s,{kind:'asset',id:a.id}).id,s.requirements[0].id);
});
test('shared resources retain every usage; archived requests do not reveal duplicate active cards',()=>{
  const s=paired(),r=createArtRequirement('商店预览');r.category='角色';s.requirements[0].archived=true;s.requirements.push(r);s.links.push({id:'l2',requirementId:r.id,assetId:s.assets[0].id,note:''});const items=materialItems(s);assert.equal(items.length,2);assert.equal(items.filter(i=>!i.archived).length,1);assert.equal(materialForTarget(s,{kind:'asset',id:s.assets[0].id}).id,r.id);assert.equal(materialDeletionTargets(s,{kind:'requirement',id:r.id}).length,1);
});
test('new item creation, first delivery and standalone conversion keep categories and original content',()=>{
  const category=artLibrary(emptyArtAssets()).categories[0].id,created=newMaterialItem(emptyArtAssets(),'向日葵',category);assert.equal(created.store.assets.length,0);assert.equal(created.store.requirements[0].category,'角色');const delivered=addMaterialDelivery(created.store,created.target.id);validateArtMutation(created.store,delivered.store);assert.equal(materialItems(delivered.store).length,1);assert.equal(artLibrary(delivered.store).assets[delivered.assetId],category);
  const asset=createArtAsset('旧素材'),s=assignArtCategory({...emptyArtAssets(),assets:[asset]},'asset',asset.id,category),converted=addMaterialRequirements(s,asset.id);validateArtMutation(s,converted.store);assert.deepEqual(converted.store.assets,s.assets);assert.equal(materialItems(converted.store).length,1);
});
test('moving one item moves its exclusive resources, while shared and independently classified resources survive',()=>{
  let s=paired();s={...s,library:artLibrary(s)};const r=s.requirements[0],a=s.assets[0],category=s.library.categories.find(c=>c.name==='动画').id;
  const moved=assignMaterialCategory(s,{kind:'requirement',id:r.id},category);assert.equal(moved.library.assets[a.id],category);assert.equal(materialItems(moved).length,1);
  const other=createArtRequirement('共享');s.requirements.push(other);s.links.push({id:'l2',assetId:a.id,requirementId:other.id,note:''});const shared=assignMaterialCategory(s,{kind:'requirement',id:r.id},category);assert.equal(shared.library.assets[a.id],s.library.assets[a.id]);assert.ok(materialItems(shared).some(i=>i.kind==='asset'&&i.id===a.id));
});
test('deleting a unified item is atomic and preserves shared resources; external references block the whole operation',()=>{
  const s=paired(),r=s.requirements[0],a=s.assets[0];let raw=JSON.stringify(s);const storage={getItem:()=>raw,setItem:(_k,v)=>{raw=v;}};
  assert.deepEqual(materialDeletionReferences(s,{kind:'requirement',id:r.id}),[]);assert.throws(()=>writeArtItemDeletion(storage,'key',raw,{kind:'requirement',id:r.id},['原型 / 头像'],true),/原型/);assert.equal(raw,JSON.stringify(s));
  assert.throws(()=>writeArtItemDeletion({...storage,setItem:()=>{throw new Error('disk full');}},'key',raw,{kind:'requirement',id:r.id},[],true),/disk full/);assert.equal(raw,JSON.stringify(s));
  const result=writeArtItemDeletion(storage,'key',raw,{kind:'requirement',id:r.id},[],true);assert.equal(result.store.requirements.length,0);assert.equal(result.store.assets.length,0);assert.equal(result.store.links.length,0);
  const other=createArtRequirement('另一条目');s.requirements.push(other);s.links.push({id:'l2',requirementId:other.id,assetId:a.id,note:''});raw=JSON.stringify(s);const shared=writeArtItemDeletion(storage,'key',raw,{kind:'requirement',id:r.id},[],true);assert.equal(shared.store.assets[0].id,a.id);assert.equal(shared.store.links[0].requirementId,other.id);
});
