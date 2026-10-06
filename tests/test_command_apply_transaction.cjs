'use strict';
// Controlled component faults around real verification/planning/COMMAND code.
// No native solver or browser execution is claimed by this regression.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = value => JSON.parse(JSON.stringify(value));
function target() {
  const listeners = new Map();
  return {innerHTML: '', listeners, classList: {add() {}, remove() {}},
    addEventListener(type, listener) {listeners.set(type, listener);}, removeEventListener() {},
    querySelector() {return null;}, querySelectorAll() {return [];}, getElementById() {return null;}};
}
global.window = globalThis;
global.document = target();
global.CustomEvent = class {constructor(type, value) {this.type = type; this.detail = value?.detail;}};
global.dispatchEvent = () => {};
global.STCTUtils = {clone};
global.STCT_CONFIG = {maxOptimizerOrders: 500, maxSolveSeconds: 45, lowUtilizationThreshold: 35};
let currentData = {planHash: 'PRIOR-DISPATCH-PLAN', marker: 'immediately preceding data'};
let writes = 0;
global.STCTCore = {setOptimizerPlan() {}, getData: () => currentData,
  applyPlan(value) {writes += 1; currentData = clone(value);}};
global.STCTPlanning = {state: {candidates: [], phase: 'builtin', engineHealth: {}},
  setRawData() {}, markPreview() {}};
global.STCTOptimizer = {assumptions: () => ({roadDistanceFactor: 1, averageSpeedKmh: 60,
  defaultServiceMinutes: 0, carbonModel: {defaultVehicleFactor: .2}}),
  planMetrics: plan => plan.metrics || {}, healthCheck: async () => ({available: false})};
const root = path.resolve(__dirname, '..');
for (const file of ['canonical.js', 'verifier.js', 'planning-v12.js'])
  vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), {filename: file});
STCTCanonical.configure(JSON.parse(fs.readFileSync(path.join(root, 'shared/planning-contract-v13.json'))));
const Adapter = require('../command-workspace-adapter-v19.js');
const Registry = require('../command-route-mount-registry-v19.js');

async function candidate() {
  const date = '2026-10-01';
  const identity = await STCTCanonical.scenarioIdentity({planningMode: 'SINGLE_DAY', planningDate: date,
    depot: {id: 'D', name: 'Synthetic depot', address: 'Synthetic', lon: 120, lat: 30},
    orders: [1, 2, 3].map(n => ({id: 'O'+n, code: 'O'+n, name: 'Synthetic '+n, address: 'Synthetic',
      date, lon: 120+n*.001, lat: 30, count: 1, volume: 1, weight: 1, serviceMin: 0,
      twStart: '09:00', twEnd: '18:00', priority: 'normal', priorityWeight: 1,
      prioritySource: 'mapped', orderType: '', requiredVehicleType: ''})),
    vehicles: [{id: 'V', name: 'Synthetic van', type: 'van', availableDate: date, maxVolume: 10,
      maxWeight: 10, start: '09:00', end: '18:00', fixedCost: 10, perKmCost: 1,
      perMinuteCost: .1, perStopCost: 1, emissionFactor: .2, sourceVehicleId: 'V', isVirtual: false, enabled: true}],
    constraints: {singleTrip: true, maxWaitingMinutes: 90, workStart: '09:00', workEnd: '18:00',
      maxOrders: 500, maxSolveSeconds: 45, allowUnassigned: true, capacityScale: 1000, weightScale: 1000,
      maxStops: 500, maxRouteMinutes: 540, shiftExtensionMinutes: 0},
    assumptions: {roadDistanceFactor: 1, averageSpeedKmh: 60, defaultServiceMin: 0, costModelVersion: 'stct-cost-v1',
      emissionModelVersion: 'stct-emission-v1', priorityMappingVersion: 'priority-map-v1',
      missingVehicleDatePolicy: 'blank-means-daily', missingTimeWindowPolicy: 'reject-order',
      overnightPolicy: 'end-before-start-means-next-day', distanceModel: 'haversine-road-factor',
      roadMetersRounding: 'half-up', travelMinutesRounding: 'ceil', costMinuteBasis: 'driving',
      defaultEmissionFactor: .2, lowUtilizationThreshold: 35, balancedWeightUsedVehicles: 20,
      balancedWeightDistance: 20, balancedWeightCost: 20, balancedWeightCarbon: 15,
      balancedWeightLatestEnd: 15, balancedWeightUtilization: 10}});
  const scenario = {...identity.scenario, scenarioId: 'SYNTHETIC-TRANSACTION',
    contentHash: identity.contentHash, inputHash: identity.inputHash, assumptionsSnapshot: {defaultServiceMinutes: 0}};
  const authority = {routes: [{routeId: 'R', vehicleId: 'V', orderIds: ['O1', 'O2', 'O3']}],
    unassignedOrderIds: [], blockedOrderIds: [], manualRevision: 0, parentPlanHash: ''};
  const hash = (await STCTCanonical.planIdentity(scenario.inputHash, authority)).planHash;
  const plan = STCTVerifier.recomputePlan({...authority, planId: 'SYNTHETIC-PLAN', planHash: hash,
    contractVersion: scenario.contractVersion, canonicalVersion: scenario.canonicalVersion,
    contentHash: scenario.contentHash, inputHash: scenario.inputHash,
    requestHash: 'sha256:'+'1'.repeat(64), engine: 'CONTROLLED_COMPONENT', meta: {}}, scenario).plan;
  plan.reportedMetrics = clone(plan.metrics);
  const verified = await STCTVerifier.verify(plan, scenario);
  assert.equal(verified.status, 'PASS');
  plan.verification = {...verified, recomputedPlan: undefined};
  return {plan, scenario};
}

async function wait(predicate) {
  for (let i=0; i<300; i++) {if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5));}
  throw Error('Component action did not complete');
}

(async () => {
  const {plan, scenario} = await candidate();
  Object.assign(STCTPlanning.state, {scenario, candidates: [plan], selectedPlanId: plan.planId,
    phase: 'candidates', beforeApply: {planHash: 'OLDER-FIRST-EVER-BASELINE'}, appliedPlanId: 'PRIOR-APPLIED-ID'});
  const adapter = Adapter.createAdapter({document});
  const rootTarget = target();
  const scope = {listen(object, type, callback) {object.addEventListener(type, callback);}, register() {}};
  const descriptor = Registry.createRegistry().get('/command/dispatch');
  adapter.mountDescriptor(descriptor, {logicalPath: descriptor.logicalPath, routeParams: {}, scope},
    {target: rootTarget, snapshot: {locale: 'en', noWebGL: true, reducedMotion: true}, controller: {navigate() {}}});
  const context = adapter.createOperationalContext();
  await context.ready;
  const emitted = [];
  context.subscribe((_snapshot, event) => emitted.push(event));
  const beforeContext = clone(context.snapshot()), beforeData = clone(currentData), beforePlanning = {
    phase: STCTPlanning.state.phase, beforeApply: clone(STCTPlanning.state.beforeApply),
    appliedPlanId: STCTPlanning.state.appliedPlanId};
  const button = {dataset: {commandAction: 'dispatch-apply'}, disabled: false};
  const click = () => rootTarget.listeners.get('click')({target: {
    closest(selector) {return selector === '[data-command-action]' ? button : null;}}});
  const verify = STCTVerifier.verify;
  const faultCases = [
    ['APPLIED_ROUTE_GEOMETRY_INVALID', result => {result.recomputedPlan.routeGeoJson.features = [];}],
    ['DOWNSTREAM_SEED_FAILURE', result => {result.recomputedPlan.routes[0].orderIds = [];}],
  ];
  for (const [expected, fault] of faultCases) {
    // Inject only after the real verifier succeeds, modeling a downstream
    // preparation fault. This is not passing corrupted input as solver evidence.
    STCTVerifier.verify = async (...args) => {const result = await verify(...args); fault(result); return result;};
    const oldAction = JSON.stringify(adapter.diagnostics().lastDomainAction);
    click();
    await wait(() => {const action = adapter.diagnostics().lastDomainAction;
      return JSON.stringify(action) !== oldAction && action?.type === 'dispatch-apply' && action.result.status === 'FAILED';});
    if (expected === 'APPLIED_ROUTE_GEOMETRY_INVALID') assert.equal(adapter.diagnostics().lastDomainAction.result.code, expected);
    assert.equal(writes, 0);
    assert.deepEqual(emitted, [], 'A failed adoption must publish no success or revision event');
    assert.deepEqual(currentData, beforeData);
    assert.deepEqual(context.snapshot(), beforeContext);
    assert.deepEqual({phase: STCTPlanning.state.phase, beforeApply: STCTPlanning.state.beforeApply,
      appliedPlanId: STCTPlanning.state.appliedPlanId}, beforePlanning);
  }
  STCTVerifier.verify = verify;
  click();
  await wait(() => adapter.diagnostics().lastDomainAction?.result?.status === 'APPLIED_AND_ADOPTED');
  await context.ready;
  assert.equal(writes, 1);
  assert.equal(currentData.planHash, plan.planHash);
  assert.equal(context.snapshot().plan.planHash, plan.planHash);
  assert.equal(context.snapshot().execution.run.planHash, plan.planHash);
  assert.equal(STCTPlanning.state.phase, 'applied');
  assert.equal(emitted.filter(event => event.type === 'VERIFIED_APPLIED_PLAN_ADOPTED').length, 1);
  console.log(JSON.stringify({status: 'PASS', method: 'CONTROLLED_COMPONENT_FAULTS_REAL_VERIFIER_AND_ADAPTER',
    checks: ['GEOMETRY_REJECTION_PRESERVES_BOTH_SIDES', 'DOWNSTREAM_ADOPTION_FAILURE_PRESERVES_BOTH_SIDES',
      'NO_FALSE_APPLY_RECEIPT', 'RETRY_APPLIES_IDENTICAL_HASH_TO_BOTH_SIDES'], nativeSolverExecuted: false}, null, 2));
})().catch(error => {console.error(error.stack); process.exitCode = 1;});
