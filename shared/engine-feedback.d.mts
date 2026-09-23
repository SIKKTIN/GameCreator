export type FeedbackKind='task'|'tool'|'module';
export type FeedbackIdentity={verified:true;memberId:string;credentialId:string;memberName:string;intent:'progress'|'review'|'propose'|'spec_change'|'project_change'};
export type Feedback={compatibility?:import('./project-standards.mjs').CompatibilityPlan;reason?:string;impact?:string;intent?:'progress'|'review'|'propose'|'spec_change'|'project_change';identity?:{memberId:string;credentialId:string;signature:string};schema:1;projectId:string;engine:string;id:string;snapshotId:string;target:{kind:FeedbackKind;id:string};author:string;summary:string;evidence:string[];changes:Record<string,string>};
export type FeedbackRow={field:string;label:string;base:string;current:string;incoming:string;state:'updated'|'unchanged'|'conflict'};
export type FeedbackReceipt={compatibility?:import('./project-standards.mjs').CompatibilityPlan;reason?:string;impact?:string;identity?:FeedbackIdentity;schema:1;id:string;projectId:string;engine:string;digest:string;snapshotId:string;target:Feedback['target'];title:string;at:string;outcome:'applied'|'dismissed';author:string;summary:string;evidence:string[];rows:FeedbackRow[];decisions:Record<string,'keep'|'feedback'>};
export const feedbackFields:Record<FeedbackKind,Record<string,string>>;
export const feedbackIdPattern:RegExp;
export const snapshotIdPattern:RegExp;
export function stableFeedbackJson(value:unknown):string;
export function validateFeedback(value:unknown):Feedback;
export function validateFeedbackHistory(value:unknown,kind:FeedbackKind):FeedbackReceipt[];
export function feedbackDiff(feedback:Feedback,base:unknown,current:unknown):FeedbackRow[];
export function mergeFeedback<T>(current:T,rows:FeedbackRow[],decisions:Record<string,'keep'|'feedback'>,acceptCompletion?:boolean):T;
export function feedbackBatchItems<T extends {state:string;feedback?:Feedback;token?:string;error?:string;rows:FeedbackRow[]}>(entries:T[],acceptCompletion?:boolean):{ready:T[];skipped:{entry:T;reason:string}[]};
export function collaborationReadme(project:{projectName:string;projectId:string;engine:string;snapshotId:string}):string;

export const feedbackIntentLabels:Record<string,string>;
