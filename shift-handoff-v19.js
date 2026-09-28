(function (root, factory) {
  "use strict";
  const integrity = root?.STCTV15?.integrityHash || (typeof require === "function" ? require("./integrity-hash-v151.js") : null);
  const api = factory(integrity);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.STCTPlatformV19 = root.STCTPlatformV19 || {};
    root.STCTPlatformV19.shiftHandoff = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Integrity) {
  "use strict";

  const SCHEMA_VERSION = "stct-shift-handoff-pack-v1.9-p3";
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const escapeHtml = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const normalizeNote = (value) => String(value == null ? "" : value).replace(/\r\n?/g, "\n").trim();
  const csvSafe = (value) => {
    const source = String(value == null ? "" : value);
    return /^[\t\r\n ]*[=+\-@]/.test(source) ? `'${source}` : source;
  };
  const csv = (value) => `"${csvSafe(value).replace(/"/g, '""')}"`;

  function identity(value) { const copy = clone(value); delete copy.handoffHash; return copy; }
  function generate(context, actionProjection, options = {}) {
    const source = context.snapshot();
    const after = context.snapshot();
    if (source.execution.executionStateHash !== after.execution.executionStateHash || source.alerts.auditEvents.length !== after.alerts.auditEvents.length) {
      const error = new Error("Authoritative state changed while the handoff snapshot was being frozen.");
      error.code = "HANDOFF_SOURCE_CHANGED";
      throw error;
    }
    if (source.plan.verification?.status !== "PASS" || source.execution.run.planHash !== source.plan.planHash) {
      const error = new Error("Handoff source hashes are stale or internally inconsistent.");
      error.code = "HANDOFF_SOURCE_INCONSISTENT";
      throw error;
    }
    const pva = context.planActual();
    const unresolvedActions = actionProjection.items.filter((item) => !["RESOLVED", "DISMISSED"].includes(item.state));
    const notes = (options.operatorNotes || []).map((note, index) => ({ noteId: `NOTE-${String(index + 1).padStart(3, "0")}`, source: "OPERATOR_INPUT_RAW_NORMALIZED", text: normalizeNote(note) }));
    const pack = {
      schemaVersion: SCHEMA_VERSION,
      handoffId: `HANDOFF-${source.execution.run.executionRunHash.slice(-10).toUpperCase()}-${source.revision}`,
      handoffHash: "",
      generatedLogicalTime: source.execution.latestLogicalTime,
      scenarioId: source.scenario.scenarioId,
      inputHash: source.scenario.inputHash,
      planHash: source.plan.planHash,
      executionRunHash: source.execution.run.executionRunHash,
      planRevision: source.plan.revision,
      operationalStatus: source.execution.run.status,
      activeRoutes: pva.routes.filter((route) => route.routeCompletion < 1).map((route) => ({ routeId: route.routeId, vehicleId: route.vehicleId, completion: route.routeCompletion, state: source.execution.routeStates[route.routeId]?.state || "UNKNOWN" })),
      routesAtRisk: pva.routes.filter((route) => route.vehicleAlertCount > 0 || route.routeAdherence < 0.95 || (route.vehicleStaleAge || 0) > 15).map((route) => ({ routeId: route.routeId, vehicleId: route.vehicleId, alertCount: route.vehicleAlertCount, adherence: route.routeAdherence, staleAge: route.vehicleStaleAge })),
      unresolvedActions: unresolvedActions.map((item) => ({ actionItemId: item.actionItemId, actionType: item.actionType, severity: item.severity, sourceKind: item.sourceKind, sourceId: item.sourceId, deepLink: item.deepLink })),
      openAlerts: source.alerts.alerts.filter((alert) => !["RESOLVED", "DISMISSED"].includes(alert.state)).map((alert) => ({ alertId: alert.alertId, severity: alert.severity, state: alert.state, routeId: alert.routeId, vehicleId: alert.vehicleId, alertHash: alert.alertHash })),
      offlineConflicts: source.offline.queue.filter((item) => item.status !== "ACKED").map((item) => ({ localEventId: item.localEventId, status: item.status, errorCode: item.errorCode, eventHash: item.event?.eventHash })),
      failedOrSkippedStops: Object.values(source.execution.stopStates).filter((stop) => ["FAILED", "SKIPPED"].includes(stop.state)).map((stop) => ({ orderId: stop.orderId, routeId: stop.routeId, vehicleId: stop.vehicleId, state: stop.state, terminalEventId: stop.terminalEventId })),
      recoveryHandovers: source.recovery.lineage.map((row) => ({ action: row.action, revision: row.revision, revisionHash: row.revisionHash, planHash: row.newPlanHash || row.restoredPlanHash || row.recoveryPlanHash || "" })),
      dataFreshness: { latestLogicalTime: source.execution.latestLogicalTime, replayCursor: source.replay.clock, status: source.execution.staleStatus },
      nextShiftPriorities: unresolvedActions.slice(0, 8).map((item, index) => ({ priority: index + 1, actionItemId: item.actionItemId, title: item.title, severity: item.severity })),
      operatorNotes: notes,
      evidenceRefs: [source.scenario.scenarioHash, source.plan.planHash, source.execution.run.executionRunHash, source.execution.executionStateHash, pva.reportHash, ...source.alerts.alerts.map((alert) => alert.alertHash)],
      sourceBoundary: "STRUCTURED_DOMAIN_HANDOFF_NOT_AI_SUMMARY",
    };
    pack.handoffHash = Integrity.hashValue(identity(pack));
    return pack;
  }

  function validate(pack) {
    const errors = [];
    if (pack?.schemaVersion !== SCHEMA_VERSION) errors.push("HANDOFF_SCHEMA_INVALID");
    if (!pack?.handoffHash || pack.handoffHash !== Integrity.hashValue(identity(pack || {}))) errors.push("HANDOFF_HASH_MISMATCH");
    if (!pack?.scenarioId || !pack?.planHash || !pack?.executionRunHash) errors.push("HANDOFF_IDENTITY_INCOMPLETE");
    for (const field of ["activeRoutes", "routesAtRisk", "unresolvedActions", "openAlerts", "offlineConflicts", "failedOrSkippedStops", "recoveryHandovers", "nextShiftPriorities", "operatorNotes", "evidenceRefs"]) {
      if (!Array.isArray(pack?.[field])) errors.push(`HANDOFF_${field.toUpperCase()}_INVALID`);
    }
    return { status: errors.length ? "FAIL" : "PASS", errors };
  }
  function importReadOnly(input, context) {
    let parsed;
    try {
      parsed = typeof input === "string" ? JSON.parse(input) : clone(input);
    } catch (_error) {
      return { status: "FAIL", mode: "READ_ONLY", errors: ["HANDOFF_JSON_INVALID"] };
    }
    const validation = validate(parsed);
    if (validation.status !== "PASS") return { ...validation, mode: "READ_ONLY" };
    const source = context?.snapshot?.();
    const knownEvidence = new Set(source ? [
      source.scenario?.scenarioHash,
      source.plan?.planHash,
      source.execution?.run?.executionRunHash,
      source.execution?.executionStateHash,
      ...(source.alerts?.alerts || []).map((alert) => alert.alertHash),
    ].filter(Boolean) : []);
    const evidenceRefs = parsed.evidenceRefs || [];
    const checkedEvidenceRefs = knownEvidence.size ? evidenceRefs.filter((reference) => knownEvidence.has(reference)) : [];
    const pack = clone(parsed);
    return {
      status: "PASS",
      mode: "READ_ONLY",
      sourceHandoffHash: parsed.handoffHash,
      pack,
      envelope: {
        schemaVersion: "stct-shift-handoff-import-envelope-v1.9-p31",
        readOnly: true,
        sourceHandoffHash: parsed.handoffHash,
      },
      evidenceValidation: {
        available: knownEvidence.size > 0,
        checked: checkedEvidenceRefs,
        unresolved: knownEvidence.size ? evidenceRefs.filter((reference) => !knownEvidence.has(reference)) : evidenceRefs.slice(),
      },
      sideEffects: { executionStarted: false, recoveryApplied: false, queueSynced: false },
    };
  }
  function toJson(pack) { return `${JSON.stringify(pack, null, 2)}\n`; }
  function toCsv(pack) {
    const header = ["handoff_id", "route_id", "vehicle_id", "state", "completion", "at_risk", "open_alerts"];
    const risk = new Map(pack.routesAtRisk.map((route) => [route.routeId, route]));
    const rows = pack.activeRoutes.map((route) => [pack.handoffId, route.routeId, route.vehicleId, route.state, route.completion, risk.has(route.routeId), risk.get(route.routeId)?.alertCount || 0]);
    return `${[header, ...rows].map((row) => row.map(csv).join(",")).join("\n")}\n`;
  }
  function toPrintableHtml(pack) {
    const table = (headers, rows) => `<table><thead><tr>${headers.map((value) => `<th>${escapeHtml(value)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(pack.handoffId)}</title><style>body{font:14px system-ui;color:#13233a;margin:32px}h1{font-size:24px}h2{margin-top:28px;font-size:16px}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #ccd6e2;text-align:left}.critical{color:#b42318}footer{margin-top:32px;font:11px ui-monospace;word-break:break-all}</style></head><body><main><h1>Shift Handoff Pack</h1><p>${escapeHtml(pack.handoffId)} · ${escapeHtml(pack.operationalStatus)} · logical time ${escapeHtml(pack.generatedLogicalTime)}</p><h2>Critical actions</h2>${table(["Priority", "Severity", "Action"], pack.nextShiftPriorities.map((row) => [row.priority, row.severity, row.title]))}<h2>Route handoff</h2>${table(["Route", "Vehicle", "State", "Completion"], pack.activeRoutes.map((row) => [row.routeId, row.vehicleId, row.state, `${Math.round(row.completion * 100)}%`]))}<h2>Open alerts</h2>${table(["Alert", "Severity", "State", "Route"], pack.openAlerts.map((row) => [row.alertId, row.severity, row.state, row.routeId]))}<h2>Offline / conflicts</h2>${table(["Local event", "State", "Error"], pack.offlineConflicts.map((row) => [row.localEventId, row.status, row.errorCode]))}<h2>Recovery handovers</h2>${table(["Action", "Revision", "Plan"], pack.recoveryHandovers.map((row) => [row.action, row.revision, row.planHash]))}<h2>Data freshness</h2><p>${escapeHtml(pack.dataFreshness.status)} · ${escapeHtml(pack.dataFreshness.latestLogicalTime)}</p><h2>Operator notes</h2><ul>${pack.operatorNotes.map((note) => `<li>${escapeHtml(note.text)}</li>`).join("")}</ul><footer>Scenario ${escapeHtml(pack.scenarioId)}<br>Plan ${escapeHtml(pack.planHash)}<br>Run ${escapeHtml(pack.executionRunHash)}<br>Handoff ${escapeHtml(pack.handoffHash)}</footer></main></body></html>`;
  }

  return Object.freeze({ SCHEMA_VERSION, identity, generate, importReadOnly, validate, toJson, toCsv, toPrintableHtml, escapeHtml, normalizeNote, csvSafe });
});
