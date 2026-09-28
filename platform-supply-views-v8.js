(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root.document) (root.STCTPlatformV19 = root.STCTPlatformV19 || {}).platformSupplyViews = api;
})(globalThis, function () {
  'use strict';
  const ROUTES = new Set(['/design/overview', '/design/network-scenarios', '/design/cost-to-serve', '/design/demand-growth', '/design/fleet-capacity', '/design/resilience']);
  const COPY = {
    zh: { current: '当前研究', kind: '供应链网络设计', open: '打开供应链分析', scope: '研究范围', periods: '期间', demand: '分期需求', total: '总需求', records: '需求期间记录', businessRows: '业务需求', candidate: '重点候选', noResult: '尚无当前计算结果，请进入供应链分析。', stale: '输入已变化，旧结果不能作为当前结论。', overview: '供应链研究概览', scenarios: '网络候选', cost: '费用与可比范围', growth: '需求与增长', capacity: '逐期处理能力', resilience: '韧性分析范围', costUnknown: 'UNKNOWN · 适用费率或费用范围尚不完整', reference: '参照', steady: '稳态运营成本', first: '首期成本', components: '费用构成', status: '状态', source: '结果来源', objective: '排序目标', assumption: '假设费率', noCandidate: '尚无已排名的重点候选', growthAction: '逐期需求 +10% · 创建派生研究', growthNote: '逐期需求是规划物量，不是派车订单。增长需生成独立研究并重新分析；观察入库不会自动补造。', capacityNote: '这里展示各仓逐期处理量与已输入的处理能力；未知能力不等于通过，也不是库存仓容。', fleetNote: '本研究没有车辆、司机和月台排程。可检查已计算的逐期仓库处理能力，实际配车需另建运营计划。', resilienceNote: '当前供应链研究未运行订单型停仓、车辆或司机冲击模型。请在供应链分析中调整仓网、来源或约束并重新计算；月度需求不转换为派车订单。', geoNote: '地理距离不是道路路线；物量公里不是车公里。', noCostClaim: '费用缺失或不可比时，不推断实际节省。', notApplicable: '不适用于当前研究', name: '名称', sites: '仓库', volume: '物量', capacity: '能力', load: '处理量', noPeriodDemand: '本研究没有下游逐期需求，不能创建需求增长情景。', ranked: '正式排名', unranked: '未排名或不可比', viewResult: '查看完整方案与报告' },
    en: { current: 'Current study', kind: 'Supply chain network design', open: 'Open supply analysis', scope: 'Study scope', periods: 'Periods', demand: 'Period demand', total: 'Total demand', records: 'Demand-period records', businessRows: 'Business demands', candidate: 'Focus candidate', noResult: 'No current calculation result. Open supply analysis.', stale: 'Inputs changed; the old result is not a current conclusion.', overview: 'Supply study overview', scenarios: 'Network candidates', cost: 'Costs and comparison scope', growth: 'Demand & growth', capacity: 'Period capacity', resilience: 'Resilience scope', costUnknown: 'UNKNOWN · applicable rates or cost scope are incomplete', reference: 'Reference', steady: 'Steady operating cost', first: 'First-period cost', components: 'Cost components', status: 'Status', source: 'Result source', objective: 'Ranking objective', assumption: 'Assumed rates', noCandidate: 'No ranked focus candidate', growthAction: 'Period demand +10% · create derived study', growthNote: 'Period demand is planning volume, not dispatch orders. Growth creates a separate study requiring reanalysis; observed inbound is never fabricated.', capacityNote: 'This shows site throughput and entered period capacity. Unknown capacity is not a pass or storage space.', fleetNote: 'This study has no vehicle, driver or dock schedule. Review calculated site throughput here; operational dispatch requires a separate plan.', resilienceNote: 'Order-based site outages, vehicle or driver shocks have not run for this supply study. Change network, source or constraints in supply analysis and recalculate; monthly demand is not dispatched orders.', geoNote: 'Geographic distance is not a road route; volume-km is not vehicle-km.', noCostClaim: 'Missing or incomparable costs do not establish actual savings.', notApplicable: 'Not applicable to current study', name: 'Name', sites: 'Sites', volume: 'Volume', capacity: 'Capacity', load: 'Throughput', noPeriodDemand: 'This study has no downstream period demand for a growth scenario.', ranked: 'Official rank', unranked: 'Unranked or incomparable', viewResult: 'View full scenarios and report' },
    ja: { current: '現在の研究', kind: 'サプライチェーン網設計', open: 'サプライ分析を開く', scope: '研究範囲', periods: '期間', demand: '期間別需要', total: '総需要', records: '需要・期間レコード', businessRows: '業務需要', candidate: '主要候補', noResult: '現在の計算結果はありません。サプライ分析を開いてください。', stale: '入力が変わったため、古い結果は現在の結論ではありません。', overview: 'サプライ研究の概要', scenarios: 'ネットワーク候補', cost: '費用と比較範囲', growth: '需要と成長', capacity: '期間別処理能力', resilience: 'レジリエンスの範囲', costUnknown: 'UNKNOWN · 対象料金または費用範囲が不足', reference: '参照', steady: '定常運営費', first: '初期費用', components: '費用内訳', status: '状態', source: '結果の出典', objective: '順位付けの目的', assumption: '仮定料金', noCandidate: '順位付きの主要候補はありません', growthAction: '期間別需要 +10% · 派生研究を作成', growthNote: '期間需要は計画物量であり、配車注文ではありません。成長は別研究として再分析し、観測入庫は補造しません。', capacityNote: '倉庫の期間別処理量と入力済み能力を表示します。不明な能力は合格でも在庫容量でもありません。', fleetNote: 'この研究には車両・運転手・ドック計画がありません。倉庫の処理量を確認し、実際の配車は別計画で扱います。', resilienceNote: '注文型の倉庫停止・車両・運転手のショックはこの研究で実行していません。網・供給元・制約を変更して再計算してください。月次需要は配車注文に変換しません。', geoNote: '地理距離は道路経路ではなく、物量キロは車両キロではありません。', noCostClaim: '費用が不足または比較不能なら実際の節約は判断できません。', notApplicable: '現在の研究には適用されません', name: '名称', sites: '倉庫', volume: '物量', capacity: '能力', load: '処理量', noPeriodDemand: '下流の期間需要がないため成長シナリオを作成できません。', ranked: '正式順位', unranked: '順位なし・比較不能', viewResult: '全候補とレポートを見る' }
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const fmt = value => finite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 6 }) : 'UNKNOWN';
  const action = label => `<button type="button" data-design-action="navigate" data-design-id="/design/supply-chain-study">${esc(label)}</button>`;
  function amount(value, role, currency) {
    return `<strong data-v8-cost-amount="${esc(role)}" data-value="${finite(value) ? value : ''}" data-status="${finite(value) ? 'KNOWN' : 'UNKNOWN'}">${finite(value) ? `${esc(currency)} ${fmt(value)}` : 'UNKNOWN'}</strong>`;
  }
  function costSource(snapshot, focus) {
    const joint = snapshot?.schemaVersion === 'stct-supply-chain-v5-snapshot-v1';
    const scope = snapshot?.analysisScope || 'OUTBOUND_ONLY';
    const reference = joint ? scope === 'FULL_CHAIN' ? snapshot.planningReference?.metrics : snapshot.observedKnownInbound : snapshot?.baseline?.metrics;
    const candidate = joint ? focus?.metrics : focus?.result?.metrics;
    return {
      referenceLabel: joint && scope === 'FULL_CHAIN' ? 'SAME_CONDITION_PLANNING_REFERENCE' : joint ? 'OBSERVED_KNOWN_INBOUND' : 'OBSERVED_BASELINE',
      referenceCost: joint ? scope === 'FULL_CHAIN' ? reference?.operatingCost : reference?.cost : reference?.steadyStateCost,
      candidateCost: joint ? candidate?.operatingCost : candidate?.steadyStateCost,
      firstCost: candidate?.firstPeriodCost,
      referenceParts: reference?.costParts || null,
      candidateParts: candidate?.costParts || null
    };
  }
  function render(state, route, locale = 'zh') {
    if (!ROUTES.has(route)) throw Object.assign(new Error('SUPPLY_VIEW_ROUTE_UNSUPPORTED'), { code: 'SUPPLY_VIEW_ROUTE_UNSUPPORTED' });
    const t = COPY[locale] || COPY.zh;
    const study = state?.study;
    if (!study) return `<main class="design-workspace" data-design-route="${esc(route)}"><p class="design-notice">${esc(t.noResult)}</p>${action(t.open)}</main>`;
    const displayName=state.savedPointer?.inputHash===study.inputHash?state.savedPointer.name:study.name;
    const snapshot = state.snapshot && state.snapshot.studyHash === study.inputHash && !state.staleResult ? state.snapshot : null;
    const focusedId = snapshot?.decision?.focusScenarioId || null;
    const focus = focusedId ? snapshot.rows?.find(row => row.scenarioId === focusedId) : null;
    const periods = study.periods || [];
    const periodTotals = new Map(periods.map(period => [period, 0])), demandIds = new Set();
    let totalDemand = 0;
    for (const row of study.periodDemand || []) { totalDemand += row.quantity; periodTotals.set(row.period, (periodTotals.get(row.period) || 0) + row.quantity); demandIds.add(row.demandId); }
    const periodDemand = periods.map(period => ({ period, quantity: periodTotals.get(period) || 0 }));
    const backend=state.backendIdentity||snapshot?.backendIdentity;
    const selectedService=globalThis.STCTPlatformV19?.activeServiceDirectory?.describe('SUPPLY_CHAIN_PERIOD',backend);
    const backendLine=backend?`${backend.endpoint || 'UNKNOWN_ENDPOINT'} · ${backend.buildFingerprint?.slice(0,12)||'UNKNOWN_BUILD'} · ${(backend.capabilities||[]).join(', ')||'UNKNOWN_CAPABILITIES'} · ${selectedService?.status || 'UNOBSERVED'}`:`${selectedService?.endpoint || 'UNKNOWN_ENDPOINT'} · ${({zh:'尚未运行当前研究',en:'Current study not run yet',ja:'現在の研究は未実行'})[locale]||'NOT_RUN'}`;
    const current = `<section class="design-band" data-v8-current-study="SUPPLY_CHAIN_STUDY" data-study-id="${esc(study.studyId)}" data-input-hash="${esc(study.inputHash)}"><header><div><small>${esc(t.current)} · SUPPLY_CHAIN_STUDY</small><h1>${esc(displayName)}</h1></div></header><p>${esc(t.periods)}: ${esc(periods.join(', ') || '—')} · ${esc(study.classification)} · ${esc(study.unit || '—')}</p><p>${esc(t.total)}: ${fmt(totalDemand)} ${esc(study.unit)} · ${esc(t.records)}: ${study.periodDemand.length}</p><p>${esc(t.status)}: ${esc(snapshot ? state.status : state.staleResult ? 'STALE' : state.status || 'DRAFT')} · ${esc(t.scope)}: ${esc(snapshot?.analysisScope || state.scenario?.analysisScope || 'OUTBOUND_ONLY')}</p><p data-v8-backend-identity>${esc(backendLine)}</p></section>`;
    const notice = snapshot ? '' : `<p class="design-notice" role="status">${esc(state.staleResult ? t.stale : t.noResult)}</p>`;
    const candidate = focus ? `<p>${esc(t.candidate)}: <strong data-v8-focus-scenario="${esc(focusedId)}">${esc(focusedId)}</strong> · ${esc(snapshot.decision?.rankingMetric || 'UNRANKED')}</p>` : `<p>${esc(t.noCandidate)}</p>`;
    let content = '';
    if (route === '/design/overview') {
      content = `<section class="design-band"><h2>${esc(t.overview)}</h2><p>${esc(t.businessRows)}: ${demandIds.size} · ${esc(t.records)}: ${study.periodDemand.length} · ${esc(t.total)}: ${fmt(totalDemand)} ${esc(study.unit)}</p><p>${esc(t.sites)}: ${study.nodes.filter(node => ['DC', 'WAREHOUSE'].includes(node.role)).length} · ${esc(t.periods)}: ${periods.length}</p>${candidate}${notice}${action(t.open)}</section><div data-p7-map-slot data-v8-supply-map></div>`;
    } else if (route === '/design/network-scenarios') {
      const rows = snapshot?.rows || [];
      const byId = new Map(rows.map(row => [row.scenarioId, row]));
      const ranked = snapshot?.decision?.rankedScenarioIds || [];
      if (byId.size !== rows.length || new Set(ranked).size !== ranked.length || ranked.some(id => !byId.has(id))) throw Object.assign(new Error('SUPPLY_RANKING_ID_CONFLICT'), { code: 'SUPPLY_RANKING_ID_CONFLICT' });
      const ordered = [...ranked.map(id => byId.get(id)).filter(Boolean), ...rows.filter(row => !ranked.includes(row.scenarioId))];
      content = `<section class="design-band"><h2>${esc(t.scenarios)}</h2><p>${esc(t.objective)}: ${esc(snapshot?.decision?.rankingMetric || state.scenario?.objective || 'NOT_RUN')} · ${esc(t.reference)}: ${esc(snapshot?.decision?.reference || '—')}</p>${notice}<div class="design-table-wrap"><table><thead><tr><th>${esc(t.name)}</th><th>${esc(t.status)}</th><th>${esc(t.sites)}</th></tr></thead><tbody>${ordered.map(row => { const result = row.result || row, rank = ranked.indexOf(row.scenarioId); return `<tr data-v8-scenario-id="${esc(row.scenarioId)}"><th>${esc(row.scenarioId)}</th><td>${esc(rank < 0 ? t.unranked : `${t.ranked} ${rank + 1}`)} · ${esc(result.status)}</td><td>${esc((result.selectedSiteIds || result.selectedSites?.map(site => site.name || site.nodeId) || []).join(', '))}</td></tr>`; }).join('')}</tbody></table></div>${action(t.viewResult)}</section><div data-p7-map-slot data-v8-supply-map></div>`;
    } else if (route === '/design/cost-to-serve') {
      const cost = costSource(snapshot, focus), partNames = [...new Set([...Object.keys(cost.referenceParts || {}), ...Object.keys(cost.candidateParts || {})])];
      const assumed = study.rates.filter(rate => rate.status === 'ASSUMED').length;
      content = `<section class="design-band"><h2>${esc(t.cost)}</h2><p>${esc(t.reference)}: ${esc(cost.referenceLabel)} · ${esc(t.candidate)}: ${esc(focusedId || '—')} · ${esc(t.objective)}: ${esc(snapshot?.decision?.rankingMetric || 'NOT_RUN')}</p>${candidate}${notice}<div class="design-readiness-grid"><article><small>${esc(t.reference)} · ${esc(t.steady)}</small>${amount(cost.referenceCost, 'reference', study.currency)}</article><article><small>${esc(t.candidate)} · ${esc(t.steady)}</small>${amount(cost.candidateCost, 'candidate', study.currency)}</article><article><small>${esc(t.candidate)} · ${esc(t.first)}</small>${amount(cost.firstCost, 'first-period', study.currency)}</article></div><p>${esc(t.assumption)}: ${assumed} · ${esc(snapshot?.distanceBasis || snapshot?.baseline?.distanceBasis || state.scenario?.distanceBasis || 'UNKNOWN')}</p>${!finite(cost.referenceCost) || !finite(cost.candidateCost) ? `<p class="design-boundary">${esc(t.costUnknown)}. ${esc(t.noCostClaim)}</p>` : `<p class="design-boundary">${esc(t.noCostClaim)}</p>`}<h3>${esc(t.components)}</h3><div class="design-table-wrap"><table><thead><tr><th>${esc(t.name)}</th><th>${esc(t.reference)}</th><th>${esc(t.candidate)}</th></tr></thead><tbody>${partNames.map(name => `<tr><th>${esc(name)}</th><td>${amount(cost.referenceParts?.[name], `reference-${name}`, study.currency)}</td><td>${amount(cost.candidateParts?.[name], `candidate-${name}`, study.currency)}</td></tr>`).join('')}</tbody></table></div>${action(t.viewResult)}</section>`;
    } else if (route === '/design/demand-growth') {
      content = `<section class="design-band"><h2>${esc(t.growth)}</h2><p>${esc(t.total)}: <strong data-v8-demand-total="${totalDemand}">${fmt(totalDemand)} ${esc(study.unit)}</strong> · ${esc(t.records)}: ${study.periodDemand.length}</p><div class="design-table-wrap"><table><thead><tr><th>${esc(t.periods)}</th><th>${esc(t.demand)}</th></tr></thead><tbody>${periodDemand.map(row => `<tr data-v8-demand-period="${esc(row.period)}"><th>${esc(row.period)}</th><td data-value="${row.quantity}">${fmt(row.quantity)} ${esc(study.unit)}</td></tr>`).join('')}</tbody></table></div><p class="design-boundary">${esc(t.growthNote)}</p>${study.periodDemand.length ? `<button type="button" data-design-action="supply-demand-10" data-study-id="${esc(study.studyId)}" data-input-hash="${esc(study.inputHash)}">${esc(t.growthAction)}</button>` : `<p>${esc(t.noPeriodDemand)}</p>`}${action(t.open)}</section>`;
    } else if (route === '/design/fleet-capacity') {
      const capacity = focus ? (focus.result || focus).capacityByPeriod || [] : snapshot?.baseline?.capacityByPeriod || [];
      content = `<section class="design-band"><h2>${esc(t.capacity)}</h2>${candidate}${notice}<p class="design-boundary">${esc(t.capacityNote)} ${esc(t.fleetNote)}</p><div class="design-table-wrap"><table><thead><tr><th>${esc(t.sites)}</th><th>${esc(t.periods)}</th><th>${esc(t.load)}</th><th>${esc(t.capacity)}</th><th>${esc(t.status)}</th></tr></thead><tbody>${capacity.map(row => `<tr><th>${esc(row.siteNodeId || row.siteId)}</th><td>${esc(row.period)}</td><td>${fmt(row.throughput)}</td><td>${fmt(row.capacity)}</td><td>${esc(row.status)}</td></tr>`).join('')}</tbody></table></div>${action(t.open)}</section>`;
    } else {
      content = `<section class="design-band"><h2>${esc(t.resilience)}</h2><p class="design-boundary">${esc(t.notApplicable)} · ${esc(t.resilienceNote)}</p>${action(t.open)}</section>`;
    }
    return `<main class="design-workspace v8-supply-projection" data-design-route="${esc(route)}">${current}${content}<p class="design-boundary">${esc(t.geoNote)}</p></main>`;
  }
  return Object.freeze({ ROUTES, render });
});
