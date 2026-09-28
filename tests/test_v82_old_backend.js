'use strict';
const assert=require('node:assert/strict');
const Controller=require('../supply-chain-controller-v19.js');

const endpoint='http://127.0.0.1:59179/facility-optimize-v19';
let postCount=0;
const fetch=async(url,init={})=>{
  if(init.method==='POST'){postCount++;throw Error('old backend must not receive a v2 request');}
  assert.equal(url,'http://127.0.0.1:59179/health');
  return {ok:true,json:async()=>({available:true,endpoint:'http://127.0.0.1:59179',instanceId:'isolated-old-backend',startedAt:'2026-09-28T00:00:00Z',buildFingerprint:'a'.repeat(64),protocolVersion:'stct-supply-chain-jobs-v6',modelVersion:'v6-cp-sat-1',capabilities:['FACILITY','SUPPLY_CHAIN_JOBS_V6','FULL_CHAIN'],dependencies:{supplyChainReady:true},supplyChainJobsV6:true})};
};
const road=(fromNodeId,toNodeId)=>({fromNodeId,toNodeId,distanceKm:1,unit:'km',quality:'VERIFIED_ROAD',source:'SYNTHETIC_TEST',observedAt:'2026-09-28',strategy:'TEST'});
const controller=Controller.createController({endpoint,fetch});
controller.loadStudy({studyId:'OLD-BACKEND-SYNTHETIC',classification:'SYNTHETIC_TEST',coordinateUse:'UNCONFIRMED',costApplicability:{inventoryHolding:'NOT_APPLICABLE',transferTransport:'NOT_APPLICABLE'},nodes:[{nodeId:'S',role:'SUPPLIER'},{nodeId:'W',role:'DC'},{nodeId:'C',role:'CUSTOMER'}],periodDemand:[{demandId:'D',customerNodeId:'C',currentSiteId:'W',period:'P1',quantity:1.12345,unit:'m3'}],observedInbound:[{flowId:'I',fromNodeId:'S',toNodeId:'W',period:'P1',quantity:1.12345,unit:'m3'}],distanceRows:[road('S','W'),road('W','C')]});
controller.configureScenario({scenarioId:'SYNTHETIC',analysisScope:'FULL_CHAIN',type:'NETWORK_CANDIDATE',objective:'VOLUME_KM',distanceBasis:'VERIFIED_ROAD',facilityCounts:[1],sourceMode:'FREE',supplierTotalMode:'ADJUSTABLE',capacityPolicy:'UNBOUNDED_SCREENING',homogeneousDemandConfirmed:true,allowAllSupplierSiteEdgesConfirmed:true,timeLimitSeconds:5,maxCandidates:1});
controller.run().then(()=>{throw Error('v2 request must be rejected before submission');}).catch(error=>{
  assert.equal(error.code,'SUPPLY_QUANTITY_PROTOCOL_UNSUPPORTED');
  assert.equal(postCount,0);
  assert.equal(controller.snapshot().lastError.code,'SUPPLY_QUANTITY_PROTOCOL_UNSUPPORTED');
  console.log(JSON.stringify({status:'PASS',method:'ISOLATED_OLD_BACKEND_HEALTH_STUB',preflight:'SUPPLY_QUANTITY_PROTOCOL_UNSUPPORTED',postCount}));
}).catch(error=>{console.error(error.stack);process.exitCode=1;});
