'use strict';
const assert = require('node:assert/strict');
const Design = require('../supply-chain-design-v19.js');
const Report = require('../supply-chain-report-v19.js');
const Views = require('../platform-supply-views-v8.js');

const edge = (fromNodeId, toNodeId, distanceKm) => ({ fromNodeId, toNodeId, distanceKm, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST' });
const raw = {
  studyId: 'V8-PROJECTION', name: 'B <script> study', classification: 'SYNTHETIC',
  nodes: [{ nodeId: 'F', role: 'FACTORY' }, { nodeId: 'A', name: 'Site A', role: 'DC', capacityByPeriod: { P1: 100, P2: 100 } }, { nodeId: 'B', name: 'Site B', role: 'DC', capacityByPeriod: { P1: 100, P2: 100 } }, { nodeId: 'C', role: 'CUSTOMER' }],
  periodDemand: [{ demandId: 'D', customerNodeId: 'C', currentSiteId: 'A', period: 'P1', quantity: 10, unit: 'm3' }, { demandId: 'D', customerNodeId: 'C', currentSiteId: 'A', period: 'P2', quantity: 20, unit: 'm3' }],
  observedInbound: [{ flowId: 'I1', fromNodeId: 'F', toNodeId: 'A', period: 'P1', quantity: 10, unit: 'm3' }, { flowId: 'I2', fromNodeId: 'F', toNodeId: 'A', period: 'P2', quantity: 20, unit: 'm3' }],
  distanceRows: [edge('A', 'C', 10), edge('B', 'C', 5), edge('F', 'A', 2), edge('F', 'B', 30)],
  costApplicability: { inventoryHolding: 'NOT_APPLICABLE', transferTransport: 'NOT_APPLICABLE' },
  rates: [['INBOUND_TRANSPORT', 'PER_UNIT_KM', 1], ['OUTBOUND_TRANSPORT', 'PER_UNIT_KM', 1], ['FIXED_OPERATING', 'PER_PERIOD', 0], ['HANDLING', 'PER_UNIT', 0]].map(([kind, basis, amount]) => ({ kind, basis, amount, status: 'KNOWN' }))
};
const config = { type: 'NETWORK_CANDIDATE', objective: 'COST', objectiveScope: 'OUTBOUND_ONLY', facilityCounts: [1], distanceBasis: 'VERIFIED_ROAD' };
function result(study, id, site) { return Design.evaluatePortfolio(study, { ...config, scenarioId: id, selectedSiteIds: [site], sourcePlan: [{ sourceNodeId: 'F', siteNodeId: site, share: 1 }] }, [{ demandId: 'D', siteNodeId: site }]); }
const study = Design.createStudy(raw);
const baseline = Design.evaluatePortfolio(study, { type: 'OBSERVED_BASELINE', distanceBasis: 'VERIFIED_ROAD' });
const snapshot = Report.createSnapshot(study, baseline, [result(study, 'COSTLY-B', 'B')], [], config);
assert.equal(snapshot.decision.kind, 'KEEP_REFERENCE');
const state = { study, scenario: config, status: 'SNAPSHOT_READY', snapshot, staleResult: null };

for (const locale of ['zh', 'en', 'ja']) {
  for (const route of Views.ROUTES) {
    const html = Views.render(state, route, locale);
    assert.match(html, /data-v8-current-study="SUPPLY_CHAIN_STUDY"/);
    assert.ok(html.includes(`data-study-id="${study.studyId}"`));
    assert.ok(html.includes(`data-input-hash="${study.inputHash}"`));
    assert.match(html, /B &lt;script&gt; study/);
    assert.doesNotMatch(html, /<script>/);
  }
}
const cost = Views.render(state, '/design/cost-to-serve');
assert.match(cost, new RegExp(`data-v8-cost-amount="reference" data-value="${baseline.metrics.steadyStateCost}"`));
assert.match(cost, new RegExp(`data-v8-cost-amount="candidate" data-value="${snapshot.rows[0].result.metrics.steadyStateCost}"`));
assert.match(cost, /COSTLY-B/);
assert.doesNotMatch(cost, /实际节省率/);
const demand = Views.render(state, '/design/demand-growth');
assert.match(demand, /data-v8-demand-total="30"/);
assert.match(demand, /data-v8-demand-period="P1"/);
assert.match(demand, /data-v8-demand-period="P2"/);
assert.match(demand, /data-design-action="supply-demand-10"/);
assert.match(demand, /不是派车订单/);
const network = Views.render(state, '/design/network-scenarios');
assert.match(network, /COSTLY-B/);
assert.match(network, /可比运营成本/);
assert.equal(snapshot.decision.rankingMetric, 'COMPARABLE_OPERATING_COST');
assert.match(Views.render(state, '/design/network-scenarios', 'en'), /Comparable operating cost/);
assert.match(Views.render(state, '/design/network-scenarios', 'ja'), /比較可能な運営費/);
assert.throws(() => Views.render({ ...state, snapshot: { ...snapshot, decision: { ...snapshot.decision, rankedScenarioIds: ['COSTLY-B', 'COSTLY-B'] } } }, '/design/network-scenarios'), { code: 'SUPPLY_RANKING_ID_CONFLICT' });

const noRates = Design.createStudy({ ...raw, studyId: 'V8-NO-RATES', rates: [] });
const noRatesBaseline = Design.evaluatePortfolio(noRates, { type: 'OBSERVED_BASELINE', distanceBasis: 'VERIFIED_ROAD' });
const noRatesSnapshot = Report.createSnapshot(noRates, noRatesBaseline, [result(noRates, 'DISTANCE-B', 'B')], [], { ...config, objective: 'VOLUME_KM' });
const unknown = Views.render({ study: noRates, snapshot: noRatesSnapshot, status: 'SNAPSHOT_READY' }, '/design/cost-to-serve');
assert.match(unknown, /data-v8-cost-amount="reference" data-value="" data-status="UNKNOWN">未知/);
assert.match(unknown, /适用费率或费用范围尚不完整/);

const stale = Views.render({ ...state, staleResult: { reason: 'STUDY_INPUT_CHANGED' } }, '/design/cost-to-serve');
assert.match(stale, /旧结果不能作为当前结论/);
assert.match(stale, /data-v8-cost-amount="candidate" data-value="" data-status="UNKNOWN"/);

const joint = { schemaVersion: 'stct-supply-chain-v5-snapshot-v1', studyHash: study.inputHash, analysisScope: 'FULL_CHAIN', planningReference: { metrics: { operatingCost: 900, costParts: { inboundTransport: 500, outboundTransport: 400 } } }, rows: [{ scenarioId: 'JOINT-1', status: 'OPTIMAL', metrics: { operatingCost: 800, firstPeriodCost: 180, costParts: { inboundTransport: 300, outboundTransport: 500 } } }], decision: { focusScenarioId: 'JOINT-1', rankedScenarioIds: ['JOINT-1'], rankingMetric: 'COMPARABLE_OPERATING_COST', reference: 'SAME_CONDITION_PLANNING_REFERENCE' } };
const jointCost = Views.render({ study, snapshot: joint, status: 'SNAPSHOT_READY' }, '/design/cost-to-serve');
assert.match(jointCost, /同条件规划参照/);
assert.match(jointCost, /data-v8-cost-amount="reference" data-value="900"/);
assert.match(jointCost, /data-v8-cost-amount="candidate" data-value="800"/);

const upstream = { ...joint, analysisScope: 'UPSTREAM_ONLY', observedKnownInbound: { cost: 500 }, planningReference: null, rows: [{ ...joint.rows[0], metrics: { ...joint.rows[0].metrics, operatingCost: 400 } }], decision: { ...joint.decision, reference: 'OBSERVED_BASELINE' } };
const upstreamCost = Views.render({ study, snapshot: upstream, status: 'SNAPSHOT_READY' }, '/design/cost-to-serve');
assert.match(upstreamCost, /已知观察入库/);
assert.match(upstreamCost, /data-v8-cost-amount="reference" data-value="500"/);
assert.match(upstreamCost, /data-v8-cost-amount="candidate" data-value="400"/);
assert.throws(() => Views.render(state, '/command/dispatch'), { code: 'SUPPLY_VIEW_ROUTE_UNSUPPORTED' });
console.log(JSON.stringify({ suite: 'V8_SUPPLY_CROSS_PAGE_PROJECTION', status: 'PASS', scopes: ['OUTBOUND_ONLY', 'FULL_CHAIN', 'UPSTREAM_ONLY'], locales: ['zh', 'en', 'ja'], routes: Views.ROUTES.size, source: 'SYNTHETIC_RESULT_SNAPSHOT_NO_SOLVE' }));
