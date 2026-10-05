'use strict';
const assert = require('node:assert/strict');
const Design = require('../supply-chain-design-v19.js');
const Report = require('../supply-chain-report-v19.js');
const V5 = require('../supply-chain-v5-results-v19.js');
const supplierId = '=HYPERLINK("https://example.invalid")';
const siteId = '+cmd';
const study = Design.createStudy({
  studyId: 'CSV_SECURITY_SYNTHETIC',
  nodes: [{ nodeId: supplierId, role: 'SUPPLIER' }, { nodeId: siteId, role: 'DC' }, { nodeId: 'C', role: 'CUSTOMER' }],
  periodDemand: [{ demandId: 'D', customerNodeId: 'C', currentSiteId: siteId, period: 'P1', quantity: 5, unit: 'm3' }],
  observedInbound: [{ flowId: 'I', fromNodeId: supplierId, toNodeId: siteId, period: 'P1', quantity: 5, unit: 'm3', source: { fileName: '@source.csv', sheet: 'Sheet1', rowNumber: 2 } }],
  distanceRows: [
    { fromNodeId: supplierId, toNodeId: siteId, distanceKm: 1, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC' },
    { fromNodeId: siteId, toNodeId: 'C', distanceKm: 1, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC' },
  ],
});
const baseline = Design.evaluatePortfolio(study, { type: 'OBSERVED_BASELINE', distanceBasis: 'VERIFIED_ROAD' });
const generated = Report.createSnapshot(study, baseline, [], [], { type: 'NETWORK_CANDIDATE', objective: 'VOLUME_KM', objectiveScope: 'OUTBOUND_ONLY', facilityCounts: [1] });
const snapshot = structuredClone(generated);
// A forged negative ledger cost must fail independent business verification,
// even after the outer snapshot hash is recomputed.
snapshot.baseline.inbound[0].cost = -3;
snapshot.snapshotHash = Design.hash(Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== 'snapshotHash')));
assert.throws(() => Report.toCsv(study, snapshot), { code: 'SUPPLY_SNAPSHOT_VERIFICATION_FAILED' });
assert.throws(() => V5.toCsv(study, snapshot));
const csv = Report.toCsv(study, generated);
assert.match(csv, /"'=HYPERLINK/);
assert.match(csv, /"'\+cmd"/);
assert.match(csv, /"5"/);
assert.doesNotMatch(csv, /"'5"/);
console.log(JSON.stringify({ suite: 'SUPPLY_CHAIN_V6_CSV_SECURITY', status: 'PASS', formulaTextNeutralized: true, forgedNegativeLedgerRejected: true, numericQuantityPreserved: true }));
