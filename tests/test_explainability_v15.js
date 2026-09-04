#!/usr/bin/env node
"use strict";

const assert = require("assert");
const CanonicalDiff = require("../canonical-diff-v15.js");
const Explain = require("../explainability-v15.js");
const { buildFixture, clone } = require("./experience_fixture_v14.js");

const checks = [];

function check(id, condition, detail = {}) {
  assert(condition, `${id}: ${JSON.stringify(detail)}`);
  checks.push(id);
}

function setMetric(plan, field, value) {
  plan.verification.recomputedMetrics[field] = value;
  plan.metrics[field] = value;
}

async function main() {
  const valid = Explain.explanation({
    constraintCode: "CAPACITY_TEST",
    category: "CAPACITY",
    severity: "HARD",
    status: "VIOLATED",
    entityType: "ORDER",
    entityIds: ["ORDER-001"],
    measuredValue: 12,
    limitValue: 10,
    delta: 2,
    unit: "volume",
    evidence: [{ source: "SYNTHETIC_TEST" }],
    confidence: "DETERMINISTIC",
    suggestedActions: ["Split order"],
    source: "test",
  });
  check("T086", Explain.validateExplanation(valid).status === "PASS" && Explain.validateExplanation({}).status === "FAIL", valid);
  const excessiveOrder = { id: "ORDER-X", volume: 12, weight: 0 };
  const capacity = Explain.capacityExplanation(excessiveOrder, [{ id: "VEH-1", maxVolume: 10, maxWeight: 100 }], "volume");
  check("T087", capacity.status === "VIOLATED" && capacity.measuredValue === 12 && capacity.limitValue === 10 && capacity.delta === 2, capacity);
  const timeWindow = Explain.timeWindowExplanation({ id: "ORDER-X", twStart: "08:00", twEnd: "09:00" }, 570);
  check("T088", timeWindow.status === "VIOLATED" && timeWindow.measuredValue === 570 && timeWindow.limitValue === 540 && timeWindow.delta === 30, timeWindow);
  const noVehicle = Explain.noVehicleExplanation({ id: "ORDER-X" }, [], ["REFRIGERATION", "LIFT_GATE"]);
  check("T089", noVehicle.constraintCode === "NO_COMPATIBLE_VEHICLE" && noVehicle.evidence[0].capabilityGaps.join() === "REFRIGERATION,LIFT_GATE", noVehicle);

  const fixture = buildFixture({ orderCount: 6, routeCount: 2, planSuffix: "WHY-A", inputSuffix: "WHY" });
  const pressuredScenario = clone(fixture.scenario);
  pressuredScenario.vehicles.forEach((vehicle) => { vehicle.maxVolume = 2; });
  const pressure = Explain.whyUnassigned("ORDER-001", fixture.plan, pressuredScenario, []);
  check("T090", pressure.classification === "SCENARIO_CAPACITY_PRESSURE" && pressure.confidence === "COMPARATIVE" && pressure.explanations[0].entityType === "SCENARIO" && pressure.claimBoundary.includes("not a deterministic single-order cause"), pressure);

  const assigned = Explain.whyAssigned("ORDER-001", fixture.plan, fixture.scenario, [fixture.plan]);
  check("T091", assigned.evidenceAuthority.includes("CANONICAL_SCENARIO") && assigned.evidenceAuthority.includes("VERIFIER_RECOMPUTED_METRICS") && assigned.recomputedPlanMetrics.assigned === fixture.plan.verification.recomputedMetrics.assigned, assigned);
  check("T092", assigned.claimBoundary.includes("not proven") && !assigned.claimBoundary.includes("unique best"), assigned.claimBoundary);
  const individuallyInfeasible = { ...excessiveOrder, volume: 25 };
  const deterministic = Explain.whyUnassigned("ORDER-X", fixture.plan, { ...fixture.scenario, orders: [...fixture.scenario.orders, individuallyInfeasible] }, []);
  const unknown = Explain.whyUnassigned("ORDER-001", fixture.plan, fixture.scenario, []);
  check("T093", deterministic.confidence === "DETERMINISTIC" && pressure.confidence === "COMPARATIVE" && unknown.confidence === "UNKNOWN", { deterministic: deterministic.confidence, pressure: pressure.confidence, unknown: unknown.confidence });

  const best = clone(fixture.plan);
  best.labels = ["distance"];
  best.requestedGoals = ["balanced"];
  const peer = clone(fixture.plan);
  peer.planHash = "sha256:why-peer";
  peer.planId = "PLAN-WHY-PEER";
  setMetric(peer, "estimatedRoadKm", fixture.plan.verification.recomputedMetrics.estimatedRoadKm + 25);
  const thisPlan = Explain.whyThisPlan(best, fixture.scenario, [best, peer]);
  check("T094", thisPlan.labels.length === 1 && thisPlan.labels[0].label === "distance" && thisPlan.labels[0].provenAgainstObservedPool === true && thisPlan.labels[0].evidence === "VERIFIED_OBSERVED_CANDIDATE_POOL", thisPlan.labels);

  const changeFixture = buildFixture({ orderCount: 6, routeCount: 2, planSuffix: "CHANGE-A", inputSuffix: "CHANGE" });
  const changed = clone(changeFixture.plan);
  changed.planHash = "sha256:change-b";
  changed.planId = "PLAN-CHANGE-B";
  changed.routes[0].orderIds = ["ORDER-003", "ORDER-002"];
  changed.routes[1].orderIds = ["ORDER-001", "ORDER-004", "ORDER-006"];
  changed.unassignedOrderIds = ["ORDER-005"];
  const beforeChanged = clone(changeFixture.plan);
  beforeChanged.routes[0].orderIds = ["ORDER-001", "ORDER-003", "ORDER-005"];
  beforeChanged.routes[1].orderIds = ["ORDER-002", "ORDER-006"];
  beforeChanged.unassignedOrderIds = ["ORDER-004"];
  const whyChanged = Explain.whyChanged(beforeChanged, changed, changeFixture.scenario, changeFixture.scenario);
  const byOrder = Object.fromEntries(whyChanged.assignmentChanges.map((row) => [row.orderId, row.type]));
  check("T095", byOrder["ORDER-001"] === "REASSIGNED", byOrder);
  check("T096", byOrder["ORDER-003"] === "SEQUENCE_CHANGED", byOrder);
  check("T097", byOrder["ORDER-004"] === "NEWLY_ASSIGNED", byOrder);
  check("T098", byOrder["ORDER-005"] === "NEWLY_UNASSIGNED", byOrder);

  const scenarioB = clone(fixture.scenario);
  scenarioB.inputHash = "sha256:why-mutated";
  scenarioB.orders[0].lon += 0.01;
  scenarioB.orders[0].volume += 1;
  scenarioB.orders[0].twEnd = "16:30";
  scenarioB.orders[0].priorityWeight = 2;
  scenarioB.vehicles[0].maxVolume += 5;
  scenarioB.vehicles[0].start = "07:30";
  scenarioB.vehicles[0].fixedCost += 20;
  scenarioB.depot.lon += 0.02;
  const fieldDiff = CanonicalDiff.scenarioDiff(fixture.scenario, scenarioB, { synthetic: true });
  check("T099", Boolean(CanonicalDiff.findChange(fieldDiff, "ORDER", "ORDER-001", "lon")), fieldDiff.fieldChanges);
  check("T100", Boolean(CanonicalDiff.findChange(fieldDiff, "ORDER", "ORDER-001", "volume")), fieldDiff.fieldChanges);
  check("T101", Boolean(CanonicalDiff.findChange(fieldDiff, "ORDER", "ORDER-001", "twEnd")), fieldDiff.fieldChanges);
  check("T102", Boolean(CanonicalDiff.findChange(fieldDiff, "ORDER", "ORDER-001", "priorityWeight")), fieldDiff.fieldChanges);
  check("T103", Boolean(CanonicalDiff.findChange(fieldDiff, "VEHICLE", "VEH-1", "maxVolume")), fieldDiff.fieldChanges);
  const shiftChange = CanonicalDiff.findChange(fieldDiff, "VEHICLE", "VEH-1", "start");
  check("T104", shiftChange?.group === "shift", shiftChange);
  const costChange = CanonicalDiff.findChange(fieldDiff, "VEHICLE", "VEH-1", "fixedCost");
  check("T105", costChange?.group === "cost", costChange);
  check("T106", Boolean(CanonicalDiff.findChange(fieldDiff, "DEPOT", "DEPOT-01", "lon")), fieldDiff.fieldChanges);

  const scoreCandidates = [best, peer];
  const waterfall = Explain.scoreWaterfall(best, scoreCandidates);
  check("T107", Math.abs(waterfall.contributionTotal - waterfall.displayedPoolScore) < 0.000001 && waterfall.rows.length === 11, waterfall);
  check("T108", waterfall.balancedSeed.requested === true && waterfall.balancedSeed.score === null && Number.isFinite(waterfall.displayedPoolScore), waterfall);
  const tampered = clone(fixture.plan);
  tampered.metrics.assigned = 9999;
  tampered.metrics.totalCost = -1;
  const tamperExplanation = Explain.whyAssigned("ORDER-001", tampered, fixture.scenario, [tampered]);
  check("T109", tamperExplanation.recomputedPlanMetrics.assigned === fixture.plan.verification.recomputedMetrics.assigned && tamperExplanation.recomputedPlanMetrics.totalCost === fixture.plan.verification.recomputedMetrics.totalCost, tamperExplanation.recomputedPlanMetrics);

  const hostile = { name: '<img src=x onerror="alert(1)">', formula: "=HYPERLINK(\"https://example.invalid\")" };
  const json = Explain.exportJson(hostile);
  const csv = Explain.exportCsv([hostile]);
  const html = Explain.exportHtml("<script>alert(1)</script>", hostile);
  check("T110", !json.includes("<img") && csv.includes("'=HYPERLINK") && !html.includes("<script>alert") && html.includes("&lt;script&gt;"), { json, csv, html });

  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: checks.length, ids: checks }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
