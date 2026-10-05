'use strict';
// Narrow unit regressions: real controller + real road client, synthetic domain/HTTP/storage.
// Run the companion browser test for native IndexedDB; neither is OR-Tools acceptance.
const assert=require('node:assert/strict');
const test=require('node:test');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const F=require('./enterprise_hardening_fixture.js');
const root=path.resolve(process.env.STCT_HARDENING_SOURCE_ROOT||path.join(__dirname,'..'));
const controllerSource=fs.readFileSync(path.join(root,'supply-chain-controller-v19.js'),'utf8');
const Road=require(path.join(root,'local-road-client-v86.js'));
function controller(repository=F.memoryRepository(),options={}){
  const sandbox={structuredClone,performance,URL,AbortController,setTimeout,clearTimeout,console,document:{}};
  F.installGlobals(sandbox);sandbox.STCTPlatformV19.localRoadClient=Road;
  vm.runInNewContext(controllerSource,sandbox,{filename:'supply-chain-controller-v19.js'});
  return sandbox.STCTPlatformV19.supplyChainController.createController({repository,endpoint:'http://127.0.0.1:8887/facility-optimize-v19',...options});
}
const conflict=error=>error?.code==='REVISION_CONFLICT';
async function seed(repo){const c=controller(repo);c.loadStudy(F.makeStudy());await c.save();return c;}
for(const [label,full,same] of [['draft with changed content',false,false],['identical draft',false,true],['full package with changed content',true,false]]){
  test('same-ID import rejects '+label,async()=>{
    const repo=F.memoryRepository();await seed(repo);
    const before=await repo.read('pointers','SUPPLY:A'),records=await repo.read('supplyStudies'),count=repo.commits;
    const c=controller(repo);c.importPackage(F.makePackage(F.makeStudy('A',same?'Original':'Imported'),full));
    await assert.rejects(c.save(),conflict);
    assert.deepEqual(await repo.read('pointers','SUPPLY:A'),before);
    assert.deepEqual(await repo.read('supplyStudies'),records);
    assert.equal(repo.commits,count);assert.equal(c.viewState().savedPointer,null);
  });
}
test('new ID can save; reopened session can edit and save',async()=>{
  const repo=F.memoryRepository();await seed(repo);const c=controller(repo);
  await c.reopen('SUPPLY:A');c.updateStudy({name:'Edited'});const saved=await c.save();
  assert.equal(saved.pointer.revision,2);assert.equal(saved.pointer.name,'Edited');
  c.loadStudy(F.makeStudy('B'));assert.equal((await c.save()).pointer.revision,1);
  assert.equal((await repo.read('pointers','SUPPLY:A')).name,'Edited');
});
test('stale bound session cannot overwrite a newer revision',async()=>{
  const repo=F.memoryRepository();await seed(repo);const a=controller(repo),b=controller(repo);
  await a.reopen('SUPPLY:A');await b.reopen('SUPPLY:A');a.updateStudy({name:'First'});await a.save();
  b.updateStudy({name:'Second'});await assert.rejects(b.save(),conflict);
  assert.equal((await repo.read('pointers','SUPPLY:A')).name,'First');
});
test('tombstoned study cannot be resurrected by an import',async()=>{
  const repo=F.memoryRepository(),c=await seed(repo);await c.deleteStudy('SUPPLY:A');
  const imported=controller(repo);imported.importPackage(F.makePackage(F.makeStudy()));
  await assert.rejects(imported.save(),conflict);assert.equal((await repo.read('pointers','SUPPLY:A')).deleted,true);
});
test('simultaneous unbound creates preserve repository CAS',async()=>{
  const repo=F.memoryRepository(),a=controller(repo),b=controller(repo);a.loadStudy(F.makeStudy());b.loadStudy(F.makeStudy());
  const results=await Promise.allSettled([a.save(),b.save()]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected'&&conflict(r.reason)).length,1);
});
test('changing study while save reads its pointer aborts the stale save',async()=>{
  const repo=F.memoryRepository();let release;const read=repo.read.bind(repo);
  repo.read=async(...args)=>{await new Promise(resolve=>{release=resolve;});return read(...args);};
  const c=controller(repo);c.loadStudy(F.makeStudy());const pending=c.save();
  c.loadStudy(F.makeStudy('B'));release();await assert.rejects(pending,e=>e.code==='SUPPLY_SAVE_OBSOLETE');
  assert.equal(repo.commits,0);assert.equal(c.viewState().study.studyId,'B');
});
function healthController(options={},body=F.healthBody()){
  return controller(undefined,{expectedBuildFingerprint:F.fingerprint,fetch:async()=>({ok:true,json:async()=>body}),...options});
}
test('default STRICT_PINNED admits the expected build',async()=>{
  const result=await healthController().health();assert.equal(result.available,true);assert.equal(result.buildPolicy,'STRICT_PINNED');assert.equal(result.buildMatch,true);
});
for(const [label,options,reason] of [
  ['mismatch',{expectedBuildFingerprint:'b'.repeat(64)},'BUILD_FINGERPRINT_MISMATCH'],
  ['missing pin',{expectedBuildFingerprint:null},'EXPECTED_BUILD_FINGERPRINT_REQUIRED'],
  ['malformed pin',{expectedBuildFingerprint:'x'},'EXPECTED_BUILD_FINGERPRINT_REQUIRED'],
  ['unknown policy',{buildPolicy:'PERMISSIVE'},'BUILD_POLICY_INVALID']
])test('strict admission rejects '+label,async()=>{const r=await healthController(options).health();assert.equal(r.available,false);assert.equal(r.reason,reason);assert.equal(r.jobsV6,false);});
test('explicit compatibility mode records the mismatch',async()=>{
  const r=await healthController({expectedBuildFingerprint:'b'.repeat(64),buildPolicy:'COMPATIBLE_WARN'}).health();
  assert.equal(r.available,true);assert.equal(r.buildMatch,false);assert.equal(r.compatibility,'COMPATIBLE_BUILD_DIFFERS');
});
test('explicit compatibility mode never calls an absent pin a match',async()=>{
  const r=await healthController({expectedBuildFingerprint:null,buildPolicy:'COMPATIBLE_WARN'}).health();
  assert.equal(r.available,true);assert.equal(r.buildMatch,false);assert.equal(r.compatibility,'COMPATIBLE_BUILD_UNPINNED');
});
for(const [label,patch] of [['wrong endpoint',{endpoint:'http://127.0.0.1:9999'}],['missing dependency',{dependencies:{supplyChainReady:false}}],['missing capability',{capabilities:['FACILITY']}],['wrong model',{modelVersion:'other'}]]){
  test('compatibility mode still rejects '+label,async()=>assert.equal((await healthController({buildPolicy:'COMPATIBLE_WARN'},F.healthBody(patch)).health()).available,false));
}
test('run cannot POST after build admission fails',async()=>{
  let posts=0;const c=healthController({expectedBuildFingerprint:'b'.repeat(64),fetch:async(_,init)=>{if(init?.method==='POST')posts++;return {ok:true,json:async()=>F.healthBody()};}});
  c.loadStudy(F.makeStudy());c.configureScenario({analysisScope:'OUTBOUND_ONLY',scenarioId:'TEST'});
  await assert.rejects(c.run(),e=>e.code==='SUPPLY_SERVICE_INCOMPATIBLE');assert.equal(posts,0);
});
const from=[120,30],to=[120.01,30.01],roadConfig={roadNetworkVersion:'synthetic-network-v1'};
async function roadRow(){return Road.route([from,to],{...roadConfig,coordinateUse:'WGS84',fetch:async()=>({ok:true,json:async()=>({code:'Ok',routes:[{distance:2000,duration:200}],waypoints:[{location:from,distance:0},{location:to,distance:0}]})})});}
test('fresh directed road evidence can be reused without promoting its quality',async()=>{
  const row=await roadRow();assert.equal(Road.reuseAssessment(row,from,to,'WGS84',roadConfig).reusable,true);assert.equal(row.quality,'ESTIMATED_ROAD');assert.equal(row.evidence.truckRestrictions,'NOT_VERIFIED');
});
for(const [label,mutate] of [
  ['network version',r=>r.evidence.networkVersion='other'],
  ['profile',r=>r.evidence.profile='truck'],
  ['endpoint',r=>r.evidence.endpoint='http://127.0.0.1:5002'],
  ['reversed direction',r=>r.evidence.requestedCoordinates=[to,from]],
  ['coordinate system',r=>r.evidence.coordinateUse='GCJ02'],
  ['missing evidence',r=>delete r.evidence],
  ['future time',r=>r.observedAt=new Date(Date.now()+60000).toISOString()],
  ['expired time',r=>r.observedAt='2000-01-01T00:00:00Z'],
  ['invalid metric',r=>r.distanceKm=NaN],
  ['false verified label',r=>r.quality='VERIFIED_ROAD'],
  ['snap above current policy',r=>r.evidence.snapMeters=[2000,0]],
  ['unrecorded remote snapping',r=>r.evidence.snappedCoordinates=[[121,30],to]]
])test('road reuse rejects changed '+label,async()=>{const row=await roadRow();mutate(row);assert.equal(Road.reuseAssessment(row,from,to,'WGS84',roadConfig).reusable,false);});
test('road reuse requires a configured network version',async()=>assert.equal(Road.reuseAssessment(await roadRow(),from,to,'WGS84',{}).reusable,false));
test('unsupported road profile is rejected before any request',async()=>{
  let calls=0;await assert.rejects(Road.route([from,to],{coordinateUse:'WGS84',roadProfile:'truck',fetch:()=>calls++}),e=>e.code==='ROAD_PROFILE_UNSUPPORTED');assert.equal(calls,0);
});
test('controller only offers cross-study road rows matching the current evidence policy',async()=>{
  const repo=F.memoryRepository(),source=controller(repo),row=await roadRow();source.loadStudy({...F.makeStudy('SOURCE'),distanceRows:[{...row,fromNodeId:'DC',toNodeId:'C'}]});await source.save();
  const matching=controller(repo,{roadConfig});matching.loadStudy(F.makeStudy('TARGET'));
  assert.equal((await matching.latestRoadDistancesFor(matching.viewState().study)).rows.length,1);
  const changed=controller(repo,{roadConfig:{roadNetworkVersion:'new-network'}});changed.loadStudy(F.makeStudy('TARGET2'));
  assert.equal(await changed.latestRoadDistancesFor(changed.viewState().study),null);
});
