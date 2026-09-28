"use strict";

const assert = require("assert");
const { performance } = require("perf_hooks");
const Context = require("../command-operational-context-v19.js");
const Actions = require("../operations-action-center-v19.js");
const Handoff = require("../shift-handoff-v19.js");
const Adapter = require("../command-workspace-adapter-v19.js");
const Replay = require("../fleet-replay-v17.js");

async function run() {
  const checks = [];
  const check = (id, condition, observed) => {
    assert.ok(condition, `${id} failed`);
    checks.push({ id, status: "PASS", observed });
  };

  const driverContext = Context.createContext();
  await driverContext.ready;
  await driverContext.driver.acceptRoute();
  await driverContext.driver.depart();
  await driverContext.driver.goOffline();
  let prematureStartError = "";
  try { await driverContext.driver.startService(); } catch (error) { prematureStartError = error.code || error.message; }
  const queuedArrival = await driverContext.driver.arrive();
  const projectedAfterArrival = driverContext.driver.viewModel();
  const queued = [queuedArrival, await driverContext.driver.startService(), await driverContext.driver.complete()];
  const projectedBeforeReconnect = driverContext.driver.viewModel();
  const reconnected = await driverContext.driver.reconnect();
  check("P31-OFFLINE-LOCAL-PROJECTION", queued.every((row) => row.status === "QUEUED_OFFLINE") && projectedBeforeReconnect.projectionAuthority === "LOCAL_DRIVER_PROJECTION_V17", { queued: queued.map((row) => row.status), authoritative: projectedBeforeReconnect.authoritativeCurrentStop?.state, projected: projectedBeforeReconnect.localProjectedCurrentStop?.state });
  check("P31-OFFLINE-PREMATURE-SERVICE-REJECTED", prematureStartError === "DRIVER_ACTION_NOT_ALLOWED" && projectedAfterArrival.legalActions.startService === true && projectedAfterArrival.authoritativeCurrentStop?.state === "EN_ROUTE" && projectedAfterArrival.localProjectedCurrentStop?.state === "ARRIVED", { prematureStartError, authoritative: projectedAfterArrival.authoritativeCurrentStop?.state, projected: projectedAfterArrival.localProjectedCurrentStop?.state, startServiceAllowedAfterProjection: projectedAfterArrival.legalActions.startService });
  check("P31-RECONNECT-THREE-ACK", reconnected.status === "RECONNECTED" && reconnected.sync.results.length === 3 && reconnected.sync.results.every((row) => row.status === "ACKED") && driverContext.offlineQueue.summary().ackAuditCount === 3, { status: reconnected.status, sync: reconnected.sync.results.map((row) => row.status), ackAuditCount: driverContext.offlineQueue.summary().ackAuditCount });

  const adoptionContext = Context.createContext();
  await adoptionContext.ready;
  const appliedScenario = Replay.syntheticScenario({ vehicleCount: 4, stopsPerVehicle: 4, positionsPerVehicle: 8 });
  const appliedPlan = Context.planFromScenario(appliedScenario);
  appliedPlan.planId = "P31-UPLOADED-VERIFIED";
  appliedPlan.meta = { scenarioSnapshot: appliedScenario };
  const rejected = adoptionContext.adoptAppliedPlan(appliedPlan, { policy: "REJECT_WHILE_RUNNING" });
  const unapprovedMigration = adoptionContext.adoptAppliedPlan(appliedPlan, { policy: "EXPLICIT_MIGRATION" });
  const adopted = adoptionContext.adoptAppliedPlan(appliedPlan, { policy: "RESET_EXECUTION", reason: "P31_TEST" });
  await adoptionContext.ready;
  const adoptedState = adoptionContext.snapshot();
  check("P31-APPLIED-PLAN-POLICY", rejected.code === "ACTIVE_EXECUTION_PLAN_CHANGE_REJECTED" && unapprovedMigration.code === "EXPLICIT_MIGRATION_APPROVAL_REQUIRED" && adopted.status === "ADOPTED", { rejected, unapprovedMigration, adopted });
  check("P31-APPLIED-PLAN-CONTEXT", adoptedState.plan.planHash === appliedPlan.planHash && adoptedState.execution.run.planHash === appliedPlan.planHash && adoptedState.simulation.activePlanHash === appliedPlan.planHash && adoptedState.scenario.sourceType === "UPLOADED_APPLIED", { planHash: adoptedState.plan.planHash, runPlanHash: adoptedState.execution.run.planHash, simulationPlanHash: adoptedState.simulation.activePlanHash, sourceType: adoptedState.scenario.sourceType });

  const semanticContext = Context.createContext();
  await semanticContext.ready;
  const semanticRows = Actions.project(semanticContext).items.filter((row) => row.ruleId);
  const semantics = Object.fromEntries(semanticRows.map((row) => [row.ruleId, { category: row.category, actionType: row.actionType }]));
  check("P31-ACTION-SEMANTICS", semantics.OFF_ROUTE?.actionType === "OFF_ROUTE" && semantics.ROUTE_STALLED?.actionType === "ROUTE_STALLED" && semantics.ETA_RISK?.actionType === "ETA_RISK" && semantics.EXCESS_DWELL?.actionType === "EXCESS_DWELL" && !Object.entries(semantics).some(([ruleId, row]) => ruleId !== "STALE_TELEMETRY" && row.actionType === "STALE_TELEMETRY"), semantics);

  const rawNote = "<b>A&B</b>";
  const handoffPack = Handoff.generate(semanticContext, Actions.project(semanticContext), { operatorNotes: [rawNote] });
  const sourceBytes = JSON.stringify(handoffPack);
  const imported = Handoff.importReadOnly(Handoff.toJson(handoffPack), semanticContext);
  const html = Handoff.toPrintableHtml(imported.pack);
  check("P31-HANDOFF-IMMUTABLE", imported.status === "PASS" && Handoff.validate(imported.pack).status === "PASS" && JSON.stringify(imported.pack) === sourceBytes && imported.pack.sourceHandoffHash === undefined && imported.envelope.sourceHandoffHash === handoffPack.handoffHash, { validation: Handoff.validate(imported.pack), envelope: imported.envelope });
  check("P31-HANDOFF-RENDER-ESCAPE", handoffPack.operatorNotes[0].text === rawNote && Handoff.toJson(handoffPack).includes(rawNote) && html.includes("&lt;b&gt;A&amp;B&lt;/b&gt;") && !html.includes("&amp;lt;b&amp;gt;") && Handoff.csvSafe("=SUM(A1:A2)").startsWith("'"), { stored: handoffPack.operatorNotes[0], htmlEscapedOnce: true, formulaSafe: Handoff.csvSafe("=SUM(A1:A2)") });

  const scaleContext = Context.createContext({ fixture: { vehicleCount: 20, stopsPerVehicle: 12, positionsPerVehicle: 24 } });
  await scaleContext.ready;
  const scaleStart = performance.now();
  let finderSize = 0;
  let actionSize = 0;
  for (let index = 0; index < 100; index += 1) {
    Adapter.overviewProjection(scaleContext);
    actionSize = Actions.project(scaleContext, { sort: index % 2 ? "priority" : "freshness" }).items.length;
    finderSize = Adapter.quickFinderIndex(scaleContext, "/command/overview").length;
  }
  const projectionElapsedMs = performance.now() - scaleStart;
  const handoffStart = performance.now();
  const scaleHandoff = Handoff.generate(scaleContext, Actions.project(scaleContext), { operatorNotes: ["20/240 scale closure"] });
  const handoffElapsedMs = performance.now() - handoffStart;
  check("P31-SCALE-20-240", scaleContext.scenario.routes.length === 20 && scaleContext.scenario.stops.length === 240 && finderSize >= 281 && scaleHandoff.activeRoutes.length === 20, { vehicles: scaleContext.scenario.routes.length, stops: scaleContext.scenario.stops.length, finderSize, actionSize, projectionElapsedMs, handoffElapsedMs });

  return { schemaVersion: "stct-v1.9-p31-domain-integrity-test-v1", status: "PASS", checks, performance: { workload: { vehicles: 20, stops: 240 }, projectionIterations: 100, projectionElapsedMs, handoffElapsedMs } };
}

if (require.main === module) run().then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });

module.exports = run;
