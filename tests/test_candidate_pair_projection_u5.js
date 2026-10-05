'use strict';
const assert=require('node:assert/strict'),Map=require('../platform-supply-map-v8.js');
const node=(nodeId,role,coordinate)=>({nodeId,role,name:nodeId,coordinate,coordinateSystem:'WGS84'});
const leg=(fromNodeId,toNodeId,quantity,distanceKm,period='P1')=>({fromNodeId,toNodeId,quantity,distanceKm,period,distanceQuality:'GEOGRAPHIC_SCREENING',distanceSource:'SYNTHETIC'});
const study={studyId:'SYNTHETIC-PAIR',inputHash:'INPUT',periods:['P1','P2'],unit:'m3',nodes:[node('F','SUPPLIER',[110,30]),node('W','DC',[111,30]),node('X','DC',[112,30]),node('C','CUSTOMER',[113,30])]};
for(const scope of ['OUTBOUND_ONLY','UPSTREAM_ONLY','FULL_CHAIN']){
 const result=(site,inc,out)=>({selectedSiteIds:[site],inbound:[leg('F',site,10,inc),leg('F',site,5,inc,'P2')],outbound:[leg(site,'C',10,out),leg(site,'C',5,out,'P2')]});
 const snapshot={studyHash:'INPUT',snapshotHash:'RESULT',schemaVersion:'stct-supply-chain-v5-snapshot-v1',analysisScope:scope,baseline:result('W',50,200),planningReference:result('W',50,200),rows:[{scenarioId:'A',result:result('W',20,30)},{scenarioId:'B',result:result('X',25,10)},{scenarioId:'FAILED',status:'INFEASIBLE'}],decision:{focusScenarioId:'B',rankedScenarioIds:['B','A']}};
 const original=JSON.stringify({study,snapshot});
 const pair=Map.projectComparison(study,snapshot,{scenarioId:'B',referenceScenarioId:'A'}),totals=Map.analyticalProjection(pair);
 assert.equal(pair.provenance.referenceScenarioId,'A');assert.equal(pair.relationContext.reference,'CANDIDATE_COMPARISON');
 if(scope!=='UPSTREAM_ONLY'){const g=totals.groups.find(g=>g.kind==='outbound');assert.equal(g.before.weightedKm,30);assert.equal(g.after.weightedKm,10);assert.equal(g.before.quantity,15);}
 if(scope!=='OUTBOUND_ONLY'){const g=totals.groups.find(g=>g.kind==='inbound');assert.equal(g.before.weightedKm,20);assert.equal(g.after.weightedKm,25);}
 assert.throws(()=>Map.projectComparison(study,snapshot,{scenarioId:'B',referenceScenarioId:'UNKNOWN'}),/MAP_REFERENCE_CANDIDATE_UNKNOWN/);
 assert.throws(()=>Map.projectComparison(study,snapshot,{scenarioId:'B',referenceScenarioId:'FAILED'}),/MAP_CANDIDATE_COMPARISON_NOT_RANKED/);
 const month=Map.analyticalProjection(Map.projectComparison(study,snapshot,{scenarioId:'B',referenceScenarioId:'A',period:'P2'}));assert.ok(month.groups.every(g=>g.before.quantity===5&&g.after.quantity===5));
 assert.equal(JSON.stringify({study,snapshot}),original);
}
assert.throws(()=>Map.regionPolygons({type:'Polygon',coordinates:[[[0,0],[1,1],[0,1],[1,0],[0,0]]]}),/SELF_INTERSECTION/);
assert.throws(()=>Map.regionPolygons({type:'Polygon',coordinates:[[[170,0],[-170,0],[-170,1],[170,1],[170,0]]]}),/DATELINE_UNSUPPORTED/);
const edge=Map.fixedGrid({entities:[{id:'C',coordinate:[180,90]}]},[{kind:'outbound',toNodeId:'C',relationId:'E',before:1,after:1}]);assert.deepEqual(edge.cells[0].bounds,[179,89,180,90]);
console.log(JSON.stringify({status:'PASS',tier:'SYNTHETIC_PURE_PROJECTION',scopes:3,comparison:'Same snapshot ranked A/B only',sourceUnchanged:true}));
