(function (root) {
  'use strict';
  const ns = root.STCTPlatformV19 = root.STCTPlatformV19 || {};
  const tools = {
    '/command/analysis': ['analysisView', 'renderAnalysis', 'analysis'],
    '/command/cost': ['costView', 'renderCost', 'cost'],
    '/command/carbon': ['carbonView', 'renderCarbon', 'carbon'],
    '/command/report': ['reportView', 'renderReport', 'report'],
  };
  const words = {
    zh: ['运输规划数据', '尚未应用运输路线数据', '请先在数据中心导入运输数据并应用计划。供应链月度需求不会转换为派车订单；运营演示也不会自动成为这里的统计数据。', '打开数据中心', '完整排车工具', '以下统计来自原运输规划数据，与运营模拟分开。成本和碳排采用原配置假设，不代表已核验实际费用或排放。'],
    en: ['Transport planning data', 'No transport routes applied', 'Import transport data and apply a plan first. Monthly supply-chain demand is not dispatch orders. Operations demos are not automatically used for these metrics.', 'Open Data Hub', 'Full dispatch tools', 'These statistics use the original transport plan, separately from operations simulation. Cost and carbon use configured assumptions, not verified actual expenses or emissions.'],
    ja: ['輸送計画データ', '輸送ルートが未適用です', 'データハブで輸送データを取り込み、計画を適用してください。月次需要は配車注文ではなく、運用デモも統計に自動転用しません。', 'データハブを開く', '配車ツール詳細', '元の輸送計画を集計します。運用シミュレーションとは別です。費用と排出量は設定上の仮定であり、検証済み実績ではありません。'],
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let mounted = null;
  function appliedView(slot, route, context, locale) {
    const snapshot = context.snapshot();
    const plan = context.workspace.snapshot().appliedPlan || context.basePlan;
    const evaluated = plan.networkEvaluation;
    const accounting = evaluated?.accounting;
    const w = locale === 'en' ? ['Applied operational plan', 'Estimated; not actual expense or measured emissions', 'Item', 'Value', 'Route', 'Vehicle', 'Orders', 'Distance km', 'Not available', 'Export plan evidence', 'Print'] : locale === 'ja' ? ['適用済み運用計画', '推計値。実費・実測排出量ではありません', '項目', '値', 'ルート', '車両', '注文', '距離 km', '未取得', '計画証拠を出力', '印刷'] : ['当前已应用运营计划', '按现有模型假设估算，不代表实际费用或实测排放', '项目', '数值', '路线', '车辆', '订单', '距离 km', '未提供', '导出计划证据', '打印'];
    const table = (headers, rows) => `<div class="command-table-wrap" tabindex="0" role="region" aria-label="${esc(w[0])}"><table class="command-table"><thead><tr>${headers.map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${esc(x ?? w[8])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    const routes = table(w.slice(4,8), (plan.routes||[]).map(r=>[r.routeId,r.vehicleId,r.orderIds?.length,Number.isFinite(r.totalDistance)?r.totalDistance:Number.isFinite(r.plannedDistanceMeters)?r.plannedDistanceMeters/1000:null]));
    const cost = accounting?.cost, carbon = accounting?.carbon;
    const componentLabels = locale === 'zh' ? {vehicleFixed:'车辆固定费用',tripFixed:'趟次固定费用',distance:'里程费用',time:'行驶时间费用',toll:'通行费',emptyReposition:'空驶调位',dockHandling:'月台装卸',dockWaiting:'月台等待',reload:'重新装载',transfer:'中转',depotHandling:'仓库处理',overtime:'加班',unassigned:'未分配惩罚',failedConnection:'衔接失败惩罚',loadedTravel:'载货行驶',emptyTravel:'空驶',handling:'装卸'} : {};
    const ledger = value => value ? table([w[2],w[3]], [...Object.entries(value.components||{}).map(([k,v])=>[componentLabels[k]||k,v]), ['TOTAL',value.total ?? value.totalKg], ['UNIT',value.currency || 'kgCO2']]) : `<p class="command-empty">${w[8]}</p>`;
    const metrics = evaluated?.plan?.trip?.metrics;
    const labels = locale === 'zh' ? ['规划趟次','已分配订单','规划行驶距离 km','估算费用','估算碳排 kgCO₂'] : locale === 'ja' ? ['計画便数','割当済み注文','計画走行距離 km','推計費用','推計排出量 kgCO₂'] : ['Planned trips','Assigned orders','Planned driving km','Estimated cost','Estimated carbon kgCO₂'];
    const facts = [[labels[0],metrics?.tripCount],[labels[1],metrics?.assignedOrders],[labels[2],metrics?.routeDistanceKm],[labels[3],cost?.total],[labels[4],carbon?.totalKg ?? carbon?.total]];
    const selectedFacts = route.endsWith('/cost') ? [facts[3],facts[2],facts[1]] : route.endsWith('/carbon') ? [facts[4],facts[2],facts[0]] : route.endsWith('/report') ? facts : facts.slice(0,3);
    const kpis = `<div class="command-business-metrics">${selectedFacts.map(([label,value])=>`<div><span>${esc(label)}</span><strong>${Number.isFinite(value)?esc(value.toLocaleString(locale==='zh'?'zh-CN':locale==='ja'?'ja-JP':'en-US',{maximumFractionDigits:3})):esc(w[8])}</strong></div>`).join('')}</div>`;
    const content = route.endsWith('/cost') ? ledger(cost) : route.endsWith('/carbon') ? ledger(carbon) : route.endsWith('/report') ? routes + ledger(cost) + ledger(carbon) : routes;
    slot.innerHTML = `<section class="command-band command-applied-analysis" data-plan-hash="${esc(plan.planHash)}"><header><div><p>${esc(w[0])} · ${esc(plan.planId)}</p><h2>${esc(snapshot.scenario.dataClassification)}</h2></div><span>${esc(w[1])}</span></header>${kpis}${content}<details class="p7-summary-details"><summary>Plan / Source</summary><p>${esc(plan.planHash)} · ${esc(plan.providerProvenance?.providerId||plan.matrixHash)} · ${esc(plan.verification?.status)}</p><pre>${esc(JSON.stringify(accounting?.assumptions||{},null,2))}</pre></details><div class="command-button-row"><button type="button" class="command-button" data-native-export>${w[9]}</button><button type="button" class="command-button" data-native-print>${w[10]}</button></div></section>`;
    slot.querySelector('[data-native-export]').onclick = () => {
      const blob = new Blob([JSON.stringify({schemaVersion:'stct-command-report-evidence-v85',planId:plan.planId,planHash:plan.planHash,source:snapshot.scenario,plan},null,2)],{type:'application/json'});
      const url = URL.createObjectURL(blob), a = root.document.createElement('a'); a.href=url;a.download='transport-plan-evidence.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    slot.querySelector('[data-native-print]').onclick = () => root.print();
  }
  function park() {
    if (!mounted) return;
    const {panel, marker, onApply} = mounted;
    if (onApply) panel.removeEventListener("click", onApply, true);
    panel.classList.remove('command-native-panel', 'active');
    marker.replaceWith(panel);
    mounted = null;
  }
  function heading(route, locale) {
    const row = tools[route]; const w = words[locale] || words.zh;
    const title = ns.navigationI18n.translate('route.command.' + row[2], locale);
    return `<header class="command-page-heading"><div><p>${w[0]}</p><h1>${title}</h1><span>${w[5]}</span></div></header><div data-native-tool-slot></div>`;
  }
  function mount(target, route, locale, context, hasDataDraft) {
    const w = words[locale] || words.zh;
    let row = tools[route];
    const dispatch = route === '/command/dispatch';
    if (!row && !dispatch) return;
    if (dispatch && hasDataDraft) return;
    if (row && context?.snapshot().scenario.sourceType === 'UPLOADED_APPLIED' && (context.basePlan.networkEvaluation || !root.STCTCore?.getTransportDataState?.().applied)) {
      const slot = target.querySelector('[data-native-tool-slot]');
      target.querySelector('.command-page-heading span').textContent = ({zh:'来自当前已应用计划与核算快照。距离、费用和碳排均保留原模型假设；不代表实时运营实绩。',en:'From the current applied plan and accounting snapshot. Original distance, cost and carbon assumptions remain; these are not live actuals.',ja:'現在の適用済み計画と会計スナップショット。距離・費用・排出量の元の仮定を保持し、リアルタイム実績ではありません。'})[locale] || words.zh[5];
      appliedView(slot, route, context, locale); return;
    }
    const core = root.STCTCore;
    const dataReady = dispatch ? !!core?.getRawData?.() : !!core?.getData?.()?.routes?.length && core.getTransportDataState?.().applied;
    let slot = target.querySelector('[data-native-tool-slot]');
    if (dispatch) {
      row = dataReady ? ['optimizerView', 'renderOptimizer'] : ['uploadView', 'renderUpload'];
      const details = root.document.createElement('details');
      details.className = 'command-native-tools'; details.open = true;
      const summary = root.document.createElement('summary'); summary.textContent = dataReady ? w[4] : ({zh:"原排车数据导入 · 订单 / 车辆 / 仓库",en:"Original dispatch import · orders / vehicles / depots",ja:"元の配車データ取込・注文 / 車両 / 倉庫"}[locale] || w[4]);
      details.open = dataReady;
      slot = root.document.createElement('div'); details.append(summary, slot);
      target.querySelector('.command-page-heading').after(details);
    }
    if (!slot) return;
    if (!dataReady && !dispatch) {
      slot.innerHTML = `<section class="command-empty-workbench"><span class="command-empty-mark" aria-hidden="true">↗</span><h2>${w[1]}</h2><p>${w[2]}</p><button type="button" class="command-button is-primary" data-platform-route="/platform/data">${w[3]}</button></section>`;
      return;
    }
    const panel = root.document.getElementById(row[0]);
    if (!panel) { slot.textContent = w[1]; return; }
    const marker = root.document.createComment('native transport panel parking position');
    panel.replaceWith(marker); mounted = {panel, marker};
    if (row[0] === 'uploadView') {
      const onApply = event => { if (event.target.closest('#applyBatchBtn')) root.setTimeout(() => ns.instance?.commandAdapter.render(), 0); };
      panel.addEventListener('click', onApply, true); mounted.onApply = onApply;
    }
    slot.append(panel); panel.classList.add('command-native-panel', 'active');
    (root.STCTRender?.[row[1]] || root[row[1]])?.();
  }
  ns.classicTools = Object.freeze({has: route => !!tools[route], heading, mount, park});
})(window);
