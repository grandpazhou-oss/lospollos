'use strict';
const assert = require('node:assert/strict');
const XLSX = require('../vendor/xlsx/xlsx.full.min.js');
const Import = require('../supply-chain-import-v19.js');
const View = require('../supply-chain-view-v19.js');
function workbook(name, tables) {
  const book = XLSX.utils.book_new();
  for (const table of tables) {
    const sheet = XLSX.utils.aoa_to_sheet(table.rows);
    Object.assign(sheet, table.cells || {});
    XLSX.utils.book_append_sheet(book, sheet, table.name);
  }
  return Import.inspectWorkbook(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), name);
}
const wideHeaders = ['id', 'name', '2026-01', '2026-02'];
const wide = workbook('SYNTHETIC-Ledger-Wide.xlsx', [
  { name: 'Demand', rows: [wideHeaders, ['OK', 'Included', 1.25, 2.75], ['EX', 'Excluded', .5, 1.5], ['BAD', 'Invalid', 'bad', 4], ['FORMULA', 'No cache', null, 2], wideHeaders, ['ZERO', 'Zero', 0, 0], ['', '', '', ''], ['CACHE', 'Saved result', 2, 3]], cells: { C5: { t: 'n', f: '2+3' }, C9: { t: 'n', f: '999+999', v: 2 } } },
  { name: 'Inbound', rows: [['flow', 'from', 'to', '2026-01'], ['F', 'P', 'W', 99]] }
]);
const wideProfile = { profileId: 'LEDGER-WIDE', blocks: [
  { sheet: 'Demand', kind: 'PERIOD_DEMAND', startRow: 2, endRow: 9, headerRows: [1], fields: { demandId: 1, customerName: 2 }, requiredFields: ['demandId', 'customerName'], primaryMeasure: 'quantity', periodColumns: [{ column: 3, period: '2026-01', unit: 'm3' }, { column: 4, period: '2026-02', unit: 'm3' }], excludeRows: [{ rowNumber: 3, reasonCode: 'TEST_REVIEWED_EXCLUSION' }] },
  { sheet: 'Inbound', kind: 'OBSERVED_INBOUND', startRow: 2, endRow: 2, headerRows: [1], fields: { flowId: 1, fromNodeId: 2, toNodeId: 3 }, primaryMeasure: 'quantity', periodColumns: [{ column: 4, period: '2026-01', unit: 'm3' }] }
] };
const wideImport = Import.applyProfile(wide, wideProfile, { tolerant: true });
const original = JSON.stringify([wide, wideProfile, wideImport]);
const ledger = View.projectImportQuantityLedger(wide, wideProfile, wideImport);
const group = (result, kind, period, unit) => result.groups.find(row => row.kind === kind && row.period === period && row.unit === unit);
assert.deepEqual(group(ledger, 'PERIOD_DEMAND', '2026-01', 'm3'), { kind: 'PERIOD_DEMAND', period: '2026-01', unit: 'm3', raw: 3.75, included: 3.25, excluded: .5, unassigned: 0 });
assert.deepEqual(group(ledger, 'PERIOD_DEMAND', '2026-02', 'm3'), { kind: 'PERIOD_DEMAND', period: '2026-02', unit: 'm3', raw: 13.25, included: 5.75, excluded: 7.5, unassigned: 0 });
assert.equal(group(ledger, 'OBSERVED_INBOUND', '2026-01', 'm3').raw, 99, 'Inbound is not added to outbound demand');
assert.equal(ledger.unquantifiableRecords, 2);
assert.equal(ledger.unquantifiableCells, 2);
assert.equal(ledger.ignoredNonBusinessRows, 2, 'Repeated heading and empty row are not business quantities');
assert.equal(ledger.unassignedCells, 0);
assert.deepEqual(ledger.unquantifiable.map(row => row.reason).sort(), ['FORMULA_NO_CACHE', 'QUANTITY_INVALID']);
for (const row of ledger.groups) assert.equal(row.raw, row.included + row.excluded, 'Known raw quantities reconcile without filling unknowns');
assert.ok(wideImport.excludedRows.some(row => row.reasonCode === 'TEST_REVIEWED_EXCLUSION'));
const primaryProfile = structuredClone(wideProfile);
primaryProfile.blocks[0].primaryMeasure = 'volume';
primaryProfile.blocks[0].periodColumns = [{ column: 3, period: '2026-01', measure: 'volume', unit: 'm3' }, { column: 4, period: '2026-01', measure: 'weight', unit: 't' }];
const primaryImport = Import.applyProfile(wide, primaryProfile, { tolerant: true });
const primaryLedger = View.projectImportQuantityLedger(wide, primaryProfile, primaryImport);
assert.equal(primaryLedger.groups.filter(row => row.kind === 'PERIOD_DEMAND').length, 1);
assert.equal(group(primaryLedger, 'PERIOD_DEMAND', '2026-01', 'm3').raw, 3.75, 'Only the mapped primary measure is counted');
assert.equal(primaryLedger.groups.some(row => row.unit === 't'), false, 'Secondary weight is not mixed into primary volume');
const longHeaders = ['id', 'name', 'period', 'quantity', 'unit'];
const long = workbook('SYNTHETIC-Ledger-Long.xlsx', [{ name: 'Long', rows: [longHeaders, ['OK', 'Included', '2026-01', 3, 't'], ['EX', 'Excluded', '2026-01', 7.5, 't'], ['BAD', 'Boolean', '2026-01', true, 't'], ['MISSING', 'Missing unit', '2026-01', 11, ''], ['UNKNOWN', 'Unknown unit', '2026-01', 12, 'UNKNOWN'], ['KG', 'Different unit', '2026-01', .125, 'kg'], ['NEG', 'Negative', '2026-01', -1, 't'], ['BLANK', 'Missing quantity', '2026-01', '', 't'], longHeaders, ['ZERO', 'Explicit zero', '2026-01', 0, 't']] }]);
const longProfile = { profileId: 'LEDGER-LONG', blocks: [{ sheet: 'Long', kind: 'PERIOD_DEMAND', layout: 'LONG', startRow: 2, endRow: 11, headerRows: [1], fields: { demandId: 1, customerName: 2, period: 3, quantity: 4, unit: 5 }, requiredFields: ['demandId', 'customerName'], excludeRows: [3] }] };
const longImport = Import.applyProfile(long, longProfile, { tolerant: true });
const longBefore = JSON.stringify([long, longProfile, longImport]);
const longLedger = View.projectImportQuantityLedger(long, longProfile, longImport);
assert.deepEqual(group(longLedger, 'PERIOD_DEMAND', '2026-01', 't'), { kind: 'PERIOD_DEMAND', period: '2026-01', unit: 't', raw: 10.5, included: 3, excluded: 7.5, unassigned: 0 });
assert.equal(group(longLedger, 'PERIOD_DEMAND', '2026-01', 'kg').raw, .125, 'Different units stay separate');
assert.equal(longLedger.groups.length, 2);
assert.equal(longLedger.unquantifiableRecords, 5);
assert.equal(longLedger.unquantifiableCells, 5);
assert.equal(longLedger.ignoredNonBusinessRows, 1);
assert.equal(longLedger.unquantifiable.filter(row => row.reason === 'UNIT_UNKNOWN').length, 2);
for (const row of longLedger.groups) assert.equal(row.raw, row.included + row.excluded);
const incomplete = structuredClone(wideImport);
incomplete.excludedRows = incomplete.excludedRows.filter(row => !(row.blockIndex === 0 && row.rowNumber === 3));
const pending = View.projectImportQuantityLedger(wide, wideProfile, incomplete);
assert.equal(pending.unassignedCells, 2, 'Missing attribution is not fabricated as exclusion');
for (const row of pending.groups) assert.equal(row.raw, row.included + row.excluded + row.unassigned);
assert.equal(View.projectImportQuantityLedger(null, wideProfile, wideImport).available, false);
const fillBook = workbook('SYNTHETIC-Ledger-Carry.xlsx', [{ name: 'Long', rows: [longHeaders, ['A', 'A', '2026-01', 3, 't'], ['B', 'B', '2026-01', '', 't']] }]);
const fillProfile = structuredClone(longProfile); Object.assign(fillProfile.blocks[0], { endRow: 3, excludeRows: [] }); fillProfile.blocks[0].fields.quantity = { column: 4, fillDown: true };
const fillImport = Import.applyProfile(fillBook, fillProfile);
const fillLedger = View.projectImportQuantityLedger(fillBook, fillProfile, fillImport);
assert.equal(fillLedger.unquantifiableCells, 1, 'A blank original is not asserted as a source quantity');
assert.deepEqual(fillLedger.limitations, ['FILL_DOWN_NOT_RECONSTRUCTED']);
assert.deepEqual(fillImport.periodDemand.map(row => row.quantity), [3, 3], 'The projection never changes the applied input');
const state = { workbook: wide, profile: wideProfile, imported: wideImport };
const view = View.createView({ download() {}, renderHost() {} }); view.setController({ viewState: () => state });
const html = view.render(state, 'zh');
assert.match(html, /data-supply-quantity-ledger/);
assert.match(html, /导入数量核对账/);
assert.match(html, /data-supply-ledger-raw="3.75" data-supply-ledger-included="3.25" data-supply-ledger-excluded="0.5"/);
assert.match(html, /data-supply-ledger-unknown-records="2" data-supply-ledger-unknown-cells="2"/);
assert.match(view.render(state, 'en'), /Import quantity ledger/);
assert.match(view.render(state, 'ja'), /取込数量の照合/);
assert.equal(JSON.stringify([wide, wideProfile, wideImport]), original);
assert.equal(JSON.stringify([long, longProfile, longImport]), longBefore);
console.log(JSON.stringify({ status: 'PASS', method: 'PRODUCTION_XLSX_IMPORT_AND_PURE_VIEW_PROJECTION_NOT_BROWSER', checks: ['wide-and-long-applied-mapping', 'known-raw-equals-included-plus-excluded', 'whole-row-exclusion-known-cells', 'invalid-and-unknown-unit-not-zero', 'saved-formula-cache-not-executed', 'uncached-formula-not-zero', 'nonbusiness-heading-and-empty-row', 'business-legs-and-units-separate', 'unassigned-known-quantity-retained', 'blank-carry-limitation-explicit', 'rendered-ledger-three-locales', 'input-and-exclusion-reasons-unchanged'] }));
