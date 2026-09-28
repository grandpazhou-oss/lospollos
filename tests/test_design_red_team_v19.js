"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Store = require("../design-study-store-v19.js");
const ScenarioStudio = require("../network-scenario-studio-v19.js");
const Cost = require("../cost-to-serve-explorer-v19.js");
const Facility = require("../facility-location-readiness-v19.js");
const Brief = require("../network-study-brief-v19.js");

const tests = [];
function attack(id, description, operation) {
  try { operation(); tests.push({ id, description, status: "PASS" }); }
  catch (error) { tests.push({ id, description, status: "FAIL", error: error.stack || error.message }); throw error; }
}
const store = Store.createStore({ fixtureOptions: { depotCount: 2, docksPerDepot: 2, vehicleCount: 8, orderCount: 32, seed: 19 } });
const clone = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));

attack("RED-STUDY-001", "Presentation mutations cannot alter the Study hash", () => { const before = store.snapshot().studyHash; store.setView({ selectedDepotId: "D2", panel: "ATTACK", quickFinderQuery: "x" }); assert.equal(store.snapshot().studyHash, before); });
attack("RED-STUDY-002", "Returned baseline data cannot mutate canonical study state", () => { const external = store.snapshot(); external.baseline.scenario.orders[0].demand.volume = 999999; assert.notEqual(store.snapshot().baseline.scenario.orders[0].demand.volume, 999999); });
attack("RED-STUDY-003", "Stale evaluation is rejected after changed input", () => { const old = clone(store.snapshot().evaluation); store.createScenario("DEMAND_PEAK", { factor: 1.25 }); assert.throws(() => store.acceptEvaluation(old), (error) => error.code === "DESIGN_STALE_EVALUATION_REJECTED"); store.reset(); });
attack("RED-SCENARIO-001", "Different-input results use scenario-changed wording", () => { const before = store.snapshot().baselineInputHash; store.createScenario("DEMAND_PEAK", { factor: 1.1 }); const row = ScenarioStudio.project(store).scenarios.at(-1); assert.notEqual(row.inputHash, before); assert.equal(row.comparisonWording, "SCENARIO_CHANGED"); store.reset(); });
attack("RED-ACCOUNTING-001", "Missing cost component is ineligible and not treated as zero", () => { const ledger = clone(store.snapshot().evaluation.accounting); delete ledger.cost.components.distance; const eligibility = store.context.Accounting.candidateEligibility(ledger); assert.equal(eligibility.eligible, false); assert.ok(eligibility.reasons.includes("MISSING_COST:distance")); });
attack("RED-ACCOUNTING-002", "Cost projection exposes every named v1.8 component", () => { const value = Cost.project(store); assert.deepEqual(value.components.map((row) => row.name), store.context.Accounting.COST_COMPONENTS); assert.ok(value.components.every((row) => row.present && Number.isFinite(row.value))); });
attack("RED-FACILITY-001", "Facility readiness cannot emit a fake recommendation", () => { const value = Facility.project(store); assert.equal(value.solverStatus, "NOT_STARTED"); assert.equal(value.primaryAction, null); assert.equal(value.centerOfGravity.finalRealEstateRecommendation, false); assert.ok(value.prohibitedClaims.includes("INVESTMENT_APPROVED")); });
attack("RED-FACILITY-002", "Nearest depot, CoG and Haversine boundaries are explicit", () => { const value = Facility.project(store); assert.match(value.disclosures.nearestWarehouse, /not Facility Location/); assert.match(value.disclosures.centerOfGravity, /not real property/); assert.match(value.disclosures.haversine, /not road economics/); });
attack("RED-BRIEF-001", "Study Brief rejects note or fact mutation", () => { const pack = Brief.create(store, "<script>alert('&')</script>"); const changedNote = clone(pack); changedNote.note = "safe?"; assert.equal(Brief.verify(store, changedNote).status, "FAIL"); const changedFact = clone(pack); changedFact.facts.cost += 1; assert.equal(Brief.verify(store, changedFact).status, "FAIL"); });
attack("RED-BRIEF-002", "Study Brief keeps raw notes and escapes exactly at HTML rendering", () => { const note = "<b>A&B</b>"; const pack = Brief.create(store, note); assert.equal(pack.note, note); assert.ok(Brief.toJson(pack).includes(note)); assert.ok(Brief.toPrintableHtml(pack).includes("&lt;b&gt;A&amp;B&lt;/b&gt;")); assert.ok(!Brief.toPrintableHtml(pack).includes("&amp;lt;b&amp;gt;")); });
attack("RED-BRIEF-003", "Study Brief import is immutable read-only and hash-gated", () => { const pack = Brief.create(store, "audit"); const imported = Brief.importReadOnly(store, Brief.toJson(pack)); assert.equal(imported.status, "PASS"); assert.equal(imported.mode, "READ_ONLY"); const tampered = JSON.parse(Brief.toJson(pack)); tampered.studyId = "ATTACK"; assert.equal(Brief.importReadOnly(store, tampered).status, "FAIL"); });
attack("RED-AUTHORITY-001", "No duplicate canonical, matrix, routing registry, network verifier or cost authority is defined by DESIGN", () => { const files = fs.readdirSync(path.resolve(__dirname, "..")).filter((name) => /^design-|studio-v19|readiness-v19|explorer-v19|inbox-v19|network-study-brief-v19/.test(name) && name.endsWith(".js")); const source = files.map((file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8")).join("\n"); ["function normalizeScenario(", "function solveNetwork(", "function verifyNetworkPlan(", "function computeAccounting(", "function createRoutingRegistry("].forEach((signature) => assert.equal(source.includes(signature), false, signature)); });
attack("RED-BOUNDARY-001", "P5, P6, and Facility MVP-1 expose explicit local boundaries", () => { const boundaries = store.context.boundaries; assert.equal(boundaries.facilityLocationSolver, "MVP1_LOCAL_OR_TOOLS_CP_SAT"); assert.equal(boundaries.facilityLocationScope, "FINITE_CANDIDATE_P1_P2_P3"); assert.equal(boundaries.p5SharedPlatformServices, "LOCAL_IMPLEMENTED"); assert.equal(boundaries.p6OperationalValidationBridge, "LOCAL_IMPLEMENTED"); });
attack("RED-NETWORK-001", "DESIGN makes no public route or optimizer requests", () => { const diagnostics = store.diagnostics(); assert.equal(diagnostics.externalRequests, 0); assert.equal(diagnostics.context.publicRoutingCalls, 0); });

process.stdout.write(`${JSON.stringify({ schemaVersion: "stct-design-red-team-v1.9-p4", status: tests.every((test) => test.status === "PASS") ? "PASS" : "FAIL", attacks: tests.length, tests }, null, 2)}\n`);
