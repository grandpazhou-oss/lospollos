(function (root, factory) {
  "use strict";
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.STCTPlatformV19 = root.STCTPlatformV19 || {};
    root.STCTPlatformV19.navigationPerformance = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function percentile(values, ratio) {
    if (!values.length) return null;
    const sorted = values.slice().sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
  }

  function createRecorder(environment) {
    const env = environment || root || {};
    const metrics = new Map();
    const resources = { listeners: 0, raf: 0, routeOwners: 0, mapOwners: 0, observers: 0, drawerHandlers: 0, tooltipInstances: 0 };
    const now = () => env.performance && typeof env.performance.now === "function" ? env.performance.now() : Date.now();

    function record(name, duration) {
      const values = metrics.get(name) || [];
      values.push(Math.max(0, Number(duration) || 0));
      metrics.set(name, values.slice(-200));
    }

    function measure(name, callback) {
      const started = now();
      const result = callback();
      if (result && typeof result.then === "function") {
        return result.finally(() => record(name, now() - started));
      }
      record(name, now() - started);
      return result;
    }

    function adjust(resource, delta) {
      if (!Object.hasOwn(resources, resource)) return;
      resources[resource] = Math.max(0, resources[resource] + delta);
    }

    function snapshot() {
      const timings = {};
      metrics.forEach((values, name) => {
        timings[name] = { count: values.length, p50Ms: percentile(values, 0.5), p95Ms: percentile(values, 0.95), maxMs: Math.max(...values) };
      });
      return { schemaVersion: "stct-v1.9-p2-navigation-performance-v1", timings, resources: Object.assign({}, resources) };
    }

    return Object.freeze({ measure, record, adjust, snapshot });
  }

  return Object.freeze({ createRecorder, percentile });
});
