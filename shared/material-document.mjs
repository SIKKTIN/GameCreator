export function validateMaterialDocumentFields(item) {
  const record=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
  if(item.delivery!==undefined&&(!record(item.delivery)||typeof item.delivery.path!=='string'||typeof item.delivery.notes!=='string'||item.delivery.path.length>2000||item.delivery.notes.length>30000))throw new Error('素材工程交付说明格式异常');
  if(item.productionStatus!==undefined&&!['待制作','制作中','待审核','需修改','已通过'].includes(item.productionStatus))throw new Error('素材制作状态无效');
  if(item.scheduleProgress!==undefined&&(!record(item.scheduleProgress)||!Array.isArray(item.scheduleProgress.taskIds)||!item.scheduleProgress.taskIds.length||item.scheduleProgress.taskIds.some(id=>typeof id!=='string'||!id.trim())||new Set(item.scheduleProgress.taskIds).size!==item.scheduleProgress.taskIds.length))throw new Error('素材排期来源格式异常');
}
