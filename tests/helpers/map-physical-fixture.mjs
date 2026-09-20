import {createDesignMap} from '../../src/map-design.ts';
import {defaultTravel} from '../../src/map-world.ts';
export function physicalFixture(type='side'){
 const a=createDesignMap('上层 A'),c=createDesignMap('下层 C');for(const m of [a,c]){m.rows=10;m.columns=12;m.perspective=type;}
 a.placement={x:0,y:0,scale:1};c.placement={x:0,y:14,scale:1};
 const object=(m,id,kind,x,y,width,height)=>({id,name:id,kind,layerId:m.layers[0].id,x,y,width,height,color:'blue',notes:'',references:[]});
 a.objects=[object(a,'a-start','portal',2.5,7,1,1),object(a,'a-floor-left','terrain',0,8,4,2),object(a,'a-floor-right','terrain',6,8,6,2),object(a,'a-ladder','note',4,7,2,3)];
 c.objects=[object(c,'c-land','portal',2.5,7,1,1),object(c,'c-floor','terrain',0,8,12,2),object(c,'c-ladder','note',4,0,2,8)];
 a.surfaces=[{objectId:'a-ladder',kind:'ladder'}];c.surfaces=[{objectId:'c-ladder',kind:'ladder'}];
 a.openings=[{id:'a-hole',name:'A井口',side:'bottom',offset:5,width:2}];c.openings=[{id:'c-hole',name:'C井口',side:'top',offset:5,width:2}];
 const link={id:'shaft',name:'上下竖井',from:a.id,to:c.id,fromObjectId:'a-start',toObjectId:'c-land',fromOpeningId:'a-hole',toOpeningId:'c-hole',fromSide:'bottom',toSide:'top',direction:'both',kind:'passage',condition:'下行许可',reverseCondition:'梯子已展开',structure:'ladder',travel:{...defaultTravel(),forward:'climb',reverse:'climb',maxRise:30,maxDrop:30,maxGap:6}};
 return {schema:1,enabled:true,world:{perspective:type,unit:'米',snap:1},maps:[a,c],connections:[link]};
}
