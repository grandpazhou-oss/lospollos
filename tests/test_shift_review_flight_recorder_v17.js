#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Integrity = require("../integrity-hash-v151.js");
const ShiftReview = require("../shift-review-v17.js");
const FlightRecorder = require("../flight-recorder-v17.js");

const evidencePath = path.resolve(process.argv.includes("--evidence") ? process.argv[process.argv.indexOf("--evidence") + 1] : "/tmp/stct-v17-shift-review.json");
const assertions = [];
function check(requirementId, condition, observed, expected) { const row = { assertionId: `${requirementId}-A1`, requirementId, status: condition ? "PASS" : "FAIL", observed, expected, evidence: evidencePath }; assertions.push(row); assert(condition, `${requirementId}: ${JSON.stringify({ observed, expected })}`); }
const hash = (value) => Integrity.hashValue(value);
function ev(eventId, eventType, logicalTime, sequence, detail = {}) { return { eventId, eventType, logicalTime, sequence, eventHash: hash({ eventId, eventType, logicalTime, sequence }), routeId: detail.routeId || "R1", vehicleId: detail.vehicleId || "V1", orderId: detail.orderId || "", payload: detail.payload || {} }; }

function fixture() {
  const events = [
    ev("E1", "RUN_RELEASED", 1, 1), ev("E2", "ROUTE_ACCEPTED", 2, 2), ev("E3", "VEHICLE_DEPARTED", 2, 3),
    ev("E4", "POSITION_RECORDED", 3, 4), ev("E5", "POSITION_RECORDED", 4, 5), ev("E6", "POSITION_RECORDED", 5, 6),
    ev("E7", "STOP_ARRIVED", 6, 7, { orderId: "S1" }), ev("E8", "SERVICE_STARTED", 7, 8, { orderId: "S1" }), ev("E9", "SERVICE_COMPLETED", 8, 9, { orderId: "S1" }),
    ev("E10", "NETWORK_OFFLINE", 9, 10), ev("E11", "NETWORK_RESTORED", 10, 11), ev("E12", "RUN_COMPLETED", 20, 12),
    ev("E13", "POSITION_RECORDED", 16, 13, { payload: { relatedIds: ["HANDOVER-1"] } }), ev("E14", "POSITION_RECORDED", 17, 14, { payload: { relatedIds: ["MISSING-DOMAIN-EVENT"] } }),
  ];
  const alert = { alertId: "A1", routeId: "R1", vehicleId: "V1", state: "RESOLVED", alertHash: hash("A1"), relatedIncidentHash: hash("I1") };
  const alertEvents = [
    { eventId: "AE1", eventType: "ALERT_OPENED", alertId: "A1", logicalTime: 4, sequence: 20, eventHash: hash("AE1"), detail: { sourceEventId: "E4", routeId: "R1", vehicleId: "V1" } },
    { eventId: "AE2", eventType: "ALERT_ACKNOWLEDGED", alertId: "A1", logicalTime: 5, sequence: 21, eventHash: hash("AE2"), detail: {} },
    { eventId: "AE3", eventType: "ALERT_RESOLVED", alertId: "A1", logicalTime: 18, sequence: 22, eventHash: hash("AE3"), detail: {} },
  ];
  const executionState = { run: { executionRunHash: "RUN-HASH-FINAL", status: "COMPLETED" }, acceptedEvents: events, routeStates: { R1: { routeId: "R1", vehicleId: "V1", state: "COMPLETED_WITH_EXCEPTIONS", failedStopIds: ["S2"], skippedStopIds: ["S3"], cancelledStopIds: [] }, R2: { routeId: "R2", vehicleId: "V2", state: "COMPLETED", failedStopIds: [], skippedStopIds: [], cancelledStopIds: [] } }, stopStates: { S1: { state: "COMPLETED" }, S2: { state: "FAILED" }, S3: { state: "SKIPPED" }, S4: { state: "COMPLETED" } }, vehicleStates: { V1: { state: "COMPLETED_WITH_EXCEPTIONS" }, V2: { state: "COMPLETED" } }, terminalSummary: { nonTerminalRoutes: [], nonTerminalStops: [], activeServices: [], pendingQueueConflicts: [] } };
  const planActual = { reportHash: hash("PVA"), summary: { vehicleCount: 2, routeCount: 2, fleetCompletion: 1, fleetEtaMae: 3.5 }, routes: [{ routeId: "R1", vehicleId: "V1", plannedStops: 3, completedStops: 3, routeCompletion: 1, routeAdherence: 0.91, offRouteSegments: [{ id: "O1" }] }, { routeId: "R2", vehicleId: "V2", plannedStops: 1, completedStops: 1, routeCompletion: 1, routeAdherence: 1, offRouteSegments: [] }] };
  const recoveries = [{ recoveryId: "REC1", recoveryHash: hash("REC1"), routeId: "R1", affectedRouteIds: ["R1"], logicalTime: 13, sequence: 30, incidentId: "I1", changes: 2 }, { recoveryId: "REC2", recoveryHash: hash("REC2"), routeId: "R2", affectedRouteIds: ["R2"], logicalTime: 14, sequence: 31, incidentId: "I2", changes: 1 }];
  const planRevisions = [{ revision: 2, revisionHash: hash("REV2"), parentRevisionHash: hash("REV1"), cutoffLogicalMinute: 15, sequence: 40, handoverId: "HANDOVER-1", recoveryId: "REC1", routeId: "R1", vehicleId: "V1" }, { revision: 1, revisionHash: hash("REV1"), parentRevisionHash: "", cutoffLogicalMinute: 0, sequence: 1 }];
  const finalInput = { executionState, events, alerts: { alerts: [alert], auditEvents: alertEvents }, telemetry: [{ plausibility: { status: "PASS" }, derivedSegmentDistanceMeters: 120 }], planActual, reconciliation: { connectionState: "ONLINE", pending: 0, unresolvedConflicts: 0, ackAuditCount: 10 }, incidents: [{ incidentId: "I1", incidentHash: hash("I1"), sourceAlertId: "AE1", logicalTime: 11, sequence: 25, routeId: "R1", vehicleId: "V1" }], recoveries, planRevisions, tracks: [{ trackHash: hash("TRACK1") }], locale: "en" };
  const partialInput = JSON.parse(JSON.stringify(finalInput)); partialInput.executionState.run = { executionRunHash: "RUN-HASH-PARTIAL", status: "RUNNING" }; partialInput.executionState.routeStates.R2.state = "IN_PROGRESS"; partialInput.alerts.alerts[0].state = "OPEN"; partialInput.reconciliation.pending = 1; partialInput.reconciliation.unresolvedConflicts = 1; partialInput.completionInvariant = { nonTerminalRoutes: ["R2"], nonTerminalStops: ["S4"], activeServices: [], pendingQueueConflicts: [{ clientEventId: "Q1", routeId: "R2" }] };
  return { events, alertEvents, executionState, planActual, recoveries, planRevisions, finalInput, partialInput };
}

function main() {
  const f = fixture(); const finalReview = ShiftReview.build(f.finalInput); const partialReview = ShiftReview.build(f.partialInput);
  const recorder = FlightRecorder.build({ executionRunHash: "RUN-HASH-FINAL", executionEvents: f.events, alertEvents: f.alertEvents, incidents: f.finalInput.incidents, recoveries: f.recoveries, planRevisions: f.planRevisions, driverSyncEvents: [{ clientEventId: "D1", connectionState: "OFFLINE", logicalTime: 9, sequence: 50, vehicleId: "V1" }, { clientEventId: "D2", connectionState: "ONLINE", logicalTime: 10, sequence: 51, vehicleId: "V1", relatedIds: ["D1"] }] });
  const categories = new Set(recorder.rows.map((row) => row.category)); const causal = new Map(recorder.causality.map((row) => [row.id, row]));

  check("T491", finalReview.schemaVersion === "stct-shift-review-v1.7" && ShiftReview.validate(finalReview, f.finalInput).status === "PASS", finalReview.schemaVersion, "valid ShiftReview schema");
  check("T492", /^sha256:[a-f0-9]{64}$/.test(finalReview.reviewHash), finalReview.reviewHash, "SHA-256");
  check("T493", finalReview.executionRunHash === "RUN-HASH-FINAL", finalReview.executionRunHash, "required ExecutionRunHash");
  check("T494", finalReview.planRevisions.map((row) => row.revision).join(",") === "1,2", finalReview.planRevisions, "ordered revisions");
  check("T495", finalReview.eventWindow.firstLogicalTime === 1 && finalReview.eventWindow.lastLogicalTime === 20 && finalReview.eventWindow.acceptedEventCount === 14, finalReview.eventWindow, "correct event window");
  check("T496", finalReview.routeSummaries.length === 2 && finalReview.routeSummaries[0].completedStops === 3, finalReview.routeSummaries, "route summaries");
  check("T497", finalReview.alertLifecycle[0].events.length === 3 && finalReview.alertLifecycle[0].state === "RESOLVED", finalReview.alertLifecycle, "alert lifecycle");
  check("T498", finalReview.recoveryTimeline.map((row) => row.recoveryId).join(",") === "REC1,REC2", finalReview.recoveryTimeline, "recovery timeline");
  check("T499", finalReview.driverSyncSummary.connectionState === "ONLINE" && finalReview.driverSyncSummary.acknowledged === 10, finalReview.driverSyncSummary, "driver sync summary");
  check("T500", finalReview.planVsActual.reportHash === f.planActual.reportHash && finalReview.planVsActual.summary.vehicleCount === 2, finalReview.planVsActual, "Plan-vs-Actual");
  check("T501", Array.isArray(partialReview.unresolvedItems) && partialReview.unresolvedItems.length >= 3, partialReview.unresolvedItems, "unresolved items");
  check("T502", recorder.rows.every((row, index) => index === 0 || recorder.rows[index - 1].logicalTime <= row.logicalTime), recorder.rows.map((row) => row.logicalTime), "logical time order");
  const sameTime = FlightRecorder.normalized({ executionEvents: f.events }).filter((row) => row.logicalTime === 2); check("T503", sameTime[0].sequence === 2 && sameTime[1].sequence === 3, sameTime, "sequence tie-break");
  check("T504", categories.has("PLAN_RELEASE"), [...categories], "Plan release visible");
  check("T505", categories.has("DRIVER_ACCEPT"), [...categories], "Driver accept visible");
  check("T506", categories.has("DEPART"), [...categories], "Depart visible");
  const positionAggregate = recorder.rows.find((row) => row.category === "POSITION"); check("T507", positionAggregate.type === "POSITION_AGGREGATE" && positionAggregate.positionCount >= 3, positionAggregate, "positions aggregated");
  check("T508", categories.has("STOP_LIFECYCLE"), [...categories], "stop lifecycle visible");
  check("T509", recorder.rows.filter((row) => row.category === "ALERT").length === 3, recorder.rows.filter((row) => row.category === "ALERT"), "alert open/ack/resolve");
  check("T510", categories.has("OFFLINE") && categories.has("RECONNECT"), [...categories], "offline and reconnect");
  check("T511", categories.has("INCIDENT"), [...categories], "incident visible");
  check("T512", categories.has("RECOVERY_CANDIDATE"), [...categories], "recovery candidate visible");
  check("T513", categories.has("PLAN_HANDOVER"), [...categories], "handover visible");
  check("T514", categories.has("RUN_COMPLETION"), [...categories], "run completion visible");
  check("T515", causal.get("AE1").links.some((link) => link.relatedId === "E4" && link.status === "LINKED"), causal.get("AE1"), "Event to Alert");
  check("T516", causal.get("I1").links.some((link) => link.relatedId === "AE1" && link.status === "LINKED"), causal.get("I1"), "Alert to Incident");
  check("T517", causal.get("REC1").links.some((link) => link.relatedId === "I1" && link.status === "LINKED"), causal.get("REC1"), "Incident to Recovery");
  check("T518", causal.get("HANDOVER-1").links.some((link) => link.relatedId === "REC1" && link.status === "LINKED"), causal.get("HANDOVER-1"), "Recovery to Revision");
  check("T519", causal.get("E13").links.some((link) => link.relatedId === "HANDOVER-1" && link.status === "LINKED"), causal.get("E13"), "Revision to Event");
  check("T520", causal.get("E14").brokenLinkCount === 1 && causal.get("E14").links[0].status === "BROKEN_LINK", causal.get("E14"), "broken link explicit");
  check("T521", recorder.source === "DOMAIN_EVENTS_ONLY_NO_AI_CAUSATION" && recorder.causality.every((row) => row.explicitOnly), recorder.source, "no fabricated causation");
  check("T522", finalReview.routeSummaries.every((row) => Number.isFinite(row.plannedCompletion) && Number.isFinite(row.actualCompletion)), finalReview.routeSummaries, "planned and actual per route");
  check("T523", finalReview.routeSummaries.reduce((sum, row) => sum + row.alertCount, 0) === 1, finalReview.routeSummaries, "alert count per route");
  check("T524", finalReview.routeSummaries[0].failedStopCount === 1 && finalReview.routeSummaries[0].skippedStopCount === 1, finalReview.routeSummaries[0], "failed/skipped per route");
  check("T525", finalReview.routeSummaries.every((row) => row.recoveryChangeCount === 1), finalReview.routeSummaries, "recovery changes per route");
  check("T526", finalReview.fleetSummary.vehicleCount === 2 && finalReview.fleetSummary.fleetCompletion === 1, finalReview.fleetSummary, "fleet summary");
  check("T527", partialReview.unresolvedItems.some((row) => row.type === "QUEUE_CONFLICT"), partialReview.unresolvedItems, "unresolved queue conflict");
  check("T528", partialReview.unresolvedItems.some((row) => row.type === "ALERT"), partialReview.unresolvedItems, "unresolved alert");
  check("T529", partialReview.unresolvedItems.some((row) => row.type === "UNFINISHED_ROUTE"), partialReview.unresolvedItems, "unfinished route");
  check("T530", partialReview.reviewType === "PARTIAL_RUN", partialReview.reviewType, "Partial Run");
  check("T531", finalReview.reviewType === "FINAL_RUN", finalReview.reviewType, "Final Run");
  const json = ShiftReview.exportJson(finalReview); check("T532", JSON.parse(json).reviewHash === finalReview.reviewHash, json.slice(0, 80), "JSON export");
  const csv = ShiftReview.exportCsv(finalReview); check("T533", csv.includes("execution_run_hash") && csv.split("\n").length === 4, csv, "CSV export");
  const html = ShiftReview.printableHtml(finalReview); check("T534", /<!doctype html>/.test(html) && html.includes("<table>"), html.slice(0, 100), "printable HTML");
  check("T535", finalReview.formulas.actualCompletion && finalReview.routeSummaries.every((row) => row.source), finalReview.formulas, "formula and source");
  check("T536", finalReview.longDescription.length > 80 && FlightRecorder.longDescription(recorder).length > 80, { review: finalReview.longDescription, recorder: FlightRecorder.longDescription(recorder) }, "screen-reader long description");
  const keyboard = FlightRecorder.keyboardModel(recorder); check("T537", keyboard.role === "listbox" && keyboard.keys.ArrowDown === 1 && keyboard.keys.Home === "FIRST", keyboard, "keyboard timeline");
  const mobile = ShiftReview.mobileView(finalReview); check("T538", mobile.mode === "MOBILE_REVIEW" && mobile.sections[0] === "summary", mobile, "mobile review");
  const noWebGL = ShiftReview.noWebGLView(finalReview); check("T539", noWebGL.mode === "NO_WEBGL_REVIEW" && noWebGL.tableEquivalent.length === 2, noWebGL, "no-WebGL review");
  check("T540", finalReview.motionPolicy.includes("REDUCED_MOTION_SAFE"), finalReview.motionPolicy, "reduced motion review");
  const locales = ["zh", "en", "ja"].map((locale) => ShiftReview.build({ ...f.finalInput, locale })); check("T541", locales.every((review) => review.title && review.evidenceLabel && review.locale), locales.map((review) => ({ locale: review.locale, title: review.title })), "three locales");
  check("T542", ShiftReview.validate(finalReview, f.finalInput).status === "PASS", ShiftReview.validate(finalReview, f.finalInput), "Capsule recompute review");
  const tampered = JSON.parse(JSON.stringify(finalReview)); tampered.routeSummaries[0].alertCount = 99; check("T543", ShiftReview.validate(tampered, f.finalInput).status === "FAIL" && ShiftReview.validate(tampered, f.finalInput).errors.includes("SHIFT_REVIEW_HASH_MISMATCH"), ShiftReview.validate(tampered, f.finalInput), "tampered review rejected");
  check("T544", !/AI Summary/i.test(finalReview.title) && finalReview.sourceBoundary.includes("NOT_AI_SUMMARY"), { title: finalReview.title, boundary: finalReview.sourceBoundary }, "not AI Summary");
  check("T545", /accepted events|受理済み|已接受/.test(finalReview.evidenceLabel), finalReview.evidenceLabel, "evidence wording");
  const comparison = ShiftReview.compareProfiles(finalReview, partialReview); check("T546", comparison.sameRun === false && comparison.warning === "DIFFERENT_EXECUTION_RUNS_NOT_MERGED", comparison, "profiles not mixed");
  const start = performance.now(); for (let index = 0; index < 100; index += 1) ShiftReview.build(f.finalInput); const elapsed = performance.now() - start; check("T547", elapsed < 500, elapsed, "100 review rebuilds under 500ms local baseline");
  const visualHashA = hash({ mobile, noWebGL, routes: finalReview.routeSummaries }); const visualHashB = hash({ mobile: ShiftReview.mobileView(finalReview), noWebGL: ShiftReview.noWebGLView(finalReview), routes: finalReview.routeSummaries }); check("T548", visualHashA === visualHashB, { visualHashA, visualHashB }, "deterministic semantic visual snapshot");
  const selections = []; const sync = FlightRecorder.createSelectionSync(recorder, { onMap: (value) => selections.push(["map", value.id]), onTimeline: (value) => selections.push(["timeline", value.id]) }); const selected = sync.step(1); check("T549", selected.id && selections.some((row) => row[0] === "map" && row[1] === selected.id) && selections.some((row) => row[0] === "timeline" && row[1] === selected.id), { selected, selections }, "timeline selection sync");
  const note = FlightRecorder.handoverNote('<script>alert("x")</script> handover'); const htmlWithNote = ShiftReview.printableHtml(finalReview, { handoverNote: '<script>alert("x")</script> handover' }); check("T550", note.source === "USER_INPUT" && note.autoGenerated === false && !htmlWithNote.includes("<script>"), { note, escapedInHtml: htmlWithNote.includes("&lt;script&gt;") }, "user input escaped");
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true }); fs.writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: "stct-v17-shift-review-test-evidence-v1.7", status: "PASS", checks: assertions.length, assertions }, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: assertions.length, evidencePath }, null, 2)}\n`);
}

try { main(); } catch (error) { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); }
