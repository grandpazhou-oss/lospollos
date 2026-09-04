(function (root, factory) {
  "use strict";
  const telemetry = root?.STCTV17?.telemetry || (typeof require === "function" ? require("./telemetry-v17.js") : null);
  const matcher = root?.STCTV17?.telemetryMatcher || (typeof require === "function" ? require("./telemetry-matcher-v17.js") : null);
  const validator = root?.STCTV17?.telemetryValidator || (typeof require === "function" ? require("./telemetry-validator-v17.js") : null);
  const api = factory(telemetry, matcher, validator);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV17 = root.STCTV17 || { version: "1.7.0" }; root.STCTV17.telemetryPipeline = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Telemetry, Matcher, Validator) {
  "use strict";
  if (!Telemetry?.createObservation || !Matcher?.derive || !Validator?.validateBundle) throw new Error("Telemetry Pipeline v1.7 dependencies are missing.");
  const VERSION = "stct-telemetry-pipeline-v1.7";
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const text = (value) => String(value ?? "").trim();
  function createPipeline(options = {}) {
    const reorderWindow = Math.max(0, Number(options.reorderWindowSeconds ?? 5)); const records = new Map(); const pending = new Map(); const confirmed = new Map(); const maxSeen = new Map(); const offRoute = new Map(); let generation = 0; let cancelled = false;
    const listFor = (map, vehicleId) => { if (!map.has(vehicleId)) map.set(vehicleId, []); return map.get(vehicleId); };
    async function processOne(observation, token) {
      const previous = listFor(confirmed, observation.vehicleId).at(-1)?.derived || null; const derived = await Matcher.derive(observation, previous, options);
      if (cancelled) return { status: "CANCELLED", code: "TELEMETRY_PIPELINE_CANCELLED" };
      if (token !== generation) return { status: "STALE_REJECTED", code: "TELEMETRY_PIPELINE_STALE_RESULT" };
      const validation = Validator.validateBundle({ observation, derived, previousDerived: previous }); if (validation.status !== "PASS") return { status: "REJECTED", code: "TELEMETRY_DEEP_VALIDATION_FAILED", validation };
      if (derived.plausibility.status === "REJECT") return { status: "REJECTED", code: derived.plausibility.reasons[0] || "TELEMETRY_PLAUSIBILITY_REJECTED", observation, derived, validation };
      const priorOffRoute = offRoute.get(observation.vehicleId) === true; const events = options.run ? Telemetry.eventsFromDerived(options.run, observation, derived, { routeId: options.routeByVehicle?.[observation.vehicleId] || options.routeId, planRevision: options.planRevision, routeRevision: options.routeRevision, sequenceStart: Number(options.sequenceStart || 1) + [...confirmed.values()].reduce((sum, rows) => sum + rows.reduce((count, row) => count + row.events.length, 0), 0), eventPrefix: observation.observationId, previousOffRoute: priorOffRoute }) : [];
      offRoute.set(observation.vehicleId, derived.offRoute); const row = { observation, derived, events, validation, confirmedIndex: listFor(confirmed, observation.vehicleId).length }; listFor(confirmed, observation.vehicleId).push(row); return { status: "CONFIRMED", ...clone(row) };
    }
    async function flushReady(vehicleId, all = false) {
      const rows = listFor(pending, vehicleId).sort((a, b) => a.logicalTime - b.logicalTime || a.observationId.localeCompare(b.observationId, "en")); const watermark = Number(maxSeen.get(vehicleId) ?? -Infinity) - reorderWindow; const ready = all ? rows.splice(0) : rows.filter((row) => row.logicalTime <= watermark); if (!all) pending.set(vehicleId, rows.filter((row) => row.logicalTime > watermark)); const results = []; const token = generation; for (const row of ready) results.push(await processOne(row, token)); return results;
    }
    async function ingest(input) {
      const observation = input?.schemaVersion === "stct-telemetry-observation-v1.7" ? clone(input) : Telemetry.createObservation(input); const existing = records.get(observation.observationId);
      if (existing) return existing.rawRecordHash === observation.rawRecordHash ? { status: "DUPLICATE_IDEMPOTENT", observation: clone(existing) } : { status: "CONFLICT", code: "OBSERVATION_ID_PAYLOAD_CONFLICT", observation: clone(existing) };
      const vehicleRows = listFor(confirmed, observation.vehicleId); const lastConfirmed = vehicleRows.at(-1)?.observation?.logicalTime ?? -Infinity; const seen = maxSeen.get(observation.vehicleId) ?? -Infinity;
      if (observation.logicalTime < lastConfirmed || observation.logicalTime < seen - reorderWindow) return { status: "REJECTED", code: "LATE_OBSERVATION_REJECTED", observation };
      records.set(observation.observationId, clone(observation)); listFor(pending, observation.vehicleId).push(observation); maxSeen.set(observation.vehicleId, Math.max(seen, observation.logicalTime)); const flushed = await flushReady(observation.vehicleId, false); return { status: flushed.length ? "CONFIRMED_AVAILABLE" : "REORDER_BUFFERED", observation, flushed };
    }
    async function ingestBatch(inputs = []) { const results = []; for (const input of inputs) results.push(await ingest(input)); return { status: "BATCH_BUFFERED", results, vehicleIds: [...new Set(inputs.map((row) => row.vehicleId))] }; }
    async function flushAll(vehicleId = "") { const ids = vehicleId ? [vehicleId] : [...pending.keys()].sort(); const results = []; for (const id of ids) results.push(...await flushReady(id, true)); return { status: results.some((row) => row.status === "REJECTED") ? "PARTIAL" : "FLUSHED", results }; }
    function cancel() { cancelled = true; generation += 1; options.provider?.cancel?.(); return { status: "CANCELLED", generation }; }
    function reset() { cancelled = false; generation += 1; return { status: "RESET", generation }; }
    function snapshot() { return { schemaVersion: "stct-telemetry-pipeline-state-v1.7", generation, cancelled, reorderWindowSeconds: reorderWindow, pending: Object.fromEntries([...pending].map(([key, value]) => [key, clone(value)])), confirmed: Object.fromEntries([...confirmed].map(([key, value]) => [key, clone(value)])), maxSeen: Object.fromEntries(maxSeen), sourceBoundary: "SYNTHETIC_TELEMETRY_NO_LIVE_GPS" }; }
    return { VERSION, ingest, ingestBatch, flushAll, cancel, reset, snapshot, records: () => clone([...records.values()]), confirmed: (vehicleId) => clone(vehicleId ? listFor(confirmed, vehicleId) : Object.fromEntries(confirmed)), pending: (vehicleId) => clone(vehicleId ? listFor(pending, vehicleId) : Object.fromEntries(pending)) };
  }
  return { VERSION, createPipeline };
});
