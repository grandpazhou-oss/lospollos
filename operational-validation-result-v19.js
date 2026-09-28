(function(root,factory){
  const ns=root.STCTPlatformV19=root.STCTPlatformV19||{};
  const api=factory(typeof module==='object'&&module.exports?{Contract:require('./network-contract-v18.js'),Solver:require('./network-solver-v18.js'),Accounting:require('./network-accounting-v18.js'),Envelope:require('./operational-validation-contract-v19.js')}:{Contract:root.STCTV18?.networkContract,Solver:root.STCTV18?.networkSolver,Accounting:root.STCTV18?.networkAccounting,Envelope:ns.operationalValidationContract});
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root.document)ns.operationalValidationResult=api;
})(globalThis,function({Contract,Solver,Accounting,Envelope}){
  const VERSION='stct-operational-validation-result-authority-v1.9-p6';
  const SCHEMA='stct-operational-validation-result-v1.9-p6';
  const clone=value=>structuredClone(value);
  const fail=(code,detail={})=>{throw Object.assign(new Error(code),{code,detail});};
  const projection=value=>{const copy=clone(value);delete copy.resultHash;delete copy.admission;return copy;};
  const finiteOrNull=(value,reason)=>Number.isFinite(Number(value))?Number(value):{value:null,reason};
  const same=(left,right)=>Contract.canonicalString(left)===Contract.canonicalString(right);
  function metrics(scenario,plan,accounting){
    const usedIds=[...new Set((plan.trip?.trips||[]).map(row=>row.vehicleId))];
    const byVehicle=new Map(scenario.vehicles.map(row=>[row.vehicleId,row]));
    const vehicleTypeCounts={};for(const id of usedIds){const type=byVehicle.get(id)?.vehicleTypeId||'UNKNOWN';vehicleTypeCounts[type]=(vehicleTypeCounts[type]||0)+1;}
    const assigned=Number(plan.metrics?.assignedOrders||0),unassigned=Number(plan.metrics?.unassignedOrders||0),blocked=Number(plan.metrics?.blockedOrders||0),total=scenario.orders.length;
    const dockRows=plan.dock?.reservations||plan.dock?.schedule||[];
    const conflictCount=(plan.dock?.conflicts||[]).length;
    const lateOrders=(plan.trip?.unassigned||[]).filter(row=>/TIME|DUTY|DRIVING|BREAK|WINDOW/.test(String(row.reasonCode||row.reason))).length;
    const servedIds=new Set((plan.trip?.trips||[]).flatMap(row=>row.orderIds||[]));
    const totalPriority=scenario.orders.reduce((sum,row)=>sum+Math.max(0,Number(row.priorityWeight??1)||0),0);
    const servedPriority=scenario.orders.filter(row=>servedIds.has(row.orderId)).reduce((sum,row)=>sum+Math.max(0,Number(row.priorityWeight??1)||0),0);
    return {assigned,unassigned,blocked,totalDemand:total,priorityWeightedService:totalPriority?servedPriority/totalPriority:{value:null,reason:'PRIORITY_WEIGHT_TOTAL_ZERO'},serviceRate:total?assigned/total:null,usedVehicles:usedIds.length,fleetRequirement:{value:usedIds.length,method:'FEASIBLE_PLAN_USED_VEHICLES_NOT_PROVEN_MINIMUM'},vehicleTypeCounts,trips:Number(plan.metrics?.tripCount||0),routeDistanceMeters:Math.round(Number(plan.metrics?.routeDistanceKm||0)*1000),travelSeconds:Math.round(Number(plan.trip?.metrics?.drivingMinutes||0)*60),dutySeconds:Math.round((plan.trip?.driverDutyAudit||[]).reduce((sum,row)=>sum+Number(row.dutyMinutes||0),0)*60),lateOrders,maxLatenessMinutes:lateOrders?null:0,missingOrViolatedDriverConstraints:(plan.trip?.unassigned||[]).filter(row=>/DRIVER|DUTY|DRIVING|BREAK/.test(String(row.reasonCode||row.reason))).map(row=>row.reasonCode||row.reason),dockOccupancy:dockRows.length?dockRows.length:null,dockWaitMinutes:finiteOrNull(plan.dock?.metrics?.totalQueueMinutes,'DOCK_QUEUE_METRIC_UNAVAILABLE'),dockConflicts:conflictCount,waveRisk:plan.waves?.status==='FAIL'?'HIGH':conflictCount?'MEDIUM':'LOW',operationalCost:Number(accounting.cost.total),currency:accounting.cost.currency,carbonKg:Number(accounting.carbon.totalKg)};
  }
  function comparability(envelope,plan,accounting){
    const source=envelope.sourceDesignMetrics||{},sameInput=envelope.validationInputHash===envelope.sourceStudyInputHash&&envelope.resourceSnapshot.overridePolicy.vehicleLimit===envelope.resourceSnapshot.sourceCounts.vehicles&&envelope.resourceSnapshot.overridePolicy.dockCapacityMultiplier===1;
    const operational={serviceRate:plan.metrics.serviceRate,routeDistanceKm:plan.metrics.routeDistanceKm,totalCost:accounting.cost.total,totalCarbonKg:accounting.carbon.totalKg};
    const comparableCurrency=Boolean(source.accountingCurrency)&&source.accountingCurrency===accounting.cost.currency;
    const comparablePeriod=Boolean(source.costPeriod)&&source.costPeriod===envelope.costSnapshot?.period;
    const comparableScope=source.scope===envelope.portfolioKind;
    const sourceComplete=['serviceRate','routeDistanceKm','accountingTotal','accountingCarbonTotal'].every(key=>source[key]!==null&&source[key]!==''&&Number.isFinite(Number(source[key])));
    const comparable=sameInput&&comparableCurrency&&comparablePeriod&&comparableScope&&sourceComplete;
    const inputDiff=[];if(!sameInput)inputDiff.push('RESOURCE_OR_OPERATIONAL_SLICE_CHANGED');if(!comparableCurrency)inputDiff.push('CURRENCY_NOT_COMPARABLE');if(!comparablePeriod)inputDiff.push('PERIOD_NOT_COMPARABLE');if(!comparableScope)inputDiff.push('SCOPE_NOT_COMPARABLE');if(!sourceComplete)inputDiff.push('SOURCE_METRICS_INCOMPLETE');
    return {label:comparable?'SAME_INPUT_COMPARABLE':'SCENARIO_CHANGED',sameInput,comparableCurrency,comparablePeriod,comparableScope,sourceComplete,strategicObjective:envelope.strategicObjective,operationalObjective:plan.objective,inputDiff,deltas:comparable?{serviceRate:operational.serviceRate-Number(source.serviceRate),routeDistanceKm:operational.routeDistanceKm-Number(source.routeDistanceKm),totalCost:operational.totalCost-Number(source.accountingTotal),totalCarbonKg:operational.totalCarbonKg-Number(source.accountingCarbonTotal)}:null};
  }
  function statusDimensions(plan,computed){return{integrityStatus:'PASS',businessVerificationStatus:'PASS',serviceStatus:computed.assigned<computed.totalDemand?'PARTIAL':'FULL',solverStatus:plan.engine.used==='LOCAL_HEURISTIC'?'LOCAL_HEURISTIC_NOT_PROVEN':'BEST_FOUND_NOT_PROVEN',freshness:'CURRENT',capabilityCoverage:{assignment:'VERIFIED',trips:'VERIFIED',fleet:'VERIFIED',driver:'VERIFIED',dockWave:'VERIFIED',cost:'VERIFIED',carbon:'VERIFIED',simulation:'NOT_RUN'}};}
  function execute(envelope,options={}){
    const verified=Envelope.validateEnvelope(envelope);if(verified.status!=='PASS')fail('OPERATIONAL_ENVELOPE_REJECTED',{issues:verified.issues});
    const scenario=clone(envelope.operationalScenario),plan=Solver.solveNetwork(scenario,{maxOrders:500,maxTripsPerWave:8,...options.solveOptions});
    if(!['BEST_FOUND','PARTIAL'].includes(plan.status))fail(plan.reasonCode||'OPERATIONAL_PLANNING_FAILED');
    const verification=Solver.verifyNetworkPlan(scenario,plan);if(verification.status!=='PASS')fail('OPERATIONAL_NETWORK_VERIFICATION_FAILED',{issues:verification.issues});
    const accounting=Accounting.computeAccounting(scenario,plan,scenario.assumptions.accountingOptions||{}),accountingVerification=Accounting.verifyAccounting(scenario,plan,accounting);
    if(accountingVerification.status!=='PASS')fail('OPERATIONAL_ACCOUNTING_VERIFICATION_FAILED',{issues:accountingVerification.issues});
    const computed=metrics(scenario,plan,accounting);
    const reasons=(plan.trip?.unassigned||[]).map(row=>({orderId:row.orderId,reasonCode:row.reasonCode||row.reason||'UNASSIGNED',evidence:{tripStage:true}})).concat((plan.assignment?.blocked||[]).map(row=>({orderId:row.orderId,reasonCode:row.reasonCode||row.reason||'BLOCKED',evidence:{assignmentStage:true}})));
    const findings=[...reasons.map(row=>({kind:'SERVICE_CONSTRAINT',severity:'HIGH',code:row.reasonCode,entityId:row.orderId,evidence:row.evidence})),...(computed.dockConflicts?[{kind:'DOCK_CONSTRAINT',severity:'HIGH',code:'DOCK_CONFLICTS',evidence:{count:computed.dockConflicts}}]:[])];
    const value={schemaVersion:SCHEMA,resultId:`RESULT-${globalThis.crypto.randomUUID()}`,envelopeHash:envelope.envelopeHash,sourceStudyId:envelope.sourceStudyId,sourceStudyVersionId:envelope.sourceStudyVersionId,sourceScenarioId:envelope.sourceScenarioId,sourceSemanticKey:envelope.sourceSemanticKey,validationSessionId:String(options.sessionId||''),validationInputHash:envelope.validationInputHash,resourceProfileHash:envelope.resourceSnapshot.resourceProfileHash,matrixHash:envelope.facilityDemandMatrixHash,engineId:plan.engine.used,engineVersion:plan.engine.version,verifierVersions:{network:Solver.VERSION,accounting:Accounting.VERSION,result:VERSION},statusDimensions:statusDimensions(plan,computed),metrics:computed,costBreakdown:clone(accounting.cost),carbonBreakdown:clone(accounting.carbon),constraintFindings:findings,unassignedReasons:reasons,sourceToOperationalMapping:clone(envelope.mappingReport),commandPlanHashes:[plan.networkPlanHash,plan.assignment.assignmentHash,plan.trip.networkPlanHash,accounting.accountingHash].filter(Boolean),evidenceRefs:[`ENVELOPE:${envelope.envelopeHash}`,`PLAN:${plan.networkPlanHash}`,`ACCOUNTING:${accounting.accountingHash}`],comparabilityReport:comparability(envelope,plan,accounting),planEvidence:plan,networkVerification:verification,accountingVerification};
    value.resultHash=Contract.hashArtifact(projection(value));
    return Object.freeze(clone(value));
  }
  function admit(envelope,candidate,options={}){
    const value=clone(candidate),issues=[];
    if(value.schemaVersion!==SCHEMA)issues.push('OPERATIONAL_RESULT_SCHEMA_INVALID');
    if(value.resultHash!==Contract.hashArtifact(projection(value)))issues.push('OPERATIONAL_RESULT_HASH_MISMATCH');
    if(value.envelopeHash!==envelope.envelopeHash)issues.push('OPERATIONAL_RESULT_ENVELOPE_MISMATCH');
    if(value.validationInputHash!==envelope.validationInputHash||value.resourceProfileHash!==envelope.resourceSnapshot.resourceProfileHash||value.matrixHash!==envelope.facilityDemandMatrixHash)issues.push('OPERATIONAL_RESULT_CONTEXT_MISMATCH');
    if(options.sessionId&&value.validationSessionId!==options.sessionId)issues.push('OPERATIONAL_RESULT_SESSION_MISMATCH');
    const verification=Solver.verifyNetworkPlan(envelope.operationalScenario,value.planEvidence);if(verification.status!=='PASS')issues.push(...verification.issues.map(row=>`NETWORK:${row}`));
    const accounting=Accounting.computeAccounting(envelope.operationalScenario,value.planEvidence,envelope.operationalScenario.assumptions.accountingOptions||{}),accountingVerification=Accounting.verifyAccounting(envelope.operationalScenario,value.planEvidence,value.costBreakdown&&{...accounting,cost:value.costBreakdown,carbon:value.carbonBreakdown});
    if(accountingVerification.status!=='PASS'||Contract.canonicalString(accounting.cost)!==Contract.canonicalString(value.costBreakdown)||Contract.canonicalString(accounting.carbon)!==Contract.canonicalString(value.carbonBreakdown))issues.push('OPERATIONAL_RESULT_ACCOUNTING_MISMATCH');
    const expectedMetrics=metrics(envelope.operationalScenario,value.planEvidence,accounting);if(Contract.canonicalString(expectedMetrics)!==Contract.canonicalString(value.metrics))issues.push('OPERATIONAL_RESULT_METRIC_MISMATCH');
    const expectedStatus=statusDimensions(value.planEvidence,expectedMetrics);if(!same(expectedStatus,value.statusDimensions))issues.push('OPERATIONAL_RESULT_STATUS_MISMATCH');
    if(value.engineId!==value.planEvidence?.engine?.used||value.engineVersion!==value.planEvidence?.engine?.version)issues.push('OPERATIONAL_RESULT_ENGINE_MISMATCH');
    const expectedVerifiers={network:Solver.VERSION,accounting:Accounting.VERSION,result:VERSION};if(!same(expectedVerifiers,value.verifierVersions))issues.push('OPERATIONAL_RESULT_VERIFIER_MISMATCH');
    const expectedComparison=comparability(envelope,value.planEvidence,accounting);if(!same(expectedComparison,value.comparabilityReport))issues.push('OPERATIONAL_RESULT_COMPARISON_MISMATCH');
    if(issues.length)fail('OPERATIONAL_RESULT_ADMISSION_FAILED',{issues});
    const admission={schemaVersion:'stct-operational-result-admission-v1.9-p6',status:'PASS',resultHash:value.resultHash,envelopeHash:value.envelopeHash,verifiedAtGeneration:Number(options.generation||0),authorities:value.verifierVersions};
    return Object.freeze({...value,admission});
  }
  function freshness(envelope,result,currentSemanticKey){
    const reasons=[];if(result.sourceSemanticKey!==currentSemanticKey)reasons.push('SOURCE_SEMANTIC_KEY_CHANGED');if(result.envelopeHash!==envelope.envelopeHash)reasons.push('ENVELOPE_CHANGED');return{status:reasons.length?'STALE':'CURRENT',reasons};
  }
  return Object.freeze({VERSION,SCHEMA,execute,admit,metrics,comparability,statusDimensions,freshness,projection});
});
