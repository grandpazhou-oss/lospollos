'use strict';
const assert=require('node:assert/strict');
const C=require('../supply-chain-controller-v19.js');
const endpoint='http://127.0.0.1:19095/facility-optimize-v19';
const base={available:true,supplyChainJobsV6:true,endpoint:'http://127.0.0.1:19095',instanceId:'test-instance',startedAt:'2026-09-27T00:00:00Z',buildFingerprint:'a'.repeat(64),protocolVersion:'stct-supply-chain-jobs-v6',modelVersion:'v6-cp-sat-1',capabilities:['FACILITY','SUPPLY_CHAIN_JOBS_V6','UPSTREAM_ONLY','FULL_CHAIN'],dependencies:{supplyChainReady:true}};
const make=(body,expectedBuildFingerprint)=>C.createController({endpoint,buildPolicy:'COMPATIBLE_WARN',expectedBuildFingerprint,fetch:async()=>({ok:true,json:async()=>body})});
(async()=>{
  const matched=await make(base,'a'.repeat(64)).health();
  assert.equal(matched.available,true);assert.equal(matched.compatibility,'COMPATIBLE');assert.equal(matched.endpoint,endpoint);
  const different=await make(base,'b'.repeat(64)).health();
  assert.equal(different.available,true);assert.equal(different.compatibility,'COMPATIBLE_BUILD_DIFFERS');
  const outboundOnly=structuredClone(base);outboundOnly.capabilities=['FACILITY','SUPPLY_CHAIN_JOBS_V6'];
  assert.equal((await make(outboundOnly).health('OUTBOUND_ONLY')).available,true);
  assert.equal((await make(outboundOnly).health('UPSTREAM_ONLY')).available,false);
  for(const [mutate,reason] of [
    [body=>{body.protocolVersion='old';},'PROTOCOL_OR_MODEL_MISMATCH'],
    [body=>{body.modelVersion='old';},'PROTOCOL_OR_MODEL_MISMATCH'],
    [body=>{body.capabilities=body.capabilities.filter(value=>value!=='FULL_CHAIN');},'MISSING_CAPABILITY:FULL_CHAIN'],
    [body=>{body.endpoint='http://127.0.0.1:8787';},'ENDPOINT_MISMATCH'],
    [body=>{delete body.buildFingerprint;},'INSTANCE_IDENTITY_MISSING'],
  ]){const body=structuredClone(base);mutate(body);const actual=await make(body).health('FULL_CHAIN');assert.equal(actual.available,false);assert.equal(actual.reason,reason);}
  console.log(JSON.stringify({status:'PASS',method:'CONTROLLED_HEALTH_PROTOCOL_VECTORS',checks:['actual_endpoint','instance_identity','compatible_build_difference','protocol_rejection','model_rejection','capability_rejection','endpoint_rejection','identity_rejection']}));
})().catch(error=>{console.error(error);process.exitCode=1;});
