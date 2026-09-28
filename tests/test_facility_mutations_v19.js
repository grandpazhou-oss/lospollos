'use strict';
const assert=require('node:assert/strict');
const Data=require('../design-data-adapter-v19.js');
const Facility=require('../facility-location-mvp1-v19.js');

(async()=>{
  const study=Facility.fromScenario(Data.createSyntheticStudy({orderCount:12,depotCount:5,vehicleCount:20}).scenario,{facilityCounts:[1,2,3]}),controller=Facility.createController({endpoint:process.env.FACILITY_URL||'http://127.0.0.1:8791/facility-optimize-v19'});controller.load(study);await controller.run();const state=controller.snapshot(),result=state.resultSet.results.find(row=>row.rank===1&&row.status==='OPTIMAL');
  const capacity=structuredClone(state.study),site=capacity.sites.find(row=>row.siteId===result.selectedSiteIds[0]);site.capacity={quantity:0,weight:0,volume:0};assert.equal(Facility.verifyResult(capacity,Facility.buildMatrix(capacity),state.resultSet).status,'FAIL');
  const closed=structuredClone(state.study);closed.sites.find(row=>row.siteId===result.selectedSiteIds[0]).status='FORBIDDEN';assert.equal(Facility.verifyResult(closed,Facility.buildMatrix(closed),state.resultSet).status,'FAIL');
  const missing=structuredClone(state.study);missing.matrix={mode:'IMPORTED_IMPEDANCE_MATRIX',providerId:'SYNTHETIC_MUTATION',rows:state.matrix.rows.slice(1)};assert.throws(()=>Facility.buildMatrix(missing),{code:'FACILITY_MATRIX_GRID_INCOMPLETE'});
  const fee=structuredClone(state.study);fee.sites.find(row=>row.siteId===result.selectedSiteIds[0]).fixedCost+=999;assert.equal(Facility.verifyResult(fee,Facility.buildMatrix(fee),state.resultSet).status,'FAIL');
  const service=structuredClone(state.resultSet);service.results.find(row=>row.portfolioHash===result.portfolioHash).serviceRate=.1;assert.ok(Facility.verifyResult(state.study,state.matrix,service).issues.some(code=>code.startsWith('FACILITY_REPORTED_SERVICE_MISMATCH')));
  console.log(JSON.stringify({suite:'FACILITY_MVP1_MUTATIONS',status:'PASS',mutations:['CAPACITY','FORBIDDEN_SITE','MISSING_MATRIX_GRID','FIXED_FEE','FAKE_SERVICE']},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
