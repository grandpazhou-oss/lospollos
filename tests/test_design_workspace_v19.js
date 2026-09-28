"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const DataAdapter = require("../design-data-adapter-v19.js");
const StrategicContext = require("../design-strategic-context-v19.js");
const Store = require("../design-study-store-v19.js");
const Registry = require("../design-route-mount-registry-v19.js");
const Overview = require("../design-overview-v19.js");
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
const Adapter = require("../design-workspace-adapter-v19.js");
const CommandContext = require("../command-operational-context-v19.js");

const observations = [];
function check(id, description, operation) {
  try {
    const detail = operation();
    observations.push({ id, status: "PASS", description, detail: detail === undefined ? true : detail });
  } catch (error) {
    observations.push({ id, status: "FAIL", description, error: error.stack || error.message });
    throw error;
  }
}

const context = StrategicContext.createContext({ fixtureOptions: { depotCount: 3, docksPerDepot: 2, vehicleCount: 12, orderCount: 60, seed: 1904 } });
const store = Store.createStore({ context });
const routes = Registry.createRegistry();
const routePaths = ["/design/overview", "/design/facility-location", "/design/network-scenarios", "/design/fleet-capacity", "/design/cost-to-serve", "/design/demand-growth", "/design/resilience", "/design/operational-validation"];

check("P4-ARCH-001", "DesignStrategicContext exposes the required authority contract", () => {
  ["contextId", "contextHash", "networkScenario", "networkInputHash", "routingContextHash", "providerProvenance", "baselinePlan", "baselinePlanHash", "verifierResult", "accountingLedger", "accountingHash", "capabilities", "boundaries"].forEach((key) => assert.ok(context[key] !== undefined, key));
  assert.equal(context.verifierResult.status, "PASS");
  assert.equal(context.boundaries.facilityLocationSolver, "MVP1_LOCAL_OR_TOOLS_CP_SAT");
  assert.equal(context.boundaries.p5SharedPlatformServices, "LOCAL_IMPLEMENTED");
  assert.equal(context.boundaries.p6OperationalValidationBridge, "LOCAL_IMPLEMENTED");
  return context.contextHash;
});
check("P4-ARCH-002", "DesignStudyStore exposes the required state contract", () => {
  const source = store.snapshot();
  ["studyId", "studyHash", "revision", "lifecycle", "strategicHorizon", "demandPeriod", "baselineScenarioId", "activeScenarioId", "selectedScenarioIds", "selectedFacilityId", "selectedDepotId", "selectedZoneId", "selectedPortfolioId", "baselineResultRef", "scenarioResultRefs", "operationalValidationRefs", "dataGaps", "dirty", "viewState", "auditEvents"].forEach((key) => assert.ok(Object.prototype.hasOwnProperty.call(source, key), key));
  assert.ok(Store.LIFECYCLE.includes(source.lifecycle));
  return source.studyHash;
});
check("P4-ARCH-003", "All DESIGN route descriptors have complete mount contracts", () => {
  assert.deepEqual(routes.list().map((row) => row.logicalPath), [...routePaths.slice(0, 2), "/design/supply-chain-study", ...routePaths.slice(2)]);
  routes.list().forEach((descriptor) => ["mount", "unmount", "snapshot", "restore", "fallback", "noWebGLFallback", "reducedMotionPolicy", "mobilePolicy"].forEach((key) => assert.equal(typeof descriptor[key], "function", `${descriptor.logicalPath}:${key}`)));
  return routes.diagnostics();
});
check("P4-ARCH-004", "DESIGN runtime reuses v1.8 canonical, solver, verifier, accounting and visualization authorities", () => {
  assert.deepEqual(context.diagnostics().authorities, { canonical: "network-contract-v18", routing: "network-solver-v18", verifier: "network-solver-v18", cost: "network-accounting-v18", visualization: "network-visualization-v18" });
  assert.equal(context.diagnostics().externalRequests, 0);
  assert.equal(context.diagnostics().publicRoutingCalls, 0);
});

routePaths.forEach((route, index) => check(`T${String(245 + index).padStart(4, "0")}`, `${route} has a real DESIGN route descriptor`, () => assert.equal(routes.has(route), true)));
check("T0253", "Overview uses strategic horizon language", () => assert.match(Overview.project(store).strategicTimeHorizon.demandPeriod, /STRATEGIC PLANNING HORIZON/));
check("T0254", "Overview excludes real-time operational status from first scan", () => { const value = Overview.project(store); assert.equal(value.excludesRealTimeOperationalStatus, true); assert.equal(value.firstScan.includes("REAL_TIME_VEHICLES"), false); });
check("T0255", "Overview exposes active study", () => assert.equal(Overview.project(store).activeStudy.studyId, store.snapshot().studyId));
check("T0256", "Overview exposes demand period", () => assert.ok(Overview.project(store).strategicTimeHorizon.demandPeriod));
check("T0257", "Overview exposes current facilities", () => assert.equal(Overview.project(store).currentFacilities.depots, 3));
check("T0258", "Overview exposes verified cost and service baseline", () => { const value = Overview.project(store).baseline; assert.equal(value.verified, "PASS"); assert.ok(value.cost > 0); assert.ok(value.service >= 0); });
check("T0259", "Overview exposes candidate portfolios", () => assert.ok(Array.isArray(Overview.project(store).candidatePortfolios)));
check("T0260", "Overview exposes operational validation status", () => assert.equal(Overview.project(store).operationalValidation.boundary, "P6_OPERATIONAL_VALIDATION_BRIDGE_ACTIVE"));
check("T0261", "Overview exposes data gaps", () => assert.ok(Overview.project(store).dataGaps.length >= 3));
check("T0262", "Overview next action routes to a real DESIGN page", () => assert.ok(routes.has(Overview.project(store).nextAction.target)));
check("T0263", "Network Scenarios uses ScenarioLab v1.8 concepts", () => { const value = Scenarios.project(store); assert.equal(value.sourceAuthority, "scenario-lab-v18"); assert.ok(value.supportedTypes.includes("DEMAND_PEAK")); });
check("T0264", "Fleet and Capacity uses verified v1.8 facts", () => { const value = Fleet.project(store); assert.equal(value.verified, true); assert.equal(value.accountingVerified, true); });
check("T0265", "Cost-to-Serve uses verified accounting", () => { const value = Cost.project(store); assert.equal(value.status, "PASS"); assert.ok(value.components.every((row) => row.present)); });

const baselineState = store.snapshot();
const baselineEvaluation = clone(baselineState.evaluation);
check("T0266", "Demand action creates an explicit changed-input scenario", () => { Demand.create(store, "DEMAND_10"); const source = store.snapshot(); assert.equal(source.lifecycle, "SCENARIO_DIRTY"); assert.notEqual(source.activeInputHash, baselineState.activeInputHash); });
check("P4-STATE-001", "A stale evaluation cannot be accepted for a changed input", () => assert.throws(() => store.acceptEvaluation(baselineEvaluation), (error) => error.code === "DESIGN_STALE_EVALUATION_REJECTED"));
store.reset();
check("T0267", "Resilience action creates an explicit outage scenario", () => { Resilience.create(store, "DEPOT_OUTAGE", "D1"); const source = store.snapshot(); assert.equal(source.activeRecord.type, "DEPOT_OUTAGE"); assert.notEqual(source.activeInputHash, source.baselineInputHash); });
store.evaluate();
check("P4-PORTFOLIO-001", "Evaluated scenario remains in the Scenario Portfolio", () => { const source = store.snapshot(); assert.equal(source.scenarioResultRefs.length, 2); assert.ok(source.scenarioResultRefs.every((row) => row.verification === "PASS" && row.accountingVerification === "PASS")); });
check("T0268", "Operational Validation inbox lists bridge results read-only", () => { store.addOperationalValidation({ validationId: "VAL-001", status: "VALID", summary: "Synthetic bridge evidence" }); const value = Validation.project(store); assert.equal(value.items.length, 1); assert.equal(value.readOnly, true); assert.equal(value.canWriteCommandPlan, false); });
check("T0269", "Controlled placeholder is explicitly labeled", () => assert.equal(Facility.project(store).status, "READINESS_ONLY"));
check("T0270", "Facility readiness exposes no inert primary action", () => assert.equal(Facility.project(store).primaryAction, null));
check("T0271", "Center of Gravity is not presented as final real estate", () => assert.equal(Facility.project(store).centerOfGravity.finalRealEstateRecommendation, false));
check("T0272", "Nearest Warehouse is not facility optimization", () => assert.match(Facility.project(store).disclosures.nearestWarehouse, /not Facility Location/));
check("T0273", "Haversine is not a road-economic fact", () => assert.equal(Facility.project(store).centerOfGravity.roadEconomicFact, false));
check("T0274", "DESIGN does not claim investment approval", () => assert.ok(Facility.project(store).prohibitedClaims.includes("INVESTMENT_APPROVED")));
check("T0275", "DESIGN does not claim land availability", () => assert.ok(Facility.project(store).prohibitedClaims.includes("LAND_AVAILABLE")));
check("T0276", "Active study hash is stable", () => { const first = store.snapshot().studyHash; const second = store.snapshot().studyHash; assert.equal(first, second); return first; });
check("T0277", "DESIGN selection is workspace scoped", () => { const command = CommandContext.createContext(); const before = command.snapshot().selected; store.setView({ selectedDepotId: "D2" }); assert.deepEqual(command.snapshot().selected, before); });
check("T0278", "DESIGN view state is workspace scoped and excluded from study hash", () => { const first = store.snapshot().studyHash; store.setView({ panel: "COST", quickFinderQuery: "D2" }); assert.equal(store.snapshot().studyHash, first); });
check("T0279", "DESIGN dirty state is workspace scoped", () => { const fresh = Store.createStore({ context }); const command = CommandContext.createContext(); const before = command.snapshot().plan.planHash; fresh.createScenario("DEMAND_PEAK", { factor: 1.1 }); assert.equal(fresh.snapshot().dirty, true); assert.equal(command.snapshot().plan.planHash, before); });
check("T0280", "DESIGN scenario state survives COMMAND access", () => { const before = store.snapshot().activeInputHash; CommandContext.createContext().snapshot(); assert.equal(store.snapshot().activeInputHash, before); });
check("T0281", "DESIGN reset does not reset COMMAND", () => { const command = CommandContext.createContext(); const before = command.snapshot().plan.planHash; store.reset(); assert.equal(command.snapshot().plan.planHash, before); });
check("T0282", "DESIGN Data Hub adapter is explicit", () => { const source = store.snapshot().dataSource; assert.equal(source.authority, "STCT_V18_NETWORK_CONTRACT"); assert.ok(source.sourceType); });
check("T0283", "DESIGN Scenario Library filter has a scoped view-state key", () => { store.setView({ filters: { scenarioType: "DEMAND_PEAK", actionStatus: "OPEN" } }); assert.equal(store.snapshot().viewState.filters.scenarioType, "DEMAND_PEAK"); });
const adapterSource = fs.readFileSync(path.join(__dirname, "..", "design-workspace-adapter-v19.js"), "utf8");
check("T0284", "DESIGN Trust link opens shared Trust context", () => assert.match(adapterSource, /\/platform\/trust/));
check("T0285", "DESIGN settings do not silently change COMMAND", () => { const command = CommandContext.createContext(); const before = command.snapshot().plan.planHash; store.setView({ panel: "SETTINGS" }); assert.equal(command.snapshot().plan.planHash, before); });
check("T0286", "DESIGN no-WebGL shell has a complete table equivalent", () => { const model = Baseline.project(store); assert.equal(model.noWebGL.operational, true); assert.equal(model.noWebGL.mode, "SVG_AND_TABLE"); });
check("T0287", "DESIGN reduced-motion shell retains static relations", () => { const result = store.context.Visualization.reducedMotion(store.snapshot().evaluation.visual); assert.equal(result.animate, false); assert.equal(result.allRelationsVisible, true); });
check("T0288", "DESIGN mobile policy is declared for every route", () => routes.list().forEach((route) => assert.equal(route.mobilePolicy(), "STACKED_STRATEGIC_BANDS")));
check("T0289", "DESIGN keyboard navigation binds Quick Finder and arrow keys", () => { assert.ok(adapterSource.includes('["ArrowDown", "ArrowUp", "Enter"]')); assert.match(adapterSource, /event\.key === "Enter"/); });
check("T0290", "DESIGN screen-reader structure is present", () => { assert.match(adapterSource, /aria-modal="true"/); assert.match(adapterSource, /role="img"/); assert.match(adapterSource, /role="listbox"/); });
check("T0291", "DESIGN Chinese labels are complete for all routes", () => routePaths.forEach((route) => assert.ok(Adapter.COPY.zh[{ "/design/overview": "overview", "/design/facility-location": "facility", "/design/network-scenarios": "scenarios", "/design/fleet-capacity": "fleet", "/design/cost-to-serve": "cost", "/design/demand-growth": "demand", "/design/resilience": "resilience", "/design/operational-validation": "validation" }[route]])));
check("T0292", "DESIGN English labels are complete for all routes", () => routePaths.forEach((route) => assert.ok(Adapter.COPY.en[{ "/design/overview": "overview", "/design/facility-location": "facility", "/design/network-scenarios": "scenarios", "/design/fleet-capacity": "fleet", "/design/cost-to-serve": "cost", "/design/demand-growth": "demand", "/design/resilience": "resilience", "/design/operational-validation": "validation" }[route]])));
check("T0293", "DESIGN Japanese labels are complete for all routes", () => routePaths.forEach((route) => assert.ok(Adapter.COPY.ja[{ "/design/overview": "overview", "/design/facility-location": "facility", "/design/network-scenarios": "scenarios", "/design/fleet-capacity": "fleet", "/design/cost-to-serve": "cost", "/design/demand-growth": "demand", "/design/resilience": "resilience", "/design/operational-validation": "validation" }[route]])));
check("T0295", "All DESIGN direct links resolve to descriptors", () => routePaths.forEach((route) => assert.equal(routes.get(route).logicalPath, route)));
check("T0300", "DESIGN module boundaries are machine-readable", () => routes.list().forEach((route) => { assert.equal(route.requiredContext, "DesignStrategicContext"); assert.ok(route.requiredModules.length); assert.ok(route.futureGateBoundaries.includes("FACILITY_MVP1_SCOPE_ONLY_NO_P7") && !route.futureGateBoundaries.includes("P6_NOT_STARTED")); }));

check("P4-BRIEF-001", "Network Study Brief is immutable and hash-gated", () => { const brief = Brief.create(store, "<b>A&B</b>"); assert.equal(Brief.verify(store, brief).status, "PASS"); const mutated = clone(brief); mutated.note = "changed"; assert.equal(Brief.verify(store, mutated).status, "FAIL"); assert.equal(Brief.importReadOnly(store, Brief.toJson(brief)).mode, "READ_ONLY"); assert.ok(Brief.toPrintableHtml(brief).includes("&lt;b&gt;A&amp;B&lt;/b&gt;")); assert.ok(!Brief.toJson(brief).includes("&lt;b&gt;")); });
check("P4-BASELINE-001", "Returned baseline and active records cannot mutate store authority", () => { const source = store.snapshot(); source.baseline.scenario.depots[0].name = "MUTATED"; const active = store.activeRecord(); active.scenario.depots[0].name = "MUTATED"; assert.notEqual(store.snapshot().baseline.scenario.depots[0].name, "MUTATED"); assert.notEqual(store.snapshot().activeRecord.scenario.depots[0].name, "MUTATED"); });
check("P4-ACCOUNTING-001", "Missing accounting components are excluded rather than treated as zero", () => { const ledger = clone(store.snapshot().evaluation.accounting); delete ledger.cost.components.distance; const eligibility = store.context.Accounting.candidateEligibility(ledger); assert.equal(eligibility.eligible, false); assert.ok(eligibility.reasons.includes("MISSING_COST:distance")); });
check("P4-FINDER-001", "Quick Finder covers study, facilities, zones, trips and waves without external search", () => { const rows = Finder.index(store); ["study", "facility", "zone", "trip", "wave"].forEach((type) => assert.ok(rows.some((row) => row.type === type), type)); assert.equal(store.diagnostics().externalRequests, 0); return rows.length; });
check("P4-SCALE-001", "DESIGN target data adapter produces 5/20/50/500", () => assert.deepEqual(DataAdapter.createSyntheticStudy().shape, { depots: 5, docks: 20, vehicles: 50, orders: 500 }));

function clone(value) { return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }

const report = { schemaVersion: "stct-design-workspace-test-v1.9-p4", status: observations.every((row) => row.status === "PASS") ? "PASS" : "FAIL", officialRequirementsCovered: observations.filter((row) => /^T0/.test(row.id)).length, observations };
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
