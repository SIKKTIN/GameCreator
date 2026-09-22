// Resolve old asset deep links to their unified card, then select that delivery.
exports.openAsset=async(page,store,id)=>{
  const {materialForTarget}=await import('../src/material-items.ts');
  const item=materialForTarget(store,{kind:'asset',id});
  if(!item)throw new Error('Material asset target not found');
  await page.getByRole('button',{name:'打开素材条目：'+item.name,exact:true}).click();
  await page.getByRole('tab',{name:'交付与版本',exact:true}).click();
  const selector=page.getByLabel('当前交付资源',{exact:true});if(await selector.count())await selector.selectOption(id);
};
