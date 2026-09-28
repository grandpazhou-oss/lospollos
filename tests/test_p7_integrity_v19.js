const assert=require('node:assert/strict'),fs=require('node:fs');
const root=require('node:path').resolve(__dirname,'..')+'/';
const evidence=process.env.STCT_EVIDENCE_DIR;
const F=require(root+'facility-location-mvp1-v19.js'),D=require(root+'design-data-adapter-v19.js');
(async()=>{
const c=F.createController({endpoint:'http://127.0.0.1:8791/facility-optimize-v19'});
const study=F.fromScenario(D.createSyntheticStudy({orderCount:24,depotCount:6,vehicleCount:18,seed:1910}).scenario,{facilityCounts:[1,2,3],timeLimitSeconds:10});
c.load(study);await c.run();const state=c.snapshot();
assert.deepEqual(state.recommendation.recommended.selectedSiteIds,['D2','D5']);
assert.equal(state.recommendation.recommended.cost.total,1221.9303);
const checks=['24_DEMAND_CONTROL'];
for(const v of ['', ' ',null,undefined,NaN,Infinity,[],{},true]){const s=structuredClone(study);s.sites[0].coordinate=[v,v];assert.throws(()=>F.normalizeStudy(s));}checks.push('MISSING_COORDINATES');
for(const v of [0,'0']){const s=structuredClone(study);s.sites[0].coordinate=[v,v];assert.deepEqual(F.normalizeStudy(s).sites[0].coordinate,[0,0]);}checks.push('EXPLICIT_ZERO');
for(const v of ['not-a-number','12',null,NaN,Infinity,{},[],true]){const r=structuredClone(state.resultSet);r.results[0].cost.total=v;assert.equal(F.verifyResult(study,state.matrix,r).status,'FAIL');}checks.push('INVALID_RESULT_COST_TYPES');
for(const field of ['fixedCost','handlingCostPerUnit'])for(const v of ['12',NaN,Infinity,{},[]]){const s=structuredClone(study);s.sites[0][field]=v;assert.throws(()=>F.normalizeStudy(s));}checks.push('INVALID_INPUT_COST_TYPES');
for(const [key,value,code] of [['required',true,'FACILITY_REQUIRED_SITE_MISSING'],['maxDistanceKm',.01,'FACILITY_SERVICE_LIMIT_FAILED'],['maxServiceTime',1,'FACILITY_SERVICE_LIMIT_FAILED']]){
const s=structuredClone(study);if(key==='required')s.sites[0].required=value;else s.options[key]=value;
const normalized=F.normalizeStudy(s),r=structuredClone(state.resultSet);r.studyHash=normalized.studyHash;
assert.ok(F.verifyResult(normalized,F.buildMatrix(normalized),r).issues.some(x=>x.startsWith(code)));checks.push(key);
}
const r=structuredClone(state.resultSet);r.results[0].assignments[0].distanceMeters=99999999;
assert.ok(F.verifyResult(study,state.matrix,r).issues.some(x=>x.startsWith('FACILITY_ASSIGNMENT_DISTANCE_MISMATCH')));checks.push('DISPLAY_DISTANCE_TAMPER');
assert.throws(()=>F.summarize(study,state.matrix,r,{status:'PASS'}));checks.push('PRESENTATION_REVALIDATES');
const attack=F.createController({fetch:async()=>({ok:true,json:async()=>r})});attack.load(study);await assert.rejects(()=>attack.run());assert.equal(attack.snapshot().status,'FAILED');checks.push('CONTROLLER_REJECTS_TAMPER');
if(evidence)fs.writeFileSync(evidence+'/wave0-control.json',JSON.stringify(state,null,2)+'\n');
const output={status:'PASS',checks,recommended:state.recommendation.recommended.selectedSiteIds,total:state.recommendation.recommended.cost.total};
if(evidence)fs.writeFileSync(evidence+'/wave0-results.json',JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output));
})().catch(e=>{console.error(e);process.exitCode=1});
