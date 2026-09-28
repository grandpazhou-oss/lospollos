'use strict';
const assert=require('node:assert/strict');
const Design=require('../supply-chain-design-v19.js');
const Report=require('../supply-chain-report-v19.js');
const {spawnSync}=require('node:child_process');

const rate=(kind,amount,basis)=>({kind,amount,basis,status:'KNOWN'});
const road=(fromNodeId,toNodeId,distanceKm)=>({fromNodeId,toNodeId,distanceKm,unit:'km',quality:'VERIFIED_ROAD',source:'INDEPENDENT_TEST_MATRIX',observedAt:'2026-09-25',strategy:'TEST'});
const input={studyId:'SMALL-INDEPENDENT',name:'Independent two-end case',classification:'SYNTHETIC_TEST',currency:'CNY',coordinateUse:'UNCONFIRMED',costApplicability:{inventoryHolding:'NOT_APPLICABLE',transferTransport:'NOT_APPLICABLE'},nodes:[
  {nodeId:'F',role:'FACTORY',coordinate:null},
  {nodeId:'A',role:'DC',coordinate:null,capacityByPeriod:{'2026-01':20,'2026-02':20}},
  {nodeId:'B',role:'DC',coordinate:null,capacityByPeriod:{'2026-01':20,'2026-02':20}},
  {nodeId:'C',role:'CUSTOMER',coordinate:null}
],periodDemand:[
  {demandId:'D',customerNodeId:'C',period:'2026-01',quantity:10,unit:'m3',currentSiteId:'A',source:{sheet:'S',rowNumber:2}},
  {demandId:'D',customerNodeId:'C',period:'2026-02',quantity:10,unit:'m3',currentSiteId:'A',source:{sheet:'S',rowNumber:2}}
],observedInbound:[
  {flowId:'I1',fromNodeId:'F',toNodeId:'A',period:'2026-01',quantity:10,unit:'m3',source:{sheet:'I',rowNumber:3}},
  {flowId:'I2',fromNodeId:'F',toNodeId:'A',period:'2026-02',quantity:10,unit:'m3',source:{sheet:'I',rowNumber:3}}
],distanceRows:[road('F','A',2),road('F','B',30),road('A','C',10),road('B','C',5),road('F','C',12),road('A','B',3)],rates:[rate('OUTBOUND_TRANSPORT',1,'PER_UNIT_KM'),rate('INBOUND_TRANSPORT',1,'PER_UNIT_KM'),rate('DIRECT_TRANSPORT',1,'PER_UNIT_KM'),rate('TRANSFER_TRANSPORT',2,'PER_UNIT_KM'),rate('FIXED_OPERATING',0,'PER_PERIOD'),rate('HANDLING',0,'PER_UNIT')]};
const study=Design.createStudy(input),baseline=Design.evaluatePortfolio(study,{type:'OBSERVED_BASELINE',distanceBasis:'VERIFIED_ROAD'});
assert.equal(baseline.status,'EVALUATED');
assert.equal(baseline.metrics.outbound.weightedDistanceKm,10);
assert.equal(baseline.metrics.inbound.weightedDistanceKm,2);
assert.equal(baseline.metrics.steadyStateCost,240);
const candidate=Design.evaluatePortfolio(study,{scenarioId:'B-SITE',type:'NETWORK_CANDIDATE',selectedSiteIds:['B'],distanceBasis:'VERIFIED_ROAD',sourcePlan:[{sourceNodeId:'F',siteNodeId:'B',share:1}],oneTimeConversionCost:50},[{demandId:'D',siteNodeId:'B'}]);
assert.equal(candidate.status,'EVALUATED');
assert.equal(candidate.metrics.outbound.weightedDistanceKm,5);
assert.equal(candidate.metrics.inbound.weightedDistanceKm,30);
assert.equal(candidate.metrics.steadyStateCost,700);
assert.equal(candidate.metrics.firstPeriodCost,400);
assert.ok(Design.evaluatePortfolio(study,{scenarioId:'SOURCE-BLOCKED',type:'NETWORK_CANDIDATE',selectedSiteIds:['B'],distanceBasis:'VERIFIED_ROAD',allowedSourcesBySite:{B:[]},sourcePlan:[{sourceNodeId:'F',siteNodeId:'B',share:1}]},[{demandId:'D',siteNodeId:'B'}]).issues.some(row=>row.code==='SUPPLY_SOURCE_UNQUALIFIED'));
assert.throws(()=>Design.solverRequest(study,{facilityCounts:[1],distanceBasis:'VERIFIED_ROAD',allowedSourcesBySite:{B:[]},sourcePlan:[{sourceNodeId:'F',siteNodeId:'B',share:1}]}),{code:'SUPPLY_SOURCE_UNQUALIFIED'});
assert.ok(Design.evaluatePortfolio(study,{scenarioId:'TIME-UNKNOWN',type:'NETWORK_CANDIDATE',selectedSiteIds:['B'],distanceBasis:'VERIFIED_ROAD',maxServiceSeconds:300,sourcePlan:[{sourceNodeId:'F',siteNodeId:'B',share:1}]},[{demandId:'D',siteNodeId:'B'}]).issues.some(row=>row.code==='SUPPLY_TIME_DATA_MISSING'));
assert.throws(()=>Design.solverRequest(study,{facilityCounts:[1],distanceBasis:'VERIFIED_ROAD',maxServiceSeconds:300}),{code:'SUPPLY_SOLVER_TIME_DATA_INCOMPLETE'});
const comparison=Design.compare(study,baseline,candidate);
assert.equal(comparison.outboundDistanceChangeRate,-0.5);
assert.ok(comparison.steadyStateImprovementRate<0);
const direct=Design.evaluatePortfolio(study,{scenarioId:'DIRECT',type:'NETWORK_CANDIDATE',distanceBasis:'VERIFIED_ROAD',directSourceByDemand:{D:'F'},oneTimeConversionCost:0});
assert.equal(direct.status,'EVALUATED');
assert.equal(direct.metrics.steadyStateCost,240);
assert.equal(direct.metrics.costParts.inboundTransport,0);
assert.equal(direct.outbound[0].kind,'DIRECT');
const transferStudy=Design.createStudy({...input,costApplicability:{...input.costApplicability,transferTransport:'APPLICABLE'}});
const transferred=Design.evaluatePortfolio(transferStudy,{scenarioId:'TRANSFER',type:'NETWORK_CANDIDATE',distanceBasis:'VERIFIED_ROAD',selectedSiteIds:['B'],sourcePlan:[{sourceNodeId:'F',siteNodeId:'B',share:1}],transferPlan:[{fromNodeId:'A',toNodeId:'B',quantityByPeriod:{'2026-01':1,'2026-02':1}}],oneTimeConversionCost:0},[{demandId:'D',siteNodeId:'B'}]);
assert.equal(transferred.metrics.costParts.transferTransport,12);
assert.equal(transferred.transfer.length,2);
assert.throws(()=>Design.solverRequest(study,{objective:'COST',facilityCounts:[1],distanceBasis:'VERIFIED_ROAD',transferPlan:[{fromNodeId:'A',toNodeId:'B'}]}),{code:'SUPPLY_COST_OBJECTIVE_TRANSFER_NOT_MODELED'});
const snapshot=Report.createSnapshot(study,baseline,[candidate]);
assert.ok(Object.isFrozen(snapshot.explanation.rows[0].siteLoads[0].periods[0]));
assert.match(Report.toMarkdown(study,snapshot),/入库物量公里/);
assert.match(Report.toCsv(study,snapshot),/INDEPENDENT_TEST_MATRIX/);
assert.match(Report.toHtml(study,snapshot),/A → B/);
assert.doesNotMatch(Report.toHtml(study,snapshot),/F → B/);
assert.match(Report.toCsv(study,snapshot),/"F","B"/);
assert.equal(JSON.parse(Report.toJson(study,snapshot)).snapshot.snapshotHash,snapshot.snapshotHash);
assert.equal(snapshot.recommendation,null);
assert.equal(snapshot.rankingScope,'NO_CANDIDATE_BEATS_OBSERVED_BASELINE');
assert.match(Report.toMarkdown(study,snapshot),/没有候选在完整可比稳态成本上优于真实现状/);
const noAssignment=Design.createStudy({...input,periodDemand:input.periodDemand.map(row=>({...row,currentSiteId:null}))});
assert.ok(Design.evaluatePortfolio(noAssignment,{type:'OBSERVED_BASELINE'}).issues.some(row=>row.code==='SUPPLY_OBSERVED_ASSIGNMENT_MISSING'));
const peak=Design.createStudy({...input,nodes:input.nodes.map(row=>row.nodeId==='B'?{...row,capacityByPeriod:{'2026-01':20,'2026-02':5}}:row)});
assert.ok(Design.evaluatePortfolio(peak,{scenarioId:'PEAK',type:'NETWORK_CANDIDATE',selectedSiteIds:['B'],distanceBasis:'VERIFIED_ROAD',sourcePlan:[{sourceNodeId:'F',siteNodeId:'B',share:1}]},[{demandId:'D',siteNodeId:'B'}]).issues.some(row=>row.code==='SUPPLY_PERIOD_CAPACITY_EXCEEDED'&&row.period==='2026-02'));
const missing=Design.createStudy({...input,distanceRows:[],rates:[]});
const missingResult=Design.evaluatePortfolio(missing,{type:'OBSERVED_BASELINE'});
assert.equal(missingResult.metrics.outbound.weightedDistanceKm,null);
assert.equal(missingResult.metrics.steadyStateCost,null);
assert.throws(()=>Design.solverRequest(missing,{facilityCounts:[1],distanceBasis:'VERIFIED_ROAD'}),{code:'SUPPLY_SOLVER_DISTANCE_INCOMPLETE'});
const changed=Design.createStudy({...input,rates:[...input.rates,rate('INVENTORY_HOLDING',2,'PER_UNIT')]});
assert.throws(()=>Report.toJson(changed,snapshot),{code:'SUPPLY_SNAPSHOT_STALE'});
const generationScenario={type:'NETWORK_CANDIDATE',facilityCounts:[1,2],distanceBasis:'VERIFIED_ROAD',sourcePlan:[{sourceNodeId:'F',siteNodeId:'A',share:1},{sourceNodeId:'F',siteNodeId:'B',share:1}]};
const request=Design.solverRequest(study,generationScenario);
const fixedSiteRequest=Design.solverRequest(study,{type:'FIXED_SITE_REASSIGNMENT',selectedSiteIds:['A'],facilityCounts:[1],distanceBasis:'VERIFIED_ROAD'});
assert.equal(fixedSiteRequest.payload.sites.find(row=>row.siteId==='A').status,'REQUIRED_OPEN');
assert.equal(fixedSiteRequest.payload.sites.find(row=>row.siteId==='B').status,'FORBIDDEN');
assert.throws(()=>Design.solverRequest(study,{type:'FIXED_SITE_REASSIGNMENT',facilityCounts:[1],distanceBasis:'VERIFIED_ROAD'}),{code:'SUPPLY_FIXED_SITE_SET_REQUIRED'});
assert.throws(()=>Design.evaluatePortfolio(study,{type:'FIXED_SITE_REASSIGNMENT',distanceBasis:'VERIFIED_ROAD'},[{demandId:'D',siteNodeId:'A'}]),{code:'SUPPLY_FIXED_SITE_SET_REQUIRED'});
assert.ok(Design.evaluatePortfolio(study,{type:'FIXED_SITE_REASSIGNMENT',selectedSiteIds:['A'],distanceBasis:'VERIFIED_ROAD'},[{demandId:'D',siteNodeId:'B'}]).issues.some(row=>row.code==='SUPPLY_ASSIGNMENT_SITE_CLOSED'));
const script=`import json,sys\nfrom ortools.sat.python import cp_model\nfrom facility_mvp1 import solve_facility\nimport ortools\nprint(json.dumps(solve_facility(json.load(sys.stdin),cp_model,ortools.__version__)))`;
const solve=spawnSync('python3',['-c',script],{cwd:require('node:path').join(__dirname,'../optimizer'),input:JSON.stringify(request.payload),encoding:'utf8'});
assert.equal(solve.status,0,solve.stderr);
const result=JSON.parse(solve.stdout),candidates=Design.candidateResults(study,generationScenario,result);
assert.ok(candidates.length>=1);
assert.ok(candidates.every(row=>row.solverEvidence?.engine?.id==='OR_TOOLS_CP_SAT'));
const tampered=structuredClone(result);tampered.results[0].assignments[0].distanceMeters+=1;
assert.throws(()=>Design.candidateResults(study,generationScenario,tampered),{code:'SUPPLY_SOLVER_RESULT_INVALID'});
const costScenario={objective:'COST',facilityCounts:[1],distanceBasis:'VERIFIED_ROAD',sourcePlan:[{sourceNodeId:'F',siteNodeId:'A',share:1},{sourceNodeId:'F',siteNodeId:'B',share:1}]};
const costRequest=Design.solverRequest(study,costScenario);
const costSolve=spawnSync('python3',['-c',script],{cwd:require('node:path').join(__dirname,'../optimizer'),input:JSON.stringify(costRequest.payload),encoding:'utf8'});
assert.equal(costSolve.status,0,costSolve.stderr);
assert.equal(JSON.parse(costSolve.stdout).results[0].selectedSiteIds[0],'A');
const outboundRequest=Design.solverRequest(study,{objective:'VOLUME_KM',facilityCounts:[1],distanceBasis:'VERIFIED_ROAD'});
const outboundSolve=spawnSync('python3',['-c',script],{cwd:require('node:path').join(__dirname,'../optimizer'),input:JSON.stringify(outboundRequest.payload),encoding:'utf8'});
assert.equal(outboundSolve.status,0,outboundSolve.stderr);
assert.equal(JSON.parse(outboundSolve.stdout).results[0].selectedSiteIds[0],'B');
console.log(JSON.stringify({suite:'SUPPLY_CHAIN_DESIGN_V19',status:'PASS',baseline:baseline.metrics.steadyStateCost,candidate:candidate.metrics.steadyStateCost,realSolverCandidates:candidates.length}));
