'use strict';
const assert=require('node:assert/strict');
const Import=require('../supply-chain-import-v19.js');
const Intake=require('../platform-import-session-v19.js').tabularIntake;
const XLSX=require('../vendor/xlsx/xlsx.full.min.js');
const book=XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([
  ['编号','客户编号','客户名称','customerName','经度','纬度','2027-01 m3'],
  ['R1','001','Alpha','Alternate',120,30,.00001],
  ['R2','002','<img src=x>','Other',121,31,0],
  ['R3','003','Cedar','Third',122,32,2.125],
  ['R4','004','Birch','Fourth',123,33,3.25]
]),'Synthetic different headings');
const workbook=Import.inspectWorkbook(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),'SYNTHETIC.xlsx');
const profile=Intake.template(workbook),block=profile.blocks[0],sheet=workbook.sheets[0];
const raw=JSON.stringify(workbook),initial=JSON.stringify(profile);
let evidence=Intake.mappingReview(sheet,block,['demandId','customerName','longitude']);
assert.equal(evidence[0].status,'EXACT');
assert.equal(evidence[1].status,'AMBIGUOUS');
assert.deepEqual(evidence[1].candidates.map(row=>row.column),[3,4]);
assert.equal(evidence[1].required,true);
assert.equal(evidence[2].samples.length,3);
assert.equal(evidence[2].reviewedRows,4,'Full block counts are separate from three sample rows');
assert.equal(JSON.stringify(profile),initial);
block.fields.customerName=3;
evidence=Intake.mappingReview(sheet,block,['customerName','customerNodeId']);
assert.equal(evidence[0].status,'CHOSEN','An ambiguous heading chosen by the user is not claimed as an exact unique match');
assert.deepEqual(evidence[0].samples.map(row=>row.value),['Alpha','<img src=x>','Cedar']);
assert.equal(evidence[1].samples[0].value,'001','Original leading zero is preserved');
const accepted=Import.applyProfile(workbook,profile),acceptedJson=JSON.stringify(accepted),profileJson=JSON.stringify(profile);
const matched=structuredClone(block);
assert.equal(Intake.mappingReview(sheet,block,['customerName'],matched)[0].status,'PROFILE');
const changed=structuredClone(block);changed.fields.customerName=4;
assert.equal(Intake.mappingReview(sheet,changed,['customerName'],matched)[0].status,'CHOSEN');
const configured=structuredClone(block);configured.fields.statedTotal={constant:0};
assert.equal(Intake.mappingReview(sheet,configured,['statedTotal'])[0].constant,0);
assert.equal(Intake.mappingReview(sheet,configured,['statedTotal'])[0].status,'CONSTANT');
configured.constants={customerName:'Configured name'};
assert.equal(Intake.mappingReview(sheet,configured,['customerName'])[0].constant,undefined,'A selected source column takes precedence over a fallback constant, as in production import');
configured.fields.customerNodeId={column:2,prefix:'C-',fillDown:true};
assert.deepEqual(Intake.mappingReview(sheet,configured,['customerNodeId'])[0].transforms,['PREFIX','FILL_DOWN']);
assert.equal(Intake.mappingReview(sheet,configured,['customerNodeId'])[0].samples[0].value,'001');
assert.equal(JSON.stringify(workbook),raw);
assert.equal(JSON.stringify(profile),profileJson);
assert.equal(JSON.stringify(Import.applyProfile(workbook,profile)),acceptedJson,'Review projections do not alter imported quantities, identity or source data');
assert.equal(accepted.summary.periodDemandTotals.m3,5.37501);
console.log(JSON.stringify({status:'PASS',tier:'MODULE_AND_PRODUCTION_IMPORT',records:accepted.periodDemand.length,total:accepted.summary.periodDemandTotals.m3,modelUnchanged:true,sourceUnchanged:true}));
