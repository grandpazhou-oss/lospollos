#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
global.window = { crypto: globalThis.crypto };
vm.runInThisContext(fs.readFileSync(path.join(root, "canonical.js"), "utf8"), { filename: "canonical.js" });
const canonical = window.STCTCanonical;
const contract = JSON.parse(fs.readFileSync(path.join(root, "shared", "planning-contract-v13.json"), "utf8"));
const fixture = JSON.parse(fs.readFileSync(path.join(root, "shared", "canonical-hash-fixtures.json"), "utf8"));
canonical.configure(contract);

const clone = (value) => JSON.parse(JSON.stringify(value));

async function identity(source) {
  return canonical.scenarioIdentity(source);
}

async function main() {
  const fixtureResults = [];
  for (const row of fixture.cases) {
    const actual = await identity(row.scenario);
    const request = await canonical.requestIdentity(actual.inputHash, row.requestOptions);
    const plan = await canonical.planIdentity(actual.inputHash, row.plan);
    assert.strictEqual(actual.inputBytes, row.expected.canonicalString, `${row.id}: canonical bytes`);
    assert.strictEqual(actual.contentHash, row.expected.contentHash, `${row.id}: contentHash`);
    assert.strictEqual(actual.inputHash, row.expected.inputHash, `${row.id}: inputHash`);
    assert.strictEqual(request.requestHash, row.expected.requestHash, `${row.id}: requestHash`);
    assert.strictEqual(plan.planHash, row.expected.planHash, `${row.id}: planHash`);
    fixtureResults.push({ id: row.id, status: "PASS", contentHash: actual.contentHash, inputHash: actual.inputHash, requestHash: request.requestHash, planHash: plan.planHash });
  }

  const baseSource = clone(fixture.cases[0].scenario);
  const base = await identity(baseSource);
  const stabilityMutations = [
    ["batchId", (value) => { value.batchId = "BATCH-B"; }],
    ["uploadedAt", (value) => { value.uploadedAt = "2099-01-01T00:00:00Z"; }],
    ["language", (value) => { value.language = "ja"; }],
    ["object-key-order", (value) => { value.orders[0] = Object.fromEntries(Object.entries(value.orders[0]).reverse()); }],
    ["numeric-format", (value) => { value.orders[0].volume = "0.1650"; value.vehicles[0].maxVolume = "5.000"; }],
    ["unicode-nfc", (value) => { value.orders[0].name = "Cafe\u0301"; }],
  ];
  const stability = [];
  for (const [name, mutate] of stabilityMutations) {
    const source = clone(baseSource);
    if (name === "unicode-nfc") baseSource.orders[0].name = "Caf\u00e9";
    mutate(source);
    const expected = name === "unicode-nfc" ? await identity(baseSource) : base;
    const actual = await identity(source);
    assert.strictEqual(actual.inputHash, expected.inputHash, name);
    stability.push({ name, status: "PASS", inputHash: actual.inputHash });
  }

  const sensitivityMutations = [
    ["order lon", (value) => { value.orders[0].lon = 121.4; }],
    ["order lat", (value) => { value.orders[0].lat = 31.3; }],
    ["order volume", (value) => { value.orders[0].volume = 0.2; }],
    ["order weight", (value) => { value.orders[0].weight = 17; }],
    ["order count", (value) => { value.orders[0].count = 4; }],
    ["order date", (value) => { value.orders.forEach((order) => { order.date = "2026-05-02"; }); value.planningDate = "2026-05-02"; }],
    ["order serviceMin", (value) => { value.orders[0].serviceMin = 3; }],
    ["order twStart", (value) => { value.orders[0].twStart = "12:59"; }],
    ["order twEnd", (value) => { value.orders[0].twEnd = "15:01"; }],
    ["order priorityWeight", (value) => { value.orders[0].priorityWeight = 4; value.orders[0].prioritySource = "explicit"; }],
    ["vehicle maxVolume", (value) => { value.vehicles[0].maxVolume = 6; }],
    ["vehicle maxWeight", (value) => { value.vehicles[0].maxWeight = 801; }],
    ["vehicle start", (value) => { value.vehicles[0].start = "08:59"; }],
    ["vehicle end", (value) => { value.vehicles[0].end = "17:31"; }],
    ["vehicle fixedCost", (value) => { value.vehicles[0].fixedCost = 121; }],
    ["vehicle perKmCost", (value) => { value.vehicles[0].perKmCost = 4.9; }],
    ["vehicle perMinuteCost", (value) => { value.vehicles[0].perMinuteCost = 0.36; }],
    ["vehicle perStopCost", (value) => { value.vehicles[0].perStopCost = 9; }],
    ["vehicle emissionFactor", (value) => { value.vehicles[0].emissionFactor = 0.121; }],
    ["depot lon", (value) => { value.depot.lon = 121.4; }],
    ["depot lat", (value) => { value.depot.lat = 31.2; }],
    ["roadDistanceFactor", (value) => { value.assumptions.roadDistanceFactor = 1.4; }],
    ["averageSpeedKmh", (value) => { value.assumptions.averageSpeedKmh = 29; }],
    ["maxWaitingMinutes", (value) => { value.constraints.maxWaitingMinutes = 91; }],
    ["shiftExtensionMinutes", (value) => { value.constraints.shiftExtensionMinutes = 60; }],
  ];
  const sensitivity = [];
  for (const [name, mutate] of sensitivityMutations) {
    const source = clone(fixture.cases[0].scenario);
    mutate(source);
    const actual = await identity(source);
    assert.notStrictEqual(actual.inputHash, base.inputHash, name);
    sensitivity.push({ name, status: "PASS", inputHash: actual.inputHash });
  }

  const requestDistance = await canonical.requestIdentity(base.inputHash, { objective: "distance", timeLimitSeconds: 8, engineRequested: "ortools", searchConfiguration: {} });
  const requestCost = await canonical.requestIdentity(base.inputHash, { objective: "cost", timeLimitSeconds: 8, engineRequested: "ortools", searchConfiguration: {} });
  const requestTime = await canonical.requestIdentity(base.inputHash, { objective: "distance", timeLimitSeconds: 9, engineRequested: "ortools", searchConfiguration: {} });
  assert.notStrictEqual(requestDistance.requestHash, requestCost.requestHash);
  assert.notStrictEqual(requestDistance.requestHash, requestTime.requestHash);

  const planA = { routes: [{ routeId: "R1", vehicleId: "V-001", orderIds: ["O-001", "O-002"] }], unassignedOrderIds: [], blockedOrderIds: [], manualRevision: 0 };
  const planB = clone(planA);
  planB.routes[0].orderIds.reverse();
  planB.manualRevision = 1;
  const planAIdentity = await canonical.planIdentity(base.inputHash, planA);
  const planBIdentity = await canonical.planIdentity(base.inputHash, planB);
  assert.notStrictEqual(planAIdentity.planHash, planBIdentity.planHash);
  const planReportedTamper = clone(planA);
  planReportedTamper.reportedMetrics = { totalCost: 999999 };
  assert.strictEqual((await canonical.planIdentity(base.inputHash, planReportedTamper)).planHash, planAIdentity.planHash);
  assert.strictEqual((await canonical.planIdentity(base.inputHash, planA)).planHash, planAIdentity.planHash);

  const output = {
    status: "PASS",
    contractVersion: contract.contractVersion,
    fixtureCases: fixtureResults,
    stability,
    sensitivity,
    layeredIdentity: {
      inputHash: base.inputHash,
      distanceRequestHash: requestDistance.requestHash,
      costRequestHash: requestCost.requestHash,
      timeChangedRequestHash: requestTime.requestHash,
      planA: planAIdentity.planHash,
      planB: planBIdentity.planHash,
      undoRestored: true,
      reportedMetricIgnoredByPlanHash: true,
    },
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
