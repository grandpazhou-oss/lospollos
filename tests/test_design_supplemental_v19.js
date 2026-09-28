"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Store = require("../design-study-store-v19.js");
const Baseline = require("../network-baseline-explorer-v19.js");
const Scenarios = require("../network-scenario-studio-v19.js");
const Fleet = require("../fleet-capacity-studio-v19.js");
const Cost = require("../cost-to-serve-explorer-v19.js");
const Demand = require("../demand-growth-studio-v19.js");
const Resilience = require("../resilience-studio-v19.js");
const Facility = require("../facility-location-readiness-v19.js");
const Validation = require("../operational-validation-inbox-v19.js");
const Actions = require("../design-action-center-v19.js");
const Ribbon = require("../design-context-ribbon-v19.js");
const Finder = require("../design-quick-finder-v19.js");
const Brief = require("../network-study-brief-v19.js");

const clone = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const observations = [];
function check(id, description, operation) {
  try {
    const detail = operation();
    observations.push({ id, description, status: "PASS", detail: detail === undefined ? true : detail });
  } catch (error) {
    observations.push({ id, description, status: "FAIL", error: error.stack || error.message });
    throw error;
  }
}

const store = Store.createStore({ fixtureOptions: { depotCount: 3, docksPerDepot: 2, vehicleCount: 12, orderCount: 72, seed: 1940 } });

check("P4X-BASELINE-PROJECTION", "Baseline exposes canonical network facts, provenance, fallbacks and exports", () => {
  const value = Baseline.project(store);
  assert.equal(value.depots.length, 3);
  assert.equal(value.fleetAndDrivers.vehicles, 12);
  assert.ok(value.depots.every((row) => row.capacities.dailyOrders > 0 && row.docks > 0));
  assert.equal(value.verifier.status, "PASS");
  assert.equal(value.accountingVerifier.status, "PASS");
  assert.equal(value.roadFactBoundary.haversineAsRoadEconomicFact, false);
  assert.equal(value.noWebGL.operational, true);
  assert.match(Baseline.toJson(store), /networkInputHash/);
  assert.match(Baseline.toCsv(store), /^depot_id,/);
  assert.match(Baseline.toPrintableHtml(store), /CURRENT_NETWORK_NOT_OPTIMALITY_CLAIM/);
  return { depots: value.depots.length, routes: value.routes.length, waves: value.docksAndWaves.waves };
});

check("P4X-SCENARIO-LIFECYCLE", "Scenario templates create changed inputs and portfolio imports are immutable and side-effect free", () => {
  const catalog = Scenarios.project(store).templates;
  ["DEMAND_10", "DEMAND_25", "DEMAND_50", "REGIONAL_DEMAND_SHIFT", "TIME_WINDOW_TIGHTEN", "DEPOT_OUTAGE", "DOCK_FAILURE", "FLEET_MIX", "ROAD_CLOSURE", "CROSS_DOCK_ENABLE"].forEach((id) => assert.ok(catalog.some((row) => row.id === id), id));
  assert.equal(catalog.find((row) => row.id === "CROSS_DOCK_DISABLE").type, "CROSS_DOCK_INTERRUPTION");
  const baselineHash = store.snapshot().activeInputHash;
  Scenarios.create(store, "DEMAND_25");
  assert.notEqual(store.snapshot().activeInputHash, baselineHash);
  assert.equal(store.snapshot().lifecycle, "SCENARIO_DIRTY");
  store.evaluate();
  const exported = Scenarios.exportPortfolio(store);
  const before = store.snapshot().studyHash;
  const imported = Scenarios.importReadOnly(store, exported);
  assert.equal(imported.status, "PASS");
  assert.equal(imported.sideEffects.evaluationStarted, false);
  assert.equal(Object.isFrozen(imported.pack.study.study), true);
  assert.throws(() => { imported.pack.study.study.studyId = "MUTATED"; }, TypeError);
  assert.equal(store.snapshot().studyHash, before);
  const tampered = JSON.parse(exported);
  tampered.portfolio = [];
  assert.equal(Scenarios.importReadOnly(store, tampered).status, "FAIL");
  return { templates: catalog.length, portfolio: store.snapshot().scenarioResultRefs.length };
});

check("P4X-FLEET-CAPACITY", "Fleet capacity separates assets from trip slots and exposes verified bottleneck facts", () => {
  const value = Fleet.project(store);
  assert.equal(value.verified, true);
  assert.equal(value.accountingVerified, true);
  assert.ok(value.byDepot.every((row) => row.physicalVehicles >= 0 && row.virtualTripSlots >= row.physicalVehicles));
  assert.equal(value.physicalVsVirtualBoundary, "PHYSICAL_VEHICLES_ARE_ASSETS; VIRTUAL_TRIP_SLOTS_ARE_MAX_TRIPS_CAPACITY");
  assert.ok(value.scenarioTemplates.some((row) => row.id === "SHIFT_EXTENSION" && row.type === "SHIFT_EXTENSION"));
  assert.match(Fleet.toCsv(store), /^depot_id,/);
  assert.match(Fleet.toJson(store), /physicalVehicles/);
  return { vehicles: value.byType.reduce((sum, row) => sum + row.count, 0), trips: value.operations.tripCount, bottleneck: value.bottlenecks.status };
});

check("P4X-COST-AUTHORITY", "Cost view reconciles visible components and excludes missing components instead of zero-filling", () => {
  const value = Cost.project(store, { scope: "order" });
  assert.deepEqual(value.components.map((row) => row.name), store.context.Accounting.COST_COMPONENTS);
  assert.equal(value.totalMatchesVisibleComponents, true);
  assert.equal(value.allocation.scope, "order");
  assert.equal(value.allocation.fabricatedOrderCost, false);
  assert.equal(value.comparisonSemantics, "SCENARIO_CHANGED");
  const source = store.snapshot();
  const altered = clone(source);
  const removed = store.context.Accounting.COST_COMPONENTS[0];
  delete altered.evaluation.accounting.cost.components[removed];
  const fakeStore = { context: store.context, snapshot: () => clone(altered) };
  const missing = Cost.project(fakeStore).components.find((row) => row.name === removed);
  assert.equal(missing.value, null);
  assert.equal(missing.status, "MISSING_EXCLUDED_FROM_TOTAL");
  assert.match(Cost.toCsv(store), /^component,/);
  assert.match(Cost.toPrintableHtml(store), /(Scenario|Demo) estimate only; not certified ESG accounting/);
  const route = Cost.project(store, { scope: "route" });
  assert.equal(route.allocation.scope, "route");
  assert.ok(route.allocation.rows.every((row) => row.routeId && row.allocationBoundary === "TRIP_IS_THE_VERIFIED_ROUTE_COST_UNIT"));
  return { components: value.components.length, total: value.total, routeAllocations: route.allocation.rows.length };
});

check("P4X-DEMAND-GROWTH", "Demand growth provides bounded changed-input scenarios without forecast or auto-apply claims", () => {
  const value = Demand.project(store);
  ["DEMAND_10", "DEMAND_25", "DEMAND_50", "REGIONAL_PEAK", "REGIONAL_DECLINE", "TIME_WINDOW_TIGHTEN", "SERVICE_PRIORITY_SHIFT"].forEach((id) => assert.ok(value.actions.some((row) => row.id === id), id));
  assert.equal(value.forecastClaim, false);
  assert.equal(value.autoApply, false);
  assert.equal(value.currentOrders, 72);
  assert.ok(value.totalVolume > 0 && value.totalWeight > 0);
  assert.match(Demand.toCsv(store), /^zone_id,/);
  const demandStore = Store.createStore({ fixtureOptions: { depotCount: 2, docksPerDepot: 2, vehicleCount: 8, orderCount: 32, seed: 1941 } });
  const baselineRelease = demandStore.snapshot().activeRecord.scenario.orders[0].releaseTime;
  const baselineStudyHash = demandStore.snapshot().studyHash;
  Demand.create(demandStore, "RELEASE_TIME_SHIFT");
  assert.notEqual(demandStore.snapshot().activeRecord.scenario.orders[0].releaseTime, baselineRelease);
  assert.notEqual(demandStore.snapshot().activeInputHash, demandStore.snapshot().baselineInputHash);
  demandStore.setDemandPeriod("FY2028 STRATEGIC PLANNING HORIZON");
  assert.notEqual(demandStore.snapshot().studyHash, baselineStudyHash);
  const beforeClone = demandStore.snapshot();
  demandStore.cloneScenario();
  assert.notEqual(demandStore.snapshot().activeScenarioId, beforeClone.activeScenarioId);
  assert.equal(demandStore.snapshot().activeInputHash, beforeClone.activeInputHash);
  assert.equal(demandStore.snapshot().history.at(-1).parentScenarioId, beforeClone.activeScenarioId);
  assert.notEqual(demandStore.cloneStudy().targetStudyId, demandStore.snapshot().studyId);
  return { orders: value.currentOrders, zones: value.zones.length, releaseTimeShiftedFrom: baselineRelease, demandPeriod: demandStore.snapshot().demandPeriod };
});

check("P4X-RESILIENCE", "Resilience shocks use Scenario Lab and expose verified impact with controlled unsupported cases", () => {
  store.reset();
  const depotId = store.snapshot().activeRecord.scenario.depots[0].depotId;
  Resilience.create(store, "DOCK_FAILURE", depotId);
  assert.equal(store.snapshot().lifecycle, "SCENARIO_DIRTY");
  assert.throws(() => store.evaluate(), (error) => error.code === "DESIGN_NETWORK_VERIFICATION_FAILED");
  assert.equal(store.snapshot().lifecycle, "SCENARIO_DIRTY");
  assert.equal(Resilience.project(store).impact.assessmentStatus, "NOT_EVALUATED");
  assert.equal(Resilience.project(store).impact.verifiedBackupCoverage, null);
  assert.equal(Resilience.project(store).impact.uncoveredAffectedDemand, null);
  assert.equal(Scenarios.project(store).failureState.code, "DESIGN_NETWORK_VERIFICATION_FAILED");
  store.reset();
  Resilience.create(store, "DEPOT_OUTAGE", depotId);
  store.evaluate();
  const value = Resilience.project(store);
  assert.equal(value.activeShock.type, "DEPOT_OUTAGE");
  assert.equal(value.impact.verification, "PASS");
  assert.ok(Number.isFinite(value.impact.cost));
  assert.equal(value.autoApply, false);
  assert.equal(value.probabilityClaim, false);
  ["VEHICLE_TYPE_SHORTAGE", "DRIVER_UNAVAILABLE", "CROSS_DOCK_INTERRUPTION"].forEach((action) => {
    const candidate = Store.createStore({ fixtureOptions: { depotCount: 2, docksPerDepot: 2, vehicleCount: 8, orderCount: 32, seed: 1942 } });
    const before = candidate.snapshot().activeInputHash;
    Resilience.create(candidate, action, candidate.snapshot().activeRecord.scenario.depots[0].depotId);
    assert.notEqual(candidate.snapshot().activeInputHash, before, action);
    assert.equal(candidate.snapshot().activeRecord.type, action);
  });
  assert.match(Resilience.toCsv(store), /^scenario,/);
  return { shock: value.activeShock.type, service: value.impact.service, verifier: value.impact.verification };
});

check("P4X-FACILITY-READINESS", "Facility Location remains a readiness gate with evidence and no solver output", () => {
  const value = Facility.project(store);
  assert.equal(value.status, "READINESS_ONLY");
  assert.equal(value.solverStatus, "NOT_STARTED");
  assert.equal(value.primaryAction, null);
  assert.equal(value.readinessScore.formula.includes("PARTIAL_AND_SYNTHETIC_ONLY_ARE_NOT_READY"), true);
  assert.ok(value.prerequisites.some((row) => row.id === "CANDIDATE_SITES" && row.status === "NOT_CONNECTED"));
  assert.ok(value.links.includes("/platform/data"));
  assert.match(Facility.toCsv(store), /^prerequisite,/);
  const html = Facility.toPrintableHtml(store, "<b>=not data</b>");
  assert.ok(html.includes("&lt;b&gt;=not data&lt;/b&gt;"));
  assert.equal(html.includes("<b>=not data</b>"), false);
  return value.readinessScore;
});

check("P4X-VALIDATION-INBOX", "Operational validation is hash-gated, stale-aware, immutable and cannot mutate COMMAND", () => {
  store.reset();
  const created = store.addOperationalValidation({ validationId: "VAL-SUP-001", status: "COMPLETED", verifierStatus: "PASS", metrics: { service: 0.98, fleetRequirement: 12, routeDistanceKm: 410 } }).result;
  assert.equal(created.sourceMatrixHash, store.context.routingContextHash);
  assert.equal(Validation.validate(store, created).status, "PASS");
  assert.equal(Validation.project(store).items[0].inboxStatus, "VALID");
  const imported = Validation.importReadOnly(store, created);
  assert.equal(imported.status, "PASS");
  assert.equal(imported.sideEffects.commandPlanMutation, false);
  assert.equal(Object.isFrozen(imported.pack.metrics), true);
  const tampered = clone(created);
  tampered.metrics.service = 1;
  assert.equal(Validation.importReadOnly(store, tampered).status, "FAIL");
  store.createScenario("DEMAND_PEAK", { factor: 1.1 });
  assert.equal(Validation.project(store).items[0].inboxStatus, "STALE");
  assert.match(Validation.toCsv(store), /^validation_id,/);
  return { validationId: created.validationId, resultHash: created.resultHash };
});

check("P4X-WORKSPACE-UTILITIES", "Action Center, ribbon and finder remain scoped, semantic and sanitized", () => {
  const actions = Actions.project(store);
  assert.equal(actions.commandActionsCalled, false);
  assert.equal(actions.aiScore, false);
  assert.ok(actions.items.every((row) => row.category && row.target.startsWith("/design/")));
  const ribbon = Ribbon.project(store);
  assert.equal(ribbon.strategicNotOperational, true);
  assert.equal(ribbon.provider.matrixVersion, store.snapshot().activeRecord.scenario.routingContext.matrixVersion);
  assert.equal(Finder.safeTarget("/command/routes?token=secret"), "/design/overview");
  assert.equal(Finder.safeTarget("/design/demand-growth?zoneId=Z1&token=secret"), "/design/demand-growth?zoneId=Z1");
  assert.ok(Finder.search(store, "study").length > 0);
  return { actions: actions.total, finderRows: Finder.index(store).length };
});

check("P4X-STUDY-BRIEF", "Study Brief is immutable, multilingual, formula-safe and evidence-linked", () => {
  store.reset();
  const pack = Brief.create(store, "=SUM(A1:A2)<b>A&B</b>");
  assert.equal(Brief.verify(store, pack).status, "PASS");
  assert.equal(Object.isFrozen(pack.facts), true);
  assert.ok(pack.evidenceRefs.includes(pack.studyHash));
  assert.match(Brief.toCsv(pack), /"'=SUM\(A1:A2\)<b>A&B<\/b>"/);
  assert.match(Brief.toPrintableHtml(pack, "zh"), /网络研究简报/);
  assert.match(Brief.toPrintableHtml(pack, "en"), /Network Study Brief/);
  assert.match(Brief.toPrintableHtml(pack, "ja"), /ネットワーク研究概要/);
  assert.equal(Brief.toPrintableHtml(pack).includes("<b>A&B</b>"), false);
  const imported = Brief.importReadOnly(store, Brief.toJson(pack));
  assert.equal(imported.status, "PASS");
  assert.equal(Object.isFrozen(imported.pack.facts), true);
  return { briefHash: pack.briefHash, evidenceRefs: pack.evidenceRefs.length };
});

check("P4X-AUTHORITY-BOUNDARIES", "DESIGN reuses network authorities; P6 and Facility MVP-1 are locally bounded", () => {
  const root = path.resolve(__dirname, "..");
  const designFiles = fs.readdirSync(root).filter((name) => /^(design-|network-baseline|network-scenario|fleet-capacity|cost-to-serve|demand-growth|resilience|facility-location|operational-validation|network-study-brief).*v19\.js$/.test(name));
  const source = designFiles.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
  ["function normalizeScenario(", "function solveNetwork(", "function verifyNetworkPlan(", "function computeAccounting(", "function createRoutingRegistry("].forEach((signature) => assert.equal(source.includes(signature), false, signature));
  assert.equal(store.context.boundaries.facilityLocationSolver, "MVP1_LOCAL_OR_TOOLS_CP_SAT");
  assert.equal(store.context.boundaries.p5SharedPlatformServices, "LOCAL_IMPLEMENTED");
  assert.equal(store.context.boundaries.p6OperationalValidationBridge, "LOCAL_IMPLEMENTED");
  assert.equal(store.diagnostics().externalRequests, 0);
  assert.equal(store.diagnostics().context.publicRoutingCalls, 0);
  return { modules: designFiles.length, boundaries: store.context.boundaries };
});

process.stdout.write(`${JSON.stringify({ schemaVersion: "stct-design-supplemental-test-v1.9-p4", status: observations.every((row) => row.status === "PASS") ? "PASS" : "FAIL", checks: observations.length, observations }, null, 2)}\n`);
