import fs from 'node:fs';
import { analysisExampleGroups, analysisExamples } from '../src/analysis-examples.ts';
import { runAnalysis, validateNumericalAnalysis } from '../src/numerical-analysis.ts';
import { emptyStoryOrchestration } from '../src/story-orchestration.ts';
for(const group of analysisExampleGroups) {
  const path=new URL('../examples/prototypes/'+group.id+'.json',import.meta.url),example=JSON.parse(fs.readFileSync(path,'utf8'));
  const sources={data:example.data,narrative:example.storyOrchestration??emptyStoryOrchestration()};
  const plans=analysisExamples(group.id,sources).map((p,i)=>({...p,id:'analysis-'+group.id+'-'+(i+1)}));
  for(const p of plans) {
    for(const id of ['',...p.variants.map(v=>v.id)]) {
      const result=runAnalysis(p,sources,id);if(result.errors.length||result.rows.some(r=>r.errors.length))throw new Error(p.name+': '+JSON.stringify(result.errors.concat(result.rows.flatMap(r=>r.errors))));
    }
  }
  example.numericalAnalysis=validateNumericalAnalysis({schema:1,plans});
  fs.writeFileSync(path,JSON.stringify(example,null,2)+'\n');
  console.log(group.id+': '+plans.length+' analysis plans');
}
