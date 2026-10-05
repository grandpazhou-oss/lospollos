(function (root, factory) {
  "use strict";
  const api = factory(typeof module === 'object' && module.exports ? require('./platform-import-session-v19.js').businessNumber : root.STCTPlatformV19?.businessNumber);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root.document) (root.STCTPlatformV19 = root.STCTPlatformV19 || {}).supplyChainReportView = api;
})(globalThis, function (Display) {
  "use strict";
  const SCHEMA = "stct-supply-chain-report-v1";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const num = value => Display.number(value);
  const pct = value => `${value > 0 ? "+" : ""}${Display.percent(value)}`;
  let localeCtx = 'zh';
  const unitZh = unit => localeCtx === 'en' ? (unit === 'm3' ? 'm³' : unit === 't' ? 't' : String(unit || 'volume')) : localeCtx === 'ja' ? (unit === 'm3' ? '立方' : unit === 't' ? 'トン' : String(unit || '物量')) : unit === 't' ? '吨' : unit === 'm3' ? '立方' : String(unit || '物量');
  const pick = (loc, zh, en, ja) => loc === 'en' ? en : loc === 'ja' ? ja : zh;
  const arr = v => Array.isArray(v) ? v : [];
  const obj = v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};

  /* 模型：纯派生。数值全部来自 snapshot/explanation；聚合仅为已定义口径的求和并附对账。 */
  function buildModel(viewState, locale = "zh") {
    const L = (zh, en, ja) => pick(locale, zh, en, ja);
    localeCtx = locale;
    const study = viewState?.study, snap = viewState?.snapshot;
    if (!study || !snap) throw Object.assign(new Error("REPORT_SNAPSHOT_REQUIRED"), { code: "REPORT_SNAPSHOT_REQUIRED" });
    const ns = globalThis.STCTPlatformV19;
    const failx = code => { throw Object.assign(new Error(code), { code }); };
    // F12：快照一致性校验——禁止新入口绕过 assertCurrent
    const joint = snap.schemaVersion === "stct-supply-chain-v5-snapshot-v1";
    const legacySnap = snap.schemaVersion === "stct-supply-chain-snapshot-v1.9";
    if (joint) { if (!ns.supplyChainV5Results || typeof ns.supplyChainV5Results.assertCurrent !== "function") failx("REPORT_SNAPSHOT_SCHEMA_UNSUPPORTED"); ns.supplyChainV5Results.assertCurrent(study, snap); }
    else if (legacySnap) { if (!ns.supplyChainReport || typeof ns.supplyChainReport.assertCurrent !== "function") failx("REPORT_SNAPSHOT_SCHEMA_UNSUPPORTED"); ns.supplyChainReport.assertCurrent(study, snap); }
    else failx("REPORT_SNAPSHOT_SCHEMA_UNSUPPORTED");

    const referenceResult=joint&&snap.analysisScope==='FULL_CHAIN'?snap.planningReference:snap.baseline;
    const selectedIds=value=>value?.selectedSiteIds||(value?.selectedSites||[]).map(x=>x.nodeId||x.siteId);
    const Explanation = ns.supplyChainExplanation;
    const ex = snap.explanation || Explanation.build(study, snap);
    const decision = snap.decision || Explanation.selection(snap);
    const projection = Explanation.comparisonProjection(snap);
    const rowsById = new Map((snap.rows || []).map(row => [row.scenarioId, row]));
    const exById = new Map((ex.rows || []).map(row => [row.scenarioId, row]));
    const periodsN = Math.max(1, (ex.periods || []).length);
    const nodesById = new Map(study.nodes.map(n => [n.nodeId, n]));
    const nameOf = id => { const n = nodesById.get(id); return (n && (n.name || n.nodeId)) || String(id || '—').split(':').slice(-1)[0]; };

    const identity = {
      schemaVersion: SCHEMA, studyId: study.studyId, studyName: study.name,
      inputHash: study.inputHash, snapshotHash: snap.snapshotHash || snap.resultHash || null,
      baselineHash: snap.baselineHash || null,
      runs: (snap.solverRuns || []).map(r => ({ scenarioId: r.scenarioId, type: r.type, attempted: r.attempted, feasible: r.feasible, timedOut: r.timedOut })),
      generatedAt: new Date().toISOString()
    };
    const capacityNote = joint ? L('已知逐期能力已进入联合求解并由结果独立校验；未知能力仍未知，不等于容量通过。', 'Known period capacities are modeled in the joint solve and independently checked; unknown capacity remains unknown.', '既知の期間別能力は連合求解と独立検証の対象です。不明な能力は未確認のままです。') : L('候选生成未建模逐期仓容量（仅候选筛选）；逐期容量已在评价层核验，未知能力仍未知。', 'Candidate generation does not model period capacity (screening only); period capacity is checked at evaluation and unknown capacity remains unknown.', '候補生成は期間別能力をモデル化していません。評価層で確認し、不明な能力は未確認のままです。');
    const scope = {
      analysisScope: snap.analysisScope || "OUTBOUND_ONLY",
      objective: snap.scenario?.objective || snap.comparisonConfig?.objective || "OUTBOUND_DISTANCE",
      distanceBasis: ex.distanceBasis, periods: ex.periods, unit: ex.unit, currency: ex.currency,
      records: ex.records, volumeKmMeaning: snap.rows?.[0]?.result?.metrics?.volumeKmMeaning || "FREIGHT_VOLUME_KM_NOT_VEHICLE_KM"
    };

    const basisZhSimple = b => b === 'GEOGRAPHIC_SCREENING' ? L('直线估算（非道路里程）', 'Straight-line screening (not road distance)', '直線見積もり（実走距離ではない）') : b === 'ESTIMATED_ROAD' ? L('估算道路距离', 'Estimated road distance', '推定道路距離') : b === 'VERIFIED_ROAD' ? L('来源声明已核验道路（核验依据需另查，货车限制未验证）', 'Source-declared verified roads (review evidence; truck restrictions unverified)', '出典による検証済道路（根拠要確認・貨車規制未検証）') : (b || '—');
    const focusId = decision.focusScenarioId;
    const focus = rowsById.get(focusId);
    const focusEx = exById.get(focusId);
    const reference = {
      kind: decision.reference,
      label: decision.reference === "SAME_CONDITION_PLANNING_REFERENCE" ? L("同条件规划参照", "Same-condition planning reference", "同条件計画参照") : L("观察现状", "Observed baseline", "現状観測"),
      outboundComparable: Boolean(focusEx?.outbound?.comparable ?? focus?.comparison?.outbound?.comparable),
      common: focusEx?.outbound || focus?.comparison?.outbound || null
    };
    const oc = focusEx?.outbound || focus?.comparison?.outbound || {};

    // 通用候选归一（F02：兼容 OUTBOUND 快照与 V5 联合快照）
    const siteCount = study.nodes.filter(n => ["DC", "WAREHOUSE"].includes(n.role)).length;
    const refSites = new Set(selectedIds(referenceResult));
    const asgB = snap.baseline?.assignments || snap.baseline?.result?.assignments || [];
    const baseAsg = new Map(asgB.map(a => [a.demandId, a.siteId]));
    const norm = row => {
      const exRow = exById.get(row.scenarioId) || {};
      const result = row.result || row;
      const sitesNames = (exRow.selectedSites || result.selectedSites || []).map(x => x.name || x.siteId || String(x));
      // F18：关闭 = 参照启用 ∩ （参照启用但候选未启用）；从未启用的候选仓不算关闭
      const selIds = new Set(selectedIds(result));
      const closedNames = (exRow.inactiveSites || study.nodes.filter(n => ["DC", "WAREHOUSE"].includes(n.role) && !selIds.has(n.nodeId)).map(n => ({ siteId: n.nodeId, name: n.name })))
        .filter(x => refSites.has(x.siteId)).map(x => x.name || x.siteId);
      const cmp = row.comparison || {};
      const ocRow = exRow.outbound || cmp.outbound || {};
      return {
        scenarioId: row.scenarioId,
        label: "",
        sitesNames, closedNames,
        beforeKm: cmp.outboundCommon?.beforeWeightedKm ?? ocRow.before?.weightedKm ?? null,
        afterKm: cmp.outboundCommon?.afterWeightedKm ?? ocRow.after?.weightedKm ?? null,
        changeRate: cmp.outboundDistanceChangeRate ?? ocRow.changeRate ?? null,
        costParts: result.metrics?.costParts ?? null,
        steadyCost: exRow.cost?.complete ? exRow.cost.steadyState : (result.metrics?.steadyStateCost ?? result.metrics?.operatingCost ?? null),
        solverStatus: result.solverEvidence?.status || result.solver?.status || row.status || null,
        changedDemands: result.solverEvidence?.actualChanged ?? result.solverEvidence?.changedDemands ?? exRow.affected?.businessRecords ?? null
      };
    };
    const cands = projection.entries.map(e => ({ entry: e, row: e.row, n: norm(e.row) }));
    for (const c of cands) c.n.label = Explanation.comparisonLabel(projection, c.entry, locale);

    // F08：改配计数=需求记录(demandId)口径；月度行只进里程分解
    const candLegs = focus?.result?.outbound || focus?.outbound || [];
    const baseLegs = referenceResult?.outbound || [];
    const affectedIds = focusEx?.affected?.demandIds || [];
    const changed = [];
    const legMatch = (legs, d) => legs.find(l => l.demandId === d.demandId && l.period === d.period && l.unit === d.unit);
    for (const demandId of affectedIds) {
      const rowsD = study.periodDemand.filter(d => d.demandId === demandId);
      for (const d of rowsD) {
        const cand = legMatch(candLegs, d), base = legMatch(baseLegs, d);
        if (cand && base && cand.fromNodeId !== base.fromNodeId) { changed.push({ demandId, from: base.fromNodeId, to: cand.fromNodeId, customer: nameOf(d.customerNodeId), customerNodeId:d.customerNodeId,quantity: d.quantity }); break; }
      }
    }
    const pairCount = {};
    for (const c of changed) { const k = nameOf(c.from) + " → " + nameOf(c.to); pairCount[k] = (pairCount[k] || 0) + 1; }
    const changedCustomerNodes = new Set(changed.map(c => c.customerNodeId)).size;

    // 指标目录（状态分维：来源/可比/完整）
    const metrics = [
      { id: "M-OUT-WKM", metricId: "M-OUT-WKM", label: L("配送物量加权距离", "Volume-weighted delivery distance", "配送物量加重距離"), value: oc.after?.weightedKm, before: oc.before?.weightedKm, unit: "km", numer: oc.after?.numeratorVolumeKm, denom: oc.after?.denominatorVolume, formula: L("平均距离 = Σ(qi*di)/Σqi（共同可比样本）", "avg distance = Σ(qi*di)/Σqi (common sample)", "平均距離 = Σ(qi*di)/Σqi（共通サンプル）"), source: "MODEL_CALC", comparable: (oc.comparable ?? reference.outboundComparable) ? "FULL" : "PARTIAL", completeness: "KNOWN" },
      { id: "M-OUT-VKM", metricId: "M-OUT-VKM", label: L("配送物量公里", "Delivery volume-km", "配送物量キロ"), value: oc.after?.numeratorVolumeKm, before: oc.before?.numeratorVolumeKm, unit: scope.unit + "·km", formula: L("Σ(物量i*距离i)", "Σ(volume_i × distance_i)", "Σ(物量i×距離i)"), source: "MODEL_CALC", comparable: (oc.comparable ?? reference.outboundComparable) ? "FULL" : "PARTIAL", completeness: "KNOWN" },
      { id: "M-COST", metricId: "M-COST", label: L("适用运营成本（稳态）", "Applicable operating cost (steady)", "適用運用コスト（定常）"), value: focusEx?.cost?.complete ? focusEx.cost.steadyState : null, unit: scope.currency, formula: L("全部适用费用项合计（含固定/处理/运输/适用中转库存）", "sum of all applicable cost items (fixed/handling/transport/applicable transfer & inventory)", "全適用費用項目合計（固定/荷役/輸送/該当中継・在庫）"), source: focusEx?.cost?.complete ? "MODEL_CALC" : "UNKNOWN", comparable: focusEx?.cost?.complete ? "FULL" : "NONE", completeness: focusEx?.cost?.complete ? "KNOWN" : "MISSING" },
      { id: "M-CHANGED", metricId: "M-CHANGED", label: L("受影响需求记录", "Affected demand records", "影響需要記録"), value: changed.length, unit: L("条", "records", "件"), source: "MODEL_CALC", comparable: "FULL", completeness: "KNOWN" }
    ];

    // 差额分解（F08：需求ID级对齐）+ 对账
    // 腿对齐用队列（键=客户节点|期间|物量），同节点多需求不互相覆盖（F08 反例）
    const legKey = l => JSON.stringify([l.demandId,l.period,l.unit]);
    const baseMap = new Map();
    for (const l of baseLegs) { const k = legKey(l); if (!baseMap.has(k)) baseMap.set(k, []); baseMap.get(k).push(l); }
    const deltas = [];
    for (const leg of candLegs) {
      const queue = baseMap.get(legKey(leg));
      const old = queue && queue.length ? queue.shift() : null;
      if (!old) continue;
      if(leg.volumeKm==null||old.volumeKm==null)continue;
      const delta = leg.volumeKm - old.volumeKm;
      if (Math.abs(delta) > 1e-9) deltas.push({ demandId:leg.demandId,unit:leg.unit,customerName: nameOf(leg.toNodeId), customerId: leg.toNodeId, period: leg.period, fromOldName: nameOf(old.fromNodeId), fromNewName: nameOf(leg.fromNodeId), quantity: leg.quantity, deltaVolumeKm: delta });
    }
    const gains = deltas.filter(d => d.deltaVolumeKm < 0).sort((a, b) => a.deltaVolumeKm - b.deltaVolumeKm);
    const losses = deltas.filter(d => d.deltaVolumeKm > 0).sort((a, b) => b.deltaVolumeKm - a.deltaVolumeKm);
    const deltaSum = deltas.reduce((t, d) => t + d.deltaVolumeKm, 0);
    const deltaRef = (oc.after?.numeratorVolumeKm != null && oc.before?.numeratorVolumeKm != null) ? oc.after.numeratorVolumeKm - oc.before.numeratorVolumeKm : null;
    // 对账容差：相对 1e-6 为主，绝对项保护浮点累积但不超过 |deltaRef| 的 1%（避免小数值下容差过宽误判一致）
    const isReconciled = deltaRef == null ? null : Math.abs(deltaSum - deltaRef) < Math.abs(deltaRef) * 1e-6 + Math.min(1, Math.abs(deltaRef) * 0.01);

    // F05：全适用费用账——以 evaluatePortfolio 的稳态适用费用合计为准（未知≠0；缺项即不完整）
    const refSteady = referenceResult?.metrics?.steadyStateCost ?? referenceResult?.metrics?.operatingCost ?? snap.observedKnownInbound?.cost ?? null;
    const candSteady = focusEx?.cost?.complete ? focusEx.cost.steadyState : ((focus?.result||focus)?.metrics?.steadyStateCost ?? (focus?.result||focus)?.metrics?.operatingCost ?? null);
    const costComplete = candSteady != null && refSteady != null;
    const costDeltaPeriod = costComplete ? (candSteady - refSteady) / periodsN : null;

    // 关仓候选：关闭=（焦点启用 − 候选启用）相对推荐方案的关仓动作（F05 判定口径=相对焦点方案）；
    // F18 安全：只有焦点/参照真启用过的仓才可能被"关闭"，从未开业的候选仓不进此表。
    const focusSel = new Set(selectedIds(focus?.result||focus));
    const closures = cands.filter(c => c.row.scenarioId !== focusId).map(c => {
      const selC = new Set(selectedIds(c.row.result||c.row));
      const closedVsFocus = [...focusSel].filter(id => !selC.has(id)).map(id => nameOf(id));
      if (!closedVsFocus.length) return null;
      const ocC = (exById.get(c.row.scenarioId) || {}).outbound || c.row.comparison?.outbound || {};
      const cSteady = c.n.steadyCost;
      const cParts = c.n.costParts, fParts = (focus?.result||focus)?.metrics?.costParts || null;
      const partialOk = cParts && fParts && cParts.outboundTransport != null && fParts.outboundTransport != null;
      return {
        scenarioId: c.row.scenarioId,
        closedSites: closedVsFocus,
        transportPenaltyVkm: (ocC.after?.numeratorVolumeKm != null && oc.after?.numeratorVolumeKm != null) ? (ocC.after.numeratorVolumeKm - oc.after.numeratorVolumeKm) / periodsN : null,
        transportPenaltyCost: partialOk ? ((cParts.outboundTransport || 0) + (cParts.inboundTransport || 0) - (fParts.outboundTransport || 0) - (fParts.inboundTransport || 0)) / periodsN : null,
        fixedSaving: partialOk ? ((fParts.fixedOperating || 0) - (cParts.fixedOperating || 0)) / periodsN : null,
        handlingDeltaCost: partialOk && cParts.handling != null && fParts.handling != null ? (cParts.handling - fParts.handling) / periodsN : null,
        costDeltaPeriod: (cSteady != null && candSteady != null) ? (cSteady - candSteady) / periodsN : null,
        costComplete: cSteady != null && candSteady != null,
        comparison: "VS_FOCUS"
      };
    }).filter(Boolean);

    // 结论文案（F01：全部数字与名称来自投影，无任何硬编码）
    const distPctAbs = Display.number(Math.abs(Number(oc.changeRate ?? 0) * 100));
    const distImproved = (oc.changeRate ?? 0) < 0;
    const costBetter = costComplete && costDeltaPeriod < 0;
    let conclusionText, conclusionTalk;
    if (!reference.outboundComparable) {
      conclusionText = L("共同可比范围不足，不输出全网改善率；请先核对距离覆盖与样本一致性。", "Comparable scope is insufficient; no network-wide improvement rate is shown. Check distance coverage and sample consistency first.", "共通比較範囲が不足のため全体改善率は出しません。距離カバレッジとサンプル整合を先に確認してください。");
      conclusionTalk = L("这份比较的样本对不上，我不给整体改善结论——先补数据再谈。", "The samples do not line up, so I will not give an overall improvement conclusion — let us fix the data first.", "サンプルが揃っていないため全体改善の結論は出しません。まずデータを整えましょう。");
    } else if (!distImproved && !costComplete) {
      conclusionText = L(`候选未改善配送里程（${pct(oc.changeRate)}），且费用未核验；建议维持现状归属。`, `The candidate does not improve delivery distance (${pct(oc.changeRate)}) and cost is unverified; keeping current assignments is advised.`, `候補は配送距離を改善せず（${pct(oc.changeRate)}）、コストも未検証です。現状維持を推奨します。`);
      conclusionTalk = L("现有分配已经接近最优，建议先不动。", "The current assignment is already near optimal — best to leave it as is.", "現行の割当はほぼ最適です。まずは変えないことを推奨します。");
    } else if (distImproved && costComplete && costBetter) {
      conclusionText = L(`把 ${changed.length} 条需求记录改由更近的仓服务，平均配送距离 ${num(oc.before?.weightedKm)} → ${num(oc.after?.weightedKm)} 公里（改善 ${distPctAbs}%），已知可比费用同步下降（每期约 ${num(-costDeltaPeriod)} ${scope.currency}）。`, `Reassigning ${changed.length} demand records to nearer sites cuts average delivery distance from ${num(oc.before?.weightedKm)} to ${num(oc.after?.weightedKm)} km (${distPctAbs}% better), and known comparable cost drops accordingly (about ${num(-costDeltaPeriod)} ${scope.currency} per period).`, `${changed.length} 件の需要記録をより近い倉庫に振り替えると、平均配送距離は ${num(oc.before?.weightedKm)} → ${num(oc.after?.weightedKm)} km（${distPctAbs}% 改善）、既知の比較可能コストも同期間あたり約 ${num(-costDeltaPeriod)} ${scope.currency} 減ります。`);
      conclusionTalk = L(`运输里程和已知费用都改善——把 ${changed.length} 条需求记录改由更近的仓发，里程省 ${distPctAbs}%，每期已知费用省约 ${num(-costDeltaPeriod)}。`, `Both distance and known cost improve — ship the ${changed.length} changed records from nearer sites: ${distPctAbs}% less distance, about ${num(-costDeltaPeriod)} saved per period.`, `距離も既知コストも改善します。${changed.length} 件を近い倉庫から発送し、距離 ${distPctAbs}% 削減、期間あたり約 ${num(-costDeltaPeriod)} の節約です。`);
    } else if (distImproved && costComplete && !costBetter) {
      conclusionText = L(`候选缩短配送里程（${distPctAbs}%），但已知可比费用每期增加约 ${num(costDeltaPeriod)} ${scope.currency}——是运输与费用的真实权衡，不构成费用优化。`, `The candidate cuts delivery distance (${distPctAbs}%) but raises known comparable cost by about ${num(costDeltaPeriod)} ${scope.currency} per period — a genuine distance/cost trade-off, not a cost saving.`, `候補は配送距離を ${distPctAbs}% 短縮しますが、既知の比較可能コストは期間あたり約 ${num(costDeltaPeriod)} ${scope.currency} 増えます。距離とコストのトレードオフであり、コスト最適化ではありません。`);
      conclusionTalk = L(`里程省了 ${distPctAbs}%，但算上处理等费用后每期反而多花约 ${num(costDeltaPeriod)}——这是取舍，不是省钱。`, `Distance drops ${distPctAbs}%, but with handling and other costs you spend about ${num(costDeltaPeriod)} more per period — that is a trade-off, not a saving.`, `距離は ${distPctAbs}% 減りますが、荷役等を含めると期間あたり約 ${num(costDeltaPeriod)} 余計にかかります。これはトレードオフであり節約ではありません。`);
    } else if (distImproved) {
      conclusionText = L(`把 ${changed.length} 条需求记录改由更近的仓服务，平均配送距离 ${num(oc.before?.weightedKm)} → ${num(oc.after?.weightedKm)} 公里（改善 ${distPctAbs}%）；费用与容量尚未核验，不构成费用结论。`, `Reassigning ${changed.length} demand records to nearer sites cuts average delivery distance from ${num(oc.before?.weightedKm)} to ${num(oc.after?.weightedKm)} km (${distPctAbs}% better); cost and capacity are not yet verified, so no cost conclusion is drawn.`, `${changed.length} 件の需要記録を近い倉庫に振り替えると平均配送距離は ${num(oc.before?.weightedKm)} → ${num(oc.after?.weightedKm)} km（${distPctAbs}% 改善）。コストと容量は未検証のため費用結論は出しません。`);
      conclusionTalk = L(`运输里程还能省约 ${distPctAbs}%——但费用和仓库吞吐没核实前，我不说它省钱。`, `Transport distance can drop about ${distPctAbs}% — but I will not call it a saving until cost and site throughput are verified.`, `輸送距離は約 ${distPctAbs}% 削減できますが、コストと倉庫スループットの検証前は節約とは言えません。`);
    } else {
      conclusionText = L("结论待定：请核对候选状态与可比范围。", "Conclusion pending: please check candidate status and comparable scope.", "結論保留：候補の状態と比較範囲をご確認ください。");
      conclusionTalk = L("这轮数据还不足以下结论。", "This round of data is not enough for a conclusion.", "今回のデータでは結論に不足しています。");
    }

    if(joint){
      const cmp=focus?.comparison||{},upstream=snap.analysisScope==='UPSTREAM_ONLY';
      const segment=L(`入库加权距离 ${num(cmp.inbound?.before)} → ${num(cmp.inbound?.after)} km`, `Inbound weighted distance ${num(cmp.inbound?.before)} → ${num(cmp.inbound?.after)} km`, `入庫加重距離 ${num(cmp.inbound?.before)} → ${num(cmp.inbound?.after)} km`);
      const total=L(`配送 ${num(oc.before?.weightedKm)} → ${num(oc.after?.weightedKm)} km；两端物量公里 ${num(cmp.totalVolumeKmBefore)} → ${num(cmp.totalVolumeKmAfter)}`, `Delivery ${num(oc.before?.weightedKm)} → ${num(oc.after?.weightedKm)} km; combined volume-km ${num(cmp.totalVolumeKmBefore)} → ${num(cmp.totalVolumeKmAfter)}`, `配送 ${num(oc.before?.weightedKm)} → ${num(oc.after?.weightedKm)} km、合計物量キロ ${num(cmp.totalVolumeKmBefore)} → ${num(cmp.totalVolumeKmAfter)}`);
      conclusionText=Explanation.decisionText(snap,locale)+' '+segment+(upstream?'。':'；'+total+'。')+' '+L('各段可变好或变差；地理改善不是费用节省，未知来源未补造。','Segments may improve or worsen; geographic improvement is not cost savings. Unknown origins remain excluded.','各輸送段は改善も悪化も可能です。地理改善は費用削減ではなく、不明供給元は補完しません。');
      conclusionTalk=conclusionText;
      metrics.push({metricId:'M-IN-WKM',label:L('入库加权距离','Weighted inbound distance','入庫加重距離'),before:cmp.inbound?.before,value:cmp.inbound?.after,unit:'km',source:'MODEL_CALC',comparable:cmp.inbound?.comparable?'FULL':'NONE',completeness:cmp.inbound?.after==null?'MISSING':'KNOWN'});
      if(!upstream)metrics.push({metricId:'M-TWO-VKM',label:L('两端物量公里','Combined volume-km','合計物量キロ'),before:cmp.totalVolumeKmBefore,value:cmp.totalVolumeKmAfter,unit:scope.unit+'·km',source:'MODEL_CALC',comparable:cmp.totalVolumeKmBefore!=null?'FULL':'NONE',completeness:cmp.totalVolumeKmAfter==null?'MISSING':'KNOWN'});
    }else if(decision.kind==='KEEP_REFERENCE'){conclusionText=Explanation.decisionText(snap,locale)+' '+conclusionText;conclusionTalk=conclusionText;}
    const minChangeRow = cands.filter(c => (c.n.changedDemands ?? 0) > 0).sort((a, b) => a.n.changedDemands - b.n.changedDemands)[0] || null;
    const findings = [
      { findingId: "F-01", chapter: 1, title: L("结论与建议", "Conclusion & recommendation", "結論と提言"), text: conclusionText, talk: conclusionTalk, metrics: ["M-OUT-WKM", "M-COST"], limits: [L(`本口径为物量公里代理（${unitZh(scope.unit)}×公里），不含运输频次，不等于车次`, `This metric is a volume-km proxy (${unitZh(scope.unit)}×km); it excludes trip frequency and is not vehicle count`, `本指標は物量キロの代理指標（${unitZh(scope.unit)}×km）で、運行回数を含まず車両台数ではありません`), L(`距离口径：${basisZhSimple(ex.distanceBasis)}`, `Distance basis: ${basisZhSimple(ex.distanceBasis)}`, `距離基準：${basisZhSimple(ex.distanceBasis)}`)], reviewStatus: "DRAFT" },
      { findingId: "F-02", chapter: 2, title: L("网络怎么变", "How the network changes", "ネットワークの変化"),
        text: L(`仓库启用 ${cands.find(c=>c.row.scenarioId===focusId)?.n.sitesNames.length ?? 0} 个（参照启用 ${refSites.size || "—"} 个）；${changed.length} 条需求记录换服务仓，涉及 ${changedCustomerNodes} 个客户节点（记录与客户为不同口径）。${Object.entries(pairCount).length ? `主要流向：${Object.entries(pairCount).map(([k, v]) => k + " " + v + " 条记录").join("；")}。` : ""}${closures.length ? `另有 ${closures.length} 个关仓候选单列于下方参考区。` : ""}`, `${cands.find(c=>c.row.scenarioId===focusId)?.n.sitesNames.length ?? 0} sites enabled (${refSites.size || "—"} in the reference); ${changed.length} demand records move to another site, covering ${changedCustomerNodes} customer nodes (records and customers are different counts).${Object.entries(pairCount).length ? ` Main flows: ${Object.entries(pairCount).map(([k, v]) => k + " " + v + " records").join("; ")}.` : ""}${closures.length ? ` ${closures.length} closure candidate(s) are listed separately below.` : ""}`, `稼働倉庫 ${cands.find(c=>c.row.scenarioId===focusId)?.n.sitesNames.length ?? 0} 件（参照 ${refSites.size || "—"} 件）。${changed.length} 件の需要記録が担当倉庫を変更、${changedCustomerNodes} 顧客ノード（記録と顧客は別カウント）。${Object.entries(pairCount).length ? ` 主な流れ：${Object.entries(pairCount).map(([k, v]) => k + " " + v + " 件").join("；")}。` : ""}${closures.length ? ` ほかに ${closures.length} 件の閉鎖候補を下部に別掲。` : ""}`),
        talk: L("网络结构基本没动，动的是需求记录的服务仓归属。注意：改配条数是需求记录数，不是客户家数。", "The network structure barely changes; what moves is which site serves each demand record. Note: reassignment counts are demand records, not customer counts.", "ネットワーク構造はほぼ変わりません。変わるのは需要記録の担当倉庫です。件数は需要記録ベースで、顧客数ではありません。"),
        metrics: ["M-CHANGED"], limits: [L("关系线为服务关系示意图，非实际行驶路线", "Link lines illustrate service relationships, not actual routes", "関係線はサービス関係の模式図で、実際の走行経路ではありません")], reviewStatus: "DRAFT" },
      { findingId: "F-03", chapter: 3, title: L("为什么推荐这个方案", "Why this plan is recommended", "この案を推奨する理由"),
        text: L(`正式排序：${Explanation.metricLabel(decision.rankingMetric || "OUTBOUND_VOLUME_KM", locale)}；本方案在同口径候选集（${(decision.rankedScenarioIds || []).length} 个）中排第 ${Math.max(1, (decision.rankedScenarioIds || []).indexOf(focusId) + 1)} 位。${minChangeRow ? `另有"最小改动"版本：只调 ${minChangeRow.n.changedDemands ?? "少量"} 条记录，里程改善约 ${Display.number(Math.abs(Number(minChangeRow.n.changeRate ?? 0) * 100))}%。` : ""}排序目标由研究配置决定，临时查看排序不改写正式推荐。`, `Official ranking: ${Explanation.metricLabel(decision.rankingMetric || "OUTBOUND_VOLUME_KM", locale)}; this plan ranks #${Math.max(1, (decision.rankedScenarioIds || []).indexOf(focusId) + 1)} in the same-caliber candidate set (${(decision.rankedScenarioIds || []).length}).${minChangeRow ? ` A minimum-change variant moves only ${minChangeRow.n.changedDemands ?? "a few"} records with about ${Display.number(Math.abs(Number(minChangeRow.n.changeRate ?? 0) * 100))}% distance improvement.` : ""} The ranking objective is fixed by the study configuration; ad-hoc viewing does not rewrite the official recommendation.`, `公式ランキング：${Explanation.metricLabel(decision.rankingMetric || "OUTBOUND_VOLUME_KM", locale)}。同一口径の候補集合（${(decision.rankedScenarioIds || []).length} 件）で第 ${Math.max(1, (decision.rankedScenarioIds || []).indexOf(focusId) + 1)} 位。${minChangeRow ? ` 「最小変更」版は ${minChangeRow.n.changedDemands ?? "少数"} 件のみ変更で距離改善約 ${Display.number(Math.abs(Number(minChangeRow.n.changeRate ?? 0) * 100))}%。` : ""}ランキング目的は研究設定で決まり、閲覧での並べ替えは公式推奨を書き換えません。`),
        talk: L("我们给了按折腾程度的梯度选项：想少调整就选最小改动版，想多省里程就选推荐版。", "We offer a gradient by change size: pick the minimum-change version to adjust less, or the recommended one to save more distance.", "変更幅のグラデーション案をご用意しています。変更を抑えたいなら最小変更版、距離を節約したいなら推奨版を。"),
        metrics: ["M-OUT-VKM"], limits: [L("已知不满足硬约束的候选未参与排序", "Candidates with known hard-constraint violations are excluded from ranking", "既知のハード制約違反がある候補はランキング対象外です")], reviewStatus: "DRAFT" },
      { findingId: "F-04", chapter: 4, title: L("收益和代价来自哪里", "Where gains and costs come from", "便益とコストの出所"),
        text: L(deltas.length ? `改善集中在 ${gains.map(d => d.customerName).filter((v, i, a2) => a2.indexOf(v) === i).slice(0, 3).join("、")} 这类远距离客户；${losses.length ? `${losses.map(d => d.customerName).filter((v, i, a2) => a2.indexOf(v) === i).length} 个客户里程小幅增加。` : "没有客户因此变差。"}${deltaRef != null ? (isReconciled ? "改善与恶化合计与总差额对账一致。" : "合计与总差额存在未解释差额，收益结论暂缓。") : ""}` : "本次没有产生逐需求的里程变化。", deltas.length ? `Gains concentrate on distant customers such as ${gains.map(d => d.customerName).filter((v, i, a2) => a2.indexOf(v) === i).slice(0, 3).join(", ")};${losses.length ? ` ${losses.map(d => d.customerName).filter((v, i, a2) => a2.indexOf(v) === i).length} customer(s) see slightly longer distances.` : " no customer is worse off."}${deltaRef != null ? (isReconciled ? " Gains and losses reconcile with the total delta." : " There is an unexplained gap versus the total delta; benefit claims are held back.") : ""}` : "No per-demand distance changes in this run.", deltas.length ? `改善は ${gains.map(d => d.customerName).filter((v, i, a2) => a2.indexOf(v) === i).slice(0, 3).join("、")} などの遠距離顧客に集中。${losses.length ? `${losses.map(d => d.customerName).filter((v, i, a2) => a2.indexOf(v) === i).length} 顧客は距離がわずかに増加。` : "悪化した顧客はありません。"}${deltaRef != null ? (isReconciled ? "改善と悪化の合計は総差額と一致します。" : "総差額に未説明の差があり、便益結論は保留します。") : ""}` : "需要ごとの距離変化はありませんでした。"),
        talk: L("改善来源很集中，前几个远距离客户贡献了大部分收益；少数客户里程小幅变差。", "Gains are concentrated: a few distant customers contribute most of the benefit, while a few customers get slightly longer distances.", "改善は集中しており、遠距離顧客数件が大半の便益を生みます。少数の顧客は距離がわずかに増えます。"),
        metrics: ["M-OUT-VKM"], limits: [L("分运输段记账贡献，不声称独立因果", "Contributions are booked per transport leg; no independent causality is claimed", "輸送区間ごとの寄与であり、独立した因果は主張しません")], reviewStatus: "DRAFT" },
      { findingId: "F-05", chapter: 5, title: L("实施条件", "Implementation conditions", "実施条件"),
        text: L(`容量未核验 ${focusEx?.capacity?.unknownPeriods ?? 0} 仓月${focusEx?.capacity?.exceededPeriods ? `；已知超限 ${focusEx.capacity.exceededPeriods} 仓月（不可进入可执行推荐）` : ""}。费用${costComplete ? "适用项已齐，可支持费用结论" : "适用项不完整，只支持局部阈值，不能给净节省"}；运输频次未提供。`, `${focusEx?.capacity?.unknownPeriods ?? 0} site-month(s) of capacity unverified${focusEx?.capacity?.exceededPeriods ? `; ${focusEx.capacity.exceededPeriods} known exceedance(s) — not actionable` : ""}. Cost: ${costComplete ? "all applicable items present; a cost conclusion is supported" : "items incomplete; only local thresholds, no net saving claimed"}; transport frequency not provided.`, `容量未検証 ${focusEx?.capacity?.unknownPeriods ?? 0} 倉庫月${focusEx?.capacity?.exceededPeriods ? `；既知の超過 ${focusEx.capacity.exceededPeriods} 倉庫月（実行推奨不可）` : ""}。コストは${costComplete ? "適用項目が揃っており費用結論が可能" : "項目不完全で局部閾値のみ、純節約は主張不可"}。輸送頻度は未提供です。`),
        talk: L(`落地前要确认：仓库吞吐、运输单价、配送频次。${costComplete ? "费用项已齐，可以谈钱。" : "费用项没配齐之前，我只讲里程、不讲省多少钱。"}`, `Before rollout confirm: site throughput, transport rates, delivery frequency. ${costComplete ? "Cost items are complete, so we can talk money." : "Until cost items are complete I will talk distance, not savings."}`, `実施前に確認：倉庫スループット、輸送単価、配送頻度。${costComplete ? "費用項目は揃っており、コストの話が可能です。" : "費用項目が揃うまで節約額はお話ししません。"}`),
        metrics: ["M-COST"], limits: [L("未知值保持未知，不作 0", "Unknown values stay unknown; never treated as 0", "未知値は未知のまま扱い、0 とはしません"), L("处理量≠库存仓容，旺季单独看峰值月", "Throughput is not storage capacity; check peak months separately in busy season", "処理量は在庫容量とは別。繁忙期はピーク月を個別確認"), capacityNote], reviewStatus: "DRAFT" }
    ];

    // 证据索引
    const displayRows = cands.map(c => ({
      scenarioId:c.row.scenarioId,enabledSiteCount:c.n.sitesNames.length,label: c.n.label,
      sites: (c.n.sitesNames.join(L("、", ", ", "、")) || "-") + (c.n.closedNames.length ? L("（关闭：", " (closed: ", "（閉鎖：") + c.n.closedNames.join(L("、", ", ", "、")) + L("）", ")", "）") : ""),
      beforeKm: c.n.beforeKm, afterKm: c.n.afterKm, changeRate: c.n.changeRate,
      affected: exById.get(c.row.scenarioId)?.affected?.businessRecords ?? (Array.isArray(c.row.affectedCustomers) ? c.row.affectedCustomers.length : null),
      cost: c.n.steadyCost, status: c.n.solverStatus
    }));
    const evidence = {
      "F-01": { scope: { focus: cands.find(c => c.n.label)?.n.label || focusId, reference: reference.label, periods: scope.periods, unit: scope.unit, distanceBasis: ex.distanceBasis, common: `${num(reference.common?.after?.denominatorVolume)} ${scope.unit} 共同样本（覆盖 ${reference.common?.after?.coverageRatio != null ? Display.percent(reference.common.after.coverageRatio) : "—"}）` }, delta: { from: oc.before?.numeratorVolumeKm, to: oc.after?.numeratorVolumeKm, delta: deltaRef, metricId: "M-OUT-WKM" }, detail: deltas.slice(0, 50), caliber: metrics, sources: { studyHash: identity.inputHash, snapshotHash: identity.snapshotHash, sampleSetHash: reference.common?.after?.sampleSetHash, distanceSource: ex.distanceBasis, note: "明细=候选与基线 legs 按(客户节点,期间)对齐的物量公里差；改配数按需求记录口径" }, exportRef: "附件：计算明细.csv / 方案比较 CSV" },
      "F-02": { scope: { focus: focusId, closedSites: closures.map(c => c.closedSites.join("、")) }, delta: null, detail: Object.entries(pairCount).map(([k, v]) => ({ customerName: k, quantity: v, note: "需求数" })), caliber: metrics.slice(3), sources: { snapshotHash: identity.snapshotHash }, exportRef: "附件：方案比较 CSV" },
      "F-03": { scope: { rankingMetric: decision.rankingMetric, ranked: decision.rankedScenarioIds }, delta: null, detail: [], caliber: metrics.slice(1, 2), sources: { snapshotHash: identity.snapshotHash, rankingScope: decision.rankingScope }, exportRef: "附件：方案比较 CSV（group/rank 列）" },
      "F-04": { scope: { rows: deltas.length }, delta: { sum: deltaSum, referenceDelta: deltaRef, reconciled: isReconciled }, detail: [...gains.slice(0, 10), ...losses.slice(0, 10)], caliber: [{ id: "M-OUT-VKM", metricId: "M-OUT-VKM", formula: "Δ = Σ(候选 legs − 基线 legs)，对齐键=(客户节点,期间)" }], sources: { snapshotHash: identity.snapshotHash }, exportRef: "附件：计算明细.csv" },
      "F-05": { scope: { capacity: focusEx?.capacity }, delta: null, detail: closures, caliber: metrics.filter(m => m.metricId === "M-COST"), sources: { snapshotHash: identity.snapshotHash }, exportRef: "附件：JSON/MD 报告" }
    };
    if(joint&&snap.analysisScope==='UPSTREAM_ONLY'){
      const changedRelations=(focus?.relationRows||[]).filter(row=>row.change!=='UNCHANGED');
      const relations=new Set(changedRelations.map(row=>JSON.stringify([row.supplierId,row.siteId])));
      const network=findings.find(row=>row.findingId==='F-02');
      network.text=L(`${relations.size} 组供应商→仓库关系变化，${changedRelations.length} 条期间变化记录；配送范围冻结。`,`${relations.size} supplier-site relationships change across ${changedRelations.length} period records; delivery scope is frozen.`,`${relations.size} 組の供給元・倉庫関係、${changedRelations.length} 件の期間記録が変化。配送範囲は固定です。`);network.talk=network.text;
      evidence['F-02'].detail=changedRelations;
    }
    const manifest = {
      reportSchema: SCHEMA, snapshotHash: identity.snapshotHash, studyId: identity.studyId,
      focusScenarioId: focusId, rankingMetric: decision.rankingMetric, generatedAt: identity.generatedAt,
      attachments: [L("交互式结论报告（本页）","Interactive report (this page)","対話型レポート（このページ）"),L("结论报告.html","Conclusion report.html","結論レポート.html"),L("计算明细.csv","Calculation details.csv","計算明細.csv"),L("方案比较 CSV","Comparison CSV","候補比較 CSV"),"JSON/MD"],
      redactionPolicy: "EXPORT_REQUEST_SCOPED", hiddenDomIsNotConfidentiality: true,
      derivedAggregations: ["F-04 legs 差额分解（对账行已内置）", closures.length ? "关仓运输代价/固定节省分解" : null].filter(Boolean)
    };

    return { identity, scope, reference, decision, projection, displayRows, focusId, metrics, findings, evidence, deltas: { gains, losses, deltaSum, deltaRef }, closures, manifest, siteCount, periodsN, locale, capacityNote, toolContext: { focus: focus?.result || focus || null, reference: referenceResult, snapshot: snap, study } };
  }


/*==NEWCSS==*/
  const CSS = `
@font-face{font-family:'Barlow Semi Condensed';font-style:normal;font-weight:600;font-display:swap;src:url('./vendor/fonts/barlow-semi-condensed-600-latin.woff2') format('woff2')}
@font-face{font-family:'Barlow Semi Condensed';font-style:normal;font-weight:700;font-display:swap;src:url('./vendor/fonts/barlow-semi-condensed-700-latin.woff2') format('woff2')}
.scro-overlay{position:fixed;inset:0;z-index:9000;background:var(--ui-surface-soft, #EDF1F5);color:var(--ui-ink, #12283A);font-family:inherit;overflow:auto;overflow-x:hidden}
.scro-overlay:focus{outline:none}
.scro-overlay button{font-family:inherit}
.scro-bar{position:sticky;top:0;z-index:20;display:flex;gap:8px;align-items:center;padding:10px 22px;background:#FFFFFFEE;backdrop-filter:blur(6px);border-bottom:1px solid var(--ui-line, #DCE4EA);flex-wrap:wrap}
.scro-bar .sl-title{font-weight:650;color:var(--ui-ink, #12283A);margin-right:auto;font-size:14px}
.scro-bar button{cursor:pointer;padding:6px 12px;border:1px solid var(--ui-line, #C7D3DC);background:var(--ui-surface, #fff);color:var(--ui-accent, #31465A);border-radius:7px;font-size:12px;font-weight:600;transition:background-color 140ms ease,border-color 140ms ease,box-shadow 140ms ease}
.scro-bar button:hover{border-color:var(--ui-accent, #0F5FA6);color:var(--ui-accent, #0F5FA6)}
.scro-bar button.on{background:#0F5FA6;border-color:var(--ui-accent, #0F5FA6);color:#fff}
.scro-bar button:focus-visible{outline:3px solid rgba(15,95,166,.35);outline-offset:2px}
.sl-progress{position:sticky;top:0;z-index:19;height:3px;background:var(--ui-surface-raised, #E2E9EF)}
.sl-progress i{display:block;height:100%;background:#0F5FA6;transition:width .3s ease}
/*==RPCSS==*/
/* —— 竖版互动结论报告 —— */
.rp-wrap{max-width:940px;margin:0 auto;padding:30px 26px 90px}
.rp-hero{padding:22px 0 20px;border-bottom:1px solid var(--ui-line, #DCE4EA);margin-bottom:6px}
.rp-hero .kick{color:var(--ui-muted, #5B7080);font-size:13px;font-weight:600;margin:0 0 8px}
.rp-hero h1{color:var(--ui-accent, #0B3D6D);font-size:clamp(28px,3.4vw,42px);margin:0 0 10px;font-weight:700;letter-spacing:-.01em}
.rp-hero .verdict{color:var(--ui-accent, #31465A);font-size:15px;line-height:1.75;max-width:72ch}
.rp-meta{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
.rp-meta span{background:var(--ui-surface, #fff);border:1px solid var(--ui-line, #DCE4EA);border-radius:999px;padding:4px 12px;font-size:12px;color:var(--ui-accent, #31465A)}
.rp-sec{margin:36px 0}
.rp-sec>h2{color:var(--ui-accent, #0B3D6D);font-size:20px;margin:0 0 14px;font-weight:700;display:flex;align-items:center;gap:10px}
.rp-sec>h2::before{content:"";width:10px;height:10px;border-radius:3px;background:linear-gradient(135deg,#0F5FA6,#0A8F92)}
.rp-sub{color:var(--ui-accent, #31465A);font-size:14px;line-height:1.75;max-width:74ch;margin:8px 0}
.rp-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin:16px 0}
.rp-kpi{background:var(--ui-surface, #fff);border:1px solid var(--ui-line, #DCE4EA);border-radius:12px;padding:18px 20px;cursor:pointer;text-align:left;transition:border-color 140ms ease,box-shadow 140ms ease;font-family:inherit;width:100%}
.rp-kpi:hover{border-color:var(--ui-accent, #0F5FA6);box-shadow:0 4px 14px rgba(15,95,166,.10)}
.rp-kpi:focus-visible{outline:3px solid rgba(15,95,166,.35);outline-offset:2px}
.rp-kpi small{display:block;color:var(--ui-muted, #5B7080);font-size:12px;margin-bottom:6px}
.rp-kpi .v{font-family:'Barlow Semi Condensed',system-ui,sans-serif;font-weight:700;font-size:44px;line-height:1.05;color:var(--ui-accent, #0B3D6D);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.rp-kpi .v small{display:inline;font-size:16px;color:var(--ui-muted, #5B7080);font-weight:600;margin-left:3px}
.rp-kpi .d{display:block;font-size:12.5px;color:var(--ui-positive, #0A8F92);margin-top:6px;white-space:normal;overflow-wrap:anywhere}
.rp-kpi .d.neg{color:var(--ui-negative, #B3261E)}
.rp-click{background:none;border:0;padding:0 0 1px;color:inherit;font:inherit;cursor:pointer;text-align:inherit;border-bottom:1px dashed rgba(15,95,166,.55)}
.rp-click:hover{color:var(--ui-accent, #0F5FA6)}
.rp-click:focus-visible{outline:3px solid rgba(15,95,166,.35);outline-offset:2px}
.rp-calc{margin-top:12px;border:1px solid var(--ui-line, #C7D9E4);border-radius:10px;background:var(--ui-surface-soft, #F4F9FC);overflow:hidden}
.rp-calc[hidden]{display:none}
.rp-calc-head{padding:9px 14px;background:var(--ui-accent-soft, #E7F0F7);color:var(--ui-accent, #0B3D6D);font-size:12px;font-weight:650;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
.rp-calc-head .tag{color:var(--ui-muted, #5B7080);font-weight:500}
.rp-calc-body{padding:12px 14px;display:grid;gap:8px}
.rp-row{display:grid;grid-template-columns:140px 1fr;gap:10px;font-size:13px;color:var(--ui-accent, #31465A)}
.rp-row .k{color:var(--ui-muted, #5B7080)}
.rp-row .v{font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.rp-formula{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;background:var(--ui-surface, #fff);border:1px solid var(--ui-line, #DCE4EA);border-radius:6px;padding:8px 10px;color:var(--ui-accent, #0B3D6D);overflow-wrap:anywhere}
.rp-calc-foot{padding:8px 14px;border-top:1px solid var(--ui-line, #DCE4EA);display:flex;gap:12px;align-items:center}
.rp-calc-foot button{border:0;background:none;color:var(--ui-accent, #0F5FA6);font-size:12px;font-weight:600;cursor:pointer;padding:4px 0}
.rp-calc-foot button:hover{text-decoration:underline}
.rp-bars{display:grid;gap:10px;margin:14px 0}
.rp-bar-row{display:grid;grid-template-columns:minmax(130px,210px) 1fr 96px;gap:12px;align-items:center}
.rp-bar-row .lb{color:var(--ui-accent, #31465A);font-size:13px;text-align:right;overflow-wrap:anywhere}
.rp-bar-track{height:20px;background:var(--ui-accent-soft, #E9EFF4);border-radius:5px;overflow:hidden;display:block}
.rp-bar-fill{display:block;height:100%;border-radius:5px;background:linear-gradient(90deg,#0F5FA6,#2E86C4)}
.rp-bar-fill.gain{background:linear-gradient(90deg,#0A8F92,#37B5A9)}
.rp-bar-fill.neg{background:linear-gradient(90deg,#B3261E,#D4614F)}
.rp-bar-row .vl{font-family:'Barlow Semi Condensed',system-ui,sans-serif;font-weight:600;font-size:15px;color:var(--ui-ink, #12283A);font-variant-numeric:tabular-nums}
.rp-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:12px;margin:16px 0}
.rp-fact{background:var(--ui-surface, #fff);border:1px solid var(--ui-line, #DCE4EA);border-left:3px solid var(--ui-accent, #0F5FA6);border-radius:8px;padding:12px 14px}
.rp-fact small{display:block;color:var(--ui-muted, #5B7080);font-size:12px;margin-bottom:4px}
.rp-fact b{color:var(--ui-ink, #12283A);font-size:14px;font-weight:650;overflow-wrap:anywhere}
.rp-table{width:100%;border-collapse:collapse;background:var(--ui-surface, #fff);border:1px solid var(--ui-line, #DCE4EA);border-radius:10px;overflow:hidden;font-size:13px}
.rp-table th,.rp-table td{padding:10px 13px;border-bottom:1px solid var(--ui-line, #E7EDF2);text-align:left;white-space:nowrap}
.rp-table td.wrap{white-space:normal;overflow-wrap:anywhere}
.rp-table th{background:var(--ui-accent-soft, #EEF3F7);color:var(--ui-accent, #0B3D6D);font-weight:650}
.rp-table tbody tr:hover{background:var(--ui-surface-soft, #F3F8FB)}
.rp-table tr.focus{background:var(--ui-accent-soft, #EAF3FB);box-shadow:inset 3px 0 0 #0F5FA6}
.rp-checks{display:grid;gap:9px;margin:14px 0}
.rp-check{display:flex;gap:10px;align-items:flex-start;background:var(--ui-surface, #fff);border:1px solid var(--ui-line, #DCE4EA);border-radius:8px;padding:11px 15px;color:var(--ui-accent, #31465A);font-size:13.5px;line-height:1.6}
.rp-check::before{content:"";flex:none;width:8px;height:8px;border-radius:50%;background:#0A8F92;margin-top:6px}
.rp-check.warn::before{background:#C97A1C}
.rp-foot{margin-top:40px;padding-top:14px;border-top:1px solid var(--ui-line, #DCE4EA);color:var(--ui-muted, #7A8B99);font-size:12px;display:grid;gap:6px}
.rp-foot code{overflow-wrap:anywhere;color:var(--ui-accent, #0B3D6D)}
/*==ENDRPCSS==*/

/* 文档模式（保留既有文本契约） */
.scro-wrap{max-width:1080px;width:100%;box-sizing:border-box;margin:0 auto;padding:20px 22px 60px}
.scro-card{background:var(--ui-surface, #fff);border:1px solid var(--ui-line, #DCE4EA);border-radius:12px;padding:20px 22px;margin:12px 0;box-shadow:0 1px 3px rgba(18,40,58,.06)}
.scro-card h3{margin:2px 0 10px;color:var(--ui-accent, #0B3D6D)}
.scro-card p{color:var(--ui-accent, #31465A);font-size:13px;line-height:1.7}
.scro-note{color:var(--ui-muted, #5B7080);font-size:12px;overflow-wrap:anywhere}
.scro-talk{margin:10px 0 2px;padding:9px 13px;border-left:3px solid var(--ui-positive, #0A8F92);background:var(--ui-positive-soft, #F0F7F6);border-radius:0 8px 8px 0;font-size:13px;color:var(--ui-accent, #274B57)}
.scro-table{width:100%;border-collapse:collapse;font-size:13px}
.scro-table th,.scro-table td{border-bottom:1px solid var(--ui-line, #E7EDF2);padding:9px 12px;text-align:left;white-space:nowrap}
.scro-table td.wrap{white-space:normal;overflow-wrap:anywhere}
.scro-table th{background:var(--ui-accent-soft, #EEF3F7);color:var(--ui-accent, #0B3D6D);font-weight:650;position:sticky;top:0;z-index:1}
.scro-compare tbody tr:first-child{background:var(--ui-accent-soft, #EAF3FB)}
.scro-scroll{overflow-x:auto;max-width:100%;border-radius:8px}
.scro-scroll::-webkit-scrollbar{height:10px}
.scro-scroll::-webkit-scrollbar-thumb{background:var(--ui-surface-raised, #C3D5DC);border-radius:999px;border:2px solid var(--ui-line, #fff)}
.scro-details{margin-top:12px;border:1px solid var(--ui-line, #DCE4EA);border-radius:8px;padding:10px 12px;background:var(--ui-surface, #fff)}
.scro-details summary{color:var(--ui-accent, #0B3D6D);font-size:12px;font-weight:650;cursor:pointer}
.scro-evidence{position:fixed;top:0;right:0;width:min(560px,100vw);max-width:100vw;box-sizing:border-box;height:100vh;background:var(--ui-surface, #fff);border-left:1px solid var(--ui-line, #C7D3DC);overflow:auto;padding:16px 20px;z-index:9100;color:var(--ui-ink, #12283A);box-shadow:-12px 0 32px rgba(18,40,58,.12)}
.scro-evidence h3{color:var(--ui-accent, #0B3D6D)}
.scro-evidence h4{margin:14px 0 4px;color:var(--ui-positive, #0A6E71);font-size:13px}
.scro-evidence p,.scro-evidence td,.scro-evidence th{color:var(--ui-accent, #31465A)}
.scro-evidence table{width:100%;border-collapse:collapse;font-size:12px}
.scro-evidence th,.scro-evidence td{border-bottom:1px solid var(--ui-line, #E7EDF2);padding:6px 8px;text-align:left;white-space:nowrap}
.scro-evidence code{overflow-wrap:anywhere;word-break:break-word;color:var(--ui-accent, #0B3D6D)}
.scro-evidence button:focus-visible,.scro-bar button:focus-visible{outline:3px solid rgba(15,95,166,.35);outline-offset:2px}
.scro-overlay ::selection{background:var(--ui-accent-soft, #CFE4F7)}
@media print {
  .scro-bar,.scro-evidence,.scro-no-print,.sl-progress,.sl-navbtns,.sl-notes{display:none!important}
  .scro-overlay{position:static;background:var(--ui-surface, #fff);color:var(--ui-ink, #111);overflow:visible}
  .sl-stage{min-height:0}
  .sl-slide{display:none;page-break-after:always;min-height:0;padding:24px 40px;background:var(--ui-surface, #fff)}
  .sl-slide.on{display:block}
  .sl-slide::before{display:none}
  .sl-anim{opacity:1!important;transform:none!important;animation:none!important}
  .scro-card{border-color:var(--ui-line, #bbb);background:var(--ui-surface, #fff);page-break-inside:avoid}
  .scro-table th,.scro-table td{border-color:var(--ui-line, #ccc)}
  .scro-scroll{overflow:visible}
  .rp-table,.scro-table{table-layout:fixed;min-width:0}
  .rp-table th,.rp-table td,.scro-table th,.scro-table td{white-space:normal;overflow-wrap:anywhere;padding:6px}
  .scro-note{color:var(--ui-muted, #555)}
  .mode-doc .sl-stage{display:none!important}
  .mode-slides .doc-stage{display:none!important}
}
@media (prefers-reduced-motion: reduce){
  .sl-anim{opacity:1;transform:none;animation:none!important}
  .sl-progress i,.scro-bar button{transition:none!important}
}

/* ===== P0-1 场景对比工作台 ===== */
.sc-compare-toolbar { display:flex; gap:10px; align-items:center; margin:14px 0; flex-wrap:wrap; }
.sc-compare-toolbar select { min-height:36px; min-width:180px; border:1px solid var(--ui-line, #b7cbd5); border-radius:6px; padding:6px 10px; background:var(--ui-surface, #fff); color:var(--ui-ink, #103047); font-size:13px; }
.sc-compare-grid { display:grid; gap:14px; margin:16px 0; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); }
.sc-compare-card { background:var(--ui-surface, #fff); border:1px solid var(--sc-line,#d2e0e9); border-radius:12px; padding:18px; box-shadow:0 2px 8px rgba(16,48,71,.06); position:relative; }
.sc-compare-card.is-focus { border-color:var(--ui-positive, #087d84); box-shadow:0 4px 16px rgba(8,125,132,.15); }
.sc-compare-card .badge { position:absolute; top:12px; right:12px; background:var(--ui-positive-soft, #e3f3f0); color:var(--ui-positive, #0a6e71); font-size:11px; font-weight:700; padding:3px 10px; border-radius:999px; }
.sc-compare-card h4 { margin:0 0 12px; color:var(--ui-accent, #123d68); font-size:15px; }
.sc-compare-kpi { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--ui-line, #eef3f6); font-size:13px; }
.sc-compare-kpi .k { color:var(--ui-muted, #526878); }
.sc-compare-kpi .v { font-weight:650; color:var(--ui-ink, #103047); font-variant-numeric:tabular-nums; }
.sc-compare-kpi .v.pos { color:var(--ui-positive, #0a8f92); }
.sc-compare-kpi .v.neg { color:var(--ui-negative, #b3261e); }
.sc-compare-delta { margin-top:10px; padding:8px 12px; background:var(--ui-positive-soft, #f0f7f6); border-radius:8px; font-size:12px; color:var(--ui-accent, #274b57); }
.sc-compare-delta .up { color:var(--ui-negative, #b3261e); font-weight:650; }
.sc-compare-delta .down { color:var(--ui-positive, #0a8f92); font-weight:650; }
.sc-compare-table-wrap { overflow-x:auto; margin:14px 0; border:1px solid var(--sc-line,#d2e0e9); border-radius:10px; }
.sc-compare-table { width:100%; border-collapse:collapse; font-size:13px; min-width:600px; }
.sc-compare-table th, .sc-compare-table td { padding:10px 14px; border-bottom:1px solid var(--ui-line, #eef3f6); text-align:left; white-space:nowrap; }
.sc-compare-table th { background:var(--ui-accent-soft, #eef5f7); color:var(--ui-accent, #123d68); font-weight:700; position:sticky; top:0; }
.sc-compare-table td.best { background:var(--ui-positive-soft, #e3f3f0); font-weight:700; }
.sc-compare-table td.worst { background:var(--ui-surface-soft, #fef2f2); }
.sc-compare-table tr:hover { background:var(--ui-surface-soft, #f3f8fb); }

/* ===== P0-2 TCO 成本建模 ===== */
.sc-tco-section { margin:16px 0; }
.sc-tco-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; margin:12px 0; }
.sc-tco-item { background:var(--ui-surface, #fff); border:1px solid var(--sc-line,#d2e0e9); border-radius:10px; padding:14px 16px; }
.sc-tco-item label { display:block; font-size:12px; color:var(--ui-muted, #526878); margin-bottom:6px; font-weight:600; }
.sc-tco-item input, .sc-tco-item select { width:100%; min-height:36px; border:1px solid var(--ui-line, #b7cbd5); border-radius:6px; padding:6px 10px; font-size:13px; background:var(--ui-surface, #fff); color:var(--ui-ink, #103047); }
.sc-tco-item .hint { font-size:11px; color:var(--ui-muted, #8a9ba8); margin-top:4px; }
.sc-tco-total { background:linear-gradient(135deg,#0b335c,#0d6177); color:#fff; border-radius:12px; padding:20px 24px; margin:16px 0; }
.sc-tco-total h4 { margin:0 0 10px; font-size:14px; opacity:.85; }
.sc-tco-total .amount { font-family:'Barlow Semi Condensed',system-ui,sans-serif; font-size:38px; font-weight:700; font-variant-numeric:tabular-nums; }
.sc-tco-total .amount small { font-size:16px; opacity:.7; margin-left:4px; }
.sc-tco-breakdown { margin:12px 0; }
.sc-tco-row { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid rgba(255,255,255,.12); font-size:13px; }
.sc-tco-row .label { opacity:.8; }
.sc-tco-row .val { font-weight:650; font-variant-numeric:tabular-nums; }
.sc-tco-tier { margin:8px 0; }
.sc-tier-row { display:flex; gap:8px; align-items:center; margin:4px 0; }
.sc-tier-row input { width:100px; min-height:32px; border:1px solid var(--ui-line, #b7cbd5); border-radius:5px; padding:4px 8px; font-size:12px; }
.sc-tier-row span { font-size:12px; color:var(--ui-muted, #526878); }

/* ===== P0-3 碳排放/ESG ===== */
.sc-carbon-section { margin:16px 0; }
.sc-carbon-hero { background:linear-gradient(135deg,#0a6e71,#087d84); color:#fff; border-radius:12px; padding:20px 24px; margin:14px 0; display:flex; gap:24px; flex-wrap:wrap; align-items:center; }
.sc-carbon-hero .stat { display:flex; flex-direction:column; }
.sc-carbon-hero .stat small { font-size:12px; opacity:.8; }
.sc-carbon-hero .stat strong { font-family:'Barlow Semi Condensed',system-ui,sans-serif; font-size:32px; font-weight:700; }
.sc-carbon-hero .stat strong small { font-size:14px; opacity:.7; margin-left:3px; }
.sc-carbon-bars { display:grid; gap:10px; margin:14px 0; }
.sc-carbon-bar { display:grid; grid-template-columns:120px 1fr 100px; gap:12px; align-items:center; }
.sc-carbon-bar .lb { font-size:13px; color:var(--ui-accent, #31465a); text-align:right; }
.sc-carbon-bar .track { height:20px; background:var(--ui-accent-soft, #e9eff4); border-radius:5px; overflow:hidden; }
.sc-carbon-bar .fill { height:100%; border-radius:5px; background:linear-gradient(90deg,#0a6e71,#37b5a9); }
.sc-carbon-bar .fill.warn { background:linear-gradient(90deg,#c97a1c,#e8a94f); }
.sc-carbon-bar .fill.bad { background:linear-gradient(90deg,#b3261e,#d4614f); }
.sc-carbon-bar .vl { font-family:'Barlow Semi Condensed',system-ui,sans-serif; font-weight:600; font-size:15px; color:var(--ui-ink, #12283a); font-variant-numeric:tabular-nums; }
.sc-carbon-factors { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; margin:12px 0; }
.sc-carbon-factor { background:var(--ui-surface, #fff); border:1px solid var(--sc-line,#d2e0e9); border-radius:8px; padding:12px 14px; text-align:center; }
.sc-carbon-factor .icon { font-size:24px; }
.sc-carbon-factor .name { font-size:12px; color:var(--ui-muted, #526878); margin:4px 0; }
.sc-carbon-factor .rate { font-family:'Barlow Semi Condensed',system-ui,sans-serif; font-size:20px; font-weight:700; color:var(--ui-positive, #0a6e71); }
.sc-carbon-compare { display:grid; grid-template-columns:1fr auto 1fr; gap:16px; align-items:center; margin:16px 0; }
.sc-carbon-compare .side { background:var(--ui-surface, #fff); border:1px solid var(--sc-line,#d2e0e9); border-radius:10px; padding:16px; text-align:center; }
.sc-carbon-compare .side .label { font-size:12px; color:var(--ui-muted, #526878); }
.sc-carbon-compare .side .val { font-family:'Barlow Semi Condensed',system-ui,sans-serif; font-size:28px; font-weight:700; color:var(--ui-ink, #12283a); }
.sc-carbon-compare .arrow { font-size:28px; color:var(--ui-positive, #0a8f92); }

/* ===== 网络拓扑流向图 ===== */
.sc-network-canvas { background:var(--ui-surface, #f7fafc); border:1px solid var(--sc-line,#d2e0e9); border-radius:12px; padding:16px; margin:14px 0; overflow:hidden; }
.sc-network-canvas svg { width:100%; height:auto; display:block; }
.sc-network-legend { display:flex; gap:18px; flex-wrap:wrap; margin:10px 0; padding:10px 14px; background:var(--ui-surface, #fff); border:1px solid var(--sc-line,#d2e0e9); border-radius:8px; font-size:12px; color:var(--ui-muted, #526878); }
.sc-network-legend .item { display:flex; align-items:center; gap:6px; }
.sc-network-legend .dot { width:12px; height:12px; border-radius:50%; }
.sc-network-legend .line { width:24px; height:3px; border-radius:2px; }
.sc-network-controls { display:flex; gap:10px; margin:10px 0; flex-wrap:wrap; }
.sc-network-controls button { padding:6px 14px; border:1px solid var(--sc-line,#d2e0e9); background:var(--ui-surface, #fff); color:var(--ui-accent, #31465a); border-radius:6px; font-size:12px; cursor:pointer; }
.sc-network-controls button.on { background:#087d84; color:#fff; border-color:var(--ui-positive, #087d84); }
.sc-network-controls button:hover { border-color:var(--ui-positive, #087d84); }
.sc-network-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; margin:12px 0; }
.sc-network-stat { background:var(--ui-surface, #fff); border:1px solid var(--sc-line,#d2e0e9); border-radius:8px; padding:12px; text-align:center; }
.sc-network-stat .num { font-family:'Barlow Semi Condensed',system-ui,sans-serif; font-size:24px; font-weight:700; color:var(--ui-accent, #0b3d6d); }
.sc-network-stat .lbl { font-size:11px; color:var(--ui-muted, #526878); margin-top:2px; }

/* ===== 敏感性分析 ===== */
.sc-sens-hero { background:linear-gradient(135deg,#0b335c,#0d6177); color:#fff; border-radius:12px; padding:20px 24px; margin:14px 0; }
.sc-sens-hero h4 { margin:0 0 8px; font-size:14px; opacity:.85; }
.sc-sens-hero .score { font-family:'Barlow Semi Condensed',system-ui,sans-serif; font-size:42px; font-weight:700; }
.sc-sens-hero .score small { font-size:18px; opacity:.7; }
.sc-sens-hero .note { font-size:13px; opacity:.8; margin-top:6px; }
.sc-sens-rows { display:grid; gap:10px; margin:14px 0; }
.sc-sens-row { display:grid; grid-template-columns:140px 1fr 80px; gap:12px; align-items:center; background:var(--ui-surface, #fff); border:1px solid var(--sc-line,#d2e0e9); border-radius:8px; padding:12px 16px; }
.sc-sens-row .param { font-size:13px; font-weight:650; color:var(--ui-ink, #12283a); }
.sc-sens-bar { height:24px; background:var(--ui-accent-soft, #e9eff4); border-radius:5px; overflow:hidden; position:relative; }
.sc-sens-bar .fill { height:100%; border-radius:5px; transition:width .3s; }
.sc-sens-bar .fill.stable { background:linear-gradient(90deg,#0a8f92,#37b5a9); }
.sc-sens-bar .fill.marginal { background:linear-gradient(90deg,#c97a1c,#e8a94f); }
.sc-sens-bar .fill.fragile { background:linear-gradient(90deg,#b3261e,#d4614f); }
.sc-sens-bar .center { position:absolute; left:50%; top:0; bottom:0; width:2px; background:#526878; opacity:.4; }
.sc-sens-row .impact { font-family:'Barlow Semi Condensed',system-ui,sans-serif; font-size:16px; font-weight:700; text-align:right; }
.sc-sens-row .impact.pos { color:var(--ui-positive, #0a8f92); }
.sc-sens-row .impact.neg { color:var(--ui-negative, #b3261e); }
.sc-sens-flip { background:var(--ui-surface-soft, #fff8f0); border:1px solid var(--ui-line, #e8c9a0); border-radius:10px; padding:16px 20px; margin:14px 0; }
.sc-sens-flip h4 { margin:0 0 10px; color:var(--ui-warning, #8a5b00); font-size:14px; }
.sc-sens-flip ul { margin:0; padding-left:20px; }
.sc-sens-flip li { margin:6px 0; font-size:13px; color:var(--ui-accent, #31465a); line-height:1.6; }
.sc-sens-flip .threshold { font-weight:700; color:var(--ui-negative, #b3261e); }
.sc-sens-matrix { overflow-x:auto; margin:14px 0; border:1px solid var(--sc-line,#d2e0e9); border-radius:10px; }
.sc-sens-matrix table { width:100%; border-collapse:collapse; font-size:12px; min-width:500px; }
.sc-sens-matrix th, .sc-sens-matrix td { padding:8px 12px; border-bottom:1px solid var(--ui-line, #eef3f6); text-align:center; white-space:nowrap; }
.sc-sens-matrix th { background:var(--ui-accent-soft, #eef5f7); color:var(--ui-accent, #0b3d6d); font-weight:650; }
.sc-sens-matrix td.cell-good { background:var(--ui-positive-soft, #e3f3f0); color:var(--ui-positive, #0a6e71); font-weight:650; }
.sc-sens-matrix td.cell-warn { background:var(--ui-warning-soft, #fef6e7); color:var(--ui-warning, #8a5b00); }
.sc-sens-matrix td.cell-bad { background:var(--ui-surface-soft, #fef2f2); color:var(--ui-negative, #b3261e); font-weight:650; }

/* ===== 高级分析抽屉 ===== */
.sc-advanced-drawer { margin:18px 0; }
.sc-advanced-toggle { display:flex; align-items:center; gap:10px; padding:14px 20px; background:linear-gradient(135deg,#0b335c,#0d6177); color:#fff; border-radius:12px; cursor:pointer; font-size:15px; font-weight:650; border:0; width:100%; text-align:left; }
.sc-advanced-toggle:hover { box-shadow:0 4px 16px rgba(8,125,132,.2); }
.sc-advanced-toggle .icon { font-size:20px; }
.sc-advanced-toggle .arrow { margin-left:auto; font-size:18px; transition:transform .2s; }
.sc-advanced-toggle.open .arrow { transform:rotate(180deg); }
.sc-advanced-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; margin:14px 0; }
.sc-advanced-card { background:var(--ui-surface, #fff); border:1px solid var(--sc-line,#d2e0e9); border-radius:12px; padding:18px 20px; cursor:pointer; transition:all .15s; position:relative; }
.sc-advanced-card:hover { border-color:var(--ui-positive, #087d84); box-shadow:0 4px 16px rgba(8,125,132,.12); transform:translateY(-2px); }
.sc-advanced-card .icon { font-size:28px; margin-bottom:8px; }
.sc-advanced-card h4 { margin:0 0 6px; color:var(--ui-accent, #0b3d6d); font-size:14px; }
.sc-advanced-card p { margin:0; color:var(--ui-muted, #526878); font-size:12px; line-height:1.5; }
.sc-advanced-card .tag { position:absolute; top:12px; right:12px; background:var(--ui-positive-soft, #e3f3f0); color:var(--ui-positive, #0a6e71); font-size:10px; font-weight:700; padding:2px 8px; border-radius:999px; }
.sc-advanced-card .tag.new { background:var(--ui-warning-soft, #fef6e7); color:var(--ui-warning, #8a5b00); }
.sc-advanced-panel { display:none; margin:16px 0; border:1px solid var(--sc-line,#d2e0e9); border-radius:12px; overflow:hidden; }
.sc-advanced-panel.open { display:block; }
.sc-advanced-panel .panel-header { display:flex; justify-content:space-between; align-items:center; padding:16px 20px; background:var(--ui-accent-soft, #eef5f7); border-bottom:1px solid var(--sc-line,#d2e0e9); }
.sc-advanced-panel .panel-header h3 { margin:0; color:var(--ui-accent, #0b3d6d); font-size:16px; }
.sc-advanced-panel .panel-close { background:none; border:0; font-size:20px; cursor:pointer; color:var(--ui-muted, #526878); padding:4px 8px; border-radius:6px; }
.sc-advanced-panel .panel-close:hover { background:var(--ui-accent-soft, #e9eff4); }
.sc-advanced-panel .panel-body { padding:20px; }

/* ===== 地图交互升级组件体系 ===== */

/* 1. OD 流量弧线图 */
.sc-flow-arc-layer { position:absolute; inset:0; pointer-events:none; z-index:2; }
.sc-flow-arc-layer svg { width:100%; height:100%; }
.sc-flow-arc { fill:none; stroke-linecap:round; opacity:.7; transition:opacity .2s; }
.sc-flow-arc:hover { opacity:1; stroke-width:6px; }
.sc-flow-arc.improving { stroke:#0a8f92; }
.sc-flow-arc.worsening { stroke:#b3261e; }
.sc-flow-arc.neutral { stroke:#8a9ba8; }
.sc-flow-arc-legend { position:absolute; bottom:60px; right:16px; background:rgba(255,255,255,.92); border:1px solid var(--ui-line, #d2e0e9); border-radius:8px; padding:10px 14px; font-size:11px; color:var(--ui-muted, #526878); z-index:3; }
.sc-flow-arc-legend .item { display:flex; align-items:center; gap:6px; margin:3px 0; }
.sc-flow-arc-legend .line { width:20px; height:3px; border-radius:2px; }

/* 2. 滑动对比 */
.sc-swipe-container { position:relative; overflow:hidden; border:1px solid var(--ui-line, #d2e0e9); border-radius:12px; margin:14px 0; }
.sc-swipe-left, .sc-swipe-right { position:absolute; inset:0; overflow:hidden; }
.sc-swipe-left { z-index:2; clip-path:inset(0 50% 0 0); }
.sc-swipe-divider { position:absolute; top:0; bottom:0; left:50%; width:4px; background:var(--ui-surface, #fff); cursor:ew-resize; z-index:3; transform:translateX(-50%); box-shadow:0 0 8px rgba(0,0,0,.3); }
.sc-swipe-divider::after { content:"⇔"; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:32px; height:32px; background:var(--ui-surface, #fff); border:2px solid var(--ui-positive, #087d84); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:14px; color:var(--ui-positive, #087d84); cursor:ew-resize; }
.sc-swipe-label { position:absolute; top:12px; background:rgba(255,255,255,.92); padding:4px 12px; border-radius:6px; font-size:12px; font-weight:650; z-index:4; }
.sc-swipe-label.left { left:12px; color:var(--ui-muted, #526878); }
.sc-swipe-label.right { right:12px; color:var(--ui-positive, #087d84); }

/* 3. 3D 柱状节点 */
.sc-3d-bar { position:absolute; transform:translateX(-50%); z-index:2; pointer-events:auto; cursor:pointer; }
.sc-3d-bar .bar { width:24px; background:linear-gradient(180deg,#0b3d6d,#087d84); border-radius:4px 4px 0 0; transition:height .3s; box-shadow:2px -2px 4px rgba(0,0,0,.15); }
.sc-3d-bar .bar-label { text-align:center; font-size:10px; color:var(--ui-muted, #526878); margin-top:2px; white-space:nowrap; }
.sc-3d-bar:hover .bar { background:linear-gradient(180deg,#087d84,#37b5a9); }
.sc-arc-3d { fill:none; stroke-linecap:round; opacity:.6; }
.sc-arc-3d:hover { opacity:1; stroke-width:6px; }

/* 4. 蜂窝/网格热力图 */
.sc-heatmap-canvas { position:absolute; inset:0; z-index:1; pointer-events:none; }
.sc-heatmap-legend { position:absolute; bottom:60px; left:16px; background:rgba(255,255,255,.92); border:1px solid var(--ui-line, #d2e0e9); border-radius:8px; padding:10px 14px; font-size:11px; color:var(--ui-muted, #526878); z-index:3; }
.sc-heatmap-gradient { height:12px; border-radius:6px; background:linear-gradient(90deg,var(--ui-positive-soft, #e3f3f0),#37b5a9,#0a6e71,#c97a1c,#b3261e); margin:6px 0; }
.sc-heatmap-labels { display:flex; justify-content:space-between; }

/* 5. 节点拖拽编辑 */
.sc-drag-handle { cursor:grab; transition:transform .15s; }
.sc-drag-handle:active { cursor:grabbing; transform:scale(1.2); }
.sc-drag-handle.dragging { cursor:grabbing; transform:scale(1.3); filter:drop-shadow(0 4px 8px rgba(0,0,0,.3)); }
.sc-drag-tooltip { position:absolute; background:var(--ui-surface, #fff); border:1px solid var(--ui-line, #d2e0e9); border-radius:6px; padding:6px 10px; font-size:11px; pointer-events:none; z-index:5; white-space:nowrap; box-shadow:0 2px 8px rgba(0,0,0,.12); }

/* 6. 时间轴播放 */
.sc-timeline { display:flex; align-items:center; gap:12px; margin:14px 0; padding:14px 18px; background:var(--ui-surface, #fff); border:1px solid var(--ui-line, #d2e0e9); border-radius:10px; }
.sc-timeline-btn { width:40px; height:40px; border-radius:50%; border:2px solid var(--ui-positive, #087d84); background:var(--ui-surface, #fff); color:var(--ui-positive, #087d84); font-size:16px; cursor:pointer; display:flex; align-items:center; justify-content:center; }
.sc-timeline-btn:hover { background:#087d84; color:#fff; }
.sc-timeline-track { flex:1; height:8px; background:var(--ui-accent-soft, #e9eff4); border-radius:4px; position:relative; cursor:pointer; }
.sc-timeline-fill { height:100%; border-radius:4px; background:linear-gradient(90deg,#0b3d6d,#087d84); transition:width .3s; }
.sc-timeline-thumb { position:absolute; top:50%; width:18px; height:18px; background:var(--ui-surface, #fff); border:3px solid var(--ui-positive, #087d84); border-radius:50%; transform:translate(-50%,-50%); cursor:grab; }
.sc-timeline-labels { display:flex; justify-content:space-between; font-size:11px; color:var(--ui-muted, #526878); margin-top:6px; }

/* 7. 节点聚合+自定义标记 */
.sc-cluster-marker { position:absolute; transform:translate(-50%,-50%); z-index:3; cursor:pointer; }
.sc-cluster-badge { width:44px; height:44px; background:rgba(11,61,109,.85); color:#fff; border:3px solid var(--ui-line, #fff); border-radius:50%; display:flex; align-items:center; justify-content:center; font-family:'Barlow Semi Condensed',system-ui,sans-serif; font-size:16px; font-weight:700; box-shadow:0 2px 8px rgba(0,0,0,.25); }
.sc-cluster-badge:hover { background:#087d84; transform:scale(1.1); }
.sc-custom-marker { position:absolute; transform:translate(-50%,-100%); z-index:3; cursor:pointer; }
.sc-marker-icon { width:36px; height:36px; background:var(--ui-surface, #fff); border:2px solid var(--ui-accent, #0b3d6d); border-radius:50% 50% 50% 0; transform:rotate(-45deg); display:flex; align-items:center; justify-content:center; box-shadow:0 2px 8px rgba(0,0,0,.2); }
.sc-marker-icon span { transform:rotate(45deg); font-size:16px; }
.sc-marker-label { text-align:center; font-size:10px; color:var(--ui-muted, #526878); margin-top:2px; white-space:nowrap; }

/* 8. 点击信息面板 */
.sc-info-panel { position:absolute; top:16px; right:16px; width:280px; background:var(--ui-surface, #fff); border:1px solid var(--ui-line, #d2e0e9); border-radius:12px; box-shadow:0 8px 32px rgba(0,0,0,.15); z-index:5; overflow:hidden; }
.sc-info-panel .header { background:linear-gradient(135deg,#0b335c,#0d6177); color:#fff; padding:14px 18px; }
.sc-info-panel .header h4 { margin:0; font-size:15px; }
.sc-info-panel .header .sub { font-size:11px; opacity:.8; margin-top:2px; }
.sc-info-panel .body { padding:14px 18px; }
.sc-info-kpi { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--ui-line, #eef3f6); font-size:12px; }
.sc-info-kpi .k { color:var(--ui-muted, #526878); }
.sc-info-kpi .v { font-weight:650; color:var(--ui-ink, #103047); font-variant-numeric:tabular-nums; }
.sc-info-panel .close-btn { position:absolute; top:10px; right:12px; background:none; border:0; color:#fff; font-size:18px; cursor:pointer; }

/* 9. 搜索+筛选 */
.sc-map-search { position:absolute; top:16px; left:16px; z-index:4; display:flex; gap:8px; }
.sc-map-search input { width:240px; height:40px; border:1px solid var(--ui-line, #d2e0e9); border-radius:8px; padding:0 14px; font-size:13px; background:var(--ui-surface, #fff); box-shadow:0 2px 8px rgba(0,0,0,.1); }
.sc-map-search input:focus { outline:2px solid rgba(8,125,132,.35); border-color:var(--ui-positive, #087d84); }
.sc-map-filter-btn { height:40px; padding:0 16px; border:1px solid var(--ui-line, #d2e0e9); background:var(--ui-surface, #fff); border-radius:8px; font-size:13px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,.1); }
.sc-map-filter-btn:hover { border-color:var(--ui-positive, #087d84); }
.sc-map-filter-dropdown { position:absolute; top:48px; left:0; background:var(--ui-surface, #fff); border:1px solid var(--ui-line, #d2e0e9); border-radius:8px; padding:12px; min-width:200px; box-shadow:0 4px 16px rgba(0,0,0,.12); }
.sc-map-filter-dropdown label { display:flex; align-items:center; gap:8px; padding:6px 0; font-size:12px; color:var(--ui-accent, #31465a); }

/* 10. 测量工具 */
.sc-measure-bar { display:flex; gap:8px; margin:12px 0; }
.sc-measure-btn { padding:8px 16px; border:1px solid var(--ui-line, #d2e0e9); background:var(--ui-surface, #fff); border-radius:8px; font-size:12px; cursor:pointer; display:flex; align-items:center; gap:6px; }
.sc-measure-btn:hover { border-color:var(--ui-positive, #087d84); background:var(--ui-positive-soft, #f0f7f6); }
.sc-measure-btn.active { background:#087d84; color:#fff; border-color:var(--ui-positive, #087d84); }
.sc-measure-result { position:absolute; bottom:60px; left:50%; transform:translateX(-50%); background:rgba(255,255,255,.95); border:1px solid var(--ui-line, #d2e0e9); border-radius:8px; padding:10px 18px; font-size:13px; color:var(--ui-ink, #103047); z-index:4; box-shadow:0 2px 12px rgba(0,0,0,.12); }
.sc-measure-result .val { font-family:'Barlow Semi Condensed',system-ui,sans-serif; font-size:20px; font-weight:700; color:var(--ui-positive, #087d84); }

/* 通用地图工具栏 */
.sc-map-toolbar { position:absolute; top:16px; left:16px; z-index:4; display:flex; flex-direction:column; gap:6px; }
.sc-map-tool-btn { width:40px; height:40px; background:var(--ui-surface, #fff); border:1px solid var(--ui-line, #d2e0e9); border-radius:8px; display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,.1); font-size:16px; }
.sc-map-tool-btn:hover { border-color:var(--ui-positive, #087d84); background:var(--ui-positive-soft, #f0f7f6); }
.sc-map-tool-btn.active { background:#087d84; color:#fff; }
`;
/*==ENDNEWCSS==*/

/*==NEWRENDER==*/
  function findingCard(f, model) {
    const L = (zh, en, ja) => pick(model.locale || 'zh', zh, en, ja);
    const ev = model.evidence[f.findingId];
    return `<section class="scro-card scro-chapter" id="ch-${f.chapter}"><h3>${f.chapter}. ${esc(f.title)} <span class="scro-note">${esc(f.findingId)}</span></h3><p>${esc(f.text)}</p>${f.talk ? `<blockquote class="scro-talk">${L("对客户可以这样说：", "How to say it to the client: ", "お客様への説明：")}${esc(f.talk)}</blockquote>` : ''}
      <p class="scro-note">${L("限定：", "Limits: ", "限定：")}${f.limits.map(esc).join(L("；", "; ", "；"))}</p>
      <div class="sc-actions scro-no-print"><button type="button" data-scro-ev="${esc(f.findingId)}">${L("查看依据", "View evidence", "根拠を見る")}</button></div>
      ${ev && ev.delta ? `<p class="scro-note">${L("指标引用：", "Metrics: ", "指標：")}${(f.metrics || []).join(" / ")}${ev.delta.reconciled != null ? ` · ${L("差额对账：", "Delta reconciliation: ", "差額照合：")}${ev.delta.reconciled ? L("一致", "reconciled", "一致") : L("存在未解释差额", "unexplained gap", "未説明の差額")}` : ""}</p>` : ""}</section>`;
  }

  function closureVerdict(c) {
    const L = (zh, en, ja) => pick(c.__loc || 'zh', zh, en, ja);
    const numL = num;
    const gap = c.costComplete ? c.costDeltaPeriod : null;
    const detail = [c.transportPenaltyCost != null ? L("运输 ", "transport ", "輸送 ") + numL(c.transportPenaltyCost) : null, c.handlingDeltaCost != null ? L("处理 ", "handling ", "荷役 ") + numL(c.handlingDeltaCost) : null, c.fixedSaving != null ? L("固定 ", "fixed ", "固定 ") + numL(-c.fixedSaving) : null].filter(Boolean).join(L("、", ", ", "、"));
    return c.costComplete ? (gap <= 0 ? L("已划算（相对推荐方案全费用净省 ", "Worth it (full-cost saving vs recommendation: ", "划算（推奨案比 全費用節約：") + numL(-gap) + L("/期）", "/period)", "/期間）") : L("未划算（相对推荐方案全费用净增 ", "Not worth it (full-cost increase vs recommendation: ", "不划算（推奨案比 全費用増：") + numL(gap) + L("/期", "/period", "/期間") + (detail ? L("：", ": ", "：") + detail : "") + L("）", ")", "）")) : (c.transportPenaltyCost != null && c.fixedSaving != null ? L("局部阈值：运输 ", "Local threshold: transport ", "局部閾値：輸送 ") + numL(c.transportPenaltyCost) + L(" vs 固定节省 ", " vs fixed saving ", " vs 固定節約 ") + numL(c.fixedSaving) + L("（未含全部适用费用，不构成净收益）", " (not all applicable costs included; not a net benefit)", "（全適用費用を含まず純便益ではありません）") : L("费用未核验", "cost unverified", "コスト未検証"));
  }

  function statusName(value,locale) {
    const labels={OPTIMAL:['已证最优','Proven optimal','最適証明済み'],FEASIBLE:['已找到可行解','Feasible solution','可行解あり'],INFEASIBLE:['不可行','Infeasible','実行不能'],UNKNOWN:['未确认','Unconfirmed','未確認'],TIMEOUT:['已超时','Timed out','時間切れ'],PARTIAL:['部分完成','Partially completed','一部完了'],CANCELLED:['已取消','Cancelled','取り消し済み']};
    return labels[value]?.[{zh:0,en:1,ja:2}[locale||'zh']]||value;
  }

  function render(model, options = {}, viewState = null) {
    const L = (zh, en, ja) => pick(model.locale || 'zh', zh, en, ja);
    const closuresL = (model.closures || []).map(c => ({ ...c, __loc: model.locale || 'zh' }));
    const findings = model.findings;
    const displayRows = model.displayRows;
    const gateTitle = L("验证期（台账 F01/F05/F08/F12）", "Validation phase (ledger F01/F05/F08/F12)", "検証フェーズ（台帳 F01/F05/F08/F12）");
    const gateText = L("本报告的结论文案、费用口径与计数语义修复中；正式场合以标准导出（结论报告 HTML/CSV）为准。解除条件：F01/F05/F08/F12 验收通过。", "Conclusion wording, cost caliber and counting semantics are under repair; for formal use rely on the standard exports (conclusion HTML/CSV). Lifted once F01/F05/F08/F12 pass acceptance.", "結論文言・費用口径・計数セマンティクスは修正中です。正式用途では標準出力（結論 HTML/CSV）を正としてください。解除条件：F01/F05/F08/F12 の合格。");
    return `<div class="scro-wrap">
      <div class="scro-card"><h3>${L("数据基础", "Data basis", "データ基礎")} <span style="font-size:11px;color:#8A5B00">⚠ ${gateTitle}</span></h3><p><span style="font-size:11px;color:#8A5B00">${gateText}</span></p><p>${esc(model.identity.studyName)} · ${esc((model.scope.periods || [])[0] || "")}~${esc((model.scope.periods || []).slice(-1)[0] || "")} · ${esc(String((model.displayRows||[]).find(row=>row.scenarioId===model.focusId)?.enabledSiteCount??model.siteCount))} ${L("个仓", "sites", "倉庫")} / ${esc(String(model.scope.records?.uniqueDeliveryAddresses || "—"))} ${L("个送货点", "delivery points", "配送先")} · ${L("距离口径：", "Distance basis: ", "距離基準：")}${esc(model.scope.distanceBasis === "GEOGRAPHIC_SCREENING" ? L("直线估算（非道路里程）", "straight-line screening (not road)", "直線見積もり（実走距離ではない）") : L("道路距离", "road distance", "道路距離"))}</p>
      <details class="scro-details scro-no-print"><summary class="scro-note">${L("技术信息（快照指纹/求解记录）", "Technical info (snapshot fingerprint / solver runs)", "技術情報（スナップショット指紋 / 求解記録）")}</summary><p class="scro-note">${L("研究 ", "Study ", "研究 ")}<code>${esc(model.identity.studyId)}</code> · ${L("快照 ", "snapshot ", "スナップショット ")}<code>${esc(String(model.identity.snapshotHash || "—"))}</code> · ${L("排序口径 ", "ranking ", "ランキング基準 ")}<code>${esc(model.decision.rankingMetric || "")}</code> · ${(model.identity.runs || []).map(r => esc(`${r.type}:${r.feasible}/${r.attempted}`)).join("，")}</p></details>
      ${findings.map(f => findingCard(f, model)).join("")}
      <section class="scro-card scro-chapter"><h3>${L("候选比较（同口径）", "Candidate comparison (same caliber)", "候補比較（同一口径）")}</h3>
        <p class="scro-note">${L("排序：", "Ranking: ", "ランキング：")}${esc(model.decision.rankingMetric || "OUTBOUND_VOLUME_KM")} · ${L("临时查看其他列不改写正式推荐。", "Ad-hoc column views do not rewrite the official recommendation.", "一時的な列閲覧は公式推奨を書き換えません。")}</p>
        <div class="scro-scroll"><table class="scro-table"><thead><tr><th>${L("方案", "Plan", "案")}</th><th>${L("仓库组合", "Site set", "倉庫構成")}</th><th>${L("平均配送距离(公里)", "Avg delivery distance (km)", "平均配送距離(km)")}</th><th>${L("变化", "Change", "変化")}</th><th>${L("涉及客户", "Affected", "対象顧客")}</th><th>${L("成本", "Cost", "コスト")}</th><th>${L("状态", "Status", "状態")}</th></tr></thead><tbody>
        ${displayRows.map(d => `<tr data-scenario-id="${esc(d.scenarioId)}"><td>${esc(d.label)}</td><td class="wrap">${esc(d.sites)}</td><td>${num(d.beforeKm)} → ${num(d.afterKm)}</td><td>${pct(d.changeRate)}</td><td>${num(d.affected)}</td><td>${d.cost != null ? num(d.cost) : L("未计算", "not computed", "未計算")}</td><td title="${esc(d.status)}">${esc(statusName(d.status,model.locale))}</td></tr>`).join("")}
        </tbody></table></div>
        ${model.closures.length ? `<h3>${L("关仓运输代价参考（不参与距离排名）", "Closure transport-cost reference (not part of distance ranking)", "閉鎖輸送コスト参考（距離ランキング対象外）")}</h3><div class="scro-scroll"><table class="scro-table"><thead><tr><th>${L("关闭仓", "Site closed", "閉鎖倉庫")}</th><th>${L("额外运输里程", "Extra transport volume-km", "追加輸送物量キロ")}(${unitZh(model.scope.unit)}·${L("公里/期", "km/period", "km/期間")})</th><th>${L("额外成本/期", "Extra cost/period", "追加コスト/期間")}</th><th>${L("省下的固定成本/期", "Fixed cost saved/period", "削減固定費/期間")}</th><th>${L("值不值得关", "Worth closing?", "閉鎖すべきか")}</th></tr></thead><tbody>
        ${closuresL.map(c => {
          const gap = c.costComplete ? c.costDeltaPeriod : null;
          const verdict = closureVerdict(c);
          return `<tr><td>${esc(c.closedSites.join("、"))}</td><td>${num(c.transportPenaltyVkm)}</td><td>${num(c.transportPenaltyCost)}</td><td>${num(c.fixedSaving)}</td><td class="wrap">${c.costComplete ? (gap <= 0 ? verdict : verdict) : verdict}</td></tr>`;
        }).join("")}</tbody></table></div>` : ""}
      </section>
      <section class="scro-card scro-chapter"><h3>${L("导出清单", "Export manifest", "書き出し一覧")}</h3><div class="scro-scroll"><pre class="scro-note" style="white-space:pre-wrap;word-break:break-all;margin:0">${esc(JSON.stringify(model.manifest))}</pre></div></section>
      <p class="scro-note">${L("本报告为只读派生层：不重新求解、不自创排序、不修改研究结果。参数试算与重新优化请回系统执行。", "This report is a read-only derivation: it does not re-solve, invent rankings, or modify study results. Run what-if and re-optimization in the system.", "本レポートは読み取り専用の派生層です。再求解・独自ランキング・研究結果の変更は行いません。試算と再最適化はシステムで実行してください。")}</p>
    </div>`;
  }

  /*==NEWRP==*/
  /* —— 竖版互动结论报告：点击数字/结论展开结算逻辑 —— */
  function reportHtml(model, viewState = null) {
    const L = (zh, en, ja) => pick(model.locale || 'zh', zh, en, ja);
    const wkm = (model.metrics || []).find(m => m.metricId === 'M-OUT-WKM') || {};
    const chM = (model.metrics || []).find(m => m.metricId === 'M-CHANGED') || {};
    const costM = (model.metrics || []).find(m => m.metricId === 'M-COST') || {};
    const F = id => (model.findings || []).find(f => f.findingId === id) || { text: '', talk: '', limits: [] };
    const improved = wkm.before != null && wkm.value != null && wkm.value < wkm.before;
    const chgPct = (wkm.before != null && wkm.value != null && wkm.before !== 0) ? ((wkm.value - wkm.before) / wkm.before * 100) : null;
    const basisLabel = model.scope.distanceBasis === 'GEOGRAPHIC_SCREENING' ? L('直线估算（非道路里程）', 'straight-line screening', '直線見積もり') : model.scope.distanceBasis === 'ESTIMATED_ROAD' ? L('估算道路距离', 'estimated road', '推定道路距離') : L('来源声明已核验道路（核验依据需另查）', 'Source-declared verified roads (review evidence)', '出典による検証済道路（根拠要確認）');
    const costKnown = costM.completeness === 'KNOWN';
    const pairDetail = (model.evidence['F-02'] && model.evidence['F-02'].detail) || [];
    const gains = (model.deltas.gains || []).slice(0, 8);
    const losses = (model.deltas.losses || []).slice(0, 4);
    const maxAbs = Math.max(1, ...[].concat(gains, losses).map(g => Math.abs(g.deltaVolumeKm || 0)));
    const rec = (model.evidence['F-04'] && model.evidence['F-04'].delta) || {};
    const cap = (model.evidence['F-05'] && model.evidence['F-05'].scope && model.evidence['F-05'].scope.capacity) || {};
    const tag = L("只读投影 · 未知不计 0", "read-only projection · unknowns never treated as 0", "読み取り専用投影・未知は0としない");
    const head = t => `<div class="rp-calc-head"><span>${L("结算逻辑 · ", "Calculation · ", "計算ロジック・")}${t}</span><span class="tag">${tag}</span></div>`;
    const row = (k, v) => `<div class="rp-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
    const foot = id => `<div class="rp-calc-foot"><button type="button" data-scro-ev="${id}">${L("查看完整依据", "View full evidence", "完全な根拠を見る")}</button></div>`;
    const panel = (key, title, body, evId) => `<div class="rp-calc" data-calc-for="${key}" hidden>${head(title)}<div class="rp-calc-body">${body}</div>${foot(evId)}</div>`;
    const barRow = (calcKey, label, frac, value, cls) => `<div class="rp-bar-row"><button type="button" class="rp-click lb" data-calc="${calcKey}">${esc(label)}</button><span class="rp-bar-track"><span class="rp-bar-fill ${cls || ''}" style="width:${Math.max(3, Math.round(frac * 100))}%"></span></span><span class="vl">${value}</span></div>`;
    const bars = rows => `<div class="rp-bars">${rows.join('')}</div>`;

    /* 结算逻辑面板内容 */
    const pWkm = panel('wkm', L("平均配送距离", "Avg delivery distance", "平均配送距離"),
      `<div class="rp-formula">${L("平均距离 = Σ(物量i × 距离i) ÷ Σ物量i —— 仅计入两方案均具备可比距离的共同样本", "avg = Σ(volume_i × distance_i) ÷ Σ volume_i — only the common comparable sample", "平均距離 = Σ(物量i×距離i)÷Σ物量i —— 両案で比較可能な共通サンプルのみ")}</div>
       ${row(L("基线代入", "baseline", "基線"), `${num(wkm.before)} km`)}
       ${row(L("候选代入", "candidate", "候補"), `${num(wkm.value)} km`)}
       ${row(L("变化", "change", "変化"), chgPct != null ? (chgPct <= 0 ? "▾ " : "▴ ") + Display.number(Math.abs(chgPct)) + "%" : "—")}
       ${row(L("距离口径", "distance basis", "距離基準"), esc(basisLabel))}
       ${row(L("数据来源", "source", "出所"), L("基线/候选运输台账（legs），按需求ID × 期间 × 单位对齐；距离来源 = " + basisLabel, "baseline/candidate transport ledgers aligned by demand ID × period × unit; distance = " + basisLabel, "基線/候補輸送台帳を需要ID×期間×単位で整合。距離=" + basisLabel))}`, 'F-01');
    const pChanged = panel('changed', L("受影响需求记录", "Affected demand records", "影響需要記録"),
      `<div class="rp-formula">${L("改动数 = |{ demandId : 前后服务仓不同 }| —— 按需求记录计，不按客户或月度行", "changed = |{ demandId : serving site differs }| — demand records, not customers or month rows", "変更数 = |{demandId : 担当倉庫が相違}| —— 需要記録ベース")}</div>
       ${row(L("计数结果", "count", "計数"), `${num(chM.value)} ${L("条", "records", "件")}`)}
       ${row(L("对齐规则", "alignment", "整合規則"), L("腿对齐键 = 需求ID | 期间 | 单位（队列配对，同客户多需求互不覆盖）", "leg alignment key = demand ID | period | unit (queue pairing)", "腿整合キー=需要ID|期間|単位（キュー照合）"))}
       ${row(L("数据来源", "source", "出所"), L("解释层 affected.demandIds（解释快照）", "explanation affected.demandIds", "説明層 affected.demandIds"))}
       ${pairDetail.length ? row(L("主要流向", "main flows", "主な流れ"), pairDetail.map(x => esc(x.customerName) + " " + num(x.quantity)).join(L("；", "; ", "；"))) : ""}`, 'F-02');
    const pCost = panel('cost', L("适用运营成本（稳态）", "Operating cost (steady)", "運用コスト（定常）"),
      `<div class="rp-formula">${L("稳态成本 = Σ 全部适用费用项（入库运输 + 出库运输 + 固定 + 处理 + 适用中转/库存）；缺项保持未知，不计 0", "steady = Σ applicable cost items (inbound + outbound transport + fixed + handling + applicable transfer/inventory); missing items stay unknown, never 0", "定常=Σ適用費用項目。欠損は未知のまま、0としない")}</div>
       ${row(L("计数结果", "result", "結果"), costM.value != null ? `${num(costM.value)} ${esc(model.scope.currency)}` : L("未核验——存在未声明/缺失的适用项", "unverified — missing applicable items", "未検証——適用項目欠損"))}
       ${row(L("结论效力", "verdict power", "結論効力"), costKnown ? L("可支持费用结论", "supports a cost conclusion", "費用結論が可能") : L("只支持局部阈值，不能给净节省", "local thresholds only; no net saving claimed", "局部閾値のみ。純節約は主張不可"))}
       ${row(L("数据来源", "source", "出所"), L("费率表（rates）× 运输台账逐项计算", "rate tables × transport ledger", "レート表×輸送台帳"))}`, 'F-05');
    const pSample = panel('sample', L("共同可比样本", "Common comparable sample", "共通比較サンプル"),
      `<div class="rp-formula">${L("共同样本 = 两方案均具备可比距离的期间行；样本物量 = Σ 该期间行物量", "common sample = period rows comparable in both plans; sample volume = Σ their volume", "共通サンプル=両案で比較可能な期間行。サンプル物量=Σ物量")}</div>
       ${row(L("样本物量", "sample volume", "サンプル物量"), `${num(model.reference.common?.after?.denominatorVolume)} ${esc(model.scope.unit)}`)}
       ${row(L("样本覆盖", "coverage", "カバレッジ"), model.reference.common?.after?.coverageRatio != null ? Display.percent(model.reference.common.after.coverageRatio) : "—")}
       ${row(L("作用", "why it matters", "意義"), L("口径页之后的一切百分比都建立在该样本上", "every percentage that follows stands on this sample", "以降の百分率はこのサンプルに基づく"))}`, 'F-01');
    const pRank = panel('rank', L("排序口径", "Ranking caliber", "ランキング基準"),
      `<div class="rp-formula">${L("正式排序 = " + (model.decision.rankingMetric || "OUTBOUND_VOLUME_KM") + "；仅纳入同口径可比且无已知硬约束违规的候选", "official ranking = " + (model.decision.rankingMetric || "OUTBOUND_VOLUME_KM") + "; only comparable candidates without known hard-constraint violations", "公式ランキング=" + (model.decision.rankingMetric || "OUTBOUND_VOLUME_KM"))}</div>
       ${row(L("候选集", "candidate set", "候補集合"), `${(model.decision.rankedScenarioIds || []).length} ${L("个（同口径）", "same-caliber", "同一口径")}`)}
       ${row(L("不变性", "immutability", "不変性"), L("临时查看其他列不改写正式推荐；报告为只读派生层", "ad-hoc views never rewrite the recommendation; read-only derivation", "閲覧での並べ替えは推奨を書き換えない"))}`, 'F-03');
    const pFlow = panel('flow', L("流向计数规则", "Flow counting rule", "フロー計数規則"),
      `<div class="rp-formula">${L("某流向条数 = |{ demandId : 原仓→新仓 为该方向 }|", "flow count = |{ demandId : old→new in this direction }|", "フロー件数=|{demandId : 旧→新が该方向}|")}</div>
       ${row(L("口径提示", "note", "注意"), L("条数=需求记录数，不是客户家数；客户节点数在结论页单独给出", "counts are demand records, not customers; customer-node count is reported separately", "件数は需要記録。顧客数は別集計"))}`, 'F-02');
    const pGain = panel('gain', L("单客户里程差", "Per-customer distance delta", "顧客別距離差"),
      `<div class="rp-formula">${L("Δ物量公里(客户) = 候选腿物量公里 − 基线腿物量公里（对齐键 = 需求记录ID | 期间 | 单位）", "Δvolume-km(customer) = candidate leg − baseline leg (key = demand ID | period | unit)", "Δ物量km=候補腿−基線腿（キー=需要記録ID|期間|単位）")}</div>
       ${row(L("合计对账", "reconciliation", "合計照合"), rec.referenceDelta != null ? `ΣΔ = ${num(rec.sum)} ${L("vs 方案总差额", "vs plan total", "vs 総差額")} ${num(rec.referenceDelta)} — ${rec.reconciled ? L("一致 ✓", "reconciled ✓", "一致 ✓") : L("存在未解释差额，收益结论暂缓", "unexplained gap", "未説明差額あり")}` : "—")}`, 'F-04');
    const pRecon = panel('recon', L("总量对账", "Total reconciliation", "総量照合"),
      `<div class="rp-formula">${L("Σ(逐客户 Δ) 必须 = 候选物量公里 − 基线物量公里；不等则阻止确定性收益段落", "Σ(per-customer Δ) must equal candidate − baseline volume-km; otherwise benefit claims are withheld", "ΣΔ=候補−基線。不一致なら便益記述を保留")}</div>
       ${row(L("逐条合计", "Σ detail", "明細合計"), num(rec.sum))}
       ${row(L("总差额", "plan delta", "総差額"), num(rec.referenceDelta))}
       ${row(L("结果", "result", "結果"), rec.reconciled ? L("一致（对账通过）", "reconciled", "照合通過") : L("存在未解释差额", "unexplained gap", "未説明の差"))}`, 'F-04');
    const pCap = panel('capacity', L("容量核验计数", "Capacity verification count", "容量検証計数"),
      `<div class="rp-formula">${L("未知仓月 = 逐仓逐期容量状态为 UNKNOWN 的数量；EXCEEDED 即不可进入可执行推荐", "unknown site-months = capacity statuses marked UNKNOWN; EXCEEDED blocks actionable recommendation", "未知倉庫月=UNKNOWN状態数。EXCEEDEDは実行推奨不可")}</div>
       ${row(L("未知仓月", "unknown site-months", "未知倉庫月"), num(cap.unknownPeriods ?? 0))}
       ${row(L("已知超限", "known exceedances", "既知超過"), num(cap.exceededPeriods ?? 0))}
       ${row(L("候选生成口径", "generation scope", "候補生成スコープ"), esc(model.capacityNote))}`, 'F-05');
    const closurePanels = (model.closures || []).map((c, i) => panel('closure-' + i, L("关仓结算 · ", "Closure calculation · ", "閉鎖計算・") + esc((c.closedSites || []).join("、")),
      `<div class="rp-formula">${L("每期净变化 = (关仓适用费用 − 焦点适用费用) ÷ 期数 —— 含处理费，未知项不计 0", "per-period delta = (closure cost − focus cost) ÷ periods — handling included; unknowns never 0", "期間差=(閉鎖費用−焦点費用)÷期数。荷役含む")}</div>
       ${row(L("运输差/期", "transport Δ/period", "輸送差/期間"), num(c.transportPenaltyCost))}
       ${row(L("处理差/期", "handling Δ/period", "荷役差/期間"), num(c.handlingDeltaCost))}
       ${row(L("固定差/期（负=节省）", "fixed Δ/period (neg=saving)", "固定差/期間"), num(c.fixedSaving != null ? -c.fixedSaving : null))}
       ${row(L("每期净变化", "net per period", "期間純変化"), num(c.costDeltaPeriod))}
       ${row(L("判定", "verdict", "判定"), closureVerdict({ ...c, __loc: model.locale || 'zh' }))}`, 'F-05'));

    return `<div class="rp-wrap">
      <div class="rp-hero">
        <p class="kick">${L("供应链网络分析 · 结论报告", "Supply-chain network analysis · conclusion report", "サプライチェーン網分析・結論レポート")}</p>
        <h1>${esc(model.identity.studyName)}</h1>
        <p class="verdict">${esc(F('F-01').text)}</p>
        <div class="rp-meta"><span>${esc((model.scope.periods || [])[0] || '')} ~ ${esc((model.scope.periods || []).slice(-1)[0] || '')}</span><span>${basisLabel}</span><span>${esc(String((model.displayRows||[]).find(row=>row.scenarioId===model.focusId)?.enabledSiteCount??model.siteCount))} ${L("个仓", "sites", "倉庫")}</span><span>${esc(model.scope.unit)}</span></div>
      </div>

      <section class="rp-sec"><h2>${L("结论", "Conclusion", "結論")}</h2>
        <div class="rp-kpis">
          <button type="button" class="rp-kpi" data-calc="wkm"><small>${L("平均配送距离（点击看结算逻辑）", "Avg delivery distance (click for calculation)", "平均配送距離（クリックで計算）")}</small><span class="v">${num(wkm.value)}<small>km</small></span><span class="d ${improved ? '' : 'neg'}">${improved ? '▾' : '▴'} ${num(wkm.before)} ${L("基线", "baseline", "基線")}</span></button>
          <button type="button" class="rp-kpi" data-calc="changed"><small>${L("受影响需求记录（点击看结算逻辑）", "Affected demand records (click for calculation)", "影響需要記録（クリックで計算）")}</small><span class="v">${num(chM.value)}<small>${L("条", "rec.", "件")}</small></span><span class="d">${L("记录口径，非客户数", "record basis, not customers", "記録ベース")}</span></button>
          <button type="button" class="rp-kpi" data-calc="cost"><small>${L("适用运营成本（稳态）· 点击看结算逻辑", "Operating cost (steady) · click for calculation", "運用コスト（定常）・クリックで計算")}</small><span class="v" style="${costKnown ? '' : 'font-size:30px'}">${costM.value != null ? num(costM.value) : L("未核验", "unverified", "未検証")}</span><span class="d ${costKnown ? '' : 'neg'}">${costKnown ? L("适用项已齐", "complete", "適用項目済み") : L("适用项不完整", "incomplete", "項目不完全")}</span></button>
        </div>
        ${(model.metrics||[]).filter(m=>['M-IN-WKM','M-TWO-VKM'].includes(m.metricId)).map(m=>`<button type="button" class="rp-kpi" data-scro-ev="F-01"><small>${esc(m.label)}</small><span class="v">${num(m.value)}<small>${esc(m.unit)}</small></span><span class="d">${num(m.before)} ${esc(model.reference.label)}</span></button>`).join('')}
        ${pWkm}${pChanged}${pCost}
      </section>

      <section class="rp-sec"><h2>${L("比较口径", "Comparison caliber", "比較の口径")}</h2>
        <div class="rp-facts">
          <div class="rp-fact"><small>${L("参照", "Reference", "参照")}</small><b>${esc(model.reference.label)}</b></div>
          <button type="button" class="rp-fact rp-click" data-calc="sample" style="border-left:3px solid #0F5FA6"><small>${L("共同可比样本（点击看定义）", "Common sample (click for definition)", "共通サンプル（クリックで定義）")}</small><b>${num(model.reference.common?.after?.denominatorVolume)} ${esc(model.scope.unit)} · ${model.reference.common?.after?.coverageRatio != null ? Display.percent(model.reference.common.after.coverageRatio) : "—"}</b></button>
          <div class="rp-fact"><small>${L("业务记录 / 期间行", "Demand records / period rows", "需要記録/期間行")}</small><b>${num(model.scope.records?.businessDemand)} / ${num(model.scope.records?.demandPeriod)}</b></div>
        </div>
        ${pSample}
        <div class="rp-checks">${F('F-01').limits.map(x => `<div class="rp-check">${esc(x)}</div>`).join('')}</div>
      </section>

      <section class="rp-sec"><h2>${L("网络怎么变", "How the network changes", "ネットワークの変化")}</h2>
        <p class="rp-sub">${esc(F('F-02').text)}</p>
        ${pairDetail.length ? bars(pairDetail.slice(0, 7).map(p => barRow('flow', p.customerName, (p.quantity || 0) / Math.max(1, ...pairDetail.map(x => x.quantity || 0)), num(p.quantity) + L(" 条", " rec.", "件")))) : ''}
        ${pFlow}<button type="button" class="rp-click" data-calc="changed" style="margin-top:6px;font-size:13px">${L("为什么改动数这样算？", "Why is the changed count computed this way?", "なぜこの計数方法？")}</button>
        ${pChanged}
      </section>

      <section class="rp-sec"><h2>${L("方案对比", "Candidate comparison", "候補比較")}</h2>
        <div class="scro-scroll"><table class="rp-table"><thead><tr><th>${L("方案", "Plan", "案")}</th><th>${L("仓库组合", "Site set", "倉庫構成")}</th><th>${L("平均配送距离(公里)", "Avg distance (km)", "平均距離(km)")}</th><th>${L("变化", "Change", "変化")}</th><th>${L("涉及客户", "Affected", "対象")}</th><th>${L("成本", "Cost", "コスト")}</th><th>${L("状态", "Status", "状態")}</th></tr></thead><tbody>
        ${[...(model.displayRows || [])].map((d, i) => `<tr data-scenario-id="${esc(d.scenarioId)}" class="${d.scenarioId===model.focusId ? 'focus' : ''}"><td>${esc(d.label)}</td><td class="wrap">${esc(d.sites)}</td><td>${num(d.beforeKm)} → ${num(d.afterKm)}</td><td>${pct(d.changeRate)}</td><td>${num(d.affected)}</td><td>${d.cost != null ? num(d.cost) : L("未计算", "not computed", "未計算")}</td><td title="${esc(d.status)}">${esc(statusName(d.status,model.locale))}</td></tr>`).join('')}
        </tbody></table></div>
        <button type="button" class="rp-click" data-calc="rank" style="margin-top:10px;font-size:13px">${L("这个排名是怎么定的？", "How was this ranking determined?", "この順位はどう決定？")}</button>
        ${pRank}
      </section>

      <section class="rp-sec"><h2>${L("收益来源", "Where the gains come from", "便益の出所")}</h2>
        <p class="rp-sub">${esc(F('F-04').text)}</p>
        ${gains.length ? bars([].concat(gains.map(g => barRow('gain', g.customerName, Math.abs(g.deltaVolumeKm || 0) / maxAbs, num(g.deltaVolumeKm), 'gain')), losses.map(g => barRow('gain', g.customerName, Math.abs(g.deltaVolumeKm || 0) / maxAbs, num(g.deltaVolumeKm), 'neg')))) : ''}
        <button type="button" class="rp-click" data-calc="gain" style="margin-top:6px;font-size:13px">${L("单个客户的 Δ 是怎么算的？", "How is a customer's Δ computed?", "顧客別Δの計算方法？")}</button>
        ${pGain}
        ${rec.referenceDelta != null ? `<button type="button" class="rp-click" data-calc="recon" style="margin-top:8px;font-size:13px">${L("合计对账：", "Reconciliation: ", "照合：")}${num(rec.sum)} ${L("vs 方案总差额", "vs plan total", "vs 総差額")} ${num(rec.referenceDelta)} — ${rec.reconciled ? L("一致 ✓（点击看对账式）", "reconciled ✓ (click for the identity)", "一致 ✓") : L("存在未解释差额（点击看细节）", "unexplained gap (click for detail)", "未説明差額あり")}</button>` : ''}
        ${pRecon}
      </section>

      <section class="rp-sec"><h2>${L("关仓权衡", "Closure trade-off", "閉鎖のトレードオフ")}</h2>
        ${model.closures.length ? `<div class="scro-scroll"><table class="rp-table"><thead><tr><th>${L("关闭仓", "Site closed", "閉鎖倉庫")}</th><th>${L("额外运输里程", "Extra transport", "追加輸送")}(${unitZh(model.scope.unit)}·km/期)</th><th>${L("额外成本/期", "Extra cost/period", "追加コスト/期間")}</th><th>${L("省下的固定成本/期", "Fixed saved/period", "削減固定費/期間")}</th><th>${L("值不值得关", "Worth closing?", "判定")}</th></tr></thead><tbody>
        ${model.closures.map((c, i) => { const cc = { ...c, __loc: model.locale || 'zh' }; return `<tr><td><button type="button" class="rp-click" data-calc="closure-${i}">${esc(c.closedSites.join("、"))}</button></td><td>${num(c.transportPenaltyVkm)}</td><td>${num(c.transportPenaltyCost)}</td><td>${num(c.fixedSaving)}</td><td class="wrap">${closureVerdict(cc)}</td></tr>`; }).join('')}
        </tbody></table></div>${closurePanels.join('')}` : `<p class="rp-sub">${L("本轮候选中没有关仓方案需要权衡。", "No closure alternative to weigh in this round.", "今回の候補に閉鎖案はありません。")}</p>`}
      </section>

      <section class="rp-sec"><h2>${L("实施条件", "Implementation conditions", "実施条件")}</h2>
        <p class="rp-sub">${esc(F('F-05').text)}</p>
        <div class="rp-checks">
          <button type="button" class="rp-check rp-click${cap.unknownPeriods ? ' warn' : ''}" data-calc="capacity">${L("容量：未知 ", "Capacity: unknown ", "容量：未知 ")}${num(cap.unknownPeriods ?? 0)} ${L("仓月（点击看计数逻辑）", "site-months (click for the counting logic)", "倉庫月（クリックで計数）")}</button>
          ${F('F-05').limits.map(x => `<div class="rp-check${/未核验|缺失|不完整|漏掉/.test(x) ? ' warn' : ''}">${esc(x)}</div>`).join('')}
        </div>
        ${pCap}
      </section>

      ${advancedDrawerHtml(model, viewState)}
      <div class="rp-foot">
        <div>${L("附件", "Attachments", "添付")}：${(model.manifest.attachments || []).map(a => `<span style="background:#fff;border:1px solid #DCE4EA;border-radius:999px;padding:3px 10px;display:inline-block;margin:2px 4px 2px 0">${esc(a)}</span>`).join('')}</div>
        <div>${L("快照指纹 ", "Snapshot fingerprint ", "スナップショット指紋 ")}<code>${esc(String(model.identity.snapshotHash || '—'))}</code></div>
        <div>${L("本报告为只读派生层：不重新求解、不自创排序、不修改研究结果；点击展开的结算逻辑全部来自已校验投影。", "Read-only derivation: no re-solving, no invented rankings, no study mutation; every expanded calculation comes from the verified projection.", "読み取り専用派生層です。展開される計算はすべて検証済み投影に由来。")}</div>
      </div>
    </div>`;
  }
/*==ENDNEWRP==*/

/* ===== P0-1 场景对比工作台 ===== */
  function compareHtml(model, viewState) {
    const L=(zh,en,ja)=>pick(model.locale,zh,en,ja),ns=globalThis.STCTPlatformV19;
    const pairs=[viewState,...(viewState?.comparisonStudies||[])];
    const base=pairs[0].study,signature=study=>ns.supplyChainDesign.hash({unit:study.unit,currency:study.currency,periods:study.periods,periodDemand:study.periodDemand,observedInbound:study.observedInbound,coordinateUse:study.coordinateUse,distanceRows:study.distanceRows,nodes:study.nodes.map(n=>({nodeId:n.nodeId,coordinate:n.coordinate}))});
    const sourceSignature=signature(base);
    const cards=pairs.map(pair=>{
      const m=pair===viewState?model:buildModel(pair,model.locale),entry=m.projection.entries.find(e=>e.row.scenarioId===m.focusId),same=signature(pair.study)===sourceSignature&&m.scope.analysisScope===model.scope.analysisScope&&m.scope.distanceBasis===model.scope.distanceBasis&&m.decision.rankingMetric===model.decision.rankingMetric;
      return `<article class="sc-compare-card" data-comparison-study="${esc(m.identity.studyId)}"><h3>${esc(m.identity.studyName)}</h3><p>${esc(m.reference.label)} · ${esc(m.focusId||'—')}</p><p>${esc(m.decision.rankingMetric||'—')}: <strong>${num(entry?.metricValue)}</strong></p><p>${esc(L('比较边界','Comparison scope','比較範囲'))}: ${esc(same?L('相同数据、期间与距离口径；各自条件及参照见报告','Same data, periods and distance basis; see each report for conditions and reference','同じデータ・期間・距離基準。条件と参照は各レポートを確認'):L('不同边界：仅并列展示，不排名或计算跨研究改善率','Different scope: side by side only; no cross-study rank or improvement rate','範囲が異なるため並列表示のみ。研究間の順位・改善率なし'))}</p><p>${esc(m.scope.analysisScope)} · ${esc(m.scope.distanceBasis)} · ${esc(m.scope.periods.join(', '))}</p><code>${esc(m.identity.snapshotHash)}</code></article>`;
    }).join('');
    const list=viewState?.comparisonPointers||[];
    return `<div class="rp-wrap"><h2>${L('研究对比','Study comparison','研究比較')}</h2><p>${L('每份研究使用自己的已复验结果和参照。并列展示不产生新的财务推荐。','Each study uses its own verified result and reference. Side-by-side display does not create a financial recommendation.','各研究の検証済み結果と参照を使用します。並列表示で財務推奨は作成しません。')}</p><button type="button" data-scro-action="comparison-list">${L('从研究目录选择','Choose from study catalog','研究一覧から選択')}</button>${list.length?`<label>${L('已完成研究','Completed study','完了した研究')} <select data-scro-comparison><option value="">${L('请选择','Choose','選択してください')}</option>${list.map(p=>`<option value="${esc(p.id)}">${esc(p.name||p.title||p.studyId||p.id)}</option>`).join('')}</select></label>`:''}<div class="sc-compare-grid">${cards}</div></div>`;
  }

  /* ===== P0-2 TCO 成本建模 ===== */
  function tcoHtml(model) {
    const L=(zh,en,ja)=>pick(model.locale,zh,en,ja),ctx=model.toolContext,focus=ctx.focus,ref=ctx.reference;
    const labels={inboundTransport:L('入库运输','Inbound transport','入庫輸送'),outboundTransport:L('出库配送','Delivery','配送'),fixedOperating:L('固定运营','Fixed operating','固定運営'),handling:L('装卸处理','Handling','荷役'),inventoryHolding:L('库存持有','Inventory holding','在庫保有'),transferTransport:L('中转调拨','Transfer','中継'),oneTimeConversion:L('一次性转换','One-time conversion','一時転換')};
    const upstream=model.scope.analysisScope==='UPSTREAM_ONLY',parts=upstream?['inboundTransport']:Object.keys(labels);
    const before=upstream?{inboundTransport:ctx.snapshot.observedKnownInbound?.cost}:ref?.metrics?.costParts||{},after=focus?.metrics?.costParts||{};
    const total=value=>value?.metrics?.operatingCost??value?.metrics?.steadyStateCost??null;
    return `<div class="rp-wrap" data-tool-candidate="${esc(model.focusId||'')}"><h2>${L('适用费用账','Applicable cost ledger','対象費用台帳')}</h2><p>${esc(model.focusId||'—')} · ${esc(model.reference.label)} · ${esc(model.scope.currency)}</p><p>${L('未知费用显示“—”；实际、假设、不适用及零值以分析条件和原始费率为准。修改费用后必须重新分析。','Unknown costs show —. Actual, assumed, not-applicable and zero values retain their input status. Reanalyze after changing rates.','不明な費用は —。実績・仮定・対象外・ゼロの入力状態を保持します。変更後は再分析が必要です。')}</p><div class="sc-compare-table-wrap"><table class="sc-compare-table"><thead><tr><th>${L('费用项','Cost item','費用項目')}</th><th>${esc(model.reference.label)}</th><th>${L('重点候选','Focus candidate','重点候補')}</th></tr></thead><tbody>${parts.map(k=>`<tr><th>${labels[k]}</th><td>${num(before[k])}</td><td>${num(after[k])}</td></tr>`).join('')}</tbody></table></div><p>${L('适用稳态合计','Applicable steady total','対象定常合計')}: ${num(upstream?before.inboundTransport:total(ref))} → ${num(total(focus))} ${esc(model.scope.currency)}</p><p>${L('首期成本','First-period cost','初期費用')}: ${num(ref?.metrics?.firstPeriodCost)} → ${num(focus?.metrics?.firstPeriodCost)} ${esc(model.scope.currency)}</p><button type="button" data-scro-action="cost">${L('修改分析中的费用依据','Edit analysis cost inputs','分析の費用入力を編集')}</button></div>`;
  }

  /* ===== P0-3 碳排放/ESG ===== */
  function carbonHtml(model) {
    const L=(zh,en,ja)=>pick(model.locale,zh,en,ja);
    return `<div class="rp-wrap" data-tool-status="NOT_COMPUTED"><h2>${L('碳排放：未计算','Carbon emissions: not computed','炭素排出：未計算')}</h2><p>${L('本研究未提供经确认的排放因子、适用运输方式及核算边界。物量公里不能直接当作车公里或碳排放，当前费用账未计入碳税。','This study has no confirmed emission factors, transport modes or accounting scope. Volume-km is not vehicle-km or emissions. Carbon tax is not included in the cost ledger.','確認済み排出係数・輸送方式・集計範囲がありません。物量キロは車両キロ・排出量ではなく、炭素税も費用に含まれません。')}</p></div>`;
  }

/* ===== 网络拓扑流向图 ===== */
  function networkTopologyHtml(model) {
    const L=(zh,en,ja)=>pick(model.locale,zh,en,ja),ctx=model.toolContext,names=new Map(ctx.study.nodes.map(n=>[n.nodeId,n.name||n.nodeId])),groups=new Map();
    for(const leg of [...(ctx.focus?.inbound||[]),...(ctx.focus?.outbound||[])]){const k=JSON.stringify([leg.kind,leg.fromNodeId,leg.toNodeId]),row=groups.get(k)||{...leg,quantity:0,volumeKm:0,known:true};row.quantity+=leg.quantity;row.known=row.known&&leg.volumeKm!=null;row.volumeKm+=leg.volumeKm||0;groups.set(k,row);}
    const rows=[...groups.values()].sort((a,b)=>b.quantity-a.quantity);
    return `<div class="rp-wrap" data-tool-candidate="${esc(model.focusId||'')}"><h2>${L('当前候选的供货与配送关系','Focus candidate supply and delivery relations','重点候補の供給・配送関係')}</h2><p>${esc(model.focusId||'—')} · ${L(`共 ${rows.length} 组；按物量展示前 20 组，完整明细见 CSV`,`Top 20 of ${rows.length} relations by volume; full detail is in CSV`,`${rows.length} 組の上位20組を物量順に表示。全明細はCSV`)}</p><div class="sc-compare-table-wrap"><table class="sc-compare-table"><thead><tr><th>${L('运输段','Leg','輸送区間')}</th><th>${L('关联','Relation','関係')}</th><th>${esc(model.scope.unit)}</th><th>${esc(model.scope.unit)}·km</th></tr></thead><tbody>${rows.slice(0,20).map(r=>`<tr><td>${esc(r.kind)}</td><td>${esc(names.get(r.fromNodeId)||r.fromNodeId)} → ${esc(names.get(r.toNodeId)||r.toNodeId)}</td><td>${num(r.quantity)}</td><td>${num(r.known?r.volumeKm:null)}</td></tr>`).join('')}</tbody></table></div><button type="button" data-scro-action="map">${L('在原方案 / 新方案地图中查看','View reference / candidate map','参照・候補地図で確認')}</button></div>`;
  }

  /* ===== 敏感性分析报告 ===== */
  function sensitivityHtml(model) {
    const L=(zh,en,ja)=>pick(model.locale,zh,en,ja);
    return `<div class="rp-wrap" data-tool-status="NOT_RUN"><h2>${L('条件变化：需要独立重算','Changed conditions: independent reanalysis required','条件変更：独立した再分析が必要')}</h2><p>${L('当前快照只证明本次条件下的结果，尚未计算需求或费率变化的翻转点，也没有稳健性评分。可以用已有需求增长页面派生情景，保留原条件重新求解后再比较。','The current snapshot covers the declared conditions only. No demand/rate tipping point or robustness score has been computed. Derive a scenario with the existing demand-growth page, preserve conditions and reanalyze before comparison.','現在の結果は明示した条件のみです。需要・料金の転換点や頑健性点数は未計算です。既存の需要増加ページで条件を保持した派生案を作り、再分析後に比較してください。')}</p><button type="button" data-scro-action="growth">${L('创建需求变化情景','Create demand-change scenario','需要変更シナリオを作成')}</button><button type="button" data-scro-action="cost">${L('修改费用后重新分析','Edit rates and reanalyze','料金を変更して再分析')}</button></div>`;
  }

/* ===== 高级分析抽屉（功能入口整合） ===== */
  function advancedDrawerHtml(model, viewState) {
    const L = (zh, en, ja) => pick(model.locale || 'zh', zh, en, ja);
    const features = [
      { id: 'compare', icon: '📊', title: L('场景对比', 'Scenario Compare', 'シナリオ比較'), desc: L('读取研究目录中的已验证快照，说明可比范围', 'Verified catalog snapshots with comparison boundaries', '検証済み研究と比較範囲'), tag: '' },
      { id: 'tco', icon: '💰', title: L('适用费用账', 'Applicable cost ledger', '対象費用台帳'), desc: L('同一候选与参照的费用明细，可返回业务表单修改', 'Focus and reference costs; return to the analysis form to edit', '重点候補と参照の費用・入力へ戻る'), tag: '' },
      { id: 'carbon', icon: '🌱', title: L('碳排放/ESG', 'Carbon & ESG', '炭素/ESG'), desc: L('未配置排放因子：未计算', 'Emission factors not configured: not computed', '排出係数未設定・未計算'), tag: '' },
      { id: 'topology', icon: '🔗', title: L('网络拓扑图', 'Network Topology', 'ネットワークトポロジ'), desc: L('真实候选关系、物量与物量公里，连接地图查看', 'Actual candidate relations, volume and volume-km', '候補の実際の関係・物量・地図'), tag: L('新', 'New', '新') },
      { id: 'sensitivity', icon: '📈', title: L('敏感性分析', 'Sensitivity Analysis', '感度分析'), desc: L('使用现有增长情景与费用输入独立重算', 'Reanalyze using existing growth and cost inputs', '既存の成長・費用入力で再分析'), tag: L('新', 'New', '新') },
      { id: 'map', icon: '🗺️', title: L('地图交互升级', 'Map Interaction', '地図インタラクション'), desc: L('同页原/新方案、真实坐标与关系筛选', 'Same-page reference/candidate map with actual coordinates', '同ページの参照・候補・実際の座標'), tag: L('新', 'New', '新') },
    ];

    return `<div class="sc-advanced-drawer">
      <button class="sc-advanced-toggle" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')">
        <span class="icon">🔬</span>
        <span>${L('高级分析工具箱', 'Advanced Analysis Toolbox', '高度分析ツール箱')}</span>
        <span class="arrow">▾</span>
      </button>
      <div class="sc-advanced-grid">
        ${features.map(f => `
          <div class="sc-advanced-card" data-advanced-feature="${f.id}" role="button" tabindex="0">
            ${f.tag ? `<span class="tag${f.tag === L('新','New','新') ? ' new' : ''}">${f.tag}</span>` : ''}
            <div class="icon">${f.icon}</div>
            <h4>${f.title}</h4>
            <p>${f.desc}</p>
          </div>
        `).join('')}
      </div>
      <div class="sc-advanced-panel" id="sc-advanced-panel">
        <div class="panel-header">
          <h3 id="sc-advanced-title"></h3>
          <button class="panel-close" onclick="document.getElementById('sc-advanced-panel').classList.remove('open')">✕</button>
        </div>
        <div class="panel-body" id="sc-advanced-body"></div>
      </div>
    </div>`;
  }

/* ===== 地图交互升级模块 ===== */
  function mapInteractionHtml(model) {
    const L=(zh,en,ja)=>pick(model.locale,zh,en,ja),ctx=model.toolContext,focus=ctx.focus;
    return `<div class="rp-wrap" data-tool-candidate="${esc(model.focusId||'')}"><h2>${L('原方案与规划方案地图','Reference and planned-network map','参照・計画ネットワーク地図')}</h2><p>${esc(model.reference.label)} → ${esc(model.focusId||'—')}</p><p>${L('使用分析页面现有的 MapLibre 地图和真实节点坐标，支持按候选、期间、运输段及关系变化筛选；缺坐标记录仍保留在明细中。','Uses the existing MapLibre analysis map and actual node coordinates. Filter by candidate, period, leg and relation change; records without coordinates remain in the detail.','既存のMapLibre分析地図と実際の座標を使用。候補・期間・区間・関係変更で絞込み、座標のない記録も明細に保持します。')}</p><p>${L('当前候选运输段','Focus candidate legs','重点候補の区間')}: ${(focus?.inbound?.length||0)+(focus?.outbound?.length||0)} · ${esc(model.scope.distanceBasis)}</p><button type="button" data-scro-action="map">${L('打开同页原 / 新方案对比地图','Open same-page reference / candidate map','同じページの参照・候補地図を開く')}</button></div>`;
  }

  function evidenceHtml(findingId, model) {
    const L = (zh, en, ja) => pick(model.locale || 'zh', zh, en, ja);
    localeCtx = model.locale || 'zh';
    const ev = model.evidence[findingId];
    if (!ev) return `<h3>${L("暂无该结论的依据索引", "No evidence index for this finding", "この結論の根拠索引はありません")}</h3>`;
    const fmtP = p => {
      if (!Array.isArray(p) || !p.length) return '—';
      const zhM = x => x.replace('-', '年') + '月';
      const first = L(zhM(p[0]), p[0], zhM(p[0])), last = L(zhM(p[p.length - 1]), p[p.length - 1], zhM(p[p.length - 1]));
      return p.length > 1 ? first + L('—', ' – ', '—') + last + L('（' + p.length + ' 期）', ' (' + p.length + ' periods)', '（' + p.length + ' 期間）') : first;
    };
    const basisZh = b => b === 'GEOGRAPHIC_SCREENING' ? L('直线估算（非道路里程）', 'straight-line screening (not road)', '直線見積もり（実走距離ではない）') : b === 'ESTIMATED_ROAD' ? L('估算道路距离（来源已标注）', 'estimated road distance (source annotated)', '推定道路距離（出典明記）') : b === 'VERIFIED_ROAD' ? L('来源声明已核验道路（核验依据需另查）', 'Source-declared verified roads (review evidence)', '出典による検証済道路（根拠要確認）') : (b || '—');
    const clean = v => String(v == null ? '—' : v).replace(/-\d[\d,.]*$/, '');
    const scope = ev.scope || {};
    const scopeLines = [];
    if (scope.focus) scopeLines.push(L('对比方案：', 'Compared plan: ', '比較案：') + clean(scope.focus));
    if (scope.reference) scopeLines.push(L('参照：', 'Reference: ', '参照：') + scope.reference + L('（当前各客户的实际归属）', ' (current actual assignments)', '（各顧客の実際の担当）'));
    if (scope.periods) scopeLines.push(L('期间：', 'Periods: ', '期間：') + fmtP(scope.periods));
    if (scope.unit) scopeLines.push(L('计量单位：', 'Unit: ', '計量単位：') + scope.unit);
    if (scope.distanceBasis) scopeLines.push(L('距离口径：', 'Distance basis: ', '距離基準：') + basisZh(scope.distanceBasis));
    if (scope.common) scopeLines.push(L('共同可比样本：', 'Common comparable sample: ', '共通比較サンプル：') + scope.common);
    if (scope.closedSites && scope.closedSites.length) scopeLines.push(L('评估的关闭仓：', 'Closure sites assessed: ', '評価した閉鎖倉庫：') + scope.closedSites.join(L('、', ', ', '、')));
    if (scope.capacity) scopeLines.push(L('容量状态：未知 ', 'Capacity: unknown ', '容量状態：未知 ') + (scope.capacity.unknownPeriods || 0) + L(' 仓月 / 已知超限 ', ' site-months / known exceedances ', ' 倉庫月 / 既知超過 ') + (scope.capacity.exceededPeriods || 0) + L(' 仓月', ' site-months', ' 倉庫月'));
    if (scope.rows) scopeLines.push(L('逐条变化记录：', 'Changed line records: ', '変更明細記録：') + scope.rows + L(' 条', ' records', ' 件'));
    const d = ev.delta || {};
    const deltaLine = L(d.delta != null
      ? `配送总里程 ${num(d.from)} → ${num(d.to)} ${unitZh(model.scope.unit)}·公里，${d.delta < 0 ? '减少' : '增加'} ${num(Math.abs(d.delta))} ${unitZh(model.scope.unit)}·公里（约 ${d.from ? Display.number(d.delta / d.from * 100) : '—'}%）。`
      : (d.sum != null ? `逐客户里程变化合计 ${num(d.sum)} ${unitZh(model.scope.unit)}·公里，与方案总差额${d.reconciled ? '完全一致（对账通过）' : '存在未解释差额，请复核明细'}。` : '本结论不涉及数值差额，依据为口径与状态判断。'),
      d.delta != null
      ? `Total delivery volume-km ${num(d.from)} → ${num(d.to)} ${unitZh(model.scope.unit)}·km, ${d.delta < 0 ? 'down' : 'up'} ${num(Math.abs(d.delta))} ${unitZh(model.scope.unit)}·km (about ${d.from ? Display.number(d.delta / d.from * 100) : '—'}%).`
      : (d.sum != null ? `Per-customer volume-km change sums to ${num(d.sum)} ${unitZh(model.scope.unit)}·km, ${d.reconciled ? 'fully reconciled with the plan total delta' : 'with an unexplained gap versus the plan total — review the detail'}.` : 'This finding carries no numeric delta; the evidence is caliber and status.'),
      d.delta != null
      ? `配送総物量キロ ${num(d.from)} → ${num(d.to)} ${unitZh(model.scope.unit)}·km、${d.delta < 0 ? '減少' : '増加'} ${num(Math.abs(d.delta))} ${unitZh(model.scope.unit)}·km（約 ${d.from ? Display.number(d.delta / d.from * 100) : '—'}%）。`
      : (d.sum != null ? `顧客別距離変化の合計は ${num(d.sum)} ${unitZh(model.scope.unit)}·km、総差額と${d.reconciled ? '完全一致（照合通過）' : '未説明の差があります。明細をご確認ください'}。` : '本結論に数値差額はなく、口径と状態の判断に基づきます。'));
    const detailRows = ev.detail || [];
    const detailTable = detailRows.length
      ? `<div class="scro-scroll"><table class="scro-table"><thead><tr><th>${L("客户", "Customer", "顧客")}</th><th>${L("期间", "Period", "期間")}</th><th>${L("原服务仓", "From site", "元担当倉庫")}</th><th>${L("新服务仓", "To site", "新担当倉庫")}</th><th>${L("物量", "Volume", "物量")}(${unitZh(model.scope.unit)})</th><th>${L("里程变化", "Δ volume-km", "距離変化")}(${unitZh(model.scope.unit)}·${L("公里", "km", "km")})</th></tr></thead><tbody>${detailRows.slice(0, 30).map(x => `<tr><td>${esc(x.customerName || (x.closedSites || []).join('、') || '—')}</td><td>${esc(x.period || '—')}</td><td>${esc(x.fromOldName || '—')}</td><td>${esc(x.fromNewName || '—')}</td><td>${num(x.quantity)}</td><td>${x.deltaVolumeKm != null ? num(x.deltaVolumeKm) : num(x.transportPenaltyVkm)}</td></tr>`).join('')}</tbody></table></div>${detailRows.length > 30 ? `<p class="scro-note">${L('仅示前 30 条，完整明细见计算附件。', 'First 30 rows shown; full detail is in the calculation attachment.', '先頭30件を表示。全明細は計算添付をご覧ください。')}</p>` : ''}`
      : `<p class="scro-note">${L('本结论的依据是主表《候选比较》的同口径排名；逐客户明细请看 F-01、F-04 的依据。', 'This finding rests on the same-caliber ranking in the Candidate comparison table; per-customer detail is in the evidence for F-01 and F-04.', '本結論は「候補比較」の同一口径ランキングに基づきます。顧客別明細は F-01・F-04 の根拠をご覧ください。')}</p>`;
    const nameZh = id => id === 'M-OUT-WKM' ? L('配送平均距离', 'Avg delivery distance', '平均配送距離') : id === 'M-OUT-VKM' ? L('配送总里程', 'Total delivery volume-km', '配送総物量キロ') : id === 'M-COST' ? L('运营成本', 'Operating cost', '運用コスト') : id === 'M-CHANGED' ? L('受影响需求记录', 'Affected demand records', '影響需要記録') : (id || L('指标', 'Metric', '指標'));
    const caliber = (ev.caliber || []).map(m => `${L('【', '[ ', '【')}${nameZh(m.metricId)}${L('】', ' ]', '】')}${m.formula || ''}　${L('（来源：', '(source: ', '（出典：')}${m.source === 'MODEL_CALC' || !m.source ? L('模型计算', 'model calculation', 'モデル計算') : m.source}${L('；可比性：', '; comparability: ', '；比較可能性：')}${m.comparable === 'FULL' ? L('完整可比', 'fully comparable', '完全比較可能') : m.comparable === 'PARTIAL' ? L('部分可比', 'partially comparable', '部分比較可能') : L('不可比/未核验', 'not comparable / unverified', '比較不可/未検証')}${L('）', ')', '）')}`).join('<br>');
    const src = ev.sources || {};
    const srcLines = [];
    if (src.note) srcLines.push(src.note);
    if (src.distanceSource) srcLines.push(L('距离口径：', 'Distance basis: ', '距離基準：') + basisZh(src.distanceSource));
    if (src.sampleSetHash) srcLines.push(L('样本集合已锁定（同一批 ', 'Sample set locked (same batch ', 'サンプル集合ロック（同一バッチ ') + String(src.sampleSetHash).slice(0, 10) + '…）');
    if (src.snapshotHash) srcLines.push(L('结果版本（供技术核对）：', 'Result version (for technical check): ', '結果バージョン（技術照合用）：') + String(src.snapshotHash).slice(0, 14) + '…');
    return `<div><h3>${L("依据", "Evidence", "根拠")} · ${esc(findingId)}</h3>
      <h4>1. ${L("跟什么比", "Compared against what", "何と比較したか")}</h4><p>${scopeLines.map(esc).join('<br>')}</p>
      <h4>2. ${L("好在哪、差在哪", "Gains and losses", "どこが良くなり、どこが悪化したか")}</h4><p>${esc(deltaLine)}</p>
      <h4>3. ${detailRows.length ? L("哪些客户变了", "Which customers changed", "どの顧客が変わったか") : L("依据来源", "Evidence source", "根拠の出所")}</h4>${detailTable}
      <h4>4. ${L("数字怎么算的", "How the numbers are computed", "数字の計算方法")}</h4><p class="scro-note">${caliber}</p>
      <h4>5. ${L("数据从哪来", "Where the data comes from", "データの出所")}</h4><p class="scro-note">${srcLines.map(esc).join('<br>')}</p>
      <h4>6. ${L("明细在哪个附件", "Which attachment has the detail", "明細はどの添付か")}</h4><p class="scro-note">${esc(ev.exportRef || '—')}</p>
      <div class="sc-actions scro-no-print"><button type="button" data-scro-ev-close>${L("关闭依据", "Close evidence", "根拠を閉じる")}</button></div></div>`;
  }


/*==NEWENGINE==*/
/*==NEWENGINE2==*/
  let overlay = null, evidenceEl = null, keyHandler = null, lastFocus = null;
  function closeOverlay() {
    if (keyHandler) { globalThis.removeEventListener("keydown", keyHandler); keyHandler = null; }
    if (overlay) { overlay.remove(); overlay = null; }
    if (evidenceEl) { evidenceEl.remove(); evidenceEl = null; }
    if (lastFocus && typeof lastFocus.focus === "function") { try { lastFocus.focus(); } catch (_) {} }
    lastFocus = null;
  }
  function open(viewState, locale = "zh", actions = {}) {
    const model = buildModel(viewState, locale);
    const opener = document.activeElement;
    closeOverlay();
    lastFocus = opener && opener !== document.body ? opener : document.activeElement;
    overlay = document.createElement("div");
    overlay.className = "scro-overlay mode-rp";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "交互式结论报告 / Interactive conclusion report");
    overlay.tabIndex = -1;
    const L = (zh, en, ja) => pick(model.locale || 'zh', zh, en, ja);
    overlay.__viewState = viewState;
    overlay.innerHTML = `<style>${CSS}</style>
      <div class="scro-bar scro-no-print">
        <span class="sl-title">${L("结论报告", "Conclusion report", "結論レポート")} · ${esc(model.identity.studyName).slice(0, 30)}</span>
        <button type="button" data-scro-mode="report" class="on">${L("结论报告", "Report", "レポート")}</button>
        <button type="button" data-scro-mode="doc">${L("文档", "Document", "文書")}</button>
        <button type="button" data-scro-print>${L("打印/存 PDF", "Print / Save PDF", "印刷 / PDF保存")}</button>
        <button type="button" data-scro-manifest>${L("导出清单", "Export manifest", "書き出し一覧")}</button>
        <button type="button" data-scro-close>${L("关闭", "Close", "閉じる")}</button>
      </div>
      <div class="rp-stage">${reportHtml(model, viewState)}</div>
      <div class="doc-stage" style="display:none">${render(model, { mode: "read" }, viewState)}</div>`;
    document.body.appendChild(overlay);
    overlay.focus();
    const setMode = m => {
      overlay.classList.toggle("mode-rp", m === 'report');
      overlay.classList.toggle("mode-doc", m === 'doc');
      overlay.querySelector(".rp-stage").style.display = m === 'report' ? '' : 'none';
      overlay.querySelector(".doc-stage").style.display = m === 'doc' ? '' : 'none';
      overlay.querySelectorAll("[data-scro-mode]").forEach(b => b.classList.toggle("on", b.dataset.scroMode === m));
    };
    overlay.addEventListener("click", async event => {
      const t = event.target.closest("button, [data-advanced-feature]");
      if (!t) return;
      if (t.dataset.scroAction) {
        const currentOverlay=overlay,body=currentOverlay.querySelector('#sc-advanced-body');
        try {
          if(actions.isCurrent&&!actions.isCurrent())throw new Error('SUPPLY_SNAPSHOT_STALE');
          if(t.dataset.scroAction==='comparison-list') {
            const pointers=await actions.listComparisons?.()||[];
            if(overlay!==currentOverlay)return;
            if(actions.isCurrent&&!actions.isCurrent())throw new Error('SUPPLY_SNAPSHOT_STALE');
            currentOverlay.__viewState={...viewState,comparisonPointers:pointers};
            if(overlay===currentOverlay)body.innerHTML=compareHtml(model,currentOverlay.__viewState);
          }else if(actions.navigate){closeOverlay();actions.navigate(t.dataset.scroAction,model.focusId);}
        }catch(error){if(overlay===currentOverlay)body.textContent=L('操作未完成：','Action incomplete: ','操作未完了：')+(error.code||error.message);}
        return;
      }
      if (t.dataset.scroClose !== undefined) return closeOverlay();
      if (t.dataset.scroPrint !== undefined) return globalThis.print();
      if (t.dataset.scroNotes !== undefined) return overlay.classList.toggle("notes-on");
      if (t.dataset.scroManifest !== undefined) {
        const blob = new Blob([JSON.stringify(model.manifest, null, 2)], { type: "application/json" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "report-manifest.json"; a.click(); return;
      }
      if (t.dataset.scroMode) { setMode(t.dataset.scroMode); return; }
      if (t.dataset.calc !== undefined) {
        const panel = overlay.querySelector(`[data-calc-for="${t.dataset.calc}"]`);
        if (panel) {
          panel.hidden = !panel.hidden;
          if (!panel.hidden) panel.scrollIntoView({ behavior: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
        }
        return;
      }
      if (t.dataset.advancedFeature) {
        const panel = overlay.querySelector('#sc-advanced-panel');
        const body = overlay.querySelector('#sc-advanced-body');
        const title = overlay.querySelector('#sc-advanced-title');
        if (panel && body && title) {
          panel.classList.add('open');
          const fid = t.dataset.advancedFeature;
          title.textContent = t.querySelector('h4')?.textContent || fid;
          const viewState = overlay.__viewState || {};
          const renderers = { compare: () => compareHtml(model, viewState), tco: () => tcoHtml(model, viewState), carbon: () => carbonHtml(model, viewState), topology: () => networkTopologyHtml(model, viewState), sensitivity: () => sensitivityHtml(model, viewState), map: () => mapInteractionHtml(model, viewState) };
          body.innerHTML = renderers[fid] ? renderers[fid]() : '<p>功能加载中...</p>';
          panel.scrollIntoView({ behavior: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: 'nearest' });
        }
        return;
      }
      if (t.dataset.scroEv) {
        if (evidenceEl) evidenceEl.remove();
        evidenceEl = document.createElement("div");
        evidenceEl.className = "scro-evidence";
        evidenceEl.setAttribute("role", "dialog");
        evidenceEl.setAttribute("aria-label", "结论依据 / Evidence");
        evidenceEl.tabIndex = -1;
        evidenceEl.innerHTML = evidenceHtml(t.dataset.scroEv, model);
        evidenceEl.addEventListener("click", ev => {
          const b = ev.target.closest("button");
          if (b && b.dataset.scroEvClose !== undefined) { evidenceEl.remove(); evidenceEl = null; if (overlay) overlay.focus(); }
        });
        document.body.appendChild(evidenceEl);
        evidenceEl.focus();
        return;
      }
      if (t.dataset.scroEvClose !== undefined && evidenceEl) { evidenceEl.remove(); evidenceEl = null; return; }
    });
    overlay.addEventListener('change',async event=>{
      if(!event.target.matches('[data-scro-comparison]')||!event.target.value)return;
      const currentOverlay=overlay;
      try {
        if(actions.isCurrent&&!actions.isCurrent())throw new Error('SUPPLY_SNAPSHOT_STALE');
        const pair=await actions.loadComparison(event.target.value);
        if(overlay!==currentOverlay)return;
        if(actions.isCurrent&&!actions.isCurrent())throw new Error('SUPPLY_SNAPSHOT_STALE');
        currentOverlay.__viewState={...currentOverlay.__viewState,comparisonStudies:[pair]};
        currentOverlay.querySelector('#sc-advanced-body').innerHTML=compareHtml(model,currentOverlay.__viewState);
      }catch(error){if(overlay===currentOverlay)currentOverlay.querySelector('#sc-advanced-body').textContent=L('无法比较该研究：','Cannot compare study: ','研究を比較できません：')+(error.code||error.message);}
    });
    keyHandler = event => {
      if ((event.key === "Enter" || event.key === " ") && event.target && event.target.matches && event.target.matches('[data-advanced-feature][role="button"]')) { event.preventDefault(); event.target.click(); return; }
      if (event.key === "Escape") { if (evidenceEl) { evidenceEl.remove(); evidenceEl = null; if (overlay) overlay.focus(); } else closeOverlay(); return; }
      if (event.key === "Tab") {
        const scopeEl = evidenceEl || overlay;
        const items = [...scopeEl.querySelectorAll('button,[href],input,select,textarea,summary,[tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || !scopeEl.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !scopeEl.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
        return;
      }
    };
    globalThis.addEventListener("keydown", keyHandler);
    return model;
  }
/*==ENDNEWENGINE2==*/

  return Object.freeze({ SCHEMA, buildModel, render, evidenceHtml, open, close: closeOverlay, compareHtml, tcoHtml, carbonHtml, networkTopologyHtml, sensitivityHtml, advancedDrawerHtml, mapInteractionHtml });
});
