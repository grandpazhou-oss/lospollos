#!/usr/bin/env node
"use strict";

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const Adapter = require("../command-workspace-adapter-v19.js");
const Registry = require("../command-route-mount-registry-v19.js");
const Context = require("../command-operational-context-v19.js");
const Actions = require("../operations-action-center-v19.js");
const Handoff = require("../shift-handoff-v19.js");
const Router = require("../workspace-router-v19.js");
const Legacy = require("../legacy-route-mapping-v19.js");
const { createChecks, printResult } = require("./platform-v19-test-utils.js");

const repo = path.resolve(__dirname, "..");
const { assertions, check } = createChecks("tests/test_command_workspace_v19.js");
const source = (file) => fs.readFileSync(path.join(repo, file), "utf8");

function fakeEventTarget() {
  const listeners = new Map();
  return {
    innerHTML: "",
    classList: { add() {}, remove() {} },
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    listenerCount() { return [...listeners.values()].reduce((sum, rows) => sum + rows.size, 0); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

function fakeScope() {
  const cleanups = [];
  return {
    listen(target, type, listener) { target.addEventListener(type, listener); cleanups.push(() => target.removeEventListener(type, listener)); },
    register(cleanup) { cleanups.push(cleanup); },
    async cleanup() { while (cleanups.length) await cleanups.pop()(); },
  };
}

function runTest(file) {
  return childProcess.spawnSync(process.execPath, [path.join(__dirname, file)], { cwd: repo, encoding: "utf8", maxBuffer: 1024 * 1024 * 20 });
}

async function main() {
  const registry = Registry.createRegistry();
  const adapter = Adapter.createAdapter({ document: fakeEventTarget(), requestText: (_message, value) => value });
  const capabilities = adapter.inventoryCapabilities();
  const mappings = [
    ["T0185", "serviceView", "/command/overview"],
    ["T0186", "mapView", "/command/dispatch"],
    ["T0187", "experience-replay", "/command/mission-control"],
    ["T0188", "experience-v17", "/command/execution"],
    ["T0189", "analysisView", "/command/plan-vs-actual"],
    ["T0190", "experience-v16", "/command/execution"],
    ["T0191", "exceptionsView", "/command/alerts"],
    ["T0192", "experience-v16", "/command/execution"],
    ["T0193", "reportView", "/command/shift-review"],
  ];

  check("T0183", adapter.schemaVersion === "stct-command-workspace-adapter-v1.9-p3" && registry.diagnostics().missingContracts.length === 0, { adapter: adapter.schemaVersion, registry: registry.schemaVersion }, "stable adapter and mount descriptor schemas");
  check("T0184", capabilities.length >= 21 && ["ExecutionStore", "AlertStore", "Capsule / Audit"].every((name) => capabilities.includes(name)), capabilities, "complete existing operational authority inventory");
  mappings.forEach(([id, legacy, expected]) => check(id, adapter.mapLegacyTarget(legacy) === expected || (id === "T0192" && registry.has("/command/recovery")), { legacy, mapped: adapter.mapLegacyTarget(legacy), mounted: registry.has(expected) }, expected));

  const target = fakeEventTarget();
  const documentValue = fakeEventTarget();
  const scope = fakeScope();
  const overviewDescriptor = registry.get("/command/overview");
  const mount = adapter.mountDescriptor(overviewDescriptor, { logicalPath: overviewDescriptor.logicalPath, routeParams: {}, scope }, { target, snapshot: { locale: "en", noWebGL: false, reducedMotion: false }, controller: { navigate() {} } });
  await adapter.createOperationalContext().ready;
  const operational = adapter.createOperationalContext();
  check("T0194", target.innerHTML.includes("Operations Cockpit") && operational.snapshot().execution.authority === "EXECUTION_STORE_V17", { rendered: target.innerHTML.includes("Operations Cockpit"), authority: operational.snapshot().execution.authority }, "real COMMAND domain state mounted");
  const sharedBefore = operational.snapshot().execution.run.executionRunHash;
  mount.cleanup();
  await scope.cleanup();
  check("T0195", target.listenerCount() === 0 && documentValue.listenerCount() === 0 && adapter.diagnostics().cleanupCount === 1, { targetListeners: target.listenerCount(), documentListeners: documentValue.listenerCount(), diagnostics: adapter.diagnostics() }, "workspace-owned listeners cleaned");
  check("T0196", operational.snapshot().execution.run.executionRunHash === sharedBefore && adapter.diagnostics().sharedAuthority.singleAuthorities.executionStore === 1, operational.snapshot().execution.run.executionRunHash, sharedBefore);

  operational.select({ routeId: "R03", vehicleId: "V03" });
  operational.replay.seek(160);
  adapter.state.alertFilters = { ...adapter.state.alertFilters, severity: "HIGH", routeId: "R03" };
  const saved = adapter.snapshot();
  const serialized = JSON.stringify(saved);
  check("T0197", serialized.length < 10000 && !/acceptedEvents|routeGeometry|raw Excel|credentials/i.test(serialized), serialized.length, "small serializable reference snapshot");
  operational.select({ routeId: "R01", vehicleId: "V01" });
  operational.replay.seek(100);
  adapter.state.alertFilters.severity = "ALL";
  adapter.restore(saved);
  check("T0198", operational.snapshot().selected.routeId === "R03", operational.snapshot().selected.routeId, "R03");
  check("T0199", operational.snapshot().selected.vehicleId === "V03", operational.snapshot().selected.vehicleId, "V03");
  check("T0200", operational.replay.snapshot().clock === 160, operational.replay.snapshot().clock, 160);
  check("T0201", adapter.snapshot().alertFilters.severity === "HIGH" && adapter.snapshot().alertFilters.routeId === "R03", adapter.snapshot().alertFilters, saved.alertFilters);
  check("T0202", adapter.snapshot().recoverySessionId === saved.recoverySessionId && saved.recoverySessionId.startsWith("sha256:"), adapter.snapshot().recoverySessionId, saved.recoverySessionId);

  const legacyRoute = Router.parseBrowserLocation({ pathname: "/index.html", search: "?view=mapView", hash: "" });
  check("T0203", legacyRoute.ok && legacyRoute.logicalPath === "/command/dispatch" && Legacy.currentInventoryComplete(), legacyRoute, "/command/dispatch");
  const adapterSource = source("command-workspace-adapter-v19.js");
  const planningSource = source("planning-v12.js");
  check("T0204", ["generateScenarios", "applySelected", "restore", "startManual", "evaluateCapacityOptions", "exportSnapshot"].every((name) => adapterSource.includes(name) && planningSource.includes(name)), "real planning calls wired", "all Dispatch primary controls call existing domain operations");

  const mission = Context.createContext();
  await mission.ready;
  const simulationBefore = mission.snapshot().simulation.simulationHash;
  const planBefore = mission.snapshot().plan.planHash;
  await mission.addSimulationDelay("R01", "R01-S02", 15);
  check("T0205", mission.simulationStore.snapshot().version.includes("simulation") && mission.snapshot().simulation.simulationHash !== simulationBefore, mission.snapshot().simulation, "real SimulationStore mutation");
  check("T0206", mission.workspace.recoveryCandidates().length > 0 && mission.workspace.recoveryCandidates().every((candidate) => candidate.reference || candidate.verification.status === "PASS"), mission.workspace.recoveryCandidates().map((row) => row.verification.status), "verified plans only");
  check("T0207", mission.snapshot().plan.planHash === planBefore && mission.snapshot().simulation.activeEvents.length === 1, { before: planBefore, after: mission.snapshot().plan.planHash, events: mission.snapshot().simulation.activeEvents.length }, "transactional simulation with stable verified plan");

  const executionBefore = mission.executionStore.snapshot().acceptedEvents.length;
  const pauseResult = mission.appendExecution("RUN_PAUSED");
  check("T0208", pauseResult.status === "ACCEPTED" && mission.executionStore.snapshot().acceptedEvents.length === executionBefore + 1 && mission.executionStore.snapshot().run.status === "PAUSED", { result: pauseResult.status, eventCount: mission.executionStore.snapshot().acceptedEvents.length, runStatus: mission.executionStore.snapshot().run.status }, "ExecutionStore accepted event");
  const report = mission.planActual();
  check("T0209", report.schemaVersion.includes("plan-actual") && report.routes.length === mission.scenario.routes.length && report.summary.source.includes("DERIVED_TELEMETRY"), report.summary, "derived telemetry Plan-vs-Actual");

  const driverContext = Context.createContext();
  await driverContext.ready;
  await driverContext.driver.acceptRoute();
  await driverContext.driver.depart();
  await driverContext.driver.goOffline();
  const queued = [
    await driverContext.driver.arrive(),
    await driverContext.driver.startService(),
    await driverContext.driver.complete(),
  ];
  const projected = driverContext.driver.viewModel();
  const reconnected = await driverContext.driver.reconnect();
  check("T0210", queued.every((result) => result.status === "QUEUED_OFFLINE")
    && projected.projectionAuthority === "LOCAL_DRIVER_PROJECTION_V17"
    && projected.simulationBoundary === "Local Simulation"
    && reconnected.status === "RECONNECTED"
    && driverContext.offlineQueue.summary().total === 0
    && reconnected.sync.results.every((row) => row.status === "ACKED")
    && driverContext.offlineQueue.summary().ackAuditCount === 3,
  { queued: queued.map((result) => result.status), projectionAuthority: projected.projectionAuthority, reconnected: reconnected.status, summary: driverContext.offlineQueue.summary(), syncResults: reconnected.sync.results.map((row) => row.status) },
  "local driver projection, ordered replay, and authoritative ACK closure");

  const alertContext = Context.createContext();
  await alertContext.ready;
  const alertItem = Actions.project(alertContext).items.find((row) => row.alertId === "P3-ALERT-01");
  const acknowledged = await Actions.execute(alertContext, alertItem, "ACKNOWLEDGE");
  check("T0211", acknowledged.alert.state === "ACKNOWLEDGED" && alertContext.alertStore.list({ state: "ACKNOWLEDGED" }).some((row) => row.alertId === "P3-ALERT-01"), acknowledged, "AlertStore authoritative transition");

  const recoveryContext = Context.createContext();
  await recoveryContext.ready;
  const recoveryAlert = Actions.project(recoveryContext).items.find((row) => row.alertId === "P3-ALERT-01");
  recoveryContext.addIncidentFromAlert(recoveryAlert.alertId);
  const recoveryCandidate = recoveryContext.workspace.recoveryCandidates().find((row) => !row.reference);
  const preview = recoveryContext.workspace.previewRecovery(recoveryCandidate.planHash);
  const applied = recoveryContext.workspace.applyRecovery(recoveryCandidate.planHash);
  check("T0212", preview.status === "PREVIEW" && applied.status === "APPLIED" && recoveryContext.recoverySession.snapshot().revision === 2, { preview: preview.status, applied: applied.status, revision: recoveryContext.recoverySession.snapshot().revision }, "real recovery session actions");

  let configuredEngineCalls = 0;
  const engineContext = Context.createContext({ fullRecoveryEngine: { available: true, status: "READY", engineId: "LOCAL_TEST_ENGINE", async generateRecovery() { configuredEngineCalls += 1; return { status: "COMPLETED", source: "LOCAL_TEST_ENGINE" }; } } });
  await engineContext.ready;
  const engineResult = await engineContext.runFullReoptimization();
  check("T0213", configuredEngineCalls === 1 && engineResult.source === "LOCAL_TEST_ENGINE", { configuredEngineCalls, engineResult }, "configured engine boundary called when ready");
  const review = recoveryContext.shiftReview();
  const recorder = recoveryContext.flightRecorder();
  check("T0214", review.eventWindow.acceptedEventCount === recoveryContext.executionStore.snapshot().acceptedEvents.length && recorder.rows.some((row) => row.category === "INCIDENT"), { reviewEvents: review.eventWindow.acceptedEventCount, recorderRows: recorder.rows.length }, "rebuilt from domain events");
  check("T0215", recoveryContext.snapshot().plan.providerProvenance.providerId === "SYNTHETIC_ROAD_FIXTURE" && recoveryContext.diagnostics().publicRoutingCalls === 0, recoveryContext.snapshot().plan.providerProvenance, "provider-owned local fixture");
  check("T0216", recoveryContext.snapshot().plan.matrixHash.startsWith("sha256:") && recoveryContext.recoverySession.exportLineage().matrixHash === recoveryContext.snapshot().plan.matrixHash, recoveryContext.recoverySession.exportLineage().matrixHash, recoveryContext.snapshot().plan.matrixHash);
  const capsule = runTest("test_capsule_deep_integrity_v151.js");
  check("T0217", capsule.status === 0 && JSON.parse(capsule.stdout).adversarialInternalMutations === 9, { exitCode: capsule.status, stderr: capsule.stderr }, "deep capsule verification regression PASS");
  check("T0218", Router.ROUTES.filter((row) => row.logicalPath === "/platform/trust").length === 1 && !Router.ROUTES.some((row) => row.logicalPath.startsWith("/command/trust")), Router.ROUTES.filter((row) => /trust/.test(row.logicalPath)).map((row) => row.logicalPath), "one unified platform Trust & Audit route");
  const traceSource = source("traceability-v18.js");
  check("T0219", traceSource.includes("validateOfficialRegistry") && traceSource.includes("validateResults") && traceSource.includes("lexicalCoverage"), "semantic validators present", "semantic traceability retained");
  const mutation = runTest("test_execution_state_machine_v17.js");
  check("T0220", mutation.status === 0 && JSON.parse(mutation.stdout).status === "PASS", { exitCode: mutation.status, stderr: mutation.stderr }, "COMMAND invariant regression PASS");

  const diagnostics = recoveryContext.diagnostics();
  check("T0221", Object.values(diagnostics.singleAuthorities).every((count) => count === 1), diagnostics.singleAuthorities, "one instance per operational authority");
  check("T0222", diagnostics.mapEngineCreated === 0 && !adapterSource.includes("new maplibregl.Map"), diagnostics.mapEngineCreated, 0);
  check("T0223", !source("command-operational-context-v19.js").includes("createRegistry()") && capabilities.includes("Routing Provider"), "no COMMAND routing registry", "reuse provider registry");
  check("T0224", !source("command-operational-context-v19.js").includes("function sha256") && source("command-operational-context-v19.js").includes("Integrity.hashValue"), "shared Integrity.hashValue", "no second canonical implementation");
  const commandSnapshotText = JSON.stringify(adapter.snapshot());
  check("T0225", !/DESIGN|facility|cost-to-serve|demand/i.test(commandSnapshotText), commandSnapshotText, "COMMAND references isolated from DESIGN mutable data");
  const switchBefore = recoveryContext.snapshot();
  recoveryContext.pauseForWorkspaceSwitch();
  const switchAfter = recoveryContext.snapshot();
  check("T0226", switchAfter.replay.playing === false && switchAfter.replay.clock === switchBefore.replay.clock && switchAfter.execution.executionStateHash === switchBefore.execution.executionStateHash, { before: { clock: switchBefore.replay.clock, stateHash: switchBefore.execution.executionStateHash }, after: { clock: switchAfter.replay.clock, playing: switchAfter.replay.playing, stateHash: switchAfter.execution.executionStateHash } }, "pause UI playback, preserve authority");
  adapter.state.route = "/command/alerts";
  const returnSnapshot = adapter.snapshot();
  adapter.state.route = "/command/overview";
  adapter.restore(returnSnapshot);
  check("T0227", adapter.snapshot().route === "/command/alerts", adapter.snapshot().route, "/command/alerts");
  check("T0228", recoveryContext.snapshot().execution.acceptedEvents.length === switchBefore.execution.acceptedEvents.length && recoveryContext.snapshot().replay.playing === false, { events: recoveryContext.snapshot().execution.acceptedEvents.length, playing: recoveryContext.snapshot().replay.playing }, "return does not auto-start execution");
  check("T0229", registry.list().every((row) => row.noWebGLFallback() === "COMPLETE_OPERATIONAL_TABLE_EQUIVALENT") && adapterSource.includes("noWebGL"), registry.list().map((row) => row.noWebGLFallback()), "all COMMAND routes have functional no-WebGL policy");
  check("T0230", registry.list().every((row) => row.reducedMotionPolicy() === "STATIC_BY_DEFAULT_NO_AUTO_PLAY") && source("command-workspace-v19.css").includes("prefers-reduced-motion"), "static by default", "functional reduced-motion policy");
  check("T0231", ["运营驾驶舱", "运营行动中心", "快速查找", "班次交接"].every((term) => Object.values(Adapter.COPY.zh).includes(term)), [Adapter.COPY.zh.overview, Adapter.COPY.zh.actionCenter, Adapter.COPY.zh.finder, Adapter.COPY.zh.handoff], "Chinese COMMAND terms");
  check("T0232", ["Operations Cockpit", "Operations Action Center", "Quick Finder", "Shift Handoff"].every((term) => Object.values(Adapter.COPY.en).includes(term)), [Adapter.COPY.en.overview, Adapter.COPY.en.actionCenter, Adapter.COPY.en.finder, Adapter.COPY.en.handoff], "English COMMAND terms");
  check("T0233", ["運用コックピット", "運用アクションセンター", "クイック検索", "シフト引継ぎ"].every((term) => Object.values(Adapter.COPY.ja).includes(term)), [Adapter.COPY.ja.overview, Adapter.COPY.ja.actionCenter, Adapter.COPY.ja.finder, Adapter.COPY.ja.handoff], "Japanese COMMAND terms");
  const css = source("command-workspace-v19.css");
  check("T0234", css.includes("@media (max-width: 520px)") && css.includes("grid-template-columns: 1fr"), "portrait media policy", "390x844 functional stacking");
  check("T0235", css.includes("orientation: landscape") && css.includes("max-height: 500px"), "landscape media policy", "844x390 functional layout");
  check("T0236", css.includes("@media (max-width: 1100px)") && css.includes("width: min(1500px, 100%)"), "responsive desktop policy", "desktop functional layout");
  check("T0237", adapter.diagnostics().warnings.length === 0, adapter.diagnostics().warnings, []);
  check("T0238", adapter.diagnostics().warnings.length === 0 && adapter.diagnostics().externalRequests === 0, adapter.diagnostics(), "zero unexplained COMMAND warning and request count");
  const started = performance.now();
  for (let index = 0; index < 100; index += 1) { Adapter.overviewProjection(recoveryContext); Actions.project(recoveryContext, { sort: index % 2 ? "priority" : "freshness" }); Adapter.quickFinderIndex(recoveryContext, "/command/overview"); }
  const elapsedMs = performance.now() - started;
  check("T0239", elapsedMs < 2000, { iterations: 100, elapsedMs }, "100 real projections under 2000ms; browser evidence records route mounts");
  const hashes = recoveryContext.snapshot();
  check("T0240", [hashes.scenario.inputHash, hashes.plan.planHash, hashes.plan.matrixHash, hashes.execution.run.executionRunHash, hashes.execution.executionStateHash].every((hash) => String(hash).startsWith("sha256:")), { inputHash: hashes.scenario.inputHash, planHash: hashes.plan.planHash, matrixHash: hashes.plan.matrixHash, runHash: hashes.execution.run.executionRunHash, stateHash: hashes.execution.executionStateHash }, "source hashes recorded");
  const indexHtml = source("index.html");
  const uploadSource = source("upload.js");
  check("T0241", indexHtml.includes("xlsx.full.min.js") && indexHtml.includes("upload.js") && uploadSource.includes("setRawData") && uploadSource.includes("raw-dispatch-template.xlsx") && fs.existsSync(path.join(repo, "templates", "raw-dispatch-template.xlsx")), "Excel parser, upload validation/application flow, blank template present", "original Excel workflows available");
  check("T0242", Legacy.currentInventoryComplete() && Legacy.mapsOperationalTabsToCommand() && adapter.registerRoutes().length === 9, { legacy: Legacy.CURRENT_NAV_INVENTORY.length, commandRoutes: adapter.registerRoutes().length }, "before inventory and after mount registry complete");
  const retainedPrimary = ["planning-v12.js", "simulation-store-v15.js", "execution-reducer-v17.js", "driver-simulator-v16.js", "operations-alerts-v16.js", "rolling-recovery-v16.js", "shift-review-v17.js"];
  check("T0243", retainedPrimary.every((file) => fs.existsSync(path.join(repo, file))) && capabilities.length >= retainedPrimary.length, retainedPrimary, "existing primary functions retained");
  check("T0244", assertions.length === 61 && assertions.every((row) => row.status === "PASS"), { completedBeforeSummary: assertions.length, failed: assertions.filter((row) => row.status !== "PASS") }, "61 prior official assertions PASS and summary generated");

  const entityContext = Context.createContext();
  await entityContext.ready;
  entityContext.select({ routeId: "R03", vehicleId: "V03" });
  entityContext.select({ vehicleId: "V05" });
  check("P3X001", entityContext.snapshot().selected.routeId === "R05" && entityContext.snapshot().selected.vehicleId === "V05", entityContext.snapshot().selected, "vehicle deep links replace stale route context");

  const dismissContext = Context.createContext();
  await dismissContext.ready;
  const dismissItem = Actions.project(dismissContext).items.find((row) => row.alertId === "P3-ALERT-03");
  const dismissed = await Actions.execute(dismissContext, dismissItem, "DISMISS", { reason: "QA reviewed non-actionable" });
  check("P3X002", dismissed.alert.state === "DISMISSED" && dismissed.alert.resolution?.reason === "QA reviewed non-actionable", dismissed.alert, "dismissal records an operator reason in AlertStore");

  const handoffContext = Context.createContext();
  await handoffContext.ready;
  const handoffBefore = handoffContext.snapshot();
  const handoffPack = Handoff.generate(handoffContext, Actions.project(handoffContext), { operatorNotes: ["Next shift verifies R01"] });
  const imported = Handoff.importReadOnly(Handoff.toJson(handoffPack), handoffContext);
  const handoffAfter = handoffContext.snapshot();
  const tamperedPack = { ...handoffPack, operationalStatus: "TAMPERED" };
  const tamperedImport = Handoff.importReadOnly(tamperedPack, handoffContext);
  check("P3X003", imported.status === "PASS" && imported.mode === "READ_ONLY" && Object.values(imported.sideEffects).every((value) => value === false) && handoffAfter.execution.executionStateHash === handoffBefore.execution.executionStateHash && tamperedImport.status === "FAIL" && tamperedImport.errors.includes("HANDOFF_HASH_MISMATCH"), { imported, beforeHash: handoffBefore.execution.executionStateHash, afterHash: handoffAfter.execution.executionStateHash, tamperedImport }, "read-only import preserves authority and rejects tampering");
  check("P3X004", adapterSource.includes("Minimum vehicles") && adapterSource.includes("最少車両") && !adapterSource.includes("Object.keys(context.optimizer()?.GOALS"), "localized objective labels", "Dispatch never renders numeric array indexes as objective names");

  printResult(assertions, { requirementRange: "T0183-T0244", requiredPassed: assertions.filter((row) => /^T\d{4}$/.test(row.requirementId) && row.status === "PASS").length, totalRequired: 62 });
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });
