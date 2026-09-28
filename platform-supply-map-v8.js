(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root.document) (root.STCTPlatformV19 = root.STCTPlatformV19 || {}).supplyMap = api;
})(globalThis, function () {
  'use strict';

  const COPY = {
    zh: { supplier: '供应商', facility: '仓库', customer: '送货地', role: '节点角色', volume: '关联物量', serves: '关联对象', basis: '距离口径', source: '结果来源', unknown: '坐标未确认或缺失，仅在列表显示', outbound: '仓→送货地分配关系', inbound: '供应商→仓供货关系', legend: '连线是业务分配关系，不是道路路线；距离与费用以结果账本为准。', current: '当前重点方案', noResult: '尚无当前有效结果，只显示节点' },
    en: { supplier: 'Supplier', facility: 'Warehouse', customer: 'Delivery location', role: 'Node role', volume: 'Related volume', serves: 'Related entities', basis: 'Distance basis', source: 'Result source', unknown: 'Coordinate unconfirmed or missing; list only', outbound: 'Warehouse→location assignment', inbound: 'Supplier→warehouse supply', legend: 'Lines show business relations, not road routes; use the result ledger for distance and cost.', current: 'Current focus scenario', noResult: 'No current verified result; showing nodes only' },
    ja: { supplier: '供給元', facility: '倉庫', customer: '配送先', role: '拠点の役割', volume: '関連物量', serves: '関連先', basis: '距離の基準', source: '結果の出典', unknown: '座標が未確認または欠落。リストのみ表示', outbound: '倉庫→配送先の割当関係', inbound: '供給元→倉庫の供給関係', legend: '線は業務上の関係であり道路ルートではありません。距離と費用は結果台帳を参照してください。', current: '現在の主要案', noResult: '有効な結果はありません。拠点のみ表示' }
  };
  const role = node => ['FACTORY', 'SUPPLIER', 'EXTERNAL_SOURCE'].includes(node.role) ? 'supplier' : ['DC', 'WAREHOUSE', 'TRANSFER'].includes(node.role) ? 'facility' : 'customer';
  const validCoordinate = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
  const pairKey = (from, to) => `${from}\u0000${to}`;

  function project(study, snapshot, locale = 'zh') {
    if (!study || !Array.isArray(study.nodes)) throw new Error('SUPPLY_MAP_STUDY_REQUIRED');
    const c = COPY[locale] || COPY.zh;
    const current = snapshot?.studyHash === study.inputHash ? snapshot : null;
    const focusId = current?.decision?.focusScenarioId || null;
    const focus = focusId ? current.rows?.find(row => row.scenarioId === focusId) : null;
    const result = focus?.result || focus || null;
    const coordinateAllowed = node => (node.coordinateSystem === 'WGS84' || study.coordinateUse === 'ASSUMED_WGS84_SCREENING') && validCoordinate(node.coordinate);
    const nodes = new Map(study.nodes.map(node => [node.nodeId, node]));
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
      if (coordinateAllowed(from) && coordinateAllowed(to)) {
        features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [from.coordinate, to.coordinate] }, properties: { entityId: relation.toNodeId, kind: 'assignment', layer: relation.kind, fromNodeId: relation.fromNodeId, toNodeId: relation.toNodeId, color: relation.kind === 'inbound' ? '#9a6632' : '#33869a' } });
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
      if (shown) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: node.coordinate }, properties: { entityId: node.nodeId, kind, layer: kind === 'supplier' ? 'suppliers' : kind === 'facility' ? 'facilities' : 'demands', label: node.name, selected, facilityRole: kind === 'facility' ? selected ? 'selected' : 'existing' : undefined, color: kind === 'supplier' ? '#9a6632' : kind === 'facility' ? '#16736b' : '#47778a' } });
      return { id: node.nodeId, kind, symbol: kind === 'supplier' ? '◆' : kind === 'facility' ? '□' : '○', label: node.name || node.nodeId, summary: `${c[kind]} · ${partners.length} ${c.serves}${shown ? '' : ` · ${c.unknown}`}`, facts: [[c.role, node.role], [c.inbound, `${inboundVolume.toFixed(3)} ${study.unit || ''}`], [c.outbound, `${outboundVolume.toFixed(3)} ${study.unit || ''}`], [c.serves, partners.map(id => nodes.get(id)?.name || id).join('、') || '—'], [c.basis, current?.distanceBasis || study.coordinateUse || 'UNKNOWN'], [c.source, focusId || c.noResult]] };
    });
    return {
      owner: 'SUPPLY', features, entities,
      layers: [{ id: 'suppliers', label: c.supplier }, { id: 'facilities', label: c.facility }, { id: 'demands', label: c.customer }, { id: 'inbound', label: c.inbound }, { id: 'outbound', label: c.outbound }],
      legend: `${c.legend} ${focusId ? `${c.current}: ${focusId}` : c.noResult}`,
      provenance: { studyId: study.studyId, studyHash: study.inputHash, snapshotHash: current?.snapshotHash || null, focusScenarioId: focusId, resultStatus: result?.status || 'NOT_RUN', coordinateUse: study.coordinateUse || 'UNCONFIRMED', distanceBasis: current?.distanceBasis || null, geometry: 'BUSINESS_RELATION_ONLY_NOT_ROAD_ROUTE', missingCoordinates: entities.filter(entity => entity.summary.includes(c.unknown)).length, basemap: 'RUNTIME_CONFIGURED_DISPLAY_ONLY' }
    };
  }
  return Object.freeze({ project });
});
