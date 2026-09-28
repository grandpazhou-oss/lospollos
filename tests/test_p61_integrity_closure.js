'use strict';
const assert=require('node:assert/strict');
const Contract=require('../network-contract-v18.js');
const Data=require('../design-data-adapter-v19.js');
const Context=require('../design-strategic-context-v19.js');
const Store=require('../design-study-store-v19.js');
const Envelope=require('../operational-validation-contract-v19.js');
const Result=require('../operational-validation-result-v19.js');

function source(orderCount=40,transform=()=>{}){
  const data=Data.createSyntheticStudy({orderCount,depotCount:2,vehicleCount:8});
  transform(data.scenario);
  const sourceRef='SYNTHETIC-P61:1';
  const store=Store.createStore({context:Context.createContext({dataSource:Data.adoptNetworkScenario(data.scenario,{sourceType:'LOCAL_SYNTHETIC_FIXTURE',sourceRef})})});
  const view=store.snapshot();
  return{studySnapshot:view,studyPointer:{id:'DESIGN:P61',scope:'DESIGN',studyId:view.studyId,scenarioId:view.activeScenarioId,inputHash:view.activeInputHash,refs:[{store:'studyVersions',id:'STUDY-P61:1'},{store:'datasetVersions',id:sourceRef}]},datasetRecord:{id:sourceRef,payload:{normalizedScenario:view.activeRecord.scenario}}};
}
const seal=(input,options={})=>Envelope.createEnvelope(input,{operationalDate:'2026-09-06',confirmDateAssumption:true,...options});
const reseal=(value,key)=>{value[key]=Contract.hashArtifact(Envelope.hashProjection(value,key));};
const expectAdmissionReject=candidate=>assert.throws(()=>Result.admit(candidate.envelope,candidate.result),{code:'OPERATIONAL_RESULT_ADMISSION_FAILED'});

const base=seal(source(12)),control=Result.execute(base,{sessionId:'P61'});

{
  const result=structuredClone(control);result.comparabilityReport.deltas.totalCost=-999999;result.statusDimensions.solverStatus='OPTIMAL';result.statusDimensions.capabilityCoverage.simulation='VERIFIED';result.engineId='INVENTED_ENGINE';result.resultHash=Contract.hashArtifact(Result.projection(result));
  expectAdmissionReject({envelope:base,result});
}
{
  const envelope=structuredClone(base);envelope.routingSnapshot.rows.forEach(row=>{row.distanceMeters*=100;row.travelSeconds*=100;});reseal(envelope.routingSnapshot,'matrixHash');envelope.facilityDemandMatrixHash=envelope.routingSnapshot.matrixHash;reseal(envelope,'envelopeHash');
  assert.ok(Envelope.validateEnvelope(envelope).issues.includes('OPERATIONAL_MATRIX_SEMANTIC_MISMATCH'));
}
{
  const envelope=structuredClone(base);envelope.resourceSnapshot.vehicles=[];envelope.resourceSnapshot.drivers=[];reseal(envelope,'envelopeHash');
  assert.ok(Envelope.validateEnvelope(envelope).issues.some(code=>code.startsWith('OPERATIONAL_RESOURCE_')));
}
{
  const envelope=structuredClone(base);envelope.sourceDesignMetrics.accountingTotal=999999;reseal(envelope,'envelopeHash');
  assert.ok(Envelope.validateEnvelope(envelope).issues.includes('OPERATIONAL_SOURCE_SEMANTIC_MISMATCH'));
}
{
  const input=source(40),envelope=seal(input,{resourceOverrides:{vehicleLimit:1,dockCapacityMultiplier:1}}),result=structuredClone(Result.execute(envelope,{sessionId:'PARTIAL'}));
  assert.equal(result.statusDimensions.serviceStatus,'PARTIAL');result.statusDimensions.serviceStatus='FULL';result.resultHash=Contract.hashArtifact(Result.projection(result));assert.throws(()=>Result.admit(envelope,result),{code:'OPERATIONAL_RESULT_ADMISSION_FAILED'});
}
{
  const input=source(40,scenario=>scenario.orders.forEach((order,index)=>{order.priorityWeight=index<10?100:1;})),envelope=seal(input,{resourceOverrides:{vehicleLimit:1,dockCapacityMultiplier:1}}),result=Result.execute(envelope,{sessionId:'PRIORITY'});
  const served=new Set(result.planEvidence.trip.trips.flatMap(trip=>trip.orderIds||[])),total=envelope.operationalScenario.orders.reduce((sum,row)=>sum+row.priorityWeight,0),servedWeight=envelope.operationalScenario.orders.filter(row=>served.has(row.orderId)).reduce((sum,row)=>sum+row.priorityWeight,0);
  assert.equal(result.metrics.priorityWeightedService,servedWeight/total);assert.notEqual(result.metrics.priorityWeightedService,result.metrics.serviceRate);
}
{
  const invalid=source(12,scenario=>{scenario.orders[0].serviceDay='2026-99-99';});const check=Envelope.preflight(invalid,{operationalDate:'2026-09-06',confirmDateAssumption:true});assert.ok(check.issues.some(row=>row.code==='OPERATIONAL_SOURCE_DATE_INVALID'));
}

console.log(JSON.stringify({suite:'P6.1_INTEGRITY_CLOSURE',status:'PASS',checks:7},null,2));
