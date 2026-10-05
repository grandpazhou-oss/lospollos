'use strict';

// Synthetic module/size/lifecycle checks; no solver or browser acceptance claim.
const assert = require('node:assert/strict');
const Design = require('../supply-chain-design-v19.js');
const Joint = require('../supply-chain-joint-v19.js');
const Results = require('../supply-chain-v5-results-v19.js');
const Controller = require('../supply-chain-controller-v19.js');

function fixture(customers, warehouses, suppliers, count) {
  const periods = Array.from({ length: count }, (_, i) => `P${i + 1}`), nodes = [], periodDemand = [], observedInbound = [], distanceRows = [];
  for (let i = 0; i < suppliers; i++) nodes.push({ nodeId: `S${i}`, role: 'SUPPLIER', name: `Synthetic source ${i}` });
  for (let i = 0; i < warehouses; i++) nodes.push({ nodeId: `W${i}`, role: 'DC', name: `Synthetic warehouse ${i}` });
  for (let i = 0; i < customers; i++) {
    nodes.push({ nodeId: `C${i}`, role: 'CUSTOMER', name: `Synthetic customer ${i}` });
    for (const period of periods) periodDemand.push({ demandId: `D${i}`, customerNodeId: `C${i}`, currentSiteId: `W${i % warehouses}`, period, quantity: 1, unit: 'm3' });
  }
  for (let j = 0; j < warehouses; j++) for (const period of periods) observedInbound.push({ flowId: `I${j}`, fromNodeId: `S${j % suppliers}`, toNodeId: `W${j}`, period, quantity: Math.floor((customers - 1 - j) / warehouses) + 1, unit: 'm3' });
  const road = (fromNodeId, toNodeId, distanceKm) => ({ fromNodeId, toNodeId, distanceKm, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD' });
  for (let i = 0; i < suppliers; i++) for (let j = 0; j < warehouses; j++) distanceRows.push(road(`S${i}`, `W${j}`, 10 + Math.abs(i - j) * 20));
  for (let j = 0; j < warehouses; j++) for (let i = 0; i < customers; i++) distanceRows.push(road(`W${j}`, `C${i}`, 20 + Math.abs(j - i % warehouses) * 5));
  return { studyId: 'V7-SYNTHETIC-LIFECYCLE', name: 'Synthetic scale and lifecycle', classification: 'SYNTHETIC_TEST', nodes, periodDemand, observedInbound, distanceRows, costApplicability: { inventoryHolding: 'NOT_APPLICABLE', transferTransport: 'NOT_APPLICABLE' } };
}

function configuration(warehouses) {
  return { scenarioId: 'SYNTHETIC-PROJECTION', analysisScope: 'FULL_CHAIN', type: 'NETWORK_CANDIDATE', objective: 'VOLUME_KM', distanceBasis: 'VERIFIED_ROAD', sourceMode: 'FREE', supplierTotalMode: 'ADJUSTABLE', capacityPolicy: 'UNBOUNDED_SCREENING', homogeneousDemandConfirmed: true, allowAllSupplierSiteEdgesConfirmed: true, facilityCounts: [warehouses], maxCandidates: 1, timeLimitSeconds: 1 };
}

function memoryRepository() {
  const rows = new Map();
  return {
    rows, failQuota: false,
    record: (id, payload, refs = []) => ({ id, payload: structuredClone(payload), refs, contentHash: Design.hash(payload) }),
    async read(store, id) { return id === undefined ? [...rows.entries()].filter(([key]) => key.startsWith(`${store}:`)).map(([, value]) => structuredClone(value)) : structuredClone(rows.get(`${store}:${id}`) || null); },
    async commit({ records, pointer, expectedRevision }) {
      if (this.failQuota) throw Object.assign(new Error('Synthetic quota fault'), { name: 'QuotaExceededError' });
      assert.equal(rows.get(`pointers:${pointer.id}`)?.revision || 0, expectedRevision);
      for (const [store, values] of Object.entries(records)) for (const record of values) rows.set(`${store}:${record.id}`, structuredClone(record));
      const saved = { ...pointer, revision: expectedRevision + 1 };
      rows.set(`pointers:${pointer.id}`, structuredClone(saved));
      return { status: 'SAVED', pointer: saved };
    }
  };
}

async function main() {
  const checks = [], sizes = [];
  for (const [label, shape] of [['M', [400, 10, 10, 12]], ['LIMIT', [500, 20, 30, 24]]]) {
    const [n, w, s, t] = shape, raw = fixture(...shape), started = performance.now(), study = Design.createStudy(raw), scenario = configuration(w), request = Joint.buildRequest(study, scenario);
    assert.equal(study.periodDemand.length, n * t);
    assert.equal(study.distanceRows.length, s * w + n * w);
    assert.equal(request.payload.demands.length, n);
    assert.equal(request.payload.outboundEdges.length, n * w);
    assert.equal(request.payload.inboundEdges.length, s * w);
    const preparationMs = performance.now() - started;
    const baseline = Design.evaluatePortfolio(study, { type: 'OBSERVED_BASELINE', distanceBasis: 'VERIFIED_ROAD' });
    const vector = { status: 'FEASIBLE', facilityCount: w, selectedSiteIds: Array.from({ length: w }, (_, i) => `W${i}`), assignments: Array.from({ length: n }, (_, i) => ({ demandId: `D${i}`, siteId: `W${i % w}` })), sourceFlows: raw.observedInbound.map(row => ({ supplierId: row.fromNodeId, siteId: row.toNodeId, period: row.period, quantity: row.quantity })), objectiveValue: n * t * 30, verifiedObjectiveValue: n * t * 30, solveTimeMs: 0, quantityScale: request.payload.quantityScale || 1000, quantityPrecision: 1 / (request.payload.quantityScale || 1000), coefficientPrecision: .01, bestBound: null, relativeGap: null, objectiveRoundingBound: 0, variableCount: 0, constraintCount: 0 };
    const candidate = Results.fromVerified(study, scenario, request, vector, 1), snapshot = await Results.createSnapshotAsync([study, baseline, scenario, candidate, [candidate], [], request]);
    assert.equal(candidate.outbound.length, n * t);
    assert.equal(candidate.inbound.length, w * t);
    assert.equal(candidate.metrics.totalVolumeKm, n * t * 30);
    assert.equal(candidate.outbound.reduce((sum, row) => sum + row.quantity, 0), n * t);
    assert.equal(candidate.inbound.reduce((sum, row) => sum + row.quantity, 0), n * t);
    const html = Results.toHtml(study, snapshot), json = Results.toJson(study, snapshot), csv = Results.toCsv(study, snapshot);
    assert.equal(JSON.parse(json).rows[0].outbound.length, n * t);
    assert.equal(csv.trim().split('\n').length, 1 + 3 * (n * t + w * t));
    assert.ok(Buffer.byteLength(html) < Buffer.byteLength(json));
    assert.equal(Results.toHtml(study, snapshot), html);
    sizes.push({ label, shape, periodRows: study.periodDemand.length, matrixRows: study.distanceRows.length, preparationMs, totalVolumeKm: candidate.metrics.totalVolumeKm, htmlBytes: Buffer.byteLength(html), jsonBytes: Buffer.byteLength(json), csvBytes: Buffer.byteLength(csv), csvDataRows: csv.trim().split('\n').length - 1 });
    checks.push(`${label}_COMPLETE_PREPARATION_SNAPSHOT_EXPORT`);
  }
  const limit = fixture(500, 20, 30, 24);
  assert.throws(() => Design.createStudy({ ...limit, periodDemand: [...limit.periodDemand, { ...limit.periodDemand[0], demandId: 'OVER_LIMIT' }] }), { code: 'NETWORK_ARRAY_LIMIT' });
  assert.throws(() => Design.createStudy({ ...limit, distanceRows: [...limit.distanceRows, { ...limit.distanceRows[0] }] }), { code: 'NETWORK_ARRAY_LIMIT' });
  checks.push('PERIOD_AND_MATRIX_OVER_LIMIT_PRECHECK');
  const counts = () => process.getActiveResourcesInfo().filter(name => name === 'Timeout' || name === 'MessagePort');
  const resourcesBefore = counts(), heaps = [];
  for (let cycle = 0; cycle < 20; cycle++) {
    const repo = memoryRepository(), controller = Controller.createController({ repository: repo }), raw = fixture(8, 2, 2, 2);
    controller.loadStudy(raw); const draft = await controller.save();
    controller.calculateBaseline('VERIFIED_ROAD');
    controller.configureScenario({ ...configuration(2), analysisScope: 'OUTBOUND_ONLY', selectedSiteIds: ['W0', 'W1'] });
    controller.evaluateConfigured(Array.from({ length: 8 }, (_, i) => ({ demandId: `D${i}`, siteId: `W${i % 2}` })));
    await controller.compareAsync();
    const expected = controller.viewState().snapshot.snapshotHash, saved = await controller.save(), packet = controller.exportPackage();
    assert.equal(JSON.parse(controller.exportReport('json')).snapshot.snapshotHash, expected);
    for (const format of ['html', 'csv', 'md']) assert.ok(controller.exportReport(format).length > 0);
    const reopened = Controller.createController({ repository: repo });
    await reopened.reopen(saved.pointer.id);
    assert.equal(reopened.viewState().snapshot.snapshotHash, expected);
    reopened.importPackage(packet);
    assert.equal(reopened.viewState().snapshot.snapshotHash, expected);
    controller.updateStudy({ name: `Changed draft ${cycle}` });
    const retained = controller.viewState().study.inputHash;
    repo.failQuota = true;
    await assert.rejects(controller.save(), { name: 'QuotaExceededError' });
    assert.equal(controller.viewState().study.inputHash, retained);
    assert.equal(controller.viewState().status, 'STUDY_READY');
    assert.equal((await repo.read('pointers', draft.pointer.id)).snapshotHash, expected);
    repo.rows.clear();
    if (global.gc) global.gc();
    heaps.push(process.memoryUsage().heapUsed);
  }
  assert.deepEqual(counts(), resourcesBefore);
  const heapGrowthBytes = heaps.at(-1) - heaps[0];
  if (global.gc) assert.ok(heapGrowthBytes < 16 * 1024 * 1024, `Lifecycle retained heap grew ${heapGrowthBytes} bytes`);
  checks.push('20_OPEN_EVALUATE_SNAPSHOT_SAVE_REOPEN_EXPORT_CYCLES', '20_QUOTA_FAILURES_RETAIN_CHANGED_DRAFT', 'NODE_TIMEOUT_MESSAGEPORT_RESOURCES_RELEASED');
  console.log(JSON.stringify({ suite: 'SUPPLY_CHAIN_V7_PERFORMANCE', status: 'PASS', method: 'SYNTHETIC_MODULE_EVALUATION_AND_DETERMINISTIC_PROJECTION_NOT_SOLVER_NOT_BROWSER', checks, sizes, cycles: 20, heapSamples: heaps, heapGrowthBytes, explicitGc: Boolean(global.gc), nodeResourcesBefore: resourcesBefore, nodeResourcesAfter: counts(), workerAndObjectUrl: 'Browser-specific checks executed separately' }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { fixture, configuration };
