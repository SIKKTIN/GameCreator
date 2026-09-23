import type {Feedback,FeedbackRow} from './engine-feedback.mjs';
export const projectContentModules:Record<string,string>;
export function contentJson(value:unknown):string;
export function projectChangeRows(feedback:Feedback,base:unknown,current:unknown):FeedbackRow[];
export function applyProjectRows(module:string,current:unknown,rows:FeedbackRow[],decisions?:Record<string,'keep'|'feedback'>):unknown;
export function assertContentChange(module:string,before:unknown,after:unknown,paths:string[]):void;
