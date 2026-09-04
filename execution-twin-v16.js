(function (root, factory) {
  "use strict";
  const integrity = root?.STCTV15?.integrityHash || (typeof require === "function" ? require("./integrity-hash-v151.js") : null);
  const api = factory(integrity);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV16 = root.STCTV16 || { version: "1.6.0" }; root.STCTV16.executionTwin = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function (IntegrityHash) {
  "use strict";
  if (!IntegrityHash?.hashValue) throw new Error("Execution Twin v1.6 requires SHA-256 integrity utilities.");
  const VERSION = "stct-execution-twin-v1.6";
  const RUN_STATUSES = Object.freeze(["PREPARED", "RELEASED", "RUNNING", "PAUSED", "COMPLETED", "CANCELLED"]);
  const EVENT_TYPES = Object.freeze(["RUN_RELEASED", "ROUTE_ACCEPTED", "VEHICLE_DEPARTED", "POSITION_RECORDED", "STOP_ARRIVED", "SERVICE_STARTED", "SERVICE_COMPLETED", "STOP_FAILED", "STOP_SKIPPED", "UNPLANNED_STOP", "OFF_ROUTE_DETECTED", "ROUTE_REJOINED", "VEHICLE_BREAKDOWN", "ORDER_CANCELLED", "NETWORK_OFFLINE", "NETWORK_RESTORED", "EVENT_ACKNOWLEDGED", "RUN_COMPLETED"]);
  const PROFILES = Object.freeze(["ON_TIME", "URBAN_CONGESTION", "WAREHOUSE_DELAY", "HIGH_DWELL", "OFF_ROUTE", "VEHICLE_BREAKDOWN", "MIXED_RISK"]);
  const COPY = Object.freeze({
    zh: { PREPARED: "已准备", RELEASED: "已发布", RUNNING: "运行中", PAUSED: "已暂停", COMPLETED: "已完成", CANCELLED: "已取消", STALE: "数据陈旧", OFFLINE_QUEUEING: "离线排队", PARTIAL_EVENTS: "事件不完整", simulatedActual: "模拟实际" },
    en: { PREPARED: "Prepared", RELEASED: "Released", RUNNING: "Running", PAUSED: "Paused", COMPLETED: "Completed", CANCELLED: "Cancelled", STALE: "Stale", OFFLINE_QUEUEING: "Offline queueing", PARTIAL_EVENTS: "Partial events", simulatedActual: "Simulated Actual" },
    ja: { PREPARED: "準備済み", RELEASED: "リリース済み", RUNNING: "実行中", PAUSED: "一時停止", COMPLETED: "完了", CANCELLED: "キャンセル", STALE: "更新停止", OFFLINE_QUEUEING: "オフライン待機", PARTIAL_EVENTS: "イベント不完全", simulatedActual: "シミュレーション実績" },
  });
  const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const text = (value) => String(value ?? "").trim();
  const number = (value, fallback = NaN) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; };
  function fail(code, message, detail = {}) { const error = new Error(message); error.code = code; error.detail = clone(detail); throw error; }
  function assertSafe(value, path = "$") {
    if (value === null || value === undefined || typeof value !== "object") return;
    if (Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) fail("EXECUTION_OBJECT_PROTOTYPE_INVALID", `Execution object has a non-plain prototype at ${path}.`);
    Object.keys(value).forEach((key) => { if (DANGEROUS_KEYS.has(key)) fail("EXECUTION_PROTOTYPE_POLLUTION_REJECTED", `Dangerous execution key rejected: ${path}.${key}`); assertSafe(value[key], `${path}.${key}`); });
  }
  function coordinate(value, required = false) {
    if (value === null || value === undefined || value === "") { if (required) fail("EXECUTION_COORDINATE_REQUIRED", "Execution coordinate is required."); return null; }
    const pair = [number(value?.lon ?? value?.lng ?? value?.[0]), number(value?.lat ?? value?.[1])];
    if (!Number.isFinite(pair[0]) || !Number.isFinite(pair[1]) || pair[0] < -180 || pair[0] > 180 || pair[1] < -90 || pair[1] > 90) fail("EXECUTION_COORDINATE_INVALID", "Execution coordinate is invalid.", { value });
    return pair;
  }
  function runIdentity(value) {
    return { schemaVersion: "stct-execution-run-v1.6", scenarioId: value.scenarioId, inputHash: value.inputHash, planHash: value.planHash, routeGeometryHash: value.routeGeometryHash, matrixHash: value.matrixHash, providerProvenance: value.providerProvenance, simulationSeed: value.simulationSeed, executionProfile: value.executionProfile, logicalStartMinute: value.logicalStartMinute, revision: value.revision };
  }
  function createRun(input = {}) {
    assertSafe(input);
    const executionProfile = text(input.executionProfile || "ON_TIME").toUpperCase(); if (!PROFILES.includes(executionProfile)) fail("EXECUTION_PROFILE_INVALID", `Unsupported execution profile: ${executionProfile}`);
    const value = { schemaVersion: "stct-execution-run-v1.6", executionRunId: "", executionRunHash: "", scenarioId: text(input.scenarioId), inputHash: text(input.inputHash), planHash: text(input.planHash), routeGeometryHash: text(input.routeGeometryHash), matrixHash: text(input.matrixHash), providerProvenance: clone(input.providerProvenance || {}), simulationSeed: text(input.simulationSeed ?? "0"), executionProfile, logicalStartMinute: number(input.logicalStartMinute, 0), revision: Math.max(0, Math.trunc(number(input.revision, 0))), status: "PREPARED" };
    if (["scenarioId", "inputHash", "planHash", "routeGeometryHash", "matrixHash"].some((field) => !text(value[field]))) fail("EXECUTION_RUN_IDENTITY_REQUIRED", "Execution run identity is incomplete.");
    value.executionRunHash = IntegrityHash.hashValue(runIdentity(value)); value.executionRunId = `RUN-${value.executionRunHash.slice(-16).toUpperCase()}`; return value;
  }
  function eventIdentity(value) {
    return { schemaVersion: "stct-execution-event-v1.6", eventId: value.eventId, executionRunHash: value.executionRunHash, executionRevision: value.executionRevision, sequence: value.sequence, eventType: value.eventType, logicalTime: value.logicalTime, routeId: value.routeId, vehicleId: value.vehicleId, orderId: value.orderId, coordinate: value.coordinate, roadEdgeId: value.roadEdgeId, source: value.source, ackId: value.ackId, payload: value.payload };
  }
  function createEvent(run, input = {}) {
    assertSafe(input);
    const eventType = text(input.eventType).toUpperCase(); if (!EVENT_TYPES.includes(eventType)) fail("EXECUTION_EVENT_TYPE_INVALID", `Unsupported execution event type: ${eventType}`);
    const value = { schemaVersion: "stct-execution-event-v1.6", eventId: text(input.eventId), eventHash: "", executionRunHash: text(input.executionRunHash || run?.executionRunHash), executionRevision: Math.max(0, Math.trunc(number(input.executionRevision, run?.revision))), sequence: Math.trunc(number(input.sequence)), eventType, logicalTime: number(input.logicalTime), routeId: text(input.routeId), vehicleId: text(input.vehicleId), orderId: text(input.orderId), coordinate: coordinate(input.coordinate, eventType === "POSITION_RECORDED"), roadEdgeId: text(input.roadEdgeId), source: text(input.source || "LOCAL_SIMULATION"), ackId: text(input.ackId), payload: clone(input.payload || {}) };
    if (!value.eventId || !value.executionRunHash || !(value.sequence >= 1) || !(value.logicalTime >= 0)) fail("EXECUTION_EVENT_IDENTITY_REQUIRED", "Execution event id, run hash, sequence, and logical time are required.");
    value.eventHash = IntegrityHash.hashValue(eventIdentity(value)); return value;
  }
  function normalizeEvent(run, input = {}) {
    const value = createEvent(run, input); if (text(input.eventHash) && input.eventHash !== value.eventHash) fail("EXECUTION_EVENT_HASH_STALE", "Execution event hash does not match its semantic content.", { expectedHash: value.eventHash, actualHash: input.eventHash }); return value;
  }
  function interpolateGeometry(geometry, progress) {
    if (!Array.isArray(geometry) || geometry.length < 2) fail("EXECUTION_GEOMETRY_REQUIRED", "At least two route geometry points are required.");
    const points = geometry.map((point) => coordinate(point, true)); const lengths = points.slice(1).map((point, index) => Math.hypot(point[0] - points[index][0], point[1] - points[index][1])); const total = lengths.reduce((sum, value) => sum + value, 0); let target = Math.max(0, Math.min(1, number(progress, 0))) * total;
    for (let index = 0; index < lengths.length; index += 1) { if (target <= lengths[index] || index === lengths.length - 1) { const ratio = lengths[index] ? target / lengths[index] : 0; return [points[index][0] + (points[index + 1][0] - points[index][0]) * ratio, points[index][1] + (points[index + 1][1] - points[index][1]) * ratio]; } target -= lengths[index]; }
    return clone(points.at(-1));
  }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character])); }
  return { VERSION, RUN_STATUSES, EVENT_TYPES, PROFILES, COPY, runIdentity, createRun, eventIdentity, createEvent, normalizeEvent, interpolateGeometry, assertSafe, escapeHtml };
});
