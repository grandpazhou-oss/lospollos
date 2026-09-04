#!/usr/bin/env node
"use strict";

const assert = require("assert");
const DomainEvents = require("../domain-events-v15.js");
const Simulation = require("../simulation-store-v15.js");
const Incidents = require("../incident-v15.js");
const Impact = require("../impact-analysis-v15.js");
const Recovery = require("../recovery-v15.js");
const Matrix = require("../matrix-provider-v15.js");
const { buildFixture, clone } = require("./experience_fixture_v14.js");

const checks = [];

function check(id, condition, detail = {}) {
  assert(condition, `${id}: ${JSON.stringify(detail)}`);
  checks.push({ id, status: "PASS", detail });
}

function incidentSpec(type, overrides = {}) {
  const common = { type, baseInputHash: "sha256:input-IR", basePlanHash: "sha256:plan-IR", logicalMinute: 535 };
  const byType = {
    VEHICLE_BREAKDOWN: { affectedEntityIds: ["VEH-1"], parameters: { vehicleId: "VEH-1" } },
    STOP_DELAY: { affectedEntityIds: ["ORDER-004"], parameters: { orderId: "ORDER-004", delayMinutes: 90 } },
    EMERGENCY_ORDER: { affectedEntityIds: ["ORDER-EMERGENCY"], parameters: { order: { id: "ORDER-EMERGENCY", code: "STORE-EMERGENCY", name: "Emergency Stop", address: "Synthetic", lon: 121.37, lat: 31.19, volume: 1, weight: 0, count: 1, serviceMin: 5, twStart: "08:00", twEnd: "17:30", priorityWeight: 4 } } },
    ORDER_CANCELLED: { affectedEntityIds: ["ORDER-010"], parameters: { orderId: "ORDER-010" } },
    TIME_WINDOW_CHANGED: { affectedEntityIds: ["ORDER-008"], parameters: { orderId: "ORDER-008", twStart: "10:00", twEnd: "11:00" } },
    DEPOT_DELAY: { affectedEntityIds: ["DEPOT-01"], parameters: { delayMinutes: 45 } },
    ROAD_CLOSURE_SIMULATION: { affectedEntityIds: ["R-2", "SEG-2-3"], parameters: { routeId: "R-2", segmentId: "SEG-2-3", delayMinutes: 60, distanceMultiplier: 1.4 } },
  };
  return { ...common, ...byType[type], ...clone(overrides) };
}

function withBase(spec, fixture) {
  return { ...spec, baseInputHash: fixture.scenario.inputHash, basePlanHash: fixture.plan.planHash };
}

async function main() {
  const fixture = buildFixture({ orderCount: 12, routeCount: 3, planSuffix: "IR", inputSuffix: "IR" });
  fixture.scenario.meta = { synthetic: true };
  const baseScenarioSnapshot = JSON.stringify(fixture.scenario);
  const basePlanSnapshot = JSON.stringify(fixture.plan);
  const matrixContextFor = (scenario) => Matrix.createMatrixContext(Matrix.createHaversineProvider({ version: "1.5.1-test" }), scenario);
  const baseMatrixContext = await matrixContextFor(fixture.scenario);

  const createdByType = Object.fromEntries(Incidents.INCIDENT_TYPES.map((type) => [type, Incidents.createIncident(withBase(incidentSpec(type), fixture))]));
  check("T136", Object.values(createdByType).every((incident) => Incidents.validateIncident(incident).status === "PASS"), { types: Object.keys(createdByType) });
  const stableA = Incidents.createIncident(withBase(incidentSpec("STOP_DELAY"), fixture));
  const stableB = Incidents.createIncident(withBase(incidentSpec("STOP_DELAY"), fixture));
  check("T137", stableA.incidentHash === stableB.incidentHash && stableA.incidentId === stableB.incidentId, { incidentHash: stableA.incidentHash });
  const changed = Incidents.createIncident(withBase(incidentSpec("STOP_DELAY", { parameters: { orderId: "ORDER-004", delayMinutes: 91 } }), fixture));
  check("T138", stableA.incidentHash !== changed.incidentHash);
  const changedBase = Incidents.createIncident({ ...withBase(incidentSpec("STOP_DELAY"), fixture), basePlanHash: "sha256:other-plan" });
  check("T139", stableA.incidentHash !== changedBase.incidentHash && stableA.baseInputHash === fixture.scenario.inputHash && stableA.basePlanHash === fixture.plan.planHash);

  const breakdownDerived = Incidents.deriveScenario(fixture.scenario, createdByType.VEHICLE_BREAKDOWN);
  check("T140", JSON.stringify(fixture.scenario) === baseScenarioSnapshot && breakdownDerived.derivedScenario !== fixture.scenario);
  check("T141", breakdownDerived.derivedScenario.vehicles.find((vehicle) => vehicle.id === "VEH-1").enabled === false);
  const emergencyDerived = Incidents.deriveScenario(fixture.scenario, createdByType.EMERGENCY_ORDER);
  check("T142", emergencyDerived.derivedScenario.orders.length === fixture.scenario.orders.length + 1 && emergencyDerived.derivedInputHash !== fixture.scenario.inputHash);
  const cancelledDerived = Incidents.deriveScenario(fixture.scenario, createdByType.ORDER_CANCELLED);
  check("T143", !cancelledDerived.derivedScenario.orders.some((order) => order.id === "ORDER-010") && cancelledDerived.derivedInputHash !== fixture.scenario.inputHash);
  const twDerived = Incidents.deriveScenario(fixture.scenario, createdByType.TIME_WINDOW_CHANGED);
  const changedOrderRows = twDerived.scenarioDiff.orders.mutated;
  check("T144", changedOrderRows.length === 1 && changedOrderRows[0].id === "ORDER-008" && changedOrderRows[0].changes.every((row) => ["twStart", "twEnd"].includes(row.field)), changedOrderRows);
  const depotDerived = Incidents.deriveScenario(fixture.scenario, createdByType.DEPOT_DELAY);
  check("T145", depotDerived.derivedScenario.constraintsSnapshot.depotDelayMinutes === 45 && Number.isFinite(depotDerived.derivedScenario.constraintsSnapshot.earliestDepartureMinutes));
  const roadDerived = Incidents.deriveScenario(fixture.scenario, createdByType.ROAD_CLOSURE_SIMULATION);
  const closure = roadDerived.derivedScenario.assumptionsSnapshot.roadClosureSimulations[0];
  check("T146", closure.simulationOnly === true && closure.realTimeRoadClosure === false);

  const pinning = Impact.createPinningSnapshot(fixture.plan, 535, { lockedRouteIds: ["R-3"] });
  check("T147", pinning.completedStopIds.length > 0 && pinning.completedStopIds.every((id) => pinning.lockedOrderIds.includes(id)), pinning);
  const prefixViolationPlan = clone(fixture.plan);
  const prefix = pinning.fixedRoutePrefixes[0];
  const targetRoute = prefixViolationPlan.routes.find((route) => route.routeId === prefix.routeId);
  [targetRoute.orderIds[0], targetRoute.orderIds[1]] = [targetRoute.orderIds[1], targetRoute.orderIds[0]];
  const prefixCheck = Impact.verifyCandidatePinning(fixture.plan, prefixViolationPlan, pinning);
  check("T148", prefixCheck.violations.some((row) => row.code === "PINNED_ROUTE_PREFIX_CHANGED"), prefixCheck);
  check("T149", pinning.activeServiceStopIds.length > 0 && pinning.activeServiceStopIds.every((id) => pinning.lockedOrderIds.includes(id)), pinning);
  const lockedRoutePlan = clone(fixture.plan);
  lockedRoutePlan.routes.find((route) => route.routeId === "R-3").orderIds.reverse();
  const lockedCheck = Impact.verifyCandidatePinning(fixture.plan, lockedRoutePlan, pinning);
  check("T150", lockedCheck.violations.some((row) => row.code === "LOCKED_ROUTE_CHANGED"), lockedCheck);
  const rejectedPinning = await Recovery.verifyRecoveryCandidate({ ...prefixViolationPlan, basePlanHash: fixture.plan.planHash, inputHash: fixture.scenario.inputHash, meta: { routeViolations: [] }, routes: prefixViolationPlan.routes, unassignedOrderIds: [] }, { basePlan: fixture.plan, derivedScenario: fixture.scenario, pinning });
  check("T151", rejectedPinning.status === "FAIL" && rejectedPinning.hardViolations.some((row) => row.code.includes("PINNED")), rejectedPinning);

  const eventStore = DomainEvents.createEventStore({ clock: () => "2026-08-31T00:00:00.000Z" });
  const incidentController = Incidents.createIncidentController({ baseScenario: fixture.scenario, basePlan: fixture.plan, eventStore });
  incidentController.inject(incidentSpec("STOP_DELAY"));
  check("T152", JSON.stringify(fixture.plan) === basePlanSnapshot && JSON.stringify(fixture.scenario) === baseScenarioSnapshot);
  const cleared = incidentController.clear();
  check("T153", cleared.incidents.length === 0 && cleared.derivedInputHash === fixture.scenario.inputHash && JSON.stringify(cleared.derivedScenario.orders) === JSON.stringify(fixture.scenario.orders));
  const orderedIncidents = [createdByType.STOP_DELAY, createdByType.DEPOT_DELAY];
  const sequenceA = Incidents.deriveScenario(fixture.scenario, orderedIncidents);
  const sequenceB = Incidents.deriveScenario(fixture.scenario, orderedIncidents);
  check("T154", sequenceA.derivedInputHash === sequenceB.derivedInputHash && JSON.stringify(sequenceA.derivedScenario) === JSON.stringify(sequenceB.derivedScenario));
  const cancelFirst = Incidents.createIncident(withBase(incidentSpec("ORDER_CANCELLED", { parameters: { orderId: "ORDER-008" }, affectedEntityIds: ["ORDER-008"] }), fixture));
  let conflictCode = "";
  try { Incidents.deriveScenario(fixture.scenario, [cancelFirst, createdByType.TIME_WINDOW_CHANGED]); } catch (error) { conflictCode = error.code; }
  check("T155", conflictCode === "INCIDENT_TARGET_UNAVAILABLE", { conflictCode });

  const breakdownPinning = Impact.createPinningSnapshot(fixture.plan, 535);
  const breakdownImpact = Impact.computeBlastRadius({ basePlan: fixture.plan, baseScenario: fixture.scenario, derivedScenario: breakdownDerived.derivedScenario, incidents: [createdByType.VEHICLE_BREAKDOWN], pinning: breakdownPinning });
  check("T156", breakdownImpact.affectedVehicleIds.includes("VEH-1"), breakdownImpact);
  check("T157", breakdownImpact.affectedRouteIds.includes("R-1"), breakdownImpact);
  check("T158", breakdownImpact.affectedOrderIds.length > 0 && breakdownImpact.affectedOrderIds.every((id) => fixture.plan.routes[0].orderIds.includes(id)), breakdownImpact);
  const severeDelay = Incidents.createIncident(withBase(incidentSpec("STOP_DELAY", { parameters: { orderId: "ORDER-004", delayMinutes: 700 } }), fixture));
  const severeDerived = Incidents.deriveScenario(fixture.scenario, severeDelay);
  const delayImpact = Impact.computeBlastRadius({ basePlan: fixture.plan, baseScenario: fixture.scenario, derivedScenario: severeDerived.derivedScenario, incidents: [severeDelay], pinning: breakdownPinning });
  check("T159", delayImpact.missedWindowOrderIds.length > 0, delayImpact);
  check("T160", delayImpact.reasons.some((row) => row.confidence === "PROJECTED") && breakdownImpact.reasons.some((row) => row.confidence === "DETERMINISTIC"));
  check("T161", breakdownImpact.repairSetOrderIds.length > 0, breakdownImpact);
  const emergencyImpact = Impact.computeBlastRadius({ basePlan: fixture.plan, baseScenario: fixture.scenario, derivedScenario: emergencyDerived.derivedScenario, incidents: [createdByType.EMERGENCY_ORDER], pinning: breakdownPinning });
  check("T162", emergencyImpact.insertionSetOrderIds.includes("ORDER-EMERGENCY"), emergencyImpact);

  const cancelledPinning = Impact.createPinningSnapshot(fixture.plan, 480);
  const cancelledImpact = Impact.computeBlastRadius({ basePlan: fixture.plan, baseScenario: fixture.scenario, derivedScenario: cancelledDerived.derivedScenario, incidents: [createdByType.ORDER_CANCELLED], pinning: cancelledPinning });
  const cancelledGenerated = await Recovery.generateRecoveryCandidates({ basePlan: fixture.plan, baseScenario: fixture.scenario, derivedScenario: cancelledDerived.derivedScenario, incidents: [createdByType.ORDER_CANCELLED], pinning: cancelledPinning, blastRadius: cancelledImpact, objectives: ["MINIMUM_CHANGE"] });
  check("T163", cancelledGenerated.candidates.every((candidate) => !candidate.routes.some((route) => route.orderIds.includes("ORDER-010"))), cancelledGenerated.candidates.map((candidate) => candidate.routes));

  const emergencySeed = Recovery.localRuinAndRecreateSeed(fixture.plan, emergencyImpact, breakdownPinning, emergencyDerived.derivedScenario);
  const emergencyMatrixContext = await matrixContextFor(emergencyDerived.derivedScenario);
  const insertionOptions = Recovery.insertionOptions("ORDER-EMERGENCY", emergencySeed.routes, emergencyDerived.derivedScenario, { basePlan: fixture.plan, pinning: breakdownPinning, objective: "LOWEST_COST", matrixContext: emergencyMatrixContext });
  const regret = Recovery.regretInsertion(["ORDER-EMERGENCY"], emergencySeed.routes, emergencyDerived.derivedScenario, { basePlan: fixture.plan, pinning: breakdownPinning, objective: "LOWEST_COST", matrixContext: emergencyMatrixContext });
  check("T164", insertionOptions.length >= 2 && regret.decisions[0].best && regret.decisions[0].secondBest, { optionCount: insertionOptions.length, decision: regret.decisions[0] });
  check("T165", regret.decisions[0].regret === regret.decisions[0].secondBest.score - regret.decisions[0].best.score, regret.decisions[0]);
  const impossibleSpec = incidentSpec("EMERGENCY_ORDER", { affectedEntityIds: ["ORDER-HUGE"], parameters: { order: { id: "ORDER-HUGE", lon: 121.37, lat: 31.19, volume: 1000, weight: 0, count: 1, serviceMin: 5, twStart: "08:00", twEnd: "17:30", priorityWeight: 4 } } });
  const impossibleIncident = Incidents.createIncident(withBase(impossibleSpec, fixture));
  const impossibleDerived = Incidents.deriveScenario(fixture.scenario, impossibleIncident);
  const impossibleImpact = Impact.computeBlastRadius({ basePlan: fixture.plan, baseScenario: fixture.scenario, derivedScenario: impossibleDerived.derivedScenario, incidents: [impossibleIncident], pinning: breakdownPinning });
  const impossibleSeed = Recovery.localRuinAndRecreateSeed(fixture.plan, impossibleImpact, breakdownPinning, impossibleDerived.derivedScenario);
  const impossibleMatrixContext = await matrixContextFor(impossibleDerived.derivedScenario);
  const impossibleInsertion = Recovery.regretInsertion(["ORDER-HUGE"], impossibleSeed.routes, impossibleDerived.derivedScenario, { basePlan: fixture.plan, pinning: breakdownPinning, objective: "BEST_SERVICE", matrixContext: impossibleMatrixContext });
  check("T166", impossibleInsertion.unassigned[0]?.reasonCode === "NO_FEASIBLE_INSERTION", impossibleInsertion);
  const unaffectedBefore = fixture.plan.routes.find((route) => route.routeId === "R-2").orderIds;
  const breakdownSeed = Recovery.localRuinAndRecreateSeed(fixture.plan, breakdownImpact, breakdownPinning, breakdownDerived.derivedScenario);
  const unaffectedAfter = breakdownSeed.routes.find((route) => route.routeId === "R-2").orderIds;
  check("T167", JSON.stringify(unaffectedBefore) === JSON.stringify(unaffectedAfter) && breakdownSeed.ruinedOrderIds.every((id) => breakdownImpact.repairSetOrderIds.includes(id)), breakdownSeed);

  const generated = await Recovery.generateRecoveryCandidates({ basePlan: fixture.plan, baseScenario: fixture.scenario, derivedScenario: breakdownDerived.derivedScenario, incidents: [createdByType.VEHICLE_BREAKDOWN], pinning: breakdownPinning, blastRadius: breakdownImpact, eventStore });
  const passCandidate = generated.candidates.find((candidate) => candidate.verification.status === "PASS");
  assert(passCandidate, `No PASS recovery candidate: ${JSON.stringify(generated.candidates.map((candidate) => candidate.verification))}`);
  const full = await Recovery.fullReoptimization({ solve: async () => clone(passCandidate), engineCapabilities: { pinning: false }, request: {}, basePlan: fixture.plan, derivedScenario: breakdownDerived.derivedScenario, pinning: breakdownPinning });
  check("T168", full.status === "NOT_INTEGRATED" && full.integrationStatus === "ADAPTER_ONLY" && full.engineTruth === "NOT_INTEGRATED" && full.networkCalled === false, full);

  const labelled = [
    { planHash: "A", verification: { status: "PASS", recomputedMetrics: { servicePriorityScore: 100, assigned: 12, latestEndMinutes: 1000, totalCost: 1200 } }, changePenalty: { movedOrders: 0, resequencedStops: 0 }, recoveryScore: 50 },
    { planHash: "B", verification: { status: "PASS", recomputedMetrics: { servicePriorityScore: 100, assigned: 12, latestEndMinutes: 900, totalCost: 1300 } }, changePenalty: { movedOrders: 2, resequencedStops: 1 }, recoveryScore: 40 },
    { planHash: "C", verification: { status: "PASS", recomputedMetrics: { servicePriorityScore: 100, assigned: 12, latestEndMinutes: 980, totalCost: 900 } }, changePenalty: { movedOrders: 3, resequencedStops: 0 }, recoveryScore: 60 },
    { planHash: "D", verification: { status: "PASS", recomputedMetrics: { servicePriorityScore: 100, assigned: 12, latestEndMinutes: 960, totalCost: 1100 } }, changePenalty: { movedOrders: 2, resequencedStops: 0 }, recoveryScore: 20 },
    { planHash: "LOW", verification: { status: "PASS", recomputedMetrics: { servicePriorityScore: 90, assigned: 12, latestEndMinutes: 800, totalCost: 800 } }, changePenalty: { movedOrders: 0, resequencedStops: 0 }, recoveryScore: 1 },
  ];
  Recovery.labelCandidates(labelled);
  check("T169", labelled.find((row) => row.planHash === "A").labels.includes("MINIMUM_CHANGE"), labelled);
  check("T170", labelled.filter((row) => row.serviceTier.eligible).every((row) => row.labels.includes("BEST_SERVICE")), labelled);
  check("T171", labelled.find((row) => row.planHash === "B").labels.includes("LEAST_DELAY"), labelled);
  check("T172", labelled.find((row) => row.planHash === "C").labels.includes("LOWEST_COST"), labelled);
  check("T173", generated.candidates.find((row) => row.objective === "BALANCED_RECOVERY").meta.objectiveWeights.service === Recovery.BALANCED_WEIGHTS.service);
  check("T174", labelled.find((row) => row.planHash === "LOW").labels.length === 0 && labelled.find((row) => row.planHash === "LOW").serviceTier.eligible === false, labelled);

  const changedRoutes = fixture.plan.routes.map((route) => ({ routeId: route.routeId, vehicleId: route.vehicleId, color: route.color, orderIds: [...route.orderIds] }));
  const movedId = changedRoutes[0].orderIds.pop();
  changedRoutes[1].orderIds.push(movedId);
  [changedRoutes[2].orderIds[1], changedRoutes[2].orderIds[2]] = [changedRoutes[2].orderIds[2], changedRoutes[2].orderIds[1]];
  const penaltyRequest = Recovery.createRecoveryRequest({ basePlanHash: fixture.plan.planHash, derivedInputHash: fixture.scenario.inputHash, incidentHash: stableA.incidentHash, objective: "MINIMUM_CHANGE", pinningSnapshot: breakdownPinning });
  const changedPlan = Recovery.materializePlan(changedRoutes, [], fixture.scenario, fixture.plan, { baseScenario: fixture.scenario, request: penaltyRequest, method: "TEST", recoveryRevision: 1, matrixContext: baseMatrixContext });
  const penalty = Recovery.changePenalty(fixture.plan, changedPlan);
  check("T175", penalty.movedOrders > 0 && penalty.movedOrderIds.includes(movedId), penalty);
  check("T176", penalty.changedVehicles >= 2, penalty);
  check("T177", penalty.resequencedStops > 0, penalty);
  check("T178", penalty.etaShiftTotal > 0 && penalty.etaShiftMax > 0, penalty);
  check("T179", generated.candidates.every((candidate) => candidate.applyAllowed === (candidate.verification.status === "PASS")), generated.candidates.map((candidate) => ({ status: candidate.verification.status, applyAllowed: candidate.applyAllowed })));
  check("T180", generated.references.every((reference) => reference.referenceOnly && !reference.applyAllowed && reference.verification.status === "REFERENCE_NOT_VERIFIED"), generated.references);

  const simulationStore = Simulation.createSimulationStore();
  await simulationStore.initialize(fixture.plan);
  await simulationStore.addEvent({ eventId: "IR-DELAY", type: "DELAY", routeId: "R-2", orderId: "ORDER-002", stopIndex: 0, minutes: 15, source: "incident-test" });
  const originalSimulation = simulationStore.exportState();
  let selection = { vehicleId: "VEH-2", orderId: "ORDER-002", planHash: fixture.plan.planHash };
  const recoveryController = Recovery.createRecoveryController({ basePlan: fixture.plan, baseScenario: fixture.scenario, derivedScenario: breakdownDerived.derivedScenario, pinning: breakdownPinning, simulationStore, eventStore, getSelection: () => selection, setSelection: (next) => { selection = clone(next); } });
  const controllerGenerated = await recoveryController.generate({ derivedScenario: breakdownDerived.derivedScenario, incidents: [createdByType.VEHICLE_BREAKDOWN], pinning: breakdownPinning, blastRadius: breakdownImpact, objectives: ["MINIMUM_CHANGE"] });
  const controllerCandidate = controllerGenerated.candidates.find((candidate) => candidate.applyAllowed);
  const applied = await recoveryController.apply(controllerCandidate, { simulationPolicy: "RESET" });
  check("T181", applied.lineage.incidentHash === controllerCandidate.incidentHash && applied.lineage.recoveryRequestHash === controllerCandidate.recoveryRequestHash && applied.lineage.parentPlanHash === fixture.plan.planHash, applied.lineage);
  const undone = await recoveryController.undo();
  check("T182", undone.plan.planHash === fixture.plan.planHash, undone);
  check("T183", undone.simulation.simulationHash === originalSimulation.simulationHash && undone.simulation.activeEvents.length === originalSimulation.activeEvents.length && undone.lineage.simulationPolicy === "RESET", undone);
  let drift = false;
  for (let index = 0; index < 10; index += 1) {
    await recoveryController.apply(controllerCandidate, { simulationPolicy: "RESET" });
    const cycle = await recoveryController.undo();
    if (cycle.plan.planHash !== fixture.plan.planHash || cycle.simulation.simulationHash !== originalSimulation.simulationHash) drift = true;
  }
  check("T184", !drift && simulationStore.state.simulationHash === originalSimulation.simulationHash);
  const slow = recoveryController.generate({ derivedScenario: breakdownDerived.derivedScenario, incidents: [createdByType.VEHICLE_BREAKDOWN], pinning: breakdownPinning, blastRadius: breakdownImpact, objectives: ["MINIMUM_CHANGE"], verifier: async () => { await new Promise((resolve) => setTimeout(resolve, 20)); return { status: "PASS" }; } });
  recoveryController.cancelGeneration();
  const stale = await slow;
  check("T185", stale.status === "STALE_RESPONSE", stale);

  const beforeMorphPlan = JSON.stringify(fixture.plan);
  const morph = Impact.routeMorph(fixture.plan, controllerCandidate);
  check("T186", morph.businessStateMutated === false && JSON.stringify(fixture.plan) === beforeMorphPlan, morph);
  const staticMorph = Impact.routeMorph(fixture.plan, controllerCandidate, { reducedMotion: true });
  check("T187", staticMorph.mode === "STATIC_BEFORE_AFTER", staticMorph);
  const fallback = Impact.noWebglTable(breakdownImpact);
  check("T188", fallback.length >= 6 && fallback.every((row) => row.metric && row.confidence), fallback);
  const audit = recoveryController.exportAudit();
  check("T190", audit.candidates.every((candidate) => candidate.recoveryRequestHash && candidate.incidentHash && candidate.parentPlanHash && candidate.verification) && audit.lineage.length >= 22 && audit.domainEventStreamHash, audit);

  recoveryController.destroy();
  incidentController.destroy();
  simulationStore.destroy();
  eventStore.destroy();
  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: checks.length, ids: checks.map((row) => row.id), browserOnlyPending: ["T189"] }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
