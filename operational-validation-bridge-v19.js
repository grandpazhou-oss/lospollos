(function(root,factory){
  const ns=root.STCTPlatformV19=root.STCTPlatformV19||{};
  const api=factory(typeof module==='object'&&module.exports?{Contract:require('./network-contract-v18.js'),Envelope:require('./operational-validation-contract-v19.js'),Session:require('./operational-validation-session-v19.js'),Result:require('./operational-validation-result-v19.js')}:{Contract:root.STCTV18?.networkContract,Envelope:ns.operationalValidationContract,Session:ns.operationalValidationSession,Result:ns.operationalValidationResult});
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root.document)ns.operationalValidationBridge=api;
})(globalThis,function({Contract,Envelope,Session,Result}){
  const VERSION='stct-operational-validation-bridge-v1.9-p6';
  const clone=value=>structuredClone(value);
  const fail=(code,detail={})=>{throw Object.assign(new Error(code),{code,detail});};
  function create(options){
    const repository=options.repository,studyService=options.studyService;
    let prepared=null,envelope=null,session=null,lastResult=null,lastPointer=null,activeWorker=null,activeWorkerCancel=null,sessionUnsubscribe=null;
    const audit=[],listeners=new Set();
    const emit=(action,detail={})=>{const row={index:audit.length+1,action,detail:clone(detail)};audit.push(row);listeners.forEach(fn=>fn(snapshot(),row));return row;};
    function snapshot(){return clone({schemaVersion:VERSION,status:session?.snapshot().status||prepared?.status||'IDLE',preflight:prepared,envelope,session:session?.snapshot()||null,result:lastResult,pointer:lastPointer,audit});}
    async function resolveSource(store){
      const view=store.snapshot(),catalog=await repository.list('pointers');
      const pointer=catalog.filter(row=>row.scope==='DESIGN'&&!row.archived&&row.studyId===view.studyId&&row.scenarioId===view.activeScenarioId&&row.inputHash===view.activeInputHash).sort((a,b)=>String(b.savedAt||'').localeCompare(String(a.savedAt||'')))[0];
      if(!pointer)fail('OPERATIONAL_SOURCE_STUDY_NOT_SAVED');
      const datasetRef=pointer.refs.find(row=>row.store==='datasetVersions');if(!datasetRef)fail('OPERATIONAL_SOURCE_DATASET_MISSING');
      const datasetRecord=await repository.read(datasetRef.store,datasetRef.id);if(!datasetRecord)fail('OPERATIONAL_SOURCE_DATASET_MISSING');
      return {studySnapshot:view,studyPointer:pointer,datasetRecord};
    }
    async function preflight(store,runOptions={}){
      const source=await resolveSource(store);prepared=Envelope.preflight(source,runOptions);prepared.runOptions=clone(runOptions);prepared.sourceIdentity={studyId:source.studySnapshot.studyId,scenarioId:source.studySnapshot.activeScenarioId,inputHash:source.studySnapshot.activeInputHash,datasetVersionId:source.datasetRecord.id};
      emit('PREFLIGHT_COMPLETED',{status:prepared.status,issues:prepared.issues});return clone(prepared);
    }
    async function seal(store,runOptions={}){
      const source=await resolveSource(store);prepared=Envelope.preflight(source,runOptions);if(prepared.status!=='PASS')fail('OPERATIONAL_PREFLIGHT_BLOCKED',{issues:prepared.issues});
      envelope=Envelope.createEnvelope(source,runOptions);sessionUnsubscribe?.();session=Session.create(envelope);sessionUnsubscribe=session.subscribe((_state,event)=>emit('SESSION_STATE_CHANGED',{status:event.status,stage:event.stage,generation:event.generation}));session.precheck();session.seal();emit('ENVELOPE_SEALED',{envelopeHash:envelope.envelopeHash,sourceSemanticKey:envelope.sourceSemanticKey});return clone(envelope);
    }
    async function sealFacility(adapter,savedPointer,runOptions={}){
      envelope=Envelope.createFacilityEnvelope({adapter,savedPointer},runOptions);prepared={schemaVersion:'stct-operational-preflight-v1.9-p6',status:'PASS',issues:[],sourceIdentity:{studyId:adapter.study.studyId,inputHash:adapter.study.studyHash,portfolioHash:adapter.portfolio.portfolioHash},portfolioKind:'FACILITY_PORTFOLIO_MVP1',runOptions:clone(runOptions)};sessionUnsubscribe?.();session=Session.create(envelope);sessionUnsubscribe=session.subscribe((_state,event)=>emit('SESSION_STATE_CHANGED',{status:event.status,stage:event.stage,generation:event.generation}));session.precheck();session.seal();emit('FACILITY_ENVELOPE_SEALED',{envelopeHash:envelope.envelopeHash,sourceSemanticKey:envelope.sourceSemanticKey,strategicMatrixHash:envelope.strategicFacilityMatrixHash});return clone(envelope);
    }
    async function run(runOptions={}){
      if(!session)fail('OPERATIONAL_SESSION_REQUIRED');emit('VALIDATION_REQUESTED',{sessionId:session.sessionId,envelopeHash:envelope.envelopeHash});
      if(!options.workerFactory)await session.run(runOptions);
      else{
        const job=session.begin();
        await new Promise((resolve,reject)=>{
          const worker=options.workerFactory();activeWorker=worker;
          let finished=false;
          const finish=(error)=>{if(finished)return;finished=true;worker.terminate();if(activeWorker===worker){activeWorker=null;activeWorkerCancel=null;}error?reject(error):resolve();};
          activeWorkerCancel=()=>finish();
          worker.onerror=()=>{const error=Object.assign(new Error('OPERATIONAL_WORKER_FAILED'),{code:'OPERATIONAL_WORKER_FAILED'});session.failJob(error,job.generation);finish(error);};
          worker.onmessage=event=>{const value=event.data;if(value.generation!==job.generation)return;if(value.type==='STAGE')session.progress(value.stage,job.generation,value.processedEntities);else if(value.type==='ERROR'){const error=Object.assign(new Error(value.code),{code:value.code,detail:value.detail});session.failJob(error,job.generation);finish(error);}else if(value.type==='RESULT'){session.accept(value.result,job.generation);finish();}};
          worker.postMessage({action:'RUN_OPERATIONAL_VALIDATION',envelope,sessionId:session.sessionId,generation:job.generation});
        });
      }
      if(session.snapshot().status==='CANCELLED')return{status:'CANCELLED'};
      lastResult=session.result;emit('VALIDATION_RESULT_ADMITTED',{resultHash:lastResult.resultHash,statusDimensions:lastResult.statusDimensions});return clone(lastResult);
    }
    function cancel(){if(!session)return{status:'NO_SESSION'};const value=session.cancel();activeWorkerCancel?.();activeWorker?.terminate();activeWorker=null;activeWorkerCancel=null;emit('VALIDATION_CANCELLED',{sessionId:session.sessionId,generation:session.snapshot().generation});return value;}
    async function persist(expectedRevision=0){
      if(!lastResult||session.snapshot().status!=='RESULT_READY')fail('OPERATIONAL_RESULT_NOT_READY');
      const sessionPayload=session.snapshot();delete sessionPayload.result;
      const evidencePayload={schemaVersion:'stct-operational-plan-evidence-v1.9-p6',resultHash:lastResult.resultHash,envelopeHash:envelope.envelopeHash,plan:lastResult.planEvidence,networkVerification:lastResult.networkVerification,accountingVerification:lastResult.accountingVerification};
      const bindingPayload={schemaVersion:'stct-design-operational-result-binding-v1.9-p6',sourceStudyId:envelope.sourceStudyId,sourceStudyVersionId:envelope.sourceStudyVersionId,sourceScenarioId:envelope.sourceScenarioId,sourceSemanticKey:envelope.sourceSemanticKey,envelopeHash:envelope.envelopeHash,resultHash:lastResult.resultHash,scope:'READ_ONLY_ATTACHMENT'};
      const evidenceId=`EVIDENCE:${lastResult.resultHash}`,bindingId=`OP-BINDING:${envelope.sourceStudyVersionId}:${lastResult.resultHash}`;
      const records={operationalEnvelopes:[repository.record(envelope.envelopeHash,envelope)],operationalSessions:[repository.record(session.sessionId,sessionPayload,[{store:'operationalEnvelopes',id:envelope.envelopeHash}])],operationalEvidence:[repository.record(evidenceId,evidencePayload,[{store:'operationalEnvelopes',id:envelope.envelopeHash}])],operationalResults:[repository.record(lastResult.resultHash,lastResult,[{store:'operationalEnvelopes',id:envelope.envelopeHash},{store:'operationalSessions',id:session.sessionId},{store:'operationalEvidence',id:evidenceId}])],operationalBindings:[repository.record(bindingId,bindingPayload,[{store:'operationalResults',id:lastResult.resultHash}])]};
      const pointer={id:`VALIDATION:${lastResult.resultHash}`,scope:'DESIGN',type:'OPERATIONAL_VALIDATION',name:`Operational validation ${envelope.operationalSlice.operationalDate}`,sourceWorkspace:'DESIGN',targetWorkspace:'COMMAND',studyId:envelope.sourceStudyId,scenarioId:envelope.sourceScenarioId,inputHash:envelope.sourceStudyInputHash,verification:lastResult.statusDimensions.businessVerificationStatus,freshness:'CURRENT',route:envelope.portfolioKind==='FACILITY_PORTFOLIO_MVP1'?'/design/facility-location':'/design/operational-validation',refs:[{store:'operationalEnvelopes',id:envelope.envelopeHash},{store:'operationalSessions',id:session.sessionId},{store:'operationalResults',id:lastResult.resultHash},{store:'operationalBindings',id:bindingId}]};
      const saved=await repository.commit({records,pointer,expectedRevision,action:'SAVE_OPERATIONAL_VALIDATION'});lastPointer=saved.pointer;emit('VALIDATION_SAVED',{pointerId:lastPointer.id,revision:lastPointer.revision});return saved;
    }
    function currentSemanticStatus(store){
      const view=store.snapshot(),scenario=store.activeRecord().scenario,reasons=[];
      if(view.studyId!==envelope.sourceStudyId)reasons.push('SOURCE_STUDY_CHANGED');if(view.activeScenarioId!==envelope.sourceScenarioId)reasons.push('SOURCE_SCENARIO_CHANGED');if(view.activeInputHash!==envelope.sourceStudyInputHash)reasons.push('SOURCE_INPUT_CHANGED');if(view.evaluation?.artifactHash!==envelope.sourceEvaluationArtifactHash)reasons.push('SOURCE_EVALUATION_CHANGED');
      if(Contract.identityBundle(scenario).routingContextHash!==envelope.sourceRoutingContextHash)reasons.push('SOURCE_MATRIX_CHANGED');
      if(Envelope.portfolio(scenario,envelope.sourceDatasetVersionIds[0]).facilityPortfolioHash!==envelope.facilityPortfolioHash)reasons.push('SOURCE_PORTFOLIO_CHANGED');
      if(Contract.hashArtifact(scenario.assumptions)!==Contract.hashArtifact(envelope.operationalScenario.assumptions))reasons.push('SOURCE_ASSUMPTIONS_CHANGED');
      return{status:reasons.length?'STALE':'CURRENT',reasons};
    }
    async function returnToDesign(store){
      if(!lastResult)fail('OPERATIONAL_RESULT_NOT_READY');const freshness=currentSemanticStatus(store);
      if(freshness.status==='CURRENT')store.addOperationalValidation({validationId:lastResult.resultId,sourceStudyId:envelope.sourceStudyId,sourceStudyHash:store.snapshot().studyHash,sourceScenarioHash:envelope.sourceStudyInputHash,sourceMatrixHash:Contract.identityBundle(store.activeRecord().scenario).routingContextHash,status:'RESULT_READY',verifierStatus:lastResult.statusDimensions.businessVerificationStatus,metrics:{service:lastResult.metrics.serviceRate,fleetRequirement:lastResult.metrics.fleetRequirement.value,routeDistanceKm:lastResult.metrics.routeDistanceMeters/1000,routeDurationMinutes:lastResult.metrics.travelSeconds/60,dockPressure:lastResult.metrics.dockConflicts,waveRisk:lastResult.metrics.waveRisk,driverRisk:lastResult.metrics.missingOrViolatedDriverConstraints.length,operationalCost:lastResult.metrics.operationalCost,carbonKg:lastResult.metrics.carbonKg},warnings:lastResult.constraintFindings.map(row=>row.code),source:'P6_OPERATIONAL_VALIDATION_BRIDGE',summary:`${lastResult.statusDimensions.serviceStatus} · ${lastResult.comparabilityReport.label}`,bridgeResultRef:lastResult.resultHash});
      session.markReturned();emit('RESULT_RETURNED_TO_DESIGN',{freshness,resultHash:lastResult.resultHash});return{status:freshness.status,resultsAttached:freshness.status==='CURRENT'?1:0,reasons:freshness.reasons,result:clone(lastResult)};
    }
    function returnFacility(currentStudyHash){if(!lastResult)fail('OPERATIONAL_RESULT_NOT_READY');const freshness=currentStudyHash===envelope.sourceStudyInputHash?{status:'CURRENT',reasons:[]}:{status:'STALE',reasons:['FACILITY_STUDY_CHANGED']};session.markReturned();emit('FACILITY_RESULT_RETURNED_TO_DESIGN',{freshness,resultHash:lastResult.resultHash});return{...freshness,result:clone(lastResult),reconciliation:{strategicCost:clone(envelope.costSnapshot.strategicFacilityCost),operationalCost:lastResult.metrics.operationalCost,currency:lastResult.metrics.currency,period:envelope.costSnapshot.period,comparable:false,reason:'STRATEGIC_FACILITY_COST_AND_OPERATIONAL_ROUTE_COST_USE_SEPARATE_SCOPES'}};}
    function exit(){activeWorkerCancel?.();activeWorker?.terminate();activeWorker=null;activeWorkerCancel=null;sessionUnsubscribe?.();sessionUnsubscribe=null;session?.dispose();prepared=null;envelope=null;session=null;lastResult=null;emit('VALIDATION_CONTEXT_EXITED');return{status:'EXITED_TO_COMMAND_ACTIVE_OPERATIONS'};}
    return Object.freeze({VERSION,preflight,seal,sealFacility,run,cancel,persist,returnToDesign,returnFacility,currentSemanticStatus,exit,snapshot,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}});
  }
  return Object.freeze({VERSION,create});
});
