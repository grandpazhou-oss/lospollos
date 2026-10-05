(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root.document) (root.STCTPlatformV19 = root.STCTPlatformV19 || {}).supplyMap = api;
})(globalThis, function () {
  'use strict';

  const fmt=value=>(typeof module==='object'&&module.exports?require('./platform-import-session-v19.js').businessNumber:globalThis.STCTPlatformV19.businessNumber).number(value);
  const COPY = {
    zh: { supplier: '供应商', facility: '仓库', customer: '送货地', role: '节点角色', volume: '关联物量', serves: '关联对象', basis: '距离口径', source: '结果来源', unknown: '坐标未确认或缺失，仅在列表显示', outbound: '仓→送货地分配关系', inbound: '供应商→仓供货关系', legend: '连线是业务分配关系，不是道路路线；距离与费用以结果账本为准。', current: '当前重点方案', noResult: '尚无当前有效结果，只显示节点' },
    en: { supplier: 'Supplier', facility: 'Warehouse', customer: 'Delivery location', role: 'Node role', volume: 'Related volume', serves: 'Related entities', basis: 'Distance basis', source: 'Result source', unknown: 'Coordinate unconfirmed or missing; list only', outbound: 'Warehouse→location assignment', inbound: 'Supplier→warehouse supply', legend: 'Lines show business relations, not road routes; use the result ledger for distance and cost.', current: 'Current focus scenario', noResult: 'No current verified result; showing nodes only' },
    ja: { supplier: '供給元', facility: '倉庫', customer: '配送先', role: '拠点の役割', volume: '関連物量', serves: '関連先', basis: '距離の基準', source: '結果の出典', unknown: '座標が未確認または欠落。リストのみ表示', outbound: '倉庫→配送先の割当関係', inbound: '供給元→倉庫の供給関係', legend: '線は業務上の関係であり道路ルートではありません。距離と費用は結果台帳を参照してください。', current: '現在の主要案', noResult: '有効な結果はありません。拠点のみ表示' }
  };
  const role = node => ['FACTORY', 'SUPPLIER', 'EXTERNAL_SOURCE'].includes(node.role) ? 'supplier' : ['DC', 'WAREHOUSE', 'TRANSFER'].includes(node.role) ? 'facility' : 'customer';
  const validCoordinate = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
  const pairKey = (from, to) => `${from}\u0000${to}`;
  const WAREHOUSE_COLORS = ['#2463c5','#c16b16','#178269','#9151ba','#bd426b','#7b7520','#387eac','#b34932','#5669a6','#238947','#865d32','#af478f'];
  function warehouseStyles(nodes) {
    return new Map([...nodes.values()].filter(node => role(node) === 'facility')
      .sort((a,b) => a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : 0)
      .map((node,index) => [node.nodeId, { id: node.nodeId, label: node.name || node.nodeId,
        color: WAREHOUSE_COLORS[index] || `hsl(${((index-WAREHOUSE_COLORS.length)*137.507764+19)%360}, 58%, 40%)` }]));
  }
  const warehouseStyle = (row, styles) => styles.get(row.kind === 'inbound' ? row.toNodeId : row.fromNodeId);
  const warehouseLegend = (features, styles) => [...styles.values()].filter(style => features.some(feature => feature.geometry.type === 'LineString' && feature.properties.warehouseId === style.id));
  const distanceLabel = (value, locale) => ({
    ASSUMED_WGS84_SCREENING: ['坐标按 WGS84 假设的地理筛选（非道路距离）', 'Geographic screening with assumed WGS84 coordinates (not road distance)', 'WGS84 仮定による地理選別（道路距離ではない）'],
    GEOGRAPHIC_SCREENING: ['地理筛选（非道路距离）', 'Geographic screening (not road distance)', '地理選別（道路距離ではない）'],
    ESTIMATED_ROAD: ['估算道路', 'Estimated road distance', '推定道路距離'],
    VERIFIED_ROAD: ['已核验道路矩阵', 'Verified road matrix', '検証済み道路行列']
  }[value]?.[{zh:0,en:1,ja:2}[locale] || 0] || value || 'UNKNOWN');
  const roleLabel = (node, locale) => ({FACTORY:['工厂','Factory','工場'],SUPPLIER:['供应商','Supplier','供給元'],EXTERNAL_SOURCE:['外部来源','External source','外部供給元'],DC:['仓库','Warehouse','倉庫'],WAREHOUSE:['仓库','Warehouse','倉庫'],TRANSFER:['中转节点','Transfer node','中継拠点'],CUSTOMER:['送货地','Delivery location','配送先']}[node.role]?.[{zh:0,en:1,ja:2}[locale] || 0] || node.role);

  // Display-only ledger projection. Missing distance/cost stays unknown; never route or price on selection.
  function ledgerMetrics(rows) {
    const sum = values => values.reduce((total, value) => total + value, 0);
    const quantity = sum(rows.map(row => row.quantity));
    const known = rows.filter(row => Number.isFinite(row.distanceKm) && row.distanceKm >= 0);
    const knownQuantity = sum(known.map(row => row.quantity));
    const knownVolumeKm = sum(known.map(row => Number.isFinite(row.volumeKm) ? row.volumeKm : row.quantity * row.distanceKm));
    return { quantity, recordCount: rows.length, knownQuantity, knownVolumeKm, demandIds: [...new Set(rows.map(row => row.demandId).filter(Boolean))],
      weightedKm: knownQuantity ? knownVolumeKm / knownQuantity : null,
      distanceCoverage: quantity ? knownQuantity / quantity : null,
      volumeKm: rows.length && known.length === rows.length ? knownVolumeKm : null,
      cost: rows.length && rows.every(row => Number.isFinite(row.cost)) ? sum(rows.map(row => row.cost)) : null,
      sources: [...new Set(rows.flatMap(row => [row.distanceSource, row.distanceQuality, row.distanceBasis, row.source, row.rateStatus]).filter(Boolean))] };
  }

  // MapLibre supplies unwrapped longitudes; preserve the visible rectangle across world copies.
  function rectangleBounds(a, b) {
    if (![a, b].every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))) return null;
    const west = Math.min(a[0], b[0]), east = Math.max(a[0], b[0]);
    const wrap = value => ((value + 180) % 360 + 360) % 360 - 180;
    return [east - west >= 360 ? -180 : wrap(west), Math.min(a[1], b[1]), east - west >= 360 ? 180 : wrap(east), Math.max(a[1], b[1])];
  }

  // Select from the complete projection, independent of rendering, layer visibility or point density.
  function selectArea(model, bounds) {
    if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) return [];
    const [west, south, east, north] = bounds;
    if (Math.abs(west) > 180 || Math.abs(east) > 180 || south < -90 || north > 90 || south > north) return [];
    return [...new Set((model.entities || []).filter(entity => {
      if (!validCoordinate(entity.coordinate)) return false;
      const [longitude, latitude] = entity.coordinate;
      return latitude >= south && latitude <= north && (west <= east
        ? longitude >= west && longitude <= east : longitude >= west || longitude <= east);
    }).map(entity => entity.id))];
  }

  function analyzeSelection(model, ids, direction = 'ANY') {
    const requested = new Set(ids || []);
    const entities = (model.entities || []).filter(entity => requested.has(entity.id));
    const nodeIds = [...new Set(entities.map(entity => entity.id))], selected = new Set(nodeIds), seen = new Set();
    const relations = (model.relations || []).filter(row => {
      const from = selected.has(row.fromNodeId), to = selected.has(row.toNodeId);
      const matches = direction === 'INCOMING' ? to : direction === 'OUTGOING' ? from : direction === 'BETWEEN' ? from && to : from || to;
      if (!matches || seen.has(row.relationId)) return false;
      seen.add(row.relationId);
      return true;
    });
    const aggregate = (rows, side) => {
      const metrics = rows.map(row => row[`${side}Metrics`]).filter(value => value && value.recordCount > 0);
      const sum = key => metrics.reduce((total, value) => total + value[key], 0);
      const quantity = sum('quantity'), knownQuantity = sum('knownQuantity'), knownVolumeKm = sum('knownVolumeKm');
      return { quantity, recordCount: sum('recordCount'), knownQuantity, knownVolumeKm,
        weightedKm: knownQuantity ? knownVolumeKm / knownQuantity : null,
        distanceCoverage: quantity ? knownQuantity / quantity : null,
        volumeKm: metrics.length && metrics.every(value => Number.isFinite(value.volumeKm)) ? sum('volumeKm') : null,
        cost: metrics.length && metrics.every(value => Number.isFinite(value.cost)) ? sum('cost') : null };
    };
    const groups = ['inbound', 'outbound', 'transfer'].filter(kind => relations.some(row => row.kind === kind)).map(kind => {
      const rows = relations.filter(row => row.kind === kind);
      return { kind, before: aggregate(rows, 'before'), after: aggregate(rows, 'after') };
    });
    return { nodeIds, relationIds: relations.map(row => row.relationId), relations, groups,
      missingCoordinates: nodeIds.filter(id => !validCoordinate(entities.find(entity => entity.id === id).coordinate)).length };
  }

  // Candidate service membership is derived from the projected ledger, never a geographic boundary.
  function candidateCoverage(model, options = {}) {
    const kinds = ['inbound', 'outbound', 'transfer'], requested = String(options.kind || '').toLowerCase();
    const leg = String(model.provenance?.leg || '').toLowerCase();
    const kind = kinds.includes(requested) ? requested : model.provenance?.analysisScope === 'UPSTREAM_ONLY' ? 'inbound' : kinds.includes(leg) ? leg : 'outbound';
    const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    const entities = new Map((model.entities || []).map(entity => [entity.id, entity]));
    const legend = new Map((model.warehouseLegend || []).map(warehouse => [warehouse.id, warehouse]));
    const points = new Map((model.features || []).filter(feature => feature.geometry?.type === 'Point').map(feature => [feature.properties?.entityId, feature.properties]));
    const warehouses = new Map(), receivers = new Map(), seen = new Set();
    const warehouseFor = id => {
      if (!warehouses.has(id)) {
        const entity = entities.get(id), style = legend.get(id);
        warehouses.set(id, { id, label: entity?.label || style?.label || id,
          color: entity?.warehouseColor || style?.color || points.get(id)?.color || '#64748b', quantity: 0, receiverIds: new Set(), relationIds: new Set() });
      }
      return warehouses.get(id);
    };
    for (const entity of entities.values()) {
      if (entity.kind === 'facility' && (entity.candidateSelected === true || points.get(entity.id)?.candidateSelected === true)) warehouseFor(entity.id);
    }
    const rows = (model.relations || []).filter(row => row.kind === kind && Number.isFinite(row.after) && row.after > 0)
      .slice().sort((a, b) => compare(a.relationId, b.relationId));
    for (const row of rows) {
      if (seen.has(row.relationId)) continue;
      seen.add(row.relationId);
      const warehouseId = kind === 'inbound' ? row.toNodeId : row.fromNodeId;
      const receiverId = kind === 'inbound' ? row.fromNodeId : row.toNodeId;
      const warehouse = warehouseFor(warehouseId);
      const receiver = receivers.get(receiverId) || { id: receiverId, warehouseIds: new Set(), quantity: 0,
        mapped: validCoordinate(entities.get(receiverId)?.coordinate) };
      warehouse.quantity += row.after;
      warehouse.receiverIds.add(receiverId);
      warehouse.relationIds.add(row.relationId);
      receiver.quantity += row.after;
      receiver.warehouseIds.add(warehouseId);
      receivers.set(receiverId, receiver);
    }
    const receiverRows = [...receivers.values()].sort((a, b) => compare(a.id, b.id)).map(receiver => {
      const warehouseIds = [...receiver.warehouseIds].sort(compare), multiple = warehouseIds.length > 1;
      return { ...receiver, warehouseIds, color: multiple ? '#64748b' : warehouses.get(warehouseIds[0]).color, multiple };
    });
    const warehouseRows = [...warehouses.values()].sort((a, b) => compare(a.id, b.id)).map(warehouse => {
      const receiverIds = [...warehouse.receiverIds].sort(compare), mappedReceiverCount = receiverIds.filter(id => receivers.get(id).mapped).length;
      return { ...warehouse, receiverIds, relationIds: [...warehouse.relationIds].sort(compare), receiverCount: receiverIds.length,
        mappedReceiverCount, missingReceiverCount: receiverIds.length - mappedReceiverCount };
    });
    const mappedReceiverCount = receiverRows.filter(receiver => receiver.mapped).length;
    return { kind, warehouses: warehouseRows, receivers: receiverRows,
      totalQuantity: warehouseRows.reduce((sum, warehouse) => sum + warehouse.quantity, 0), receiverCount: receiverRows.length,
      mappedReceiverCount, missingReceiverCount: receiverRows.length - mappedReceiverCount,
      multiWarehouseCount: receiverRows.filter(receiver => receiver.multiple).length,
      relationIds: [...seen].sort(compare), warehouseIds: warehouseRows.map(warehouse => warehouse.id) };
  }


  function project(study, snapshot, locale = 'zh', focusScenarioId = null) {
    if (!study || !Array.isArray(study.nodes)) throw new Error('SUPPLY_MAP_STUDY_REQUIRED');
    const c = COPY[locale] || COPY.zh;
    const current = snapshot?.studyHash === study.inputHash ? snapshot : null;
    const focusId = focusScenarioId || current?.decision?.focusScenarioId || null;
    const focus = focusId ? current?.rows?.find(row => row.scenarioId === focusId) : null;
    const result = focus?.result || focus || null;
    const coordinateAllowed = node => (node.coordinateSystem === 'WGS84' || study.coordinateUse === 'ASSUMED_WGS84_SCREENING') && validCoordinate(node.coordinate);
    const nodes = new Map(study.nodes.map(node => [node.nodeId, node]));
    const styles = warehouseStyles(nodes);
    const relations = new Map();
    for (const [kind, rows] of [['outbound', result?.outbound || []], ['inbound', result?.inbound || []]]) {
      for (const row of rows) {
        if (!nodes.has(row.fromNodeId) || !nodes.has(row.toNodeId)) continue;
        const key = `${kind}\u0000${pairKey(row.fromNodeId, row.toNodeId)}`;
        const prior = relations.get(key) || { kind, fromNodeId: row.fromNodeId, toNodeId: row.toNodeId, quantity: 0, periods: new Set() };
        prior.quantity += row.quantity;
        prior.periods.add(row.period);
        relations.set(key, prior);
      }
    }
    const features = [];
    const entityRelations = new Map();
    for (const relation of relations.values()) {
      for (const nodeId of [relation.fromNodeId, relation.toNodeId]) {
        const rows = entityRelations.get(nodeId) || [];
        rows.push(relation);
        entityRelations.set(nodeId, rows);
      }
      const from = nodes.get(relation.fromNodeId), to = nodes.get(relation.toNodeId);
      const warehouse = warehouseStyle(relation, styles);
      if (coordinateAllowed(from) && coordinateAllowed(to)) {
        features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [from.coordinate, to.coordinate] }, properties: { entityId: relation.toNodeId, kind: 'assignment', layer: relation.kind, fromNodeId: relation.fromNodeId, toNodeId: relation.toNodeId, warehouseId: warehouse?.id || '', color: warehouse?.color || '#63758b' } });
      }
    }
    const entities = study.nodes.map(node => {
      const kind = role(node);
      const related = entityRelations.get(node.nodeId) || [];
      const partners = [...new Set(related.map(row => row.fromNodeId === node.nodeId ? row.toNodeId : row.fromNodeId))];
      const inboundVolume = related.filter(row => row.kind === 'inbound').reduce((total, row) => total + row.quantity, 0);
      const outboundVolume = related.filter(row => row.kind === 'outbound').reduce((total, row) => total + row.quantity, 0);
      const shown = coordinateAllowed(node);
      const selected = kind === 'facility' && Boolean(result?.selectedSiteIds?.includes(node.nodeId) || result?.selectedSites?.some(site => site.nodeId === node.nodeId));
      if (shown) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: node.coordinate }, properties: { entityId: node.nodeId, kind, layer: kind === 'supplier' ? 'suppliers' : kind === 'facility' ? 'facilities' : 'demands', label: node.name, selected, facilityRole: kind === 'facility' ? selected ? 'selected' : 'existing' : undefined, color: kind === 'supplier' ? '#9a6632' : kind === 'facility' ? styles.get(node.nodeId).color : '#47778a' } });
      return { id: node.nodeId, kind, symbol: kind === 'supplier' ? '◆' : kind === 'facility' ? '□' : '○', label: node.name || node.nodeId, summary: `${c[kind]} · ${partners.length} ${c.serves}${shown ? '' : ` · ${c.unknown}`}`, facts: [[c.role, roleLabel(node, locale)], [c.inbound, `${fmt(inboundVolume)} ${study.unit || ''}`], [c.outbound, `${fmt(outboundVolume)} ${study.unit || ''}`], [c.serves, partners.map(id => nodes.get(id)?.name || id).join('、') || '—'], [c.basis, distanceLabel(current?.distanceBasis || study.coordinateUse, locale)], [c.source, focusId || c.noResult]] };
    });
    return {
      owner: 'SUPPLY', features, entities, warehouseLegend: warehouseLegend(features, styles),
      layers: [{ id: 'suppliers', label: c.supplier }, { id: 'facilities', label: c.facility }, { id: 'demands', label: c.customer }, { id: 'inbound', label: c.inbound }, { id: 'outbound', label: c.outbound }],
      legend: `${c.legend} ${focusId ? `${c.current}: ${focusId}` : c.noResult}`,
      provenance: { studyId: study.studyId, studyHash: study.inputHash, snapshotHash: current?.snapshotHash || null, focusScenarioId: focusId, resultStatus: result?.status || 'NOT_RUN', coordinateUse: study.coordinateUse || 'UNCONFIRMED', distanceBasis: current?.distanceBasis || null, geometry: 'BUSINESS_RELATION_ONLY_NOT_ROAD_ROUTE', missingCoordinates: entities.filter(entity => entity.summary.includes(c.unknown)).length, basemap: 'RUNTIME_CONFIGURED_DISPLAY_ONLY' }
    };
  }

  // A fixed domain across both sides and all periods prevents filter-induced rescaling.
  function flowWidth(quantity, maximum) {
    return Number.isFinite(quantity) && quantity > 0 && Number.isFinite(maximum) && maximum > 0
      ? 1.5 + 5.5 * Math.sqrt(Math.min(quantity / maximum, 1)) : 1.5;
  }

  // Compare the complete incoming service of one receiver, not a removed/new OD line against zero.
  function receiverComparisons(relations) {
    const groups = new Map();
    for (const row of relations) {
      const key = `${row.kind}\u0000${row.toNodeId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    return [...groups].map(([key, rows]) => {
      const aggregate = metrics => {
        const used = metrics.filter(m => m.recordCount > 0), sum = k => used.reduce((s,m) => s + m[k], 0);
        const quantity = sum('quantity'), knownQuantity = sum('knownQuantity'), knownVolumeKm = sum('knownVolumeKm');
        return { quantity, knownQuantity, knownVolumeKm, recordCount: sum('recordCount'),
          weightedKm: knownQuantity ? knownVolumeKm / knownQuantity : null,
          distanceCoverage: quantity ? knownQuantity / quantity : null,
          volumeKm: used.length && used.every(m => Number.isFinite(m.volumeKm)) ? sum('volumeKm') : null,
          cost: used.length && used.every(m => Number.isFinite(m.cost)) ? sum('cost') : null };
      };
      const before = aggregate(rows.map(r => r.beforeMetrics)), after = aggregate(rows.map(r => r.afterMetrics));
      const periods = [...new Set(rows.flatMap(r => r.periodRows.map(p => p.period)))];
      // Machine-roundoff allowance only for display comparability, never a model/constraint tolerance.
      const equal = (a,b,n) => Math.abs(a-b) <= Number.EPSILON * Math.max(1,Math.abs(a),Math.abs(b)) * n;
      const sameQuantity = periods.every(period => {
        const records = rows.flatMap(r => r.periodRows.filter(p => p.period === period));
        return equal(records.reduce((s,p) => s+p.before.quantity,0),records.reduce((s,p) => s+p.after.quantity,0),Math.max(1,records.length)*4);
      });
      const reason = !before.quantity || !after.quantity ? 'MISSING_SIDE' : !sameQuantity ? 'QUANTITY_CHANGED'
        : before.volumeKm === null || after.volumeKm === null ? 'MISSING_DISTANCE' : null;
      return { key, kind: rows[0].kind, nodeId: rows[0].toNodeId, label: rows[0].toName,
        relationIds: rows.map(r => r.relationId), before, after, reason,
        deltaKm: reason ? null : after.weightedKm-before.weightedKm };
    });
  }

  function exploreRelations(model, options = {}) {
    const ids = new Set((model.relations || []).map(r => r.relationId));
    const groups = (model.receiverComparisons || receiverComparisons(model.relations || [])).filter(g => g.relationIds.some(id => ids.has(id))).map(g =>
      g.relationIds.every(id => ids.has(id)) ? g : {...g, reason:'PARTIAL_SCOPE', deltaKm:null});
    const threshold = Number.isFinite(options.minKm) ? Math.max(0,options.minKm) : 0;
    const direction = options.direction || 'ALL', selected = options.nodeIds == null ? null : new Set(options.nodeIds);
    const filtered = groups.filter(g => {
      if (direction === 'UNKNOWN') return g.deltaKm === null;
      if (g.deltaKm === null) return direction === 'ALL' && threshold === 0;
      return Math.abs(g.deltaKm) >= threshold && (direction === 'ALL' || direction === 'LONGER' && g.deltaKm > 0 || direction === 'SHORTER' && g.deltaKm < 0);
    });
    const touching = new Set((model.relations || []).filter(r => !selected || selected.has(r.fromNodeId) || selected.has(r.toNodeId)).map(r => r.relationId));
    const focused = filtered.filter(g => g.relationIds.some(id => touching.has(id)));
    const focusedIds = new Set(focused.flatMap(g => g.relationIds).filter(id => ids.has(id)));
    return { groups: focused, total: groups.length, filteredCount: filtered.length,
      unknownCount: groups.filter(g => g.deltaKm === null).length,
      allowedRelationIds: filtered.flatMap(g => g.relationIds).filter(id => ids.has(id)),
      relationIds: [...focusedIds], relations: (model.relations || []).filter(r => focusedIds.has(r.relationId)) };
  }

  function projectComparison(study, snapshot, options = {}, locale = 'zh') {
    if (!study || !Array.isArray(study.nodes)) throw new Error('SUPPLY_MAP_STUDY_REQUIRED');
    const c = COPY[locale] || COPY.zh;
    const current = snapshot?.studyHash === study.inputHash ? snapshot : null;
    const scenarioId = current?.rows?.some(row => row.scenarioId === options.scenarioId)
      ? options.scenarioId : current?.decision?.focusScenarioId || null;
    const selected = current?.rows?.find(row => row.scenarioId === scenarioId) || null;
    const candidate = selected?.result || selected;
    const joint = current?.schemaVersion === 'stct-supply-chain-v5-snapshot-v1';
    const scope = current?.analysisScope || 'OUTBOUND_ONLY';
    const referenceCandidate=options.referenceScenarioId?current?.rows?.find(row=>row.scenarioId===options.referenceScenarioId):null;
    if(options.referenceScenarioId&&!referenceCandidate)throw new Error('MAP_REFERENCE_CANDIDATE_UNKNOWN');
    if(referenceCandidate&&(!current.decision?.rankedScenarioIds?.includes(referenceCandidate.scenarioId)||!current.decision.rankedScenarioIds.includes(scenarioId)))throw new Error('MAP_CANDIDATE_COMPARISON_NOT_RANKED');
    const reference=referenceCandidate?(referenceCandidate.result||referenceCandidate):candidate?joint&&scope==='FULL_CHAIN'?current?.planningReference:current?.baseline:null;
    const knownSuppliers = new Set(study.nodes.filter(node => ['FACTORY', 'SUPPLIER'].includes(node.role)).map(node => node.nodeId));
    const before = {
      inbound: scope === 'OUTBOUND_ONLY' ? [] : scope === 'UPSTREAM_ONLY' ? (reference?.inbound || []).filter(row => knownSuppliers.has(row.fromNodeId)) : reference?.inbound || [],
      outbound: scope === 'UPSTREAM_ONLY' ? [] : reference?.outbound || [],
      transfer: reference?.transfer || []
    };
    const after = { inbound: scope === 'OUTBOUND_ONLY' ? [] : candidate?.inbound || [], outbound: scope === 'UPSTREAM_ONLY' ? [] : candidate?.outbound || [], transfer: candidate?.transfer || [] };
    let maximum = 0;
    for (const legs of [before, after]) {
      const totals = new Map();
      for (const kind of ['inbound', 'outbound', 'transfer']) for (const row of legs[kind]) {
        if (!Number.isFinite(row.quantity) || row.quantity <= 0) continue;
        const key = `${kind}\u0000${pairKey(row.fromNodeId, row.toNodeId)}`;
        totals.set(key, (totals.get(key) || 0) + row.quantity);
      }
      for (const total of totals.values()) maximum = Math.max(maximum, total);
    }
    const flowScale = { maximum, unit: study.unit || '', scope: 'ALL_PERIODS_BOTH_SCENARIOS', transform: 'SQRT', minWidth: 1.5, maxWidth: 7 };
    const mode = ['REFERENCE', 'CANDIDATE', 'BOTH'].includes(options.mode) ? options.mode : 'BOTH';
    const leg = ['INBOUND', 'OUTBOUND', 'TRANSFER', 'BOTH'].includes(options.leg) ? options.leg : 'BOTH';
    const period = study.periods?.includes(options.period) ? options.period : 'ALL';
    const nodes = new Map(study.nodes.map(node => [node.nodeId, node]));
    const styles = warehouseStyles(nodes);
    const visible = node => (node.coordinateSystem === 'WGS84' || study.coordinateUse === 'ASSUMED_WGS84_SCREENING') && validCoordinate(node.coordinate);
    const aggregate = legs => {
      const groups = new Map();
      for (const kind of ['inbound', 'outbound', 'transfer']) {
        if (leg !== 'BOTH' && leg !== kind.toUpperCase()) continue;
        for (const row of legs[kind]) {
          if (period !== 'ALL' && row.period !== period || !nodes.has(row.fromNodeId) || !nodes.has(row.toNodeId) || !Number.isFinite(row.quantity) || row.quantity <= 0) continue;
          const key = `${kind}\u0000${pairKey(row.fromNodeId, row.toNodeId)}`;
          const found = groups.get(key) || { key, kind, fromNodeId: row.fromNodeId, toNodeId: row.toNodeId, quantity: 0, periods: new Set(), records: [] };
          found.quantity += row.quantity;
          found.periods.add(row.period);
          found.records.push(row);
          groups.set(key, found);
        }
      }
      return groups;
    };
    const original = aggregate(before), planned = aggregate(after), features = [];
    const changeOf = (oldRow, newRow) => !oldRow ? 'NEW' : !newRow ? 'REMOVED' : oldRow.quantity !== newRow.quantity ? 'VOLUME_CHANGED' : 'UNCHANGED';
    const changeFilter = ['CHANGED', 'NEW', 'REMOVED', 'VOLUME_CHANGED', 'UNCHANGED'].includes(options.change) ? options.change : 'ALL';
    const nodeId = nodes.has(options.nodeId) ? options.nodeId : '';
    const allRelations = [...new Set([...original.keys(), ...planned.keys()])].map(key => {
      const oldRow = original.get(key), newRow = planned.get(key), row = newRow || oldRow;
      const periods = [...new Set([...(oldRow?.periods || []), ...(newRow?.periods || [])])];
      const oldRecords = oldRow?.records || [], newRecords = newRow?.records || [];
      return { key, relationId: encodeURIComponent(key), kind: row.kind, fromNodeId: row.fromNodeId, toNodeId: row.toNodeId,
        quantity: row.quantity, periods, change: changeOf(oldRow, newRow), fromName: nodes.get(row.fromNodeId).name || row.fromNodeId,
        toName: nodes.get(row.toNodeId).name || row.toNodeId, before: oldRow?.quantity || 0, after: newRow?.quantity || 0,
        unit: study.unit, currency: study.currency || current?.currency || '', mapped: visible(nodes.get(row.fromNodeId)) && visible(nodes.get(row.toNodeId)),
        beforeMetrics: ledgerMetrics(oldRecords), afterMetrics: ledgerMetrics(newRecords),
        distanceEvidence:{before:distanceQuality(oldRecords),after:distanceQuality(newRecords)},
        periodRows: (study.periods || periods).filter(p => periods.includes(p)).map(p => ({ period: p,
          before: ledgerMetrics(oldRecords.filter(record => record.period === p)), after: ledgerMetrics(newRecords.filter(record => record.period === p)) })),
        serviceBefore: row.kind === 'outbound' ? [...original.values()].filter(r => r.kind === 'outbound' && r.toNodeId === row.toNodeId).map(r => ({ id: r.fromNodeId, name: nodes.get(r.fromNodeId).name || r.fromNodeId })) : [],
        serviceAfter: row.kind === 'outbound' ? [...planned.values()].filter(r => r.kind === 'outbound' && r.toNodeId === row.toNodeId).map(r => ({ id: r.fromNodeId, name: nodes.get(r.fromNodeId).name || r.fromNodeId })) : [] };
    });
    const relations = allRelations.filter(row => (!nodeId || row.fromNodeId === nodeId || row.toNodeId === nodeId) &&
      (changeFilter === 'ALL' || changeFilter === 'CHANGED' ? changeFilter === 'ALL' || row.change !== 'UNCHANGED' : row.change === changeFilter));
    const shownKeys = new Set(relations.map(row => row.key));
    const attach = (name, groups, other) => {
      for (const row of groups.values()) {
        if (!shownKeys.has(row.key) || mode !== 'BOTH' && mode !== name.toUpperCase()) continue;
        const from = nodes.get(row.fromNodeId), to = nodes.get(row.toNodeId);
        if (!visible(from) || !visible(to)) continue;
        const prior = other.get(row.key);
        const change = name === 'reference' ? changeOf(row, prior) : changeOf(prior, row);
        const warehouse = warehouseStyle(row, styles);
        features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [from.coordinate, to.coordinate] }, properties: {
          entityId: row.toNodeId, kind: 'assignment', layer: `${name}-${row.kind}`, comparison: name, change,
          relationId: encodeURIComponent(row.key),
          fromNodeId: row.fromNodeId, toNodeId: row.toNodeId, quantity: row.quantity, period, flowWidth: flowWidth(row.quantity, maximum),
          warehouseId: warehouse?.id || '', color: warehouse?.color || '#63758b'
        } });
      }
    };
    attach('reference', original, planned);
    attach('candidate', planned, original);
    const chosen = new Set(candidate?.selectedSiteIds || candidate?.selectedSites?.map(site => site.nodeId) || []);
    const referenceSites = new Set(reference?.selectedSiteIds || reference?.selectedSites?.map(site => site.nodeId) || [...original.values()].flatMap(row => [row.fromNodeId, row.toNodeId]).filter(id => styles.has(id)));
    const entities = study.nodes.map(node => {
      const kind = role(node), rows = relations.filter(row => row.fromNodeId === node.nodeId || row.toNodeId === node.nodeId);
      const partners = [...new Set(rows.map(row => row.fromNodeId === node.nodeId ? row.toNodeId : row.fromNodeId))];
      const volume = (comparison, direction) => rows.filter(row => row.kind === direction).reduce((sum, row) => sum + row[comparison === 'reference' ? 'before' : 'after'], 0);
      const shown = visible(node), selectedSite = kind === 'facility' && (mode === 'REFERENCE' ? referenceSites : chosen).has(node.nodeId);
      if (shown && (!nodeId || node.nodeId === nodeId || relations.some(row => row.fromNodeId === node.nodeId || row.toNodeId === node.nodeId))) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: node.coordinate }, properties: {
        entityId: node.nodeId, kind, layer: kind === 'supplier' ? 'suppliers' : kind === 'facility' ? 'facilities' : 'demands',
        label: node.name, selected: selectedSite, facilityRole: kind === 'facility' ? selectedSite ? 'selected' : 'existing' : undefined,
        referenceSelected: referenceSites.has(node.nodeId), candidateSelected: chosen.has(node.nodeId),
        color: kind === 'supplier' ? '#9a6632' : kind === 'facility' ? styles.get(node.nodeId).color : '#47778a'
      } });
      return { id: node.nodeId, kind, symbol: kind === 'supplier' ? '◆' : kind === 'facility' ? '□' : '○', label: node.name || node.nodeId,
        coordinate: shown ? [...node.coordinate] : null,
        candidateSelected: kind === 'facility' && chosen.has(node.nodeId),
        warehouseColor: styles.get(node.nodeId)?.color, relationIds: rows.map(row => row.relationId),
        summary: `${c[kind]} · ${partners.length} ${c.serves}${shown ? '' : ` · ${c.unknown}`}`,
        facts: [[c.role, roleLabel(node, locale)], [c.inbound, `${fmt(volume('reference', 'inbound'))} → ${fmt(volume('candidate', 'inbound'))} ${study.unit || ''}`],
          [c.outbound, `${fmt(volume('reference', 'outbound'))} → ${fmt(volume('candidate', 'outbound'))} ${study.unit || ''}`],
          [c.basis, distanceLabel(current?.distanceBasis || study.coordinateUse, locale)],
          [c.source, scenarioId || c.noResult]] };
    });
    const design=typeof module==='object'&&module.exports?require('./supply-chain-design-v19.js'):globalThis.STCTPlatformV19?.supplyChainDesign;
    const basis=current?.distanceBasis||'GEOGRAPHIC_SCREENING',lookup=Array.isArray(study.distanceRows)?design?.distanceIndex(study,basis):new Map();
    const coverageRows=candidate&&lookup?[...new Set(study.periodDemand?.map(row=>row.customerNodeId)||[])].map(id=>({nodeId:id,label:nodes.get(id)?.name||id,sites:[...chosen].map(siteId=>{const value=design.resolveDistance(study,lookup,siteId,id,basis);return {siteId,distanceKm:value?.distanceKm??null,travelSeconds:value?.travelSeconds??null,quality:value?.quality??'UNKNOWN',source:value?.source??null};})})):[];
    const referenceLabel = referenceCandidate ? 'CANDIDATE_COMPARISON' : joint && scope === 'FULL_CHAIN' ? 'SAME_CONDITION_PLANNING_REFERENCE' : scope === 'UPSTREAM_ONLY' ? 'OBSERVED_KNOWN_INBOUND' : 'OBSERVED_BASELINE';
    const layers = [{ id: 'suppliers', label: c.supplier }, { id: 'facilities', label: c.facility }, { id: 'demands', label: c.customer }];
    for (const [name, title] of [['reference', locale === 'zh' ? '参照' : locale === 'ja' ? '参照' : 'Reference'], ['candidate', locale === 'zh' ? '候选' : locale === 'ja' ? '候補' : 'Candidate']]) {
      for (const [kind, label] of [['inbound', c.inbound], ['outbound', c.outbound], ['transfer', locale === 'zh' ? '中转关系' : locale === 'ja' ? '中継関係' : 'Transfer relation']]) {
        if (scope === 'UPSTREAM_ONLY' && kind === 'outbound' || scope === 'OUTBOUND_ONLY' && kind === 'inbound') continue;
        layers.push({ id: `${name}-${kind}`, label: `${title} · ${label}` });
      }
    }
    return { owner: 'SUPPLY', features, entities, layers, relations, receiverComparisons: receiverComparisons(allRelations), flowScale, warehouseLegend: warehouseLegend(features, styles),
      coverageRows, relationContext: { scenarioName: selected?.scenarioName || selected?.name || scenarioId || c.noResult,
        reference: referenceLabel, referenceScenarioId:referenceCandidate?.scenarioId||'', periodLabel: period === 'ALL' ? (locale === 'en' ? 'All periods' : locale === 'ja' ? '全期間' : '全部期间') : period,
        distanceLabel: distanceLabel(current?.distanceBasis || study.coordinateUse, locale), mode, period, periods: [...(study.periods || [])],
        unit: study.unit || '', currency: study.currency || current?.currency || '' },
      changes: Object.fromEntries(['NEW', 'REMOVED', 'VOLUME_CHANGED', 'UNCHANGED'].map(change => [change, relations.filter(row => row.change === change).length])),
      legend: `${c.legend} ${{CANDIDATE_COMPARISON:{zh:'候选A（同一快照）',en:'Candidate A (same snapshot)',ja:'候補A（同一スナップショット）'},SAME_CONDITION_PLANNING_REFERENCE: {zh:'同条件规划参照',en:'Same-condition planning reference',ja:'同条件の計画参照'},OBSERVED_KNOWN_INBOUND: {zh:'已知供应商观察入库',en:'Known observed supplier inbound',ja:'既知供給元の観測入庫'},OBSERVED_BASELINE: {zh:'观察现状',en:'Observed baseline',ja:'観測現状'}}[referenceLabel][COPY[locale] ? locale : 'zh']} → ${scenarioId || c.noResult}; ${period === 'ALL' ? study.periods?.join(', ') || '—' : period}.`,
      provenance: { studyId: study.studyId, studyHash: study.inputHash, snapshotHash: current?.snapshotHash || null, reference: referenceLabel,
        selectedScenarioId: scenarioId, referenceScenarioId:referenceCandidate?.scenarioId||'', analysisScope: scope, distanceBasis: current?.distanceBasis || null, period, mode, leg, changeFilter, nodeId,
        referenceRelations: original.size, candidateRelations: planned.size, geometry: 'BUSINESS_RELATION_ONLY_NOT_ROAD_ROUTE',
        missingCoordinates: entities.filter(entity => entity.summary.includes(c.unknown)).length, basemap: 'RUNTIME_CONFIGURED_DISPLAY_ONLY' }
    };
  }

  function analysisValue(row,metric){
    const side=row.afterMetrics?.quantity>0?row.afterMetrics:row.beforeMetrics;
    return metric==='quantity'?Math.max(row.before,row.after):side?.distanceCoverage===1&&Number.isFinite(side.weightedKm)?side.weightedKm:null;
  }
  // One CPU predicate feeds distribution, map emphasis, details and local metrics. It never edits results.
  function analyticalProjection(model,options={}){
    const scope=['NETWORK','SELECTED','VIEWPORT'].includes(options.scope)?options.scope:'NETWORK';
    const ids=scope==='VIEWPORT'?selectArea(model,options.bounds):scope==='SELECTED'?options.ids||[]:model.entities.map(e=>e.id);
    const base=analyzeSelection(model,ids,options.direction||'ANY');
    const ranges=options.ranges||{},kind=options.kind||'ALL';
    const rows=base.relations.filter(row=>{
      if(kind!=='ALL'&&row.kind!==kind)return false;
      return ['distance','quantity'].every(metric=>{
        const filter=ranges[metric];if(!filter)return true;const value=analysisValue(row,metric);
        if(filter.unknown)return value===null;
        return value!==null&&value>=filter.min&&(filter.max===null||value<filter.max);
      });
    });
    const bins=(metric,edges)=>edges.map((min,i)=>({metric,min,max:edges[i+1]??null,unknown:false,count:base.relations.filter(row=>{const v=analysisValue(row,metric);return v!==null&&v>=min&&(edges[i+1]===undefined||v<edges[i+1]);}).length})).concat([{metric,unknown:true,min:null,max:null,count:base.relations.filter(row=>analysisValue(row,metric)===null).length}]);
    const max=Math.max(1,...base.relations.map(row=>analysisValue(row,'quantity')||0)),step=max/4;
    const summary=analyzeSelection({...model,relations:rows},model.entities.map(e=>e.id));
    return {...summary,scope,totalRelations:model.relations.length,scopeRelations:base.relations.length,
      distributions:{distance:bins('distance',[0,50,100,200,500,1000]),quantity:bins('quantity',[0,step,step*2,step*3])},
      filters:structuredClone({ranges,kind}),missingMappedRelations:rows.filter(row=>!row.mapped).length};
  }
  function pointOnEdge(point,a,b){
    const cross=(point[1]-a[1])*(b[0]-a[0])-(point[0]-a[0])*(b[1]-a[1]);
    return Math.abs(cross)<1e-10&&point[0]>=Math.min(a[0],b[0])&&point[0]<=Math.max(a[0],b[0])&&point[1]>=Math.min(a[1],b[1])&&point[1]<=Math.max(a[1],b[1]);
  }
  function ringContains(point,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[j],b=ring[i];if(pointOnEdge(point,a,b))return 'BOUNDARY';
    if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }return inside;}
  function regionPolygons(value){
    // RFC 7946 omits CRS and uses longitude/latitude. Explicit legacy declarations must agree.
    const checkCrs=object=>{
      if(!object||!Object.prototype.hasOwnProperty.call(object,'crs'))return;
      const crs=object.crs,name=crs?.type==='name'&&typeof crs.properties?.name==='string'?crs.properties.name.trim().toUpperCase():'';
      if(!['WGS84','WGS 84','EPSG:4326','OGC:CRS84','CRS84','URN:OGC:DEF:CRS:OGC:1.3:CRS84'].includes(name)&&
        !/^URN:OGC:DEF:CRS:EPSG:(?:\d+(?:\.\d+)*)?:4326$/.test(name)&&
        !/^HTTPS?:\/\/WWW\.OPENGIS\.NET\/DEF\/CRS\/(?:EPSG\/0\/4326|OGC\/1\.3\/CRS84)$/.test(name))throw new Error('REGION_CRS_UNSUPPORTED');
    };
    checkCrs(value);
    const features=value?.type==='FeatureCollection'?value.features:value?.type==='Feature'?[value]:[{geometry:value}];
    if(!Array.isArray(features)||features.length>100)throw new Error('REGION_GEOMETRY_INVALID');
    for(const feature of features){checkCrs(feature);checkCrs(feature?.geometry);}
    const polygons=features.flatMap(f=>f.geometry?.type==='Polygon'?[f.geometry.coordinates]:f.geometry?.type==='MultiPolygon'?f.geometry.coordinates:(()=>{throw new Error('REGION_GEOMETRY_INVALID');})());
    let count=0;for(const polygon of polygons){if(!Array.isArray(polygon)||!polygon.length)throw new Error('REGION_GEOMETRY_INVALID');for(const ring of polygon){if(!Array.isArray(ring)||ring.length<4||JSON.stringify(ring[0])!==JSON.stringify(ring.at(-1))||ring.some(p=>!validCoordinate(p))||(count+=ring.length)>10000)throw new Error('REGION_GEOMETRY_INVALID');
      if(ring.length>1000)throw new Error('REGION_RING_LIMIT_1000');
      const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
      for(let i=0;i<ring.length-1;i++){if(Math.abs(ring[i][0]-ring[i+1][0])>180)throw new Error('REGION_DATELINE_UNSUPPORTED');for(let j=i+2;j<ring.length-1;j++){if(i===0&&j===ring.length-2)continue;const a=ring[i],b=ring[i+1],c=ring[j],d=ring[j+1];if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0||pointOnEdge(a,c,d)||pointOnEdge(b,c,d)||pointOnEdge(c,a,b)||pointOnEdge(d,a,b))throw new Error('REGION_SELF_INTERSECTION');}}
    }}
    return polygons;
  }
  function regionMembers(model,geojson,rule='EITHER'){
    const polygons=regionPolygons(geojson),inside=point=>validCoordinate(point)&&polygons.some(poly=>{
      const exterior=ringContains(point,poly[0]);if(exterior==='BOUNDARY')return true;if(!exterior)return false;
      for(const hole of poly.slice(1)){const state=ringContains(point,hole);if(state==='BOUNDARY')return true;if(state)return false;}return true;
    });
    const ids=new Set(model.entities.filter(e=>inside(e.coordinate)).map(e=>e.id));
    return model.relations.filter(row=>rule==='ORIGIN'?ids.has(row.fromNodeId):rule==='DESTINATION'?ids.has(row.toNodeId):ids.has(row.fromNodeId)||ids.has(row.toNodeId)).map(row=>row.relationId);
  }
  function fixedGrid(model,rows,kind='outbound',size=1){
    if(![.25,.5,1,2,5].includes(size))throw new Error('GRID_SIZE_INVALID');
    const nodes=new Map(model.entities.map(e=>[e.id,e])),cells=new Map(),missing=[];
    for(const row of rows.filter(row=>row.kind===kind)){
      const coordinate=nodes.get(row.toNodeId)?.coordinate;if(!validCoordinate(coordinate)){missing.push(row);continue;}
      const x=Math.min(Math.ceil(360/size)-1,Math.floor((coordinate[0]+180)/size)),y=Math.min(Math.ceil(180/size)-1,Math.floor((coordinate[1]+90)/size)),key=`${x}|${y}`;
      const cell=cells.get(key)||{key,bounds:[x*size-180,y*size-90,Math.min(180,(x+1)*size-180),Math.min(90,(y+1)*size-90)],before:0,after:0,relationIds:[],nodeIds:[]};
      cell.before+=row.before;cell.after+=row.after;cell.relationIds.push(row.relationId);cell.nodeIds.push(row.toNodeId);cells.set(key,cell);
    }
    return {size,kind,cells:[...cells.values()].map(cell=>({...cell,delta:cell.after-cell.before,nodeIds:[...new Set(cell.nodeIds)]})),missingRelations:missing.map(row=>row.relationId),missingBefore:missing.reduce((n,r)=>n+r.before,0),missingAfter:missing.reduce((n,r)=>n+r.after,0)};
  }
  function coverage(model,limit,metric='distanceKm'){
    if(!Number.isFinite(limit)||limit<0||!['distanceKm','travelSeconds'].includes(metric))throw new Error('COVERAGE_THRESHOLD_INVALID');
    return (model.coverageRows||[]).map(row=>{const known=row.sites.filter(site=>Number.isFinite(site[metric])&&site[metric]>=0),reachable=known.filter(site=>site[metric]<=limit),unknown=row.sites.length-known.length;
      return {...row,reachable:reachable.map(site=>site.siteId),unknown,status:reachable.length>1?'OVERLAP':reachable.length===1?'REACHABLE':unknown||!row.sites.length?'UNKNOWN':'OUTSIDE'};});
  }
  function distanceQuality(rows){
    const groups=new Map();for(const row of rows){const key=row.distanceQuality||'UNKNOWN',g=groups.get(key)||{quality:key,records:0,quantity:0,sources:new Set(),timestamps:new Set(),strategies:new Set()};g.records++;g.quantity+=row.quantity;for(const [field,target]of [['distanceSource','sources'],['distanceTimestamp','timestamps'],['distanceStrategy','strategies']])if(row[field]!=null)g[target].add(row[field]);groups.set(key,g);}
    return [...groups.values()].map(g=>({...g,sources:[...g.sources],timestamps:[...g.timestamps],strategies:[...g.strategies]}));
  }
  return Object.freeze({ project, projectComparison, selectArea, rectangleBounds, analyzeSelection, candidateCoverage, flowWidth, exploreRelations, analyticalProjection, analysisValue, regionMembers, regionPolygons, fixedGrid, distanceQuality, coverage });
});
