import type {StoryDoc,StoryReference} from './story-model.ts';
export const storyKinds = {story:'故事文档',gameplay:'玩法设计',capability:'程序功能',requirement:'素材需求',asset:'素材资产',map:'地图',character:'故事角色',narrative:'故事编排',task:'任务与流程'} as const;
export type StoryTarget=StoryReference & {unavailable?:boolean};
export const storyCategories = [
 {name:'世界观',description:'世界规则、历史与冲突的起点。',icon:'world'},
 {name:'角色设定',description:'记录人物的背景、动机与关系。',icon:'character'},
 {name:'地点设定',description:'描述区域、环境与探索线索。',icon:'map'},
 {name:'阵营设定',description:'梳理组织目标、立场与矛盾。',icon:'faction'},
 {name:'主线剧情',description:'组织章节、事件与叙事节奏。',icon:'plot'},
 {name:'支线剧情',description:'补充支线故事与世界细节。',icon:'plot'},
];
export function validateStoryExtras(v:unknown) {
 const s=v as Partial<StoryDoc>;if(!s||typeof s!=='object')throw new Error('故事文档格式无效');
 if(s.archived!==undefined&&typeof s.archived!=='boolean'||s.format!==undefined&&!['plain','markdown'].includes(s.format)||s.updatedAt!==undefined&&(typeof s.updatedAt!=='string'||!Number.isFinite(Date.parse(s.updatedAt))))throw new Error('故事文档属性无效');
 if(s.references!==undefined){if(!Array.isArray(s.references)||s.references.length>200)throw new Error('故事引用格式无效');const keys=new Set();for(const r of s.references){if(!r||!Object.prototype.hasOwnProperty.call(storyKinds,r.kind)||typeof r.targetId!=='string'||!r.targetId.trim()||r.targetId.length>1000||typeof r.label!=='string'||r.label.length>2000||r.sourceOnly!==undefined&&typeof r.sourceOnly!=='boolean')throw new Error('故事引用格式无效');const key=r.kind+':'+r.targetId;if(keys.has(key))throw new Error('故事引用重复');keys.add(key);}}
}
export function storyExtras(s:Partial<StoryDoc>) {validateStoryExtras(s);return {...(s.archived===undefined?{}:{archived:s.archived}),...(s.format===undefined?{}:{format:s.format}),...(s.references===undefined?{}:{references:s.references})};}
export function validateStories(v:unknown):StoryDoc[]{
 if(!Array.isArray(v))throw new Error('故事文档存档应为列表');const ids=new Set();for(const s of v){validateStoryExtras(s);if(['id','title','category','status','updated','summary','content'].some(k=>typeof s[k]!=='string')||!s.id||ids.has(s.id)||!['tags','outlines'].every(k=>Array.isArray(s[k])&&s[k].every((x:unknown)=>typeof x==='string'))||!s.relations||!['characters','locations','systems'].every(k=>Array.isArray(s.relations[k])&&s.relations[k].every((x:unknown)=>typeof x==='string')))throw new Error('故事文档存档格式异常');ids.add(s.id);}return v;
}
export const storyTemplates = {
 blank:{name:'空白文档',category:'世界观',content:''},
 character:{name:'角色设定',category:'角色设定',content:'# 角色概述\n\n## 身份与背景\n\n## 目标与动机\n\n## 性格与矛盾\n\n## 人物关系\n\n## 故事中的变化\n'},
 location:{name:'地点设定',category:'地点设定',content:'# 地点概述\n\n## 环境与氛围\n\n## 历史与现状\n\n## 重要人物与势力\n\n## 探索线索\n\n## 与玩法的联系\n'},
 chapter:{name:'剧情章节',category:'主线剧情',content:'# 章节概述\n\n## 叙事目标\n\n## 开场\n\n## 关键事件\n\n## 冲突与选择\n\n## 结局与后续影响\n'},
 world:{name:'世界观',category:'世界观',content:'# 世界概述\n\n## 世界规则\n\n## 历史与关键事件\n\n## 当前矛盾\n\n## 玩家在世界中的位置\n'}
} as const;
export function makeStory(title='新的故事文档',category='世界观',template:keyof typeof storyTemplates='blank'):StoryDoc{return {id:crypto.randomUUID(),title:title.trim()||'新的故事文档',category:category.trim()||'未分类',status:'草稿',updated:'刚刚',updatedAt:new Date().toISOString(),summary:'',content:storyTemplates[template].content,format:'markdown',tags:[],outlines:[],relations:{characters:[],locations:[],systems:[]}};}
export function copyStory(s:StoryDoc):StoryDoc{return {...structuredClone(s),id:crypto.randomUUID(),title:s.title.slice(0,155)+' · 副本',archived:false,status:'草稿',updated:'刚刚',updatedAt:new Date().toISOString()};}
export function filterStories(docs:StoryDoc[],query:string,category:string|null,status:string,range:string,sort:string){const q=query.trim().toLocaleLowerCase();return docs.filter(d=>(category===null||d.category===category)&&(status==='all'||d.status===status)&&(range==='all'||(range==='archived')===!!d.archived)&&[d.title,d.summary,d.content,...d.tags].join(' ').toLocaleLowerCase().includes(q)).sort((a,b)=>sort==='title'?a.title.localeCompare(b.title,'zh-CN'):(Date.parse(b.updatedAt||b.updated)||0)-(Date.parse(a.updatedAt||a.updated)||0));}
export type StoryBlock={kind:'heading'|'paragraph'|'quote'|'list'|'code'|'rule';text:string;line:number;level?:number};
export function storyBlocks(text:string):StoryBlock[]{const lines=text.split('\n'),out:StoryBlock[]=[];let i=0;while(i<lines.length){const line=lines[i],start=i++;if(!line.trim())continue;if(/^```/.test(line)){const code=[];while(i<lines.length&&!/^```/.test(lines[i]))code.push(lines[i++]);if(i<lines.length)i++;out.push({kind:'code',text:code.join('\n'),line:start});continue;}const h=/^(#{1,6}) +(.+)$/.exec(line);if(h){out.push({kind:'heading',text:h[2],level:h[1].length,line:start});continue;}if(/^\s*(---+|\*\*\*+)\s*$/.test(line)){out.push({kind:'rule',text:'',line:start});continue;}if(/^> ?/.test(line)){out.push({kind:'quote',text:line.replace(/^> ?/,''),line:start});continue;}if(/^\s*([-*] |\d+\. )/.test(line)){out.push({kind:'list',text:line.replace(/^\s*([-*] |\d+\. )/,''),line:start});continue;}const p=[line];while(i<lines.length&&lines[i].trim()&&!/^(#{1,6} |>|```|[-*] |\d+\. |---)/.test(lines[i]))p.push(lines[i++]);out.push({kind:'paragraph',text:p.join('\n'),line:start});}return out;}
export function safeStoryLink(url:string){try{const u=new URL(url);return ['https:','http:','mailto:'].includes(u.protocol)?u.href:null;}catch{return null;}}
export type StoryFormat='heading'|'bold'|'italic'|'list'|'quote'|'rule'|'link';
export function formatStorySelection(text:string,start:number,end:number,kind:StoryFormat){const selected=text.slice(start,end);const value=selected||({heading:'章节标题',bold:'重点内容',italic:'强调内容',list:'列表内容',quote:'引用内容',rule:'',link:'链接文字'}[kind]);const replacement=kind==='bold'?'**'+value+'**':kind==='italic'?'*'+value+'*':kind==='link'?'['+value+'](https://example.com)':kind==='rule'?'\n\n---\n\n':(start&&text[start-1]!=='\n'?'\n':'')+value.split('\n').map(l=>({heading:'## ',list:'- ',quote:'> '} as Record<string,string>)[kind]+l).join('\n');return {replacement,content:text.slice(0,start)+replacement+text.slice(end)};}
