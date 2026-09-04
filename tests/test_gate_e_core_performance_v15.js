#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { performance } = require("perf_hooks");
const CanonicalDiff = require("../canonical-diff-v15.js");
const Pareto = require("../pareto-v15.js");
const Incidents = require("../incident-v15.js");
const Impact = require("../impact-analysis-v15.js");
const { buildFixture, clone } = require("./experience_fixture_v14.js");

const evidence = { version: "v1.5-gate-e-core-performance", status: "FAIL", checks: [], measurements: {} };
function percentile(values, fraction) { const sorted = values.slice().sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]; }
function measure(iterations, callback) { const rows = []; for (let index = 0; index < iterations; index += 1) { const started = performance.now(); callback(index); rows.push(performance.now() - started); } return { iterations, rows, p50Ms: percentile(rows, .5), p95Ms: percentile(rows, .95), maxMs: Math.max(...rows) }; }
function check(id, condition, detail) { assert(condition, `${id}: ${JSON.stringify(detail)}`); evidence.checks.push({ id, status: "PASS", detail }); }

const fixture = buildFixture({ orderCount: 240, routeCount: 20, planSuffix: "GATE-E-240", inputSuffix: "GATE-E-240" });
fixture.scenario.meta = { synthetic: true };
const changedScenario = clone(fixture.scenario);
for (let index = 0; index < 40; index += 1) {
  changedScenario.orders[index].volume = Number(changedScenario.orders[index].volume || 1) + .25;
  changedScenario.orders[index].twEnd = "18:30";
}
CanonicalDiff.scenarioDiff(fixture.scenario, changedScenario, { synthetic: true });
const diffMeasurement = measure(30, () => CanonicalDiff.scenarioDiff(fixture.scenario, changedScenario, { synthetic: true }));
evidence.measurements.fieldDiff240 = diffMeasurement;
check("T250", diffMeasurement.p95Ms < 100, diffMeasurement);

const paretoCandidates = Array.from({ length: 200 }, (_, index) => ({
  planId: `CANDIDATE-${String(index + 1).padStart(3, "0")}`,
  planHash: `sha256:pareto-${String(index + 1).padStart(3, "0")}`,
  inputHash: "sha256:gate-e-pareto-input",
  verification: {
    status: "PASS",
    recomputedMetrics: {
      servicePriorityScore: 100,
      assigned: 240,
      blocked: 0,
      totalCost: 800 + (index * 37) % 510,
      estimatedRoadKm: 130 + (index * 23) % 190,
      totalCO2: 28 + (index * 11) % 42,
      usedVehicles: 10 + index % 11,
      latestEndMinutes: 950 + (index * 17) % 180,
      utilizationScore: 52 + (index * 13) % 47,
      changeCount: index % 19,
    },
  },
}));
Pareto.observedFrontier(paretoCandidates);
const paretoMeasurement = measure(12, () => Pareto.observedFrontier(paretoCandidates));
evidence.measurements.pareto200 = paretoMeasurement;
check("T251", paretoMeasurement.p95Ms < 50, paretoMeasurement);

const incident = Incidents.createIncident({
  type: "VEHICLE_BREAKDOWN",
  baseInputHash: fixture.scenario.inputHash,
  basePlanHash: fixture.plan.planHash,
  logicalMinute: 535,
  affectedEntityIds: [fixture.scenario.vehicles[0].id],
  parameters: { vehicleId: fixture.scenario.vehicles[0].id },
});
const derived = Incidents.deriveScenario(fixture.scenario, incident);
const pinning = Impact.createPinningSnapshot(fixture.plan, incident.logicalMinute);
Impact.computeBlastRadius({ basePlan: fixture.plan, baseScenario: fixture.scenario, derivedScenario: derived.derivedScenario, incidents: [incident], pinning });
const blastMeasurement = measure(30, () => Impact.computeBlastRadius({ basePlan: fixture.plan, baseScenario: fixture.scenario, derivedScenario: derived.derivedScenario, incidents: [incident], pinning }));
evidence.measurements.blastRadius240 = blastMeasurement;
check("T252", blastMeasurement.p95Ms < 150, blastMeasurement);

evidence.status = "PASS";
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
