(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.STCTPlatformV19 = root.STCTPlatformV19 || {};
    root.STCTPlatformV19.operationsActionCenter = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCHEMA_VERSION = "stct-operations-action-center-v1.9-p3";
  const TERMINAL_ALERT_STATES = new Set(["RESOLVED", "DISMISSED"]);
  const TERMINAL_STOP_STATES = new Set(["COMPLETED", "CANCELLED"]);
  const SEVERITY_ORDER = Object.freeze({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 });
  const RULE_SEMANTICS = Object.freeze({
    STALE_TELEMETRY: { category: "TELEMETRY_FRESHNESS", actionType: "STALE_TELEMETRY" },
    OFF_ROUTE: { category: "ROUTE_ADHERENCE", actionType: "OFF_ROUTE" },
    ROUTE_STALLED: { category: "ROUTE_PROGRESS", actionType: "ROUTE_STALLED" },
    ETA_RISK: { category: "SERVICE_RISK", actionType: "ETA_RISK" },
    TIME_WINDOW_MISSED: { category: "SERVICE_RISK", actionType: "CRITICAL_ALERT" },
    EXCESS_DWELL: { category: "SERVICE_TIME", actionType: "EXCESS_DWELL" },
  });
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const text = (value) => String(value == null ? "" : value).trim();
  const projectionCache = new WeakMap();

  function actionItem(input) {
    return {
      schemaVersion: "stct-operations-action-item-v1.9-p3",
      actionItemId: text(input.actionItemId),
      actionType: text(input.actionType),
      category: text(input.category || "OPERATIONS"),
      ruleId: text(input.ruleId),
      severity: text(input.severity || "MEDIUM"),
      state: text(input.state || "OPEN"),
      sourceKind: text(input.sourceKind),
      sourceId: text(input.sourceId),
      scenarioId: text(input.scenarioId),
      planHash: text(input.planHash),
      routeId: text(input.routeId),
      vehicleId: text(input.vehicleId),
      orderId: text(input.orderId),
      stopId: text(input.stopId || input.orderId),
      alertId: text(input.alertId),
      incidentId: text(input.incidentId),
      title: text(input.title),
      evidence: clone(input.evidence || []),
      allowedActions: clone(input.allowedActions || []),
      deepLink: text(input.deepLink),
      deduplicationKey: text(input.deduplicationKey),
      openedLogicalTime: Number(input.openedLogicalTime || 0),
      dueLogicalTime: input.dueLogicalTime == null ? null : Number(input.dueLogicalTime),
      freshness: clone(input.freshness || { status: "CURRENT", age: 0 }),
      reviewNote: clone(input.reviewNote || null),
    };
  }

  function project(context, filters = {}) {
    const cacheKey = JSON.stringify({ revision: context.revision, filters });
    const cached = projectionCache.get(context);
    if (cached?.key === cacheKey) return cached.value;
    const source = context.snapshot();
    const rows = [];
    const identity = { scenarioId: source.scenario.scenarioId, planHash: source.plan.planHash };
    for (const alert of source.alerts.alerts) {
      if (TERMINAL_ALERT_STATES.has(alert.state) && filters.includeClosed !== true) continue;
      const allowedActions = alert.state === "OPEN" ? ["ACKNOWLEDGE", "DISMISS", "CREATE_INCIDENT", "OPEN_SOURCE"]
        : alert.state === "ACKNOWLEDGED" ? ["START_HANDLING", "RESOLVE", "CREATE_INCIDENT", "OPEN_SOURCE"]
          : alert.state === "IN_PROGRESS" ? ["RESOLVE", "CREATE_INCIDENT", "OPEN_SOURCE"] : ["OPEN_SOURCE"];
      const semantics = RULE_SEMANTICS[alert.ruleId] || { category: "OPERATIONS", actionType: alert.severity === "CRITICAL" ? "CRITICAL_ALERT" : "OPERATIONAL_ALERT" };
      rows.push(actionItem({
        ...identity,
        actionItemId: `ACTION-ALERT-${alert.alertId}`,
        actionType: semantics.actionType,
        category: semantics.category,
        ruleId: alert.ruleId,
        severity: alert.severity,
        state: alert.state,
        sourceKind: "ALERT_STORE",
        sourceId: alert.alertId,
        routeId: alert.routeId,
        vehicleId: alert.vehicleId,
        orderId: alert.orderId,
        alertId: alert.alertId,
        incidentId: source.incidents.find((row) => row.sourceAlertHash === alert.alertHash)?.incidentId || "",
        title: `${alert.ruleId} · ${alert.routeId}`,
        evidence: alert.evidence,
        allowedActions,
        deepLink: `/command/alerts?alertId=${encodeURIComponent(alert.alertId)}&returnTo=%2Fcommand%2Foverview`,
        deduplicationKey: `ALERT:${alert.alertId}`,
        openedLogicalTime: alert.openedLogicalTime,
        dueLogicalTime: alert.slaDueLogicalTime,
        freshness: { status: source.execution.latestLogicalTime - alert.openedLogicalTime > 20 ? "STALE" : "CURRENT", age: Math.max(0, source.execution.latestLogicalTime - alert.openedLogicalTime) },
        reviewNote: source.localReviewNotes[`ACTION-ALERT-${alert.alertId}`],
      }));
    }
    for (const [orderId, stop] of Object.entries(source.execution.stopStates || {})) {
      if (!["FAILED", "SKIPPED"].includes(stop.state)) continue;
      rows.push(actionItem({ ...identity, actionItemId: `ACTION-STOP-${orderId}`, actionType: "FAILED_STOP", severity: "HIGH", state: "OPEN", sourceKind: "EXECUTION_STORE", sourceId: orderId, routeId: stop.routeId, vehicleId: stop.vehicleId, orderId, title: `${stop.state} · ${orderId}`, evidence: [{ source: "EXECUTION_STORE", executionStateHash: source.execution.executionStateHash, stopState: stop.state }], allowedActions: ["OPEN_SOURCE", "OPEN_RECOVERY"], deepLink: `/command/execution?orderId=${encodeURIComponent(orderId)}&returnTo=%2Fcommand%2Foverview`, deduplicationKey: `STOP:${orderId}:${stop.state}`, openedLogicalTime: source.execution.latestLogicalTime }));
    }
    for (const item of source.offline.queue || []) {
      if (["ACKED"].includes(item.status)) continue;
      const pendingAck = ["LOCAL_PENDING", "PENDING", "QUEUED", "SENT"].includes(item.status);
      rows.push(actionItem({ ...identity, actionItemId: `ACTION-QUEUE-${item.localEventId}`, actionType: pendingAck ? "PENDING_DRIVER_ACK" : "OFFLINE_CONFLICT", severity: item.status === "CONFLICT" ? "CRITICAL" : "HIGH", state: item.status, sourceKind: "OFFLINE_QUEUE", sourceId: item.localEventId, routeId: item.event?.routeId, vehicleId: item.event?.vehicleId, orderId: item.event?.orderId, title: `${item.status} · ${item.localEventId}`, evidence: [{ source: "OFFLINE_QUEUE", errorCode: item.errorCode, attempts: item.attempts }], allowedActions: ["RETRY_SYNC", "OPEN_SOURCE"], deepLink: `/command/driver-simulator?vehicleId=${encodeURIComponent(item.event?.vehicleId || "")}&returnTo=%2Fcommand%2Foverview`, deduplicationKey: `QUEUE:${item.localEventId}`, openedLogicalTime: item.event?.logicalTime }));
    }
    for (const orderId of source.plan.unassignedOrderIds || []) {
      rows.push(actionItem({ ...identity, actionItemId: `ACTION-UNASSIGNED-${orderId}`, actionType: "UNASSIGNED_ORDER", severity: "HIGH", state: "OPEN", sourceKind: "PLAN_VERIFIER", sourceId: orderId, orderId, title: `Unassigned order · ${orderId}`, evidence: [{ source: "PLAN_VERIFIER", planHash: source.plan.planHash, reason: "UNASSIGNED" }], allowedActions: ["OPEN_SOURCE"], deepLink: `/command/dispatch?unassigned=${encodeURIComponent(orderId)}&returnTo=%2Fcommand%2Foverview`, deduplicationKey: `UNASSIGNED:${source.plan.planHash}:${orderId}`, openedLogicalTime: source.execution.latestLogicalTime }));
    }
    for (const blocker of source.dataQuality?.blockers || []) {
      const blockerId = text(blocker.blockerId || blocker.code || blocker.field);
      rows.push(actionItem({ ...identity, actionItemId: `ACTION-DATA-${blockerId}`, actionType: "DATA_QUALITY_BLOCKER", severity: blocker.severity || "CRITICAL", state: blocker.state || "BLOCKED", sourceKind: "DATA_QUALITY", sourceId: blockerId, title: blocker.title || `Data quality blocker · ${blockerId}`, evidence: blocker.evidence || [{ source: "DATA_QUALITY", code: blocker.code }], allowedActions: ["OPEN_SOURCE"], deepLink: blocker.deepLink || "/platform/data", deduplicationKey: `DATA_QUALITY:${blockerId}`, openedLogicalTime: blocker.openedLogicalTime || source.execution.latestLogicalTime }));
    }
    if (source.execution.run.status === "PAUSED") {
      rows.push(actionItem({ ...identity, actionItemId: `ACTION-RUN-${source.execution.run.executionRunHash}`, actionType: "PAUSED_EXECUTION", severity: "MEDIUM", state: "OPEN", sourceKind: "EXECUTION_STORE", sourceId: source.execution.run.executionRunHash, title: "Execution is paused", evidence: [{ source: "EXECUTION_STORE", status: source.execution.run.status }], allowedActions: ["OPEN_SOURCE"], deepLink: `/command/execution?runHash=${encodeURIComponent(source.execution.run.executionRunHash)}&returnTo=%2Fcommand%2Foverview`, deduplicationKey: `RUN:${source.execution.run.executionRunHash}:PAUSED`, openedLogicalTime: source.execution.latestLogicalTime }));
    }
    if (source.plan.verification?.status !== "PASS") {
      rows.push(actionItem({ ...identity, actionItemId: `ACTION-PLAN-${source.plan.planHash}`, actionType: "UNVERIFIED_PLAN", severity: "CRITICAL", state: "BLOCKED", sourceKind: "PLAN_VERIFIER", sourceId: source.plan.planHash, title: "Applied plan is not verified", evidence: [{ source: "PLAN_VERIFIER", status: source.plan.verification?.status || "UNKNOWN" }], allowedActions: ["OPEN_SOURCE"], deepLink: `/command/dispatch?planHash=${encodeURIComponent(source.plan.planHash)}`, deduplicationKey: `PLAN:${source.plan.planHash}:UNVERIFIED`, openedLogicalTime: source.execution.latestLogicalTime }));
    }
    if (source.incidents.length && source.recoveryCandidates.length && !source.recovery.applied) {
      const incident = source.incidents.at(-1);
      rows.push(actionItem({ ...identity, actionItemId: `ACTION-RECOVERY-${incident.incidentId}`, actionType: "RECOVERY_REQUIRED", severity: "CRITICAL", state: "OPEN", sourceKind: "ROLLING_RECOVERY_SESSION", sourceId: incident.incidentId, routeId: incident.routeId, vehicleId: incident.vehicleId, orderId: incident.orderId, incidentId: incident.incidentId, title: `Recovery decision · ${incident.incidentId}`, evidence: [{ source: "INCIDENT", incidentHash: incident.incidentHash }, { source: "ROLLING_RECOVERY_SESSION", candidateCount: source.recoveryCandidates.length }], allowedActions: ["OPEN_RECOVERY"], deepLink: `/command/recovery?incidentId=${encodeURIComponent(incident.incidentId)}&returnTo=%2Fcommand%2Foverview`, deduplicationKey: `RECOVERY:${incident.incidentHash}`, openedLogicalTime: incident.logicalTime }));
    }
    const unique = [...new Map(rows.map((row) => [row.deduplicationKey, row])).values()];
    const query = text(filters.search).toLowerCase();
    const filtered = unique.filter((row) => {
      if (filters.severity && filters.severity !== "ALL" && row.severity !== filters.severity) return false;
      if (filters.state && filters.state !== "ALL" && row.state !== filters.state) return false;
      if (filters.source && filters.source !== "ALL" && row.sourceKind !== filters.source) return false;
      if (filters.routeId && filters.routeId !== "ALL" && row.routeId !== filters.routeId) return false;
      if (filters.vehicleId && filters.vehicleId !== "ALL" && row.vehicleId !== filters.vehicleId) return false;
      return !query || [row.title, row.category, row.ruleId, row.actionType, row.routeId, row.vehicleId, row.orderId, row.alertId, row.incidentId].join(" ").toLowerCase().includes(query);
    });
    filtered.sort((left, right) => {
      if (filters.sort === "due") return (left.dueLogicalTime ?? Infinity) - (right.dueLogicalTime ?? Infinity);
      if (filters.sort === "freshness") return right.freshness.age - left.freshness.age;
      return SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] || (left.dueLogicalTime ?? Infinity) - (right.dueLogicalTime ?? Infinity);
    });
    const projection = { schemaVersion: SCHEMA_VERSION, sourceRevision: source.revision, sourceHashes: { inputHash: source.scenario.inputHash, planHash: source.plan.planHash, executionStateHash: source.execution.executionStateHash }, items: filtered, counts: { total: filtered.length, critical: filtered.filter((row) => row.severity === "CRITICAL").length, high: filtered.filter((row) => row.severity === "HIGH").length }, generatedFrom: ["AlertStore", "ExecutionStore", "OfflineQueue", "RollingRecovery", "PlanVerifier"] };
    projectionCache.set(context, { key: cacheKey, value: projection });
    return projection;
  }

  async function execute(context, item, action, detail = {}) {
    const normalized = text(action).toUpperCase();
    if (!item?.allowedActions?.includes(normalized)) throw Object.assign(new Error(`Action ${normalized} is not allowed for ${item?.actionItemId || "unknown"}.`), { code: "ACTION_CENTER_ACTION_NOT_ALLOWED" });
    if (normalized === "ACKNOWLEDGE") return context.workspace.acknowledgeAlert(item.alertId, { owner: detail.owner || "LOCAL_DISPATCHER", logicalTime: context.executionStore.snapshot().latestLogicalTime + 1 });
    if (normalized === "START_HANDLING") return context.workspace.startHandlingAlert(item.alertId, { owner: detail.owner || "LOCAL_DISPATCHER", logicalTime: context.executionStore.snapshot().latestLogicalTime + 1 });
    if (normalized === "RESOLVE") return context.workspace.resolveAlert(item.alertId, { owner: detail.owner || "LOCAL_DISPATCHER", logicalTime: context.executionStore.snapshot().latestLogicalTime + 1, evidence: detail.evidence || [{ source: "OPERATOR_VERIFIED", status: "CLEARED" }] });
    if (normalized === "DISMISS") return context.workspace.dismissAlert(item.alertId, { owner: detail.owner || "LOCAL_DISPATCHER", logicalTime: context.executionStore.snapshot().latestLogicalTime + 1, reason: detail.reason || "Dispatcher reviewed as non-actionable" });
    if (normalized === "CREATE_INCIDENT") return context.addIncidentFromAlert(item.alertId, detail);
    if (normalized === "RETRY_SYNC") {
      const queueItem = context.offlineQueue.list().find((row) => row.localEventId === item.sourceId);
      if (queueItem && ["RETRYABLE_FAILURE", "PERMANENT_FAILURE"].includes(queueItem.status)) context.offlineQueue.manualRetry(item.sourceId);
      return context.offlineQueue.sync((event) => context.driver.authoritativeSend(event), { removeAcknowledged: true });
    }
    if (["OPEN_SOURCE", "OPEN_RECOVERY"].includes(normalized)) return { status: "NAVIGATE", deepLink: item.deepLink };
    throw Object.assign(new Error(`Unsupported action: ${normalized}`), { code: "ACTION_CENTER_ACTION_UNSUPPORTED" });
  }

  return Object.freeze({ SCHEMA_VERSION, SEVERITY_ORDER, RULE_SEMANTICS, actionItem, project, execute });
});
