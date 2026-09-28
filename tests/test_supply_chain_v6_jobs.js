'use strict';
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Design = require('../supply-chain-design-v19.js');
const Joint = require('../supply-chain-joint-v19.js');

const root = path.resolve(__dirname, '..');
const freePort = () => new Promise((resolve, reject) => { const socket = net.createServer(); socket.once('error', reject); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const period = '2026-01';
const sites = Array.from({ length: 8 }, (_, i) => ({ nodeId: `W${i}`, name: `Warehouse ${i}`, role: 'DC' }));
const suppliers = Array.from({ length: 5 }, (_, i) => ({ nodeId: `S${i}`, name: `Supplier ${i}`, role: 'SUPPLIER' }));
const customers = Array.from({ length: 180 }, (_, i) => ({ nodeId: `C${i}`, name: `Customer ${i}`, role: 'CUSTOMER' }));
const distance = (fromNodeId, toNodeId, distanceKm) => ({ fromNodeId, toNodeId, distanceKm, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_JOB_TEST' });
const study = Design.createStudy({ studyId: 'V6-JOB-SYNTHETIC', nodes: [...suppliers, ...sites, ...customers], periodDemand: customers.map((row, i) => ({ demandId: `D${i}`, customerNodeId: row.nodeId, currentSiteId: `W${i % 8}`, period, quantity: 1, unit: 'm3' })), distanceRows: [...suppliers.flatMap((source, i) => sites.map((site, j) => distance(source.nodeId, site.nodeId, 1 + (i + j) % 5))), ...sites.flatMap((site, j) => customers.map((customer, i) => distance(site.nodeId, customer.nodeId, 1 + (j * 13 + i * 7) % 23)))], costApplicability: { inventoryHolding: 'NOT_APPLICABLE', transferTransport: 'NOT_APPLICABLE' } });
const scenario = { scenarioId: 'V6-JOB', analysisScope: 'FULL_CHAIN', type: 'NETWORK_CANDIDATE', objective: 'VOLUME_KM', distanceBasis: 'VERIFIED_ROAD', facilityCounts: [2, 3, 4, 5, 6, 7], sourceMode: 'FREE', supplierTotalMode: 'ADJUSTABLE', capacityPolicy: 'UNBOUNDED_SCREENING', homogeneousDemandConfirmed: true, allowAllSupplierSiteEdgesConfirmed: true, timeLimitSeconds: 30, maxCandidates: 8 };
(async () => {
  const port = await freePort(), base = `http://127.0.0.1:${port}`;
  const service = spawn('python3', ['optimizer/ortools_service.py'], { cwd: root, env: { ...process.env, OPT_PORT: String(port) }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 100; i++) { if (service.exitCode !== null) throw new Error('isolated optimizer exited'); try { if ((await fetch(`${base}/health`)).ok) break; } catch (_) {} await pause(100); if (i === 99) throw new Error('isolated optimizer unavailable'); }
    const foreign = await fetch(`${base}/health`, { headers: { Origin: 'https://untrusted.example' } }); assert.equal(foreign.status, 403); assert.equal(foreign.headers.get('access-control-allow-origin'), null);
    const local = await fetch(`${base}/health`, { headers: { Origin: 'http://127.0.0.1:19095' } }); assert.equal(local.status, 200); assert.equal(local.headers.get('access-control-allow-origin'), 'http://127.0.0.1:19095');
    const request = Joint.buildRequest(study, scenario);
    const spec = { schemaVersion: 'stct-supply-chain-run-v6', studyHash: study.inputHash, scenarioHash: Design.hash(scenario), modelVersion: 'v6-cp-sat-1', budgetSeconds: 30, runSpecHash: Design.hash({ studyHash: study.inputHash, scenarioHash: Design.hash(scenario), budgetSeconds: 30 }), requests: [{ kind: 'JOINT', phase: 'CANDIDATES', payload: request.payload }] };
    const post = body => fetch(`${base}/supply-chain-jobs-v6`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const first = await post(spec), job = await first.json(); assert.equal(first.status, 202);
    const duplicate = await post(spec); assert.equal((await duplicate.json()).jobId, job.jobId);
    const busy = await post({ ...spec, budgetSeconds: 29, runSpecHash: Design.hash('different') }); assert.equal(busy.status, 429);
    let live = job;
    for (let i = 0; i < 100; i++) { live = await (await fetch(`${base}/supply-chain-jobs-v6/${job.jobId}`)).json(); if (live.pid && live.status === 'SOLVING') break; await pause(20); }
    assert.ok(live.pid, 'worker subprocess must exist before cancellation');
    const before = Date.now(), stopped = await fetch(`${base}/supply-chain-jobs-v6/${job.jobId}/cancel`, { method: 'POST' }), cancelled = await stopped.json();
    const cancelMs = Date.now() - before;
    assert.equal(cancelled.status, 'CANCELLED'); assert.ok(Date.now() - before < 5000);
    for (let i = 0; i < 100; i++) { try { process.kill(live.pid, 0); await pause(20); } catch (error) { if (error.code === 'ESRCH') break; throw error; } if (i === 99) throw new Error('orphan worker process'); }
    const bounded = { ...spec, budgetSeconds: 1, runSpecHash: Design.hash('one-second-budget') };
    const boundedStart = Date.now(), budgetResponse = await post(bounded), budgetJob = await budgetResponse.json(); assert.equal(budgetResponse.status, 202);
    let budgetFinal;
    for (let i = 0; i < 250; i++) { budgetFinal = await (await fetch(`${base}/supply-chain-jobs-v6/${budgetJob.jobId}`)).json(); if (['COMPLETE', 'PARTIAL', 'FAILED'].includes(budgetFinal.status)) break; await pause(20); }
    assert.ok(['COMPLETE', 'PARTIAL'].includes(budgetFinal.status), JSON.stringify(budgetFinal.error));
    assert.ok(Date.now() - boundedStart < 5000, 'whole run exceeded one-second budget plus documented cleanup');
    assert.equal((await (await fetch(`${base}/health`)).json()).available, true);
    console.log(JSON.stringify({ suite: 'SUPPLY_CHAIN_V6_JOBS', status: 'PASS', deduped: true, globalConcurrency: 1, cancelledPid: live.pid, cancelMs, oneSecondStatus: budgetFinal.status, oneSecondWallMs: Date.now() - boundedStart, serviceHealthy: true }));
  } finally { if (service.exitCode === null) service.kill('SIGTERM'); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
