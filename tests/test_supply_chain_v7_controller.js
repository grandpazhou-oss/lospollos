'use strict';
// Controlled asynchronous protocol vectors. These are not native solver results.
const assert=require('node:assert/strict');
const C=require('../supply-chain-controller-v19.js');
const D=require('../supply-chain-design-v19.js');
const input=id=>({studyId:id,name:id,classification:'SYNTHETIC',nodes:[{nodeId:'A',role:'DC',name:'Warehouse',coordinate:[120,30]},{nodeId:'C',role:'CUSTOMER',name:'Customer',coordinate:[121,30]}],periodDemand:[{demandId:'D',customerNodeId:'C',currentSiteId:'A',period:'P1',quantity:5,unit:'m3'}],coordinateUse:'ASSUMED_WGS84_SCREENING'});
const scenario={scenarioId:'CASE',type:'NETWORK_CANDIDATE',objective:'VOLUME_KM',distanceBasis:'GEOGRAPHIC_SCREENING',facilityCounts:[1],selectedSiteIds:['A'],timeLimitSeconds:1};
const prepare=(c,id)=>{c.loadStudy(input(id));c.calculateBaseline('GEOGRAPHIC_SCREENING');c.configureScenario(scenario);};
const reply=(body,ok=true)=>({ok,json:async()=>body});
const pause=()=>new Promise(r=>setTimeout(r,0));
const healthBody={available:true,supplyChainJobsV6:true,endpoint:'http://127.0.0.1:8787',instanceId:'controlled-instance',startedAt:'2026-09-27T00:00:00Z',buildFingerprint:'a'.repeat(64),protocolVersion:'stct-supply-chain-jobs-v6',modelVersion:'v6-cp-sat-1',capabilities:['FACILITY','SUPPLY_CHAIN_JOBS_V6','UPSTREAM_ONLY','FULL_CHAIN'],dependencies:{supplyChainReady:true}};

(async()=>{
 const b=C.createController();prepare(b,'B');b.evaluateConfigured([{demandId:'D',siteId:'A'}]);b.compare();const pkg=b.exportPackage();
 for(const success of [false,true]){
  let release;const c=C.createController({fetch:()=>new Promise(r=>{release=r;})});prepare(c,'A');
  const pending=c.run().catch(e=>e.code);c.importPackage(pkg);const before=c.snapshot();release(reply(success?{}:{error:{code:'OLD_A_FAILURE'}},success));
  assert.equal(await pending,'SUPPLY_RUN_OBSOLETE');assert.deepEqual(c.snapshot(),before);assert.equal(c.viewState().scenario.objective,'VOLUME_KM');assert.equal(c.viewState().job,null);
 }
 const readonly=C.createController();prepare(readonly,'IMMUTABLE');const current=readonly.viewState(),hash=current.study.inputHash;
 assert.throws(()=>{current.study.periodDemand[0].quantity=123;},TypeError);assert.throws(()=>{current.scenario.facilityCounts.push(2);},TypeError);assert.throws(()=>{current.status='BROKEN';},TypeError);
 assert.equal(readonly.viewState().study.periodDemand[0].quantity,5);assert.equal(readonly.viewState().study.inputHash,hash);assert.equal(D.createStudy(readonly.viewState().study).inputHash,hash);
 let releaseRead,commits=0;const repo={record:(id,payload)=>({id,payload,contentHash:D.hash(payload)}),read:()=>new Promise(r=>{releaseRead=r;}),commit:async()=>{commits++;return{pointer:{}};}};
 const saving=C.createController({repository:repo});prepare(saving,'A');const save=saving.save().catch(e=>e.code);saving.importPackage(pkg);releaseRead(null);assert.equal(await save,'SUPPLY_SAVE_OBSOLETE');assert.equal(commits,0);assert.equal(saving.viewState().study.studyId,'B');
 let job,releaseCancel,cancelCount=0;
 const jobs=C.createController({fetch:async(url,init={})=>{
  if(url.endsWith('/health'))return reply(healthBody);
  if(url.endsWith('/cancel')){cancelCount++;if(cancelCount===1)return new Promise(r=>{releaseCancel=()=>r(reply({...job,status:'CANCELLED',completedAt:1}));});return reply({...job,status:'CANCELLED',completedAt:1});}
  if(init.method==='POST'){const spec=JSON.parse(init.body);job={backendInstanceId:healthBody.instanceId,backendBuildFingerprint:healthBody.buildFingerprint,jobId:'job-A',studyHash:spec.studyHash,runSpecHash:spec.runSpecHash,status:'PREPARING',results:{}};return reply(job);}
  return reply(job);
 }});prepare(jobs,'A');await jobs.health();const pending=jobs.run().catch(e=>e.code);while(!jobs.viewState().job)await pause();const cancel=jobs.cancel();jobs.importPackage(pkg);releaseCancel();await cancel;assert.equal(await pending,'SUPPLY_RUN_OBSOLETE');assert.equal(jobs.viewState().study.studyId,'B');assert.equal(jobs.viewState().status,'SNAPSHOT_READY');assert.equal(jobs.viewState().job,null);
 let specSeen;const broken=C.createController({fetch:async(url,init={})=>{if(url.endsWith('/health'))return reply(healthBody);if(init.body)specSeen=JSON.parse(init.body);return reply({backendInstanceId:healthBody.instanceId,backendBuildFingerprint:healthBody.buildFingerprint,jobId:'broken',studyHash:specSeen.studyHash,runSpecHash:specSeen.runSpecHash,status:'PREPARING',completedAt:1,results:{}});}});prepare(broken,'A');await broken.health();await assert.rejects(broken.run(),e=>e.code==='SUPPLY_JOB_PROTOCOL_INVALID');assert.equal(broken.viewState().status,'FAILED');
 // A late creation response must only cancel its own job after B is imported.
 let releaseStart,lateJob,lateCancelled=false;
 const late=C.createController({fetch:async(url,init={})=>{
  if(url.endsWith('/health'))return reply(healthBody);
  if(url.endsWith('/cancel')){lateCancelled=true;return reply({...lateJob,status:'CANCELLED'});}
  if(init.method==='POST'){const spec=JSON.parse(init.body);lateJob={backendInstanceId:healthBody.instanceId,backendBuildFingerprint:healthBody.buildFingerprint,jobId:'late-A',studyHash:spec.studyHash,runSpecHash:spec.runSpecHash,status:'PREPARING'};return new Promise(r=>{releaseStart=()=>r(reply(lateJob));});}
  return reply(lateJob);
 }});prepare(late,'A');await late.health();const creation=late.run().catch(e=>e.code);while(!releaseStart)await pause();late.importPackage(pkg);const bState=late.snapshot();releaseStart();assert.equal(await creation,'SUPPLY_RUN_OBSOLETE');assert.ok(lateCancelled);assert.deepEqual(late.snapshot(),bState);
 // A responsive but never-terminal service still has a client-side total deadline.
 let stuckJob,cancelledStuck=false;
 const stuck=C.createController({fetch:async(url,init={})=>{
  if(url.endsWith('/health'))return reply(healthBody);
  if(url.endsWith('/cancel')){cancelledStuck=true;return reply({...stuckJob,status:'CANCELLED'});}
  if(init.method==='POST'){const spec=JSON.parse(init.body);stuckJob={backendInstanceId:healthBody.instanceId,backendBuildFingerprint:healthBody.buildFingerprint,jobId:'stuck',studyHash:spec.studyHash,runSpecHash:spec.runSpecHash,status:'PREPARING'};}
  return reply(stuckJob);
 }});prepare(stuck,'DEADLINE');await stuck.health();const started=performance.now();await assert.rejects(stuck.run(),e=>e.code==='SUPPLY_RUN_DEADLINE_EXCEEDED');const elapsed=performance.now()-started;assert.ok(elapsed>=5900&&elapsed<8500,{elapsed});assert.ok(cancelledStuck);assert.equal(stuck.viewState().status,'FAILED');
 console.log(JSON.stringify({status:'PASS',method:'CONTROLLED_ASYNC_AND_MUTABILITY_VECTORS_NOT_SOLVER',checks:['late_success','late_failure','import_restores_scenario','nested_study_readonly','scenario_readonly','late_save','late_cancel','completedAt_terminal_invariant','late_creation_cancel_identity','responsive_nonterminal_total_deadline']}));
})().catch(e=>{console.error(e);process.exitCode=1;});
