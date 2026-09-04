#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const evidencePath = process.argv[2] ? path.resolve(process.argv[2]) : "";
assert(evidencePath && fs.existsSync(evidencePath), "Usage: node tests/test_experience_performance_evidence_v14.js evidence.json");
const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));

assert.strictEqual(evidence.version, "v1.4-trust-closure-mission-control");
assert.strictEqual(evidence.status, "PASS");
assert.deepStrictEqual(evidence.largeData?.replay, { stops: 60, vehicles: 7 });
assert.deepStrictEqual(evidence.largeData?.timeline240, { lanes: 7, serviceBlocks: 240, selectedOrderId: "ORDER-240" });
assert(evidence.metrics.replayRafFps >= evidence.target.replayRafFpsMin);
assert(evidence.metrics.scrubMaxMs < evidence.target.scrubMsMax);
assert(evidence.metrics.vehicleSelectionMaxMs < evidence.target.vehicleSelectionMsMax);
assert(evidence.metrics.viewSwitchMaxMs < evidence.target.viewSwitchMsMax);
assert.strictEqual(evidence.resourceChecks?.cleanup?.raf, 0);
assert.strictEqual(evidence.resourceChecks?.cleanup?.mapHandlers, 0);
assert.strictEqual(evidence.resourceChecks?.cleanup?.layers, 0);
assert.strictEqual(evidence.resourceChecks?.cleanup?.sources, 0);
assert((evidence.resourceChecks?.fivePlayStopCycles || []).length === 5);
assert((evidence.resourceChecks?.fivePlayStopCycles || []).every((row) => row.status === "paused" && row.raf === 0));
assert.deepStrictEqual(evidence.consoleErrors, []);

process.stdout.write(`${JSON.stringify({
  status: "PASS",
  replayRafFps: evidence.metrics.replayRafFps,
  scrubMaxMs: evidence.metrics.scrubMaxMs,
  vehicleSelectionMaxMs: evidence.metrics.vehicleSelectionMaxMs,
  viewSwitchMaxMs: evidence.metrics.viewSwitchMaxMs,
  timeline240RenderMs: evidence.metrics.timeline240RenderMs,
}, null, 2)}\n`);
