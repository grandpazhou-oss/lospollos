'use strict';
const assert=require('node:assert/strict');
const Store=require('../design-study-store-v19.js');
const Data=require('../design-data-adapter-v19.js');
const Context=require('../design-strategic-context-v19.js');
const Resilience=require('../resilience-studio-v19.js');
const Inbox=require('../operational-validation-inbox-v19.js');
const Cost=require('../cost-to-serve-explorer-v19.js');
const Demand=require('../demand-growth-studio-v19.js');
const Admission=require('../result-admission-v19.js');
const options={fixtureOptions:{orderCount:32,depotCount:2,vehicleCount:8}};
const checks=[];
function test(id,fn){fn();checks.push({id,status:'PASS'});}
const store=Store.createStore(options),C=store.context.Contract;
for(const [name,change] of Object.entries({negative:r=>r.accounting.cost.total=-1,positive:r=>r.accounting.cost.total+=100,fail:r=>r.verification.status='FAIL',matrix:r=>r.plan.routingContextHash='sha256:'+'0'.repeat(64),assumptions:r=>{r.accounting=store.context.Accounting.computeAccounting(store.activeRecord().scenario,r.plan,{unassignedPenalty:1,tollPerKm:999});},assignment:r=>r.plan.assignment.assignments[0].assignedDepotId='D2'})){
 test('J01-'+name,()=>{
  const before=store.snapshot();let notified=0;const unsub=store.subscribe(()=>notified++);
  const fake=structuredClone(before.evaluation);change(fake);
  assert.throws(()=>store.acceptEvaluation(fake));unsub();
  assert.equal(store.snapshot().studyHash,before.studyHash);assert.equal(store.snapshot().revision,before.revision);assert.deepEqual(store.snapshot().evaluation,before.evaluation);assert.ok(store.snapshot().evaluationFailure);assert.equal(notified,1);
 });
}
test('J01-cache-shared-admission',()=>{const first=store.context.evaluate(store.activeRecord()),second=store.context.evaluate(store.activeRecord());assert.equal(first.artifactHash,second.artifactHash);assert.ok(Object.isFrozen(second.artifact.accounting));assert.throws(()=>Admission.admit(store.activeRecord(),{...second,verification:{status:'FAIL'}}));});
test('J01-revision-check',()=>assert.throws(()=>Admission.admit(store.activeRecord(),store.snapshot().evaluation,{isCurrent:()=>false}),{code:'DESIGN_CONTEXT_CHANGED_DURING_ADMISSION'}));
test('J02-no-alternate',()=>{const s=Store.createStore(options);s.createShock('DEPOT_OUTAGE',{depotId:'D1'});assert.equal(Resilience.project(s).impact.verifiedBackupCoverage,null);s.evaluate();const p=Resilience.project(s).impact;assert.equal(p.affectedDemand,16);assert.equal(p.verifiedBackupCoverage,0);assert.equal(p.uncoveredAffectedDemand,16);});
test('J02-positive-control',()=>{
 const data=Data.createSyntheticStudy(options.fixtureOptions);const raw=structuredClone(data.scenario);
 raw.orders.forEach(o=>o.allowedDepotIds=['D1','D2']);raw.zones.forEach(z=>{z.mode='PREFERRED';z.depotIds=['D1','D2'];});
 const s=Store.createStore({context:Context.createContext({dataSource:Data.adoptNetworkScenario(raw)})});s.createShock('DEPOT_OUTAGE',{depotId:'D1'});s.evaluate();const p=Resilience.project(s).impact;
 assert.ok(p.verifiedBackupCoverage>0);assert.equal(p.affectedDemand,p.verifiedBackupCoverage+p.uncoveredAffectedDemand);
});
test('J02-pending-and-stale',()=>{const s=Store.createStore(options);s.addOperationalValidation({});let p=Inbox.project(s);assert.equal(p.counts.VALID,0);assert.equal(p.items[0].artifactIntegrity,'VALID');assert.equal(p.items[0].businessVerification,'PENDING');const hash=p.items[0].resultHash;s.createScenario('DEMAND_PEAK',{factor:1.25});p=Inbox.project(s);assert.equal(p.items[0].freshness,'STALE');assert.equal(p.items[0].resultHash,hash);});
test('J07-clone-binding',()=>{const s=Store.createStore(options),before=s.snapshot();s.cloneScenario();const after=s.snapshot();assert.notEqual(after.activeScenarioId,before.activeScenarioId);assert.equal(after.evaluation.scenarioId,after.activeScenarioId);assert.equal(after.evaluation.artifactHash,before.evaluation.artifactHash);assert.equal(after.evaluation.binding.reusedFrom,before.activeScenarioId);assert.equal(after.scenarioResultRefs.length,2);});
test('J17-cost-entity',()=>{for(const scope of ['order','depot','zone','trip','route','wave','vehicleType']){const p=Cost.project(store,{scope});assert.ok(p.allocation.rows.length);p.allocation.rows.forEach(row=>{assert.equal(row.entityType,scope);assert.ok(row.entityId);assert.equal(row.entityId,scope==='order'?row.orderId:row.key);});}});
test('J05-growth-dimensions',()=>{const s=Store.createStore(options),before=Demand.project(s);Demand.create(s,'DEMAND_25');const after=Demand.project(s);assert.equal(after.currentOrders,before.currentOrders);assert.equal(after.totalVolume,before.totalVolume*1.25);assert.equal(after.totalWeight,before.totalWeight*1.25);});
test('J09-display-period-only',()=>{const s=Store.createStore(options),before=s.snapshot();s.setDemandPeriod('FY2030 ANNUAL');const after=s.snapshot();assert.equal(after.activeInputHash,before.activeInputHash);assert.equal(after.evaluation.accounting.cost.total,before.evaluation.accounting.cost.total);assert.equal(Cost.project(s).period,'MODEL_RUN_NOT_ANNUALIZED');});
console.log(JSON.stringify({suite:'P5-WAVE0',checks},null,2));
