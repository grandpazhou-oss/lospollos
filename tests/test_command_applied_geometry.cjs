'use strict';
// Synthetic production-module boundary tests; no browser/native solver claim.
const assert = require('node:assert/strict');
const Context = require('../command-operational-context-v19.js');
const Integrity = require('../integrity-hash-v151.js');
const clone = value => JSON.parse(JSON.stringify(value));
const checks = [];

function sourcePlan(context, points) {
  const plan = clone(context.basePlan);
  plan.planId = 'SYNTHETIC-NATIVE-SHAPE';
  const geometries = new Map(plan.routes.map(route => [route.routeId,
    points ? route.geometry.slice(0, points) : clone(route.geometry)]));
  plan.routeGeoJson = {type: 'FeatureCollection', features: [...geometries].reverse().map(([routeId, coordinates]) =>
    ({type: 'Feature', properties: {routeId}, geometry: {type: 'LineString', coordinates}}))};
  for (const route of plan.routes) delete route.geometry;
  plan.planHash = Integrity.hashValue({planId: plan.planId, routes: plan.routes, geometries: [...geometries]});
  return {plan, geometries};
}

async function main() {
  for (const points of [undefined, 2, 3]) {
    const context = Context.createContext();
    await context.ready;
    const {plan, geometries} = sourcePlan(context, points);
    const sourceBytes = JSON.stringify(plan);
    const result = context.adoptAppliedPlan(plan, {policy: 'RESET_EXECUTION'});
    await context.ready;
    assert.equal(result.status, 'ADOPTED');
    const state = context.snapshot();
    assert.equal(state.plan.planHash, plan.planHash);
    assert.equal(state.execution.run.planHash, plan.planHash);
    assert.equal(state.simulation.activePlanHash, plan.planHash);
    for (const route of context.scenario.routes) assert.deepEqual(route.geometry, geometries.get(route.routeId));
    for (const event of state.execution.acceptedEvents.filter(event => event.eventType === 'POSITION_RECORDED')) {
      const expected = geometries.get(event.routeId);
      assert.deepEqual(event.coordinate, expected[Math.min(3, expected.length - 1)]);
    }
    assert.equal(JSON.stringify(plan), sourceBytes, 'Adoption must not mutate the source plan');
    checks.push('GEOJSON_BY_ROUTE_ID_EXACT_' + (points || 'FULL'));
  }

  const context = Context.createContext();
  await context.ready;
  const {plan} = sourcePlan(context);
  const before = clone(context.snapshot());
  const refs = Object.fromEntries(['scenario', 'basePlan', 'workspace', 'executionStore', 'replay',
    'simulationStore', 'ready', 'alertStore', 'recoverySession', 'offlineQueue', 'driver', 'incidents']
    .map(key => [key, context[key]]));
  for (const mutation of [
    value => { value.routeGeoJson.features = []; },
    value => { value.routeGeoJson.features.push(clone(value.routeGeoJson.features[0])); },
    value => { value.routeGeoJson.features[0].geometry.coordinates = [[200, 30], [120, 30]]; },
  ]) {
    const invalid = clone(plan);
    mutation(invalid);
    assert.throws(() => context.adoptAppliedPlan(invalid, {policy: 'RESET_EXECUTION'}),
      {code: 'APPLIED_ROUTE_GEOMETRY_INVALID'});
    assert.deepEqual(context.snapshot(), before);
    for (const [key, ref] of Object.entries(refs)) assert.equal(context[key], ref, key);
  }
  checks.push('MISSING_AMBIGUOUS_INVALID_GEOMETRY_REJECTED_WITHOUT_FABRICATION');

  // Trigger an actual downstream execution-seeding error after session creation,
  // rather than only failing geometry preflight before any state is replaced.
  const invalidOrders = clone(plan);
  invalidOrders.routes[0].orderIds = [];
  assert.throws(() => context.adoptAppliedPlan(invalidOrders, {policy: 'RESET_EXECUTION'}));
  assert.deepEqual(context.snapshot(), before, 'A failed rebuild must retain the whole old context');
  for (const [key, ref] of Object.entries(refs)) assert.equal(context[key], ref, key);
  checks.push('DOWNSTREAM_REBUILD_FAILURE_RESTORES_ALL_CONTEXT_AUTHORITIES');

  console.log(JSON.stringify({status: 'PASS', method: 'SYNTHETIC_PRODUCTION_MODULE_BOUNDARY_NOT_NATIVE_OR_BROWSER',
    checks, crossModuleCommitAtomicity: 'NOT_COVERED_HERE'}, null, 2));
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
