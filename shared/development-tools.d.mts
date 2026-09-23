export const developmentToolKinds: readonly ['资源制作', '关卡编辑', '数据配置', '调试验证', '构建发布', '其他'];
export const developmentToolStatuses: readonly ['待开发', '开发中', '待验收', '可使用', '停用'];
export const developmentToolPriorities: readonly ['低', '普通', '高', '紧急'];
export type DevelopmentTool = { id:string; name:string; kind:typeof developmentToolKinds[number]; status:typeof developmentToolStatuses[number]; priority:typeof developmentToolPriorities[number]; owner:string; audience:string; purpose:string; scope:string; inputs:string; outputs:string; environment:string; acceptance:string; usage:string; delivery:string; capabilityIds:string[]; archived:boolean; scheduleAcceptance?:{taskIds:string[]} };
export type DevelopmentToolsStore = { schema:1; tools:DevelopmentTool[]; feedbackHistory?:import('./engine-feedback.mjs').FeedbackReceipt[] };
export function emptyDevelopmentTools():DevelopmentToolsStore;
export function createDevelopmentTool(name:string):DevelopmentTool;
export function validateDevelopmentTools(value:unknown):DevelopmentToolsStore;
export function developmentToolsMarkdown(store:DevelopmentToolsStore):string;
