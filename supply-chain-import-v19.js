(function (root, factory) {
  'use strict';
  const ns = root.STCTPlatformV19 = root.STCTPlatformV19 || {};
  const api = factory(
    typeof module === 'object' && module.exports ? require('./vendor/xlsx/xlsx.full.min.js') : root.XLSX,
    typeof module === 'object' && module.exports ? require('./platform-import-session-v19.js') : ns.importSession,
    typeof module === 'object' && module.exports ? require('./platform-import-session-v19.js').tabularIntake : ns.tabularIntake
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root.document) ns.supplyChainImport = api;
})(globalThis, function (XLSX, Import, Intake) {
  'use strict';

  const SCHEMA_VERSION = 'stct-supply-chain-import-v1.9';
  const LIMITS = Object.freeze({ fileBytes: 8 * 1024 * 1024, sheets: 24, rows: 10000, columns: 100, blocks: 48 });
  const KINDS = new Set(['NODE', 'PERIOD_DEMAND', 'OBSERVED_INBOUND', 'OBSERVED_ASSIGNMENT']);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const clone = value => structuredClone(value);
  const blank = value => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
  const str = value => blank(value) ? '' : String(value).trim();
  function fail(code, detail = {}) { throw Object.assign(new Error(code), { code, detail }); }
  let tolerantSink = null;
  function parseError(code, detail, field = null, period = null) {
    if (tolerantSink) { tolerantSink(code, field, period); throw Object.assign(new Error('ROW_SKIPPED'), { code: 'ROW_SKIPPED' }); }
    fail(code, detail);
  }
  function bytesOf(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    fail('SC_IMPORT_BYTES_REQUIRED');
  }
  function fileNameOf(value) { return String(value || '').split(/[/\\]/).at(-1); }

  function inspectWorkbook(input, name, options = {}) {
    if (!XLSX) fail('SC_IMPORT_XLSX_RUNTIME_MISSING');
    const bytes = bytesOf(input), fileName = fileNameOf(name);
    if (options.csvDelimiter != null && ![',', ';', '\t'].includes(options.csvDelimiter)) fail('SC_IMPORT_DELIMITER_INVALID');
    if (!bytes.length || bytes.length > LIMITS.fileBytes) fail('SC_IMPORT_FILE_SIZE_INVALID', { bytes: bytes.length });
    const extension = fileName.split('.').at(-1).toLowerCase();
    if (!['xlsx', 'csv'].includes(extension)) fail('SC_IMPORT_FORMAT_UNSUPPORTED', { extension });
    if (extension === 'xlsx' && Import?.zipPreflight) Import.zipPreflight(bytes);
    let parsed;
    try {
      parsed = extension === 'xlsx'
        ? XLSX.read(bytes, { type: 'array', raw: true, cellFormula: true, cellHTML: false, bookVBA: false })
        : (() => { let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); } catch (_error) { fail('SC_IMPORT_UTF8_INVALID'); } return XLSX.read(text, { type: 'string', raw: true, FS: options.csvDelimiter || Intake.csvDelimiter(text) }); })();
    } catch (error) { if (error.code === 'SC_IMPORT_UTF8_INVALID') throw error; fail('SC_IMPORT_WORKBOOK_PARSE_FAILED', { message: error.message }); }
    if (parsed.SheetNames.length > LIMITS.sheets) fail('SC_IMPORT_SHEET_LIMIT');
    const sheets = parsed.SheetNames.map(nameInBook => {
      const sheet = parsed.Sheets[nameInBook];
      if (!sheet['!ref']) return { name: extension === 'csv' ? fileName : nameInBook, rowCount: 0, columnCount: 0, rows: [], merges: [] };
      const range = XLSX.utils.decode_range(sheet['!ref']);
      if (range.e.r >= LIMITS.rows || range.e.c >= LIMITS.columns) fail('SC_IMPORT_TABLE_LIMIT', { sheet: nameInBook });
      const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, blankrows: true });
      const rows = grid.map((values, offset) => ({ rowNumber: range.s.r + offset + 1, values: Array.from({ length: range.e.c + 1 }, (_, column) => values[column] ?? ''), formulas: Object.fromEntries(Array.from({ length: range.e.c + 1 }, (_, column) => { const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r + offset, c: column })]; return cell?.f ? [column + 1, { expression: cell.f, cached: cell.v != null }] : null; }).filter(Boolean)) }));
      const merges = (sheet['!merges'] || []).map(merge => ({ startRow: merge.s.r + 1, endRow: merge.e.r + 1, startColumn: merge.s.c + 1, endColumn: merge.e.c + 1 }));
      return { name: extension === 'csv' ? fileName : nameInBook, rowCount: range.e.r + 1, columnCount: range.e.c + 1, rows, merges };
    });
    return { schemaVersion: SCHEMA_VERSION, fileName, format: extension.toUpperCase(), sheets };
  }

  function profileSignature(workbook, profile) {
    const seen = new Set();
    return [...(profile.blocks || [])].filter(block => !seen.has(block.sheet) && seen.add(block.sheet)).map(block => {
      const sheet = workbook.sheets.find(item => item.name === block.sheet);
      if (!sheet) fail('SC_PROFILE_SHEET_MISSING', { sheet: block.sheet });
      const headers = block.headerRows || (block.headerRow ? [block.headerRow] : []);
      const headerRow = [...headers].reverse().map(row => sheet.rows.find(item => item.rowNumber === row)).find(row => row?.values.some(value => !blank(value)));
      const periodHeaders = (block.periodColumns || []).flatMap(item => headers.map(rowNumber => ({ row: rowNumber, column: columnOf(item), value: str(sheet.rows.find(row => row.rowNumber === rowNumber)?.values[columnOf(item) - 1]) }))).filter(item => item.value);
      return { name: sheet.name, minColumns: Math.max(1, ...Object.values(block.fields || {}).filter(spec => typeof spec === 'number' || spec?.column).map(columnOf), ...(block.periodColumns || []).map(columnOf)), headers: (headerRow?.values || []).map((value, index) => ({ row: headerRow.rowNumber, column: index + 1, value: str(value) })).filter(item => item.value).slice(0, 6), periodHeaders };
    });
  }
  function matchProfile(workbook, profile) {
    const signature = profile?.matchSignature;
    if (!Array.isArray(signature) || !signature.length) return null;
    const used = new Set(), sheetMap = {}, changes = []; let requiresReview = false;
    for (const expected of signature) {
      const matches = (sheet, header) => sheet.rows.some(row => (header.row == null || row.rowNumber === header.row) && str(row.values[header.column - 1]) === str(header.value));
      const candidates = workbook.sheets.filter(sheet => !used.has(sheet.name) && sheet.columnCount >= expected.minColumns && [...(expected.headers || []), ...(expected.periodHeaders || [])].every(header => matches(sheet, header)));
      const chosen = candidates.find(sheet => sheet.name === expected.name) || (candidates.length === 1 ? candidates[0] : null);
      let selected = chosen;
      if (!selected && (expected.periodHeaders || []).length) {
        const stable = (expected.headers || []).filter(header => !Intake.period(header.value));
        const compatible = workbook.sheets.filter(sheet => !used.has(sheet.name) && sheet.columnCount >= expected.minColumns && stable.length >= 2 && stable.every(header => matches(sheet, header)) && expected.periodHeaders.every(header => Intake.period(sheet.rows.find(row => row.rowNumber === header.row)?.values[header.column - 1])));
        selected = compatible.find(sheet => sheet.name === expected.name) || (compatible.length === 1 ? compatible[0] : null);
        requiresReview = requiresReview || Boolean(selected);
      }
      if (!selected) return null;
      if (selected.name !== expected.name) changes.push({ sheet: selected.name, field: 'sheet', before: expected.name, after: selected.name });
      for (const old of expected.periodHeaders || []) {
        const next = str(selected.rows.find(row => row.rowNumber === old.row)?.values[old.column - 1]);
        if (next !== str(old.value)) { changes.push({ sheet: selected.name, column: old.column, before: str(old.value), after: next }); requiresReview = true; }
      }
      used.add(selected.name); sheetMap[expected.name] = selected.name;
    }
    const matched = clone(profile);
    matched.blocks = matched.blocks.map(block => ({ ...block, sheet: sheetMap[block.sheet] || block.sheet }));
    for (const block of matched.blocks) {
      if (!(block.periodColumns || []).length) continue;
      const sheet = workbook.sheets.find(s => s.name === block.sheet), detected = Intake.periodColumns(sheet, block.headerRows);
      const mapped = new Set(block.periodColumns.map(columnOf));
      for (const column of block.periodColumns) {
        const found = detected.find(item => item.column === columnOf(column));
        if (found && found.period !== column.period && !changes.some(change => change.sheet === block.sheet && change.column === columnOf(column))) {
          changes.push({ sheet: block.sheet, column: columnOf(column), before: column.period, after: found.period }); requiresReview = true;
        }
        if (found && changes.some(change => change.sheet === block.sheet && change.column === columnOf(column))) { column.period = found.period; column.unit = found.unit; column.measure = found.measure; }
      }
      // New month columns are proposed explicitly; application still requires mapping confirmation.
      for (const column of detected) {
        if (mapped.has(column.column)) continue;
        block.periodColumns.push(column);
        changes.push({ sheet: block.sheet, column: column.column, before: null, after: `${column.period} ${column.unit}`.trim() });
        requiresReview = true;
      }
    }
    return { profile: matched, score: signature.length - (requiresReview ? .5 : 0), sheetMap, requiresReview, changes };
  }

  function columnOf(spec) {
    const column = typeof spec === 'number' ? spec : spec?.column;
    if (!Number.isInteger(column) || column < 1 || column > LIMITS.columns) fail('SC_PROFILE_COLUMN_INVALID', { column });
    return column;
  }
  function fieldValue(spec, values, fill, field, source) {
    if (spec && typeof spec === 'object' && own(spec, 'constant')) return clone(spec.constant);
    const column = columnOf(spec), setting = typeof spec === 'number' ? {} : spec;
    let value = values[column - 1] ?? '';
    if (blank(value) && setting.fillDown) value = fill[field] ?? '';
    else if (!blank(value) && setting.fillDown) fill[field] = value;
    if (blank(value)) return null;
    if (setting.map) {
      const key = String(value).trim();
      if (!own(setting.map, key)) parseError('SC_PROFILE_LOOKUP_MISSING', { ...source, field, column, value });
      return clone(setting.map[key]);
    }
    return setting.prefix !== undefined ? `${setting.prefix}${value}` : value;
  }
  function finiteQuantity(value, source, field, column) {
    if (blank(value) || typeof value === 'boolean' || !Number.isFinite(Number(value)) || Number(value) < 0)
      parseError('SC_IMPORT_QUANTITY_INVALID', { ...source, field, column, value });
    return Number(value);
  }
  function coordinate(value, source) {
    if (blank(value)) return null;
    const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，]/).map(part => part.trim()) : null;
    if (!parts || parts.length !== 2 || parts.some(blank) || parts.some(part => !Number.isFinite(Number(part))))
      parseError('SC_IMPORT_COORDINATE_INVALID', { ...source, value });
    const result = parts.map(Number);
    if (Math.abs(result[0]) > 180 || Math.abs(result[1]) > 90) parseError('SC_IMPORT_COORDINATE_INVALID', { ...source, value });
    return result;
  }
  function periodGroups(block) {
    const groups = new Map();
    for (const entry of block.periodColumns || []) {
      const column = columnOf(entry), period = str(entry.period), measure = str(entry.measure || 'quantity'), unit = str(entry.unit);
      if (!period || !measure || !unit) fail('SC_PROFILE_PERIOD_INVALID', { period, measure, unit, column });
      if (!groups.has(period)) groups.set(period, []);
      if (groups.get(period).some(item => item.measure === measure)) fail('SC_PROFILE_PERIOD_DUPLICATE', { period, measure });
      groups.get(period).push({ column, measure, unit, optional: Boolean(entry.optional) });
    }
    if (block.layout !== 'LONG' && ['PERIOD_DEMAND', 'OBSERVED_INBOUND'].includes(block.kind) && !groups.size) fail('SC_PROFILE_PERIODS_REQUIRED', { kind: block.kind });
    return groups;
  }
  function addSource(sourceRows, workbook, block, blockIndex, sheet, row) {
    const source = { sourceRowId: `${blockIndex}:${sheet.name}:${row.rowNumber}`, fileName: workbook.fileName, sheet: sheet.name, rowNumber: row.rowNumber, blockIndex };
    const values = clone(row.values);
    if (Object.keys(row.formulas || {}).length) source.formulas = clone(row.formulas);
    sourceRows.push({ ...source, kind: block.kind, values });
    return { ...source, rawValues: values };
  }

  function applyProfile(workbook, profile, options = {}) {
    if (workbook?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(workbook.sheets)) fail('SC_WORKBOOK_INVALID');
    if (!profile || !Array.isArray(profile.blocks) || !profile.blocks.length || profile.blocks.length > LIMITS.blocks) fail('SC_PROFILE_BLOCKS_INVALID');
    const nodes = [], periodDemand = [], observedInbound = [], observedAssignments = [], sourceRows = [], excludedRows = [];
    const nodeIndex = new Map(), demandIds = new Set(), demandPeriods = new Set(), assignmentIndex = new Map();
    let demandBusinessRows = 0, inboundBusinessRows = 0;
    const reject = (source, reasonCode, field = null, period = null) => excludedRows.push({ ...source, reasonCode, field, period });
    tolerantSink = null;
    const tolerant = Boolean(options && options.tolerant);
    function addNode(node) {
      if (!node.nodeId || !node.role) fail('SC_IMPORT_NODE_ID_ROLE_REQUIRED', { source: node.source });
      const existing = nodeIndex.get(node.nodeId);
      if (existing) {
        if (existing.role !== node.role || existing.name !== node.name || existing.address !== node.address || JSON.stringify(existing.coordinate) !== JSON.stringify(node.coordinate))
          fail('SC_IMPORT_NODE_ID_CONFLICT', { nodeId: node.nodeId, source: node.source });
        existing.sources.push(node.source);
        return;
      }
      const value = { ...node, sources: [node.source] };
      nodes.push(value);
      nodeIndex.set(node.nodeId, value);
    }
    for (const node of profile.staticNodes || []) {
      const source = { kind: 'PROFILE_CONSTANT', profileId: str(profile.profileId) };
      addNode({ nodeId: str(node.nodeId), role: str(node.role), name: str(node.name || node.nodeId), address: blank(node.address) ? null : str(node.address), coordinate: coordinate(node.coordinate, source), coordinateSystem: blank(node.coordinateSystem) ? null : str(node.coordinateSystem), source });
    }
    profile.blocks.forEach((block, blockIndex) => {
      if (!KINDS.has(block.kind)) fail('SC_PROFILE_KIND_INVALID', { blockIndex, sheet: block.sheet, kind: block.kind });
      const sheet = workbook.sheets.find(item => item.name === block.sheet);
      if (!sheet) fail('SC_PROFILE_SHEET_MISSING', { blockIndex, sheet: block.sheet });
      const startRow = Number(block.startRow), endRow = Number(block.endRow);
      if (!Number.isInteger(startRow) || !Number.isInteger(endRow) || startRow < 1 || endRow < startRow || endRow > sheet.rowCount)
        fail('SC_PROFILE_ROW_RANGE_INVALID', { blockIndex, startRow, endRow, rowCount: sheet.rowCount });
      const headerRows = new Set(Array.isArray(block.headerRows) ? block.headerRows : block.headerRow ? [block.headerRow] : []);
      let periods;
      try { periods = periodGroups(block); }
      catch (error) { error.detail = { sheet: sheet.name, blockIndex, headerRows: [...headerRows], ...error.detail }; throw error; }
      if (block.kind === 'NODE' && !block.nodeRole && !block.constants?.role && !block.fields?.role) fail('SC_PROFILE_NODE_ROLE_REQUIRED', { sheet: sheet.name, blockIndex, field: 'role' });
      // A missing mapping is not a row exclusion: stop before discarding an entire block.
      const unmapped = (block.requiredFields || []).find(field => !own(block.fields || {}, field) && !own(block.constants || {}, field));
      if (unmapped) fail('SC_PROFILE_REQUIRED_FIELD_UNMAPPED', { sheet: sheet.name, blockIndex, field: unmapped });
      if (periods.size && block.primaryMeasure && ![...periods.values()].some(entries => entries.some(entry => entry.measure === block.primaryMeasure))) fail('SC_PROFILE_PRIMARY_MEASURE_UNAVAILABLE', { sheet: sheet.name, blockIndex, field: 'primaryMeasure', measure: block.primaryMeasure });
      const fill = {};
      const explicitlyExcluded = new Map((block.excludeRows || []).map(item => typeof item === 'number' ? [item, 'PROFILE_EXCLUDED'] : [item.rowNumber, str(item.reasonCode || 'PROFILE_EXCLUDED')]));
      const byRow = new Map(sheet.rows.map(row => [row.rowNumber, row]));
      for (let rowNumber = startRow; rowNumber <= endRow; rowNumber++) {
        try {
        if (headerRows.has(rowNumber)) continue;
        const row = byRow.get(rowNumber) || { rowNumber, values: Array(sheet.columnCount).fill('') };
        const source = addSource(sourceRows, workbook, block, blockIndex, sheet, row);
        tolerantSink = tolerant ? (code, field, period) => { reject(source, code, field, period); } : null;
        if (explicitlyExcluded.has(rowNumber)) { reject(source, explicitlyExcluded.get(rowNumber)); continue; }
        if (row.values.every(blank)) { reject(source, 'EMPTY_ROW'); continue; }
        const value = { ...(block.constants || {}) };
        for (const [field, spec] of Object.entries(block.fields || {})) value[field] = fieldValue(spec, row.values, fill, field, source);
        if (blank(value.coordinate) && (!blank(value.longitude) || !blank(value.latitude))) value.coordinate = [value.longitude, value.latitude];
        const missing = (block.requiredFields || []).find(field => blank(value[field]));
        if (missing) { reject(source, 'REQUIRED_FIELD_MISSING', missing); continue; }
        if (block.kind === 'NODE') {
          const role = str(value.role || block.nodeRole), name = str(value.name);
          const nodeId = str(value.nodeId || (role && name ? `${role}:${name}` : ''));
          if (!name || !role) { reject(source, 'REQUIRED_FIELD_MISSING', !name ? 'name' : 'role'); continue; }
          addNode({ nodeId, role, name, address: blank(value.address) ? null : str(value.address), coordinate: coordinate(value.coordinate, source), coordinateSystem: blank(value.coordinateSystem) ? null : str(value.coordinateSystem), source });
          continue;
        }
        if (block.kind === 'OBSERVED_ASSIGNMENT') {
          const demandId = str(value.demandId), siteNodeId = str(value.siteNodeId);
          if (!demandId || !siteNodeId) { reject(source, 'REQUIRED_FIELD_MISSING', !demandId ? 'demandId' : 'siteNodeId'); continue; }
          const key = `${demandId}|${str(value.period)}`;
          if (assignmentIndex.has(key) && assignmentIndex.get(key) !== siteNodeId) parseError('SC_IMPORT_ASSIGNMENT_CONFLICT', { ...source, demandId });
          assignmentIndex.set(key, siteNodeId);
          observedAssignments.push({ demandId, siteNodeId, period: blank(value.period) ? null : str(value.period), source });
          continue;
        }
        const isDemand = block.kind === 'PERIOD_DEMAND';
        const id = str(isDemand ? value.demandId : value.flowId);
        if (!id) { reject(source, 'REQUIRED_FIELD_MISSING', isDemand ? 'demandId' : 'flowId'); continue; }
        const demandKey = block.layout === 'LONG' ? `${id}|${Intake.period(value.period) || str(value.period)}` : id;
        if (isDemand && demandIds.has(demandKey)) parseError('SC_IMPORT_DEMAND_ID_DUPLICATE', { ...source, demandId: id });
        if (!isDemand && (!str(value.fromNodeId) || !str(value.toNodeId))) { reject(source, 'REQUIRED_FIELD_MISSING', !str(value.fromNodeId) ? 'fromNodeId' : 'toNodeId'); continue; }
        const customerNodeId = isDemand ? (str(value.customerNodeId) || `CUSTOMER:${id}`) : null;
        const currentSiteId = isDemand ? (blank(value.currentSiteId) ? null : str(value.currentSiteId)) : null;
        const statedTotal = blank(value.statedTotal) ? null : finiteQuantity(value.statedTotal, source, 'statedTotal');
        // F03: 整行暂存——任一期间不完整/无效则整行不提交（宽容模式下整行排除）
        const staged = [];
        let rowRejected = false;
        if (block.layout === 'LONG') {
          const period = Intake.period(value.period), unit = str(value.unit || block.recordUnit);
          if (!period || !unit) parseError('SC_PROFILE_PERIOD_INVALID', { ...source, period: value.period, unit });
          const quantity = finiteQuantity(value.quantity, source, 'quantity');
          staged.push({ period, quantity, unit, measures: { quantity: { quantity, unit } }, statedTotal, source });
        }
        for (const [period, columns] of periods) {
          const measures = {};
          for (const item of columns) {
            const raw = row.values[item.column - 1];
            if (blank(raw) && !item.optional) { reject(source, 'PERIOD_VALUE_MISSING', item.measure, period); rowRejected = true; break; }
            measures[item.measure] = { quantity: blank(raw) ? null : finiteQuantity(raw, source, item.measure, item.column), unit: item.unit };
          }
          if (rowRejected) break;
          const primary = str(block.primaryMeasure || 'quantity'), main = measures[primary];
          if (!main || main.quantity === null) parseError('SC_PROFILE_PRIMARY_MEASURE_MISSING', { ...source, period, primary });
          staged.push({ period, quantity: main.quantity, unit: main.unit, measures, statedTotal, source });
        }
        if (rowRejected) continue;
        if (isDemand && staged.some(record => demandPeriods.has(`${id}|${record.period}`))) parseError('SC_IMPORT_DEMAND_ID_DUPLICATE', { ...source, demandId: id });
        // ---- 原子提交：先节点/归属，后期间记录 ----
        if (isDemand) {
          addNode({ nodeId: customerNodeId, role: str(value.nodeRole || block.nodeRole || 'CUSTOMER'), name: str(value.customerName || customerNodeId), address: blank(value.customerAddress) ? null : str(value.customerAddress), coordinate: coordinate(value.coordinate, source), coordinateSystem: blank(value.coordinateSystem) ? null : str(value.coordinateSystem), source });
          if (currentSiteId) {
            const key = `${id}|${block.layout === 'LONG' ? staged[0].period : ''}`;
            if (assignmentIndex.has(key) && assignmentIndex.get(key) !== currentSiteId) parseError('SC_IMPORT_ASSIGNMENT_CONFLICT', { ...source, demandId: id });
            assignmentIndex.set(key, currentSiteId);
            observedAssignments.push({ demandId: id, siteNodeId: currentSiteId, period: block.layout === 'LONG' ? staged[0].period : null, source });
          }
          demandIds.add(demandKey); demandBusinessRows++;
          for (const common of staged) { demandPeriods.add(`${id}|${common.period}`); periodDemand.push({ demandId: id, customerNodeId, currentSiteId, ...common }); }
        } else {
          inboundBusinessRows++;
          for (const common of staged) observedInbound.push({ flowId: id, fromNodeId: str(value.fromNodeId), toNodeId: str(value.toNodeId), ...common });
        }
        } catch (error) { if (!tolerantSink || error.code !== 'ROW_SKIPPED') throw error; } finally { tolerantSink = null; }
      }
    });
    const sumByUnit = records => records.reduce((totals, row) => ({ ...totals, [row.unit]: (totals[row.unit] || 0) + row.quantity }), {});
    const summary = { businessRows: demandBusinessRows + inboundBusinessRows, demandBusinessRows, inboundBusinessRows, periodDemandRecords: periodDemand.length, observedInboundRecords: observedInbound.length, observedAssignmentRecords: observedAssignments.length, nodeCount: nodes.length, sourceRowCount: sourceRows.length, excludedRowCount: excludedRows.length, periodDemandTotals: sumByUnit(periodDemand), observedInboundTotals: sumByUnit(observedInbound) };
    return { schemaVersion: SCHEMA_VERSION, profileId: str(profile.profileId), profile: clone(profile), nodes, periodDemand, observedInbound, observedAssignments, sourceRows, excludedRows, summary };
  }

  return Object.freeze({ SCHEMA_VERSION, LIMITS, inspectWorkbook, applyProfile, profileSignature, matchProfile });
});
