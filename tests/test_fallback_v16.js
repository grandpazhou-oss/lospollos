#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Fixture = require("../road-network-fixture-v16.js");
const Providers = require("../routing-provider-registry-v16.js");
const RollingRecovery = require("../rolling-recovery-v16.js");
const Reoptimization = require("../reoptimization-v16.js");
const Twin = require("../execution-twin-v16.js");
const RollingFixture = require("./fixtures/rolling-v16-fixture.js");

async function main() {
  const graph = Fixture.createFixture(); const registry = Providers.createRegistry(); const local = registry.get("SYNTHETIC_ROAD_FIXTURE"); const osrm = registry.get("LOCAL_OSRM_COMPATIBLE"); const valhalla = registry.get("LOCAL_VALHALLA_COMPATIBLE"); const fixture = await RollingFixture.create();
  const localCandidate = Reoptimization.localCandidate("LOCAL_REGRET_INSERTION", fixture.scenario, fixture.context, fixture.matrix, { incidentHash: "sha256:fallback-incident" });
  const full = RollingRecovery.fullAvailability(fixture.matrix, { available: false, status: "UNAVAILABLE_DEPENDENCY" });
  const run = Twin.createRun({ scenarioId: "FALLBACK", inputHash: fixture.scenario.inputHash, planHash: fixture.basePlan.planHash, routeGeometryHash: "sha256:fallback-route", matrixHash: fixture.matrix.matrixHash, providerProvenance: fixture.matrix.providerProvenance, simulationSeed: "16", executionProfile: "ON_TIME", logicalStartMinute: 480, revision: 1 });
  assert.equal(graph.graphHash, fixture.graph.graphHash); assert.equal(localCandidate.verification.status, "PASS"); assert.equal(full.status, "SKIPPED_DEPENDENCY"); assert.equal(full.fullAvailable, false); assert.equal(osrm.availability, "DISABLED_BY_CONFIGURATION"); assert.equal(valhalla.availability, "DISABLED_BY_CONFIGURATION"); assert.equal(run.status, "PREPARED");
  process.stdout.write(`${JSON.stringify({ status: "PASS", roadFixture: "PASS", executionTwin: "PASS", localRepair: "PASS", fullReoptimization: "SKIPPED_DEPENDENCY", osrm: "DISABLED_BY_CONFIGURATION", valhalla: "DISABLED_BY_CONFIGURATION", externalCoordinateRequests: 0 }, null, 2)}\n`);
}
main().catch((error) => { console.error(error.stack || error); process.exit(1); });
