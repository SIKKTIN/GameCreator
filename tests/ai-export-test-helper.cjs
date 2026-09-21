// Module regressions capture the batch IPC; the dedicated export test writes real files.
exports.finishAiExport=async page=>{
  const dialog=page.getByRole('dialog',{name:'生成 AI 文档',exact:true});
  await dialog.getByRole('button',{name:'生成文档文件夹',exact:true}).click();
  await dialog.getByRole('region',{name:'文档生成结果',exact:true}).waitFor();
  await dialog.getByRole('button',{name:'完成',exact:true}).click();
};
