#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Integrity = require("../integrity-hash-v151.js");
const Alerts = require("../operations-alerts-v16.js");

const checks = [];
function check(id, condition, detail = {}) { assert(condition, `${id}: ${JSON.stringify(detail)}`); checks.push({ id, status: "PASS", detail }); }
function throwsCode(run, code) { try { run(); } catch (error) { return error.code === code; } return false; }
const runHash = Integrity.hashValue({ run: "ALERTS" });
function context(overrides = {}) { return { executionRunHash: runHash, routeId: "R1", vehicleId: "V1", orderId: "O1", logicalTime: 500, relatedEventIds: ["E1"], source: "ACCEPTED_EXECUTION_EVENTS", etaRiskMinutes: 12, missedWindowMinutes: 4, dwellMinutes: 20, offRouteDistanceKm: 1.2, minutesSincePosition: 15, unplannedStopCount: 1, failedStopCount: 1, vehicleBreakdown: true, staleStatus: "STALE", eventConflictCount: 1, unreachablePairCount: 2, recoveryRequired: true, ...overrides }; }

function main() {
  const eta = Alerts.alertFromRule("ETA_RISK", context());
  check("T318", eta.schemaVersion === "stct-operational-alert-v1.6" && eta.alertId.startsWith("ALERT-") && eta.ruleId === "ETA_RISK", eta);
  check("T319", eta.alertHash.startsWith("sha256:") && eta.alertHash === Integrity.hashValue(Alerts.alertIdentity(eta)));
  check("T320", Alerts.SEVERITIES.join(",") === "INFO,LOW,MEDIUM,HIGH,CRITICAL");
  check("T321", Alerts.STATES.join(",") === "OPEN,ACKNOWLEDGED,IN_PROGRESS,RESOLVED,DISMISSED");
  const acknowledged = Alerts.transition(eta, "ACKNOWLEDGED", { owner: "OPS-1", logicalTime: 501 });
  check("T322", acknowledged.state === "ACKNOWLEDGED" && acknowledged.owner === "OPS-1");
  const handling = Alerts.transition(acknowledged, "IN_PROGRESS", { owner: "OPS-1", logicalTime: 502 });
  check("T323", handling.state === "IN_PROGRESS");
  const resolved = Alerts.transition(handling, "RESOLVED", { logicalTime: 503, reason: "Risk cleared", evidence: [{ actualValue: 0 }] });
  check("T324", resolved.state === "RESOLVED" && resolved.resolution.evidence.length === 1);
  const dismissed = Alerts.transition(eta, "DISMISSED", { logicalTime: 503, reason: "Synthetic test dismissal" });
  check("T325", dismissed.state === "DISMISSED" && dismissed.resolution.reason.includes("Synthetic"));
  check("T326", throwsCode(() => Alerts.transition(eta, "RESOLVED", { evidence: [{}] }), "ALERT_TRANSITION_INVALID"));
  const rules = ["ETA_RISK", "TIME_WINDOW_MISSED", "EXCESS_DWELL", "OFF_ROUTE", "ROUTE_STALLED", "UNPLANNED_STOP", "STOP_FAILED", "VEHICLE_BREAKDOWN", "EXECUTION_DATA_STALE", "EVENT_CONFLICT", "MATRIX_UNREACHABLE", "RECOVERY_REQUIRED"];
  const ruleTestIds = ["T327", "T328", "T329", "T330", "T331", "T332", "T333", "T334", "T335", "T336", "T337", "T338"];
  rules.forEach((ruleId, index) => { const result = Alerts.evaluateRule(ruleId, context()); check(ruleTestIds[index], result.triggered === true && result.ruleId === ruleId, result); });
  const etaEvaluation = Alerts.evaluateRule("ETA_RISK", context());
  check("T339", eta.evidence[0].actualValue === 12 && eta.evidence[0].source === "ACCEPTED_EXECUTION_EVENTS", eta.evidence);
  check("T340", etaEvaluation.threshold.metric === "etaRiskMinutes" && etaEvaluation.threshold.value === 10 && etaEvaluation.autoResolutionPolicy.length > 0, etaEvaluation);
  const inbox = Alerts.createInbox(); const opened = inbox.add(eta); const duplicate = inbox.add(Alerts.alertFromRule("ETA_RISK", context({ logicalTime: 501, relatedEventIds: ["E2"] })));
  check("T341", opened.status === "OPENED" && duplicate.status === "DEDUPLICATED" && inbox.list().length === 1 && duplicate.alert.relatedEventIds.includes("E2"), duplicate);
  const autoResolved = inbox.autoResolve({ ETA_RISK: context({ etaRiskMinutes: 0 }) }, 510);
  check("T342", autoResolved.length === 1 && autoResolved[0].state === "RESOLVED" && inbox.auditEvents().some((event) => event.eventType === "ALERT_AUTO_RESOLVED"), autoResolved);
  const workflowInbox = Alerts.createInbox();
  const critical = workflowInbox.add(Alerts.alertFromRule("VEHICLE_BREAKDOWN", context({ routeId: "R-CRIT", vehicleId: "V-CRIT", orderId: "" }))).alert;
  const high = workflowInbox.add(Alerts.alertFromRule("ETA_RISK", context({ routeId: "R-HIGH", vehicleId: "V-HIGH", orderId: "O-HIGH", logicalTime: 520 }))).alert;
  const medium = workflowInbox.add(Alerts.alertFromRule("EXCESS_DWELL", context({ routeId: "R-MED", vehicleId: "V-MED", orderId: "O-MED", owner: "OPS-2", logicalTime: 530 }))).alert;
  const command = Alerts.commandCenter({ executionState: { run: { status: "RUNNING" }, staleStatus: "LIVE_SIMULATION", latestLogicalTime: 530, lastKnownGood: { executionStateHash: "sha256:last" } }, alerts: workflowInbox.list(), lastUiUpdate: "2026-08-31T00:00:00Z" });
  check("T343", command.criticalAlerts[0].alertId === critical.alertId && command.firstViewportOrder.indexOf("critical-alerts") < command.firstViewportOrder.indexOf("vehicle-position"), command.firstViewportOrder);
  check("T344", workflowInbox.list({ severity: "CRITICAL" }).length === 1);
  check("T345", workflowInbox.list({ state: "OPEN" }).length === 3);
  check("T346", workflowInbox.list({ routeId: "R-HIGH" })[0].alertId === high.alertId);
  check("T347", workflowInbox.list({ vehicleId: "V-MED" })[0].alertId === medium.alertId);
  const ownerInbox = Alerts.createInbox(); const owned = ownerInbox.add(Alerts.alertFromRule("ETA_RISK", context({ routeId: "R-OWNER" }))).alert; ownerInbox.acknowledge(owned.alertId, { owner: "OPS-2", logicalTime: 501 });
  check("T348", ownerInbox.list({ owner: "OPS-2" }).length === 1);
  check("T349", workflowInbox.list({ search: "R-MED" }).length === 1 && workflowInbox.list({ search: "EXCESS_DWELL" }).length === 1);
  check("T350", workflowInbox.list({ sort: "severity" })[0].severity === "CRITICAL" && workflowInbox.list({ sort: "oldest" })[0].openedLogicalTime <= workflowInbox.list({ sort: "oldest" }).at(-1).openedLogicalTime);
  const ack = workflowInbox.acknowledge(high.alertId, { owner: "OPS-1", logicalTime: 531 });
  check("T351", ack.event.eventType === "ALERT_ACKNOWLEDGED" && ack.event.eventHash.startsWith("sha256:"));
  const started = workflowInbox.startHandling(high.alertId, { owner: "OPS-1", logicalTime: 532 });
  check("T352", started.event.eventType === "ALERT_HANDLING_STARTED" && started.alert.state === "IN_PROGRESS");
  const solved = workflowInbox.resolve(high.alertId, { owner: "OPS-1", logicalTime: 533, reason: "Synthetic risk cleared", evidence: [{ metric: "etaRiskMinutes", actualValue: 0 }] });
  check("T353", solved.event.eventType === "ALERT_RESOLVED" && solved.alert.resolution.evidence[0].actualValue === 0);
  const dismissedMedium = workflowInbox.dismiss(medium.alertId, { owner: "OPS-2", logicalTime: 534, reason: "Duplicate synthetic observation" });
  check("T354", dismissedMedium.event.eventType === "ALERT_DISMISSED" && dismissedMedium.alert.resolution.reason.length > 0);
  const incident = workflowInbox.convertToIncident(critical.alertId, { logicalTime: 535, reason: "Breakdown recovery required" });
  check("T355", incident.incidentHash.startsWith("sha256:") && incident.sourceAlertHash === critical.alertHash, incident);
  check("T356", workflowInbox.jump(critical.alertId, "MAP").target === "MAP" && workflowInbox.jump(critical.alertId, "MAP").routeId === "R-CRIT");
  check("T357", workflowInbox.jump(critical.alertId, "TIMELINE").target === "TIMELINE");
  check("T358", workflowInbox.jump(critical.alertId, "EVENT").eventId === "E1");
  const health = Alerts.routeHealth({ timeWindowRiskPercent: 20, executionProgressPercent: 60, dwellRiskPercent: 10, routeAdherencePercent: 90, minutesSinceEvent: 2, openAlertCount: 2 });
  check("T359", ["timeWindowRisk", "executionProgress", "dwellRisk", "routeAdherence", "eventFreshness", "openAlerts"].every((key) => Object.hasOwn(health.components, key)), health.components);
  check("T360", health.formula.includes("timeWindowRisk*0.25") && Math.abs(health.score - Object.entries(health.components).reduce((sum, [key, value]) => sum + value * health.weights[key], 0)) < 1e-9, health);
  check("T361", health.notAiScore === true && !health.label.includes("AI"));
  check("T362", command.status.lastEventTime === 530 && command.status.lastUiUpdate === "2026-08-31T00:00:00Z");
  check("T363", Alerts.statusView({ run: { status: "PAUSED" }, latestLogicalTime: 1 }).paused === true);
  check("T364", Alerts.statusView({ run: { status: "RUNNING" }, staleStatus: "STALE", latestLogicalTime: 1 }).stale === true);
  check("T365", Alerts.statusView({ run: { status: "RUNNING" }, staleStatus: "OFFLINE_QUEUEING", latestLogicalTime: 1 }).offline === true);
  check("T366", Alerts.statusView({ run: { status: "RUNNING" }, staleStatus: "PARTIAL_EVENTS", latestLogicalTime: 1 }).partial === true);
  check("T367", Alerts.statusView({ run: { status: "RUNNING" }, staleStatus: "RECONNECTING", latestLogicalTime: 1 }).reconnecting === true);
  const offline = Alerts.statusView({ run: { status: "RUNNING" }, staleStatus: "OFFLINE_QUEUEING", latestLogicalTime: 500, lastKnownGood: { executionStateHash: "sha256:last", latestLogicalTime: 499 } });
  check("T368", offline.dataVisible === true && offline.lastKnownGood.executionStateHash === "sha256:last", offline);
  check("T369", command.mobile.criticalFirst === true && command.criticalAlerts.length === 1);
  check("T370", command.mobile.filters === "BOTTOM_SHEET");
  check("T371", command.mobile.keyboardWorkflow.join(",") === "focus,acknowledge,start handling,resolve");
  const ui = Alerts.createUiState({ focusedAlertId: critical.alertId }); ui.refresh(workflowInbox.list(), { eventType: "POSITION_RECORDED" });
  check("T372", ui.snapshot().focusedAlertId === critical.alertId);
  check("T373", ui.snapshot().ariaAnnouncements.length === 0 && ui.refresh(workflowInbox.list(), { eventType: "ALERT_OPENED", severity: "CRITICAL", message: "Critical synthetic alert" }).ariaAnnouncements.length === 1);
  check("T374", command.status.dataVisible === true && ui.refresh(workflowInbox.list()).noWebGL === true);
  check("T375", ["zh", "en", "ja"].every((language) => Alerts.STATES.every((state) => Alerts.COPY[language].states[state]) && Object.keys(Alerts.RULES).every((ruleId) => Alerts.COPY[language].rules[ruleId])));
  const alertExport = Alerts.exportAlerts(workflowInbox.snapshot());
  check("T376", alertExport.exportHash.startsWith("sha256:") && alertExport.alerts.length === 3 && alertExport.auditEvents.length >= 7, alertExport);
  const capsule = Alerts.alertCapsule(workflowInbox.snapshot());
  check("T377", capsule.complete === true && capsule.alertExportHash === alertExport.exportHash && capsule.lifecycleHash === alertExport.lifecycleHash, capsule);
  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: checks.length, ids: checks.map((row) => row.id) }, null, 2)}\n`);
}

main();
