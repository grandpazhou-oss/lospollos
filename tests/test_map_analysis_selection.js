#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict');
const Map=require('../platform-supply-map-v8.js');
const node=(nodeId,role,coordinate,coordinateSystem='WGS84')=>({nodeId,name:nodeId,role,coordinateSystem,coordinate});
const leg=(fromNodeId,toNodeId,quantity,distanceKm,cost,period='2027-10')=>({fromNodeId,toNodeId,quantity,distanceKm,cost,period});
const study={studyId:'SYNTHETIC-AREA',inputHash:'INPUT',periods:['2027-10','2027-11'],unit:'t',nodes:[
  node('S','SUPPLIER',[110,30]),node('A','DC',[111,30]),node('B','DC',[112,30]),
  node('C','CUSTOMER',[113,30]),node('D','CUSTOMER',null),node('U','CUSTOMER',[114,30],'UNKNOWN')
]};
const snapshot={schemaVersion:'stct-supply-chain-v5-snapshot-v1',studyHash:'INPUT',snapshotHash:'SNAP',analysisScope:'FULL_CHAIN',
  planningReference:{inbound:[leg('S','A',30,100,300)],outbound:[leg('A','C',10,20,20),leg('A','C',5,40,10,'2027-11'),leg('A','D',5,null,null)],transfer:[leg('A','B',3,5,0)]},
  rows:[{scenarioId:'PLAN',selectedSiteIds:['B'],inbound:[leg('S','B',30,90,270)],outbound:[leg('B','C',10,15,10),leg('B','C',5,30,5,'2027-11'),leg('B','D',5,null,null)],transfer:[leg('B','A',3,4,0)]}],
  decision:{focusScenarioId:'PLAN'}};
const unchanged=JSON.stringify({study,snapshot});
const model=Map.projectComparison(study,snapshot), modelBefore=JSON.stringify(model);
assert.deepEqual(Map.selectArea(model,[110,29,113,31]),['S','A','B','C']);
assert.deepEqual(Map.selectArea(model,[110,29,115,31]),['S','A','B','C']);
assert.deepEqual(Map.selectArea(model,[111,30,111,30]),['A']);
for(const invalid of [null,[110,29,113],[110,31,113,29],[NaN,29,113,31],[-181,29,113,31]])assert.deepEqual(Map.selectArea(model,invalid),[]);
assert.deepEqual(Map.selectArea({entities:[{id:'east',coordinate:[179,0]},{id:'west',coordinate:[-179,0]},{id:'middle',coordinate:[0,0]}]},[170,-5,-170,5]),['east','west']);
const empty=Map.analyzeSelection(model,[]);
assert.deepEqual(empty,{nodeIds:[],relationIds:[],relations:[],groups:[],missingCoordinates:0});
const any=Map.analyzeSelection(model,['B','A','A','absent']);
assert.deepEqual(any.nodeIds,['A','B']);
assert.equal(any.relationIds.length,8);
assert.deepEqual(any.groups.map(group=>group.kind),['inbound','outbound','transfer']);
const inbound=any.groups[0], outbound=any.groups[1], transfer=any.groups[2];
assert.equal(inbound.before.quantity,30);
assert.equal(inbound.after.quantity,30);
assert.equal(inbound.before.weightedKm,100);
assert.equal(inbound.after.weightedKm,90);
assert.equal(inbound.before.cost,300);
assert.equal(inbound.after.cost,270);
assert.equal(outbound.before.quantity,20);
assert.equal(outbound.before.recordCount,3);
assert.equal(outbound.before.knownQuantity,15);
assert.equal(outbound.before.knownVolumeKm,400);
assert.equal(outbound.before.weightedKm,400/15);
assert.equal(outbound.after.weightedKm,20);
assert.equal(outbound.before.distanceCoverage,.75);
assert.equal(outbound.after.distanceCoverage,.75);
assert.equal(outbound.before.volumeKm,null);
assert.equal(outbound.after.cost,null);
assert.equal(transfer.before.cost,0);
assert.equal(transfer.after.cost,0);
assert.equal(transfer.before.volumeKm,15);
assert.equal(transfer.after.volumeKm,12);
assert.deepEqual(Map.analyzeSelection(model,['S'],'INCOMING').relationIds,[]);
assert.equal(Map.analyzeSelection(model,['S'],'OUTGOING').relationIds.length,2);
assert.equal(Map.analyzeSelection(model,['C'],'INCOMING').relationIds.length,2);
assert.equal(Map.analyzeSelection(model,['C'],'OUTGOING').relationIds.length,0);
assert.ok(Map.analyzeSelection(model,['A'],'OUTGOING').relations.every(row=>row.fromNodeId==='A'));
const between=Map.analyzeSelection(model,['A','B'],'BETWEEN');
assert.equal(between.relationIds.length,2);
assert.equal(between.groups.length,1);
assert.equal(between.groups[0].kind,'transfer');
assert.equal(Map.analyzeSelection(model,['D','D','U']).missingCoordinates,2);
assert.equal(Map.analyzeSelection(model,['D']).groups[0].before.quantity,5);
assert.equal(Map.analyzeSelection(model,['D']).groups[0].before.weightedKm,null);
assert.equal(Map.analyzeSelection(model,['D']).groups[0].before.distanceCoverage,0);
const period=Map.analyzeSelection(Map.projectComparison(study,snapshot,{period:'2027-11',leg:'OUTBOUND'}),['C']);
assert.equal(period.groups.length,1);
assert.equal(period.groups[0].before.quantity,5);
assert.equal(period.groups[0].before.weightedKm,40);
assert.equal(period.groups[0].after.weightedKm,30);
assert.equal(period.groups[0].after.volumeKm,150);
assert.equal(period.groups[0].after.cost,5);
const changed=Map.analyzeSelection(Map.projectComparison(study,snapshot,{change:'NEW'}),['A','B']);
assert.ok(changed.relations.every(row=>row.change==='NEW'));
assert.ok(changed.groups.every(group=>group.before.quantity===0&&group.before.cost===null));
const scoped=Map.projectComparison(study,snapshot,{nodeId:'C'});
assert.ok(Map.analyzeSelection(scoped,['A','B']).relations.every(row=>row.toNodeId==='C'));
assert.equal(Map.analyzeSelection(Map.projectComparison(study,{...snapshot,studyHash:'STALE'}),['A']).groups.length,0);
assert.deepEqual(Map.analyzeSelection({...model,features:[],relations:[...model.relations,...model.relations]},['A','B']),any);
assert.equal(JSON.stringify(model),modelBefore);
assert.equal(JSON.stringify({study,snapshot}),unchanged);
assert.notEqual(model.entities.find(entity=>entity.id==='A').coordinate,study.nodes.find(entity=>entity.nodeId==='A').coordinate);

// More than the runtime's 200-point density threshold. Hidden/sampled features do not change totals.
const customers=Array.from({length:305},(_,index)=>node('CUSTOMER-'+index,'CUSTOMER',[110+index/1000,31]));
const largeStudy={...study,nodes:[node('WAREHOUSE','DC',[109,31]),...customers]};
const largeRows=customers.map(customer=>leg('WAREHOUSE',customer.nodeId,2,10,3));
const largeSnapshot={...snapshot,analysisScope:'OUTBOUND_ONLY',baseline:{outbound:largeRows},rows:[{scenarioId:'PLAN',outbound:largeRows}]};
const largeModel=Map.projectComparison(largeStudy,largeSnapshot);
largeModel.features=[];
const selected=Map.selectArea(largeModel,[110,30,111,32]);
assert.equal(selected.length,305);
const analysis=Map.analyzeSelection(largeModel,selected,'INCOMING');
assert.equal(analysis.nodeIds.length,305);
assert.equal(analysis.relationIds.length,305);
assert.equal(analysis.groups[0].after.quantity,610);
assert.equal(analysis.groups[0].after.recordCount,305);
assert.equal(analysis.groups[0].after.volumeKm,6100);
assert.equal(analysis.groups[0].after.cost,915);
assert.equal(analysis.groups[0].after.distanceCoverage,1);
console.log(JSON.stringify({status:'PASS',scope:'Synthetic pure projection: complete area selection, directed multiselect, per-leg ledger metrics, missing data, current filters and immutability; 305-object no-render check'}));
