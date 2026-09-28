'use strict';

const assert = require('node:assert/strict');
const Performance = require('../performance-instrumentation-v17.js');
const Integrity = require('../integrity-hash-v151.js');

// Deterministic clock boundaries expose rounding drift without machine-speed noise.
const cases = [[1.0004, 3.0008], [1.0008, 3.0004], [1000.9995, 1003.0001], [0.0004, 1.0008], [1234567.99955, 1234570.00015]];
for (const [start, end] of cases) {
  let time = start;
  const probe = Performance.createProbe({ now: () => time });
  const call = probe.wrap('applicationUpdates', () => { time += 0.000123; }, { source: 'SYNTHETIC_PRECISION_PROBE' });
  time = start + 0.1;
  call();
  const original = probe.report({ endedAtMs: end });
  const reopened = JSON.parse(JSON.stringify(original));
  const replayed = Performance.replayReport(reopened);
  assert.equal(reopened.startedAtMs, start);
  assert.equal(reopened.endedAtMs, end);
  assert.equal(replayed.summary.durationMs, original.durationMs);
  for (const [key, value] of Object.entries(replayed.summary)) assert.deepEqual(value, original[key], key);
  assert.equal(original.performanceEvidenceHash, Integrity.hashValue({ ...original, performanceEvidenceHash: '' }));
  assert.equal(replayed.summary.counts.applicationUpdates, 1);
}
console.log(JSON.stringify({ suite: 'PERFORMANCE_REPLAY_PRECISION_V7', status: 'PASS', cases: cases.length, evidenceKind: 'DETERMINISTIC_CLOCK_MODULE_REGRESSION', jsonRoundTrip: true }));
