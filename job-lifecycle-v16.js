(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV16 = root.STCTV16 || { version: "1.6.0" }; root.STCTV16.jobs = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const VERSION = "stct-job-lifecycle-v1.6";
  const STATES = Object.freeze(["CREATED", "QUEUED", "MATRIX_READY", "SOLVING", "VERIFYING", "COMPLETED", "PARTIAL", "FAILED", "CANCELLED", "STALE"]);
  const TERMINAL = new Set(["COMPLETED", "PARTIAL", "FAILED", "CANCELLED", "STALE"]);
  const TRANSITIONS = Object.freeze({ CREATED: ["QUEUED", "CANCELLED"], QUEUED: ["MATRIX_READY", "FAILED", "CANCELLED"], MATRIX_READY: ["SOLVING", "FAILED", "CANCELLED"], SOLVING: ["VERIFYING", "FAILED", "CANCELLED", "STALE"], VERIFYING: ["COMPLETED", "PARTIAL", "FAILED", "CANCELLED", "STALE"], COMPLETED: [], PARTIAL: [], FAILED: [], CANCELLED: [], STALE: [] });
  const clone = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  function create(options = {}) {
    const jobs = new Map(); const activeByRequest = new Map(); let generation = 0;
    function submit(requestHash) {
      if (!requestHash) throw Object.assign(new Error("requestHash is required."), { code: "JOB_REQUEST_HASH_REQUIRED" });
      const active = activeByRequest.get(requestHash); if (active && !TERMINAL.has(active.state)) return { ...clone(active), duplicate: true };
      const job = { schemaVersion: "stct-job-v1.6", jobId: `JOB-${String(++generation).padStart(6, "0")}`, requestHash, generation, state: "CREATED", stage: "Created", events: [], createdAt: options.clock?.() || new Date().toISOString(), result: null, error: null };
      jobs.set(job.jobId, job); activeByRequest.set(requestHash, job); return clone(job);
    }
    function transition(jobId, next, detail = {}) {
      const job = jobs.get(jobId); if (!job) throw Object.assign(new Error(`Unknown job: ${jobId}`), { code: "JOB_NOT_FOUND" });
      if (!STATES.includes(next) || !TRANSITIONS[job.state].includes(next)) throw Object.assign(new Error(`Invalid job transition ${job.state} -> ${next}`), { code: "JOB_TRANSITION_INVALID" });
      job.state = next; job.stage = detail.stage || next.replaceAll("_", " ").toLowerCase(); job.events.push({ sequence: job.events.length + 1, state: next, stage: job.stage, at: options.clock?.() || new Date().toISOString(), detail: clone(detail) });
      if (detail.result !== undefined) job.result = clone(detail.result); if (detail.error !== undefined) job.error = clone(detail.error);
      return clone(job);
    }
    function cancel(jobId) { const job = jobs.get(jobId); if (!job) throw Object.assign(new Error(`Unknown job: ${jobId}`), { code: "JOB_NOT_FOUND" }); return TERMINAL.has(job.state) ? clone(job) : transition(jobId, "CANCELLED", { stage: "Cancelled by user" }); }
    function stale(jobId) { const job = jobs.get(jobId); if (!job) throw Object.assign(new Error(`Unknown job: ${jobId}`), { code: "JOB_NOT_FOUND" }); return TERMINAL.has(job.state) ? clone(job) : transition(jobId, "STALE", { stage: "Stale response rejected" }); }
    return { submit, transition, cancel, stale, get: (jobId) => clone(jobs.get(jobId)), list: () => [...jobs.values()].map(clone), STATES, TERMINAL };
  }
  return { VERSION, STATES, TERMINAL, TRANSITIONS, create };
});
