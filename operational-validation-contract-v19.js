(function(root,factory){
  const ns=root.STCTPlatformV19=root.STCTPlatformV19||{};
  const api=factory(typeof module==='object'&&module.exports?{Contract:require('./network-contract-v18.js'),Assignment:require('./depot-assignment-v18.js'),Solver:require('./network-solver-v18.js'),Accounting:require('./network-accounting-v18.js')}:{Contract:root.STCTV18?.networkContract,Assignment:root.STCTV18?.depotAssignment,Solver:root.STCTV18?.networkSolver,Accounting:root.STCTV18?.networkAccounting});
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root.document)ns.operationalValidationContract=api;
})(globalThis,function({Contract,Assignment,Solver,Accounting}){
  const VERSION='stct-operational-validation-contract-v1.9-p6';
  const ENVELOPE_SCHEMA='stct-operational-scenario-envelope-v1.9-p6';
  const clone=value=>structuredClone(value);
  const fail=(code,detail={})=>{throw Object.assign(new Error(code),{code,detail});};
  const finite=value=>Number.isFinite(Number(value));
  const same=(left,right)=>Contract.canonicalString(left)===Contract.canonicalString(right);
  const hashProjection=(value,key)=>{const copy=clone(value);delete copy[key];return copy;};
  function uuid(){return globalThis.crypto?.randomUUID?.()||`LOCAL-${Date.now()}-${Math.random().toString(16).slice(2)}`;}
  function buildMatrix(scenario){
    const factor=Math.max(1,Number(scenario.assumptions?.syntheticRoadFactor||1));
    const speed=Math.max(1,Number(scenario.assumptions?.averageSpeedKph||32));
    const rows=[];
    for(const depot of scenario.depots)for(const order of scenario.orders){
      const distanceMeters=Math.round(Assignment.haversineKm(depot.coordinate,order.coordinate)*factor*1000);
      rows.push({fromId:depot.depotId,toId:order.orderId,direction:'FACILITY_TO_DEMAND',distanceMeters,travelSeconds:Math.max(60,Math.ceil(distanceMeters/1000/speed*3600)),unreachable:false});
    }
    const snapshot={schemaVersion:'stct-facility-demand-matrix-v1.9-p6',mode:'ESTIMATED_HAVERSINE',providerId:scenario.routingContext.providerId,providerVersion:scenario.routingContext.providerVersion,matrixVersion:scenario.routingContext.matrixVersion,distanceUnit:'m',durationUnit:'s',factor,speedKph:speed,rows};
    snapshot.matrixHash=Contract.hashArtifact(hashProjection(snapshot,'matrixHash'));
    return snapshot;
  }
  function portfolio(scenario,sourceVersionId){
    const value={portfolioKind:'EXISTING_NETWORK_VARIANT',sourceVersionId,facilities:scenario.depots.map(row=>({depotId:row.depotId,role:row.role,capacity:clone(row.capacity),capabilities:clone(row.capabilities),serviceZoneIds:clone(row.serviceZoneIds),dockIds:clone(row.dockIds)})).sort((a,b)=>Contract.utf8Compare(a.depotId,b.depotId)),assignmentPolicies:{zones:clone(scenario.zones),constraints:clone(scenario.constraints)}};
    return {...value,facilityPortfolioHash:Contract.hashArtifact(value)};
  }
  function explicitDateSlice(scenario,options){
    if(options.sliceStrategy&&options.sliceStrategy!=='EXACT_SERVICE_DATE')fail('OPERATIONAL_SLICE_STRATEGY_UNSUPPORTED',{strategy:options.sliceStrategy});
    const validDate=value=>{const text=String(value||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return false;const [year,month,day]=text.split('-').map(Number),parsed=new Date(Date.UTC(year,month-1,day));return parsed.getUTCFullYear()===year&&parsed.getUTCMonth()===month-1&&parsed.getUTCDate()===day;};
    const date=String(options.operationalDate||'');if(!validDate(date))fail('OPERATIONAL_DATE_REQUIRED');
    const dateValue=row=>String(row.serviceDate||(/^\d{4}-/.test(String(row.serviceDay||''))?row.serviceDay:'')||'');
    const declared=scenario.orders.filter(row=>dateValue(row));
    const invalid=declared.filter(row=>!validDate(dateValue(row)));if(invalid.length)fail('OPERATIONAL_SOURCE_DATE_INVALID',{orderIds:invalid.map(row=>row.orderId)});
    const dated=declared;
    let orders,assumption=false;
    if(dated.length){
      if(dated.length!==scenario.orders.length&&options.mixedDateStrategy!=='EXCLUDE_UNDATED')fail('OPERATIONAL_MIXED_DATE_POLICY_REQUIRED');
      orders=scenario.orders.filter(row=>dateValue(row)===date);
    }
    else{if(options.confirmDateAssumption!==true)fail('OPERATIONAL_DATE_ASSUMPTION_CONFIRMATION_REQUIRED');orders=scenario.orders;assumption=true;}
    if(!orders.length)fail('OPERATIONAL_DATE_SLICE_EMPTY',{date});
    return {schemaVersion:'stct-operational-slice-v1.9-p6',strategy:'EXACT_SERVICE_DATE',operationalDate:date,dateAssumptionConfirmed:assumption,retainedOrderIds:orders.map(row=>row.orderId),omittedOrderIds:scenario.orders.filter(row=>!orders.includes(row)).map(row=>row.orderId),sourceOrderCount:scenario.orders.length,retainedOrderCount:orders.length,sliceHash:Contract.hashArtifact({strategy:'EXACT_SERVICE_DATE',date,assumption,retainedOrderIds:orders.map(row=>row.orderId)})};
  }
  function resourceSnapshot(scenario,overrides={}){
    const vehicleLimit=overrides.vehicleLimit===undefined?scenario.vehicles.length:Number(overrides.vehicleLimit);
    if(!Number.isInteger(vehicleLimit)||vehicleLimit<1||vehicleLimit>scenario.vehicles.length)fail('OPERATIONAL_VEHICLE_LIMIT_INVALID');
    const dockCapacityMultiplier=overrides.dockCapacityMultiplier===undefined?1:Number(overrides.dockCapacityMultiplier);
    if(!finite(dockCapacityMultiplier)||dockCapacityMultiplier<=0||dockCapacityMultiplier>1)fail('OPERATIONAL_DOCK_CAPACITY_FACTOR_INVALID');
    const vehicles=scenario.vehicles.slice(0,vehicleLimit),vehicleIds=new Set(vehicles.map(row=>row.vehicleId));
    const drivers=vehicleLimit===scenario.vehicles.length?scenario.drivers:scenario.drivers.filter((_row,index)=>index<Math.max(vehicleLimit,1));
    const docks=scenario.docks.map(row=>({...clone(row),simultaneousCapacity:Math.max(1,Math.floor(Number(row.simultaneousCapacity||1)*dockCapacityMultiplier))}));
    const value={schemaVersion:'stct-operational-resource-snapshot-v1.9-p6',vehicles:clone(vehicles),vehicleTypes:clone(scenario.vehicleTypes),drivers:clone(drivers),docks,overridePolicy:{vehicleLimit,dockCapacityMultiplier},sourceCounts:{vehicles:scenario.vehicles.length,drivers:scenario.drivers.length,docks:scenario.docks.length}};
    value.resourceProfileHash=Contract.hashArtifact(hashProjection(value,'resourceProfileHash'));
    return value;
  }
  function validateSource(input){
    const snapshot=input.studySnapshot,pointer=input.studyPointer,dataset=input.datasetRecord;
    if(!snapshot||!pointer||!dataset)fail('OPERATIONAL_SOURCE_SAVED_VERSION_REQUIRED');
    if(pointer.scope!=='DESIGN'||pointer.studyId!==snapshot.studyId||pointer.scenarioId!==snapshot.activeScenarioId)fail('OPERATIONAL_SOURCE_POINTER_MISMATCH');
    const active=snapshot.activeRecord||snapshot.history?.find?.(row=>row.scenarioId===snapshot.activeScenarioId)||snapshot.history?.records?.find(row=>row.scenarioId===snapshot.activeScenarioId);
    const evaluation=snapshot.evaluation;
    if(!active||!evaluation||evaluation.verification?.status!=='PASS'||evaluation.accountingVerification?.status!=='PASS'||evaluation.networkInputHash!==active.inputHash)fail('OPERATIONAL_SOURCE_PORTFOLIO_UNVERIFIED');
    if(pointer.inputHash!==active.inputHash||dataset.id!==snapshot.dataSource.sourceRef)fail('OPERATIONAL_SOURCE_STALE');
    return {snapshot,pointer,dataset,active,evaluation};
  }
  function preflight(input,options={}){
    const issues=[];let source;
    try{source=validateSource(input);}catch(error){issues.push({code:error.code,blocking:true,detail:error.detail});return{schemaVersion:'stct-operational-preflight-v1.9-p6',status:'BLOCKED',issues};}
    const scenario=Contract.normalizeScenario(source.active.scenario);
    for(const [kind,rows] of Object.entries({depots:scenario.depots,orders:scenario.orders,vehicles:scenario.vehicles,vehicleTypes:scenario.vehicleTypes,drivers:scenario.drivers,docks:scenario.docks}))if(!rows.length)issues.push({code:`OPERATIONAL_${kind.toUpperCase()}_MISSING`,blocking:true});
    if(!['SYNTHETIC_ROAD_FIXTURE','ESTIMATED_HAVERSINE','LOCAL_CONFIGURED_PROVIDER'].includes(scenario.routingContext.providerId))issues.push({code:'OPERATIONAL_ROUTING_MODE_UNSUPPORTED',blocking:true,providerId:scenario.routingContext.providerId});
    let slice=null,resources=null;
    try{slice=explicitDateSlice(scenario,options);}catch(error){issues.push({code:error.code,blocking:true,detail:error.detail});}
    try{resources=resourceSnapshot(scenario,options.resourceOverrides);}catch(error){issues.push({code:error.code,blocking:true,detail:error.detail});}
    return {schemaVersion:'stct-operational-preflight-v1.9-p6',status:issues.some(row=>row.blocking)?'BLOCKED':'PASS',issues,source:{studyId:source.snapshot.studyId,studyVersionId:source.pointer.refs?.find(row=>row.store==='studyVersions')?.id||'',scenarioId:source.active.scenarioId,datasetVersionIds:[source.dataset.id],sourceType:source.snapshot.dataSource.sourceType,dataClassification:source.snapshot.dataSource.dataClassification},counts:{facilities:scenario.depots.length,demand:scenario.orders.length,vehicles:scenario.vehicles.length,drivers:scenario.drivers.length,docks:scenario.docks.length,waves:scenario.waves.length},units:clone(scenario.assumptions.units),cost:{period:scenario.assumptions.costPeriod||'MODEL_RUN',currency:scenario.assumptions.currency||scenario.assumptions.accountingOptions?.currency||'UNSPECIFIED'},routing:clone(scenario.routingContext),operationalSlice:slice,resourceSnapshot:resources,commandIsolation:{activePlanMutation:false,runMutation:false,executionEventMutation:false,pendingAckMutation:false}};
  }
  function createEnvelope(input,options={}){
    const source=validateSource(input),check=preflight(input,options);if(check.status!=='PASS')fail('OPERATIONAL_PREFLIGHT_BLOCKED',{issues:check.issues});
    const sourceScenario=Contract.normalizeScenario(source.active.scenario),selected=new Set(check.operationalSlice.retainedOrderIds);
    const operationalScenario=clone(sourceScenario);
    if(selected.size!==sourceScenario.orders.length)operationalScenario.orders=operationalScenario.orders.filter(row=>selected.has(row.orderId));
    const resourceChanged=check.resourceSnapshot.overridePolicy.vehicleLimit!==sourceScenario.vehicles.length||check.resourceSnapshot.overridePolicy.dockCapacityMultiplier!==1;
    if(resourceChanged){
      operationalScenario.vehicles=clone(check.resourceSnapshot.vehicles);operationalScenario.drivers=clone(check.resourceSnapshot.drivers);operationalScenario.docks=clone(check.resourceSnapshot.docks);
      const vehicleIds=new Set(operationalScenario.vehicles.map(row=>row.vehicleId)),driverIds=new Set(operationalScenario.drivers.map(row=>row.driverId)),dockIds=new Set(operationalScenario.docks.map(row=>row.dockId));
      operationalScenario.depots=operationalScenario.depots.map(row=>({...row,startVehicleIds:row.startVehicleIds.filter(id=>vehicleIds.has(id)),dockIds:row.dockIds.filter(id=>dockIds.has(id))}));
      operationalScenario.constraints={...operationalScenario.constraints};
      if(operationalScenario.constraints.fixedDriverVehiclePairs)operationalScenario.constraints.fixedDriverVehiclePairs=operationalScenario.constraints.fixedDriverVehiclePairs.filter(row=>vehicleIds.has(row.vehicleId)&&driverIds.has(row.driverId));
      if(operationalScenario.constraints.vehicleMaintenanceWindows)operationalScenario.constraints.vehicleMaintenanceWindows=operationalScenario.constraints.vehicleMaintenanceWindows.filter(row=>vehicleIds.has(row.vehicleId));
    }
    const normalized=Contract.normalizeScenario(operationalScenario),matrix=buildMatrix(normalized),networkPortfolio=portfolio(normalized,source.dataset.id);
    const assignments=source.evaluation.plan.assignment.assignments.filter(row=>selected.has(row.orderId)).map(row=>({orderId:row.orderId,assignedDepotId:row.assignedDepotId,disposition:'ASSIGNED',source:'VERIFIED_DESIGN_EVALUATION'}))
      .concat((source.evaluation.plan.assignment.unassigned||[]).filter(row=>selected.has(row.orderId)).map(row=>({orderId:row.orderId,assignedDepotId:null,disposition:'UNASSIGNED',reasonCode:row.reasonCode||row.reason,source:'VERIFIED_DESIGN_EVALUATION'})))
      .concat((source.evaluation.plan.assignment.blocked||[]).filter(row=>selected.has(row.orderId)).map(row=>({orderId:row.orderId,assignedDepotId:null,disposition:'BLOCKED',reasonCode:row.reasonCode||row.reason,source:'VERIFIED_DESIGN_EVALUATION'})));
    const sourceDesignMetrics={...clone(source.evaluation.plan.metrics),accountingTotal:source.evaluation.accounting.cost.total,accountingCurrency:source.evaluation.accounting.cost.currency,accountingCarbonTotal:source.evaluation.accounting.carbon.totalKg,costPeriod:check.cost.period,scope:'EXISTING_NETWORK_VARIANT'};
    const sourceSemantic={studyId:source.snapshot.studyId,studyVersionId:check.source.studyVersionId,scenarioId:source.active.scenarioId,datasetVersionIds:[source.dataset.id],inputHash:source.active.inputHash,evaluationArtifactHash:source.evaluation.artifactHash,facilityPortfolioHash:networkPortfolio.facilityPortfolioHash,facilityDemandMatrixHash:matrix.matrixHash,resourceProfileHash:check.resourceSnapshot.resourceProfileHash,operationalSliceHash:check.operationalSlice.sliceHash,costContext:sourceScenario.assumptions.accountingOptions||{},servicePolicies:sourceScenario.policies,sourceDesignMetrics,versions:{contract:Contract.VERSION,solver:Solver.VERSION,accounting:Accounting.VERSION,bridge:VERSION}};
    const envelope={schemaVersion:ENVELOPE_SCHEMA,bridgeId:`BRIDGE-${uuid()}`,envelopeId:`ENVELOPE-${uuid()}`,sourceWorkspace:'DESIGN',targetWorkspace:'COMMAND',sourceStudyId:source.snapshot.studyId,sourceStudyVersionId:check.source.studyVersionId,sourceScenarioId:source.active.scenarioId,sourceDatasetVersionIds:[source.dataset.id],sourceStudyInputHash:source.active.inputHash,sourceSemanticKey:Contract.hashArtifact(sourceSemantic),sourceEvaluationArtifactHash:source.evaluation.artifactHash,portfolioKind:'EXISTING_NETWORK_VARIANT',facilityPortfolioHash:networkPortfolio.facilityPortfolioHash,facilityDemandMatrixHash:matrix.matrixHash,sourceRoutingContextHash:Contract.identityBundle(sourceScenario).routingContextHash,selectedFacilities:networkPortfolio.facilities,demandAssignments:assignments,facilityCapacities:networkPortfolio.facilities.map(row=>({depotId:row.depotId,capacity:row.capacity})),operationalSlice:check.operationalSlice,operationalScenario:normalized,resourceSnapshot:check.resourceSnapshot,routingSnapshot:matrix,costSnapshot:{period:check.cost.period,currency:check.cost.currency,accountingOptions:clone(sourceScenario.assumptions.accountingOptions||{}),preparedCostContext:clone(sourceScenario.assumptions.preparedCostContext||null)},servicePolicies:clone(sourceScenario.policies),operationalAssumptions:{date:check.operationalSlice.operationalDate,sliceStrategy:'EXACT_SERVICE_DATE',dateAssumptionConfirmed:check.operationalSlice.dateAssumptionConfirmed,resourceOverrides:clone(check.resourceSnapshot.overridePolicy),matrixMode:matrix.mode,publicRequests:0},mappingReport:{sourceOrders:check.operationalSlice.sourceOrderCount,retainedOrders:check.operationalSlice.retainedOrderCount,omittedOrderIds:check.operationalSlice.omittedOrderIds,assignmentCoverage:assignments.length},sourceDesignMetrics,strategicObjective:source.evaluation.plan.objective,networkPortfolio};
    envelope.validationInputHash=Contract.identityBundle(normalized).networkInputHash;
    envelope.envelopeHash=Contract.hashArtifact(hashProjection(envelope,'envelopeHash'));
    return Object.freeze(clone(envelope));
  }
  function createFacilityEnvelope(input,options={}){
    const adapter=input?.adapter,saved=input?.savedPointer;
    if(!adapter||adapter.adapterHash!==Contract.hashArtifact(hashProjection(adapter,'adapterHash')))fail('FACILITY_OPERATIONAL_ADAPTER_INVALID');
    if(!saved||saved.type!=='FACILITY_STUDY'||saved.verification!=='PASS')fail('FACILITY_OPERATIONAL_SAVED_VERIFIED_SOURCE_REQUIRED');
    const sourceScenario=Contract.normalizeScenario(adapter.operationalScenario),slice=explicitDateSlice(sourceScenario,options),selected=new Set(slice.retainedOrderIds),operationalScenario=clone(sourceScenario);
    if(selected.size!==sourceScenario.orders.length)operationalScenario.orders=operationalScenario.orders.filter(row=>selected.has(row.orderId));
    const resources=resourceSnapshot(operationalScenario,options.resourceOverrides||{}),resourceChanged=resources.overridePolicy.vehicleLimit!==operationalScenario.vehicles.length||resources.overridePolicy.dockCapacityMultiplier!==1;
    if(resourceChanged){operationalScenario.vehicles=clone(resources.vehicles);operationalScenario.drivers=clone(resources.drivers);operationalScenario.docks=clone(resources.docks);const vehicleIds=new Set(operationalScenario.vehicles.map(row=>row.vehicleId)),dockIds=new Set(operationalScenario.docks.map(row=>row.dockId));operationalScenario.depots=operationalScenario.depots.map(row=>({...row,startVehicleIds:row.startVehicleIds.filter(id=>vehicleIds.has(id)),dockIds:row.dockIds.filter(id=>dockIds.has(id))}));}
    const normalized=Contract.normalizeScenario(operationalScenario),matrix=buildMatrix(normalized),portfolioHash=adapter.portfolio.portfolioHash;
    const assignments=adapter.portfolio.assignments.filter(row=>selected.has(row.demandId)).map(row=>({orderId:row.demandId,assignedDepotId:row.siteId,disposition:'ASSIGNED',source:'FACILITY_MVP1_VERIFIED_PORTFOLIO'}));
    const selectedFacilities=normalized.depots.map(row=>({depotId:row.depotId,role:row.role,capacity:clone(row.capacity),capabilities:clone(row.capabilities),serviceZoneIds:clone(row.serviceZoneIds),dockIds:clone(row.dockIds)})).sort((a,b)=>Contract.utf8Compare(a.depotId,b.depotId));
    const networkPortfolio={portfolioKind:'FACILITY_PORTFOLIO_MVP1',sourceVersionId:adapter.study.studyHash,facilities:selectedFacilities,strategicPortfolioHash:portfolioHash,strategicMatrixHash:adapter.strategicMatrix.matrixHash,assignmentPolicies:{verifiedFacilityAssignments:true}};networkPortfolio.networkPortfolioHash=Contract.hashArtifact(networkPortfolio);
    const sourceDesignMetrics={serviceRate:1,routeDistanceKm:adapter.portfolio.assignments.reduce((sum,row)=>sum+Number(row.distanceMeters||0),0)/1000,accountingTotal:adapter.portfolio.cost.total,accountingCurrency:adapter.portfolio.cost.currency,accountingCarbonTotal:null,costPeriod:adapter.portfolio.cost.period,scope:'FACILITY_STRATEGIC_ASSIGNMENT'};
    const sourceSemantic={studyId:adapter.study.studyId,studyVersionId:saved.id,scenarioId:adapter.portfolio.portfolioHash,datasetVersionIds:adapter.study.sourceRefs||[],inputHash:adapter.study.studyHash,evaluationArtifactHash:adapter.portfolio.portfolioHash,facilityPortfolioHash:portfolioHash,facilityDemandMatrixHash:matrix.matrixHash,strategicFacilityMatrixHash:adapter.strategicMatrix.matrixHash,resourceProfileHash:resources.resourceProfileHash,operationalSliceHash:slice.sliceHash,costContext:adapter.portfolio.cost,servicePolicies:normalized.policies,sourceDesignMetrics,versions:{contract:Contract.VERSION,solver:Solver.VERSION,accounting:Accounting.VERSION,bridge:VERSION}};
    const envelope={schemaVersion:ENVELOPE_SCHEMA,bridgeId:`BRIDGE-${uuid()}`,envelopeId:`ENVELOPE-${uuid()}`,sourceWorkspace:'DESIGN',targetWorkspace:'COMMAND',sourceStudyId:adapter.study.studyId,sourceStudyVersionId:saved.id,sourceScenarioId:adapter.portfolio.portfolioHash,sourceDatasetVersionIds:clone(adapter.study.sourceRefs||[]),sourceStudyInputHash:adapter.study.studyHash,sourceSemanticKey:Contract.hashArtifact(sourceSemantic),sourceEvaluationArtifactHash:adapter.portfolio.portfolioHash,portfolioKind:'FACILITY_PORTFOLIO_MVP1',facilityPortfolioHash:portfolioHash,facilityDemandMatrixHash:matrix.matrixHash,strategicFacilityMatrixHash:adapter.strategicMatrix.matrixHash,sourceRoutingContextHash:Contract.identityBundle(sourceScenario).routingContextHash,selectedFacilities,demandAssignments:assignments,facilityCapacities:selectedFacilities.map(row=>({depotId:row.depotId,capacity:row.capacity})),operationalSlice:slice,operationalScenario:normalized,resourceSnapshot:resources,routingSnapshot:matrix,costSnapshot:{period:adapter.portfolio.cost.period,currency:adapter.portfolio.cost.currency,strategicFacilityCost:clone(adapter.portfolio.cost),accountingOptions:clone(normalized.assumptions.accountingOptions||{})},servicePolicies:clone(normalized.policies),operationalAssumptions:{date:slice.operationalDate,sliceStrategy:'EXACT_SERVICE_DATE',dateAssumptionConfirmed:slice.dateAssumptionConfirmed,resourceOverrides:clone(resources.overridePolicy),matrixMode:matrix.mode,publicRequests:0,strategicMatrixRole:adapter.strategicMatrix.role,operationalMatrixRole:'OPERATIONAL_ESTIMATE_REBUILT'},mappingReport:{sourceOrders:slice.sourceOrderCount,retainedOrders:slice.retainedOrderCount,omittedOrderIds:slice.omittedOrderIds,assignmentCoverage:assignments.length},sourceDesignMetrics,strategicObjective:'MINIMIZE_FIXED_HANDLING_TRANSPORT_COST',networkPortfolio,facilityReconciliation:clone(adapter.reconciliation)};
    envelope.validationInputHash=Contract.identityBundle(normalized).networkInputHash;envelope.envelopeHash=Contract.hashArtifact(hashProjection(envelope,'envelopeHash'));return Object.freeze(clone(envelope));
  }
  function validateEnvelope(value){
    const issues=[];const add=code=>issues.push(code);
    if(value?.schemaVersion!==ENVELOPE_SCHEMA)add('OPERATIONAL_ENVELOPE_SCHEMA_INVALID');
    if(value?.sourceWorkspace!=='DESIGN')add('OPERATIONAL_SOURCE_WORKSPACE_INVALID');if(value?.targetWorkspace!=='COMMAND')add('OPERATIONAL_TARGET_WORKSPACE_INVALID');
    for(const key of ['envelopeId','bridgeId','sourceStudyId','sourceStudyVersionId','sourceScenarioId','sourceStudyInputHash','sourceSemanticKey','sourceEvaluationArtifactHash','facilityPortfolioHash','facilityDemandMatrixHash','sourceRoutingContextHash','validationInputHash'])if(!value?.[key])add(`OPERATIONAL_${key.toUpperCase()}_REQUIRED`);
    if(!['EXISTING_NETWORK_VARIANT','FACILITY_PORTFOLIO_MVP1'].includes(value?.portfolioKind))add('OPERATIONAL_PORTFOLIO_KIND_UNSUPPORTED');
    if(!value?.selectedFacilities?.length||!value?.demandAssignments?.length||!value?.facilityCapacities?.length)add('OPERATIONAL_ENVELOPE_BUSINESS_INPUT_MISSING');
    if(value?.envelopeHash!==Contract.hashArtifact(hashProjection(value,'envelopeHash')))add('OPERATIONAL_ENVELOPE_HASH_MISMATCH');
    if(value?.facilityDemandMatrixHash!==value?.routingSnapshot?.matrixHash||value?.routingSnapshot?.matrixHash!==Contract.hashArtifact(hashProjection(value.routingSnapshot,'matrixHash')))add('OPERATIONAL_MATRIX_HASH_MISMATCH');
    if(value?.portfolioKind==='EXISTING_NETWORK_VARIANT'&&(value?.facilityPortfolioHash!==value?.networkPortfolio?.facilityPortfolioHash||value?.networkPortfolio?.facilityPortfolioHash!==Contract.hashArtifact(hashProjection(value.networkPortfolio,'facilityPortfolioHash'))))add('OPERATIONAL_PORTFOLIO_HASH_MISMATCH');
    if(value?.validationInputHash!==Contract.identityBundle(value?.operationalScenario||{}).networkInputHash)add('OPERATIONAL_INPUT_HASH_MISMATCH');
    if(value?.resourceSnapshot?.resourceProfileHash!==Contract.hashArtifact(hashProjection(value.resourceSnapshot,'resourceProfileHash')))add('OPERATIONAL_RESOURCE_HASH_MISMATCH');
    const scenario=value?.operationalScenario;
    if(scenario){
      const resource=value.resourceSnapshot||{};
      if(!same(resource.vehicles,scenario.vehicles)||!same(resource.vehicleTypes,scenario.vehicleTypes)||!same(resource.drivers,scenario.drivers)||!same(resource.docks,scenario.docks))add('OPERATIONAL_RESOURCE_SCENARIO_MISMATCH');
      const expectedMatrix=buildMatrix(scenario);if(!same(hashProjection(value.routingSnapshot||{},'matrixHash'),hashProjection(expectedMatrix,'matrixHash')))add('OPERATIONAL_MATRIX_SEMANTIC_MISMATCH');
      if(!same(value.servicePolicies,scenario.policies))add('OPERATIONAL_SERVICE_POLICY_MISMATCH');
      if(value.portfolioKind==='EXISTING_NETWORK_VARIANT'){
        const expectedPortfolio=portfolio(scenario,value.sourceDatasetVersionIds?.[0]);
        if(!same(value.networkPortfolio,expectedPortfolio)||!same(value.selectedFacilities,expectedPortfolio.facilities))add('OPERATIONAL_PORTFOLIO_SEMANTIC_MISMATCH');
        const expectedSemantic={studyId:value.sourceStudyId,studyVersionId:value.sourceStudyVersionId,scenarioId:value.sourceScenarioId,datasetVersionIds:value.sourceDatasetVersionIds,inputHash:value.sourceStudyInputHash,evaluationArtifactHash:value.sourceEvaluationArtifactHash,facilityPortfolioHash:value.facilityPortfolioHash,facilityDemandMatrixHash:value.facilityDemandMatrixHash,resourceProfileHash:value.resourceSnapshot?.resourceProfileHash,operationalSliceHash:value.operationalSlice?.sliceHash,costContext:scenario.assumptions?.accountingOptions||{},servicePolicies:scenario.policies,sourceDesignMetrics:value.sourceDesignMetrics,versions:{contract:Contract.VERSION,solver:Solver.VERSION,accounting:Accounting.VERSION,bridge:VERSION}};
        if(value.sourceSemanticKey!==Contract.hashArtifact(expectedSemantic))add('OPERATIONAL_SOURCE_SEMANTIC_MISMATCH');
      }else if(value.portfolioKind==='FACILITY_PORTFOLIO_MVP1'){
        const expectedFacilities=scenario.depots.map(row=>({depotId:row.depotId,role:row.role,capacity:clone(row.capacity),capabilities:clone(row.capabilities),serviceZoneIds:clone(row.serviceZoneIds),dockIds:clone(row.dockIds)})).sort((a,b)=>Contract.utf8Compare(a.depotId,b.depotId));
        if(!same(value.selectedFacilities,expectedFacilities)||value.networkPortfolio?.strategicPortfolioHash!==value.facilityPortfolioHash||value.networkPortfolio?.strategicMatrixHash!==value.strategicFacilityMatrixHash) add('OPERATIONAL_FACILITY_PORTFOLIO_SEMANTIC_MISMATCH');
        const expectedNetwork={portfolioKind:'FACILITY_PORTFOLIO_MVP1',sourceVersionId:value.sourceStudyInputHash,facilities:expectedFacilities,strategicPortfolioHash:value.facilityPortfolioHash,strategicMatrixHash:value.strategicFacilityMatrixHash,assignmentPolicies:{verifiedFacilityAssignments:true}};expectedNetwork.networkPortfolioHash=Contract.hashArtifact(expectedNetwork);if(!same(value.networkPortfolio,expectedNetwork))add('OPERATIONAL_FACILITY_NETWORK_PORTFOLIO_MISMATCH');
        const expectedSemantic={studyId:value.sourceStudyId,studyVersionId:value.sourceStudyVersionId,scenarioId:value.sourceScenarioId,datasetVersionIds:value.sourceDatasetVersionIds,inputHash:value.sourceStudyInputHash,evaluationArtifactHash:value.sourceEvaluationArtifactHash,facilityPortfolioHash:value.facilityPortfolioHash,facilityDemandMatrixHash:value.facilityDemandMatrixHash,strategicFacilityMatrixHash:value.strategicFacilityMatrixHash,resourceProfileHash:value.resourceSnapshot?.resourceProfileHash,operationalSliceHash:value.operationalSlice?.sliceHash,costContext:value.costSnapshot?.strategicFacilityCost,servicePolicies:scenario.policies,sourceDesignMetrics:value.sourceDesignMetrics,versions:{contract:Contract.VERSION,solver:Solver.VERSION,accounting:Accounting.VERSION,bridge:VERSION}};if(value.sourceSemanticKey!==Contract.hashArtifact(expectedSemantic))add('OPERATIONAL_SOURCE_SEMANTIC_MISMATCH');
      }
    }
    const assigned=new Set((value?.demandAssignments||[]).map(row=>row.orderId));if(assigned.size!==(value?.demandAssignments||[]).length||assigned.size!==(value?.operationalScenario?.orders||[]).length||[...assigned].some(id=>!value.operationalScenario.orders.some(row=>row.orderId===id)))add('OPERATIONAL_DEMAND_ASSIGNMENT_CONSERVATION_FAILED');
    return {schemaVersion:'stct-operational-envelope-verification-v1.9-p6',status:issues.length?'FAIL':'PASS',issues,authority:VERSION};
  }
  function semanticKey(value){return Contract.hashArtifact(value);}
  return Object.freeze({VERSION,ENVELOPE_SCHEMA,preflight,createEnvelope,createFacilityEnvelope,validateEnvelope,buildMatrix,portfolio,resourceSnapshot,semanticKey,hashProjection});
});
