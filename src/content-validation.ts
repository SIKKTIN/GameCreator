/** Field diagnostics shared by editor validators and the exported Node bundle. */
export type ContentIssue = {code:string;path:string;message:string;expected?:string;actual?:string};
export const pointer = (value:string) => value.replace(/~/g,'~0').replace(/\//g,'~1');
export const record = (value:unknown):value is Record<string,unknown> => !!value && typeof value==='object' && !Array.isArray(value);
export class ContentValidationError extends Error {
  code='CONTENT_INVALID';
  issues:ContentIssue[];
  constructor(message:string,issues:ContentIssue[]){super(message+'\n'+issues.slice(0,8).map(i=>i.path+': '+i.message).join('\n'));this.issues=issues;}
}
export class ContentChecks {
  issues:ContentIssue[]=[];
  add(path:string,expected:string,value:unknown,code='FIELD_TYPE') {
    if(this.issues.length>=100)return;
    const actual=value===undefined?'missing':value===null?'null':Array.isArray(value)?'array':typeof value;
    this.issues.push({code,path,expected,actual,message:'期望 '+expected+'，实际为 '+actual});
  }
  object(value:unknown,path:string,expected='object'):value is Record<string,unknown>{if(record(value))return true;this.add(path,expected,value);return false;}
  strings(value:Record<string,unknown>,keys:string[],path:string){for(const key of keys)if(typeof value[key]!=='string')this.add(path+'/'+pointer(key),'string',value[key]);}
  boolean(value:unknown,path:string){if(typeof value!=='boolean')this.add(path,'boolean',value);}
  enum(value:unknown,values:readonly unknown[],path:string){if(!values.includes(value))this.add(path,values.join(' | '),value,'FIELD_ENUM');}
  number(value:unknown,path:string,min:number,max=Infinity,integer=false){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max||integer&&!Number.isInteger(value))this.add(path,(integer?'integer':'number')+' ['+min+', '+max+']',value,'FIELD_RANGE');}
  list(value:unknown,path:string,check:(v:Record<string,unknown>,p:string)=>void,max=Infinity,expected='object with unique nonempty id'){
    if(!Array.isArray(value)){this.add(path,'array',value);return;}
    if(value.length>max)this.add(path,'array length ≤ '+max,value,'LIST_LIMIT');
    const ids=new Set();
    for(const [index,item] of value.entries()){
      const p=path+'/'+(record(item)&&typeof item.id==='string'&&item.id?'@'+pointer(item.id):index);
      if(!this.object(item,p,expected))continue;
      if(typeof item.id!=='string'||!item.id)this.add(p+'/id','nonempty string',item.id);
      else if(ids.has(item.id))this.add(p+'/id','unique id',item.id,'DUPLICATE_ID');
      ids.add(item.id);check(item,p);
      if(this.issues.length>=100)break;
    }
  }
  capture(action:()=>unknown,prefix=''){
    try{action();}catch(e){
      if(e instanceof ContentValidationError)this.issues.push(...e.issues.map(i=>({...i,path:prefix+i.path})).slice(0,100-this.issues.length));
      else if(this.issues.length<100)this.issues.push({code:'CONTENT_FORMAT',path:prefix,message:e instanceof Error?e.message:String(e)});
    }
  }
  finish(message:string){if(this.issues.length)throw new ContentValidationError(message,this.issues);}
}
