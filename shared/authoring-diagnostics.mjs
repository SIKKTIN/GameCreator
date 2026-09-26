// Values are never embedded: diagnostics may be copied into logs or shared.
export function authoringError(error, scope='candidate', module='', operations=[]) {
 const source=Array.isArray(error?.diagnostics)?error.diagnostics:Array.isArray(error?.issues)?error.issues:[{code:'CONTENT_FORMAT',path:'',message:error instanceof Error?error.message:String(error)}];
 const diagnostics=source.slice(0,100).map(issue=>{
  const m=issue.module||module,p=issue.path||'';
  const matches=p?operations.filter(o=>o.module===m&&(p===o.path||p.startsWith(o.path+'/')||o.path.startsWith(p+'/'))).sort((a,b)=>b.path.length-a.path.length):[];
  const op=matches[0]||(operations.filter(o=>o.module===m).length===1?operations.find(o=>o.module===m):undefined);
  return {code:issue.code||'CONTENT_FORMAT',scope:issue.scope||scope,module:m,operationId:issue.operationId||op?.id||'',path:p||op?.path||'',message:issue.message,...(issue.expected?{expected:issue.expected}:{}),...(issue.actual?{actual:issue.actual}:{})};
 });
 const labels={candidate:'提交候选内容无效，未写入正式项目',baseline:'导出基准内容无效，请更新协作文件',current:'当前项目内容校验失败，请检查项目存档',proposal:'提交操作无效，未写入正式项目',reference:'提交产生失效引用，未写入正式项目'};
 const result=new Error((labels[scope]||'项目编写校验失败')+'\n'+diagnostics.map(d=>[d.operationId,d.module,d.path,d.message].filter(Boolean).join(' · ')).join('\n'));
 result.code='AUTHORING_VALIDATION';result.scope=scope;result.diagnostics=diagnostics;return result;
}
