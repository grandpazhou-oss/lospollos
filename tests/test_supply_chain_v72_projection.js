'use strict';
const assert=require('node:assert/strict');
const Design=require('../supply-chain-design-v19.js');
const Report=require('../supply-chain-report-v19.js');
const Explanation=require('../supply-chain-explanation-v19.js');
const edge=(a,b,d)=>({fromNodeId:a,toNodeId:b,distanceKm:d,unit:'km',quality:'VERIFIED_ROAD',source:'SYNTHETIC'});
const raw={studyId:'V72-SYNTHETIC',name:'V72 projection',classification:'SYNTHETIC',nodes:[{nodeId:'F',role:'FACTORY'},...['A','B','C','D'].map(id=>({nodeId:id,name:`Site ${id}`,role:'DC',capacityByPeriod:{P:100}})),{nodeId:'Z',role:'CUSTOMER'}],periodDemand:[{demandId:'D',customerNodeId:'Z',currentSiteId:'A',period:'P',quantity:10,unit:'m3'}],observedInbound:[{flowId:'I',fromNodeId:'F',toNodeId:'A',period:'P',quantity:10,unit:'m3'}],distanceRows:[edge('F','A',1),...['A','B','C','D'].map((id,i)=>edge(id,'Z',[40,20,30,10][i]))],costApplicability:{inventoryHolding:'NOT_APPLICABLE',transferTransport:'NOT_APPLICABLE'}};
const cfg={type:'NETWORK_CANDIDATE',objective:'VOLUME_KM',objectiveScope:'OUTBOUND_ONLY',facilityCounts:[1],distanceBasis:'VERIFIED_ROAD'};
const study=Design.createStudy(raw),base=Design.evaluatePortfolio(study,{type:'OBSERVED_BASELINE',distanceBasis:'VERIFIED_ROAD'});
const candidates=['A','B','C','D'].map(id=>Design.evaluatePortfolio(study,{...cfg,scenarioId:id,selectedSiteIds:[id]},[{demandId:'D',siteNodeId:id}]));
const expected=['D','B','C','A'];
const permutations=[candidates,[...candidates].reverse(),[candidates[2],candidates[0],candidates[3],candidates[1]],[candidates[1],candidates[3],candidates[0],candidates[2]]];
for(const rows of permutations){
 const snapshot=Report.createSnapshot(study,base,rows,[],cfg),before=Design.hash(snapshot),projection=Explanation.comparisonProjection(snapshot);
 assert.deepEqual(projection.entries.map(item=>item.row.scenarioId),expected);
 assert.deepEqual(snapshot.decision.rankedScenarioIds,expected);
 assert.equal(Explanation.businessBrief(snapshot).candidateId,'D');
 for(const locale of ['zh','en','ja']){
  const html=Report.toHtml(study,snapshot,locale),ids=[...html.matchAll(/<tr data-scenario-id="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(ids,expected);
  assert.match(html,/OUTBOUND_VOLUME_KM/);
 }
 const md=Report.toMarkdown(study,snapshot),csv=Report.toComparisonCsv(study,snapshot);
 let pos=-1;for(const id of expected){const next=md.indexOf(` · ${id} |`,pos+1);assert.ok(next>pos);pos=next;}
 assert.deepEqual(csv.trim().split('\n').slice(1).map(line=>line.split(',')[2].replaceAll('"','')),expected);
 assert.equal(Design.hash(snapshot),before,'projection must not mutate snapshot');
}
const clone=value=>structuredClone(value),valid=Report.createSnapshot(study,base,candidates,[],cfg);
for(const metric of ['INBOUND_VOLUME_KM','TWO_END_VOLUME_KM','COMPARABLE_OPERATING_COST']){
 const mock={rows:[{scenarioId:'X',metrics:{inbound:{volumeKm:10},outbound:{volumeKm:100},totalVolumeKm:110,operatingCost:300},status:'OPTIMAL'},{scenarioId:'Y',metrics:{inbound:{volumeKm:5},outbound:{volumeKm:200},totalVolumeKm:205,operatingCost:200},status:'OPTIMAL'}],decision:{rankedScenarioIds:metric==='TWO_END_VOLUME_KM'?['X','Y']:['Y','X'],rankingMetric:metric,reference:'SAME_CONDITION_PLANNING_REFERENCE',focusScenarioId:'Y'}};
 const p=Explanation.comparisonProjection(mock);assert.equal(p.rankingMetric,metric);assert.deepEqual(p.entries.map(x=>x.row.scenarioId),mock.decision.rankedScenarioIds);
 assert.ok(p.entries.every(x=>x.metricValue!=null));
}
const mixed={rows:[{scenarioId:'A',result:{status:'OPTIMAL',capacityByPeriod:[],metrics:{outbound:{numeratorVolumeKm:1}}}},{scenarioId:'B',result:{status:'INFEASIBLE',capacityByPeriod:[],metrics:{}}},{scenarioId:'C',result:{status:'FAILED',capacityByPeriod:[],metrics:{}}}],decision:{rankedScenarioIds:['A'],rankingMetric:'OUTBOUND_VOLUME_KM',reference:'OBSERVED_BASELINE'}};
const mixedProjection=Explanation.comparisonProjection(mixed);
assert.deepEqual(mixedProjection.entries.map(x=>[x.row.scenarioId,x.group,x.reason]),[['A','RANKED',null],['B','OTHER','INFEASIBLE'],['C','OTHER','NOT_COMPLETE']]);
const missingCost=Explanation.comparisonProjection({...mixed,rows:[{...mixed.rows[0],result:{...mixed.rows[0].result,metrics:{operatingCost:10}}},{scenarioId:'C',metrics:{operatingCost:null},status:'OPTIMAL'}],decision:{rankedScenarioIds:['A'],rankingMetric:'COMPARABLE_OPERATING_COST',reference:'OBSERVED_BASELINE',focusScenarioId:'A'}});
assert.equal(missingCost.entries[1].reason,'COST_INCOMPLETE');
assert.equal(new Set(mixedProjection.entries.map(item=>item.row.scenarioId)).size,mixed.rows.length);
const tied=Explanation.comparisonProjection({...mixed,rows:mixed.rows.map(row=>row.scenarioId==='C'?{...row,result:{...row.result,status:'OPTIMAL',metrics:{outbound:{numeratorVolumeKm:1}}}}:row),decision:{...mixed.decision,rankedScenarioIds:['A','C'],tiedScenarioIds:['A','C'],focusScenarioId:'A'}});
assert.deepEqual(tied.entries.slice(0,2).map(item=>item.rank),[1,1]);
assert.match(Explanation.comparisonLabel(tied,tied.entries[1],'en'),/Tied rank/);
const old=clone(mixed);delete old.decision;assert.equal(Explanation.comparisonProjection(old).rankingAvailable,false);assert.match(Explanation.rankingNote(Explanation.comparisonProjection(old),'zh'),/未提供排名/);
const oldReport=clone(valid);delete oldReport.decision;delete oldReport.snapshotHash;oldReport.snapshotHash=Design.hash(oldReport);
assert.match(Report.toHtml(study,oldReport,'zh'),/未提供排名/);
assert.match(Report.toMarkdown(study,oldReport),/未提供排名/);
for(const ids of [['A','A'],['A','MISSING']])assert.throws(()=>Explanation.comparisonProjection({...mixed,decision:{...mixed.decision,rankedScenarioIds:ids}}),/SUPPLY_RANKING_ID_CONFLICT/);
assert.throws(()=>Explanation.comparisonProjection({...mixed,rows:[mixed.rows[0],mixed.rows[0]]}),/SUPPLY_RANKING_ID_CONFLICT/);
assert.equal(Explanation.selection(valid).focusScenarioId,'D');
console.log(JSON.stringify({status:'PASS',method:'SYNTHETIC_PROJECTION_AND_VALID_REPORT_EXPORT',permutations:4,scopes:['OUTBOUND_ONLY','UPSTREAM_ONLY','FULL_CHAIN','COST'],guards:['unranked','infeasible','unknown','duplicate','missing'],snapshotUnchanged:true}));
