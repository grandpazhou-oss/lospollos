(function (root, factory) {
  "use strict";
  const integrity = root?.STCTV15?.integrityHash || (typeof require === "function" ? require("./integrity-hash-v151.js") : null);
  const api = factory(integrity);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV17 = root.STCTV17 || { version: "1.7.0" }; root.STCTV17.performanceInstrumentation = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function (IntegrityHash) {
  "use strict";
  if (!IntegrityHash?.hashValue) throw new Error("Performance Instrumentation v1.7 dependencies are missing.");

  const VERSION = "stct-real-performance-instrumentation-v1.7";
  const METRICS = Object.freeze([
    "executionStep", "storeAppend", "telemetryDerive", "planActualCompute", "alertEvaluation",
    "mapLayerUpdate", "actualSetDataCalls", "timelineRenders", "eventLaneRenders",
    "projectionRebuild", "browserRafCallbacks", "applicationUpdates", "alertFilter",
    "eventSeek", "driverAction", "capsuleReplay",
  ]);
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const percentile = (values, quantile = 0.95) => {
    if (!values.length) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))];
  };
  const finite = (value) => Number.isFinite(Number(value));
  const round = (value, digits = 3) => Number(Number(value || 0).toFixed(digits));

  function summarizeTrace(trace = [], options = {}) {
    const rows = clone(trace).sort((left, right) => left.startMs - right.startMs || left.traceSequence - right.traceSequence);
    const startedAtMs = finite(options.startedAtMs) ? Number(options.startedAtMs) : Math.min(...rows.map((row) => row.startMs), 0);
    const endedAtMs = finite(options.endedAtMs) ? Number(options.endedAtMs) : Math.max(...rows.map((row) => row.endMs), startedAtMs + 1);
    const durationMs = Math.max(1, endedAtMs - startedAtMs);
    const counts = Object.fromEntries(METRICS.map((metric) => [metric, rows.filter((row) => row.metric === metric && row.status === "CALLED").length]));
    const durations = Object.fromEntries(METRICS.map((metric) => {
      const values = rows.filter((row) => row.metric === metric && row.status === "CALLED").map((row) => row.durationMs);
      return [metric, { count: values.length, totalMs: round(values.reduce((sum, value) => sum + value, 0)), meanMs: round(values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0), p95Ms: round(percentile(values)), maxMs: round(Math.max(0, ...values)) }];
    }));
    const seconds = durationMs / 1000;
    const rates = Object.fromEntries(Object.entries(counts).map(([metric, count]) => [metric, round(count / seconds)]));
    const longTasks = rows.filter((row) => row.status === "CALLED" && row.durationMs >= 50).map((row) => ({ metric: row.metric, startMs: row.startMs, durationMs: row.durationMs, source: row.source }));
    return {
      durationMs: round(durationMs), counts, rates, durations, longTasks,
      longTaskCount: longTasks.length,
      longTaskTotalMs: round(longTasks.reduce((sum, row) => sum + row.durationMs, 0)),
      maxLongTaskMs: round(Math.max(0, ...longTasks.map((row) => row.durationMs))),
    };
  }

  function createProbe(options = {}) {
    const now = options.now || (() => typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());
    const startedAtMs = now();
    let traceSequence = 0;
    let executionPaused = false;
    const trace = [];
    const hookSources = {};
    const disabled = new Set();
    const panelVisibility = new Map();
    const resources = new Map();
    const heapSamples = [];
    const profiles = [];

    function gate(metric, config = {}) {
      if (disabled.has(metric)) return "DISABLED";
      if (config.panel && panelVisibility.get(config.panel) === false) return "PANEL_HIDDEN";
      if (config.execution && executionPaused) return "EXECUTION_PAUSED";
      return "CALLED";
    }

    function sourceIdentity(metric, fn, config) {
      const source = String(config.source || fn?.name || "anonymous");
      const value = { metric, source, functionName: String(fn?.name || "anonymous"), sourceHash: IntegrityHash.hashValue(String(fn || "")) };
      hookSources[metric] = value;
      return value;
    }

    function record(metric, status, startMs, endMs, source, detail = {}) {
      const row = { traceSequence: ++traceSequence, metric, status, startMs: round(startMs, 6), endMs: round(endMs, 6), durationMs: round(Math.max(0, endMs - startMs), 6), source, detail: clone(detail) };
      trace.push(row);
      return row;
    }

    function wrap(metric, fn, config = {}) {
      if (!METRICS.includes(metric)) throw new Error(`Unknown performance metric: ${metric}`);
      if (typeof fn !== "function") throw new Error(`Performance hook ${metric} requires a function.`);
      const source = sourceIdentity(metric, fn, config);
      return function instrumented(...args) {
        const status = gate(metric, config);
        const startMs = now();
        if (status !== "CALLED") {
          record(metric, status, startMs, now(), source.source, { reason: status });
          return config.onSkip ? config.onSkip(...args) : undefined;
        }
        try {
          const result = fn.apply(this, args);
          if (result && typeof result.then === "function") {
            return result.then((value) => { record(metric, "CALLED", startMs, now(), source.source, config.detail); return value; }, (error) => { record(metric, "THREW", startMs, now(), source.source, { code: error?.code || error?.name }); throw error; });
          }
          record(metric, "CALLED", startMs, now(), source.source, config.detail);
          return result;
        } catch (error) {
          record(metric, "THREW", startMs, now(), source.source, { code: error?.code || error?.name });
          throw error;
        }
      };
    }

    function instrumentMapSource(source, config = {}) {
      if (!source || typeof source.setData !== "function") throw new Error("A map source with setData is required.");
      return { ...source, setData: wrap("actualSetDataCalls", source.setData.bind(source), { source: config.source || "MapLibre.GeoJSONSource.setData", panel: config.panel || "map" }) };
    }

    function requestFrame(requestAnimationFrame, callback = () => {}) {
      if (typeof requestAnimationFrame !== "function") throw new Error("A requestAnimationFrame implementation is required.");
      const resourceId = `RAF-${traceSequence + resources.size + 1}`;
      const handle = requestAnimationFrame((timestamp) => {
        resources.delete(resourceId);
        const startMs = now();
        callback(timestamp);
        record("browserRafCallbacks", "CALLED", startMs, now(), "window.requestAnimationFrame", { timestamp });
      });
      resources.set(resourceId, { type: "RAF", handle });
      return { resourceId, handle };
    }

    function mount(resourceId, setup = {}) {
      if (resources.has(resourceId)) throw new Error(`Performance resource already mounted: ${resourceId}`);
      const listeners = [];
      const rafs = [];
      const resource = {
        type: "MOUNT",
        listen(target, eventName, listener) { target.addEventListener(eventName, listener); listeners.push({ target, eventName, listener }); return listener; },
        frame(requestAnimationFrame, cancelAnimationFrame, callback) { const handle = requestAnimationFrame(callback); rafs.push({ handle, cancelAnimationFrame }); return handle; },
        dispose() { listeners.splice(0).forEach((row) => row.target.removeEventListener(row.eventName, row.listener)); rafs.splice(0).forEach((row) => row.cancelAnimationFrame?.(row.handle)); resources.delete(resourceId); },
        counts: () => ({ listeners: listeners.length, rafs: rafs.length }),
      };
      resources.set(resourceId, resource);
      setup(resource);
      return resource;
    }

    function heapSnapshot(label, usedBytes) {
      const value = finite(usedBytes) ? Number(usedBytes) : typeof process !== "undefined" && process.memoryUsage ? process.memoryUsage().heapUsed : null;
      const row = { label: String(label), usedBytes: value, measured: finite(value), sampleIndex: heapSamples.length };
      heapSamples.push(row);
      return clone(row);
    }

    function profile(label, detail = {}) { const value = { label: String(label), atMs: round(now()), detail: clone(detail), traceCount: trace.length }; profiles.push(value); return clone(value); }
    function setEnabled(metric, enabled) { if (enabled) disabled.delete(metric); else disabled.add(metric); }
    function setPanelVisible(panel, visible) { panelVisibility.set(String(panel), visible !== false); }
    function setExecutionPaused(paused) { executionPaused = paused === true; }
    function cleanupPendingRaf(cancelAnimationFrame = null) { let cleaned = 0; for (const [id, resource] of [...resources]) { if (resource.type !== "RAF") continue; cancelAnimationFrame?.(resource.handle); resources.delete(id); cleaned += 1; } return cleaned; }
    function resourceSnapshot() { const rows = [...resources.entries()].map(([id, value]) => ({ id, type: value.type, ...(value.counts?.() || {}) })); return { rows, total: rows.length, listeners: rows.reduce((sum, row) => sum + Number(row.listeners || 0), 0), rafs: rows.filter((row) => row.type === "RAF").length + rows.reduce((sum, row) => sum + Number(row.rafs || 0), 0) }; }

    function report(input = {}) {
      const endedAtMs = finite(input.endedAtMs) ? Number(input.endedAtMs) : now();
      const summary = summarizeTrace(trace, { startedAtMs, endedAtMs });
      const heapMeasured = heapSamples.filter((row) => row.measured);
      const heap = { samples: clone(heapSamples), beforeBytes: heapMeasured[0]?.usedBytes ?? null, afterBytes: heapMeasured.at(-1)?.usedBytes ?? null, deltaBytes: heapMeasured.length ? heapMeasured.at(-1).usedBytes - heapMeasured[0].usedBytes : null };
      const workload = clone(input.workload || {});
      const thresholds = { minimumApplicationUpdateHz: Number(input.thresholds?.minimumApplicationUpdateHz ?? 18), maximumLongTaskCount: Number(input.thresholds?.maximumLongTaskCount ?? 5) };
      const failures = [];
      if (workload.stops >= 240 && summary.rates.applicationUpdates < thresholds.minimumApplicationUpdateHz) failures.push("APPLICATION_UPDATE_HZ_BELOW_THRESHOLD");
      if (summary.longTaskCount > thresholds.maximumLongTaskCount) failures.push("LONG_TASK_COUNT_ABOVE_THRESHOLD");
      const value = {
        schemaVersion: "stct-real-performance-report-v1.7", version: VERSION,
        methodology: {
          source: "MEASURED_FUNCTION_HOOKS_AND_WALL_CLOCK",
          noSyntheticIncrements: true,
          rafIsNotApplicationUpdate: true,
          browserRafHz: "Count of actual requestAnimationFrame callbacks divided by measured wall-clock duration",
          applicationUpdateHz: "Count of instrumented application update function calls divided by measured wall-clock duration",
        },
        status: failures.length ? "FAIL" : "PASS", failures, workload, thresholds,
        startedAtMs: round(startedAtMs), endedAtMs: round(endedAtMs), ...summary,
        metrics: {
          browserRafHz: summary.rates.browserRafCallbacks,
          executionEventsPerSecond: summary.rates.executionStep,
          applicationUpdateHz: summary.rates.applicationUpdates,
          mapLayerUpdateHz: summary.rates.mapLayerUpdate,
          actualSetDataCalls: summary.counts.actualSetDataCalls,
          timelineRenders: summary.counts.timelineRenders,
          eventLaneRenders: summary.counts.eventLaneRenders,
          telemetryDeriveMs: summary.durations.telemetryDerive,
          planActualRecomputeMs: summary.durations.planActualCompute,
          alertEvaluationMs: summary.durations.alertEvaluation,
          driverProjectionMs: summary.durations.projectionRebuild,
        },
        hookSources: clone(hookSources), heap, profiles: clone(profiles), resources: resourceSnapshot(), rawTrace: clone(trace),
      };
      value.performanceEvidenceHash = IntegrityHash.hashValue({ ...value, performanceEvidenceHash: "" });
      return value;
    }

    return { VERSION, wrap, instrumentMapSource, requestFrame, mount, heapSnapshot, profile, setEnabled, setPanelVisible, setExecutionPaused, cleanupPendingRaf, resourceSnapshot, trace: () => clone(trace), report };
  }

  function replayReport(report) {
    const summary = summarizeTrace(report.rawTrace || [], { startedAtMs: report.startedAtMs, endedAtMs: report.endedAtMs });
    return { schemaVersion: "stct-performance-trace-replay-v1.7", summary, sourceEvidenceHash: report.performanceEvidenceHash, replayHash: IntegrityHash.hashValue({ summary, sourceEvidenceHash: report.performanceEvidenceHash }) };
  }

  return { VERSION, METRICS, percentile, summarizeTrace, createProbe, replayReport };
});
