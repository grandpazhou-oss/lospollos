'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Intake=require('../platform-import-session-v19.js'),Facility=require('../facility-location-mvp1-v19.js');
(async()=>{
 const file=process.env.STCT_UX_FACILITY_FILE;if(!file)throw Error('STCT_UX_FACILITY_FILE is required');
 const bytes=fs.readFileSync(file),session=await Intake.readFiles([{name:path.basename(file),size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)}]);
 const input=Intake.facilityStudy(session,{confirmed:true,coordinateSystem:'WGS84',classification:'SYNTHETIC',observationPeriod:'MONTH',basis:'volume',volumeUnit:'m3',currency:'CNY',costPeriod:'MONTH',transportRate:1,siteCount:1});
 const c=Facility.createController({endpoint:process.env.FACILITY_URL});c.load(input);await c.run();const state=c.snapshot(),before=Facility.hash(state);
 assert.equal(state.status,'RESULT_READY');assert.equal(state.verification.status,'PASS');assert.deepEqual(state.recommendation.recommended.selectedSiteIds,['S2']);
 assert.equal(state.study.demands.reduce((sum,d)=>sum+d.demand.volume,0),3.75);assert.equal(state.recommendation.recommended.cost.total,192.22);
 const html=c.exportRecommendation('html'),json=c.exportRecommendation('json'),csv=c.exportRecommendation('csv');assert.match(html,/<h2>Pine<\/h2>/);assert.match(html,/192\.2 CNY/);assert.match(html,/table-scroll/);assert.match(csv,/192\.22/);assert.equal(JSON.parse(json).recommendation.recommended.cost.total,192.22);assert.equal(Facility.hash(c.snapshot()),before);
 if(process.env.STCT_UX_EVIDENCE){fs.writeFileSync(path.join(process.env.STCT_UX_EVIDENCE,'FACILITY-NATIVE.html'),html);fs.writeFileSync(path.join(process.env.STCT_UX_EVIDENCE,'FACILITY-NATIVE.json'),json);fs.writeFileSync(path.join(process.env.STCT_UX_EVIDENCE,'FACILITY-NATIVE.csv'),csv);}
 console.log(JSON.stringify({status:'PASS',method:'NATIVE_CP_SAT_INDEPENDENT_VERIFICATION_AND_NATIVE_EXPORT',quantity:3.75,rawCost:192.22,displayCost:192.2,studyHash:state.study.studyHash,resultHash:state.resultSet.resultSetHash,mutation:false,browserDownload:false}));
})().catch(error=>{console.error(error);process.exitCode=1;});
