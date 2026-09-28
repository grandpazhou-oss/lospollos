"use strict";

const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const StrategicContext = require("../design-strategic-context-v19.js");
const Store = require("../design-study-store-v19.js");
const Overview = require("../design-overview-v19.js");
const Fleet = require("../fleet-capacity-studio-v19.js");
const Cost = require("../cost-to-serve-explorer-v19.js");
const Finder = require("../design-quick-finder-v19.js");
const Actions = require("../design-action-center-v19.js");
const Brief = require("../network-study-brief-v19.js");
const Registry = require("../design-route-mount-registry-v19.js");

const timings = {};
function measure(name, operation) { const start = performance.now(); const value = operation(); timings[name] = Math.round((performance.now() - start) * 10) / 10; return value; }
const context = measure("strategicContextAndVerifiedBaselineMs", () => StrategicContext.createContext());
const store = measure("designStudyStoreMountMs", () => Store.createStore({ context }));
const shape = store.snapshot().dataSource.shape;
assert.deepEqual(shape, { depots: 5, docks: 20, vehicles: 50, orders: 500 });
assert.equal(store.snapshot().evaluation.plan.waves.waves.length, 20);
assert.equal(store.snapshot().evaluation.verification.status, "PASS");
assert.equal(store.snapshot().evaluation.accountingVerification.status, "PASS");
measure("overviewProjectionMs", () => Overview.project(store));
measure("scenarioApplyMs", () => store.createScenario("DEMAND_PEAK", { factor: 1.1 }));
const evaluation = measure("scenarioEvaluateVerifyAccountVisualMs", () => store.evaluate().result);
measure("accountingProjectionMs", () => Cost.project(store));
measure("capacityProjectionMs", () => Fleet.project(store));
const finderRows = measure("quickFinderMs", () => Finder.index(store));
measure("actionFilterMs", () => Actions.project(store, { category: "DATA_GAP", search: "cost" }));
const brief = measure("studyBriefGenerationMs", () => Brief.create(store, "Performance evidence"));
measure("routeSwitchProjectionMs", () => Registry.ROUTES.forEach((route) => { store.setView({ route: route.logicalPath }); route.noWebGLFallback(); route.reducedMotionPolicy(); route.mobilePolicy(); }));
const readOnly = store.exportReadOnly();
measure("workspaceRestoreValidationMs", () => store.importReadOnly(readOnly));
const result = { schemaVersion: "stct-design-performance-v1.9-p4", status: "PASS", workload: { ...shape, waves: evaluation.plan.waves.waves.length }, timingsMs: timings, facts: { trips: evaluation.plan.trip.trips.length, assigned: evaluation.accounting.metrics.assignedCount, unassigned: evaluation.plan.trip.unassigned.length, service: evaluation.accounting.metrics.serviceLevel, finderRows: finderRows.length, briefBytes: Buffer.byteLength(JSON.stringify(brief)), planStatus: evaluation.plan.status, verifier: evaluation.verification.status, accountingVerifier: evaluation.accountingVerification.status, engine: evaluation.engineBoundary.used, optimality: evaluation.engineBoundary.optimality, publicRoutingCalls: evaluation.engineBoundary.publicRoutingCalls } };
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
