(function(root,factory){
  const ns=root.STCTPlatformV19=root.STCTPlatformV19||{};
  const api=factory(typeof module==='object'&&module.exports?{Contract:require('./network-contract-v18.js'),Facility:require('./facility-location-mvp1-v19.js')}:{Contract:root.STCTV18?.networkContract,Facility:ns.facilityLocationMvp1});
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root.document)ns.facilityPortfolioAdapter=api;
})(globalThis,function({Contract,Facility}){
  const VERSION='stct-facility-portfolio-adapter-v1.9-mvp1';
  const clone=value=>structuredClone(value);
  const fail=(code,detail={})=>{throw Object.assign(new Error(code),{code,detail});};
  function unique(rows,key){const ids=rows.map(row=>row[key]);if(new Set(ids).size!==ids.length)fail('FACILITY_OPERATIONAL_RESOURCE_DUPLICATE',{key});return rows;}
  function toOperationalScenario(input){
    const study=Facility.normalizeStudy(input.study),matrix=Facility.buildMatrix(study),result=input.portfolio,base=Contract.normalizeScenario(input.baseScenario);
    if(input.verification?.status!=='PASS')fail('FACILITY_PORTFOLIO_NOT_VERIFIED');
    if(matrix.mode!=='ESTIMATED_GEODESIC')fail('FACILITY_OPERATIONAL_ROUTING_CONTEXT_UNSUPPORTED',{matrixMode:matrix.mode,reason:'FACILITY_DEMAND_MATRIX_IS_NOT_A_COMPLETE_OPERATIONAL_ROAD_MATRIX'});
    if(!['OPTIMAL','FEASIBLE'].includes(result?.status))fail('FACILITY_PORTFOLIO_NOT_FEASIBLE');
    const selected=new Set(result.selectedSiteIds),sites=study.sites.filter(row=>selected.has(row.siteId));
    if(sites.length!==selected.size)fail('FACILITY_SELECTED_SITE_MISSING');
    if(sites.some(row=>!row.operationalTemplate))fail('FACILITY_OPERATIONAL_RESOURCE_PROFILE_REQUIRED');
    const assignments=new Map(result.assignments.map(row=>[row.demandId,row.siteId]));
    const sourceOrders=new Map(base.orders.map(row=>[row.orderId,row]));
    const orders=study.demands.map(demand=>{const source=sourceOrders.get(demand.sourceOrderId),siteId=assignments.get(demand.demandId);if(!source||!selected.has(siteId))fail('FACILITY_OPERATIONAL_DEMAND_LINEAGE_INVALID',{demandId:demand.demandId});return{...clone(source),orderId:demand.demandId,coordinate:clone(demand.coordinate),demand:clone(demand.demand),allowedDepotIds:[siteId],fixedDepotId:siteId,preferredDepotId:siteId,preferredDepotException:false,forbiddenDepotIds:[],zoneId:`FACILITY-ZONE-${siteId}`};});
    const depots=sites.map(site=>{const source=clone(site.operationalTemplate.depot);return{...source,depotId:site.siteId,name:site.name,coordinate:clone(site.coordinate),capacity:{...clone(source.capacity),dailyOrders:site.capacity.quantity,weight:site.capacity.weight,volume:site.capacity.volume},dockIds:(site.operationalTemplate.docks||[]).map(row=>row.dockId),startVehicleIds:(site.operationalTemplate.vehicles||[]).map(row=>row.vehicleId),serviceZoneIds:[`FACILITY-ZONE-${site.siteId}`]};});
    const docks=unique(sites.flatMap(site=>(site.operationalTemplate.docks||[]).map(row=>({...clone(row),depotId:site.siteId}))),'dockId');
    const vehicles=unique(sites.flatMap(site=>(site.operationalTemplate.vehicles||[]).map(row=>({...clone(row),homeDepotId:site.siteId,allowedStartDepotIds:[site.siteId],allowedEndDepotIds:[site.siteId],reloadCompatibility:[site.siteId]}))),'vehicleId');
    const drivers=unique(sites.flatMap(site=>(site.operationalTemplate.drivers||[]).map(row=>({...clone(row),homeDepotId:site.siteId}))),'driverId');
    if(!vehicles.length||!drivers.length||!docks.length)fail('FACILITY_OPERATIONAL_RESOURCE_PROFILE_EMPTY');
    const zones=sites.map(site=>({zoneId:`FACILITY-ZONE-${site.siteId}`,mode:'HARD',depotIds:[site.siteId],geometry:{type:'FixtureCircle',center:clone(site.coordinate),radiusKm:1000}}));
    const scenario={...clone(base),networkId:`${base.networkId}-FACILITY-${result.facilityCount}-${result.rank}`,displayLabel:`${study.name} · P${result.facilityCount} · rank ${result.rank}`,depots,docks,zones,orders,vehicles,drivers,waves:[],trips:[],routes:[],dockReservations:[],constraints:{...clone(base.constraints),fixedDriverVehiclePairs:(base.constraints.fixedDriverVehiclePairs||[]).filter(row=>vehicles.some(vehicle=>vehicle.vehicleId===row.vehicleId)&&drivers.some(driver=>driver.driverId===row.driverId))},assumptions:{...clone(base.assumptions),facilityPortfolioHash:result.portfolioHash,facilityStudyHash:study.studyHash,facilityMatrixRole:matrix.role,facilityMatrixHash:matrix.matrixHash,facilityCostPeriod:study.options.costPeriod,facilityCostCurrency:study.options.currency,strategicFacilityCost:result.cost,operationalRoutingRebuilt:true},routingContext:{...clone(base.routingContext),providerId:'ESTIMATED_HAVERSINE',providerVersion:VERSION,matrixVersion:result.portfolioHash,closures:[]}};
    const normalized=Contract.normalizeScenario(scenario),value={schemaVersion:VERSION,study,strategicMatrix:matrix,portfolio:clone(result),operationalScenario:normalized,reconciliation:{strategicCost:clone(result.cost),operationalCost:null,status:'PENDING_OPERATIONAL_VALIDATION',rule:'STRATEGIC_FACILITY_COST_AND_OPERATIONAL_ROUTE_COST_REMAIN_SEPARATE'},publicRequests:0};value.adapterHash=Contract.hashArtifact(value);return Object.freeze(clone(value));
  }
  return Object.freeze({VERSION,toOperationalScenario});
});
