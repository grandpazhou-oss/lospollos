#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const Map=require('../platform-supply-map-v8.js');
const node=(nodeId,role,coordinate)=>({nodeId,name:'Name '+nodeId,role,coordinateSystem:'WGS84',coordinate});
const study={studyId:'GENERIC',inputHash:'HASH',periods:['2027-10','2027-11'],unit:'t',nodes:[node('S','SUPPLIER',[110,30]),node('A','DC',[111,30]),node('B','DC',[112,30]),node('C','CUSTOMER',[113,30]),node('D','CUSTOMER',null)]};
const leg=(fromNodeId,toNodeId,quantity,period='2027-10')=>({fromNodeId,toNodeId,quantity,period,unit:'t'});
const snap={schemaVersion:'stct-supply-chain-v5-snapshot-v1',studyHash:'HASH',snapshotHash:'SNAP',analysisScope:'FULL_CHAIN',planningReference:{inbound:[leg('S','A',4)],outbound:[leg('A','C',2),leg('A','D',2),leg('A','C',1,'2027-11')]},rows:[{scenarioId:'X',selectedSites:[{nodeId:'B'}],inbound:[leg('S','B',4)],outbound:[leg('B','C',2),leg('A','D',1),leg('A','C',1,'2027-11')]},{scenarioId:'Y',selectedSites:[{nodeId:'A'}],inbound:[leg('S','A',4)],outbound:[leg('A','C',2),leg('A','D',2),leg('A','C',1,'2027-11')]}],decision:{focusScenarioId:'X'}};
const frozen=JSON.stringify({study,snap});
const all=Map.projectComparison(study,snap);
assert.deepEqual(all.changes,{NEW:2,REMOVED:1,VOLUME_CHANGED:2,UNCHANGED:0});
assert.equal(all.relations.find(r=>r.toNodeId==='D').mapped,false);
assert.equal(all.relations.find(r=>r.toNodeId==='D').before,2);
assert.equal(all.relations.find(r=>r.toNodeId==='D').after,1);
assert.equal(Map.projectComparison(study,snap,{period:'2027-11'}).changes.UNCHANGED,1);
assert.equal(Map.projectComparison(study,snap,{scenarioId:'Y',change:'CHANGED'}).relations.length,0);
for(const mode of ['BOTH','REFERENCE','CANDIDATE']){
 const model=Map.projectComparison(study,snap,{mode,nodeId:'S'});
 assert.equal(model.relations.length,2);
 assert.ok(model.features.filter(f=>f.geometry.type==='LineString').every(f=>f.properties.fromNodeId==='S'&&(mode==='BOTH'||f.properties.comparison===mode.toLowerCase())));
}
assert.equal(Map.projectComparison(study,snap,{change:'NEW'}).relations.length,2);
const out=Map.projectComparison(study,{...snap,analysisScope:'OUTBOUND_ONLY',baseline:snap.planningReference});
assert.ok(out.relations.every(r=>r.kind==='outbound'));
const up=Map.projectComparison(study,{...snap,analysisScope:'UPSTREAM_ONLY',baseline:snap.planningReference});
assert.ok(up.relations.every(r=>r.kind==='inbound'));
for(const old of [null,{...snap,studyHash:'STALE'},{...snap,rows:[],decision:{focusScenarioId:null}}]){
 assert.equal(Map.projectComparison(study,old).relations.length,0);
 assert.equal(Map.projectComparison(study,old).features.filter(f=>f.geometry.type==='LineString').length,0);
}
assert.equal(Map.project(study,null,'zh','late-id').features.filter(f=>f.geometry.type==='LineString').length,0);
assert.equal(JSON.stringify({study,snap}),frozen);
for(const locale of ['zh','en','ja'])assert.ok(Map.projectComparison(study,snap,{},locale).legend.length>20);
console.log(JSON.stringify({status:'PASS',checks:19,scope:'Pure display projection; original quantities, snapshot and hashes unchanged'}));
