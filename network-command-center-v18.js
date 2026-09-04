(function (root, factory) {
  "use strict";
  const contract = typeof module !== "undefined" && module.exports ? require("./network-contract-v18.js") : root.STCTV18?.networkContract;
  const api = factory(contract);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV18 = root.STCTV18 || { version: "1.8.0" }; root.STCTV18.networkCommandCenter = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Contract) {
  "use strict";

  if (!Contract?.hashArtifact) throw new Error("STCT v1.8 command center requires the network contract.");
  const VERSION = "stct-network-command-center-v1.8";
  const TEXT = Object.freeze({
    en: { title: "Network Operations", synthetic: "Synthetic test data", decision: "Decision Room", map: "Network Map", capacity: "Capacity Heatmap", trips: "Trip Chain", docks: "Dock Gantt", time: "Time-Space", scenarios: "Scenario Arena", recovery: "Network Recovery", capsule: "Network Capsule", alert: "Critical alert", service: "Service risk", action: "Recommended action", evidence: "Evidence", summary: "Network summary", depot: "Depot detail", assignment: "Assignment", fleet: "Fleet Mix", cost: "Cost-to-Serve", shock: "Demand Shock", transfer: "Transfer detail", preview: "Preview", apply: "Apply", later: "Move 15 minutes later", previous: "Previous", next: "Next", compare: "Compare scenarios", loading: "Preview required", exported: "Export capsule", long: "Long description", local: "Local demo only; no auto apply and no global optimum claim.", depots: "Depots", trip: "Trip", vehicle: "Vehicle", driver: "Driver", carbon: "Carbon kg", role: "Role", label: "Label", route: "Route", distance: "Distance", order: "Order", assignedDepot: "Assigned depot", reason: "Reason", signal: "Signal", period: "Period", value: "Value", level: "Level", window: "Window", orders: "Orders", reservation: "Reservation", dock: "Dock", operation: "Operation", interval: "Interval", type: "Type", entity: "Entity", minute: "Minute", shipment: "Shipment", status: "Status", scenario: "Scenario", candidate: "Candidate", engine: "Engine", verification: "Verification", changedTrips: "Changed trips", readOnly: "Read-only replay", redundant: "Symbol + value + level", ready: "READY", previewReady: "Preview ready; no changes applied.", applied: "Applied to local demo state.", recoveryReady: "Recovery candidate previewed; not applied.", rescheduleReady: "+15 min proposal", capsuleReady: "EXPORTED_READ_ONLY" },
    zh: { title: "网络运营", synthetic: "合成测试数据", decision: "决策室", map: "网络地图", capacity: "容量热力图", trips: "趟次链", docks: "月台甘特图", time: "时间空间图", scenarios: "场景分析", recovery: "网络恢复", capsule: "网络胶囊", alert: "关键告警", service: "服务风险", action: "建议动作", evidence: "证据", summary: "网络摘要", depot: "仓库明细", assignment: "分配结果", fleet: "车队组合", cost: "服务成本", shock: "需求冲击", transfer: "交接明细", preview: "预览", apply: "应用", later: "向后移动15分钟", previous: "上一个", next: "下一个", compare: "比较场景", loading: "需先预览", exported: "导出胶囊", long: "详细说明", local: "仅限本地演示；不会自动应用，也不声明全局最优。", depots: "仓库", trip: "趟次", vehicle: "车辆", driver: "驾驶员", carbon: "碳排放千克", role: "角色", label: "名称", route: "路线", distance: "距离", order: "订单", assignedDepot: "分配仓库", reason: "原因", signal: "信号", period: "时段", value: "数值", level: "等级", window: "时间窗", orders: "订单数", reservation: "预约", dock: "月台", operation: "作业", interval: "时段", type: "类型", entity: "对象", minute: "分钟", shipment: "货件", status: "状态", scenario: "场景", candidate: "候选方案", engine: "引擎", verification: "验证", changedTrips: "变更趟次", readOnly: "只读回放", redundant: "符号 + 数值 + 等级", ready: "已就绪", previewReady: "预览已就绪，尚未应用任何变更。", applied: "已应用到本地演示状态。", recoveryReady: "已预览恢复候选方案，尚未应用。", rescheduleReady: "+15 分钟方案", capsuleReady: "已导出只读胶囊" },
    ja: { title: "ネットワーク運用", synthetic: "合成テストデータ", decision: "意思決定室", map: "ネットワークマップ", capacity: "容量ヒートマップ", trips: "便チェーン", docks: "ドックガント", time: "時空間", scenarios: "シナリオ分析", recovery: "ネットワーク復旧", capsule: "ネットワークカプセル", alert: "重大アラート", service: "サービスリスク", action: "推奨アクション", evidence: "証拠", summary: "ネットワーク概要", depot: "拠点詳細", assignment: "割当結果", fleet: "車両構成", cost: "サービス原価", shock: "需要ショック", transfer: "移管詳細", preview: "プレビュー", apply: "適用", later: "15分後へ移動", previous: "前へ", next: "次へ", compare: "シナリオ比較", loading: "先にプレビューが必要", exported: "カプセル出力", long: "詳細説明", local: "ローカルデモのみ。自動適用と全体最適の主張はありません。", depots: "拠点", trip: "便", vehicle: "車両", driver: "ドライバー", carbon: "炭素 kg", role: "役割", label: "名称", route: "ルート", distance: "距離", order: "注文", assignedDepot: "割当拠点", reason: "理由", signal: "信号", period: "時間帯", value: "値", level: "レベル", window: "時間枠", orders: "注文数", reservation: "予約", dock: "ドック", operation: "作業", interval: "時間帯", type: "種類", entity: "対象", minute: "分", shipment: "貨物", status: "状態", scenario: "シナリオ", candidate: "候補", engine: "エンジン", verification: "検証", changedTrips: "変更便", readOnly: "読み取り専用リプレイ", redundant: "記号 + 値 + レベル", ready: "準備完了", previewReady: "プレビュー準備完了。変更は未適用です。", applied: "ローカルデモ状態に適用しました。", recoveryReady: "復旧候補をプレビューしました。未適用です。", rescheduleReady: "+15分の提案", capsuleReady: "読み取り専用カプセルを出力済み" },
  });
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  function locale(value) { return String(value).startsWith("zh") ? "zh" : String(value).startsWith("ja") ? "ja" : "en"; }
  function table(headers, rows, className = "data-table") { return `<div class="table-scroll">
<table class="${className}">
<thead>
<tr>${headers.map((header) => `<th scope="col">${esc(header)}</th>`).join("")}</tr>
</thead>
<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
</table>
</div>`; }
  function svgMap(model, labels) {
    const points = model.layers.depots.map((row) => row.geometry.coordinates); const xs = points.map((row) => row[0]); const ys = points.map((row) => row[1]); const minX = Math.min(...xs) - 0.03; const maxX = Math.max(...xs) + 0.03; const minY = Math.min(...ys) - 0.03; const maxY = Math.max(...ys) + 0.03; const project = ([x, y]) => [40 + (x - minX) / Math.max(0.0001, maxX - minX) * 760, 410 - (y - minY) / Math.max(0.0001, maxY - minY) * 360];
    const routes = model.layers.tripRoutes.slice(0, 80).map((route) => `<polyline class="flow-line" points="${route.geometry.coordinates.map((point) => project(point).join(",")).join(" ")}" fill="none" stroke="#1473e6" stroke-width="2" opacity=".35" stroke-dasharray="8 4" data-route="${esc(route.id)}"/>`).join("");
    const depots = model.layers.depots.map((depot) => { const [x, y] = project(depot.geometry.coordinates); return `<g tabindex="0" role="button" data-hover data-entity="depot" data-id="${esc(depot.id)}" aria-label="${esc(depot.properties.label)}">
<circle class="pulse" cx="${x}" cy="${y}" r="11" fill="#0b4f9c" stroke="#fff" stroke-width="3"/>
<text x="${x + 15}" y="${y + 4}" font-size="12" fill="#12324f">${esc(depot.id)}</text>
</g>`; }).join("");
    return `<svg class="network-map" viewBox="0 0 840 440" role="img" aria-labelledby="mapTitle mapSummary">
<title id="mapTitle">${esc(labels.map)}</title>
<rect width="840" height="440" fill="#f4f7f9"/>
<path d="M0 118H840M0 238H840M0 358H840M180 0V440M420 0V440M660 0V440" stroke="#dbe5ec" stroke-width="1"/>${routes}${depots}</svg>`;
  }
  function navButton(id, label, active = false) { return `<button type="button" role="tab" aria-selected="${active}" aria-controls="view-${id}" data-view="${id}">${esc(label)}</button>`; }
  function stepper(kind, labels) { return `<div class="stepper" data-stepper="${kind}">
<button type="button" data-step="${kind}" data-direction="-1" aria-label="${esc(labels.previous)} ${esc(kind)}">&lt;</button>
<output data-step-output="${kind}" aria-live="polite">1</output>
<button type="button" data-step="${kind}" data-direction="1" aria-label="${esc(labels.next)} ${esc(kind)}">&gt;</button>
</div>`; }
  function render(payload, options = {}) {
    const language = locale(options.locale || "en"); const t = TEXT[language]; const model = payload.model; const plan = payload.plan; const ledger = payload.ledger; const noWebGL = options.noWebGL === true; const reduced = options.reducedMotion === true;
    const summaryValues = [model.layers.depots.length, model.layers.tripRoutes.length, model.layers.transfers.length, model.layers.closures.length, model.alerts.filter((row) => row.severity === "CRITICAL").length];
    const mapSummary = language === "zh" ? `合成网络包含 ${summaryValues[0]} 个仓库、${summaryValues[1]} 条趟次路线、${summaryValues[2]} 个交接、${summaryValues[3]} 个道路关闭和 ${summaryValues[4]} 个关键告警。` : language === "ja" ? `合成ネットワークには、${summaryValues[0]}拠点、${summaryValues[1]}便ルート、${summaryValues[2]}件の移管、${summaryValues[3]}件の通行止め、${summaryValues[4]}件の重大アラートがあります。` : payload.mapSummary;
    const shockLabel = language === "zh" ? "需求增加 10%；场景已变更；结果为已测试配置中的最佳方案。" : language === "ja" ? "需要が10%増加。シナリオ変更済み。テスト済み構成で得られた最良結果です。" : payload.shockLabel;
    const room = payload.decisionRoom; const firstAlert = room.criticalAlerts[0] || { reasonCode: "NO_CRITICAL_ALERT", message: "Verified synthetic network state" }; const firstAction = room.recommendedActions[0] || { action: "MONITOR", evidence: { reasonCode: "VERIFIED_BASELINE", sourceHash: model.networkPlanHash }, autoApply: false };
    const depotRows = model.layers.depots.map((row) => [row.id, row.properties.role, row.properties.label]); const assignmentRows = plan.assignment.assignments.slice(0, 20).map((row) => [row.orderId, row.assignedDepotId, row.reasonCode]); const heatRows = model.heatmaps.depotTime.map((row) => [row.symbol, row.row, row.column, `${Math.round(row.value * 100)}%`, row.level]); const tripRows = plan.trip.trips.slice(0, 24).map((row) => [row.tripId, row.vehicleId, row.driverId, `${row.startTime}-${row.endTime}`, row.orderIds.length]); const dockRows = model.dockGantt.reservations.slice(0, 32).map((row) => [row.reservationId, row.dockId, row.tripId, row.operation, `${row.startMinute}-${row.endMinute}`]); const timeRows = payload.timeSpace.tableEquivalent.slice(0, 32).map((row) => [row.type, row.tripId || row.transferId || row.eventId || "-", row.depotId || "-", row.minute ?? row.startMinute ?? "-"]); const transferRows = model.layers.transfers.map((row) => [row.id, row.properties.shipmentId, row.properties.status || "PLANNED"]); const scenarioRows = payload.scenarios.map((row) => [row.label, `${Math.round(number(row.metrics.service) * 100)}%`, number(row.metrics.cost).toFixed(1), number(row.metrics.carbonKg).toFixed(1)]); const recoveryRows = payload.recoveryCandidates.map((row) => [row.candidateType, row.engine, row.verification.status, row.disruption.changedTrips]);
    const mapContent = noWebGL ? `<div class="fallback" data-fallback="no-webgl">
<p id="mapSummary">${esc(mapSummary)}</p>
<h2>${esc(t.depot)}</h2>${table([t.depots, t.role, t.label], depotRows)}<h2>${esc(t.assignment)}</h2>${table([t.order, t.assignedDepot, t.reason], assignmentRows)}<h2>${esc(t.route)}</h2>${table([t.route, t.trip, t.distance], model.layers.tripRoutes.slice(0, 20).map((row) => [row.id, row.properties.tripId, row.properties.distanceKm]))}</div>` : `${svgMap(model, t)}<p id="mapSummary" class="summary-text">${esc(mapSummary)}</p>`;
    const styles = `*{box-sizing:border-box}html{font-family:Inter,Arial,sans-serif;color:#12324f;background:#eef3f6;letter-spacing:0}body{margin:0;min-width:320px}.app{min-height:100vh;display:grid;grid-template-columns:190px 1fr;grid-template-rows:68px auto}.top{grid-column:1/-1;background:#fff;border-top:4px solid #08182a;border-bottom:1px solid #d6e0e7;display:flex;align-items:center;justify-content:space-between;padding:0 24px}.brand strong{font-size:18px;color:#06417f}.brand span{display:block;font-size:11px;color:#566779;margin-top:3px}.badge{font-size:11px;border:1px solid #a8bac8;padding:5px 8px;border-radius:4px}.side{background:#092d52;padding:18px 10px;position:sticky;top:0;height:calc(100vh - 68px);overflow:auto}.side button{width:100%;border:0;border-left:3px solid transparent;background:transparent;color:#dce8f2;text-align:left;padding:10px 9px;margin:2px 0;font-size:12px}.side button[aria-selected=true]{background:#fff;color:#083d72;border-left-color:#e30613}.workspace{min-width:0;padding:18px 22px 70px}.view{display:none;max-width:1480px;margin:0 auto}.view.active{display:block}.section-head{display:flex;align-items:end;justify-content:space-between;border-bottom:2px solid #12324f;padding-bottom:9px;margin-bottom:14px}.section-head h1{font-size:22px;margin:0}.section-head p{font-size:11px;margin:0;color:#5c7082}.metrics{display:grid;grid-template-columns:repeat(5,minmax(120px,1fr));border:1px solid #c7d4de;background:#fff;margin-bottom:14px}.metric{padding:12px;border-right:1px solid #d9e2e8}.metric:last-child{border-right:0}.metric span{display:block;font-size:10px;color:#607487}.metric strong{font-size:20px}.columns{display:grid;grid-template-columns:minmax(0,2fr) minmax(260px,1fr);gap:14px}.panel{background:#fff;border:1px solid #c7d4de;border-radius:6px;padding:14px;min-width:0}.panel h2{font-size:15px;margin:0 0 10px}.alert{border-left:4px solid #e30613;padding:10px;background:#fff4f4}.evidence{font:11px ui-monospace,monospace;color:#52667a;overflow-wrap:anywhere}.actionbar{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.actionbar button,.stepper button,.top button{border:1px solid #0b4f9c;background:#fff;color:#0b4f9c;border-radius:4px;min-height:34px;padding:6px 10px}.actionbar button:disabled{color:#8293a2;border-color:#b9c5ce;background:#edf1f4}.actionbar button[data-primary]{background:#0b4f9c;color:#fff}.network-map{display:block;width:100%;height:auto;max-height:58vh}.summary-text{font-size:11px;color:#52667a}.table-scroll{overflow:auto;max-width:100%}.data-table{width:100%;border-collapse:collapse;font-size:11px;background:#fff}.data-table th,.data-table td{padding:8px;border-bottom:1px solid #dce4ea;text-align:left;white-space:nowrap}.data-table th{background:#edf3f7;position:sticky;top:0}.heat-table td:first-child{font-weight:bold}.gantt{min-width:720px}.bar{display:inline-block;background:#d9e9fb;border:1px solid #4c8dcc;padding:4px 7px;border-radius:3px}.stepper{display:flex;align-items:center;gap:5px}.stepper output{min-width:44px;text-align:center;font:12px ui-monospace,monospace}.sheet{position:relative}.live{min-height:22px;font-size:11px;color:#0b4f9c;margin-top:8px}.long{margin-top:14px;border-top:1px solid #d7e0e8;padding-top:10px}.long p{max-width:76ch;font-size:12px;line-height:1.6}.flow-line{animation:flow 2s linear infinite}.pulse{animation:pulse 1.8s ease-in-out infinite}.motion-trip-chain{animation:trip-chain 3s ease-in-out infinite}@keyframes flow{to{stroke-dashoffset:-20}}@keyframes pulse{50%{opacity:.45}}@keyframes trip-chain{50%{outline-color:#1473e6}}button:focus-visible,[tabindex]:focus-visible,summary:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}.panel [data-hover]:hover,.panel [data-hover]:focus-visible{background:#e8f2ff}.presentation .side{display:none}.presentation .app{grid-template-columns:1fr}.presentation .top{display:none}.presentation .workspace{padding:24px}.safe-note{padding-bottom:env(safe-area-inset-bottom)}@media(max-width:720px){.app{display:block}.top{height:70px;padding:0 max(16px,env(safe-area-inset-right)) 0 max(16px,env(safe-area-inset-left));position:sticky;top:0;z-index:5}.side{height:auto;position:sticky;top:70px;z-index:4;display:flex;overflow-x:auto;padding:6px;background:#092d52}.side button{width:auto;min-width:max-content;border-left:0;border-bottom:3px solid transparent;padding:8px}.side button[aria-selected=true]{border-bottom-color:#e30613}.workspace{padding:12px max(12px,env(safe-area-inset-right)) calc(42vh + env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left))}.columns,.metrics{grid-template-columns:1fr}.metric{border-right:0;border-bottom:1px solid #d9e2e8}.sheet{position:fixed;left:0;right:0;bottom:0;max-height:40vh;overflow:auto;z-index:6;border-radius:6px 6px 0 0;padding-bottom:max(14px,env(safe-area-inset-bottom));box-shadow:0 -4px 18px #16344a33}.network-map{max-height:31vh}.section-head h1{font-size:18px}.data-table{font-size:10px}.panel{border-radius:4px}.actionbar button{min-width:44px}.landscape-only{display:none}}@media(max-width:920px) and (orientation:landscape){.workspace{padding-bottom:70px}.columns{grid-template-columns:1.2fr 1fr}.sheet{position:relative;max-height:none;box-shadow:none}.landscape-only{display:block}}@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;scroll-behavior:auto!important}}${reduced ? "*{animation:none!important;transition:none!important}" : ""}`;
    const nav = ["decision", "map", "capacity", "trips", "docks", "time", "scenarios", "recovery", "capsule"].map((id, index) => navButton(id, t[id], index === 0)).join("");
    return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>STCT v1.8 ${esc(t.title)}</title>
<style>${styles}</style>
</head>
<body data-reduced-motion="${reduced}" data-no-webgl="${noWebGL}">
<div class="app">
<header class="top">
<div class="brand">
<strong>Smart Transportation Control Tower</strong>
<span>${esc(t.title)}</span>
</div>
<span class="badge">${esc(t.synthetic)}</span>
</header>
<nav class="side" role="tablist" aria-label="${esc(t.title)}">${nav}</nav>
<main class="workspace">
<section class="view active" id="view-decision" role="tabpanel">
<div class="section-head">
<h1>${esc(t.decision)}</h1>
<p>${esc(t.local)}</p>
</div>
<div class="metrics">
<div class="metric">
<span>${esc(t.depots)}</span>
<strong>${model.layers.depots.length}</strong>
</div>
<div class="metric">
<span>${esc(t.trips)}</span>
<strong>${plan.trip.trips.length}</strong>
</div>
<div class="metric">
<span>${esc(t.service)}</span>
<strong>${Math.round(number(ledger.metrics.serviceLevel) * 100)}%</strong>
</div>
<div class="metric">
<span>${esc(t.cost)}</span>
<strong>${number(ledger.cost.total).toFixed(0)}</strong>
</div>
<div class="metric">
<span>${esc(t.carbon)}</span>
<strong>${number(ledger.carbon.totalKg).toFixed(1)}</strong>
</div>
</div>
<div class="columns">
<div class="panel">
<h2>${esc(t.alert)}</h2>
<div class="alert">
<strong>${esc(firstAlert.reasonCode)}</strong>
<p>${esc(firstAlert.message || firstAlert.alertId)}</p>
</div>
<h2>${esc(t.action)}</h2>
<p>${esc(firstAction.action)}</p>
<p class="evidence">${esc(firstAction.evidence.reasonCode)} | ${esc(firstAction.evidence.sourceHash)}</p>
<div class="actionbar">
<button type="button" data-primary data-action="preview">${esc(t.preview)}</button>
<button type="button" data-action="apply" disabled>${esc(t.apply)}</button>
<span data-loading>${esc(t.loading)}</span>
</div>
<p class="live" aria-live="polite" data-live>
</p>
</div>
<aside class="panel sheet">
<h2>${esc(t.summary)}</h2>
<p>${esc(mapSummary)}</p>
<p>
<strong>${esc(t.service)}:</strong> ${Math.round(number(ledger.metrics.serviceLevel) * 100)}%</p>
<p>
<strong>${esc(t.evidence)}:</strong>
</p>
<p class="evidence">${esc(model.networkPlanHash)}</p>
</aside>
</div>
</section>
<section class="view" id="view-map" role="tabpanel">
<div class="section-head">
<h1>${esc(t.map)}</h1>${stepper("depot", t)}</div>
<div class="columns">
<div class="panel">${mapContent}</div>
<aside class="panel sheet">
<h2>${esc(t.depot)}</h2>
<p data-detail="depot">${esc(depotRows[0]?.join(" | ") || "-")}</p>${table([t.depots, t.role, t.label], depotRows)}</aside>
</div>
</section>
<section class="view" id="view-capacity" role="tabpanel">
<div class="section-head">
<h1>${esc(t.capacity)}</h1>
<p>${esc(t.redundant)}</p>
</div>
<div class="panel">${table([t.signal, t.depots, t.period, t.value, t.level], heatRows, "data-table heat-table")}</div>
</section>
<section class="view" id="view-trips" role="tabpanel">
<div class="section-head">
<h1>${esc(t.trips)}</h1>${stepper("trip", t)}</div>
<div class="columns">
<div class="panel">${table([t.trip, t.vehicle, t.driver, t.window, t.orders], tripRows)}</div>
<aside class="panel sheet">
<h2>${esc(t.transfer)}</h2>${table([t.transfer, t.shipment, t.status], transferRows.length ? transferRows : [["-", "-", "DIRECT"]])}</aside>
</div>
</section>
<section class="view" id="view-docks" role="tabpanel">
<div class="section-head">
<h1>${esc(t.docks)}</h1>${stepper("dock", t)}</div>
<div class="panel landscape-only">
<p>${esc(t.docks)} / ${esc(t.time)}</p>
</div>
<div class="panel">
<div class="actionbar">
<button type="button" data-action="reschedule">${esc(t.later)}</button>
<span data-reschedule-status>
</span>
</div>
${table([t.reservation, t.dock, t.trip, t.operation, t.interval], dockRows, "data-table gantt")}
</div>
</section>
<section class="view" id="view-time" role="tabpanel">
<div class="section-head">
<h1>${esc(t.time)}</h1>${stepper("wave", t)}</div>
<div class="panel">${table([t.type, t.entity, t.depots, t.minute], timeRows)}</div>
</section>
<section class="view" id="view-scenarios" role="tabpanel">
<div class="section-head">
<h1>${esc(t.scenarios)}</h1>${stepper("scenario", t)}</div>
<div class="columns">
<div class="panel">
<h2>${esc(t.fleet)}</h2>${table([t.scenario, t.service, t.cost, t.carbon], scenarioRows)}</div>
<aside class="panel sheet">
<h2>${esc(t.cost)}</h2>
<p>${number(ledger.cost.total).toFixed(3)}</p>
<h2>${esc(t.shock)}</h2>
<p>${esc(shockLabel)}</p>
<div class="actionbar">
<button type="button" data-action="compare">${esc(t.compare)}</button>
</div>
</aside>
</div>
</section>
<section class="view" id="view-recovery" role="tabpanel">
<div class="section-head">
<h1>${esc(t.recovery)}</h1>${stepper("recovery", t)}</div>
<div class="columns">
<div class="panel">${table([t.candidate, t.engine, t.verification, t.changedTrips], recoveryRows)}</div>
<aside class="panel sheet">
<h2>${esc(t.action)}</h2>
<p>${esc(recoveryRows[0]?.join(" | ") || "-")}</p>
<div class="actionbar">
<button type="button" data-primary data-action="recovery-preview">${esc(t.preview)}</button>
</div>
<p class="live" aria-live="polite" data-recovery-live>
</p>
</aside>
</div>
</section>
<section class="view" id="view-capsule" role="tabpanel">
<div class="section-head">
<h1>${esc(t.capsule)}</h1>
<p>${esc(t.readOnly)}</p>
</div>
<div class="panel">
<p class="evidence" data-capsule-hash>${esc(payload.capsuleHash)}</p>
<div class="actionbar">
<button type="button" data-action="capsule">${esc(t.exported)}</button>
</div>
<p class="live" aria-live="polite" data-capsule-status>
</p>
<details class="long">
<summary>${esc(t.long)}</summary>
<p>${esc(payload.longDescription)}</p>
</details>
</div>
</section>
</main>
</div>
<script>(function(){var active="decision",beforePresentation="decision",indices={depot:0,trip:0,dock:0,wave:0,scenario:0,recovery:0},limits={depot:${Math.max(1, depotRows.length)},trip:${Math.max(1, tripRows.length)},dock:${Math.max(1, dockRows.length)},wave:${Math.max(1, plan.waves.waves.length)},scenario:${Math.max(1, scenarioRows.length)},recovery:${Math.max(1, recoveryRows.length)}};var timer=0;function announce(target,text){clearTimeout(timer);timer=setTimeout(function(){target.textContent=text},150)}function show(id,focus){document.querySelectorAll('.view').forEach(function(node){node.classList.toggle('active',node.id==='view-'+id)});document.querySelectorAll('[data-view]').forEach(function(node){var on=node.dataset.view===id;node.setAttribute('aria-selected',String(on));if(on&&focus)node.focus()});active=id;document.body.dataset.activeView=id}document.addEventListener('click',function(event){var tab=event.target.closest('[data-view]');if(tab){show(tab.dataset.view,false);return}var step=event.target.closest('[data-step]');if(step){var key=step.dataset.step;indices[key]=(indices[key]+Number(step.dataset.direction)+limits[key])%limits[key];document.querySelector('[data-step-output='+key+']').value=String(indices[key]+1);document.body.dataset['selected'+key.charAt(0).toUpperCase()+key.slice(1)]=String(indices[key]);return}var action=event.target.closest('[data-action]');if(!action)return;
if(action.dataset.action==='preview'){document.body.dataset.preview='ready';var apply=document.querySelector('[data-action=apply]');apply.disabled=false;document.querySelector('[data-loading]').textContent=${JSON.stringify(t.ready)};announce(document.querySelector('[data-live]'),${JSON.stringify(t.previewReady)})}
if(action.dataset.action==='apply'&&!action.disabled){document.body.dataset.applied='true';announce(document.querySelector('[data-live]'),${JSON.stringify(t.applied)})}
if(action.dataset.action==='reschedule'){document.body.dataset.rescheduled='true';document.querySelector('[data-reschedule-status]').textContent=${JSON.stringify(t.rescheduleReady)}}
if(action.dataset.action==='compare'){document.body.dataset.compared='true'}
if(action.dataset.action==='recovery-preview'){document.body.dataset.recoveryPreview='true';announce(document.querySelector('[data-recovery-live]'),${JSON.stringify(t.recoveryReady)})}
if(action.dataset.action==='capsule'){document.body.dataset.capsuleExported='true';document.querySelector('[data-capsule-status]').textContent=${JSON.stringify(t.capsuleReady)}}});document.addEventListener('keydown',function(event){
if(event.key==='p'||event.key==='P'){beforePresentation=active;document.body.classList.add('presentation');document.body.dataset.presentation='true'}
if(event.key==='Escape'&&document.body.classList.contains('presentation')){document.body.classList.remove('presentation');document.body.dataset.presentation='false';show(beforePresentation,true)}if((event.key==='ArrowRight'||event.key==='ArrowLeft')&&event.target.matches('[data-view]')){var tabs=Array.from(document.querySelectorAll('[data-view]'));var index=tabs.indexOf(event.target);var next=tabs[(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];show(next.dataset.view,true)}});document.body.dataset.activeView=active})();</script>
</body>
</html>`;
  }
  function validatePayload(payload) { const issues = []; if (!payload?.model?.visualHash) issues.push("VISUAL_MODEL_MISSING"); if (!payload?.plan?.networkPlanHash) issues.push("NETWORK_PLAN_MISSING"); if (payload?.model?.networkPlanHash !== payload?.plan?.networkPlanHash) issues.push("PLAN_VISUAL_IDENTITY_MISMATCH"); if (!payload?.ledger?.accountingHash) issues.push("ACCOUNTING_MISSING"); if (!Array.isArray(payload?.recoveryCandidates)) issues.push("RECOVERY_MISSING"); return { status: issues.length ? "FAIL" : "PASS", issues }; }
  function exportPayload(payload) { const validation = validatePayload(payload); const value = { schemaVersion: "stct-network-command-center-export-v1.8", status: validation.status, networkInputHash: payload.model.networkInputHash, networkPlanHash: payload.plan.networkPlanHash, accountingHash: payload.ledger.accountingHash, capsuleHash: payload.capsuleHash, views: ["decision", "map", "capacity", "trips", "docks", "time", "scenarios", "recovery", "capsule"] }; value.exportHash = Contract.hashArtifact(value); return value; }
  return { VERSION, TEXT, render, validatePayload, exportPayload };
});
