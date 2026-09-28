'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Controller = require('../supply-chain-controller-v19.js');
const profile = require('./fixtures/supply-chain-uc-profile-v19.json');

const sourcePath = process.env.STCT_UC_XLSX || path.join(os.homedir(), 'Downloads', '经纬度追加-天津、沈阳、西安、东莞相关入、出库物量数据  202601~07-001 物量数据(1).xlsx');
const originalHash = crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'stct-uc-study-'));
const resultsDir = path.join(workspace, 'test-results');
fs.mkdirSync(resultsDir);
const copyPath = path.join(resultsDir, path.basename(sourcePath));
const checks = [];
function check(name, action) { action(); checks.push(name); }
function sum(rows) { return Math.round(rows.reduce((total, row) => total + row.quantity, 0) * 1000) / 1000; }

const python = [
  'import json,sys,ortools',
  'from ortools.sat.python import cp_model',
  'from facility_mvp1 import solve_facility',
  'print(json.dumps(solve_facility(json.load(sys.stdin),cp_model,ortools.__version__)))'
].join('\n');
const localSolve = async (_endpoint, { body }) => {
  const run = spawnSync(process.env.STCT_PYTHON || 'python3', ['-c', python], {
    cwd: path.resolve(__dirname, '../optimizer'), input: body, encoding: 'utf8',
    timeout: 120000, maxBuffer: 32 * 1024 * 1024
  });
  assert.equal(run.status, 0, (run.stderr || '').slice(0, 1200));
  return { ok: true, json: async () => JSON.parse(run.stdout) };
};

(async () => {
  try {
    fs.copyFileSync(sourcePath, copyPath);
    check('ORIGINAL_AND_COPY_HASH', () => {
      assert.equal(originalHash, profile.sourceWorkbookSha256);
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(copyPath)).digest('hex'), originalHash);
    });

    const controller = Controller.createController({ fetch: localSolve });
    controller.inspect(fs.readFileSync(copyPath), path.basename(copyPath));
    controller.applyProfile(profile, { studyId: 'UC-ACCEPTANCE-2026-01-07', name: 'UC acceptance study', classification: 'BUSINESS_PRIVATE', currency: 'CNY' });
    let state = controller.snapshot();
    check('SAME_GENERIC_STUDY_INPUT', () => {
      assert.equal(state.imported.summary.demandBusinessRows, 257);
      assert.equal(state.imported.summary.inboundBusinessRows, 12);
      assert.equal(state.study.periodDemand.length, 1799);
      assert.equal(state.study.observedInbound.length, 84);
      assert.equal(sum(state.study.periodDemand), 115934.168);
      assert.equal(sum(state.study.observedInbound), 97370.239);
      assert.equal(state.study.coordinateUse, 'UNCONFIRMED');
      assert.deepEqual(state.study.distanceRows, []);
      assert.deepEqual(state.study.rates, []);
      assert.ok(state.study.nodes.every(node => node.capacityByPeriod == null));
    });

    controller.calculateBaseline('VERIFIED_ROAD');
    state = controller.snapshot();
    check('REAL_OBSERVED_BASELINE_FROZEN', () => {
      const baseline = state.baseline;
      assert.equal(baseline.scenarioType, 'OBSERVED_BASELINE');
      assert.equal(baseline.outbound.length, 1799);
      assert.equal(baseline.inbound.length, 84);
      assert.equal(sum(baseline.outbound), 115934.168);
      assert.equal(sum(baseline.inbound), 97370.239);
      const currentByDemand = new Map(state.study.observedAssignments.map(row => [row.demandId, row.siteNodeId]));
      for (const leg of baseline.outbound) assert.equal(leg.fromNodeId, currentByDemand.get(leg.demandId));
      assert.ok(baseline.inbound.every(leg => state.study.observedInbound.some(row => row.period === leg.period && row.fromNodeId === leg.fromNodeId && row.toNodeId === leg.toNodeId && row.quantity === leg.quantity)));
    });

    check('MISSING_EVIDENCE_BLOCKS_COST_RECOMMENDATION', () => {
      const baseline = state.baseline;
      assert.equal(baseline.status, 'INCOMPLETE');
      assert.equal(baseline.metrics.outbound.weightedDistanceKm, null);
      assert.equal(baseline.metrics.inbound.weightedDistanceKm, null);
      assert.equal(baseline.metrics.steadyStateCost, null);
      assert.ok(baseline.outbound.every(row => row.distanceKm === null && row.cost === null));
      assert.ok(baseline.inbound.every(row => row.distanceKm === null && row.cost === null));
      assert.ok(baseline.capacityByPeriod.every(row => row.status === 'UNKNOWN' && row.capacity === null));
      for (const code of ['SUPPLY_DISTANCE_COVERAGE_INCOMPLETE', 'SUPPLY_COST_COVERAGE_INCOMPLETE', 'SUPPLY_CAPACITY_UNKNOWN']) assert.ok(baseline.issues.some(row => row.code === code), code);
    });

    controller.compare();
    state = controller.snapshot();
    check('INCOMPLETE_BASELINE_REPORT_CAN_EXPORT', () => {
      assert.equal(state.snapshot.recommendation, null);
      assert.equal(state.snapshot.rankingScope, 'NO_COMPLETE_COST_RANKING');
      const md = controller.exportReport('md');
      const html = controller.exportReport('html');
      assert.ok(md.includes('真实现状'));
      assert.ok(html.includes('费用未计算'));
      assert.ok(!html.includes('NO_COMPLETE_COST_RANKING'));
      assert.ok(!md.includes('全网最优') && !html.includes('全网最优'));
    });

    controller.updateStudy({ coordinateUse: 'ASSUMED_WGS84_SCREENING' });
    controller.calculateBaseline('GEOGRAPHIC_SCREENING');
    state = controller.snapshot();
    check('EXPLICIT_GEOGRAPHIC_SCREENING_ONLY', () => {
      assert.equal(state.study.coordinateUse, 'ASSUMED_WGS84_SCREENING');
      assert.equal(state.baseline.distanceBasis, 'GEOGRAPHIC_SCREENING');
      assert.ok(state.baseline.outbound.some(row => row.distanceQuality === 'GEOGRAPHIC_SCREENING'));
      assert.ok(state.baseline.outbound.every(row => row.distanceQuality === 'GEOGRAPHIC_SCREENING' || row.distanceKm === null));
      assert.equal(state.baseline.metrics.steadyStateCost, null);
      assert.ok(state.baseline.capacityByPeriod.every(row => row.status === 'UNKNOWN'));
    });

    controller.configureScenario({ scenarioId: 'UC-GEOGRAPHIC-CANDIDATES', type: 'NETWORK_CANDIDATE', objective: 'VOLUME_KM', distanceBasis: 'GEOGRAPHIC_SCREENING', facilityCounts: [1, 2, 3, 4], timeLimitSeconds: 15 });
    await controller.run();
    state = controller.snapshot();
    check('LOCAL_OR_TOOLS_CANDIDATES_ONLY', () => {
      assert.equal(state.solverRuns.length, 1);
      assert.equal(state.solverRuns[0].engine.id, 'OR_TOOLS_CP_SAT');
      assert.equal(state.solverRuns[0].objective, 'OUTBOUND_VOLUME_KM_PROXY');
      const signatures = state.candidates.map(row => [...row.selectedSiteIds].sort().join('|'));
      assert.equal(new Set(signatures).size, signatures.length);
      assert.ok(state.candidates.length > 0);
      for (const candidate of state.candidates) {
        assert.equal(candidate.solverEvidence.claim, 'CANDIDATE_SET_ONLY');
        assert.equal(candidate.distanceBasis, 'GEOGRAPHIC_SCREENING');
        assert.equal(candidate.metrics.steadyStateCost, null);
        assert.ok(candidate.capacityByPeriod.every(row => row.status === 'UNKNOWN'));
      }
    });

    controller.compare();
    state = controller.snapshot();
    check('SINGLE_RESULT_SNAPSHOT_EXPORT', () => {
      assert.equal(state.snapshot.rows.length, state.candidates.length);
      assert.equal(state.snapshot.recommendation, null);
      assert.equal(state.snapshot.rankingScope, 'NO_COMPLETE_COST_RANKING');
      assert.equal(state.snapshot.coverage.baselineDemandRecords, 1799);
      assert.equal(state.snapshot.coverage.baselineInboundRecords, 84);
      const explanation = state.snapshot.explanation;
      assert.equal(explanation.records.businessDemand, 257);
      assert.equal(explanation.records.demandPeriod, 1799);
      assert.ok(explanation.records.uniqueDeliveryAddresses <= 257);
      assert.ok(Math.abs(explanation.baselineInbound.knownVolumeKmSubtotal - 92334005.534344) < 0.01);
      assert.ok(Math.abs(explanation.baselineInbound.knownVolume - 96668.039) < 0.001);
      assert.ok(Math.abs(explanation.baselineInbound.unknownVolume - 702.2) < 0.001);
      assert.equal(explanation.baselineInbound.fullVolumeKm, null);
      const fourSites = explanation.rows.find(row => row.selectedSites.length === 4);
      assert.ok(fourSites);
      assert.ok(Math.abs(fourSites.outbound.before.weightedKm - 213.5389735747) < 0.0001);
      assert.ok(Math.abs(fourSites.outbound.after.weightedKm - 204.3504057652) < 0.0001);
      assert.equal(fourSites.affected.businessRecords, 34);
      assert.ok(Math.abs(fourSites.affected.volume - 7867.270) < 0.001);
      const xian = fourSites.siteLoads.find(row => row.name.includes('西安'));
      assert.ok(xian);
      assert.ok(Math.abs(xian.beforeTotal - 6447.765) < 0.001);
      assert.ok(Math.abs(xian.afterTotal - 14124.075) < 0.001);
      assert.equal(fourSites.capacity.unknownPeriods, 28);
      assert.ok(state.snapshot.rows.every(row => row.comparison.steadyStateImprovementRate === null));
      const outputs = ['json', 'csv', 'md', 'html'].map(format => controller.exportReport(format));
      assert.ok(outputs.every(value => value.length > 0));
      const exported = JSON.parse(outputs[0]);
      assert.equal(exported.snapshot.snapshotHash, state.snapshot.snapshotHash);
      assert.equal(exported.snapshot.coverage.baselineDemandRecords, 1799);
      assert.equal(exported.snapshot.coverage.baselineInboundRecords, 84);
      assert.ok(outputs[2].includes('NO_COMPLETE_COST_RANKING') && !outputs[2].includes('全网最优'));
      assert.equal((outputs[3].match(/<section class="page">/g) || []).length, 4);
      assert.ok(!outputs[3].includes('<th>运输段</th>') && !outputs[3].includes('NO_COMPLETE_COST_RANKING'));
      const packageText = controller.exportPackage();
      const reopened = Controller.createController({ fetch: localSolve });
      reopened.importPackage(packageText);
      assert.equal(reopened.snapshot().snapshot.snapshotHash, state.snapshot.snapshotHash);
    });

    check('ORIGINAL_UNCHANGED', () => assert.equal(crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex'), originalHash));
    const feasible = state.solverRuns[0].results.filter(row => ['OPTIMAL', 'FEASIBLE'].includes(row.status)).length;
    console.log(JSON.stringify({ suite: 'SUPPLY_CHAIN_UC_STUDY_V19', status: 'PASS', checks, evidence: { originalSha256: originalHash, demandBusinessRows: 257, inboundBusinessRows: 12, demandPeriodRecords: 1799, inboundPeriodRecords: 84, outboundM3: 115934.168, inboundM3: 97370.239, distanceBasis: 'GEOGRAPHIC_SCREENING', coordinateAssumption: 'ASSUMED_WGS84_SCREENING', solverEngine: state.solverRuns[0].engine.id, objective: state.solverRuns[0].objective, solverFeasibleRows: feasible, distinctCandidates: state.candidates.length, candidateTargetReached: state.candidates.length >= 5, recommendation: state.snapshot.recommendation, rankingScope: state.snapshot.rankingScope, exportFormats: ['json', 'csv', 'md', 'html'], reopenHashMatched: true } }, null, 2));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
