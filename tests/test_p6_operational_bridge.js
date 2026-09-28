'use strict';
const assert=require('node:assert/strict');
const Contract=require('../network-contract-v18.js');
const Data=require('../design-data-adapter-v19.js');
const Context=require('../design-strategic-context-v19.js');
const Store=require('../design-study-store-v19.js');
const Envelope=require('../operational-validation-contract-v19.js');
const Session=require('../operational-validation-session-v19.js');
const Result=require('../operational-validation-result-v19.js');
const Command=require('../command-operational-context-v19.js');
const Service=require('../platform-study-service-v19.js');
const Bridge=require('../operational-validation-bridge-v19.js');
const Inbox=require('../operational-validation-inbox-v19.js');

const checks=[];
async function check(id,fn){await fn();checks.push({id,status:'PASS'});}
function source(fixtureOptions={orderCount:12,depotCount:2,vehicleCount:8}){
  const {transform,...options}=fixtureOptions,data=Data.createSyntheticStudy(options),sourceRef='DATASET-P6:1';
  transform?.(data.scenario);
  const store=Store.createStore({context:Context.createContext({dataSource:Data.adoptNetworkScenario(data.scenario,{sourceType:'FILE_UPLOAD',sourceRef})})});
  const view=store.snapshot(),datasetRecord={id:sourceRef,payload:{normalizedScenario:view.activeRecord.scenario}};
  const studyPointer={id:'DESIGN:P6',scope:'DESIGN',studyId:view.studyId,scenarioId:view.activeScenarioId,inputHash:view.activeInputHash,refs:[{store:'studyVersions',id:'STUDY-P6:1'},{store:'datasetVersions',id:sourceRef}]};
  return{store,input:{studySnapshot:view,studyPointer,datasetRecord}};
}
function envelopeOf(input,options={}){return Envelope.createEnvelope(input,{operationalDate:'2026-09-06',confirmDateAssumption:true,...options});}
function memoryRepository(input){
  const stores=new Map(),key=(store,id)=>`${store}:${id}`;
  if(input){stores.set(key('datasetVersions',input.datasetRecord.id),structuredClone(input.datasetRecord));stores.set(key('pointers',input.studyPointer.id),structuredClone(input.studyPointer));}
  return{
    record:(id,payload,refs=[])=>({id,payload:structuredClone(payload),refs:structuredClone(refs),contentHash:Contract.hashArtifact(payload)}),
    async read(store,id){return structuredClone(stores.get(key(store,id))||null);},
    async list(store){return [...stores.entries()].filter(([id])=>id.startsWith(`${store}:`)).map(([,row])=>structuredClone(row));},
    async commit({records={},pointer,catalogEntries=[],expectedRevision=0}){
      const current=stores.get(key('pointers',pointer.id));if((current?.revision||0)!==expectedRevision)throw Object.assign(new Error('REVISION_CONFLICT'),{code:'REVISION_CONFLICT'});
      const staged=[];for(const [store,rows]of Object.entries(records))for(const row of rows)staged.push([key(store,row.id),structuredClone(row)]);
      for(const row of catalogEntries)staged.push([key('pointers',row.id),structuredClone(row)]);
      const saved={...structuredClone(pointer),revision:expectedRevision+1,savedAt:'2026-09-06T00:00:00.000Z'};staged.push([key('pointers',saved.id),saved]);staged.forEach(([id,row])=>stores.set(id,row));return{status:'SAVED',pointer:structuredClone(saved)};
    },
    count(store){return [...stores.keys()].filter(id=>id.startsWith(`${store}:`)).length;}
  };
}

(async()=>{
  await check('T0359-T0379-ENVELOPE',()=>{
    const {input}=source(),a=envelopeOf(input),b=envelopeOf(input);
    assert.equal(Envelope.validateEnvelope(a).status,'PASS');assert.notEqual(a.envelopeId,b.envelopeId);assert.match(a.envelopeHash,/^sha256:[0-9a-f]{64}$/);
    assert.equal(a.sourceWorkspace,'DESIGN');assert.equal(a.targetWorkspace,'COMMAND');assert.equal(a.portfolioKind,'EXISTING_NETWORK_VARIANT');
    assert.equal(a.demandAssignments.length,a.operationalScenario.orders.length);assert.ok(a.selectedFacilities.length);assert.ok(a.facilityCapacities.length);assert.equal(a.routingSnapshot.mode,'ESTIMATED_HAVERSINE');
    const attack=structuredClone(a);attack.operationalScenario.orders[0].demand.volume+=1;assert.equal(Envelope.validateEnvelope(attack).status,'FAIL');
    assert.throws(()=>Envelope.createEnvelope(input,{sliceStrategy:'REPRESENTATIVE_DAY_ASSUMPTION',operationalDate:'2026-09-06'}),{code:'OPERATIONAL_PREFLIGHT_BLOCKED'});
  });

  await check('T0383-T0399-ISOLATED-SESSION',async()=>{
    const command=Command.createContext({fixture:{vehicleCount:4,stopsPerVehicle:4,positionsPerVehicle:6}});await command.ready;const before=Contract.hashArtifact(command.snapshot());
    const {input}=source(),envelope=envelopeOf(input),session=Session.create(envelope);session.precheck();session.seal();await session.run();
    assert.equal(session.snapshot().status,'RESULT_READY');assert.equal(session.snapshot().sessionKind,'COMMAND_VALIDATION_SESSION');assert.equal(Contract.hashArtifact(command.snapshot()),before);assert.match(command.diagnostics().fixtureBoundary,/SYNTHETIC/);
    assert.ok(!JSON.stringify(session.snapshot()).includes('RESET_EXECUTION'));
  });

  await check('T0400-T0419-RESULT-ADMISSION',()=>{
    const {input}=source(),envelope=envelopeOf(input),candidate=Result.execute(envelope,{sessionId:'S1'}),admitted=Result.admit(envelope,candidate,{sessionId:'S1',generation:1});
    assert.match(admitted.resultHash,/^sha256:[0-9a-f]{64}$/);assert.equal(admitted.envelopeHash,envelope.envelopeHash);assert.equal(admitted.statusDimensions.businessVerificationStatus,'PASS');assert.equal(admitted.statusDimensions.solverStatus,'LOCAL_HEURISTIC_NOT_PROVEN');assert.equal(admitted.comparabilityReport.label,'SAME_INPUT_COMPARABLE');assert.ok(admitted.commandPlanHashes.length>=3);assert.ok(admitted.evidenceRefs.length>=3);
    const attack=structuredClone(candidate);attack.metrics.routeDistanceMeters+=100;attack.resultHash=Contract.hashArtifact(Result.projection(attack));assert.throws(()=>Result.admit(envelope,attack,{sessionId:'S1'}),{code:'OPERATIONAL_RESULT_ADMISSION_FAILED'});
  });

  await check('J6-07-RESOURCE-LIMITED',()=>{
    const {input}=source({orderCount:40,depotCount:2,vehicleCount:8}),baseline=Result.execute(envelopeOf(input),{sessionId:'BASE'}),limitedEnvelope=envelopeOf(input,{resourceOverrides:{vehicleLimit:2,dockCapacityMultiplier:1}}),limited=Result.execute(limitedEnvelope,{sessionId:'LIMIT'});
    assert.equal(limited.comparabilityReport.label,'SCENARIO_CHANGED');assert.ok(limited.metrics.usedVehicles<=2);assert.ok(limited.metrics.assigned<=baseline.metrics.assigned);assert.equal(limited.statusDimensions.businessVerificationStatus,'PASS');
  });

  await check('J6-08-DOCK-CAPACITY-GROUP',()=>{
    const {input}=source({orderCount:40,depotCount:2,vehicleCount:8,transform:scenario=>scenario.docks.forEach(row=>{row.simultaneousCapacity=4;})});
    const baselineEnvelope=envelopeOf(input),limitedEnvelope=envelopeOf(input,{resourceOverrides:{vehicleLimit:8,dockCapacityMultiplier:0.25}});
    const baseline=Result.execute(baselineEnvelope,{sessionId:'DOCK-BASE'}),limited=Result.execute(limitedEnvelope,{sessionId:'DOCK-LIMIT'});
    assert.ok(baselineEnvelope.resourceSnapshot.docks.every(row=>row.simultaneousCapacity===4));assert.ok(limitedEnvelope.resourceSnapshot.docks.every(row=>row.simultaneousCapacity===1));
    assert.notEqual(baselineEnvelope.resourceSnapshot.resourceProfileHash,limitedEnvelope.resourceSnapshot.resourceProfileHash);assert.equal(limited.comparabilityReport.label,'SCENARIO_CHANGED');assert.equal(limited.statusDimensions.businessVerificationStatus,'PASS');
  });

  await check('J6-03-J6-06-PREFLIGHT-AND-CONTROL',async()=>{
    const {input}=source();
    assert.equal(Envelope.preflight(input,{operationalDate:'2026-09-06',confirmDateAssumption:true}).status,'PASS');
    assert.ok(Envelope.preflight(input,{operationalDate:'2026-09-06'}).issues.some(row=>row.code==='OPERATIONAL_DATE_ASSUMPTION_CONFIRMATION_REQUIRED'));
    assert.equal(Result.execute(envelopeOf(input),{sessionId:'CONTROL'}).comparabilityReport.label,'SAME_INPUT_COMPARABLE');
    const unsupported=source({orderCount:12,depotCount:2,vehicleCount:8,transform:scenario=>{scenario.routingContext.providerId='PUBLIC_ROUTER_NOT_ALLOWED';}});
    assert.ok(Envelope.preflight(unsupported.input,{operationalDate:'2026-09-06',confirmDateAssumption:true}).issues.some(row=>row.code==='OPERATIONAL_ROUTING_MODE_UNSUPPORTED'));
  });

  await check('J6-05-J6-09-J6-12-ATOMIC-PERSIST-RETURN',async()=>{
    const {store,input}=source(),repo=memoryRepository(input),command=Command.createContext({fixture:{vehicleCount:4,stopsPerVehicle:4,positionsPerVehicle:6}});await command.ready;const commandHash=Contract.hashArtifact(command.snapshot());
    const designInputHash=store.snapshot().activeInputHash;
    const bridge=Bridge.create({repository:repo,studyService:{}});await bridge.seal(store,{operationalDate:'2026-09-06',confirmDateAssumption:true});await bridge.run();
    await assert.rejects(()=>bridge.persist(7),{code:'REVISION_CONFLICT'});assert.equal(repo.count('operationalResults'),0);assert.equal(repo.count('operationalEvidence'),0);
    await bridge.persist(0);const returned=await bridge.returnToDesign(store);assert.equal(returned.status,'CURRENT');assert.equal(store.snapshot().activeInputHash,designInputHash);assert.equal(store.snapshot().validations.length,1);assert.equal(repo.count('operationalEvidence'),1);assert.equal(Contract.hashArtifact(command.snapshot()),commandHash);
    const actions=bridge.snapshot().audit.map(row=>row.action);assert.ok(actions.includes('VALIDATION_REQUESTED'));assert.ok(actions.includes('VALIDATION_RESULT_ADMITTED'));assert.ok(actions.includes('VALIDATION_SAVED'));assert.ok(bridge.snapshot().audit.some(row=>JSON.stringify(row.detail).includes('sha256:')));
    const validationId=store.snapshot().validations[0].validationId;store.removeOperationalValidation(validationId);assert.equal(store.snapshot().validations.length,0);assert.equal(repo.count('operationalEvidence'),1);
  });

  await check('J6-14-OPERATIONAL-RERANK-MAX-THREE',()=>{
    const {store}=source();
    for(const [index,metrics] of [{service:0.96,operationalCost:200,fleetRequirement:4},{service:0.99,operationalCost:250,fleetRequirement:5},{service:0.99,operationalCost:180,fleetRequirement:6},{service:0.5,operationalCost:1,fleetRequirement:1}].entries())store.addOperationalValidation({validationId:`RANK-${index+1}`,status:'RESULT_READY',verifierStatus:'PASS',metrics,source:'P6_OPERATIONAL_VALIDATION_BRIDGE'});
    const projection=Inbox.project(store);assert.equal(projection.comparison.candidates.length,3);assert.equal(projection.comparison.recommendation.validationId,'RANK-3');assert.equal(projection.comparison.strategicObjectiveUnchanged,true);
  });

  await check('J6-10-SEMANTIC-FRESHNESS',()=>{
    const {store,input}=source(),envelope=envelopeOf(input),result=Result.execute(envelope,{sessionId:'S2'});
    assert.equal(Result.freshness(envelope,result,envelope.sourceSemanticKey).status,'CURRENT');store.createScenario('DEMAND_PEAK',{factor:1.25});assert.notEqual(store.snapshot().activeInputHash,envelope.sourceStudyInputHash);
    assert.equal(Result.freshness(envelope,result,Contract.hashArtifact({changed:store.snapshot().activeInputHash})).status,'STALE');
  });

  await check('T0426-T0429-SEMANTIC-STALE-REASONS',async()=>{
    async function setup(){const value=source(),bridge=Bridge.create({repository:memoryRepository(value.input),studyService:{}});await bridge.seal(value.store,{operationalDate:'2026-09-06',confirmDateAssumption:true});return{...value,bridge};}
    function changed(store,mutate){const record=store.activeRecord();mutate(record.scenario);record.scenario=Contract.normalizeScenario(record.scenario);record.inputHash=Contract.identityBundle(record.scenario).networkInputHash;const view={...store.snapshot(),activeInputHash:record.inputHash,evaluation:null};return{activeRecord:()=>structuredClone(record),snapshot:()=>structuredClone(view)};}
    const matrix=await setup(),matrixStore=changed(matrix.store,scenario=>{scenario.routingContext.closures=[{closureId:'TEST-CLOSURE',from:'A',to:'B',status:'CLOSED'}];});assert.ok(matrix.bridge.currentSemanticStatus(matrixStore).reasons.includes('SOURCE_MATRIX_CHANGED'));
    const portfolio=await setup(),portfolioStore=changed(portfolio.store,scenario=>{scenario.depots[0].capacity.dailyOrders+=1;});assert.ok(portfolio.bridge.currentSemanticStatus(portfolioStore).reasons.includes('SOURCE_PORTFOLIO_CHANGED'));
    const assumptions=await setup(),assumptionStore=changed(assumptions.store,scenario=>{scenario.assumptions.accountingOptions={...scenario.assumptions.accountingOptions,tollPerKm:1.25};});assert.ok(assumptions.bridge.currentSemanticStatus(assumptionStore).reasons.includes('SOURCE_ASSUMPTIONS_CHANGED'));
  });

  await check('T0387-EXIT-WITHOUT-SAVE',async()=>{
    const {store,input}=source(),repo=memoryRepository(input),bridge=Bridge.create({repository:repo,studyService:{}});await bridge.seal(store,{operationalDate:'2026-09-06',confirmDateAssumption:true});assert.equal(bridge.exit().status,'EXITED_TO_COMMAND_ACTIVE_OPERATIONS');assert.equal(repo.count('operationalResults'),0);assert.equal(repo.count('operationalEvidence'),0);
  });

  await check('J6-11-CANCEL-LATE-CALLBACK',async()=>{
    const {input}=source({orderCount:120,depotCount:2,vehicleCount:12}),session=Session.create(envelopeOf(input));session.precheck();session.seal();let resume;const running=session.run({defer:resolve=>{resume=resolve;}});await Promise.resolve();const generation=session.snapshot().generation;assert.equal(session.cancel().status,'CANCELLED');resume();await running;assert.equal(session.snapshot().status,'CANCELLED');assert.equal(session.snapshot().resultRefs.length,0);assert.equal(session.rejectLateCallback(generation).status,'REJECTED_STALE_GENERATION');
  });

  await check('T0440-T0441-P6-PACKAGE-ROUNDTRIP-TAMPER',async()=>{
    const {input}=source(),envelope=envelopeOf(input),session=Session.create(envelope);session.precheck();session.seal();await session.run();const result=session.result,sessionPayload=session.snapshot();delete sessionPayload.result;
    const repo={record:(id,payload,refs=[])=>({id,payload:structuredClone(payload),refs:structuredClone(refs),contentHash:Contract.hashArtifact(payload)})};
    const evidenceId=`EVIDENCE:${result.resultHash}`,bindingId=`BINDING:${result.resultHash}`;
    const records={operationalEnvelopes:[repo.record(envelope.envelopeHash,envelope)],operationalSessions:[repo.record(session.sessionId,sessionPayload,[{store:'operationalEnvelopes',id:envelope.envelopeHash}])],operationalEvidence:[repo.record(evidenceId,{resultHash:result.resultHash,envelopeHash:envelope.envelopeHash})],operationalResults:[repo.record(result.resultHash,result,[{store:'operationalEnvelopes',id:envelope.envelopeHash},{store:'operationalSessions',id:session.sessionId},{store:'operationalEvidence',id:evidenceId}])],operationalBindings:[repo.record(bindingId,{resultHash:result.resultHash,envelopeHash:envelope.envelopeHash},[{store:'operationalResults',id:result.resultHash}])]};
    const pointer={id:`VALIDATION:${result.resultHash}`,scope:'DESIGN',type:'OPERATIONAL_VALIDATION',refs:[{store:'operationalEnvelopes',id:envelope.envelopeHash},{store:'operationalSessions',id:session.sessionId},{store:'operationalResults',id:result.resultHash},{store:'operationalBindings',id:bindingId}]};
    const payload={schemaVersion:'stct-study-package-p6',application:'Supply Chain Decision Platform',records,pointers:[pointer],omittedOriginalBytes:true,missingEvidence:['ORIGINAL_UPLOAD_BYTES'],sourceRefs:[pointer.id],createdAt:'2026-09-06T00:00:00.000Z',importPolicy:'READ_ONLY_REVIEW_EXPLICIT_ACTIVATION_REQUIRED'};payload.packageHash=Contract.hashArtifact(payload);
    const service=Service.createService({});assert.equal(service.inspectPackage(payload).status,'READY');
    const targetRepo=memoryRepository(),targetService=Service.createService(targetRepo);const imported=await targetService.importPackage(payload);assert.equal(imported.status,'SAVED');assert.deepEqual((await targetRepo.read('operationalResults',result.resultHash)).payload,result);
    const reexported=await targetService.exportPackage([pointer.id]);assert.equal(targetService.inspectPackage(reexported).status,'READY');assert.equal(reexported.records.operationalResults[0].id,result.resultHash);
    const attack=structuredClone(payload);attack.records.operationalResults[0].payload.metrics.assigned-=1;attack.records.operationalResults[0].contentHash=Contract.hashArtifact(attack.records.operationalResults[0].payload);delete attack.packageHash;attack.packageHash=Contract.hashArtifact(attack);assert.throws(()=>service.inspectPackage(attack));
  });

  console.log(JSON.stringify({suite:'P6_OPERATIONAL_BRIDGE',checks},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
