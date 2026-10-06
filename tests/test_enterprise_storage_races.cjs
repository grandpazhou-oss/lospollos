'use strict';
// Production controller/domain/report/repository modules with synthetic data.
// Memory storage, delayed HTTP, and delayed IDB-open are explicitly controlled
// collaborators. This file does not claim native IndexedDB or native solver coverage.
const assert = require('node:assert/strict');
const test = require('node:test');
const Controller = require('../supply-chain-controller-v19.js');
const Repository = require('../platform-repository-v19.js');
const Design = require('../supply-chain-design-v19.js');
global.STCTV18 = {networkContract: require('../network-contract-v18.js')};
const {createRepository} = require('./helpers_memrepo.js');
const endpoint = 'http://127.0.0.1:8887/facility-optimize-v19';
const fingerprint = 'a'.repeat(64);
const scenario = {scenarioId:'CANDIDATE', type:'FIXED_SITE_REASSIGNMENT', objective:'VOLUME_KM', distanceBasis:'VERIFIED_ROAD', selectedSiteIds:['A','B'], facilityCounts:[1], timeLimitSeconds:1};
const input = (studyId='STORAGE-SYNTHETIC', name='Original') => ({
  studyId, name, classification:'SYNTHETIC_TEST',
  nodes:[{nodeId:'A',role:'DC',capacityByPeriod:{P1:100}}, {nodeId:'B',role:'DC',capacityByPeriod:{P1:100}}, {nodeId:'C',role:'CUSTOMER'}],
  periodDemand:[{demandId:'D',customerNodeId:'C',currentSiteId:'A',period:'P1',quantity:5,unit:'m3'}],
  distanceRows:['A','B'].map((fromNodeId,i)=>({fromNodeId,toNodeId:'C',distanceKm:10-i*5,quality:'VERIFIED_ROAD',source:'SYNTHETIC_TEST',unit:'km'})),
  rates:[{kind:'OUTBOUND_TRANSPORT',status:'KNOWN',basis:'PER_UNIT_KM',amount:1},{kind:'FIXED_OPERATING',status:'KNOWN',basis:'PER_PERIOD',amount:0},{kind:'HANDLING',status:'KNOWN',basis:'PER_UNIT',amount:0}],
  costApplicability:{inventoryHolding:'NOT_APPLICABLE',transferTransport:'NOT_APPLICABLE'}
});
const controller = (repository, options={}) => Controller.createController({repository, endpoint, expectedBuildFingerprint:fingerprint, ...options});
const prepared = (repository) => {const c=controller(repository); c.loadStudy(input()); c.calculateBaseline(); c.configureScenario(scenario); c.evaluateConfigured([{demandId:'D',siteId:'A'}]); return c;};
const deferred = () => {let resolve; const promise=new Promise(r=>{resolve=r;}); return {promise,resolve};};
const reply = body => ({ok:true,json:async()=>body});

for (const full of [false,true]) for (const identical of [false,true]) {
  test(`${full?'full':'draft'} same-ID ${identical?'identical':'changed'} import cannot adopt a revision`, async()=>{
    const repo=createRepository(), owner=prepared(repo); if(full)owner.compare();
    const saved=await owner.save(), before=await repo.read('supplyStudies');
    const source=prepared(); if(!identical)source.updateStudy({name:'Imported content'});
    if(full){if(!identical){source.calculateBaseline();source.configureScenario(scenario);source.evaluateConfigured([{demandId:'D',siteId:'B'}]);}source.compare();}
    const imported=controller(repo); imported.importPackage(full?source.exportPackage():source.exportDraftPackage());
    await assert.rejects(imported.save(), {code:'REVISION_CONFLICT'});
    assert.deepEqual(await repo.read('pointers',saved.pointer.id),saved.pointer);
    assert.deepEqual(await repo.read('supplyStudies'),before);
    assert.equal(imported.viewState().savedPointer,null);
  });
}

test('explicit new-ID copy saves without altering the original', async()=>{
  const repo=createRepository(), owner=prepared(repo), saved=await owner.save();
  const copy=controller(repo);copy.loadStudy({...owner.viewState().study,studyId:'BRANCH-SYNTHETIC'});
  assert.equal((await copy.save()).pointer.revision,1);
  assert.deepEqual(await repo.read('pointers',saved.pointer.id),saved.pointer);
});

test('two editing sessions keep CAS and tombstones cannot resurrect through save or openVersion', async()=>{
  const repo=createRepository(), owner=prepared(repo), first=await owner.save(), other=controller(repo);
  await other.reopen(first.pointer.id); owner.updateStudy({name:'First edit'}); const latest=await owner.save();
  other.updateStudy({name:'Stale edit'});await assert.rejects(other.save(),{code:'REVISION_CONFLICT'});
  assert.deepEqual(await repo.read('pointers',first.pointer.id),latest.pointer);
  await owner.deleteStudy(first.pointer.id);const tombstone=await repo.read('pointers',first.pointer.id);
  await assert.rejects(other.save(),{code:'REVISION_CONFLICT'});
  await other.openVersion(first.pointer.inputHash);assert.equal(other.viewState().savedPointer,null);
  await assert.rejects(other.save(),{code:'REVISION_CONFLICT'});
  assert.deepEqual(await repo.read('pointers',first.pointer.id),tombstone);
});

test('late durable receipt never binds another study', async()=>{
  const repo=createRepository(), c=prepared(repo), gate=repo.__gateOp({store:'pointers',skip:1});
  const saving=c.save();await gate.hit;c.loadStudy(input('OTHER-SYNTHETIC'));const latest=c.snapshot();gate.release();
  const receipt=await saving;assert.equal(receipt.status,'SAVED');assert.equal(receipt.pointer.id,'SUPPLY:STORAGE-SYNTHETIC');
  assert.deepEqual(c.snapshot(),latest);assert.equal(c.viewState().savedPointer,null);
  assert.equal((await c.save()).pointer.id,'SUPPLY:OTHER-SYNTHETIC');
});

test('late durable receipt never binds a newly imported same-ID session', async()=>{
  const repo=createRepository(), c=prepared(repo), draft=c.exportDraftPackage(), gate=repo.__gateOp({store:'pointers',skip:1});
  const saving=c.save();await gate.hit;c.importPackage(draft);gate.release();await saving;
  assert.equal(c.viewState().savedPointer,null);await assert.rejects(c.save(),{code:'REVISION_CONFLICT'});
});

test('durable receipt preserves newer unsaved edits while advancing their editing revision', async()=>{
  const repo=createRepository(), c=prepared(repo), originalHash=c.viewState().study.inputHash, gate=repo.__gateOp({store:'pointers',skip:1});
  const saving=c.save();await gate.hit;c.updateStudy({name:'Newer unsaved edit'});gate.release();const receipt=await saving;
  assert.equal(receipt.pointer.inputHash,originalHash);assert.equal(c.viewState().study.name,'Newer unsaved edit');
  assert.equal(c.viewState().savedPointer.revision,1);assert.notEqual(c.viewState().study.inputHash,receipt.pointer.inputHash);
  const next=await c.save();assert.equal(next.pointer.revision,2);assert.equal(next.pointer.name,'Newer unsaved edit');
});

test('switching while pointer read is pending rejects obsolete save without records', async()=>{
  const repo=createRepository(), c=prepared(repo), gate=repo.__gateRead({store:'pointers',id:'SUPPLY:STORAGE-SYNTHETIC'});
  const saving=c.save();await gate.hit;c.loadStudy(input('OTHER-SYNTHETIC'));gate.release();
  await assert.rejects(saving,{code:'SUPPLY_SAVE_OBSOLETE'});assert.deepEqual(await repo.read('supplyStudies'),[]);
});

for(const code of ['STORAGE_QUOTA_EXCEEDED','STORAGE_TRANSACTION_FAILED','STORAGE_READBACK_FAILED']) {
  test(`save rejection ${code} does not install a success receipt`, async()=>{
    const underlying=createRepository(), repo={...underlying,commit:async()=>{throw Object.assign(new Error(code),{code});}}, c=prepared(repo), before=c.snapshot();
    await assert.rejects(c.save(),{code});assert.deepEqual(c.snapshot(),before);assert.deepEqual(await underlying.read('pointers'),[]);
  });
}

test('candidate changes invalidate an in-flight real asynchronous comparison', async()=>{
  const c=prepared(), comparing=c.compareAsync();c.evaluateConfigured([{demandId:'D',siteId:'B'}]);const newer=c.snapshot();
  await assert.rejects(comparing,error=>['SUPPLY_RUN_CANCELLED','SUPPLY_RUN_OBSOLETE'].includes(error.code));
  assert.deepEqual(c.snapshot(),newer);assert.equal(c.viewState().snapshot,null);assert.equal(c.viewState().candidates[0].outbound[0].fromNodeId,'B');
});

test('unchanged comparison inputs finish normally while a save receipt arrives', async()=>{
  const repo=createRepository(), c=prepared(repo), comparing=c.compareAsync(), saving=c.save();
  await Promise.all([comparing,saving]);
  assert.equal(c.viewState().status,'SNAPSHOT_READY');assert.equal(c.viewState().snapshot.rows[0].result.outbound[0].fromNodeId,'A');
  assert.equal(c.viewState().savedPointer.revision,1);
});

for(const [label,change] of [
  ['quantity',c=>c.updateStudy({periodDemand:[{...c.viewState().study.periodDemand[0],quantity:6}]})],
  ['cost',c=>c.updateStudy({rates:[{kind:'OUTBOUND_TRANSPORT',status:'KNOWN',basis:'PER_UNIT_KM',amount:2}]})],
  ['analysis configuration',c=>c.configureScenario({...scenario,objective:'COST'})]
]) test(`changed ${label} invalidates existing recommendations and exports`,()=>{
  const c=prepared();c.compare();const hash=c.viewState().snapshot.snapshotHash;change(c);
  assert.equal(c.viewState().snapshot,null);assert.equal(c.viewState().staleResult.snapshotHash,hash);
  assert.throws(()=>c.exportReport('json'),{code:'SUPPLY_SNAPSHOT_NOT_READY'});
});

test('late job result cannot overwrite a newer study', async()=>{
  const gate=deferred(), entered=deferred();let job, cancelled=0;
  const health={available:true,supplyChainJobsV6:true,endpoint:new URL(endpoint).origin,instanceId:'CONTROLLED-HTTP',startedAt:'2026-10-06T00:00:00Z',buildFingerprint:fingerprint,protocolVersion:'stct-supply-chain-jobs-v6',modelVersion:'v6-cp-sat-1',capabilities:['FACILITY','SUPPLY_CHAIN_JOBS_V6'],dependencies:{supplyChainReady:true}};
  const c=controller(undefined,{fetch:async(url,init={})=>{
    if(url.endsWith('/health'))return reply(health);
    if(url.endsWith('/cancel')){cancelled++;return reply({...job,status:'CANCELLED'});}
    if(init.method==='POST'){const spec=JSON.parse(init.body);job={jobId:'CONTROLLED-JOB',status:'COMPLETE',studyHash:spec.studyHash,runSpecHash:spec.runSpecHash,backendInstanceId:health.instanceId,backendBuildFingerprint:fingerprint};return reply(job);}
    entered.resolve();await gate.promise;return reply({...job,results:{}});
  }});
  c.loadStudy(input());c.configureScenario({...scenario,type:'NETWORK_CANDIDATE'});const running=c.run();await entered.promise;
  c.loadStudy(input('OTHER-SYNTHETIC'));const latest=c.snapshot();gate.resolve();
  await assert.rejects(running,{code:'SUPPLY_RUN_OBSOLETE'});assert.deepEqual(c.snapshot(),latest);assert.equal(cancelled,1);
});

test('closing repository during delayed IndexedDB open rejects instead of hanging', async()=>{
  // Only the open-request timing is controlled; the production repository is under test.
  let request, closed=0;const indexedDB={open(){request={result:{close(){closed++;}}};return request;}};
  const repo=Repository.createRepository({indexedDB,name:'SYNTHETIC-DELAYED-OPEN'}), opening=repo.open();repo.close();request.onsuccess();
  const timeout=Symbol('timeout');let timer;
  const outcome=await Promise.race([opening.then(()=>({code:'UNEXPECTED_SUCCESS'}),error=>error),new Promise(resolve=>{timer=setTimeout(()=>resolve(timeout),100);})]);
  clearTimeout(timer);assert.notEqual(outcome,timeout,'pending open must settle after repository close');assert.equal(outcome.code,'STORAGE_CLOSED');assert.equal(closed,1);
});
