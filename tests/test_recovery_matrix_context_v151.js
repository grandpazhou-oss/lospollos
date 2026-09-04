#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Matrix = require("../matrix-provider-v15.js");
const Recovery = require("../recovery-v15.js");
const Incidents = require("../incident-v15.js");
const Impact = require("../impact-analysis-v15.js");
const { buildFixture } = require("./experience_fixture_v14.js");

async function main() {
  const fixture = buildFixture({ orderCount: 8, routeCount: 2, planSuffix: "MCTX", inputSuffix: "MCTX" });
  const pointIds = [fixture.scenario.depot.id, ...fixture.scenario.orders.map((order) => order.id)];
  const fixtureMatrix = {
    profile: "car", sourceIds: pointIds, targetIds: pointIds,
    distances: pointIds.map((_, row) => pointIds.map((__, column) => row === column ? 0 : 12 + Math.abs(row - column) * 3)),
    durations: pointIds.map((_, row) => pointIds.map((__, column) => row === column ? 0 : 15 + Math.abs(row - column) * 4)),
    distanceUnit: "km", durationUnit: "minutes", trafficMode: "FIXTURE", roadRestrictions: "FIXTURE_ONLY",
  };
  const haversine = await Matrix.createMatrixContext(Matrix.createHaversineProvider({ version: "1.5.1-haversine" }), fixture.scenario);
  const deterministic = await Matrix.createMatrixContext(Matrix.createFixtureProvider(fixtureMatrix, { version: "1.5.1-fixture" }), fixture.scenario);
  const seedRoute = { routeId: fixture.plan.routes[0].routeId, vehicleId: fixture.plan.routes[0].vehicleId, orderIds: fixture.plan.routes[0].orderIds.slice() };
  const haversineRoute = Recovery.evaluateRoute(seedRoute, fixture.scenario, { matrixContext: haversine });
  const fixtureRoute = Recovery.evaluateRoute(seedRoute, fixture.scenario, { matrixContext: deterministic });
  assert.notStrictEqual(haversineRoute.route.km, fixtureRoute.route.km);
  assert.notStrictEqual(haversineRoute.route.drivingMinutes, fixtureRoute.route.drivingMinutes);

  const orderId = seedRoute.orderIds.at(-1);
  const insertionSeed = [{ ...seedRoute, orderIds: seedRoute.orderIds.slice(0, -1) }];
  const haversineInsertion = Recovery.insertionOptions(orderId, insertionSeed, fixture.scenario, { basePlan: fixture.plan, pinning: { fixedRoutePrefixes: [] }, objective: "LOWEST_COST", matrixContext: haversine })[0];
  const fixtureInsertion = Recovery.insertionOptions(orderId, insertionSeed, fixture.scenario, { basePlan: fixture.plan, pinning: { fixedRoutePrefixes: [] }, objective: "LOWEST_COST", matrixContext: deterministic })[0];
  assert(haversineInsertion && fixtureInsertion);
  assert.notStrictEqual(haversineInsertion.deltaDistanceKm, fixtureInsertion.deltaDistanceKm);

  const incident = Incidents.createIncident({ type: "ORDER_CANCELLED", baseInputHash: fixture.scenario.inputHash, basePlanHash: fixture.plan.planHash, logicalMinute: 0, affectedEntityIds: ["ORDER-008"], parameters: { orderId: "ORDER-008" } });
  const derived = Incidents.deriveScenario(fixture.scenario, incident).derivedScenario;
  const pinning = Impact.createPinningSnapshot(fixture.plan, 0);
  const derivedHaversine = await Matrix.createMatrixContext(Matrix.createHaversineProvider({ version: "1.5.1-haversine" }), derived);
  const derivedFixture = await Matrix.createMatrixContext(Matrix.createFixtureProvider(fixtureMatrix, { version: "1.5.1-fixture" }), derived);
  const common = { basePlan: fixture.plan, baseScenario: fixture.scenario, derivedScenario: derived, incidents: [incident], pinning, objectives: ["MINIMUM_CHANGE"], engine: { id: "DEMO_HEURISTIC", version: "1.5.1", status: "VERIFIED" } };
  const haversineResult = await Recovery.generateRecoveryCandidates({ ...common, matrixContext: derivedHaversine });
  const fixtureResult = await Recovery.generateRecoveryCandidates({ ...common, matrixContext: derivedFixture });
  const haversineCandidate = haversineResult.candidates[0]; const fixtureCandidate = fixtureResult.candidates[0];
  assert.notStrictEqual(haversineCandidate.metrics.estimatedRoadKm, fixtureCandidate.metrics.estimatedRoadKm);
  assert.strictEqual(haversineCandidate.meta.matrixProvider.providerId, "HAVERSINE_FALLBACK");
  assert.strictEqual(haversineCandidate.meta.matrixProvider.matrixHash, derivedHaversine.matrixHash);
  assert.strictEqual(fixtureCandidate.meta.matrixProvider.providerId, "FIXTURE_MATRIX");
  assert.strictEqual(fixtureCandidate.meta.matrixProvider.providerVersion, "1.5.1-fixture");
  assert.strictEqual(fixtureCandidate.meta.matrixProvider.matrixHash, derivedFixture.matrixHash);

  let adapterCalls = 0;
  const boundary = await Recovery.fullReoptimization({ solve: async () => { adapterCalls += 1; return {}; } });
  assert.strictEqual(boundary.status, "NOT_INTEGRATED");
  assert.strictEqual(boundary.integrationStatus, "ADAPTER_ONLY");
  assert.strictEqual(boundary.engineTruth, "NOT_INTEGRATED");
  assert.strictEqual(adapterCalls, 0);

  process.stdout.write(`${JSON.stringify({ status: "PASS", providers: [haversine.providerId, deterministic.providerId], routeMetricsDiffer: true, insertionDeltaDiffers: true, actualProvenance: true, fullReoptimization: "ADAPTER_ONLY / NOT_INTEGRATED" }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });
