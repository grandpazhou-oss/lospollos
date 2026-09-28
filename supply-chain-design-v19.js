(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./network-contract-v18.js'):root.STCTV18?.networkContract);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root.document)(root.STCTPlatformV19=root.STCTPlatformV19||{}).supplyChainDesign=api;
})(globalThis,function(Contract){
  'use strict';
  const SCHEMA='stct-supply-chain-study-v1.9';
  const RESULT='stct-supply-chain-result-v1.9';
  const clone=value=>structuredClone(value);
  const frozenValues=new WeakSet(),studyIdentities=new WeakMap();
  function deepFreeze(value){if(value&&typeof value==='object'&&!frozenValues.has(value)){Object.values(value).forEach(deepFreeze);Object.freeze(value);frozenValues.add(value);}return value;}
  const hash=value=>Contract.hashArtifact(value);
  const fail=(code,detail={})=>{throw Object.assign(new Error(code),{code,detail});};
  const num=value=>typeof value==='number'&&Number.isFinite(value);
  const id=value=>String(value??'').trim();
  const quantity=(value,field)=>{if(!num(value)||value<0)fail('SUPPLY_QUANTITY_INVALID',{field,value});return value;};
  const key=(from,to)=>`${from}\u0000${to}`;
  const coordinate=value=>Array.isArray(value)&&value.length===2&&value.every(num)&&Math.abs(value[0])<=180&&Math.abs(value[1])<=90;
  const rad=value=>value*Math.PI/180;
  function geodesicKm(a,b){const latitude=rad(b[1]-a[1]),longitude=rad(b[0]-a[0]),term=Math.sin(latitude/2)**2+Math.cos(rad(a[1]))*Math.cos(rad(b[1]))*Math.sin(longitude/2)**2;return 12742*Math.atan2(Math.sqrt(term),Math.sqrt(Math.max(0,1-term)));}
  function createStudy(input){
    const raw=clone(input||{}),nodes=raw.nodes||[],periodDemand=raw.periodDemand||[],observedInbound=raw.observedInbound||[],observedAssignments=raw.observedAssignments||[],distanceRows=raw.distanceRows||[];
    if(!nodes.length||(!periodDemand.length&&!observedInbound.length))fail('SUPPLY_NODES_AND_DEMAND_REQUIRED');
    if(!periodDemand.length&&(!nodes.some(row=>['FACTORY','SUPPLIER'].includes(row.role))||!nodes.some(row=>['DC','WAREHOUSE'].includes(row.role))))fail('SUPPLY_UPSTREAM_NODES_REQUIRED');
    const studyUnit=periodDemand[0]?.unit||observedInbound[0]?.unit;
    const nodeIds=new Set();for(const row of nodes){if(!id(row.nodeId)||nodeIds.has(id(row.nodeId))||!id(row.role))fail('SUPPLY_NODE_ID_OR_ROLE_INVALID',{nodeId:row.nodeId});nodeIds.add(id(row.nodeId));if(row.coordinate!=null&&!coordinate(row.coordinate))fail('SUPPLY_COORDINATE_INVALID',{nodeId:row.nodeId});for(const value of Object.values(row.capacityByPeriod||{}))if(value!=null)quantity(value,'capacityByPeriod');}
    const periods=new Set(),demandIds=new Set();for(const row of periodDemand){if(!id(row.demandId)||!id(row.customerNodeId)||!id(row.period)||!nodeIds.has(id(row.customerNodeId)))fail('SUPPLY_DEMAND_REFERENCE_INVALID',{demandId:row.demandId});quantity(row.quantity,'periodDemand');if(!id(row.unit))fail('SUPPLY_DEMAND_UNIT_REQUIRED');periods.add(id(row.period));demandIds.add(id(row.demandId));if(row.currentSiteId&&!nodeIds.has(id(row.currentSiteId)))fail('SUPPLY_OBSERVED_SITE_UNKNOWN',{demandId:row.demandId});}
    if(new Set(periodDemand.map(row=>row.unit)).size>1)fail('SUPPLY_MIXED_DEMAND_UNITS');
    const periodKeys=new Set();for(const row of periodDemand){const item=`${row.demandId}\u0000${row.period}`;if(periodKeys.has(item))fail('SUPPLY_DUPLICATE_DEMAND_PERIOD',{demandId:row.demandId,period:row.period});periodKeys.add(item);}
    for(const row of observedInbound){if(!id(row.fromNodeId)||!id(row.toNodeId)||!nodeIds.has(id(row.toNodeId)))fail('SUPPLY_INBOUND_REFERENCE_INVALID',{flowId:row.flowId});quantity(row.quantity,'observedInbound');if(!id(row.unit)||row.unit!==studyUnit)fail('SUPPLY_INBOUND_UNIT_MISMATCH');if(!periodDemand.length){if(!id(row.period))fail('SUPPLY_INBOUND_PERIOD_REQUIRED',{flowId:row.flowId});periods.add(id(row.period));}}
    for(const row of distanceRows){if(!id(row.fromNodeId)||!id(row.toNodeId)||!nodeIds.has(id(row.fromNodeId))||!nodeIds.has(id(row.toNodeId)))fail('SUPPLY_DISTANCE_REFERENCE_INVALID');if(row.distanceKm!=null)quantity(row.distanceKm,'distanceKm');if(!['VERIFIED_ROAD','ESTIMATED_ROAD','GEOGRAPHIC_SCREENING'].includes(row.quality))fail('SUPPLY_DISTANCE_QUALITY_INVALID');if(!id(row.source)||!id(row.unit)||row.unit!=='km')fail('SUPPLY_DISTANCE_PROVENANCE_REQUIRED');}
    for(const rate of raw.rates||[]){if(!id(rate.kind)||!id(rate.status))fail('SUPPLY_RATE_STATUS_REQUIRED');if(rate.amount!=null)quantity(rate.amount,'rate.amount');if(['KNOWN','CONFIRMED_ZERO','ASSUMED'].includes(rate.status)&&rate.amount==null)fail('SUPPLY_RATE_AMOUNT_REQUIRED',{kind:rate.kind});if(['UNKNOWN','NOT_APPLICABLE'].includes(rate.status)&&rate.amount!=null)fail('SUPPLY_RATE_UNKNOWN_HAS_AMOUNT',{kind:rate.kind});}
    const value={schemaVersion:SCHEMA,studyId:id(raw.studyId)||`SUPPLY-${Date.now()}`,name:id(raw.name)||'Supply Chain Design Study',classification:id(raw.classification)||'UNSPECIFIED',unit:studyUnit,currency:id(raw.currency)||'CNY',periods:[...periods].sort(),nodes,periodDemand,observedInbound,observedAssignments,distanceRows,rates:raw.rates||[],costApplicability:raw.costApplicability||{},scenarios:raw.scenarios||[],sourceRows:raw.sourceRows||[],excludedRows:raw.excludedRows||[],sourceRefs:raw.sourceRefs||[],assumptions:raw.assumptions||{},coordinateUse:raw.coordinateUse||'UNCONFIRMED',version:1};
    value.inputHash=hash(value);studyIdentities.set(value,value.inputHash);return deepFreeze(value);
  }
  function assertStudyCurrent(study){if(studyIdentities.get(study)===study.inputHash)return;if(createStudy(study).inputHash!==study.inputHash)fail('SUPPLY_STUDY_HASH_INVALID');deepFreeze(study);studyIdentities.set(study,study.inputHash);}
  function snapshotTask(kind,args,compute,signal){
    if(signal?.aborted)return Promise.reject(Object.assign(new Error('SUPPLY_RUN_CANCELLED'),{code:'SUPPLY_RUN_CANCELLED'}));
    if(typeof Worker==='undefined')return Promise.resolve().then(()=>compute(...args));
    return new Promise((resolve,reject)=>{
      const worker=new Worker('platform-study-worker-v19.js'),requestId=`snapshot-${Date.now()}-${Math.random()}`;
      let settled=false;const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();error?reject(error):resolve(result);};
      const failure=code=>Object.assign(new Error(code),{code}),abort=()=>finish(failure('SUPPLY_RUN_CANCELLED')),timer=setTimeout(()=>finish(failure('SUPPLY_SNAPSHOT_TIMEOUT')),60000);
      signal?.addEventListener('abort',abort,{once:true});
      worker.onerror=()=>finish(failure('SUPPLY_SNAPSHOT_WORKER_FAILED'));
      worker.onmessage=event=>{const message=event.data;if(message.requestId!==requestId)return;if(message.type==='RESULT')finish(null,message.result);else if(message.type==='ERROR')finish(failure(message.code||'SUPPLY_SNAPSHOT_WORKER_FAILED'));};
      try{worker.postMessage({action:'SUPPLY_SNAPSHOT',requestId,input:{kind,args}});}catch(error){finish(error);}
    });
  }
  function distanceIndex(study,basis){
    const rows=study.distanceRows.filter(row=>row.quality===basis),lookup=new Map();
    for(const row of rows){const pair=key(row.fromNodeId,row.toNodeId);if(lookup.has(pair))fail('SUPPLY_DUPLICATE_DIRECTED_DISTANCE',{fromNodeId:row.fromNodeId,toNodeId:row.toNodeId,quality:basis});lookup.set(pair,row);}
    return lookup;
  }
  function resolveDistance(study,lookup,from,to,basis){
    const row=lookup.get(key(from,to));if(row)return row.distanceKm==null?null:row;
    if(basis!=='GEOGRAPHIC_SCREENING'||study.coordinateUse!=='ASSUMED_WGS84_SCREENING')return null;
    const a=study.nodes.find(node=>node.nodeId===from),b=study.nodes.find(node=>node.nodeId===to);
    if(!coordinate(a?.coordinate)||!coordinate(b?.coordinate))return null;
    return{fromNodeId:from,toNodeId:to,distanceKm:geodesicKm(a.coordinate,b.coordinate),unit:'km',quality:'GEOGRAPHIC_SCREENING',source:'ASSUMED_WGS84_SCREENING',observedAt:null,strategy:'GEOGRAPHIC_ONLY',travelSeconds:null};
  }
  function rateFor(study,kind,from,to,period){
    const matches=study.rates.filter(row=>row.kind===kind&&(!row.fromNodeId||row.fromNodeId===from)&&(!row.toNodeId||row.toNodeId===to)&&(!row.period||row.period===period));
    matches.sort((a,b)=>(Number(Boolean(b.fromNodeId))+Number(Boolean(b.toNodeId))+Number(Boolean(b.period)))-(Number(Boolean(a.fromNodeId))+Number(Boolean(a.toNodeId))+Number(Boolean(a.period))));
    if(matches.length>1){const specificity=row=>Number(Boolean(row.fromNodeId))+Number(Boolean(row.toNodeId))+Number(Boolean(row.period)),first=matches[0],tied=matches.filter(row=>specificity(row)===specificity(first));if(tied.some(row=>row.status!==first.status||row.basis!==first.basis||row.amount!==first.amount))fail('SUPPLY_RATE_CONFLICT',{kind,fromNodeId:from,toNodeId:to,period});}
    return matches[0]||{kind,status:'UNKNOWN',amount:null};
  }
  function amountFor(rate,quantity,distanceKm){if(!rate)return null;if(rate.status==='NOT_APPLICABLE')return 0;if(['minimumCharge','minimumFee','minimumAmount','minCharge','tiers','brackets','tieredRates'].some(field=>rate[field]!=null))return null;if(!['KNOWN','CONFIRMED_ZERO','ASSUMED'].includes(rate.status))return null;if(rate.basis==='PER_UNIT_KM')return distanceKm==null?null:quantity*distanceKm*rate.amount;if(rate.basis==='PER_UNIT')return quantity*rate.amount;if(rate.basis==='PER_PERIOD'||rate.basis==='ONE_TIME')return rate.amount;return null;}
  function observedSite(study,row){if(row.currentSiteId)return row.currentSiteId;const match=study.observedAssignments.find(item=>item.demandId===row.demandId&&(!item.period||item.period===row.period));return match?.siteNodeId||null;}
  function ledgerRow(kind,from,to,period,volume,study,lookup,basis,source,rateKind){const distance=resolveDistance(study,lookup,from,to,basis),rate=rateFor(study,rateKind||kind,from,to,period);return{kind,fromNodeId:from,toNodeId:to,period,quantity:volume,unit:study.unit,distanceKm:distance?.distanceKm??null,distanceSource:distance?.source??null,distanceQuality:distance?.quality??null,distanceTimestamp:distance?.observedAt??null,distanceStrategy:distance?.strategy??null,travelSeconds:distance?.travelSeconds??null,volumeKm:distance?volume*distance.distanceKm:null,rateStatus:rate.status,rateBasis:rate.basis||null,rateAmount:rate.amount??null,cost:amountFor(rate,volume,distance?.distanceKm??null),source};}
  function summarizeLegs(rows){let numerator=0,denominator=0,totalVolume=0,knownVolume=0,cost=0,costKnown=0;for(const row of rows){totalVolume+=row.quantity;if(row.volumeKm!=null){numerator+=row.volumeKm;denominator+=row.quantity;knownVolume+=row.quantity;}if(row.cost!=null){cost+=row.cost;costKnown++;}}return{weightedDistanceKm:denominator?numerator/denominator:null,numeratorVolumeKm:rows.length&&knownVolume===totalVolume?numerator:null,knownVolumeKmSubtotal:numerator,denominatorVolume:denominator,totalVolume,knownDistanceVolume:knownVolume,coverageRatio:totalVolume?knownVolume/totalVolume:null,cost:rows.length&&costKnown===rows.length?cost:null,knownCostSubtotal:cost,costCoveredLegs:costKnown,totalLegs:rows.length};}
  function commonDistance(beforeRows,afterRows,kind='OUTBOUND'){
    const identity=row=>kind==='OUTBOUND'?`${row.demandId}\u0000${row.period}`:`${row.toNodeId}\u0000${row.period}`;
    const group=rows=>{const groups=new Map();for(const row of rows){const key=identity(row),item=groups.get(key)||{quantity:0,volumeKm:0,known:true,unit:row.unit};item.quantity+=row.quantity;item.known=item.known&&row.volumeKm!=null&&item.unit===row.unit;item.volumeKm+=row.volumeKm||0;groups.set(key,item);}return groups;};
    const before=group(beforeRows),after=group(afterRows),keys=[],excluded=[],a={quantity:0,volumeKm:0},b={quantity:0,volumeKm:0};
    for(const [key,left] of before){const right=after.get(key);if(!right||!left.known||!right.known||left.unit!==right.unit||Math.abs(left.quantity-right.quantity)>1e-6){excluded.push(key);continue;}keys.push(key);a.quantity+=left.quantity;a.volumeKm+=left.volumeKm;b.quantity+=right.quantity;b.volumeKm+=right.volumeKm;}
    for(const key of after.keys())if(!before.has(key))excluded.push(key);
    const beforeTotal=beforeRows.reduce((sum,row)=>sum+row.quantity,0),afterTotal=afterRows.reduce((sum,row)=>sum+row.quantity,0);
    return {beforeWeightedKm:a.quantity?a.volumeKm/a.quantity:null,afterWeightedKm:b.quantity?b.volumeKm/b.quantity:null,beforeVolumeKm:a.quantity?a.volumeKm:null,afterVolumeKm:b.quantity?b.volumeKm:null,commonVolume:a.quantity,beforeTotalVolume:beforeTotal,afterTotalVolume:afterTotal,coverageRatio:beforeTotal?a.quantity/beforeTotal:null,sampleSetHash:hash(keys.sort()),sampleCount:keys.length,excludedCount:excluded.length,sameTotalVolume:Math.abs(beforeTotal-afterTotal)<=1e-6};
  }
  function evaluatePortfolio(studyValue,scenarioValue={type:'OBSERVED_BASELINE'},assignmentsValue=null){
    const study=studyValue.schemaVersion===SCHEMA?studyValue:createStudy(studyValue),scenario=clone(scenarioValue),baseline=scenario.type==='OBSERVED_BASELINE',basis=scenario.distanceBasis||'VERIFIED_ROAD';
    if(!['VERIFIED_ROAD','ESTIMATED_ROAD','GEOGRAPHIC_SCREENING'].includes(basis))fail('SUPPLY_DISTANCE_BASIS_INVALID');
    if(!baseline&&scenario.selectedSiteIds!=null&&(!Array.isArray(scenario.selectedSiteIds)||new Set(scenario.selectedSiteIds).size!==scenario.selectedSiteIds.length||scenario.selectedSiteIds.some(site=>!study.nodes.some(node=>node.nodeId===site&&['DC','WAREHOUSE'].includes(node.role)))))fail('SUPPLY_SELECTED_SITE_SET_INVALID');
    const providedAssignments=assignmentsValue||scenario.assignments||[],knownDemandIds=new Set(study.periodDemand.map(row=>id(row.demandId))),assignedDemandIds=new Set();
    if(!Array.isArray(providedAssignments))fail('SUPPLY_ASSIGNMENTS_INVALID');
    for(const row of providedAssignments){if(!row||!knownDemandIds.has(id(row.demandId))||assignedDemandIds.has(id(row.demandId)))fail('SUPPLY_ASSIGNMENTS_INVALID');assignedDemandIds.add(id(row.demandId));}
    const lookup=distanceIndex(study,basis),assignmentMap=new Map((assignmentsValue||scenario.assignments||[]).map(row=>[id(row.demandId),id(row.siteNodeId||row.siteId)])),issues=[],selected=new Set(scenario.selectedSiteIds||[]),outbound=[],inbound=[],transfer=[],periodLoads=new Map(),inboundOnly=!study.periodDemand.length;if(!baseline&&scenario.type==='FIXED_SITE_REASSIGNMENT'&&(!selected.size||[...selected].some(siteId=>!study.nodes.some(node=>node.nodeId===siteId&&(node.role==='DC'||node.role==='WAREHOUSE')))))fail('SUPPLY_FIXED_SITE_SET_REQUIRED');
    if(!baseline){for(const site of scenario.forbiddenSiteIds||[])if(selected.has(site))issues.push({code:'SUPPLY_SELECTED_SITE_FORBIDDEN',site});for(const site of scenario.requiredSiteIds||[])if(!selected.has(site))issues.push({code:'SUPPLY_REQUIRED_SITE_INVALID',site});}
    for(const row of study.periodDemand){
      const direct=!baseline?scenario.directSourceByDemand?.[row.demandId]:null;
      const site=direct|| (baseline?observedSite(study,row):assignmentMap.get(row.demandId)||scenario.assignmentLocks?.[row.demandId]||null);
      if(!site){issues.push({code:baseline?'SUPPLY_OBSERVED_ASSIGNMENT_MISSING':'SUPPLY_CANDIDATE_ASSIGNMENT_MISSING',demandId:row.demandId,period:row.period});continue;}
      if(!study.nodes.some(node=>node.nodeId===site)){issues.push({code:'SUPPLY_ASSIGNMENT_SITE_UNKNOWN',demandId:row.demandId,site});continue;}
      if(!baseline&&!direct&&selected.size&&!selected.has(site))issues.push({code:'SUPPLY_ASSIGNMENT_SITE_CLOSED',demandId:row.demandId,site});
      if(!baseline&&scenario.assignmentLocks?.[row.demandId]&&scenario.assignmentLocks[row.demandId]!==site)issues.push({code:'SUPPLY_ASSIGNMENT_LOCK_FAILED',demandId:row.demandId,site});
      if(!baseline&&scenario.allowedService?.[row.demandId]&&!scenario.allowedService[row.demandId].includes(site))issues.push({code:'SUPPLY_SERVICE_RELATION_FORBIDDEN',demandId:row.demandId,site});
      if(direct&&scenario.sourceQualifications?.[row.demandId]&&!scenario.sourceQualifications[row.demandId].includes(site))issues.push({code:'SUPPLY_DIRECT_SOURCE_UNQUALIFIED',demandId:row.demandId,site});
      const leg=ledgerRow(direct?'DIRECT':'OUTBOUND',site,row.customerNodeId,row.period,row.quantity,study,lookup,basis,row.source||null,direct?'DIRECT_TRANSPORT':'OUTBOUND_TRANSPORT');leg.demandId=row.demandId;outbound.push(leg);
      if(!direct){const loadKey=key(site,row.period);periodLoads.set(loadKey,(periodLoads.get(loadKey)||0)+row.quantity);}
      if(scenario.maxDistanceKm!=null&&leg.distanceKm!=null&&leg.distanceKm>scenario.maxDistanceKm)issues.push({code:'SUPPLY_DISTANCE_LIMIT_FAILED',demandId:row.demandId,period:row.period,site});
      if(scenario.maxServiceSeconds!=null){
        if(leg.travelSeconds==null)issues.push({code:'SUPPLY_TIME_DATA_MISSING',demandId:row.demandId,period:row.period,site});
        else if(leg.travelSeconds>scenario.maxServiceSeconds)issues.push({code:'SUPPLY_TIME_LIMIT_FAILED',demandId:row.demandId,period:row.period,site});
      }
    }
    if(baseline){for(const row of study.observedInbound){if(row.period){inbound.push(ledgerRow('INBOUND',row.fromNodeId,row.toNodeId,row.period,row.quantity,study,lookup,basis,row.source||null,'INBOUND_TRANSPORT'));}else issues.push({code:'SUPPLY_INBOUND_PERIOD_UNKNOWN',flowId:row.flowId});}}
    if(baseline&&inboundOnly)for(const row of inbound){const loadKey=key(row.toNodeId,row.period);periodLoads.set(loadKey,(periodLoads.get(loadKey)||0)+row.quantity);}
    else for(const plan of scenario.sourcePlan||[]){if(selected.size&&!selected.has(plan.siteNodeId))continue;if(!study.nodes.some(node=>node.nodeId===plan.sourceNodeId)||!study.nodes.some(node=>node.nodeId===plan.siteNodeId)){issues.push({code:'SUPPLY_SOURCE_PLAN_REFERENCE_INVALID',sourceNodeId:plan.sourceNodeId,siteNodeId:plan.siteNodeId});continue;}if(scenario.allowedSourcesBySite?.[plan.siteNodeId]&&!scenario.allowedSourcesBySite[plan.siteNodeId].includes(plan.sourceNodeId))issues.push({code:'SUPPLY_SOURCE_UNQUALIFIED',sourceNodeId:plan.sourceNodeId,siteNodeId:plan.siteNodeId});for(const period of study.periods){const volume=plan.quantityByPeriod?.[period]??(plan.share!=null?(periodLoads.get(key(plan.siteNodeId,period))||0)*plan.share:null);if(volume==null){issues.push({code:'SUPPLY_SOURCE_QUANTITY_UNKNOWN',period,siteNodeId:plan.siteNodeId});continue;}quantity(volume,'sourcePlan');inbound.push(ledgerRow('INBOUND',plan.sourceNodeId,plan.siteNodeId,period,volume,study,lookup,basis,{kind:'SCENARIO_ASSUMPTION',planId:plan.planId||null},'INBOUND_TRANSPORT'));}}
    if(!baseline)for(const plan of scenario.transferPlan||[]){if(!study.nodes.some(node=>node.nodeId===plan.fromNodeId)||!study.nodes.some(node=>node.nodeId===plan.toNodeId)){issues.push({code:'SUPPLY_TRANSFER_REFERENCE_INVALID',fromNodeId:plan.fromNodeId,toNodeId:plan.toNodeId});continue;}for(const period of study.periods){const volume=plan.quantityByPeriod?.[period];if(volume==null){issues.push({code:'SUPPLY_TRANSFER_QUANTITY_UNKNOWN',period,planId:plan.planId});continue;}quantity(volume,'transferPlan');transfer.push(ledgerRow('TRANSFER',plan.fromNodeId,plan.toNodeId,period,volume,study,lookup,basis,{kind:'SCENARIO_ASSUMPTION',planId:plan.planId||null},'TRANSFER_TRANSPORT'));}}
    if(transfer.length&&study.costApplicability.transferTransport==='NOT_APPLICABLE')issues.push({code:'SUPPLY_COST_SCOPE_CONFLICT',part:'transferTransport'});
    if(!baseline&&!(scenario.sourcePlan||[]).length&&periodLoads.size)issues.push({code:'SUPPLY_SOURCE_PLAN_MISSING'});
    if(!baseline&&(scenario.sourcePlan||[]).length&&!scenario.inventoryByPeriod?.length){for(const [sitePeriod,load] of periodLoads){const [siteNodeId,period]=sitePeriod.split('\u0000'),sourced=inbound.filter(row=>row.toNodeId===siteNodeId&&row.period===period).reduce((sum,row)=>sum+row.quantity,0);if(Math.abs(sourced-load)>1e-6)issues.push({code:'SUPPLY_SOURCE_BALANCE_MISMATCH',siteNodeId,period,throughput:load,sourced});}}
    const capacities=[];const activeSiteIds=baseline?[...new Set(inboundOnly?inbound.map(row=>row.toNodeId):outbound.map(row=>row.fromNodeId))]:[...selected];for(const siteId of activeSiteIds){const node=study.nodes.find(item=>item.nodeId===siteId);for(const period of study.periods){const load=periodLoads.get(key(siteId,period))||0,capacity=scenario.capacityByPeriod?.[siteId]?.[period]??node?.capacityByPeriod?.[period]??null,status=capacity==null?'UNKNOWN':load>capacity+1e-8?'EXCEEDED':'PASS';capacities.push({siteNodeId:siteId,period,throughput:load,capacity,status});if(status==='EXCEEDED')issues.push({code:'SUPPLY_PERIOD_CAPACITY_EXCEEDED',siteNodeId:siteId,period,load,capacity});}}
    const fixed=[];for(const siteId of activeSiteIds)for(const period of study.periods){const rate=rateFor(study,'FIXED_OPERATING',siteId,siteId,period);fixed.push({siteNodeId:siteId,period,cost:amountFor(rate,0,null),rateStatus:rate.status});}
    const handling=[];for(const row of capacities){const rate=rateFor(study,'HANDLING',row.siteNodeId,row.siteNodeId,row.period);handling.push({siteNodeId:row.siteNodeId,period:row.period,cost:amountFor(rate,row.throughput,null),rateStatus:rate.status});}
    const inventory=[];for(const row of scenario.inventoryByPeriod||[]){quantity(row.quantity,'inventoryByPeriod');const rate=rateFor(study,'INVENTORY_HOLDING',row.siteNodeId,row.siteNodeId,row.period);inventory.push({siteNodeId:row.siteNodeId,period:row.period,cost:amountFor(rate,row.quantity,null),rateStatus:rate.status});}
    const conversion=baseline?0:(scenario.oneTimeConversionCost??null);if(conversion!=null)quantity(conversion,'oneTimeConversionCost');
    const out=summarizeLegs(outbound),inc=summarizeLegs(inbound),trans=summarizeLegs(transfer),inboundApplicable=baseline||periodLoads.size>0,costParts={inboundTransport:inboundApplicable?inc.cost:0,outboundTransport:inboundOnly?0:out.cost,transferTransport:trans.cost,fixedOperating:fixed.every(row=>row.cost!=null)?fixed.reduce((sum,row)=>sum+row.cost,0):null,handling:handling.every(row=>row.cost!=null)?handling.reduce((sum,row)=>sum+row.cost,0):null,inventoryHolding:inventory.length&&inventory.every(row=>row.cost!=null)?inventory.reduce((sum,row)=>sum+row.cost,0):null,oneTimeConversion:conversion};
    const applicable=[...(inboundApplicable?['inboundTransport']:[]),...(!inboundOnly?['outboundTransport']:[]),'fixedOperating','handling',...(transfer.length?['transferTransport']:[]),...(inventory.length?['inventoryHolding']:[])],unmodeled=['inventoryHolding','transferTransport'].filter(part=>!applicable.includes(part)&&study.costApplicability[part]!=='NOT_APPLICABLE');
    const steadyState=applicable.every(part=>costParts[part]!=null)&&!unmodeled.length?applicable.reduce((sum,part)=>sum+costParts[part],0):null;
    const first=study.periods[0],firstRows=[...inbound,...outbound,...transfer].filter(row=>row.period===first),firstFixed=fixed.filter(row=>row.period===first),firstHandling=handling.filter(row=>row.period===first),firstInventory=inventory.filter(row=>row.period===first),firstCosts=[...firstRows,...firstFixed,...firstHandling,...firstInventory].map(row=>row.cost),firstPeriod=conversion!=null&&firstRows.length&&!unmodeled.length&&firstCosts.every(value=>value!=null)?firstCosts.reduce((sum,value)=>sum+value,0)+conversion:null;
    if((!inboundOnly&&out.coverageRatio!==1)||(inboundApplicable&&inc.coverageRatio!==1)||(transfer.length&&trans.coverageRatio!==1))issues.push({code:'SUPPLY_DISTANCE_COVERAGE_INCOMPLETE',outboundCoverage:out.coverageRatio,inboundCoverage:inc.coverageRatio,transferCoverage:trans.coverageRatio});
    if(capacities.some(row=>row.status==='UNKNOWN'))issues.push({code:'SUPPLY_CAPACITY_UNKNOWN'});
    if(steadyState==null)issues.push({code:'SUPPLY_COST_COVERAGE_INCOMPLETE',knownParts:applicable.filter(part=>costParts[part]!=null),unmodeled});
    const hard=issues.some(row=>/EXCEEDED|FAILED|FORBIDDEN|CLOSED|INVALID|BALANCE_MISMATCH|UNQUALIFIED|SCOPE_CONFLICT/.test(row.code)),status=hard?'INFEASIBLE':issues.length?'INCOMPLETE':'EVALUATED';
    const totalVolumeKm=[...(!inboundOnly?[out.numeratorVolumeKm]:[]),...(inboundApplicable?[inc.numeratorVolumeKm]:[]),...(transfer.length?[trans.numeratorVolumeKm]:[])].every(value=>value!=null)?(out.numeratorVolumeKm||0)+(inc.numeratorVolumeKm||0)+(trans.numeratorVolumeKm||0):null;
    const result={schemaVersion:RESULT,studyHash:study.inputHash,scenarioId:scenario.scenarioId||scenario.type,scenarioType:scenario.type,status,distanceBasis:basis,issues,selectedSiteIds:activeSiteIds,outbound,inbound,transfer,capacityByPeriod:capacities,metrics:{outbound:out,inbound:inc,transfer:trans,totalVolumeKm,volumeKmMeaning:'FREIGHT_VOLUME_KM_NOT_VEHICLE_KM',costParts,steadyStateCost:steadyState,firstPeriodCost:firstPeriod,costCoverage:applicable.filter(part=>costParts[part]!=null),applicableCostParts:applicable,currency:study.currency,periods:study.periods,unit:study.unit},assumptions:clone(study.assumptions),scope:{demandRecords:study.periodDemand.length,inboundObservedRecords:study.observedInbound.length,periods:study.periods,distanceBasis:basis},solverEvidence:scenario.solverEvidence||null};result.resultHash=hash(result);return deepFreeze(result);
  }
  function compare(studyValue,baseline,candidate){
    const study=studyValue.schemaVersion===SCHEMA?studyValue:createStudy(studyValue);
    if(baseline.studyHash!==study.inputHash||candidate.studyHash!==study.inputHash)fail('SUPPLY_RESULT_STALE');
    const sameScope=baseline.scope.demandRecords===candidate.scope.demandRecords&&JSON.stringify(baseline.scope.periods)===JSON.stringify(candidate.scope.periods)&&baseline.distanceBasis===candidate.distanceBasis;
    const outboundCommon=commonDistance(baseline.outbound,candidate.outbound,'OUTBOUND'),inboundCommon=commonDistance(baseline.inbound,candidate.inbound,'INBOUND');
    const quantities=rows=>{const totals=new Map();for(const row of rows){const identity=JSON.stringify([row.fromNodeId,row.period,row.unit]);totals.set(identity,(totals.get(identity)||0)+row.quantity);}return totals;};
    const beforeInbound=quantities(baseline.inbound),afterInbound=quantities(candidate.inbound),inboundScopeComparable=beforeInbound.size===afterInbound.size&&[...beforeInbound].every(([identity,volume])=>afterInbound.has(identity)&&Math.abs(volume-afterInbound.get(identity))<=1e-6);
    const outboundScopeComparable=outboundCommon.sameTotalVolume&&outboundCommon.excludedCount===0;
    const parts=baseline.metrics.applicableCostParts.filter(part=>candidate.metrics.applicableCostParts.includes(part)&&baseline.metrics.costParts[part]!=null&&candidate.metrics.costParts[part]!=null&&(part!=='inboundTransport'||inboundScopeComparable)&&(part!=='outboundTransport'||outboundScopeComparable));
    const fullCost=sameScope&&baseline.metrics.steadyStateCost!=null&&candidate.metrics.steadyStateCost!=null&&parts.length===baseline.metrics.applicableCostParts.length&&parts.length===candidate.metrics.applicableCostParts.length;
    const base=parts.reduce((sum,part)=>sum+baseline.metrics.costParts[part],0),next=parts.reduce((sum,part)=>sum+candidate.metrics.costParts[part],0);
    const rate=metric=>sameScope&&metric.sameTotalVolume&&metric.beforeWeightedKm>0&&metric.afterWeightedKm!=null?(metric.afterWeightedKm-metric.beforeWeightedKm)/metric.beforeWeightedKm:null;
    return{sameScope,inboundScopeComparable,outboundScopeComparable,comparableCostParts:parts,completeOperatingCost:fullCost,steadyStateImprovementRate:fullCost&&base>0?(base-next)/base:null,comparablePartImprovementRate:sameScope&&base>0?(base-next)/base:null,firstPeriodImprovementRate:fullCost&&candidate.metrics.firstPeriodCost!=null&&baseline.metrics.firstPeriodCost>0?(baseline.metrics.firstPeriodCost-candidate.metrics.firstPeriodCost)/baseline.metrics.firstPeriodCost:null,outboundDistanceChangeRate:rate(outboundCommon),inboundDistanceChangeRate:rate(inboundCommon),outboundCommon,inboundCommon};
  }
  function solverRequest(studyValue,scenario={}){const study=studyValue.schemaVersion===SCHEMA?studyValue:createStudy(studyValue),basis=scenario.distanceBasis||'VERIFIED_ROAD',lookup=distanceIndex(study,basis),sites=study.nodes.filter(row=>row.role==='DC'||row.role==='WAREHOUSE'),byDemand=new Map();for(const row of study.periodDemand){const found=byDemand.get(row.demandId)||{demandId:row.demandId,customerNodeId:row.customerNodeId,volume:0};if(found.customerNodeId!==row.customerNodeId)fail('SUPPLY_DEMAND_CUSTOMER_CHANGED');found.volume+=row.quantity;byDemand.set(row.demandId,found);}if(byDemand.size>500||sites.length>100)fail('SUPPLY_SOLVER_SIZE_LIMIT');const demands=[...byDemand.values()].map(row=>{const node=study.nodes.find(item=>item.nodeId===row.customerNodeId),locked=scenario.assignmentLocks?.[row.demandId],allowed=scenario.allowedService?.[row.demandId]||[];return{demandId:row.demandId,coordinate:node?.coordinate||undefined,demand:{quantity:0,weight:0,volume:row.volume},eligibleSiteIds:locked?[locked]:allowed,requiredCapabilities:[]};});const matrix=[];for(const site of sites)for(const demand of demands){const nodeId=byDemand.get(demand.demandId).customerNodeId,row=resolveDistance(study,lookup,site.nodeId,nodeId,basis);if(!row)fail('SUPPLY_SOLVER_DISTANCE_INCOMPLETE',{fromNodeId:site.nodeId,toNodeId:nodeId,distanceBasis:basis});if(scenario.maxServiceSeconds!=null&&row.travelSeconds==null)fail('SUPPLY_SOLVER_TIME_DATA_INCOMPLETE',{fromNodeId:site.nodeId,toNodeId:nodeId});matrix.push({siteId:site.nodeId,demandId:demand.demandId,distanceMeters:Math.round(row.distanceKm*1000),travelSeconds:row.travelSeconds??0,unreachable:false});}const fixedSites=scenario.type==='FIXED_SITE_REASSIGNMENT'?[...new Set(scenario.selectedSiteIds||[])]:null;if(fixedSites&&(!fixedSites.length||fixedSites.some(siteId=>!sites.some(site=>site.nodeId===siteId))))fail('SUPPLY_FIXED_SITE_SET_REQUIRED');const requested=scenario.facilityCounts||(fixedSites?[fixedSites.length]:[1,2,3].filter(count=>count<=sites.length));if(!requested.length||requested.some(count=>count<1||count>sites.length)||fixedSites&&requested.some(count=>count!==fixedSites.length))fail('SUPPLY_FACILITY_COUNTS_INVALID');const requiredSites=fixedSites||scenario.requiredSiteIds||[],forbiddenSites=fixedSites?sites.filter(site=>!fixedSites.includes(site.nodeId)).map(site=>site.nodeId):scenario.forbiddenSiteIds||[];const payload={schemaVersion:'stct-facility-solve-request-v1.9-mvp1',requestId:`SUPPLY-${Date.now()}`,studyHash:study.inputHash,demands,sites:sites.map(site=>({siteId:site.nodeId,coordinate:site.coordinate||undefined,status:requiredSites.includes(site.nodeId)?'REQUIRED_OPEN':forbiddenSites.includes(site.nodeId)?'FORBIDDEN':'OPTIONAL',capacity:{quantity:null,weight:null,volume:null},fixedCost:0,handlingCostPerUnit:0,capabilities:[]})),matrix:{rows:matrix},options:{facilityCounts:requested,currentPortfolioSiteIds:scenario.type==='FIXED_SITE_REASSIGNMENT'?scenario.selectedSiteIds||[]:[],transportBasis:'volume',transportCostPerUnitKm:1,currency:study.currency,costPeriod:'STUDY_HORIZON',maxDistanceKm:scenario.maxDistanceKm??null,maxServiceTime:scenario.maxServiceSeconds??null,timeLimitSeconds:Math.min(120,Math.max(1,scenario.timeLimitSeconds||15)),randomSeed:1909}};const objective=attachObjective(study,scenario,payload,lookup,basis);return{payload,objective,scope:'CANDIDATE_SET_GENERATION',distanceBasis:basis};}
  function attachObjective(study,scenario,payload,lookup,basis){
    const mode=scenario.objective||'VOLUME_KM';
    if(!['COST','VOLUME_KM'].includes(mode))fail('SUPPLY_OBJECTIVE_UNSUPPORTED');
    if(Object.keys(scenario.directSourceByDemand||{}).length)fail('SUPPLY_DIRECT_REQUIRES_CONFIGURED_CANDIDATE');
    if(mode==='COST'&&(scenario.transferPlan||[]).length)fail('SUPPLY_COST_OBJECTIVE_TRANSFER_NOT_MODELED');
    if(mode==='COST'&&(study.costApplicability.inventoryHolding!=='NOT_APPLICABLE'||study.costApplicability.transferTransport!=='NOT_APPLICABLE'))fail('SUPPLY_COST_OBJECTIVE_SCOPE_INCOMPLETE');
    const decisionSites=payload.sites.filter(site=>site.status!=='FORBIDDEN'),decisionIds=new Set(decisionSites.map(site=>site.siteId));
    const rawPlans=scenario.sourcePlan||[],allSiteIds=new Set(payload.sites.map(site=>site.siteId));
    for(const plan of rawPlans)if(!allSiteIds.has(plan.siteNodeId))fail('SUPPLY_SOURCE_PLAN_REFERENCE_INVALID',{siteNodeId:plan.siteNodeId});
    const sourcePlans=rawPlans.filter(plan=>decisionIds.has(plan.siteNodeId));
    const objectiveScope=scenario.objectiveScope||(rawPlans.length?'TWO_END':'OUTBOUND_ONLY');
    if(!['TWO_END','OUTBOUND_ONLY'].includes(objectiveScope))fail('SUPPLY_OBJECTIVE_SCOPE_INVALID');
    if(mode==='COST'&&objectiveScope!=='TWO_END')fail('SUPPLY_COST_SOURCE_PLAN_REQUIRED');
    if(objectiveScope==='OUTBOUND_ONLY'&&rawPlans.length)fail('SUPPLY_OUTBOUND_SCOPE_WITH_SOURCE_PLAN');
    const plansBySite=new Map();
    if(objectiveScope==='TWO_END'){
      for(const plan of sourcePlans){
        if(!study.nodes.some(node=>node.nodeId===plan.sourceNodeId))fail('SUPPLY_SOURCE_PLAN_REFERENCE_INVALID',{sourceNodeId:plan.sourceNodeId});
        if(plan.unit!=null&&plan.unit!==study.unit)fail('SUPPLY_SOURCE_UNIT_MISMATCH',{siteId:plan.siteNodeId});
        if(plan.period!=null||plan.quantityByPeriod!=null)fail('SUPPLY_SOURCE_PERIOD_PLAN_UNSUPPORTED',{siteId:plan.siteNodeId});
        if(!num(plan.share)||plan.share<0)fail('SUPPLY_SOURCE_SHARE_INVALID',{siteId:plan.siteNodeId});
        if(scenario.allowedSourcesBySite?.[plan.siteNodeId]&&!scenario.allowedSourcesBySite[plan.siteNodeId].includes(plan.sourceNodeId))fail('SUPPLY_SOURCE_UNQUALIFIED',{sourceNodeId:plan.sourceNodeId,siteNodeId:plan.siteNodeId});
        if(resolveDistance(study,lookup,plan.sourceNodeId,plan.siteNodeId,basis)?.distanceKm==null)fail('SUPPLY_SOURCE_DISTANCE_INCOMPLETE',{sourceNodeId:plan.sourceNodeId,siteId:plan.siteNodeId});
        const list=plansBySite.get(plan.siteNodeId)||[];list.push(plan);plansBySite.set(plan.siteNodeId,list);
      }
      const missing=decisionSites.filter(site=>{const plans=plansBySite.get(site.siteId)||[];return !plans.length||Math.abs(plans.reduce((sum,plan)=>sum+plan.share,0)-1)>1e-8;}).map(site=>site.siteId);
      if(missing.length)fail('SUPPLY_SOURCE_COVERAGE_INCOMPLETE',{siteIds:missing});
    }
    const pairValues=[],siteValues=[];
    for(const site of payload.sites){
      if(site.status==='FORBIDDEN'){
        siteValues.push({siteId:site.siteId,value:0});
        for(const demand of payload.demands)pairValues.push({siteId:site.siteId,demandId:demand.demandId,value:0});
        continue;
      }
      const plans=plansBySite.get(site.siteId)||[];
      let siteValue=0;
      if(mode==='COST')for(const period of study.periods){const fixed=amountFor(rateFor(study,'FIXED_OPERATING',site.siteId,site.siteId,period),0,null);if(fixed==null)fail('SUPPLY_COST_OBJECTIVE_INCOMPLETE',{kind:'FIXED_OPERATING',siteId:site.siteId,period});siteValue+=fixed;}
      siteValues.push({siteId:site.siteId,value:siteValue});
      for(const demand of payload.demands){
        const customer=study.periodDemand.find(row=>row.demandId===demand.demandId).customerNodeId;
        const outDistance=resolveDistance(study,lookup,site.siteId,customer,basis)?.distanceKm;
        let value=0;
        for(const row of study.periodDemand.filter(item=>item.demandId===demand.demandId)){
          if(mode==='COST'){
            const out=amountFor(rateFor(study,'OUTBOUND_TRANSPORT',site.siteId,customer,row.period),row.quantity,outDistance);
            const handling=amountFor(rateFor(study,'HANDLING',site.siteId,site.siteId,row.period),row.quantity,null);
            if(out==null||handling==null)fail('SUPPLY_COST_OBJECTIVE_INCOMPLETE',{kind:out==null?'OUTBOUND_TRANSPORT':'HANDLING',siteId:site.siteId,demandId:demand.demandId,period:row.period});
            value+=out+handling;
          }else value+=row.quantity*outDistance;
          for(const plan of plans){
            const inDistance=resolveDistance(study,lookup,plan.sourceNodeId,site.siteId,basis).distanceKm;
            const volume=row.quantity*plan.share;
            if(mode==='COST'){
              const cost=amountFor(rateFor(study,'INBOUND_TRANSPORT',plan.sourceNodeId,site.siteId,row.period),volume,inDistance);
              if(cost==null)fail('SUPPLY_COST_OBJECTIVE_INCOMPLETE',{kind:'INBOUND_TRANSPORT',siteId:site.siteId,period:row.period});
              value+=cost;
            }else value+=volume*inDistance;
          }
        }
        pairValues.push({siteId:site.siteId,demandId:demand.demandId,value});
      }
    }
    payload.objective={mode,unit:mode==='COST'?study.currency:`${study.unit}_km`,pairValues,siteValues};
    return mode==='COST'?'TWO_END_KNOWN_COST':objectiveScope==='TWO_END'?'TWO_END_VOLUME_KM':'OUTBOUND_VOLUME_KM_PROXY';
  }
  function candidateResults(studyValue,scenario,resultSet){const study=studyValue.schemaVersion===SCHEMA?studyValue:createStudy(studyValue),request=solverRequest(study,scenario),rows=[...(resultSet?.results||[]),...(scenario.type==='FIXED_SITE_REASSIGNMENT'&&resultSet?.currentBaseline?[resultSet.currentBaseline]:[])],out=[],seen=new Set();if(resultSet?.studyHash!==study.inputHash||resultSet?.engine?.id!=='OR_TOOLS_CP_SAT'||resultSet?.engine?.workers!==1||resultSet?.requestId!==scenario.requestId&&scenario.requestId)fail('SUPPLY_SOLVER_RESPONSE_MISMATCH');for(const row of rows){if(!['OPTIMAL','FEASIBLE'].includes(row.status))continue;const sites=[...(row.selectedSiteIds||[])].sort(),signature=sites.join('|');if(seen.has(signature))continue;seen.add(signature);const pairs=new Set(),issues=[];if(new Set(sites).size!==sites.length)issues.push('DUPLICATE_SELECTED_SITE');for(const assignment of row.assignments||[]){if(pairs.has(assignment.demandId))issues.push('DUPLICATE_ASSIGNMENT');if(!sites.includes(assignment.siteId))issues.push('ASSIGNMENT_SITE_NOT_SELECTED');pairs.add(assignment.demandId);const matrix=request.payload.matrix.rows.find(item=>item.siteId===assignment.siteId&&item.demandId===assignment.demandId);if(!matrix||matrix.distanceMeters!==assignment.distanceMeters)issues.push('DISTANCE_MISMATCH');}if(pairs.size!==request.payload.demands.length||sites.length!==row.facilityCount)issues.push('CONSERVATION_FAILED');const objective=request.payload.objective,expected=(row.assignments||[]).reduce((sum,item)=>sum+(objective.pairValues.find(term=>term.siteId===item.siteId&&term.demandId===item.demandId)?.value??NaN),0)+sites.reduce((sum,siteId)=>sum+(objective.siteValues.find(term=>term.siteId===siteId)?.value??NaN),0);if(row.objectiveMode!==objective.mode||row.objectiveUnit!==objective.unit||!num(row.objectiveValue)||!num(expected)||Math.abs(row.objectiveValue-expected)>Math.max(.02,.0006*(pairs.size+sites.length)))issues.push('OBJECTIVE_MISMATCH');if(scenario.type==='FIXED_SITE_REASSIGNMENT'&&JSON.stringify(sites)!==JSON.stringify([...(scenario.selectedSiteIds||[])].sort()))issues.push('FIXED_SITE_SET_CHANGED');for(const siteId of scenario.requiredSiteIds||[])if(!sites.includes(siteId))issues.push('REQUIRED_SITE_MISSING');for(const siteId of scenario.forbiddenSiteIds||[])if(sites.includes(siteId))issues.push('FORBIDDEN_SITE_SELECTED');if(issues.length)fail('SUPPLY_SOLVER_RESULT_INVALID',{issues,facilityCount:row.facilityCount,rank:row.rank});const candidate={...scenario,scenarioId:`${scenario.scenarioId||'CANDIDATE'}-${out.length+1}`,type:scenario.type==='FIXED_SITE_REASSIGNMENT'?'FIXED_SITE_REASSIGNMENT':'NETWORK_CANDIDATE',selectedSiteIds:sites,solverEvidence:{engine:resultSet.engine,status:row.status,facilityCount:row.facilityCount,rank:row.rank,solveTimeMs:row.solveTimeMs,bestBound:row.bestBound,relativeGap:row.relativeGap,objective:request.objective,objectiveValue:row.objectiveValue,objectiveUnit:row.objectiveUnit||request.payload.objective.unit,claim:'CANDIDATE_SET_ONLY'}};out.push(evaluatePortfolio(study,candidate,(row.assignments||[]).map(item=>({demandId:item.demandId,siteNodeId:item.siteId}))));}return out;}
  function isStale(studyValue,result){const study=studyValue.schemaVersion===SCHEMA?studyValue:createStudy(studyValue);return result?.studyHash!==study.inputHash||result?.resultHash!==hash(Object.fromEntries(Object.entries(result).filter(([name])=>name!=='resultHash')));}
  return Object.freeze({SCHEMA,RESULT,deepFreeze,assertStudyCurrent,snapshotTask,createStudy,geodesicKm,distanceIndex,resolveDistance,rateFor,evaluatePortfolio,compare,commonDistance,solverRequest,candidateResults,isStale,hash});
});
