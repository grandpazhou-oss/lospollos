'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Import=require('../platform-import-session-v19.js');
const Settings=require('../platform-settings-v19.js');
const Contract=require('../network-contract-v18.js');
const Store=require('../design-study-store-v19.js');
const Context=require('../design-strategic-context-v19.js');
const Data=require('../design-data-adapter-v19.js');
const Service=require('../platform-study-service-v19.js');

const checks=[];
async function check(id,fn){await fn();checks.push({id,status:'PASS'});}
const settings={scope:'DESIGN',coordinateSystem:'WGS84',weightUnit:'tonne',volumeUnit:'litre',observationPeriod:'2026-09-01',costPeriod:'MODEL_RUN',currency:'CNY',classification:'SYNTHETIC'};

(async()=>{
  const fixture=process.argv[2];
  const source=JSON.parse(fs.readFileSync(path.join(fixture,'network.json'),'utf8'));
  for(const order of source.scenario.orders){order.demand.weight/=1000;order.demand.volume*=1000;}
  for(const row of [...source.scenario.vehicles,...source.scenario.vehicleTypes]){row.capacity.weight/=1000;row.capacity.volume*=1000;}
  const rawFile=new File([JSON.stringify(source)],'network.json',{type:'application/json'});
  const firstSession=await Import.readFiles([rawFile]);
  const first=Import.validate(firstSession,settings);
  assert.equal(first.status,'READY');

  await check('J6-01-CANONICAL-ROUNDTRIP',async()=>{
    const exported={schemaVersion:'stct-dataset-export-p5.1',inputKind:'CANONICAL_DATASET_EXPORT',scenario:first.records,datasetVersionId:'DATASET-ROUNDTRIP:1',canonicalDataHash:first.canonicalDataHash,canonicalUnits:{weight:'kg',volume:'m3'},sourceUnits:{weight:'tonne',volume:'litre'},settings:{...settings,weightUnit:'kg',volumeUnit:'m3'},conversionLedger:first.conversionLedger,originalBytesIncluded:false};
    const session=await Import.readFiles([new File([JSON.stringify(exported)],'dataset-version.json')]);
    const second=Import.validate(session,settings);
    assert.equal(session.inputKind,Import.INPUT_KINDS.CANONICAL);
    assert.equal(second.status,'READY');
    assert.equal(second.canonicalDataHash,first.canonicalDataHash);
    assert.equal(second.networkInputHash,first.networkInputHash);
    assert.deepEqual(second.normalizedScenario.orders.map(row=>row.demand),first.normalizedScenario.orders.map(row=>row.demand));
    const tampered=structuredClone(exported);tampered.scenario.orders[0].demand.volume+=1;
    const bad=Import.validate(await Import.readFiles([new File([JSON.stringify(tampered)],'bad.json')]),settings);
    assert.equal(bad.status,'BLOCKED');
    assert.ok(bad.issues.some(row=>row.code==='IMPORT_CANONICAL_HASH_MISMATCH'));
  });

  await check('P5.1-PERIOD-ALLOWLIST',()=>{
    const rows=[{costKey:'M',amount:100,period:'MONTH',currency:'CNY'}];
    assert.throws(()=>Settings.normalizePeriods(rows,{target:'DAY'}),{code:'COST_NORMALIZATION_TARGET_UNSUPPORTED'});
    assert.throws(()=>Settings.normalizePeriods(rows,{target:'MONTH'}),{code:'COST_NORMALIZATION_TARGET_UNSUPPORTED'});
    assert.equal(Settings.normalizePeriods(rows,{target:'YEAR',monthlyPeriodsPerYear:12}).rows[0].amount,1200);
  });

  await check('J6-02-DATASET-STUDY-MISMATCH',()=>{
    const store=Store.createStore({context:Context.createContext({dataSource:Data.adoptNetworkScenario(first.normalizedScenario,{sourceType:'FILE_UPLOAD',sourceRef:'DATASET-A:1'})})});
    const snapshot=store.exportSnapshot();snapshot.datasetVersionRefs=['DATASET-A:1'];snapshot.results=[];
    const datasetPayload={schemaVersion:'stct-dataset-version-p5',normalizedScenario:first.normalizedScenario,records:first.records,canonicalDataHash:first.canonicalDataHash,settings:first.settings};
    const dataset={id:'DATASET-A:1',payload:datasetPayload,contentHash:Contract.hashArtifact(datasetPayload),refs:[]};
    const study={id:'STUDY-V1',payload:snapshot,contentHash:Contract.hashArtifact(snapshot),refs:[{store:'datasetVersions',id:dataset.id}]};
    const graph={datasetVersions:[dataset],studyVersions:[study],evaluationArtifacts:[],bindings:[]};
    assert.equal(Service.validateStudyGraph(graph).status,'PASS');
    const changed=structuredClone(graph);changed["datasetVersions"][0].payload.normalizedScenario.orders[0].demand.weight+=100;changed.datasetVersions[0].payload.canonicalDataHash=Contract.hashArtifact({network:changed.datasetVersions[0].payload.normalizedScenario,candidateSites:first.records.candidateSites||[],costParameters:first.records.costParameters||[]});changed.datasetVersions[0].contentHash=Contract.hashArtifact(changed.datasetVersions[0].payload);
    assert.throws(()=>Service.validateStudyGraph(changed),{code:'STUDY_DATASET_BASELINE_MISMATCH'});
  });

  await check('J6-02-DETACHED-ARTIFACT-MISMATCH',()=>{
    const sourceRef='DATASET-B:1';
    const store=Store.createStore({context:Context.createContext({dataSource:Data.adoptNetworkScenario(first.normalizedScenario,{sourceType:'FILE_UPLOAD',sourceRef})})});
    const snapshot=store.exportSnapshot();snapshot.datasetVersionRefs=[sourceRef];
    const result=snapshot.results[0],record=snapshot.history.records[0],admitted=store.context.admit(record,result);
    const datasetPayload={schemaVersion:'stct-dataset-version-p5',normalizedScenario:first.normalizedScenario,records:first.records,canonicalDataHash:first.canonicalDataHash,settings:first.settings};
    const graph={datasetVersions:[{id:sourceRef,payload:datasetPayload,contentHash:Contract.hashArtifact(datasetPayload),refs:[]}],studyVersions:[{id:'STUDY-B',payload:snapshot,contentHash:Contract.hashArtifact(snapshot),refs:[{store:'datasetVersions',id:sourceRef}]}],evaluationArtifacts:[{id:result.artifactHash,payload:admitted.artifact,contentHash:Contract.hashArtifact(admitted.artifact),refs:[]}],bindings:[{id:`${snapshot.studyId}:${result.scenarioId}:${result.artifactHash}`,payload:result.binding,contentHash:Contract.hashArtifact(result.binding),refs:[{store:'evaluationArtifacts',id:result.artifactHash}]}]};
    assert.equal(Service.validateStudyGraph(graph).status,'PASS');
    const attack=structuredClone(graph);attack.evaluationArtifacts[0].payload.accounting.cost.total-=123456;attack.evaluationArtifacts[0].contentHash=Contract.hashArtifact(attack.evaluationArtifacts[0].payload);
    assert.throws(()=>Service.validateStudyGraph(attack),{code:'STUDY_ARTIFACT_CONTENT_MISMATCH'});
  });

  console.log(JSON.stringify({suite:'P5.1_INTEGRITY',checks},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
