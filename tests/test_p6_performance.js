'use strict';
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const Contract=require('../network-contract-v18.js');
const Data=require('../design-data-adapter-v19.js');
const Context=require('../design-strategic-context-v19.js');
const Store=require('../design-study-store-v19.js');
const Import=require('../platform-import-session-v19.js');
const Envelope=require('../operational-validation-contract-v19.js');
const Result=require('../operational-validation-result-v19.js');

const settings={scope:'DESIGN',coordinateSystem:'WGS84',weightUnit:'kg',volumeUnit:'m3',observationPeriod:'2026-09-06',costPeriod:'MODEL_RUN',currency:'CNY',classification:'SYNTHETIC'};
const round=value=>Math.round(value*10)/10;
function compact(report){return{schemaVersion:'stct-dataset-validation-summary-p5.1',status:report.status,totalRecords:report.totalRecords,acceptedRecords:report.acceptedRecords,rejectedRecords:report.rejectedRecords,issueCounts:report.issueCounts||{},canonicalDataHash:report.canonicalDataHash,mappingHash:report.mappingHash,unitContextHash:report.unitContextHash,networkInputHash:report.networkInputHash,performance:report.performance||null};}
function payload(report,validationReport){return{schemaVersion:'stct-dataset-version-p5.1',source:report.source,canonicalDataHash:report.canonicalDataHash,mappingHash:report.mappingHash,unitContextHash:report.unitContextHash,totalRecords:report.totalRecords,acceptedRecords:report.acceptedRecords,rejectedRecords:report.rejectedRecords,records:report.records,normalizedScenario:report.normalizedScenario,conversionLedger:report.conversionLedger,settings:report.settings,validationReport};}
function bridgeSource(scenario){const sourceRef='PERF-DATASET:1',store=Store.createStore({context:Context.createContext({dataSource:Data.adoptNetworkScenario(scenario,{sourceType:'SYNTHETIC_PERFORMANCE_FIXTURE',sourceRef})})}),view=store.snapshot();return{studySnapshot:view,studyPointer:{id:'PERF-STUDY',scope:'DESIGN',studyId:view.studyId,scenarioId:view.activeScenarioId,inputHash:view.activeInputHash,refs:[{store:'studyVersions',id:'PERF-STUDY:1'},{store:'datasetVersions',id:sourceRef}]},datasetRecord:{id:sourceRef,payload:{normalizedScenario:scenario}}};}

(async()=>{
  const rows=[];
  for(const orders of [12,120,500]){
    const scenario=Data.createSyntheticStudy({orderCount:orders,depotCount:orders===12?2:5,vehicleCount:orders===12?8:Math.ceil(orders/10),docksPerDepot:2,seed:1906+orders}).scenario;
    const file=new File([JSON.stringify({schemaVersion:'stct-network-upload-p5',scenario})],`network-${orders}.json`,{type:'application/json'});
    const parseStart=performance.now(),session=await Import.readFiles([file]),report=Import.validate(session,settings),parseValidateMs=performance.now()-parseStart;
    assert.equal(report.status,'READY');
    const oldPayload=payload(report,report),newPayload=payload(report,compact(report));
    const oldJson=JSON.stringify(oldPayload),newJson=JSON.stringify(newPayload);
    const oldCloneStart=performance.now();for(let i=0;i<3;i++)structuredClone(oldPayload);const oldCloneMs=(performance.now()-oldCloneStart)/3;
    const newCloneStart=performance.now();for(let i=0;i<3;i++)structuredClone(newPayload);const newCloneMs=(performance.now()-newCloneStart)/3;
    assert.ok(newJson.length<oldJson.length,`${orders}: compact payload must be smaller`);
    const sealStart=performance.now(),envelope=Envelope.createEnvelope(bridgeSource(report.normalizedScenario),{operationalDate:'2026-09-06',confirmDateAssumption:true}),sealMs=performance.now()-sealStart;
    const runStart=performance.now(),candidate=Result.execute(envelope,{sessionId:`PERF-${orders}`}),executeMs=performance.now()-runStart;
    const admitStart=performance.now();Result.admit(envelope,candidate,{sessionId:`PERF-${orders}`});const independentAdmissionMs=performance.now()-admitStart;
    rows.push({orders,inputBytes:file.size,parseValidateMs:round(parseValidateMs),p51:{oldDuplicatePayloadBytes:oldJson.length,compactPayloadBytes:newJson.length,byteReductionPercent:round((1-newJson.length/oldJson.length)*100),oldCloneMs:round(oldCloneMs),compactCloneMs:round(newCloneMs)},p6:{envelopeBytes:JSON.stringify(envelope).length,sealMs:round(sealMs),executeMs:round(executeMs),independentAdmissionMs:round(independentAdmissionMs),resultHash:candidate.resultHash},evidenceClass:'COMPONENT_MEASURED_NODE_SAME_PROCESS'});
  }
  console.log(JSON.stringify({schemaVersion:'stct-v1.9-p6-performance-v1',status:'PASS',machine:{platform:process.platform,arch:process.arch,node:process.version},rows,limitations:['Component timing excludes browser rendering and IndexedDB transaction latency.','Each measurement is a small local sample and is not an SLA or p95.'],externalRequests:0},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
