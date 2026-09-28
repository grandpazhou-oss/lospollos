'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('../vendor/xlsx/xlsx.full.min.js');
const Import = require('../supply-chain-import-v19.js');
const profile = require('./fixtures/supply-chain-uc-profile-v19.json');

const sourcePath = process.env.STCT_UC_XLSX || path.join(os.homedir(), 'Downloads', '经纬度追加-天津、沈阳、西安、东莞相关入、出库物量数据  202601~07-001 物量数据(1).xlsx');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const rounded = value => Math.round(value * 1000) / 1000;
const sum = rows => rounded(rows.reduce((total, row) => total + Number(row.quantity), 0));
const measureSum = (rows, key) => rows.reduce((total, row) => total + Number(row.measures?.[key]?.quantity || 0), 0);
const checks = [];
function check(name, fn) { fn(); checks.push(name); }

if (!fs.existsSync(sourcePath)) throw new Error(`UC acceptance workbook missing; set STCT_UC_XLSX: ${sourcePath}`);
const originalHash = sha256(fs.readFileSync(sourcePath));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'stct-uc-acceptance-'));
const resultsDir = path.join(temporary, 'test-results');
fs.mkdirSync(resultsDir);
const copyPath = path.join(resultsDir, path.basename(sourcePath));

try {
  fs.copyFileSync(sourcePath, copyPath);
  check('SOURCE_COPY_INTEGRITY', () => {
    assert.equal(originalHash, profile.sourceWorkbookSha256);
    assert.equal(sha256(fs.readFileSync(copyPath)), originalHash);
  });

  const workbook = Import.inspectWorkbook(fs.readFileSync(copyPath), path.basename(copyPath));
  const imported = Import.applyProfile(workbook, profile);
  const rawWorkbook = XLSX.read(fs.readFileSync(copyPath), { type: 'buffer' });
  const demands = imported.periodDemand;
  const inbound = imported.observedInbound;

  check('INDEPENDENT_SOURCE_RECONCILIATION', () => {
    const cell = (sheet, row, column) => Number(rawWorkbook.Sheets[sheet][XLSX.utils.encode_cell({ r: row - 1, c: column - 1 })]?.v || 0);
    const outboundRanges = [['③天津销售出库', 4, 161], ['④西安销售出库', 4, 41], ['⑤沈阳销售出库', 4, 47], ['⑥东莞销售出库', 4, 20]];
    const rawOutbound = outboundRanges.flatMap(([sheet, first, last]) => Array.from({ length: last - first + 1 }, (_, index) => ({ sheet, row: first + index })));
    const rawInbound = Array.from({ length: 12 }, (_, index) => index + 4);
    assert.equal(rawOutbound.length, 257);
    assert.equal(new Set(rawOutbound.map(({ sheet, row }) => String(rawWorkbook.Sheets[sheet][XLSX.utils.encode_cell({ r: row - 1, c: 3 })]?.v).trim())).size, 248);
    assert.equal(rounded(rawOutbound.reduce((total, { sheet, row }) => total + cell(sheet, row, 7), 0)), sum(demands));
    assert.equal(rounded(rawInbound.reduce((total, row) => total + cell('②外部入库数据', row, 5), 0)), sum(inbound));
    for (let month = 0; month < 7; month++) {
      const period = `2026-${String(month + 1).padStart(2, '0')}`;
      const outboundMonth = rounded(rawOutbound.reduce((total, { sheet, row }) => total + cell(sheet, row, 11 + month * 2), 0));
      const inboundMonth = rounded(rawInbound.reduce((total, row) => total + cell('②外部入库数据', row, 9 + month * 2), 0));
      assert.equal(sum(demands.filter(row => row.period === period)), outboundMonth);
      assert.equal(sum(inbound.filter(row => row.period === period)), inboundMonth);
    }
  });

  check('RECORD_AND_PERIOD_CONSERVATION', () => {
    assert.equal(new Set(demands.map(row => row.demandId)).size, 257);
    assert.equal(demands.length, 257 * 7);
    assert.equal(new Set(inbound.map(row => row.flowId)).size, 12);
    assert.equal(inbound.length, 12 * 7);
    assert.deepEqual([...new Set(demands.map(row => row.period))].sort(), ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']);
    assert.deepEqual([...new Set(inbound.map(row => row.period))].sort(), ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']);
    assert.equal(imported.observedAssignments.length, 257);
  });

  check('VOLUME_AND_BOX_CONTROLS', () => {
    assert.equal(sum(demands), 115934.168);
    assert.equal(sum(inbound), 97370.239);
    assert.equal(measureSum(demands, 'boxes'), 3926659);
    assert.equal(measureSum(inbound, 'boxes'), 3169701);
    assert.equal(demands.filter(row => row.quantity > 0).length, 1423);
    assert.equal(rounded(inbound.filter(row => row.fromNodeId === 'UC:EXTERNAL:外协加工').reduce((total, row) => total + row.quantity, 0)), 702.2);
  });

  check('OBSERVED_ASSIGNMENT_AND_ROLE_IDENTITY', () => {
    const byDemand = new Map(imported.observedAssignments.map(row => [row.demandId, row]));
    assert.equal(byDemand.size, 257);
    for (const row of demands) assert.equal(byDemand.get(row.demandId)?.siteNodeId, row.currentSiteId);
    const siteBySheet = { '③天津销售出库': 'UC:DC:天津', '④西安销售出库': 'UC:DC:西安', '⑤沈阳销售出库': 'UC:DC:沈阳', '⑥东莞销售出库': 'UC:DC:东莞' };
    for (const row of demands) assert.equal(row.currentSiteId, siteBySheet[row.source.sheet]);
    assert.equal(imported.nodes.filter(row => row.role === 'CUSTOMER').length, 257);
    const dc = imported.nodes.find(row => row.nodeId === 'UC:DC:天津');
    const factory = imported.nodes.find(row => row.nodeId === 'UC:FACTORY:天津');
    assert.ok(dc && factory);
    assert.notEqual(dc.nodeId, factory.nodeId);
    assert.equal(dc.role, 'DC');
    assert.equal(factory.role, 'FACTORY');
    assert.equal(dc.coordinateSystem, 'UNCONFIRMED');
    assert.equal(factory.coordinateSystem, 'UNCONFIRMED');
    const outside = imported.nodes.find(row => row.nodeId === 'UC:EXTERNAL:外协加工');
    assert.equal(outside?.coordinate, null);
  });

  check('EXCLUDED_SUMMARIES_AND_TEMPLATES', () => {
    const excluded = imported.excludedRows;
    const has = (sheet, rowNumber) => excluded.some(row => row.sheet === sheet && row.rowNumber === rowNumber && row.reasonCode);
    assert.equal(excluded.length, 30);
    assert.ok(has('④西安销售出库', 42));
    assert.ok(has('⑤沈阳销售出库', 48));
    for (let row = 21; row <= 48; row++) assert.ok(has('⑥东莞销售出库', row));
    assert.equal(imported.sourceRows.length, 8 + 12 + 257 + 30);
    assert.ok(imported.sourceRows.every(row => row.sourceRowId && row.sheet && Number.isInteger(row.rowNumber) && row.values !== undefined));
  });

  check('RAW_SOURCE_AND_ROW_PROVENANCE', () => {
    const note = rawWorkbook.Sheets['⑥东莞销售出库'].X6.v;
    const row = imported.sourceRows.find(item => item.sheet === '⑥东莞销售出库' && item.rowNumber === 6);
    assert.ok(row);
    assert.ok(JSON.stringify(row.values).includes(note));
    assert.ok(demands.some(item => item.source?.sourceRowId === row.sourceRowId && item.source?.sheet === row.sheet && item.source?.rowNumber === row.rowNumber));
    const oldTotal = imported.sourceRows.find(item => item.sheet === '⑤沈阳销售出库' && item.rowNumber === 48);
    assert.ok(oldTotal && JSON.stringify(oldTotal.values).includes('13105.122'));
  });

  check('UNKNOWN_INPUTS_STAY_UNKNOWN', () => {
    for (const row of [...demands, ...inbound]) {
      assert.equal(row.roadDistanceKm, undefined);
      assert.equal(row.freightRate, undefined);
      assert.equal(row.cost, undefined);
    }
    for (const node of imported.nodes) {
      assert.equal(node.capacity, undefined);
      assert.notEqual(node.coordinateSystem, 'WGS84');
    }
  });

  check('ORIGINAL_WORKBOOK_UNCHANGED', () => assert.equal(sha256(fs.readFileSync(sourcePath)), originalHash));
  console.log(JSON.stringify({suite:'SUPPLY_CHAIN_UC_IMPORT_ACCEPTANCE',status:'PASS',checks,sourceSha256:originalHash,counts:{businessDemandRows:257,periodDemandRecords:demands.length,inboundBusinessRows:12,inboundPeriodRecords:inbound.length,excludedRows:imported.excludedRows.length},totals:{outboundM3:sum(demands),inboundM3:sum(inbound)}}, null, 2));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
