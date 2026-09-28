'use strict';
const assert=require('node:assert/strict');
const Data=require('../design-data-adapter-v19.js');
const Facility=require('../facility-location-mvp1-v19.js');

(async()=>{
  const study=Facility.fromScenario(Data.createSyntheticStudy({orderCount:12,depotCount:5,vehicleCount:20}).scenario,{facilityCounts:[1,2,3]});
  const unavailable=Facility.createController({fetch:async()=>({ok:false,json:async()=>({error:{code:'FACILITY_ORTOOLS_UNAVAILABLE'}})})});
  unavailable.load(study);await assert.rejects(unavailable.run(),{code:'FACILITY_ORTOOLS_UNAVAILABLE'});assert.equal(unavailable.snapshot().status,'FAILED');assert.equal(unavailable.snapshot().resultSet,null);

  const delayed=Facility.createController({fetch:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true}))});
  delayed.load(study);const pending=delayed.run();await Promise.resolve();delayed.cancel();await pending;assert.equal(delayed.snapshot().status,'CANCELLED');assert.equal(delayed.snapshot().resultSet,null);await assert.rejects(delayed.save(),{code:'FACILITY_RESULT_NOT_READY'});

  const live=Facility.createController({endpoint:process.env.FACILITY_URL||'http://127.0.0.1:8791/facility-optimize-v19'});live.load(study);await live.run();assert.equal(live.snapshot().verification.status,'PASS');const changed=structuredClone(study);changed.sites[0].fixedCost+=1;live.load(changed);assert.equal(live.snapshot().status,'READY');assert.equal(live.snapshot().resultSet,null);assert.equal(live.snapshot().supersededResult.status,'STALE');
  console.log(JSON.stringify({suite:'FACILITY_MVP1_BOUNDARIES',status:'PASS',checks:['NO_SOLVER_NO_FALLBACK','CANCEL_REJECTS_LATE_RESULT','NEXT_RUN_SUCCEEDS','INPUT_CHANGE_MARKS_STALE']},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
