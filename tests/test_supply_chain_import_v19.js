'use strict';

const assert = require('node:assert/strict');
const XLSX = require('../vendor/xlsx/xlsx.full.min.js');
const Import = require('../supply-chain-import-v19.js');
const Design = require('../supply-chain-design-v19.js');
const Report = require('../supply-chain-report-v19.js');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const book = XLSX.utils.book_new();
const nodeSheet = XLSX.utils.aoa_to_sheet([
  ['Network sources'],
  ['ID', 'Name', 'Address', 'Coordinate'],
  [1, 'Harbor', 'North address', ''],
  [],
  ['Network destinations'],
  ['ID', 'Name', 'Address', 'Coordinate'],
  [1, 'Harbor', 'South address', '103.2, 31.4'],
]);
nodeSheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
XLSX.utils.book_append_sheet(book, nodeSheet, 'Nodes');
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
  ['Monthly demand'],
  ['ID', 'Customer', 'Address', 'Site', 'Jan', 'Jan', 'Feb', 'Feb'],
  [1, 'First', 'Shared address', 'DC:Harbor', 4, 2.5, 7, 3.5],
  [2, 'Second', 'Shared address', 'DC:Harbor', 0, 1, 0, 1],
  [3, '', '', 'DC:Harbor', '', '', '', ''],
]), 'Demand');
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
  ['Inbound'],
  ['ID', 'Source', 'Destination', 'Jan', 'Jan', 'Feb', 'Feb'],
  [1, 'Harbor', 'Harbor', 3, 6, 4, 8],
]), 'Inbound');

const workbook = Import.inspectWorkbook(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), 'synthetic-network.xlsx');
const profile = {
  profileId: 'SYNTHETIC_LAYOUT_B',
  blocks: [
    { sheet: 'Nodes', kind: 'NODE', startRow: 3, endRow: 3, headerRows: [2], fields: { nodeId: { column: 2, prefix: 'SUPPLIER:' }, name: 2, address: 3, coordinate: 4 }, constants: { role: 'SUPPLIER' }, requiredFields: ['name'] },
    { sheet: 'Nodes', kind: 'NODE', startRow: 7, endRow: 7, headerRows: [6], fields: { nodeId: { column: 2, prefix: 'DC:' }, name: 2, address: 3, coordinate: 4 }, constants: { role: 'DC', coordinateSystem: 'UNCONFIRMED' } },
    { sheet: 'Demand', kind: 'PERIOD_DEMAND', startRow: 3, endRow: 5, headerRows: [2], fields: { demandId: { column: 1, prefix: 'D:' }, customerNodeId: { column: 1, prefix: 'C:' }, customerName: 2, customerAddress: 3, currentSiteId: 4 }, requiredFields: ['customerName'], primaryMeasure: 'volume', periodColumns: [
      { column: 5, period: '2026-01', measure: 'boxes', unit: 'box' },
      { column: 6, period: '2026-01', measure: 'volume', unit: 'm3' },
      { column: 7, period: '2026-02', measure: 'boxes', unit: 'box' },
      { column: 8, period: '2026-02', measure: 'volume', unit: 'm3' },
    ] },
    { sheet: 'Inbound', kind: 'OBSERVED_INBOUND', startRow: 3, endRow: 3, fields: { flowId: { column: 1, prefix: 'I:' }, fromNodeId: { column: 2, map: { Harbor: 'SUPPLIER:Harbor' }, prefix: 'IGNORED:' }, toNodeId: { constant: 'DC:Harbor' } }, primaryMeasure: 'volume', periodColumns: [
      { column: 4, period: '2026-01', measure: 'boxes', unit: 'box' },
      { column: 5, period: '2026-01', measure: 'volume', unit: 'm3' },
      { column: 6, period: '2026-02', measure: 'boxes', unit: 'box' },
      { column: 7, period: '2026-02', measure: 'volume', unit: 'm3' },
    ] },
  ],
};

const result = Import.applyProfile(workbook, profile);
assert.equal(workbook.sheets[0].merges.length, 1);
assert.equal(workbook.sheets[1].rows[1].values[4], 'Jan');
assert.equal(workbook.sheets[1].rows[1].values[5], 'Jan');
assert.equal(result.summary.demandBusinessRows, 2);
assert.equal(result.summary.inboundBusinessRows, 1);
assert.equal(result.summary.periodDemandRecords, 4);
assert.equal(result.summary.observedInboundRecords, 2);
assert.equal(result.summary.observedAssignmentRecords, 2);
assert.equal(result.summary.periodDemandTotals.m3, 8);
assert.equal(result.summary.observedInboundTotals.m3, 14);
assert.equal(result.nodes.filter(node => node.name === 'Harbor').length, 2);
assert.equal(result.nodes.find(node => node.nodeId === 'SUPPLIER:Harbor').coordinate, null);
assert.equal(result.nodes.find(node => node.nodeId === 'DC:Harbor').coordinateSystem, 'UNCONFIRMED');
assert.equal(result.nodes.filter(node => node.address === 'Shared address').length, 2);
assert.equal(result.periodDemand.find(row => row.demandId === 'D:2' && row.period === '2026-01').measures.boxes.quantity, 0);
assert.equal(result.periodDemand.find(row => row.demandId === 'D:1' && row.period === '2026-02').currentSiteId, 'DC:Harbor');
assert.equal(result.observedInbound[0].fromNodeId, 'SUPPLIER:Harbor');
assert.ok(result.excludedRows.some(row => row.sheet === 'Demand' && row.rowNumber === 5 && row.reasonCode === 'REQUIRED_FIELD_MISSING'));
assert.equal(result.sourceRows.length, 6);
assert.ok(result.sourceRows.some(row => row.sheet === 'Demand' && row.rowNumber === 5));
assert.deepEqual(result.periodDemand[0].source.rawValues.slice(0, 8), [1, 'First', 'Shared address', 'DC:Harbor', 4, 2.5, 7, 3.5]);

const badBook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(badBook, XLSX.utils.aoa_to_sheet([['ID', 'Customer', 'Amount'], [1, 'Bad', 'not-a-number']]), 'Bad');
const badWorkbook = Import.inspectWorkbook(XLSX.write(badBook, { type: 'buffer', bookType: 'xlsx' }), 'bad.xlsx');
assert.throws(() => Import.applyProfile(badWorkbook, { blocks: [{ sheet: 'Bad', kind: 'PERIOD_DEMAND', startRow: 2, endRow: 2, fields: { demandId: 1, customerName: 2 }, primaryMeasure: 'volume', periodColumns: [{ column: 3, period: '2026-01', measure: 'volume', unit: 'm3' }] }] }), error => error.code === 'SC_IMPORT_QUANTITY_INVALID' && error.detail.rowNumber === 2);

const csv = new TextEncoder().encode('ID,Customer,Jan\n1,Another,5\n');
const csvWorkbook = Import.inspectWorkbook(csv, 'different-layout.csv');
assert.equal(csvWorkbook.sheets.length, 1);
assert.equal(csvWorkbook.sheets[0].rows[1].values[2], '5');
const csvResult = Import.applyProfile(csvWorkbook, { blocks: [{ sheet: 'different-layout.csv', kind: 'PERIOD_DEMAND', startRow: 2, endRow: 2, fields: { demandId: { column: 1, prefix: 'CSV:' }, customerName: 2 }, primaryMeasure: 'volume', periodColumns: [{ column: 3, period: '2026-01', measure: 'volume', unit: 'm3' }] }] });
assert.equal(csvResult.periodDemand[0].quantity, 5);

// The alternate spreadsheet layout enters the same model, solver and report path.
const dcId = 'DC:Harbor';
const sourceId = 'SUPPLIER:Harbor';
const customerIds = [...new Set(result.periodDemand.map(row => row.customerNodeId))];
const road = (fromNodeId, toNodeId, distanceKm) => ({ fromNodeId, toNodeId, distanceKm, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_MATRIX' });
const study = Design.createStudy({
  ...result,
  studyId: 'SYNTHETIC-ALTERNATE-LAYOUT',
  classification: 'SYNTHETIC_TEST',
  costApplicability: { inventoryHolding: 'NOT_APPLICABLE', transferTransport: 'NOT_APPLICABLE' },
  nodes: result.nodes.map(node => node.nodeId === dcId ? { ...node, capacityByPeriod: { '2026-01': 20, '2026-02': 20 } } : node),
  distanceRows: [road(sourceId, dcId, 3), ...customerIds.map((customerId, index) => road(dcId, customerId, 6 + index * 3))],
  rates: [
    { kind: 'INBOUND_TRANSPORT', status: 'KNOWN', basis: 'PER_UNIT_KM', amount: 1 },
    { kind: 'OUTBOUND_TRANSPORT', status: 'KNOWN', basis: 'PER_UNIT_KM', amount: 1 },
    { kind: 'FIXED_OPERATING', status: 'CONFIRMED_ZERO', basis: 'PER_PERIOD', amount: 0 },
    { kind: 'HANDLING', status: 'CONFIRMED_ZERO', basis: 'PER_UNIT', amount: 0 },
  ],
});
const baseline = Design.evaluatePortfolio(study, { type: 'OBSERVED_BASELINE', distanceBasis: 'VERIFIED_ROAD' });
assert.equal(baseline.status, 'EVALUATED');
assert.equal(baseline.metrics.inbound.totalVolume, 14);
assert.equal(baseline.metrics.outbound.totalVolume, 8);
const scenario = { scenarioId: 'ALT-LAYOUT', type: 'NETWORK_CANDIDATE', objective: 'COST', distanceBasis: 'VERIFIED_ROAD', facilityCounts: [1], sourcePlan: [{ sourceNodeId: sourceId, siteNodeId: dcId, share: 1 }], oneTimeConversionCost: 0 };
const request = Design.solverRequest(study, scenario);
const solveScript = 'import json,sys,ortools\nfrom ortools.sat.python import cp_model\nfrom facility_mvp1 import solve_facility\nprint(json.dumps(solve_facility(json.load(sys.stdin),cp_model,ortools.__version__)))';
const solved = spawnSync('python3', ['-c', solveScript], { cwd: path.join(__dirname, '../optimizer'), input: JSON.stringify(request.payload), encoding: 'utf8' });
assert.equal(solved.status, 0, solved.stderr);
const candidates = Design.candidateResults(study, scenario, JSON.parse(solved.stdout));
assert.equal(candidates.length, 1);
assert.equal(candidates[0].status, 'EVALUATED');
const snapshot = Report.createSnapshot(study, baseline, candidates);
assert.equal(snapshot.rows.length, 1);
assert.ok(Report.toHtml(study, snapshot).includes('Supply Chain Design Study'));
assert.ok(Report.toCsv(study, snapshot).includes('SYNTHETIC_MATRIX'));
assert.ok(Report.toMarkdown(study, snapshot).includes('ALT-LAYOUT-1'));

console.log(JSON.stringify({ status: 'PASS', checks: 35, synthetic: result.summary, csvSheet: csvWorkbook.sheets[0].name, solverCandidates: candidates.length, reportHash: snapshot.snapshotHash }));
