#!/usr/bin/env node
"use strict";

const assert = require("assert");
const DomainEvents = require("../domain-events-v15.js");
const Pareto = require("../pareto-v15.js");
const Engines = require("../engine-registry-v15.js");
const { buildFixture, clone } = require("./experience_fixture_v14.js");

const checks = [];

function check(id, condition, detail = {}) {
  assert(condition, `${id}: ${JSON.stringify(detail)}`);
  checks.push(id);
}

function candidate(base, suffix, metrics = {}, options = {}) {
  const plan = clone(base);
  plan.planId = `PLAN-${suffix}`;
  plan.planHash = `sha256:${suffix.toLowerCase()}`;
  plan.inputHash = options.inputHash || base.inputHash;
  plan.verification.status = options.status || "PASS";
  plan.verification.computedPlanHash = plan.planHash;
  plan.verification.recomputedMetrics = { ...plan.verification.recomputedMetrics, blocked: 0, changeCount: 0, ...metrics };
  plan.metrics = { ...plan.metrics, ...plan.verification.recomputedMetrics };
  return plan;
}

function verifier(plan) {
  const pass = !String(plan.planHash).includes("fail");
  return Promise.resolve({
    status: pass ? "PASS" : "FAIL",
    computedPlanHash: plan.planHash,
    recomputedMetrics: clone(plan.verification.recomputedMetrics),
    recomputedPlan: clone(plan),
    hardViolations: pass ? [] : [{ code: "SYNTHETIC_FAIL" }],
    warnings: [],
  });
}

async function main() {
  const fixture = buildFixture({ orderCount: 12, routeCount: 4, planSuffix: "PARETO", inputSuffix: "PARETO" });
  const baselineMetrics = fixture.plan.verification.recomputedMetrics;
  const a = candidate(fixture.plan, "A", { totalCost: 100, utilizationScore: 80 });
  const b = candidate(fixture.plan, "B", { totalCost: 120, utilizationScore: 70 });
  const fail = candidate(fixture.plan, "FAIL", { totalCost: 50 }, { status: "FAIL" });
  const report = Pareto.observedFrontier([a, b, fail], { dimensions: ["totalCost", "utilizationScore"] });
  check("T111", report.candidateCount === 2 && report.excluded.some((row) => row.planHash === fail.planHash && row.reasonCode === "VERIFIER_NOT_PASS"), report);
  const otherInput = candidate(fixture.plan, "OTHER-INPUT", { totalCost: 90 }, { inputHash: "sha256:other-input" });
  const inputGroups = Pareto.observedFrontier([a, otherInput], { dimensions: ["totalCost"] }).groups;
  check("T112", inputGroups.length === 2 && inputGroups.every((group) => group.points.length === 1), inputGroups.map((group) => ({ inputHash: group.inputHash, count: group.points.length })));
  const otherService = candidate(fixture.plan, "OTHER-SERVICE", { servicePriorityScore: baselineMetrics.servicePriorityScore - 1 });
  check("T113", Pareto.observedFrontier([a, otherService], { dimensions: ["totalCost"] }).groups.length === 2);
  const otherAssigned = candidate(fixture.plan, "OTHER-ASSIGNED", { assigned: baselineMetrics.assigned - 1 });
  check("T114", Pareto.observedFrontier([a, otherAssigned], { dimensions: ["totalCost"] }).groups.length === 2);

  const minProof = Pareto.dominates(a, b, ["totalCost"], {});
  check("T115", minProof.dominates && minProof.strictlyBetter[0].direction === "min", minProof);
  const maxProof = Pareto.dominates(a, b, ["utilizationScore"], {});
  check("T116", maxProof.dominates && maxProof.strictlyBetter[0].direction === "max", maxProof);
  const toleranceA = candidate(fixture.plan, "TOL-A", { totalCost: 100 });
  const toleranceB = candidate(fixture.plan, "TOL-B", { totalCost: 100.005 });
  const equalProof = Pareto.dominates(toleranceA, toleranceB, ["totalCost"], { totalCost: 0.01 });
  check("T117", !equalProof.dominates && equalProof.equalWithinTolerance.length === 1, equalProof);
  const allEqualA = candidate(fixture.plan, "STRICT-A", { totalCost: 100, estimatedRoadKm: 50 });
  const allEqualB = candidate(fixture.plan, "STRICT-B", { totalCost: 100, estimatedRoadKm: 50 });
  check("T118", !Pareto.dominates(allEqualA, allEqualB, ["totalCost", "estimatedRoadKm"], {}).dominates);
  const duplicateReport = Pareto.observedFrontier([a, clone(a), b], { dimensions: ["totalCost"] });
  check("T119", duplicateReport.candidateCount === 2 && duplicateReport.excluded.some((row) => row.reasonCode === "DUPLICATE_PLAN_HASH"), duplicateReport.excluded);
  check("T120", report.observed === true && report.label === "Observed Candidate Frontier" && !report.label.includes("Complete"), report.label);

  const callbackLog = [];
  const sourceBefore = JSON.stringify([a, b]);
  const controller = Pareto.createFrontierController({
    candidates: [a, b],
    xDimension: "totalCost",
    yDimension: "estimatedRoadKm",
    selectedPlanHash: a.planHash,
    selectPlan: (context) => callbackLog.push(["plan", context.planHash]),
    syncMap: (context) => callbackLog.push(["map", context.planHash]),
    syncTimeline: (context) => callbackLog.push(["timeline", context.planHash]),
    syncWhyPanel: (context) => callbackLog.push(["why", context.planHash]),
  });
  controller.setAxes("totalCO2", "utilizationScore");
  check("T121", JSON.stringify([a, b]) === sourceBefore && controller.snapshot().xDimension === "totalCO2" && controller.snapshot().yDimension === "utilizationScore");
  controller.select(b.planHash);
  check("T122", callbackLog.length === 4 && callbackLog.every((row) => row[1] === b.planHash) && callbackLog.map((row) => row[0]).join() === "plan,map,timeline,why", callbackLog);
  const beforeKey = controller.snapshot().selectedPlanHash;
  controller.handleKey("ArrowLeft");
  check("T123", controller.snapshot().selectedPlanHash !== beforeKey && callbackLog.at(-1)[1] === controller.snapshot().selectedPlanHash);
  const noWebgl = Pareto.createFrontierController({ candidates: [a, b], webglAvailable: false });
  check("T124", noWebgl.snapshot().noWebglEquivalent.length === noWebgl.snapshot().accessibleCandidates.length && noWebgl.snapshot().report.groups.length > 0);
  const mobile = Pareto.createFrontierController({ candidates: [a, b], mobile: true });
  check("T125", mobile.snapshot().mobileCandidates.map((row) => row.planHash).join() === mobile.snapshot().accessibleCandidates.map((row) => row.planHash).join());

  let networkCalls = 0;
  let ortoolsCalls = 0;
  let heuristicCalls = 0;
  const registry = Engines.createRegistry({
    ortoolsVersion: "9.synthetic",
    heuristicVersion: "1.5.synthetic",
    ortoolsAdapter: async () => { ortoolsCalls += 1; return candidate(fixture.plan, "FAIL-ENGINE", { totalCost: 95 }); },
    heuristicAdapter: async () => { heuristicCalls += 1; return candidate(fixture.plan, "HEURISTIC-PASS", { totalCost: 110 }); },
  });
  const ortools = registry.get("OR_TOOLS");
  const heuristic = registry.get("DEMO_HEURISTIC");
  const ortoolsCaps = ortools.capabilities();
  const heuristicCaps = heuristic.capabilities();
  check("T126", ortools.availability === "AVAILABLE" && ortoolsCaps.timeWindows && ortoolsCaps.priority && !ortoolsCaps.breaks && ortoolsCaps.cancellation, { availability: ortools.availability, capabilities: ortoolsCaps });
  check("T127", heuristic.availability === "AVAILABLE" && heuristicCaps.timeWindows && heuristicCaps.priority && !heuristicCaps.breaks && !heuristicCaps.multiDepot, { availability: heuristic.availability, capabilities: heuristicCaps });
  const vroom = registry.get("VROOM");
  check("T128", vroom.availability === "UNAVAILABLE_DEPENDENCY", vroom.provenance());
  await assert.rejects(() => vroom.solve({ scenario: fixture.scenario }), (caught) => caught.code === "UNAVAILABLE_DEPENDENCY");
  check("T129", networkCalls === 0 && vroom.solveCalls === 0, { networkCalls, solveCalls: vroom.solveCalls });

  const raceEvents = DomainEvents.createEventStore({ clock: () => "2026-09-01T00:00:00.000Z" });
  const race = Engines.createRaceController({ registry, verifier, eventStore: raceEvents });
  const request = { requestHash: "sha256:race-request", inputHash: fixture.scenario.inputHash, scenario: fixture.scenario, matrixProvider: "HAVERSINE_FALLBACK" };
  const raceResult = await race.run(request, ["OR_TOOLS", "DEMO_HEURISTIC"]);
  check("T130", raceResult.candidates.length === 1 && raceResult.candidates[0].planHash === "sha256:heuristic-pass" && raceResult.rows.find((row) => row.engineId === "OR_TOOLS").status === "VERIFIER_FAIL", raceResult.rows.map((row) => ({ engineId: row.engineId, status: row.status })));
  const provenance = raceResult.rows.find((row) => row.engineId === "DEMO_HEURISTIC").provenance;
  check("T131", provenance.id === "DEMO_HEURISTIC" && provenance.version === "1.5.synthetic" && provenance.status === "VERIFIED", provenance);
  const duplicate = await race.run(request, ["OR_TOOLS", "DEMO_HEURISTIC"]);
  check("T132", duplicate.status === "DUPLICATE_IGNORED" && ortoolsCalls === 1 && heuristicCalls === 1 && raceEvents.filter({ type: "CANDIDATE_GENERATED" }).length === 2, { duplicate: duplicate.status, ortoolsCalls, heuristicCalls, generated: raceEvents.filter({ type: "CANDIDATE_GENERATED" }).length });

  let releaseSlow;
  const slowRegistry = Engines.createRegistry({
    heuristicAdapter: () => new Promise((resolve) => { releaseSlow = () => resolve(candidate(fixture.plan, "SLOW", { totalCost: 105 })); }),
  });
  const slowRace = Engines.createRaceController({ registry: slowRegistry, verifier });
  const slowPromise = slowRace.run({ ...request, requestHash: "sha256:slow-request" }, ["DEMO_HEURISTIC"]);
  while (!releaseSlow) await new Promise((resolve) => setTimeout(resolve, 0));
  slowRace.cancel("test-cancel");
  releaseSlow();
  const slowResult = await slowPromise;
  check("T133", slowResult.candidates.length === 0 && slowResult.rows[0].status === "STALE_RESPONSE", slowResult);
  const timingRow = raceResult.rows.find((row) => row.engineId === "DEMO_HEURISTIC");
  check("T134", Number.isFinite(timingRow.solveTimeMs) && Number.isFinite(timingRow.verifierTimeMs) && Object.hasOwn(timingRow, "solveTimeMs") && Object.hasOwn(timingRow, "verifierTimeMs"), timingRow);
  const blocked = await race.run({ ...request, requestHash: "sha256:break-request", requiredCapabilities: ["breaks"] }, ["OR_TOOLS", "DEMO_HEURISTIC"]);
  check("T135", blocked.rows.every((row) => row.status === "BLOCKED_UNSUPPORTED_CAPABILITY" && row.blocker.unsupported.includes("breaks")), blocked.rows);

  race.destroy();
  slowRace.destroy();
  raceEvents.destroy();
  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: checks.length, ids: checks }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
