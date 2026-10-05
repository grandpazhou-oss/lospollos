'use strict';
const assert=require('node:assert/strict'),Import=require('../supply-chain-import-v19.js'),{tabularIntake:T}=require('../platform-import-session-v19.js');
const wb=Import.inspectWorkbook(Buffer.from('customerNumber,customer,2026-01m3\n001,Alpha,5'),'required.csv'),p=T.template(wb),before=JSON.stringify(wb);
assert.equal(p.blocks[0].fields.customerNodeId,1);
assert.throws(()=>Import.applyProfile(wb,p),e=>e.code==='SC_PROFILE_REQUIRED_FIELD_UNMAPPED'&&e.detail.field==='demandId'&&e.detail.blockIndex===0);
assert.throws(()=>Import.applyProfile(wb,p,{tolerant:true}),{code:'SC_PROFILE_REQUIRED_FIELD_UNMAPPED'});
p.blocks[0].fields.demandId=1;const result=Import.applyProfile(wb,p);assert.equal(result.periodDemand.length,1);assert.equal(result.periodDemand[0].quantity,5);assert.equal(result.periodDemand[0].customerNodeId,'001');assert.equal(JSON.stringify(wb),before);
console.log('PASS: missing required mapping stops block exclusion; business column correction preserves ID, quantity and source');

const original=Import.inspectWorkbook(Buffer.from('编号,客户名称,2026-01m3\nD,Alpha,5'),'roll.csv'),saved=T.template(original);saved.matchSignature=Import.profileSignature(original,saved);const kg=Import.inspectWorkbook(Buffer.from('编号,客户名称,2026-02kg\nD,Alpha,5'),'roll.csv'),rolled=Import.matchProfile(kg,saved);assert.throws(()=>Import.applyProfile(kg,rolled.profile),{code:'SC_PROFILE_PRIMARY_MEASURE_UNAVAILABLE'});rolled.profile.blocks[0].primaryMeasure='weight';const recovered=Import.applyProfile(kg,rolled.profile);assert.equal(recovered.periodDemand[0].unit,'kg');assert.equal(recovered.periodDemand[0].quantity,5);console.log('PASS: changed measure requires explicit confirmation, never silently excludes a block or converts units');
