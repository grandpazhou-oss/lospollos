'use strict';
const assert=require('node:assert/strict');
const Data=require('../design-data-adapter-v19.js');
const Facility=require('../facility-location-mvp1-v19.js');

const scenario=Data.createSyntheticStudy({orderCount:12,depotCount:5,vehicleCount:20}).scenario;
const study=Facility.fromScenario(scenario,{facilityCounts:[1,2,3]});
const matrix=Facility.buildMatrix(study),preflight=Facility.preflight(study,matrix),request=Facility.createRequest(study,matrix);
assert.equal(preflight.status,'PASS');
assert.equal(matrix.rows.length,60);
assert.equal(matrix.role,'STRATEGIC_FACILITY_TO_DEMAND_ONLY');
assert.match(matrix.disclaimer,/not navigation/);
assert.equal(request.options.facilityCounts.length,3);
assert.deepEqual(request.options.currentPortfolioSiteIds,scenario.depots.map(row=>row.depotId));
assert.equal(request.sites.some(row=>row.operationalTemplate),false);

assert.throws(()=>Facility.normalizeStudy({...study,coordinateSystem:'GCJ02'}),{code:'FACILITY_WGS84_REQUIRED'});
assert.throws(()=>Facility.normalizeStudy({...study,costPeriods:['MONTH','YEAR']}),{code:'FACILITY_PERIOD_CONVERSION_UNSUPPORTED'});
const badCoordinate=structuredClone(study);badCoordinate.sites[0].coordinate=[39,117];assert.throws(()=>Facility.normalizeStudy(badCoordinate),{code:'FACILITY_SITE_COORDINATE_INVALID'});
const negativeDemand=structuredClone(study);negativeDemand.demands[0].demand.volume=-1;assert.throws(()=>Facility.normalizeStudy(negativeDemand),{code:'FACILITY_DEMAND_INVALID'});
const duplicate=structuredClone(study);duplicate.sites[1].siteId=duplicate.sites[0].siteId;assert.throws(()=>Facility.normalizeStudy(duplicate),{code:'FACILITY_DUPLICATE_ID'});
const missingFixed=structuredClone(study);delete missingFixed.sites[0].fixedCost;assert.throws(()=>Facility.normalizeStudy(missingFixed),{code:'FACILITY_FIXED_COST_REQUIRED'});
assert.throws(()=>Facility.normalizeStudy({...study,costParameters:[{costKey:'USD',currency:'USD',period:'MODEL_RUN'}]}),{code:'FACILITY_MIXED_CURRENCY_UNSUPPORTED'});
assert.throws(()=>Facility.normalizeStudy({...study,costParameters:[{costKey:'MONTH',currency:'CNY',period:'MONTH'}]}),{code:'FACILITY_PERIOD_CONVERSION_UNSUPPORTED'});
const incomplete=structuredClone(study);incomplete.matrix={mode:'IMPORTED_IMPEDANCE_MATRIX',providerId:'TEST',rows:matrix.rows.slice(1)};assert.throws(()=>Facility.buildMatrix(incomplete),{code:'FACILITY_MATRIX_GRID_INCOMPLETE'});

const fake={schemaVersion:Facility.RESULT_SCHEMA,studyHash:study.studyHash,engine:{id:'OR_TOOLS_CP_SAT'},results:[{facilityCount:1,rank:1,status:'OPTIMAL',selectedSiteIds:[study.sites[0].siteId],assignments:study.demands.map(row=>({demandId:row.demandId,siteId:study.sites[0].siteId})),cost:{total:0,fixed:0,handling:0,transport:0},objectiveValue:0,bestBound:0}]};
assert.equal(Facility.verifyResult(study,matrix,fake).status,'FAIL');
console.log(JSON.stringify({suite:'FACILITY_MVP1_CONTRACT',status:'PASS',checks:15},null,2));
