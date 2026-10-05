'use strict';
// Real controller/domain modules and repository API; synthetic data, no solver mock presented as native.
const assert=require('node:assert/strict');
const Controller=require('../supply-chain-controller-v19.js');
const Design=require('../supply-chain-design-v19.js');
const Road=require('../local-road-client-v86.js');
global.STCTV18={networkContract:require('../network-contract-v18.js')};
const {createRepository}=require('./helpers_memrepo.js');
const input=(name='Original')=>({studyId:'HARDENING-SYNTHETIC',name,classification:'SYNTHETIC_TEST',coordinateUse:'WGS84',nodes:[{nodeId:'W',role:'DC',coordinate:[110,30]},{nodeId:'C',role:'CUSTOMER',coordinate:[111,30]}],periodDemand:[{demandId:'D',customerNodeId:'C',period:'P1',quantity:5,unit:'m3',currentSiteId:'W'}]});
let checks=0;
const check=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
(async()=>{
  const repo=createRepository(),owner=Controller.createController({repository:repo});owner.loadStudy(input());const first=await owner.save();
  for(const name of ['Original','Unrelated import']){
    const imported=Controller.createController({repository:repo});imported.loadStudy(input(name));
    await assert.rejects(()=>imported.save(),{code:'REVISION_CONFLICT'});checks++;
    check(await repo.read('pointers',first.pointer.id),first.pointer);
    const draft=imported.exportDraftPackage();const fresh=Controller.createController({repository:repo});fresh.importPackage(draft);
    await assert.rejects(()=>fresh.save(),{code:'REVISION_CONFLICT'});checks++;
    check(await repo.read('pointers',first.pointer.id),first.pointer);
  }
  // A complete verified report/package import has the same save boundary as a draft.
  owner.calculateBaseline('GEOGRAPHIC_SCREENING');owner.configureScenario({scenarioId:'C',objective:'VOLUME_KM',type:'FIXED_SITE_REASSIGNMENT',selectedSiteIds:['W'],distanceBasis:'GEOGRAPHIC_SCREENING'});owner.evaluateConfigured();owner.compare();
  const full=Controller.createController({repository:repo});full.importPackage(owner.exportPackage());
  await assert.rejects(()=>full.save(),{code:'REVISION_CONFLICT'});checks++;
  check(await repo.read('pointers',first.pointer.id),first.pointer);
  // Explicit edit sessions retain optimistic concurrency, and failed imports retain their draft.
  const edit=Controller.createController({repository:repo});await edit.reopen(first.pointer.id);edit.updateStudy({name:'Explicit edit'});await edit.save();
  owner.updateStudy({name:'Stale owner'});await assert.rejects(()=>owner.save(),{code:'REVISION_CONFLICT'});checks++;
  const branch=Controller.createController({repository:repo});branch.loadStudy({...input(),studyId:'HARDENING-BRANCH',assumptions:{branchOf:{studyId:input().studyId,inputHash:first.pointer.inputHash}}});await branch.save();check((await repo.read('pointers',first.pointer.id)).revision,2);
  await edit.deleteStudy(first.pointer.id);const deleted=await repo.read('pointers',first.pointer.id);const resurrect=Controller.createController({repository:repo});resurrect.loadStudy(input());await assert.rejects(()=>resurrect.save(),{code:'REVISION_CONFLICT'});checks++;check(await repo.read('pointers',first.pointer.id),deleted);
  // Strict mode must not send a POST for mismatched, missing or malformed pins.
  const endpoint='http://127.0.0.1:19095/facility-optimize-v19',pin='a'.repeat(64);
  const health={available:true,supplyChainJobsV6:true,endpoint:new URL(endpoint).origin,instanceId:'synthetic',startedAt:'2026-01-01T00:00:00Z',buildFingerprint:pin,protocolVersion:'stct-supply-chain-jobs-v6',modelVersion:'v6-cp-sat-1',capabilities:['FACILITY','SUPPLY_CHAIN_JOBS_V6','FULL_CHAIN','UPSTREAM_ONLY'],dependencies:{supplyChainReady:true}};
  for(const [expected,reason] of [[null,'EXPECTED_BUILD_FINGERPRINT_REQUIRED'],['bad','EXPECTED_BUILD_FINGERPRINT_REQUIRED'],['b'.repeat(64),'BUILD_FINGERPRINT_MISMATCH'],[pin,null]]){
    let posts=0;const c=Controller.createController({endpoint,buildPolicy:'STRICT_PINNED',expectedBuildFingerprint:expected,fetch:async(url,init)=>{if(init.method==='POST')posts++;return{ok:true,json:async()=>health};}});
    const status=await c.health();check(status.available,reason===null);check(status.reason,reason);
    if(reason){c.loadStudy(input());c.configureScenario({scenarioId:'J',type:'NETWORK_CANDIDATE',analysisScope:'FULL_CHAIN'});await assert.rejects(()=>c.run(),{code:'SUPPLY_SERVICE_INCOMPATIBLE'});checks++;check(posts,0);}
  }
  const warned=Controller.createController({endpoint,buildPolicy:'COMPATIBLE_WARN',expectedBuildFingerprint:'b'.repeat(64),fetch:async()=>({ok:true,json:async()=>health})});check((await warned.health()).compatibility,'COMPATIBLE_BUILD_DIFFERS');
  const invalid=Controller.createController({endpoint,buildPolicy:'TYPO',expectedBuildFingerprint:pin,fetch:async()=>({ok:true,json:async()=>health})});check((await invalid.health()).reason,'BUILD_POLICY_INVALID');
  // Road reuse is directional, versioned, profile-specific and time-bounded.
  const cfg={roadNetworkVersion:'SYNTHETIC-NETWORK',now:Date.now()},study=Design.createStudy(input());
  const road=await Road.route([[110,30],[111,30]],{...cfg,coordinateUse:'WGS84',fetch:async()=>({ok:true,json:async()=>({code:'Ok',routes:[{distance:12000,duration:900}],waypoints:[{location:[110,30],distance:0},{location:[111,30],distance:0}]})})});road.fromNodeId='W';road.toNodeId='C';cfg.now=Date.now();
  check(Road.reusable(road,study,cfg),true);
  for(const mutate of [r=>r.evidence.networkVersion='old',r=>r.evidence.profile='truck',r=>r.evidence.endpoint='http://localhost:5001',r=>delete r.evidence.requestedCoordinates,r=>r.evidence.requestedCoordinates.reverse(),r=>r.observedAt='invalid',r=>r.observedAt='2000-01-01T00:00:00Z',r=>r.observedAt='2099-01-01T00:00:00Z',r=>r.evidence.snappedCoordinates[0]=[100,20],r=>r.quality='VERIFIED_ROAD']){const r=structuredClone(road);mutate(r);check(Road.reusable(r,study,cfg),false);}
  check(Road.reusable(road,study,{...cfg,roadNetworkVersion:null}),false);
  const roadRepo=createRepository(),old=Controller.createController({repository:roadRepo});old.loadStudy({...input(),studyId:'ROAD-OLD',distanceRows:[road]});await old.save();
  const next=Controller.createController({repository:roadRepo,roadConfig:cfg});next.loadStudy({...input(),studyId:'ROAD-NEW'});check((await next.latestRoadDistancesFor(next.viewState().study)).rows.length,1);
  const wrong=Controller.createController({repository:roadRepo,roadConfig:{...cfg,roadNetworkVersion:'different'}});wrong.loadStudy({...input(),studyId:'ROAD-WRONG'});check(await wrong.latestRoadDistancesFor(wrong.viewState().study),null);
  console.log(JSON.stringify({suite:'ENTERPRISE_HARDENING',status:'PASS',checks,method:'ACTUAL_MODULES_SYNTHETIC_MEMORY_REPOSITORY',nativeSolver:false}));
})().catch(error=>{console.error(error);process.exitCode=1;});
