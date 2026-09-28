(function(root,factory){const ns=root.STCTPlatformV19=root.STCTPlatformV19||{};const api=factory(typeof module==='object'&&module.exports?{Context:require('./design-strategic-context-v19.js'),Data:require('./design-data-adapter-v19.js'),Contract:require('./network-contract-v18.js')}:{Context:ns.designStrategicContext,Data:ns.designDataAdapter,Contract:root.STCTV18?.networkContract});if(typeof module==='object'&&module.exports)module.exports=api;if(root.document)ns.operationsDataAdapter=api;})(globalThis,function(dependencies){
  'use strict';
  const {Context,Data,Contract}=dependencies;
  const clone=value=>structuredClone(value);
  const fail=code=>{throw Object.assign(new Error(code),{code});};
  function createDraft(dataset){
    const data=clone(dataset.payload);if(!data.normalizedScenario||data.validationReport.status!=='READY')fail('COMMAND_DATA_VALIDATION_REQUIRED');
    let evaluation=null,status='DRAFT';
    function generate(){
      const context=Context.createContext({dataSource:Data.adoptNetworkScenario(data.normalizedScenario,{sourceType:'FILE_UPLOAD',sourceRef:data.versionId})});
      evaluation=context.evaluate(context.ScenarioLab.baseline(context.scenario));status='VERIFIED_CANDIDATE';return snapshot();
    }
    function snapshot(){return clone({schemaVersion:'stct-operations-data-draft-p5',status,sourceWorkspace:'PLATFORM',targetWorkspace:'COMMAND',datasetVersionId:data.versionId,inputHash:Contract.identityBundle(data.normalizedScenario).networkInputHash,orderIds:data.normalizedScenario.orders.map(row=>row.orderId),evaluation,autoApply:false,executionStarted:false});}
    function appliedPlan(){
      if(!evaluation)fail('COMMAND_CANDIDATE_REQUIRED');
      const context=Context.createContext({dataSource:Data.adoptNetworkScenario(data.normalizedScenario)});
      const checked=context.admit(context.ScenarioLab.baseline(context.scenario),evaluation);
      const scenario=data.normalizedScenario;
      const routes=checked.plan.trip.trips.map(trip=>{
        const route=checked.plan.trip.routes.find(route=>route.routeId===trip.routeId);
        const start=scenario.depots.find(row=>row.depotId===trip.startDepotId),end=scenario.depots.find(row=>row.depotId===trip.endDepotId);
        return {...clone(trip),routeId:trip.routeId,revision:1,geometry:[start.coordinate,...route.stops.map(row=>row.coordinate),end.coordinate],matrixHash:checked.plan.routingContextHash,totalDistance:route.metrics.distanceKm,plannedDistanceMeters:route.metrics.distanceKm*1000,distanceSource:route.distanceSource,verification:clone(checked.verification)};
      });
      return {schemaVersion:'stct-command-applied-plan-v1.9-p3',sourceGate:'P5_DATA_DRAFT',planId:'P5-'+checked.plan.networkPlanHash.slice(-12),planHash:checked.plan.networkPlanHash,inputHash:checked.networkInputHash,matrixHash:checked.plan.routingContextHash,revision:1,logicalStartMinute:100,providerProvenance:clone(scenario.routingContext),verification:clone(checked.verification),routes,unassignedOrderIds:checked.plan.trip.unassigned.map(row=>row.orderId),dataClassification:data.settings.classification,meta:{scenarioSnapshot:clone(scenario),datasetVersionId:data.versionId,evaluationArtifactHash:checked.artifactHash},networkEvaluation:checked};
    }
    function apply(context,approval={}){
      const before=context.snapshot();
      if(before.offline.queue.some(row=>!['ACKED','REJECTED','CANCELLED'].includes(row.status)))return {status:'REJECTED',code:'COMMAND_PENDING_ACK_PROTECTED'};
      if(!approval.confirmed||!approval.backupHash||approval.backupHash!==Contract.hashArtifact(before))return {status:'REJECTED',code:'COMMAND_RESET_REVIEW_AND_BACKUP_REQUIRED'};
      const result=context.adoptAppliedPlan(appliedPlan(),{policy:'RESET_EXECUTION',reason:'P5_USER_CONFIRMED_VERIFIED_DATA_DRAFT'});
      if(result.status==='ADOPTED')status='APPLIED_NOT_STARTED';return result;
    }
    return Object.freeze({generate,snapshot,appliedPlan,apply});
  }
  return Object.freeze({createDraft});
});
