(function (root, factory) {
  "use strict";
  const contract = typeof module !== "undefined" && module.exports ? require("./network-contract-v18.js") : root.STCTV18?.networkContract;
  const trip = typeof module !== "undefined" && module.exports ? require("./trip-chain-v18.js") : root.STCTV18?.tripChain;
  const api = factory(contract, trip);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV18 = root.STCTV18 || { version: "1.8.0" }; root.STCTV18.networkPerformance = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Contract, Trip) {
  "use strict";

  if (!Contract?.identityBundle || !Trip?.distanceKm) throw new Error("STCT v1.8 performance dependencies are required.");
  const VERSION = "stct-network-performance-v1.8";
  const clone = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const now = () => typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  const round = (value) => Number(Number(value || 0).toFixed(6));

  function percentile(values, quantile = 0.95) {
    if (!values.length) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    return round(sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))]);
  }

  function createHarness(options = {}) {
    const trace = [];
    const sources = {};
    const cache = new Map();
    const resources = new Map();
    const heap = [];
    let sequence = 0;

    function measure(name, operation, detail = {}) {
      if (typeof operation !== "function") throw new Error(`Performance operation ${name} must be a function.`);
      const source = String(detail.source || operation.name || "anonymous");
      sources[name] = { source, sourceHash: Contract.hashArtifact(String(operation)) };
      const startedAtMs = now();
      let result;
      let status = "PASS";
      try { result = operation(); }
      catch (error) { status = "FAIL"; result = { errorCode: error.code || error.name, message: error.message }; }
      const endedAtMs = now();
      const row = { sequence: ++sequence, name, status, startedAtMs: round(startedAtMs), endedAtMs: round(endedAtMs), durationMs: round(endedAtMs - startedAtMs), source, detail: clone(detail) };
      trace.push(row);
      if (status === "FAIL") throw Object.assign(new Error(result.message), { code: result.errorCode, performanceRow: row });
      return { result, row };
    }

    function measureVisible(name, visible, operation, detail = {}) {
      if (visible) return measure(name, operation, detail);
      const source = String(detail.source || operation?.name || "anonymous");
      sources[name] = { source, sourceHash: Contract.hashArtifact(String(operation || "")) };
      const atMs = now();
      const row = { sequence: ++sequence, name, status: "SKIPPED_HIDDEN", startedAtMs: round(atMs), endedAtMs: round(atMs), durationMs: 0, source, detail: { ...clone(detail), reason: "PANEL_HIDDEN" } };
      trace.push(row);
      return { result: undefined, row, skipped: true };
    }

    function matrix(source) {
      const identity = Contract.identityBundle(source);
      const cacheKey = `MATRIX:${identity.routingContextHash}:${identity.networkContentHash}`;
      const cacheHit = cache.has(cacheKey);
      const measured = measure(cacheHit ? "matrixCacheHit" : "matrixCacheMiss", () => {
        if (cacheHit) return cache.get(cacheKey);
        const points = [...identity.scenario.depots.map((row) => ({ id: row.depotId, coordinate: row.coordinate })), ...identity.scenario.orders.map((row) => ({ id: row.orderId, coordinate: row.coordinate }))];
        const rows = points.map((from) => points.map((to) => round(Trip.distanceKm(from.coordinate, to.coordinate) * identity.scenario.assumptions.syntheticRoadFactor)));
        const value = { schemaVersion: "stct-local-synthetic-matrix-v1.8", pointCount: points.length, pointIds: points.map((row) => row.id), rows, routingContextHash: identity.routingContextHash, source: "LOCAL_SYNTHETIC_HAVERSINE_FIXTURE", publicRoutingCalls: 0 };
        value.matrixHash = Contract.hashArtifact(value);
        cache.set(cacheKey, value);
        return value;
      }, { source: "NetworkPerformanceV18.localSyntheticMatrix", cacheHit, publicRoutingCalls: 0 });
      return { ...measured, cacheHit };
    }

    function staticGeometry(key, factory) {
      const cacheKey = `GEOMETRY:${String(key)}`;
      if (cache.has(cacheKey)) return { value: cache.get(cacheKey), cacheHit: true };
      const value = factory(); cache.set(cacheKey, value); return { value, cacheHit: false };
    }

    function mount(id, setup = {}) {
      if (resources.has(id)) throw new Error(`Resource already mounted: ${id}`);
      const listeners = []; const rafs = []; const layers = []; const workers = [];
      const resource = {
        listen(target, event, listener) { target.addEventListener(event, listener); listeners.push({ target, event, listener }); },
        frame(request, cancel, callback) { const handle = request(callback); rafs.push({ handle, cancel }); return handle; },
        layer(cleanup) { layers.push(cleanup); },
        worker(worker) { workers.push(worker); },
        dispose() { listeners.splice(0).forEach((row) => row.target.removeEventListener(row.event, row.listener)); rafs.splice(0).forEach((row) => row.cancel?.(row.handle)); layers.splice(0).forEach((cleanup) => cleanup()); workers.splice(0).forEach((worker) => worker.terminate?.()); resources.delete(id); },
        counts() { return { listeners: listeners.length, rafs: rafs.length, layers: layers.length, workers: workers.length }; },
      };
      resources.set(id, resource); setup(resource); return resource;
    }

    function resourceSnapshot() {
      const rows = [...resources.entries()].map(([id, resource]) => ({ id, ...resource.counts() }));
      return { rows, listeners: rows.reduce((sum, row) => sum + row.listeners, 0), rafs: rows.reduce((sum, row) => sum + row.rafs, 0), layers: rows.reduce((sum, row) => sum + row.layers, 0), workers: rows.reduce((sum, row) => sum + row.workers, 0) };
    }

    function heapSnapshot(label, usedBytes) {
      const value = Number.isFinite(Number(usedBytes)) ? Number(usedBytes) : typeof process !== "undefined" && process.memoryUsage ? process.memoryUsage().heapUsed : null;
      const row = { label: String(label), usedBytes: value, measured: Number.isFinite(value) }; heap.push(row); return clone(row);
    }

    function report(input = {}) {
      const durations = {};
      for (const name of [...new Set(trace.map((row) => row.name))]) {
        const values = trace.filter((row) => row.name === name && row.status === "PASS").map((row) => row.durationMs);
        durations[name] = { count: values.length, totalMs: round(values.reduce((sum, value) => sum + value, 0)), p95Ms: percentile(values), maxMs: round(Math.max(0, ...values)) };
      }
      const longTasks = trace.filter((row) => row.durationMs >= Number(input.longTaskThresholdMs || 50));
      const measuredHeap = heap.filter((row) => row.measured);
      const status = input.blockedReason ? "BLOCKED_MEASUREMENT" : (input.failures || []).length ? "FAIL" : "PASS";
      const value = {
        schemaVersion: "stct-network-performance-report-v1.8", version: VERSION, status,
        failures: clone(input.failures || []), blockedReason: input.blockedReason || "", workload: clone(input.workload || {}), environment: clone(input.environment || {}),
        methodology: { source: "MEASURED_FUNCTION_BOUNDARIES_AND_WALL_CLOCK", noSyntheticCounters: true, browserRafSeparate: true, publicRoutingCalls: 0 },
        durations, longTaskCount: longTasks.length, longTaskTotalMs: round(longTasks.reduce((sum, row) => sum + row.durationMs, 0)), maxLongTaskMs: round(Math.max(0, ...longTasks.map((row) => row.durationMs))),
        heap: { samples: clone(heap), beforeBytes: measuredHeap[0]?.usedBytes ?? null, afterBytes: measuredHeap.at(-1)?.usedBytes ?? null, deltaBytes: measuredHeap.length ? measuredHeap.at(-1).usedBytes - measuredHeap[0].usedBytes : null },
        resources: resourceSnapshot(), instrumentationSources: clone(sources), rawTrace: clone(trace), cacheEntries: cache.size,
      };
      value.performanceEvidenceHash = Contract.hashArtifact({ ...value, performanceEvidenceHash: "" });
      return value;
    }

    return { measure, measureVisible, matrix, staticGeometry, mount, resourceSnapshot, heapSnapshot, trace: () => clone(trace), report, cacheSize: () => cache.size };
  }

  function replay(report) {
    const durations = {};
    for (const name of [...new Set((report.rawTrace || []).map((row) => row.name))]) {
      const values = report.rawTrace.filter((row) => row.name === name && row.status === "PASS").map((row) => row.durationMs);
      durations[name] = { count: values.length, totalMs: round(values.reduce((sum, value) => sum + value, 0)), p95Ms: percentile(values), maxMs: round(Math.max(0, ...values)) };
    }
    const issues = [];
    const fail = (code) => { if (!issues.includes(code)) issues.push(code); };
    if (Contract.hashArtifact({ ...report, performanceEvidenceHash: "" }) !== report.performanceEvidenceHash) fail("PERFORMANCE_EVIDENCE_HASH_MISMATCH");
    if (Contract.canonicalString(durations) !== Contract.canonicalString(report.durations || {})) fail("PERFORMANCE_DURATION_AGGREGATE_MISMATCH");
    (report.rawTrace || []).forEach((row, index) => {
      if (row.sequence !== index + 1) fail("PERFORMANCE_TRACE_SEQUENCE_MISMATCH");
      if (!Number.isFinite(row.startedAtMs) || !Number.isFinite(row.endedAtMs) || !Number.isFinite(row.durationMs) || row.endedAtMs < row.startedAtMs || round(row.endedAtMs - row.startedAtMs) !== round(row.durationMs)) fail("PERFORMANCE_TRACE_INTERVAL_INVALID");
      const source = report.instrumentationSources?.[row.name];
      if (!source || source.source !== row.source || !Contract.isSha256(source.sourceHash)) fail("PERFORMANCE_INSTRUMENTATION_SOURCE_INVALID");
      if (Number(row.detail?.publicRoutingCalls || 0) !== 0) fail("PERFORMANCE_PUBLIC_ROUTING_COUNTER_INVALID");
    });
    const samples = (report.heap?.samples || []).filter((row) => row.measured);
    const expectedHeapDelta = samples.length ? samples.at(-1).usedBytes - samples[0].usedBytes : null;
    if ((report.heap?.deltaBytes ?? null) !== expectedHeapDelta) fail("PERFORMANCE_HEAP_DELTA_MISMATCH");
    if (report.methodology?.noSyntheticCounters !== true || report.methodology?.publicRoutingCalls !== 0) fail("PERFORMANCE_METHODOLOGY_INVALID");
    return { schemaVersion: "stct-network-performance-replay-v1.8", status: issues.length ? "MISMATCH" : "EQUIVALENT", issues, durations, sourceEvidenceHash: report.performanceEvidenceHash };
  }

  return { VERSION, percentile, createHarness, replay };
});
