(function (root, factory) {
  "use strict";
  const namespace = root.STCTPlatformV19 = root.STCTPlatformV19 || {};
  const dependencies = typeof module === "object" && module.exports
    ? {
      MountRegistry: require("./command-route-mount-registry-v19.js"),
      OperationalContext: require("./command-operational-context-v19.js"),
      ActionCenter: require("./operations-action-center-v19.js"),
      Handoff: require("./shift-handoff-v19.js"),
      Alerts: require("./operations-alerts-v16.js"),
      Display: require("./platform-import-session-v19.js").businessNumber,
    }
    : {
      MountRegistry: namespace.commandRouteMountRegistry,
      OperationalContext: namespace.commandOperationalContext,
      ActionCenter: namespace.operationsActionCenter,
      Handoff: namespace.shiftHandoff,
      Alerts: root.STCTV16?.operationsAlerts,
    };
  const api = factory(root, dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) namespace.commandWorkspaceAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, dependencies) {
  "use strict";

  const SCHEMA_VERSION = "stct-command-workspace-adapter-v1.9-p3";
  const SNAPSHOT_VERSION = "stct-command-workspace-snapshot-v1.9-p3";
  const STORAGE_KEY = "stct-command-workspace-v19-p3";
  const ROUTE_TITLES = Object.freeze({
    "/command/overview": "overview",
    "/command/dispatch": "dispatch",
    "/command/mission-control": "mission",
    "/command/execution": "execution",
    "/command/plan-vs-actual": "actual",
    "/command/driver-simulator": "driver",
    "/command/alerts": "alerts",
    "/command/recovery": "recovery",
    "/command/shift-review": "review",
  });
  const COPY = Object.freeze({
    zh: {
      workspace: "COMMAND 运营工作区", overview: "运营驾驶舱", dispatch: "排车与路线", mission: "任务控制", execution: "执行控制", actual: "计划与实际", driver: "司机模拟器", alerts: "告警中心", recovery: "运营恢复", review: "班次复盘",
      synthetic: "本地合成运营演示，不代表实时车队", planning: "规划", simulation: "模拟", executionMode: "执行", simulatedActual: "模拟实际", verified: "已验证", source: "来源", freshness: "新鲜度", actions: "待办", routes: "路线", vehicles: "车辆", alertsCount: "告警", open: "打开", close: "关闭", inspect: "查看", back: "返回来源", finder: "快速查找", handoff: "班次交接", status: "运营状态", currentDecision: "当前决策", eventLane: "执行事件", context: "上下文", noResults: "没有匹配结果", search: "搜索路线、车辆、订单、告警或事件", clear: "清除", priority: "优先级", all: "全部", apply: "应用", restore: "恢复", generate: "生成候选", preview: "预览", pause: "暂停", resume: "继续", previous: "上一步", next: "下一步", routeHealth: "路线健康", provider: "路由与矩阵", verifier: "校验器", data: "数据", noWebgl: "No-WebGL 完整表格模式", reduced: "减少动态效果", downloadJson: "下载 JSON", downloadCsv: "下载 CSV", printHtml: "下载打印版", operatorNote: "交接备注", addDelay: "增加 15 分钟延迟", acknowledge: "确认", handling: "开始处理", resolve: "解决", incident: "创建事件", openRecovery: "打开恢复", retry: "重试同步", dismiss: "忽略", select: "选择", localPlan: "当前已应用计划", unavailable: "当前不可用", domainEvidence: "领域证据", operationalMap: "运营轨迹", routeBoard: "路线风险板", fullEngine: "完整重优化引擎", localCandidate: "局部恢复候选", continueExecution: "按恢复计划继续执行", undo: "撤销恢复", scenarioArena: "情景对比", timeline: "时间线", constraint: "约束检查", legalActions: "合法动作", offline: "离线", reconnect: "重新连接", actionCenter: "运营行动中心", dispatchWaiting: "尚未加载可生成候选的原始业务数据。当前合成计划仅用于运营功能演示。", sourceNotFound: "请求的实体在当前运营上下文中不存在或已经过期。", handoffReady: "交接包已冻结并校验", handoffNone: "尚未生成交接包", noteMetadata: "备注只作为展示元数据，不会解决领域待办。", whatIf: "运力 What-if", exportSnapshot: "导出规划快照", reviewNote: "复核备注", dismissReason: "请输入忽略原因", importHandoff: "导入只读交接包", readOnlyHandoff: "只读交接视图",
    },
    en: {
      workspace: "COMMAND Operations Workspace", overview: "Operations Cockpit", dispatch: "Dispatch & Routes", mission: "Mission Control", execution: "Execution Control", actual: "Plan vs Actual", driver: "Driver Simulator", alerts: "Alert Center", recovery: "Operational Recovery", review: "Shift Review",
      synthetic: "Local synthetic operations demo, not a live fleet", planning: "Planning", simulation: "Simulation", executionMode: "Execution", simulatedActual: "Simulated Actual", verified: "Verified", source: "Source", freshness: "Freshness", actions: "Actions", routes: "Routes", vehicles: "Vehicles", alertsCount: "Alerts", open: "Open", close: "Close", inspect: "Inspect", back: "Return to source", finder: "Quick Finder", handoff: "Shift Handoff", status: "Operational status", currentDecision: "Current decision", eventLane: "Execution lane", context: "Context", noResults: "No matching results", search: "Search routes, vehicles, orders, alerts, or runs", clear: "Clear", priority: "Priority", all: "All", apply: "Apply", restore: "Restore", generate: "Generate candidates", preview: "Preview", pause: "Pause", resume: "Resume", previous: "Previous", next: "Next", routeHealth: "Route health", provider: "Routing & matrix", verifier: "Verifier", data: "Data", noWebgl: "No-WebGL complete table mode", reduced: "Reduced motion", downloadJson: "Download JSON", downloadCsv: "Download CSV", printHtml: "Download printable HTML", operatorNote: "Handoff note", addDelay: "Add 15-minute delay", acknowledge: "Acknowledge", handling: "Start handling", resolve: "Resolve", incident: "Create incident", openRecovery: "Open recovery", retry: "Retry sync", dismiss: "Dismiss", select: "Select", localPlan: "Current applied plan", unavailable: "Currently unavailable", domainEvidence: "Domain evidence", operationalMap: "Operational tracks", routeBoard: "Route risk board", fullEngine: "Full reoptimization engine", localCandidate: "Local recovery candidate", continueExecution: "Continue with recovered plan", undo: "Undo recovery", scenarioArena: "Scenario arena", timeline: "Timeline", constraint: "Constraint checks", legalActions: "Legal actions", offline: "Go offline", reconnect: "Reconnect", actionCenter: "Operations Action Center", dispatchWaiting: "No source data is loaded for candidate generation. The synthetic plan is only for operational demonstrations.", sourceNotFound: "The requested entity is missing or stale in the active operational context.", handoffReady: "Handoff pack frozen and verified", handoffNone: "No handoff pack generated", noteMetadata: "Notes are presentation metadata and do not resolve domain work.", whatIf: "Capacity what-if", exportSnapshot: "Export planning snapshot", reviewNote: "Review note", dismissReason: "Enter a dismissal reason", importHandoff: "Import read-only handoff", readOnlyHandoff: "Read-only handoff view",
    },
    ja: {
      workspace: "COMMAND 運用ワークスペース", overview: "運用コックピット", dispatch: "配車とルート", mission: "ミッションコントロール", execution: "実行管理", actual: "計画と実績", driver: "ドライバーシミュレーター", alerts: "アラートセンター", recovery: "運用復旧", review: "シフトレビュー",
      synthetic: "ローカル合成運用デモ。ライブ車両ではありません", planning: "計画", simulation: "シミュレーション", executionMode: "実行", simulatedActual: "シミュレーション実績", verified: "検証済み", source: "ソース", freshness: "鮮度", actions: "対応項目", routes: "ルート", vehicles: "車両", alertsCount: "アラート", open: "開く", close: "閉じる", inspect: "確認", back: "元の画面へ", finder: "クイック検索", handoff: "シフト引継ぎ", status: "運用状況", currentDecision: "現在の判断", eventLane: "実行イベント", context: "コンテキスト", noResults: "一致する結果はありません", search: "ルート、車両、注文、アラート、実行を検索", clear: "クリア", priority: "優先度", all: "すべて", apply: "適用", restore: "復元", generate: "候補を生成", preview: "プレビュー", pause: "一時停止", resume: "再開", previous: "前へ", next: "次へ", routeHealth: "ルート健全性", provider: "ルーティングとマトリクス", verifier: "検証", data: "データ", noWebgl: "No-WebGL 完全テーブルモード", reduced: "モーション低減", downloadJson: "JSON を出力", downloadCsv: "CSV を出力", printHtml: "印刷用 HTML を出力", operatorNote: "引継ぎメモ", addDelay: "15分の遅延を追加", acknowledge: "確認", handling: "対応開始", resolve: "解決", incident: "インシデント作成", openRecovery: "復旧を開く", retry: "同期を再試行", dismiss: "却下", select: "選択", localPlan: "現在の適用済み計画", unavailable: "現在利用不可", domainEvidence: "ドメイン証拠", operationalMap: "運用トラック", routeBoard: "ルートリスク", fullEngine: "完全再最適化エンジン", localCandidate: "局所復旧候補", continueExecution: "復旧計画で実行を継続", undo: "復旧を元に戻す", scenarioArena: "シナリオ比較", timeline: "タイムライン", constraint: "制約確認", legalActions: "実行可能操作", offline: "オフラインへ", reconnect: "再接続", actionCenter: "運用アクションセンター", dispatchWaiting: "候補生成用の元データは未読込です。合成計画は運用機能デモ専用です。", sourceNotFound: "指定されたエンティティは現在の運用コンテキストに存在しないか、期限切れです。", handoffReady: "引継ぎパックを固定し検証しました", handoffNone: "引継ぎパックは未生成です", noteMetadata: "メモは表示用メタデータであり、業務項目を解決しません。", whatIf: "輸送力 What-if", exportSnapshot: "計画スナップショット出力", reviewNote: "確認メモ", dismissReason: "却下理由を入力してください", importHandoff: "読取専用引継ぎを取込", readOnlyHandoff: "読取専用引継ぎビュー",
    },
  });
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const esc = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const shortHash = (value) => value ? String(value).slice(-12) : "-";
  const pct = value => (dependencies.Display || root.STCTPlatformV19?.businessNumber)?.percent(value) || "—";
  const overviewCache = new WeakMap();
  const finderCache = new WeakMap();

  function overviewProjection(context) {
    const cached = overviewCache.get(context);
    if (cached?.revision === context.revision) return cached.value;
    const source = context.snapshot();
    const report = context.planActual();
    const actionCenter = dependencies.ActionCenter.project(context);
    const routeHealth = report.routes.map((route) => {
      const state = source.execution.routeStates[route.routeId] || {};
      const openAlerts = source.alerts.alerts.filter((alert) => alert.routeId === route.routeId && !["RESOLVED", "DISMISSED"].includes(alert.state));
      const health = dependencies.Alerts.routeHealth({ timeWindowRiskPercent: openAlerts.some((alert) => alert.ruleId === "TIME_WINDOW_MISSED") ? 80 : 10, executionProgressPercent: route.routeCompletion * 100, dwellRiskPercent: Math.min(100, route.routeDwell), routeAdherencePercent: route.routeAdherence * 100, minutesSinceEvent: route.vehicleStaleAge || 0, openAlertCount: openAlerts.length });
      return { ...route, routeStatus: state.state || "UNKNOWN", openAlertCount: openAlerts.length, offlineConflictCount: source.offline.queue.filter((item) => item.event?.routeId === route.routeId && item.status !== "ACKED").length, recoveryStatus: source.recovery.applied?.candidate?.routes?.some((candidate) => candidate.routeId === route.routeId) ? "RECOVERED" : "NONE", health };
    });
    const projection = {
      schemaVersion: "stct-command-overview-projection-v1.9-p3",
      scenario: clone(source.scenario),
      plan: clone(source.plan),
      routing: { provider: source.plan.providerProvenance, matrixHash: source.plan.matrixHash, source: "APPLIED_PLAN_PROVENANCE" },
      execution: { runHash: source.execution.run.executionRunHash, status: source.execution.run.status, lastAcceptedLogicalTime: source.execution.latestLogicalTime, source: "EXECUTION_STORE" },
      service: { completedStops: Object.values(source.execution.stopStates).filter((row) => row.state === "COMPLETED").length, plannedStops: Object.keys(source.execution.stopStates).length, source: "EXECUTION_STORE" },
      fleet: { vehicleCount: Object.keys(source.execution.vehicleStates).length, completion: report.summary.fleetCompletion, source: "PLAN_VS_ACTUAL_DERIVED" },
      routeHealth,
      criticalActions: actionCenter.items.filter((item) => ["CRITICAL", "HIGH"].includes(item.severity)),
      alertSummary: { open: source.alerts.alerts.filter((row) => !["RESOLVED", "DISMISSED"].includes(row.state)).length, source: "ALERT_STORE" },
      offlineSummary: { pending: source.offline.summary.total, conflicts: source.offline.summary.counts.CONFLICT, source: "OFFLINE_QUEUE" },
      recoverySummary: { incidentCount: source.incidents.length, candidateCount: source.recoveryCandidates.length, applied: Boolean(source.recovery.applied), source: "ROLLING_RECOVERY_SESSION" },
      dataFreshness: { logicalTime: source.execution.latestLogicalTime, staleStatus: source.execution.staleStatus, source: "EXECUTION_STORE" },
      evidenceStatus: source.plan.verification?.status || "UNKNOWN",
      generatedFrom: ["OperationsWorkspace", "ExecutionStore", "AlertStore", "OfflineQueue", "RollingRecovery", "DerivedTelemetry"],
      actionCenter,
      report,
    };
    overviewCache.set(context, { revision: context.revision, value: projection });
    return projection;
  }

  function quickFinderIndex(context, sourceRoute) {
    const cacheKey = `${context.revision}:${sourceRoute || "/command/overview"}`;
    const cached = finderCache.get(context);
    if (cached?.key === cacheKey) return cached.value;
    const source = context.snapshot();
    const path = encodeURIComponent(sourceRoute || "/command/overview");
    const rows = [];
    source.scenario && context.scenario.routes.forEach((route) => rows.push({ type: "route", id: route.routeId, label: `Route ${route.routeId}`, status: source.execution.routeStates[route.routeId]?.state || "PLANNED", routeId: route.routeId, vehicleId: route.vehicleId, risk: source.alerts.alerts.filter((alert) => alert.routeId === route.routeId && !["RESOLVED", "DISMISSED"].includes(alert.state)).length, deepLink: `/command/execution?routeId=${encodeURIComponent(route.routeId)}&returnTo=${path}` }));
    context.scenario.routes.forEach((route) => rows.push({ type: "vehicle", id: route.vehicleId, label: `Vehicle ${route.vehicleId}`, status: source.execution.vehicleStates[route.vehicleId]?.state || "PLANNED", routeId: route.routeId, vehicleId: route.vehicleId, risk: 0, deepLink: `/command/execution?vehicleId=${encodeURIComponent(route.vehicleId)}&returnTo=${path}` }));
    context.scenario.stops.forEach((stop) => rows.push({ type: "stop", id: stop.orderId, label: `Stop ${stop.orderId}`, status: source.execution.stopStates[stop.orderId]?.state || "PENDING", routeId: stop.routeId, vehicleId: stop.vehicleId, risk: 0, deepLink: `/command/execution?orderId=${encodeURIComponent(stop.orderId)}&returnTo=${path}` }));
    source.alerts.alerts.forEach((alert) => rows.push({ type: "alert", id: alert.alertId, label: `${alert.ruleId} · ${alert.routeId}`, status: alert.state, routeId: alert.routeId, vehicleId: alert.vehicleId, risk: alert.severity, deepLink: `/command/alerts?alertId=${encodeURIComponent(alert.alertId)}&returnTo=${path}` }));
    source.incidents.forEach((incident) => rows.push({ type: "incident", id: incident.incidentId, label: `${incident.reason} · ${incident.routeId}`, status: "OPEN", routeId: incident.routeId, vehicleId: incident.vehicleId, risk: "CRITICAL", deepLink: `/command/recovery?incidentId=${encodeURIComponent(incident.incidentId)}&returnTo=${path}` }));
    rows.push({ type: "plan", id: source.plan.planHash, label: source.plan.planId, status: source.plan.verification.status, routeId: "", vehicleId: "", risk: 0, deepLink: `/command/dispatch?planHash=${encodeURIComponent(source.plan.planHash)}&returnTo=${path}` });
    rows.push({ type: "run", id: source.execution.run.executionRunHash, label: source.execution.run.executionRunId, status: source.execution.run.status, routeId: "", vehicleId: "", risk: 0, deepLink: `/command/execution?runHash=${encodeURIComponent(source.execution.run.executionRunHash)}&returnTo=${path}` });
    finderCache.set(context, { key: cacheKey, value: rows });
    return rows;
  }

  function createAdapter(options = {}) {
    const documentValue = options.document || root.document;
    const registry = dependencies.MountRegistry.createRegistry();
    const downloader = options.downloader || ((content, filename, type) => {
      const blob = new Blob([content], { type });
      const url = URL.createObjectURL(blob);
      const anchor = documentValue.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      root.setTimeout(() => URL.revokeObjectURL(url), 0);
      return { status: "DOWNLOADED", filename, bytes: blob.size };
    });
    const requestText = options.requestText || ((message, initialValue) => typeof root.prompt === "function" ? root.prompt(message, initialValue) : initialValue);
    let context = null;
    let dataDraft = null;
    function setDataDraft(draft) { dataDraft=draft;return draft.snapshot(); }
    function dataDraftView() {
      if(!dataDraft)return "";
      const draft=dataDraft.snapshot();
      return `<section class="command-band"><header><h2>${esc(c().data)} / COMMAND</h2>${sourceLine(draft.datasetVersionId)}</header><p>${draft.orderIds.length} ${esc(c().orders||"Orders")} · ${esc(draft.status)}</p><p>${esc(shortHash(draft.inputHash))} · ${esc(draft.evaluation?.verification.status||"NOT_RUN")}</p><div class="command-button-row">${actionButton("data-draft-generate",c().generate,{primary:true})}${actionButton("data-draft-apply",c().apply,{disabled:!draft.evaluation})}</div></section>`;
    }
    let controller = null;
    let target = null;
    let currentRouteContext = null;
    let platformSnapshot = null;
    let currentOwner = "";
    let lastHandoff = null;
    let importedHandoff = null;
    let lastDomainAction = null;
    let mountCount = 0;
    let unmountCount = 0;
    let cleanupCount = 0;
    let inputRefreshTimer = null;
    const warnings = [];
    const state = {
      schemaVersion: SNAPSHOT_VERSION,
      route: "/command/overview",
      activeScenarioId: "",
      activeInputHash: "",
      activePlanHash: "",
      selectedRouteId: "",
      selectedVehicleId: "",
      selectedOrderId: "",
      selectedStopId: "",
      selectedAlertId: "",
      selectedIncidentId: "",
      executionCursor: 0,
      alertFilters: { severity: "ALL", state: "ALL", source: "ALL", routeId: "ALL", vehicleId: "ALL", search: "", sort: "priority" },
      recoverySessionId: "",
      mapViewRef: { mode: "FLEET", routeId: "", vehicleId: "" },
      panelState: { contextMessage: "", actionDetailId: "", handoffOpen: false },
      quickFinderState: { open: false, query: "", activeIndex: 0, recent: [] },
      returnRoute: "",
      revision: 0,
    };

    function locale() { return COPY[platformSnapshot?.locale] ? platformSnapshot.locale : "zh"; }
    function c() { return COPY[locale()]; }
    function words(zh, en, ja) { return ({zh, en, ja})[locale()]; }
    function businessCode(value) { const rows={"OPEN":["待确认","Open","未確認"],"ACKNOWLEDGED":["已确认","Acknowledged","確認済み"],"IN_PROGRESS":["处理中","In progress","対応中"],"RESOLVED":["已解决","Resolved","解決済み"],"DISMISSED":["已忽略","Dismissed","却下済み"],"CRITICAL":["严重","Critical","重大"],"WARNING":["注意","Warning","注意"],"INFO":["提示","Information","情報"],"PASS":["验证通过","Verified","検証済み"],"UNKNOWN":["未知","Unknown","不明"],"NOT_RUN":["尚未执行","Not run","未実行"],"PREPARED":["已准备","Prepared","準備済み"],"RUNNING":["执行中","Running","実行中"],"RELEASED":["已释放","Released","リリース済み"],"PAUSED":["已暂停","Paused","一時停止"],"COMPLETED":["已完成","Completed","完了"],"goOffline":["切为离线","Go offline","オフラインへ"],"reconnect":["重新连接","Reconnect","再接続"],"arrive":["到达送货地","Arrive","届け先に到着"],"startService":["开始服务","Start service","作業開始"],"completeService":["完成服务","Complete service","作業完了"],"depart":["离开送货地","Depart","出発"],"accept":["接收任务","Accept task","タスクを受領"],"DELIVERY_LATE":["送货延迟","Delivery late","配送遅延"],"ROUTE_DEVIATION":["偏离路线","Route deviation","経路逸脱"],"VEHICLE_STALE":["车辆位置信息过期","Vehicle position stale","車両位置が古い"],"DELAY":["延迟事件","Delay event","遅延イベント"],"ARRIVED":["已到达","Arrived","到着済み"],"SERVICE_STARTED":["已开始服务","Service started","作業開始済み"],"SERVICE_COMPLETED":["已完成服务","Service completed","作業完了済み"],"DEPARTED":["已离开","Departed","出発済み"],"SYNTHETIC_FALLBACK":["合成演示","Synthetic demo","合成デモ"],"PLANNED":["待执行","Planned","実行待ち"],"EN_ROUTE":["前往送货地","En route","届け先へ移動中"],"PENDING":["待处理","Pending","対応待ち"],"ROUTE":["路线","Route","ルート"],"VEHICLE":["车辆","Vehicle","車両"],"STOP":["停靠点","Stop","停車地点"],"ALERT":["告警","Alert","アラート"],"SYNTHETIC":["合成演示","Synthetic demo","合成デモ"],"UPLOADED_APPLIED":["已导入并应用","Uploaded and applied","取込・適用済み"],"READY":["已就绪","Ready","準備完了"],"FAILED":["未通过","Failed","失敗"],"CANCELLED":["已取消","Cancelled","取り消し済み"],"HIGH":["高","High","高"],"MEDIUM":["中","Medium","中"],"LOW":["低","Low","低"],"TIME_WINDOW_MISSED":["未满足时间窗","Time window missed","時間枠超過"],"OFF_ROUTE":["偏离规划路线","Off route","経路逸脱"],"ROUTE_STALLED":["路线停滞","Route stalled","ルート停滞"],"EXCESS_DWELL":["停留过久","Excess dwell","長時間停車"],"ETA_RISK":["预计到达风险","Arrival-time risk","到着時間リスク"],"CRITICAL_ALERT":["严重告警","Critical alert","重大アラート"],"CURRENT":["当前有效","Current","現在有効"],"STALE":["信息已过期","Stale","情報が古い"],"ALERT_STORE":["告警记录","Alert records","アラート記録"],"OFFLINE_QUEUE":["离线队列","Offline queue","オフラインキュー"],"EXECUTION_STORE":["执行记录","Execution records","実行記録"],"ONLINE":["在线","Online","オンライン"],"OFFLINE":["离线","Offline","オフライン"],"TERMINAL":["已结束","Finished","終了"],"CLEAR":["暂无待办","No pending actions","未対応なし"],"NONE":["无","None","なし"],"SIMULATED":["模拟结果","Simulated result","シミュレーション結果"],"SYNTHETIC_TEST":["合成测试数据","Synthetic test data","合成テストデータ"],"NO UPLOADED SOURCE":["尚未导入运营数据","No operational data imported","運用データ未取込"],"STOPPED":["已停止","Stopped","停止済み"]};return rows[value]?.[{zh:0,en:1,ja:2}[locale()]] || value; }
    function ensureContext() {
      if (!context) {
        context = dependencies.OperationalContext.createContext({ locale: locale(), noWebGL: platformSnapshot?.noWebGL === true });
        const source = context.snapshot();
        Object.assign(state, { activeScenarioId: source.scenario.scenarioId, activeInputHash: source.scenario.inputHash, activePlanHash: source.plan.planHash, selectedRouteId: source.selected.routeId, selectedVehicleId: source.selected.vehicleId, executionCursor: source.replay.clock, recoverySessionId: source.recoveryFixture?.incidentHash || context.recoveryFixture.incidentHash });
        restoreStored();
      }
      return context;
    }
    function touch() { state.revision += 1; persist(); }
    function persist() {
      try { root.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(snapshot())); } catch (_error) {}
    }
    function restoreStored() {
      try {
        const raw = root.sessionStorage?.getItem(STORAGE_KEY);
        if (raw) restore(JSON.parse(raw));
      } catch (_error) {}
    }
    function snapshot() {
      if (context) {
        const source = context.snapshot();
        state.activeScenarioId = source.scenario.scenarioId;
        state.activeInputHash = source.scenario.inputHash;
        state.activePlanHash = source.plan.planHash;
        state.executionCursor = source.replay.clock;
        Object.assign(state, { selectedRouteId: source.selected.routeId, selectedVehicleId: source.selected.vehicleId, selectedOrderId: source.selected.orderId, selectedStopId: source.selected.stopId, selectedAlertId: source.selected.alertId, selectedIncidentId: source.selected.incidentId });
      }
      return clone(state);
    }
    function restore(candidate) {
      if (!candidate || candidate.schemaVersion !== SNAPSHOT_VERSION) return { ok: false, code: "COMMAND_SNAPSHOT_SCHEMA_INVALID" };
      const allowed = ["route", "activeScenarioId", "activeInputHash", "activePlanHash", "selectedRouteId", "selectedVehicleId", "selectedOrderId", "selectedStopId", "selectedAlertId", "selectedIncidentId", "executionCursor", "alertFilters", "recoverySessionId", "mapViewRef", "panelState", "quickFinderState", "returnRoute", "revision"];
      for (const key of allowed) if (Object.prototype.hasOwnProperty.call(candidate, key)) state[key] = clone(candidate[key]);
      state.quickFinderState.recent = (state.quickFinderState.recent || []).slice(0, 8);
      if (context) {
        const source = context.snapshot();
        if (candidate.activeScenarioId === source.scenario.scenarioId && candidate.activePlanHash === source.plan.planHash) {
          context.replay.seek(Number(candidate.executionCursor || source.replay.clock));
          context.select({ routeId: candidate.selectedRouteId, vehicleId: candidate.selectedVehicleId, orderId: candidate.selectedOrderId, stopId: candidate.selectedStopId, alertId: candidate.selectedAlertId, incidentId: candidate.selectedIncidentId });
        }
      }
      return { ok: true, snapshot: snapshot() };
    }
    function bind(platform) { controller = platform.controller || platform; return api(); }

    function statusChip(label, tone = "neutral") { return `<span class="command-status-chip is-${esc(tone)}" title="${esc(label)}">${esc(businessCode(label))}</span>`; }
    function actionButton(action, label, optionsValue = {}) { return `<button type="button" class="command-button${optionsValue.primary ? " is-primary" : ""}" data-command-action="${esc(action)}"${optionsValue.id ? ` data-command-id="${esc(optionsValue.id)}"` : ""}${optionsValue.disabled ? " disabled" : ""}>${esc(label)}</button>${optionsValue.disabled?`<small class="p7-disabled-reason">${esc(disabledReason(action))}</small>`:''}`; }
    function disabledReason(action){const group=action.startsWith('handoff-')?'handoff':action==='recovery-apply'?'preview':action==='recovery-undo'?'undo':action==='recovery-continue'?'apply':action==='recovery-full'?'engine':action.startsWith('execution-')?'execution':action==='data-draft-apply'?'evaluate':'data';const reasons={zh:{handoff:'先生成交接包，再选择导出格式。',preview:'先点击此方案的“预览”，核对变化后才能应用。',undo:'仅已应用且尚未被司机确认的调整可撤销。',apply:'先预览并应用一个调整方案，再继续执行。',engine:'现有本地路网矩阵与引擎尚未就绪，可先使用已验证的局部调整。',execution:'操作取决于执行状态：先释放计划，暂停后才能继续。',evaluate:'先点击“生成候选”，完成当前数据的计算。',data:'请先在数据中心导入运营数据并生成可行候选，再进行计划操作。'},en:{handoff:'Generate a handoff pack before exporting.',preview:'Preview this candidate before applying it.',undo:'Undo requires an applied change without driver acknowledgement.',apply:'Preview and apply a recovery candidate before continuing.',engine:'The local road matrix and engine are not ready. Use a verified local candidate.',execution:'Release a plan first; resume requires a paused run.',evaluate:'Generate candidates to evaluate the current data first.',data:'Import operational data in Data Hub and generate feasible candidates first.'},ja:{handoff:'引継ぎパックを生成してから出力してください。',preview:'この候補をプレビューしてから適用してください。',undo:'適用済みでドライバー未確認の調整のみ取消可能です。',apply:'調整をプレビューして適用後、実行を継続できます。',engine:'ローカル道路行列とエンジンが未準備です。検証済みの局所候補を使用できます。',execution:'計画をリリースしてください。再開には一時停止が必要です。',evaluate:'まず候補を生成して現在のデータを計算してください。',data:'データセンターで運用データを取込み、実行可能な候補を生成してください。'}};return reasons[locale()][group];}
    function sourceLine(source) { return `<details class="command-source"><summary>${esc(words("计算来源与技术详情", "Calculation source and technical details", "計算元と技術詳細"))}</summary><small>${esc(source)}</small></details>`; }
    function titleBlock(title, lead) { return `<header class="command-page-heading"><div><p>${esc(c().workspace)}</p><h1>${esc(title)}</h1><span>${esc(lead || (context.snapshot().scenario.sourceType === "UPLOADED_APPLIED" ? c().localPlan : c().synthetic))}</span></div><div class="command-page-tools">${actionButton("open-finder", c().finder)}${actionButton("open-handoff", c().handoff)}</div></header>`; }
    function contextRibbon() {
      const source = context.snapshot();
      const selected = [source.selected.routeId, source.selected.vehicleId, source.selected.orderId || source.selected.stopId, source.selected.alertId, source.selected.incidentId].filter(Boolean).join(" · ") || "-";
      const nextAction = dependencies.ActionCenter.project(context).items[0];
      return `<section class="command-context-ribbon" aria-label="${esc(c().context)}"><div><span>${esc(c().context)}</span><strong>${esc(selected)}</strong></div><div><span>${esc(c().status)}</span><strong title="${esc(source.execution.run.status)}">${esc(businessCode(source.execution.run.status))}</strong></div><div><span>${esc(words("下一项处理", "Next action", "次の対応"))}</span><strong title="${esc(nextAction?.actionType || "CLEAR")}">${esc(businessCode(nextAction?.actionType || "CLEAR"))}</strong></div><div><span>${esc(c().freshness)}</span><strong title="${esc(businessCode(source.execution.staleStatus))}">${esc(businessCode(source.execution.staleStatus))}</strong><small>${esc(source.execution.latestLogicalTime)}</small></div><details class="command-secondary-actions"><summary>${esc(words("版本与验证详情", "Version and verification details", "バージョンと検証詳細"))}</summary><dl><dt>PLAN</dt><dd>${esc(source.plan.planHash)}</dd><dt>RUN</dt><dd>${esc(source.execution.run.executionRunHash)}</dd><dt>ROUTE</dt><dd>${esc(state.route)}</dd><dt>PROVIDER / VERIFY</dt><dd>${esc(source.plan.providerProvenance?.providerId || c().unavailable)} · ${esc(businessCode(source.plan.verification.status))}</dd></dl></details>${state.returnRoute ? actionButton("return-source", c().back) : ""}</section>`;
    }
    function contextNotice() { return state.panelState.contextMessage ? `<p class="command-context-notice" role="status">${esc(state.panelState.contextMessage)}</p>` : ""; }

    function fleetVisual(projection) {
      if (platformSnapshot?.noWebGL) return `<section class="command-band command-fleet-visual"><header><h2>${esc(c().noWebgl)}</h2>${sourceLine("ExecutionStore + DerivedTelemetry")}</header>${routeTable(projection.routeHealth.slice(0, 8))}</section>`;
      const tracks = context.currentTracks();
      const points = tracks.flatMap((track) => track.positions.map((position) => position.coordinate));
      const minX = Math.min(...points.map((point) => point[0])); const maxX = Math.max(...points.map((point) => point[0])); const minY = Math.min(...points.map((point) => point[1])); const maxY = Math.max(...points.map((point) => point[1]));
      const project = (point) => [20 + (point[0] - minX) / Math.max(.00001, maxX - minX) * 720, 205 - (point[1] - minY) / Math.max(.00001, maxY - minY) * 170];
      const lines = tracks.map((track) => `<button type="button" class="command-track-select" data-command-select-route="${esc(track.routeId)}" data-command-select-vehicle="${esc(track.vehicleId)}" aria-label="${esc(`${track.routeId} ${track.vehicleId}`)}"><svg viewBox="0 0 760 225" aria-hidden="true"><polyline points="${track.positions.map((row) => project(row.coordinate).join(",")).join(" ")}"/></svg><span>${esc(track.routeId)}</span></button>`).join("");
      return `<section class="command-band command-fleet-visual"><header><h2>${esc(c().operationalMap)}</h2>${sourceLine("FleetTracks derived from verified synthetic telemetry; no second map engine")}</header><div class="command-track-canvas">${lines}</div></section>`;
    }
    function routeTable(routes) {
      return `<div class="command-table-wrap"><table><thead><tr><th>${esc(c().routes)}</th><th>${esc(c().vehicles)}</th><th>${esc(c().status)}</th><th>${esc(words("完成进度", "Completion", "完了率"))}</th><th>${esc(words("运行健康度", "Health", "運行健全性"))}</th><th>${esc(c().alertsCount)}</th></tr></thead><tbody>${routes.map((route) => `<tr><th><button type="button" class="command-link" data-command-select-route="${esc(route.routeId)}" data-command-select-vehicle="${esc(route.vehicleId)}">${esc(route.routeId)}</button></th><td>${esc(route.vehicleId)}</td><td>${esc(businessCode(route.routeStatus || "-"))}</td><td>${esc(pct(route.routeCompletion))}</td><td><span class="command-score">${Math.round(route.health?.score || 0)}</span></td><td>${route.openAlertCount ?? route.vehicleAlertCount ?? 0}</td></tr>`).join("")}</tbody></table></div>`;
    }
    function actionCenterView(compact = false) {
      const projection = dependencies.ActionCenter.project(context, state.alertFilters);
      const inventory = dependencies.ActionCenter.project(context, { includeClosed: true }).items;
      const filterOptions = (key) => [...new Set(inventory.map((row) => row[key]).filter(Boolean))].sort();
      const optionList = (key, values) => `<option value="ALL">${esc(c().all)}</option>${values.map((value) => `<option value="${esc(value)}"${state.alertFilters[key] === value ? " selected" : ""}>${esc(businessCode(value))}</option>`).join("")}`;
      const filters = compact ? "" : `<div class="command-filters"><label>${esc(({zh:"严重程度",en:"Severity",ja:"重大度"})[locale()])}<select data-command-filter="severity">${optionList("severity", ["CRITICAL", "HIGH", "MEDIUM", "LOW"])}</select></label><label>${esc(c().status)}<select data-command-filter="state">${optionList("state", filterOptions("state"))}</select></label><label>${esc(c().source)}<select data-command-filter="source">${optionList("source", filterOptions("sourceKind"))}</select></label><label>${esc(c().routes)}<select data-command-filter="routeId">${optionList("routeId", filterOptions("routeId"))}</select></label><label>${esc(c().vehicles)}<select data-command-filter="vehicleId">${optionList("vehicleId", filterOptions("vehicleId"))}</select></label><label>${esc(({zh:"排序",en:"Sort",ja:"並び順"})[locale()])}<select data-command-filter="sort"><option value="priority"${state.alertFilters.sort === "priority" ? " selected" : ""}>${esc(c().priority)}</option><option value="due"${state.alertFilters.sort === "due" ? " selected" : ""}>${esc(({zh:"到期时间",en:"Due",ja:"期限"})[locale()])}</option><option value="freshness"${state.alertFilters.sort === "freshness" ? " selected" : ""}>${esc(c().freshness)}</option></select></label><label class="is-search"><span class="platform-sr-only">${esc(c().search)}</span><input data-command-filter="search" value="${esc(state.alertFilters.search)}" placeholder="${esc(c().search)}"></label></div>`;
      const items = projection.items.slice(0, compact ? 5 : 100).map((item) => `<article class="command-action-row is-${esc(item.severity.toLowerCase())}" data-action-item="${esc(item.actionItemId)}"><div class="command-action-main"><span>${esc(businessCode(item.actionType))} · ${esc(businessCode(item.severity))}</span><strong>${esc(String(item.title).split(' · ').map(businessCode).join(' · '))}</strong><small>${esc(item.routeId)} ${esc(item.vehicleId)} · ${esc(businessCode(item.state))} · ${esc(businessCode(item.freshness.status))}</small>${item.reviewNote?.note ? `<small class="command-review-note">${esc(c().reviewNote)}: ${esc(item.reviewNote.note)}</small>` : ""}</div><div class="command-action-controls">${actionButton("action-inspect", c().inspect, { id: item.actionItemId,primary:true })}<details class="command-secondary-actions"><summary>${esc(({zh:"处理动作",en:"Handling actions",ja:"対応操作"})[locale()])}</summary><div class="command-button-row">${item.allowedActions.includes("ACKNOWLEDGE") ? actionButton("action-ack", c().acknowledge, { id: item.actionItemId }) : ""}${item.allowedActions.includes("START_HANDLING") ? actionButton("action-handling", c().handling, { id: item.actionItemId }) : ""}${item.allowedActions.includes("RESOLVE") ? actionButton("action-resolve", c().resolve, { id: item.actionItemId }) : ""}${item.allowedActions.includes("DISMISS") ? actionButton("action-dismiss", c().dismiss, { id: item.actionItemId }) : ""}${item.allowedActions.includes("CREATE_INCIDENT") ? actionButton("action-incident", c().incident, { id: item.actionItemId }) : ""}${item.allowedActions.includes("OPEN_RECOVERY") ? actionButton("action-open-recovery", c().openRecovery, { id: item.actionItemId }) : ""}${item.allowedActions.includes("RETRY_SYNC") ? actionButton("action-retry", c().retry, { id: item.actionItemId }) : ""}${actionButton("action-note", c().reviewNote, { id: item.actionItemId })}</div><small>${esc(item.actionType)} / ${esc(item.state)}</small></details></div></article>`).join("");
      return `<section class="command-band command-action-center" data-command-feature="action-center"><header><div><p>${projection.counts.critical} ${esc(businessCode("CRITICAL"))} · ${projection.counts.high} ${esc(businessCode("HIGH"))}</p><h2>${esc(c().actionCenter)}</h2></div>${compact ? actionButton("focus-action-center", c().open) : sourceLine(projection.generatedFrom.join(" + "))}</header>${filters}<div class="command-action-list">${items || `<p class="command-empty">${esc(c().noResults)}</p>`}</div></section>`;
    }
    function overviewView() {
      const projection = overviewProjection(context);
      const decision = projection.actionCenter.items[0];
      return `${titleBlock(c().overview)}<section class="command-status-rail"><div><span>${esc(c().routes)}</span><strong>${projection.routeHealth.length}</strong><small>${esc(c().localPlan)}</small></div><div><span>${esc(c().alertsCount)}</span><strong>${projection.alertSummary.open}</strong><small>${esc(c().actions)}</small></div><div><span>${esc(c().planning)}</span><strong>${esc(words("本地启发式", "Local heuristic", "ローカルヒューリスティック"))}</strong><small>${esc(c().synthetic)}</small></div><div><span>${esc(c().verifier)}</span><strong title="${esc(projection.evidenceStatus)}">${esc(businessCode(projection.evidenceStatus))}</strong>${sourceLine(`${projection.routing.provider?.providerId || c().unavailable} · ${projection.routing.matrixHash || ""}`)}</div><div><span>${esc(c().status)}</span><strong title="${esc(projection.execution.status)}">${esc(businessCode(projection.execution.status))}</strong></div><div><span>${esc(c().freshness)}</span><strong title="${esc(projection.dataFreshness.staleStatus)}">${esc(businessCode(projection.dataFreshness.staleStatus))}</strong><small>${esc(projection.dataFreshness.logicalTime)}</small></div></section>${actionCenterView(state.panelState.actionDetailId !== "ACTION_CENTER")}${fleetVisual(projection)}<div class="command-two-column"><section class="command-band"><header><h2>${esc(c().routeBoard)}</h2>${sourceLine("ExecutionStore + Plan-vs-Actual + AlertStore")}</header>${routeTable(projection.routeHealth)}</section><section class="command-band command-decision"><header><h2>${esc(c().currentDecision)}</h2>${sourceLine("Rule-based priority; not an AI score")}</header>${decision ? `<strong>${esc(String(decision.title).split(" · ").map(businessCode).join(" · "))}</strong><p>${esc(businessCode(decision.actionType))} · ${esc(businessCode(decision.severity))} · ${esc(businessCode(decision.state))}</p>${actionButton("action-inspect", c().inspect, { id: decision.actionItemId, primary: true })}` : `<p>${esc(c().noResults)}</p>`}<dl><dt>${esc(c().alertsCount)}</dt><dd>${projection.alertSummary.open}</dd><dt>${esc(c().offline)}</dt><dd>${projection.offlineSummary.pending}</dd><dt>${esc(c().recovery)}</dt><dd>${projection.recoverySummary.candidateCount}</dd></dl></section></div><section class="command-band"><header><h2>${esc(c().eventLane)}</h2>${sourceLine("ExecutionStore append-only accepted events")}</header><div class="command-event-lane">${context.snapshot().execution.acceptedEvents.slice(-10).map((event) => `<button type="button" data-command-select-route="${esc(event.routeId)}" data-command-select-vehicle="${esc(event.vehicleId)}" data-command-select-order="${esc(event.orderId)}"><time>${esc(event.logicalTime)}</time><strong>${esc(businessCode(event.eventType))}</strong><span>${esc(event.routeId || "RUN")} ${esc(event.orderId)}</span></button>`).join("")}</div></section>`;
    }
    function dispatchView() {
      const labels = locale() === 'en' ? ['Planning conditions','Compare objectives','Fleet and unassigned','Manual adjustment'] : locale() === 'ja' ? ['計画条件','目標の比較','車両と未割当','手動調整'] : ['规划条件与操作','按目标比较候选','运力与未分配订单','人工调整'];
      if (dataDraft) {
        const draft = dataDraft.snapshot();
        const lead = locale() === 'zh' ? '当前页面仅使用此公共数据批次；其他排车输入保留，不混入本次计划。' : locale() === 'ja' ? 'この共有データのみを使用します。別の配車入力は保持し、この計画に混在させません。' : 'This page uses the selected shared dataset. Other dispatch inputs are retained separately.';
        return `${titleBlock(c().dispatch, lead)}${dataDraftView()}${draft.status === 'APPLIED_NOT_STARTED' ? `<section class="command-band"><header><h2>${esc(c().localPlan)}</h2><span>${esc(context.snapshot().plan.planId)}</span></header><div class="command-button-row">${['execution','analysis','cost','carbon','report'].map(key => `<button type="button" class="command-button" data-platform-route="/command/${key}">${esc(root.STCTPlatformV19?.navigationI18n?.translate('route.command.' + key, locale()) || key)}</button>`).join('')}</div></section>` : ''}`;
      }
      const planning = context.planning();
      const plannerState = planning?.snapshot?.() || planning?.state || null;
      const candidates = plannerState?.candidates || [];
      const configuredGoals = context.optimizer()?.GOALS;
      const fallbackGoals = ["vehicles", "distance", "utilization", "cost", "carbon", "balanced"];
      const translatedGoals = {
        en: { vehicles: "Minimum vehicles", distance: "Shortest distance", utilization: "Load utilization", cost: "Lowest cost", carbon: "Lowest carbon", balanced: "Balanced" },
        ja: { vehicles: "最少車両", distance: "最短距離", utilization: "積載率", cost: "最低コスト", carbon: "最低炭素", balanced: "総合バランス" },
      };
      const goals = (Array.isArray(configuredGoals) ? configuredGoals : fallbackGoals.map((id) => ({ id }))).map((goal) => {
        const id = String(goal?.id || goal);
        return locale() === "zh" ? String(goal?.label || id) : translatedGoals[locale()]?.[id] || id;
      });
      const commandSource = context.snapshot().scenario.sourceType;
      return `${titleBlock(c().dispatch)}${dataDraftView()}<section class="command-status-rail"><div><span>${esc(c().data)}</span><strong>${esc(businessCode(commandSource))}</strong><small>${esc(plannerState?.scenario?.scenarioId || context.snapshot().scenario.scenarioId)}</small></div><div><span>${esc(({zh:"候选方案",en:"Candidates",ja:"候補案"})[locale()])}</span><strong>${candidates.length}</strong><small>${esc(businessCode(plannerState?.phase || "NO UPLOADED SOURCE"))}</small></div><div><span>${esc(c().verifier)}</span><strong>${esc(businessCode(plannerState?.invariant?.status || context.snapshot().plan.verification.status))}</strong><small>${esc(shortHash(plannerState?.scenario?.inputHash || context.snapshot().scenario.inputHash))}</small></div><div><span>${esc(c().vehicles)}</span><strong>${context.scenario.routes.length}</strong><small>${esc(c().vehicles)}</small></div></section><section class="command-band command-dispatch-controls"><header><h2>${esc(labels[0])}</h2>${sourceLine("STCTPlanning + STCTOptimizer + STCTVerifier")}</header><p>${esc(plannerState?.raw ? `${plannerState?.scenario?.orders?.length || 0} ${words("条订单可生成候选", "orders ready for candidate generation", "件の注文から候補を生成できます")}` : c().dispatchWaiting)}</p>${!plannerState?.raw?`<button type="button" class="command-button is-primary" data-platform-route="/platform/data">${esc(({zh:'导入运输业务数据并预览',en:'Import transport data and preview',ja:'輸送データを取り込みプレビュー'})[locale()])}</button><details class="command-secondary-actions"><summary>${esc(({zh:'查看后续规划操作',en:'View later planning actions',ja:'次の計画操作を確認'})[locale()])}</summary>`:''}<div class="command-button-row">${actionButton("dispatch-generate", c().generate, { primary: true, disabled: !plannerState?.raw })}${actionButton("dispatch-apply", c().apply, { disabled: !candidates.length })}${actionButton("dispatch-restore", c().restore, { disabled: !plannerState?.beforeApply })}${actionButton("dispatch-manual", labels[3], { disabled: !candidates.length })}${actionButton("dispatch-what-if", c().whatIf, { disabled: !plannerState?.raw || !candidates.length || plannerState?.whatIfRunning })}${actionButton("dispatch-export", c().exportSnapshot, { disabled: !planning?.exportSnapshot })}</div>${!plannerState?.raw?'</details>':''}</section><div class="command-two-column"><section class="command-band"><header><h2>${esc(labels[1])}</h2>${sourceLine("Existing optimizer candidates")}</header><div class="command-objectives">${goals.slice(0, 6).map((goal) => `<span>${esc(goal)}</span>`).join("")}</div>${candidates.length ? `<div class="command-candidate-list">${candidates.slice(0, 8).map((candidate) => `<button type="button" data-command-candidate="${esc(candidate.planId || candidate.scenarioId)}"><strong>${esc(candidate.planId || candidate.scenarioId)}</strong><span>${esc(businessCode(candidate.verification?.status || "UNKNOWN"))} · ${esc(candidate.routes?.length || 0)} routes</span></button>`).join("")}</div>` : `<article class="command-current-plan"><strong>${esc(c().localPlan)}</strong><span>${esc(context.snapshot().plan.planId)} · ${esc(shortHash(context.snapshot().plan.planHash))}</span><small>${esc(businessCode(context.snapshot().plan.verification.status))} · ${context.scenario.routes.length} ${esc(c().routes)}</small></article>`}</section><section class="command-band"><header><h2>${esc(labels[2])}</h2>${sourceLine("Canonical Scenario + verifier diagnostics")}</header><dl class="command-definition"><dt>${esc(words("已分配路线", "Assigned routes", "割当ルート"))}</dt><dd>${context.scenario.routes.length}</dd><dt>${esc(words("未分配订单", "Unassigned orders", "未割当注文"))}</dt><dd>${context.basePlan.unassignedOrderIds?.length ?? context.basePlan.unassigned?.length ?? c().unavailable}</dd><dt>${esc(words("路网来源", "Road provider", "道路データ元"))}</dt><dd>${esc(context.basePlan.providerProvenance?.providerId || c().unavailable)}</dd><dt>${esc(words("矩阵版本", "Matrix version", "行列バージョン"))}</dt><dd>${esc(shortHash(context.basePlan.matrixHash))}</dd></dl></section></div>${fleetVisual(overviewProjection(context))}`;
    }
    function missionView() {
      const source = context.snapshot();
      const scenarioRows = [context.basePlan, ...context.workspace.recoveryCandidates()];
      return `${titleBlock(c().mission)}<section class="command-status-rail"><div><span>${esc(words("模拟状态", "Simulation status", "シミュレーション状態"))}</span><strong>${esc(businessCode(source.simulation.status))}</strong>${sourceLine(source.simulation.simulationHash)}</div><div><span>${esc(words("计划核验", "Plan verification", "計画検証"))}</span><strong>${esc(businessCode(source.plan.verification.status))}</strong>${sourceLine(source.plan.planHash)}</div><div><span>${esc(words("回放状态", "Replay status", "再生状態"))}</span><strong>${esc(businessCode(source.replay.status))}</strong><small>${esc(source.replay.clock)}</small></div><div><span>${esc(words("事件记录", "Events", "イベント記録"))}</span><strong>${source.simulation.activeEvents.length}</strong><small>${esc(c().simulation)}</small></div></section><div class="command-two-column"><section class="command-band"><header><h2>${esc(c().timeline)}</h2>${sourceLine("SimulationStore + FleetReplay")}</header><input class="command-range" type="range" min="${source.replay.sharedClock.start}" max="${source.replay.sharedClock.end}" value="${source.replay.clock}" data-command-replay-seek aria-label="${esc(words("回放进度", "Replay progress", "再生進行"))}"><div class="command-button-row">${actionButton("replay-prev", c().previous)}${actionButton("replay-next", c().next)}${actionButton("simulation-delay", c().addDelay, { primary: true })}</div><div class="command-event-lane">${source.replay.visibleEvents.slice(-8).map((event) => `<button type="button" data-command-event="${esc(event.eventId)}"><time>${esc(event.logicalTime)}</time><strong>${esc(businessCode(event.eventType))}</strong><span>${esc(event.routeId)} · ${esc(event.vehicleId)}</span></button>`).join("")}</div></section><section class="command-band"><header><h2>${esc(c().scenarioArena)}</h2>${sourceLine("Verifier-PASS plans only")}</header><div class="command-candidate-list">${scenarioRows.map((candidate, index) => `<article><strong>${esc(candidate.planId || candidate.candidateType)}</strong><span>${esc(businessCode(candidate.verification?.status || "UNKNOWN"))} · ${esc(shortHash(candidate.planHash))}</span><small>${esc(index ? c().localCandidate : c().localPlan)}</small></article>`).join("")}</div><h3>${esc(c().constraint)}</h3><p>${esc(words("路线身份 · 订单覆盖 · 容量 · 时间窗", "Route identity · order coverage · capacity · time window", "ルート識別 · 注文カバー · 容量 · 時間枠"))}</p></section></div>${fleetVisual(overviewProjection(context))}`;
    }
    function executionView() {
      const source = context.snapshot();
      const rows = Object.values(source.execution.routeStates);
      return `${titleBlock(c().execution)}<section class="command-status-rail"><div><span>${esc(c().status)}</span><strong>${esc(businessCode(source.execution.run.status))}</strong><small>${esc(shortHash(source.execution.run.executionRunHash))}</small></div><div><span>${esc(words("已接收事件", "Accepted events", "受信済みイベント"))}</span><strong>${source.execution.acceptedEvents.length}</strong>${sourceLine(source.execution.executionStateHash)}</div><div><span>${esc(c().freshness)}</span><strong>${esc(businessCode(source.execution.staleStatus))}</strong><small>${esc(source.execution.latestLogicalTime)}</small></div><div><span>${esc(words("执行记录", "Execution record", "実行記録"))}</span><strong>${esc(words("追加留痕", "Append-only history", "追記履歴"))}</strong>${sourceLine(source.execution.authority)}</div></section><section class="command-band"><header><h2>${esc(c().execution)}</h2>${sourceLine("ExecutionStore v1.7")}</header><div class="command-button-row">${source.execution.run.status==="PREPARED"?actionButton("execution-release",({zh:"释放执行计划",en:"Release execution plan",ja:"実行計画をリリース"})[locale()],{primary:true}):""}${actionButton("execution-pause", c().pause, { disabled: !["RUNNING", "RELEASED"].includes(source.execution.run.status) })}${actionButton("execution-resume", c().resume, { disabled: source.execution.run.status !== "PAUSED", primary: true })}</div>${routeTable(rows.map((route) => { const pva = context.planActual().routes.find((row) => row.routeId === route.routeId); return { ...pva, ...route, routeStatus: route.state, openAlertCount: source.alerts.alerts.filter((alert) => alert.routeId === route.routeId && !["RESOLVED", "DISMISSED"].includes(alert.state)).length, health: dependencies.Alerts.routeHealth({ executionProgressPercent: (pva?.routeCompletion || 0) * 100, routeAdherencePercent: (pva?.routeAdherence || 1) * 100, openAlertCount: 0 }) }; }))}</section><section class="command-band"><header><h2>${esc(c().eventLane)}</h2>${sourceLine("Accepted events; rejected events remain separate")}</header><div class="command-event-lane">${source.execution.acceptedEvents.slice().reverse().slice(0, 24).map((event) => `<button type="button" data-command-select-route="${esc(event.routeId)}" data-command-select-vehicle="${esc(event.vehicleId)}" data-command-select-order="${esc(event.orderId)}"><time>${esc(event.logicalTime)}</time><strong>${esc(businessCode(event.eventType))}</strong><span>${esc(shortHash(event.eventHash))}</span></button>`).join("")}</div></section>`;
    }
    function actualView() {
      const report = context.planActual();
      return `${titleBlock(c().actual)}<section class="command-status-rail"><div><span>${esc(words("报告版本", "Report version", "レポートバージョン"))}</span><strong>${esc(shortHash(report.reportHash))}</strong><small>${esc(words("由执行记录计算", "Calculated from execution records", "実行記録から計算"))}</small></div><div><span>${esc(words("车队完成进度", "Fleet completion", "車両全体の完了率"))}</span><strong>${esc(pct(report.summary.fleetCompletion))}</strong><small>${esc(words("按停靠点加权", "Stop weighted", "停車地点加重"))}</small></div><div><span>${esc(words("预计到达平均误差", "Mean arrival-time error", "到着予定の平均誤差"))}</span><strong>${report.summary.etaSampleCount ? Math.round(report.summary.fleetEtaMae) : esc(({zh:"未计算",en:"Not calculated",ja:"未計算"})[locale()])}</strong><small>${report.summary.etaSampleCount} ${esc(words("个样本", "samples", "サンプル"))}</small></div><div><span>${esc(c().routes)}</span><strong>${report.summary.routeCount}</strong><small>${report.summary.vehicleCount} ${esc(c().vehicles)}</small></div></section><section class="command-band"><header><h2>${esc(c().actual)}</h2>${sourceLine(report.summary.source)}</header><div class="command-table-wrap"><table><thead><tr><th>${esc(words("路线", "Route", "ルート"))}</th><th>${esc(words("车辆", "Vehicle", "車両"))}</th><th>${esc(words("停靠点", "Stops", "停車地点"))}</th><th>${esc(words("完成进度", "Completion", "完了率"))}</th><th>${esc(words("规划 / 模拟行驶距离", "Planned / simulated distance", "計画 / 模擬走行距離"))}</th><th>${esc(words("按规划完成率", "Adherence", "計画遵守率"))}</th><th>${esc(words("位置记录年龄", "Position record age", "位置情報の経過"))}</th></tr></thead><tbody>${report.routes.map((route) => `<tr><th><button class="command-link" type="button" data-command-select-route="${esc(route.routeId)}" data-command-select-vehicle="${esc(route.vehicleId)}">${esc(route.routeId)}</button></th><td>${esc(route.vehicleId)}</td><td>${route.completedStops}/${route.plannedStops}</td><td>${esc(pct(route.routeCompletion))}</td><td>${Math.round(route.plannedDistanceMeters)} / ${Math.round(route.actualDistanceMeters)} m</td><td>${esc(pct(route.routeAdherence))}</td><td>${esc(route.vehicleStaleAge ?? "-")}</td></tr>`).join("")}</tbody></table></div><p class="command-formula">${esc(words("完成进度 = 已结束停靠点 / 规划停靠点；行驶距离来自模拟轨迹，不是实时 GPS。", "Completion = terminal stops / planned stops; distance comes from simulated tracks, not live GPS.", "完了率 = 終了停車地点 / 計画停車地点。距離は模擬軌跡から算出し、リアルタイム GPS ではありません。"))}</p></section>${fleetVisual(overviewProjection(context))}`;
    }
    function driverView() {
      const view = context.driver.viewModel();
      const actions = Object.entries(view.legalActions).filter(([, allowed]) => allowed).map(([action]) => action);
      return `${titleBlock(c().driver, `${c().synthetic} · ${words("司机操作仅用于模拟", "Driver actions are simulated", "ドライバー操作はシミュレーション専用")}`)}<div class="command-two-column"><section class="command-band command-driver-flow"><header><h2>${esc(view.assignedRoute.vehicleId)} · ${esc(view.assignedRoute.routeId)}</h2>${sourceLine("Driver Local Projection + ExecutionStore")}</header><div class="command-driver-state-pair"><div class="command-driver-stop"><span>${esc(words("已接收执行状态", "Accepted execution state", "受信済み実行状態"))}</span><strong>${esc(view.authoritativeCurrentStop?.orderId || businessCode("TERMINAL"))}</strong><small>${esc(businessCode(view.authoritativeCurrentStop?.state || "TERMINAL"))}</small>${sourceLine(view.authoritativeAuthority)}</div><div class="command-driver-stop"><span>${esc(words("本机操作状态", "Local operation state", "ローカル操作状態"))}</span><strong>${esc(view.localProjectedCurrentStop?.orderId || businessCode("TERMINAL"))}</strong><small>${esc(businessCode(view.localProjectedCurrentStop?.state || "TERMINAL"))}</small>${sourceLine(view.projectionAuthority)}</div></div><h3>${esc(c().legalActions)}</h3><div class="command-button-grid">${actions.map((action) => actionButton(`driver-${action}`, action === "goOffline" ? c().offline : action === "reconnect" ? c().reconnect : businessCode(action))).join("")}</div></section><section class="command-band"><header><h2>${esc(words("离线队列与同步回执", "Offline queue and sync receipts", "オフラインキューと同期受信記録"))}</h2>${sourceLine("OfflineQueue")}</header><dl class="command-definition"><dt>${esc(words("连接状态", "Connection", "接続状態"))}</dt><dd>${esc(businessCode(view.offline ? "OFFLINE" : "ONLINE"))}</dd><dt>${esc(words("待同步", "Pending sync", "同期待ち"))}</dt><dd>${context.offlineQueue.summary().total}</dd><dt>${esc(words("同步回执数", "Sync receipt count", "同期受信記録数"))}</dt><dd>${context.offlineQueue.summary().ackAuditCount}</dd></dl><div class="command-action-list">${view.queue.map((item) => `<article class="command-action-row"><div><strong>${esc(item.localEventId)}</strong><small>${esc(item.statusText)} · ${esc(item.errorCode)}</small></div></article>`).join("") || `<p class="command-empty">${esc(c().noResults)}</p>`}</div></section></div>`;
    }
    function alertsView() {
      const source = context.snapshot();
      return `${titleBlock(c().alerts)}<section class="command-band"><header><div><p>${source.alerts.alerts.filter((row) => !["RESOLVED", "DISMISSED"].includes(row.state)).length} ${esc(({zh:"待处理",en:"open",ja:"未対応"})[locale()])}</p><h2>${esc(c().alerts)}</h2></div>${sourceLine("AlertStore v1.6 authoritative lifecycle")}</header><div class="command-action-list">${source.alerts.alerts.map((alert) => `<article class="command-action-row is-${esc(alert.severity.toLowerCase())}" data-alert-id="${esc(alert.alertId)}"><div class="command-action-main"><span>${esc(businessCode(alert.severity))} · ${esc(businessCode(alert.state))}</span><strong>${esc(businessCode(alert.ruleId))} · ${esc(alert.routeId)}</strong><small>${esc(alert.alertId)} · ${esc(alert.vehicleId)} · ${esc(alert.orderId)}</small></div><div class="command-action-controls">${actionButton("alert-focus", c().inspect, { id: alert.alertId, primary:true })}<details class="command-secondary-actions"><summary>${esc(({zh:'处理此告警',en:'Handle this alert',ja:'このアラートに対応'})[locale()])}</summary><div class="command-button-row">${alert.state === "OPEN" ? actionButton("alert-ack", c().acknowledge, { id: alert.alertId }) : ""}${alert.state === "ACKNOWLEDGED" ? actionButton("alert-handling", c().handling, { id: alert.alertId }) : ""}${["ACKNOWLEDGED", "IN_PROGRESS"].includes(alert.state) ? actionButton("alert-resolve", c().resolve, { id: alert.alertId }) : ""}${!alert.relatedIncidentHash && !["RESOLVED", "DISMISSED"].includes(alert.state) ? actionButton("alert-incident", c().incident, { id: alert.alertId, primary: alert.severity === "CRITICAL" }) : ""}</div><small>${esc(alert.ruleId)} · ${esc(alert.severity)} / ${esc(alert.state)}</small></details></div></article>`).join("")}</div></section>${actionCenterView(false)}`;
    }
    function recoveryView() {
      const source = context.snapshot();
      const candidates = source.recoveryCandidates;
      const full = context.fullReoptimizationAvailability();
      return `${titleBlock(c().recovery)}<section class="command-status-rail"><div><span>INCIDENTS</span><strong>${source.incidents.length}</strong><small>${esc(source.selected.incidentId || "-")}</small></div><div><span>${esc(({zh:"候选方案",en:"Candidates",ja:"候補案"})[locale()])}</span><strong>${candidates.length}</strong><small>RollingRecovery</small></div><div><span>REVISION</span><strong>${source.recovery.revision}</strong><small>${esc(shortHash(source.plan.planHash))}</small></div><div><span>UNDO</span><strong>${source.recovery.undoAllowed ? "READY" : "BLOCKED"}</strong><small>ACK policy</small></div></section><div class="command-two-column"><section class="command-band"><header><h2>${esc(c().localCandidate)}</h2>${sourceLine("RollingRecovery Session + verifier")}</header><div class="command-candidate-list">${candidates.map((candidate) => `<article class="${source.recovery.previewedPlanHash === candidate.planHash ? "is-selected" : ""}"><strong>${esc(candidate.candidateType)}</strong><span>${esc(candidate.verification.status)} · ${esc(shortHash(candidate.planHash))}</span><small>Change penalty ${esc(candidate.changePenalty?.total)} · ${candidate.routeCount} routes</small><div class="command-button-row">${actionButton("recovery-preview", c().preview, { id: candidate.planHash })}${actionButton("recovery-apply", c().apply, { id: candidate.planHash, disabled: source.recovery.previewedPlanHash !== candidate.planHash, primary: true })}</div></article>`).join("")}</div><div class="command-button-row">${actionButton("recovery-undo", c().undo, { disabled: !source.recovery.applied || !source.recovery.undoAllowed })}${actionButton("recovery-continue", c().continueExecution, { disabled: !source.recovery.applied })}</div></section><section class="command-band"><header><h2>${esc(c().fullEngine)}</h2>${sourceLine("Configured engine boundary")}</header>${statusChip(full.status, "warning")}<p>${esc(full.reason || "READY")}</p>${actionButton("recovery-full", c().fullEngine, { disabled: !full.fullAvailable })}<p>Public routing and optimization services were not invoked. Full reoptimization remains unavailable unless the configured local road matrix and engine are ready.</p><h3>Blast radius</h3><dl class="command-definition"><dt>Affected routes</dt><dd>${source.incidents.length ? source.incidents.map((row) => row.routeId).join(", ") : "-"}</dd><dt>Local regret</dt><dd>${candidates[0]?.changePenalty?.total ?? "-"}</dd><dt>Observed Pareto</dt><dd>${candidates.length} verified candidates</dd></dl></section></div>`;
    }
    function shiftReviewView() {
      const review = context.shiftReview();
      const recorder = context.flightRecorder();
      return `${titleBlock(c().review)}<section class="command-status-rail"><div><span>REVIEW HASH</span><strong>${esc(shortHash(review.reviewHash))}</strong><small>${esc(review.reviewType)}</small></div><div><span>${esc(words("事件记录", "Events", "イベント記録"))}</span><strong>${review.eventWindow.acceptedEventCount}</strong><small>${esc(review.eventWindow.lastLogicalTime)}</small></div><div><span>UNRESOLVED</span><strong>${review.unresolvedItems.length}</strong><small>Domain-derived</small></div><div><span>QUEUE</span><strong>${review.driverSyncSummary.pending}</strong><small>${esc(review.driverSyncSummary.connectionState)}</small></div></section><div class="command-two-column"><section class="command-band"><header><h2>${esc(review.title)}</h2>${sourceLine(review.evidenceLabel)}</header>${routeTable(review.routeSummaries.map((route) => ({ ...route, routeStatus: route.routeState, routeCompletion: route.actualCompletion, openAlertCount: route.openAlertCount, health: dependencies.Alerts.routeHealth({ executionProgressPercent: route.actualCompletion * 100, routeAdherencePercent: route.routeAdherence * 100, openAlertCount: route.openAlertCount }) })))}</section><section class="command-band"><header><h2>Flight Recorder</h2>${sourceLine(recorder.source)}</header><div class="command-event-lane is-vertical">${recorder.rows.slice().reverse().slice(0, 30).map((row) => `<button type="button" data-command-select-route="${esc(row.routeId)}" data-command-select-vehicle="${esc(row.vehicleId)}" data-command-select-order="${esc(row.orderId)}"><time>${esc(row.logicalTime)}</time><strong>${esc(row.category)}</strong><span>${esc(row.id)}</span></button>`).join("")}</div></section></div><section class="command-band command-handoff-inline"><header><h2>${esc(c().handoff)}</h2>${sourceLine("Frozen structured domain snapshot; not an AI summary")}</header><p>${esc(lastHandoff ? c().handoffReady : c().handoffNone)}</p>${actionButton("open-handoff", c().handoff, { primary: true })}</section>`;
    }

    let finderOpener = null;
    function closeFinder() { clearTimeout(inputRefreshTimer); state.quickFinderState.open = false; state.quickFinderState.query = ''; touch(); render(); const selector = finderOpener; finderOpener = null; root.setTimeout(() => (selector && target?.querySelector(selector) || target?.querySelector('[data-command-action="open-finder"]'))?.focus({preventScroll:true}), 0); }
    function rememberFinderOpener() { const action = documentValue.activeElement?.dataset?.commandAction; finderOpener = action ? `[data-command-action="${action}"]` : null; }
    function quickFinderView() {
      if (!state.quickFinderState.open) return "";
      const query = state.quickFinderState.query.toLowerCase();
      const rows = quickFinderIndex(context, state.route).filter((row) => !query || [row.type, row.id, row.label, row.status, row.routeId, row.vehicleId].join(" ").toLowerCase().includes(query)).slice(0, 40);
      state.quickFinderState.activeIndex = Math.min(state.quickFinderState.activeIndex, Math.max(0, rows.length - 1));
      const groups = [...new Set(rows.map((row) => row.type))];
      return `<div class="command-overlay" data-command-overlay="finder"><section class="command-dialog command-finder-dialog" role="dialog" aria-modal="true" aria-labelledby="commandFinderTitle"><header><h2 id="commandFinderTitle">${esc(c().finder)}</h2>${actionButton("close-finder", c().close)}</header><label class="command-finder-input"><span class="platform-sr-only">${esc(c().search)}</span><input autofocus data-command-finder-input value="${esc(state.quickFinderState.query)}" placeholder="${esc(c().search)}" aria-controls="commandFinderResults" aria-activedescendant="commandFinderResult${state.quickFinderState.activeIndex}"></label><div class="command-finder-results" id="commandFinderResults" role="listbox">${groups.map((group) => `<section><h3>${esc(businessCode(group.toUpperCase()))}</h3>${rows.map((row, index) => ({ row, index })).filter(({ row }) => row.type === group).map(({ row, index }) => `<button type="button" id="commandFinderResult${index}" role="option" aria-selected="${index === state.quickFinderState.activeIndex ? "true" : "false"}" class="${index === state.quickFinderState.activeIndex ? "is-active" : ""}" data-command-result-index="${index}" data-command-result="${esc(row.deepLink)}" data-command-result-id="${esc(row.id)}"><span>${esc(row.id)}</span><strong>${esc(row.label)}</strong><small>${esc(businessCode(row.status))} · ${esc(row.routeId)} ${esc(row.vehicleId)} · risk ${esc(row.risk)}</small></button>`).join("")}</section>`).join("") || `<p class="command-empty">${esc(c().noResults)}</p>`}</div>${state.quickFinderState.recent.length ? `<footer>Recent: ${state.quickFinderState.recent.map((value) => `<span>${esc(value)}</span>`).join("")}</footer>` : ""}</section></div>`;
    }
    function handoffView() {
      if (!state.panelState.handoffOpen) return "";
      const imported = importedHandoff?.pack;
      return `<div class="command-overlay" data-command-overlay="handoff"><section class="command-dialog command-handoff-dialog" role="dialog" aria-modal="true" aria-labelledby="commandHandoffTitle"><header><div><p>STRUCTURED DOMAIN SNAPSHOT</p><h2 id="commandHandoffTitle">${esc(c().handoff)}</h2></div>${actionButton("close-handoff", c().close)}</header><label class="command-note"><span>${esc(c().operatorNote)}</span><textarea data-command-handoff-note placeholder="${esc(c().operatorNote)}"></textarea><small>${esc(c().noteMetadata)}</small></label><div class="command-button-row">${actionButton("handoff-generate", c().handoff, { primary: true })}${actionButton("handoff-json", c().downloadJson, { disabled: !lastHandoff })}${actionButton("handoff-csv", c().downloadCsv, { disabled: !lastHandoff })}${actionButton("handoff-html", c().printHtml, { disabled: !lastHandoff })}<label class="command-button command-file-button">${esc(c().importHandoff)}<input type="file" accept="application/json,.json" data-command-handoff-import></label></div>${lastHandoff ? `<dl class="command-definition"><dt>ID</dt><dd>${esc(lastHandoff.handoffId)}</dd><dt>Hash</dt><dd>${esc(lastHandoff.handoffHash)}</dd><dt>Routes at risk</dt><dd>${lastHandoff.routesAtRisk.length}</dd><dt>Unresolved actions</dt><dd>${lastHandoff.unresolvedActions.length}</dd><dt>Open alerts</dt><dd>${lastHandoff.openAlerts.length}</dd></dl>` : `<p class="command-empty">${esc(c().handoffNone)}</p>`}${imported ? `<section class="command-readonly-handoff"><h3>${esc(c().readOnlyHandoff)}</h3><dl class="command-definition"><dt>ID</dt><dd>${esc(imported.handoffId)}</dd><dt>Hash</dt><dd>${esc(importedHandoff.sourceHandoffHash)}</dd><dt>Status</dt><dd>${esc(imported.operationalStatus)}</dd><dt>Side effects</dt><dd>NONE</dd></dl></section>` : ""}</section></div>`;
    }
    function renderRoute() {
      if (root.STCTPlatformV19?.classicTools?.has(state.route)) return root.STCTPlatformV19.classicTools.heading(state.route, locale());
      const key = ROUTE_TITLES[state.route] || "overview";
      const views = { overview: overviewView, dispatch: dispatchView, mission: missionView, execution: executionView, actual: actualView, driver: driverView, alerts: alertsView, recovery: recoveryView, review: shiftReviewView };
      return (views[key] || overviewView)();
    }
    function taskSummary() {
      const tasks={overview:['先处理优先待办，再查看受影响路线','Review priority actions, then affected routes','優先対応から影響ルートを確認'],dispatch:['复核现有候选、未分配和约束后应用计划','Review candidates, unassigned work and constraints before applying a plan','候補・未割当・制約を確認して計画を適用'],mission:['按模拟时间查看事件与候选影响','Inspect events and candidate effects in simulation time','シミュレーション時間でイベントと案の影響を確認'],execution:['查看已接收事件与合法下一步','Inspect accepted events and allowed next actions','受信イベントと可能な次の操作を確認'],actual:['对照计划与已接收的执行记录','Compare plans with accepted execution records','計画と受信した実行記録を比較'],driver:['模拟当前站点操作和离线同步','Simulate current-stop actions and offline sync','現在地点の操作とオフライン同期を模擬'],alerts:['查看影响对象，确认后进入恢复','Inspect affected objects, acknowledge and open recovery','影響対象を確認し復旧へ進む'],recovery:['复核事件、局部候选及应用条件','Review incidents, local candidates and application conditions','事象・局所候補・適用条件を確認'],review:['复核事件窗口和未解决项，再生成交接','Review the event window and unresolved work, then prepare handoff','イベント範囲と未解決項目を確認し引継ぎへ']};
      const key=ROUTE_TITLES[state.route],text=tasks[key];if(!text)return '';
      const source=context.snapshot(),index=locale()==='en'?1:locale()==='ja'?2:0,last=source.execution.acceptedEvents.at(-1),selected=source.selected;
      return `<section class="command-task-summary" data-command-task="${esc(key)}"><strong>${esc(text[index])}</strong><p>${esc(words('当前计划','Current plan','現在計画'))}: ${esc(source.plan.planId)} · ${esc(words('当前路线','Current route','現在ルート'))}: ${esc(selected.routeId||words('未选择','Not selected','未選択'))}</p><p>${esc(words('已接收事件时间（逻辑时间）','Accepted-event time (logical time)','受信イベント時刻（論理時刻）'))}: ${esc(last?.logicalTime||words('暂无事件','No events yet','イベントなし'))} · ${esc(words('模拟位置和插值不代表实时GPS；月度设计需求不作为派车订单。','Simulated positions and interpolation are not live GPS; monthly design demand is not dispatch orders.','模擬位置・補間はリアルタイムGPSではありません。月次設計需要は配車注文ではありません。'))}</p></section>`;
    }
    function render() {
      if (!target || !context) return null;
      const focusedAction=target.contains?.(documentValue.activeElement)?documentValue.activeElement?.dataset?.commandAction:null;
      root.STCTPlatformV19?.classicTools?.park();
      root.STCTPlatformV19?.mapRuntime?.park();target.classList.add("command-route-active");
      target.innerHTML = `<main class="command-workspace" data-command-route="${esc(state.route)}" data-no-webgl="${platformSnapshot?.noWebGL ? "true" : "false"}" data-reduced-motion="${platformSnapshot?.reducedMotion ? "true" : "false"}">${contextRibbon()}${contextNotice()}<div class="command-page">${renderRoute()}${taskSummary()}</div>${quickFinderView()}${handoffView()}<p class="platform-sr-only" aria-live="polite">${esc(lastDomainAction?.message || "")}</p></main>`;
      const task=target.querySelector('.command-task-summary'),title=target.querySelector('.command-page-heading');if(task&&title)title.after(task);
      if(root.STCTPlatformV19?.taskViews){const ns=root.STCTPlatformV19,w=ns.taskViews.copy[locale()],page=target.querySelector('.command-page'),heading=page.querySelector('.command-page-heading');
        const ribbon=target.querySelector('.command-context-ribbon');if(ribbon){const details=documentValue.createElement('details');details.className='p7-summary-details';details.innerHTML=`<summary>${esc(w.basis)}</summary>`;ribbon.replaceWith(details);details.append(ribbon);target.querySelector('main').append(details);}
        const mapRoutes = ['/command/overview', '/command/mission-control', '/command/execution', '/command/alerts', '/command/recovery'];
        if (heading && mapRoutes.includes(state.route)) {
          const slot = documentValue.createElement('div'); slot.dataset.p7MapSlot = '';
          if (state.route === '/command/overview' || state.route === '/command/mission-control') {
            heading.after(slot);
          } else {
            const details = documentValue.createElement('details'); details.className = 'command-map-details';
            const summary = documentValue.createElement('summary'); summary.textContent = c().operationalMap;
            details.append(summary, slot); page.append(details);
            details.addEventListener('toggle', () => root.dispatchEvent(new Event('resize')));
          }
          const selected = context.snapshot().selected;
          ns.mapRuntime.mount(slot, ns.mapAdapters.command(context, locale(), lastDomainAction?.type === 'recovery-preview' ? lastDomainAction.result?.candidate : null), {
            ...platformSnapshot, route: state.route, navigate: path => controller?.navigate(path),
            selectedId: selected.alertId || selected.orderId || selected.vehicleId || selected.routeId,
            onSelect(entity) {
              const before = context.snapshot().selected;
              if (![before.alertId,before.orderId,before.vehicleId,before.routeId].includes(entity.id))
                context.select({routeId:entity.routeId,vehicleId:entity.vehicleId,orderId:entity.orderId||'',alertId:entity.alertId||''});
            }
          });
        }
        page.querySelectorAll('.command-fleet-visual').forEach(node=>node.remove());const tabs=documentValue.createElement('div');tabs.innerHTML=ns.taskViews.taskTabs('COMMAND',locale());page.append(tabs);
      }
      root.STCTPlatformV19?.taskViews?.polish(target,'COMMAND',state.route,locale());
      root.STCTPlatformV19?.classicTools?.mount(target, state.route, locale(), context, !!dataDraft);
      if (state.quickFinderState.open) root.setTimeout(() => target?.querySelector("[data-command-finder-input]")?.focus(), 0);
      else if(focusedAction)target.querySelector(`[data-command-action="${focusedAction}"]`)?.focus({preventScroll:true});
      return { route: state.route, selected: clone(context.snapshot().selected), lastDomainAction: clone(lastDomainAction) };
    }

    function findActionItem(id) { return dependencies.ActionCenter.project(context, { ...state.alertFilters, includeClosed: true }).items.find((row) => row.actionItemId === id) || null; }
    function recordAction(type, result, message) { lastDomainAction = { type, result: clone(result), message: message || type, atRevision: state.revision + 1 }; context.notify("COMMAND_UI_DOMAIN_ACTION", { type, status: result?.status || result?.alert?.state || "COMPLETED" }); touch(); render(); return result; }
    async function runAction(action, id, element) {
      if(action==="data-draft-generate")return recordAction(action,dataDraft.generate());
      if(action==="data-draft-apply"){
        const before=context.snapshot();
        if(before.offline.queue.some(row=>!["ACKED","REJECTED","CANCELLED"].includes(row.status)))return recordAction(action,{status:"REJECTED",code:"COMMAND_PENDING_ACK_PROTECTED"});
        const warning={zh:"应用将替换当前运营计划并重建未启动的执行状态。先下载当前状态备份，是否继续？",en:"Replace the current operational plan and create an unstarted execution state? The current state will be downloaded first.",ja:"現在の運用計画を置換し、未開始の実行状態を作成します。現在の状態を先に出力します。続行しますか？"};
        if(!root.confirm(warning[locale()]))return;
        downloader(JSON.stringify(before,null,2),"command-before-data-adoption.json","application/json");
        return recordAction(action,dataDraft.apply(context,{confirmed:true,backupHash:root.STCTV18.networkContract.hashArtifact(before)}));
      }
      if (action === "open-finder") { rememberFinderOpener(); state.quickFinderState.open = true; touch(); return render(); }
      if (action === "close-finder") return closeFinder();
      if (action === "open-handoff") { state.panelState.handoffOpen = true; touch(); return render(); }
      if (action === "close-handoff") { state.panelState.handoffOpen = false; touch(); return render(); }
      if (action === "return-source" && state.returnRoute) return controller?.navigate(state.returnRoute);
      if (action === "focus-action-center") { state.alertFilters = { ...state.alertFilters, severity: "ALL" }; state.panelState.actionDetailId = "ACTION_CENTER"; touch(); return render(); }
      if (action.startsWith("action-")) {
        const item = findActionItem(id);
        if (!item) return recordAction(action, { status: "STALE_ENTITY" }, c().sourceNotFound);
        if (action === "action-note") {
          const note = requestText(c().reviewNote, item.reviewNote?.note || "Reviewed in COMMAND Action Center");
          return note == null ? { status: "CANCELLED" } : recordAction(action, { status: "NOTED", note: context.markReviewNote(item.actionItemId, note) });
        }
        const map = { "action-ack": "ACKNOWLEDGE", "action-handling": "START_HANDLING", "action-resolve": "RESOLVE", "action-dismiss": "DISMISS", "action-incident": "CREATE_INCIDENT", "action-open-recovery": "OPEN_RECOVERY", "action-retry": "RETRY_SYNC", "action-inspect": "OPEN_SOURCE" };
        const detail = action === "action-dismiss" ? { reason: requestText(c().dismissReason, "Dispatcher reviewed as non-actionable") } : {};
        if (action === "action-dismiss" && detail.reason == null) return { status: "CANCELLED" };
        const result = await dependencies.ActionCenter.execute(context, item, map[action], detail);
        if (result?.status === "NAVIGATE") return controller?.navigate(result.deepLink);
        return recordAction(action, result);
      }
      if (action.startsWith("alert-")) {
        const map = { "alert-ack": "ACKNOWLEDGE", "alert-handling": "START_HANDLING", "alert-resolve": "RESOLVE", "alert-incident": "CREATE_INCIDENT" };
        if (action === "alert-focus") { const alert = context.alertStore.list().find((row) => row.alertId === id); if (alert) context.select({ alertId: id, routeId: alert.routeId, vehicleId: alert.vehicleId, orderId: alert.orderId }, "ALERT"); return recordAction(action, { status: alert ? "FOCUSED" : "STALE_ENTITY" }); }
        const item = findActionItem(`ACTION-ALERT-${id}`);
        if (!item) return recordAction(action, { status: "STALE_ENTITY" }, c().sourceNotFound);
        return recordAction(action, await dependencies.ActionCenter.execute(context, item, map[action], {}));
      }
      if (action === "replay-prev" || action === "replay-next") { const result = context.replay.step("event", action === "replay-next" ? 1 : -1); return recordAction(action, result); }
      if (action === "simulation-delay") { const selected = context.snapshot().selected; const route = context.scenario.routes.find((row) => row.routeId === selected.routeId) || context.scenario.routes[0]; return recordAction(action, await context.addSimulationDelay(route.routeId, selected.orderId || route.orderIds[1], 15)); }
      if (action === "execution-pause") return recordAction(action, context.appendExecution("RUN_PAUSED"));
      if (action === "execution-release") return recordAction(action, context.appendExecution("RUN_RELEASED"));
      if (action === "execution-resume") return recordAction(action, context.appendExecution("RUN_RESUMED"));
      if (action.startsWith("driver-")) {
        const method = action.slice(7); const aliases = { fail: "failStop" };
        const fn = context.driver[aliases[method] || method];
        if (typeof fn !== "function") return recordAction(action, { status: "UNAVAILABLE" });
        return recordAction(action, await fn.call(context.driver));
      }
      if (action === "recovery-preview") return recordAction(action, context.workspace.previewRecovery(id));
      if (action === "recovery-apply") return recordAction(action, context.workspace.applyRecovery(id));
      if (action === "recovery-undo") return recordAction(action, context.workspace.undoRecovery());
      if (action === "recovery-continue") return recordAction(action, context.continueExecution());
      if (action === "recovery-full") return recordAction(action, await context.runFullReoptimization());
      if (action === "dispatch-generate") {
        const optimizer = context.optimizer();
        if (!optimizer?.generateScenarios) return recordAction(action, { status: "PLANNING_UNAVAILABLE" });
        return recordAction(action, { status: "COMPLETED", candidates: (await optimizer.generateScenarios({})).length });
      }
      if (action === "dispatch-apply") {
        let transition;
        const applied = await context.planning()?.applySelected?.({ beforeApply: (verifiedPlan) => {
          // The operational snapshot is a JSON contract; legacy verification may contain omitted optional fields.
          const operationalPlan = JSON.parse(JSON.stringify({ ...verifiedPlan, providerProvenance: verifiedPlan.providerProvenance ?? null, matrixHash: verifiedPlan.matrixHash ?? null }));
          transition = context.adoptAppliedPlan(operationalPlan, { policy: "RESET_EXECUTION", reason: "USER_APPLIED_VERIFIED_PLAN" });
          if (transition.status !== "ADOPTED") throw Object.assign(new Error(transition.code), { code: transition.code });
        } });
        return recordAction(action, { status: "APPLIED_AND_ADOPTED", planHash: applied.planHash, transition });
      }
      if (action === "dispatch-restore") return recordAction(action, context.planning()?.restore?.());
      if (action === "dispatch-manual") return recordAction(action, context.planning()?.startManual?.());
      if (action === "dispatch-what-if") return recordAction(action, { status: "COMPLETED", results: await context.planning()?.evaluateCapacityOptions?.() });
      if (action === "dispatch-export") {
        const exported = context.planning()?.exportSnapshot?.();
        if (!exported) return recordAction(action, { status: "PLANNING_UNAVAILABLE" });
        return recordAction(action, downloader(JSON.stringify(exported, null, 2), "stct-planning-snapshot.json", "application/json"));
      }
      if (action === "handoff-generate") {
        const note = element?.closest(".command-dialog")?.querySelector("[data-command-handoff-note]")?.value || "";
        const actions = dependencies.ActionCenter.project(context);
        lastHandoff = dependencies.Handoff.generate(context, actions, { operatorNotes: note ? [note] : [] });
        const validation = dependencies.Handoff.validate(lastHandoff);
        if (validation.status !== "PASS") throw Object.assign(new Error(validation.errors[0]), { code: validation.errors[0] });
        return recordAction(action, { status: "GENERATED", handoffHash: lastHandoff.handoffHash }, c().handoffReady);
      }
      if (action === "handoff-json" && lastHandoff) return downloader(dependencies.Handoff.toJson(lastHandoff), `${lastHandoff.handoffId}.json`, "application/json");
      if (action === "handoff-csv" && lastHandoff) return downloader(dependencies.Handoff.toCsv(lastHandoff), `${lastHandoff.handoffId}.csv`, "text/csv");
      if (action === "handoff-html" && lastHandoff) return downloader(dependencies.Handoff.toPrintableHtml(lastHandoff), `${lastHandoff.handoffId}.html`, "text/html");
      return null;
    }
    function activateFinderResult(result) {
      state.quickFinderState.recent = [result.dataset.commandResultId, ...state.quickFinderState.recent.filter((id) => id !== result.dataset.commandResultId)].slice(0, 8);
      state.quickFinderState.open = false;
      touch();
      controller?.navigate(result.dataset.commandResult);
    }
    function onClick(event) {
      const result = event.target.closest("[data-command-result]");
      if (result) { activateFinderResult(result); return; }
      const routeButton = event.target.closest("[data-command-select-route], [data-command-select-vehicle], [data-command-select-order]");
      if (routeButton) { context.select({ routeId: routeButton.dataset.commandSelectRoute, vehicleId: routeButton.dataset.commandSelectVehicle, orderId: routeButton.dataset.commandSelectOrder }); touch(); render(); return; }
      const eventButton = event.target.closest("[data-command-event]");
      if (eventButton) { recordAction("replay-seek-event", context.replay.seekEvent(eventButton.dataset.commandEvent)); return; }
      const action = event.target.closest("[data-command-action]");
      if (!action || action.disabled) return;
      Promise.resolve(runAction(action.dataset.commandAction, action.dataset.commandId || "", action)).catch((error) => { warnings.push(error.code || error.message); lastDomainAction = { type: action.dataset.commandAction, result: { status: "FAILED", code: error.code || "COMMAND_ACTION_FAILED" }, message: error.message }; render(); });
    }
    function onInput(event) {
      if (event.target.matches("[data-command-finder-input]")) { state.quickFinderState.query = event.target.value.slice(0, 100); state.quickFinderState.activeIndex = 0; clearTimeout(inputRefreshTimer); inputRefreshTimer = root.setTimeout(() => { touch(); render(); }, 120); }
      if (event.target.matches("[data-command-filter='search']")) { state.alertFilters.search = event.target.value.slice(0, 100); clearTimeout(inputRefreshTimer); inputRefreshTimer = root.setTimeout(() => { touch(); render(); }, 120); }
      if (event.target.matches("[data-command-replay-seek]")) { context.replay.seek(Number(event.target.value)); touch(); }
    }
    function onChange(event) {
      if (event.target.matches("[data-command-handoff-import]")) {
        const file = event.target.files?.[0];
        if (!file) return;
        Promise.resolve(file.text()).then((value) => {
          const result = dependencies.Handoff.importReadOnly(value, context);
          if (result.status !== "PASS") throw Object.assign(new Error(result.errors.join(", ")), { code: result.errors[0] });
          importedHandoff = result;
          recordAction("handoff-import", { status: result.status, mode: result.mode, sourceHandoffHash: result.sourceHandoffHash });
        }).catch((error) => { warnings.push(error.code || error.message); lastDomainAction = { type: "handoff-import", result: { status: "FAILED", code: error.code || "HANDOFF_IMPORT_FAILED" }, message: error.message }; render(); });
        return;
      }
      const filter = event.target.dataset.commandFilter;
      if (!filter || filter === "search") return;
      state.alertFilters[filter] = event.target.value; touch(); render();
    }
    function onKeydown(event) {
      if(state.quickFinderState.open && event.key==='Tab') {
        const dialog=target?.querySelector('[data-command-overlay="finder"]');
        const items=[...(dialog?.querySelectorAll('input,button:not([disabled])')||[])].filter(node=>node.getClientRects().length);
        if(items.length && ((event.shiftKey&&documentValue.activeElement===items[0])||(!event.shiftKey&&documentValue.activeElement===items.at(-1)))) { event.preventDefault();(event.shiftKey?items.at(-1):items[0]).focus();return; }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); rememberFinderOpener(); state.quickFinderState.open = true; touch(); render(); return; }
      if (state.quickFinderState.open && ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
        const results = [...(target?.querySelectorAll("[data-command-result]") || [])];
        if (!results.length) return;
        event.preventDefault();
        if (event.key === "Enter") return activateFinderResult(results[state.quickFinderState.activeIndex] || results[0]);
        const delta = event.key === "ArrowDown" ? 1 : -1;
        state.quickFinderState.activeIndex = (state.quickFinderState.activeIndex + delta + results.length) % results.length;
        results.forEach((result, index) => { result.classList.toggle("is-active", index === state.quickFinderState.activeIndex); result.setAttribute("aria-selected", index === state.quickFinderState.activeIndex ? "true" : "false"); });
        target?.querySelector("[data-command-finder-input]")?.setAttribute("aria-activedescendant", `commandFinderResult${state.quickFinderState.activeIndex}`);
        results[state.quickFinderState.activeIndex]?.scrollIntoView?.({ block: "nearest" });
        touch();
        return;
      }
      if (event.key === "Escape" && (state.quickFinderState.open || state.panelState.handoffOpen)) { if(state.quickFinderState.open){event.preventDefault();event.stopPropagation();closeFinder();}else{state.panelState.handoffOpen = false; touch(); render();} }
    }

    function validateAndSelect(params) {
      const source = context.snapshot();
      const patch = {};
      const checks = {
        routeId: (value) => context.scenario.routes.some((row) => row.routeId === value),
        vehicleId: (value) => context.scenario.routes.some((row) => row.vehicleId === value),
        orderId: (value) => context.scenario.stops.some((row) => row.orderId === value),
        stopId: (value) => context.scenario.stops.some((row) => row.orderId === value),
        alertId: (value) => source.alerts.alerts.some((row) => row.alertId === value),
        incidentId: (value) => source.incidents.some((row) => row.incidentId === value),
        planHash: (value) => source.plan.planHash === value,
        runHash: (value) => source.execution.run.executionRunHash === value,
      };
      const stale = Object.entries(checks).filter(([key, check]) => params[key] && !check(params[key])).map(([key]) => key);
      state.panelState.contextMessage = stale.length ? `${c().sourceNotFound} (${stale.join(", ")})` : "";
      for (const key of ["routeId", "vehicleId", "orderId", "stopId", "alertId", "incidentId"]) if (params[key] && checks[key](params[key])) patch[key] = params[key];
      if (params.returnTo && /^\/command\/[a-z-]+(?:\?.*)?$/.test(params.returnTo)) state.returnRoute = params.returnTo;
      if (params.focus === "quick-finder") state.quickFinderState.open = true;
      if (params.focus === "handoff") state.panelState.handoffOpen = true;
      if (Object.keys(patch).length) context.select(patch, patch.alertId ? "ALERT" : "COMMAND_CONTEXT");
      touch();
    }

    function mountDescriptor(descriptor, routeContext, platformContextValue) {
      platformSnapshot = platformContextValue.snapshot;
      controller = platformContextValue.controller || controller;
      target = platformContextValue.target;
      currentRouteContext = routeContext;
      currentOwner = descriptor.mountOwner;
      state.route = descriptor.logicalPath;
      state.returnRoute = "";
      state.panelState.handoffOpen = false;
      state.quickFinderState.open = false;
      state.quickFinderState.query = "";
      mountCount += 1;
      ensureContext();
      context.setLocale(locale());
      render();
      validateAndSelect(routeContext.routeParams || {});
      render();
      routeContext.scope.listen(target, "click", onClick);
      routeContext.scope.listen(target, "input", onInput);
      routeContext.scope.listen(target, "change", onChange);
      routeContext.scope.listen(documentValue, "keydown", onKeydown);
      const unsubscribe = context.subscribe(() => { if (target && currentOwner === descriptor.mountOwner) render(); });
      routeContext.scope.register(() => { unsubscribe(); cleanupCount += 1; }, "command-context-subscription");
      context.ready.then(() => { if (target && currentOwner === descriptor.mountOwner) render(); }).catch((error) => warnings.push(error.code || error.message));
      return { cleanup: () => unmount(descriptor.mountOwner), model: { route: descriptor.logicalPath, domainKind: descriptor.domainKind } };
    }
    function mount(routeDescriptor, platformContextValue) {
      const descriptor = registry.get(routeDescriptor.logicalPath);
      if (!descriptor) throw Object.assign(new Error(`No COMMAND mount for ${routeDescriptor.logicalPath}`), { code: "COMMAND_ROUTE_MOUNT_NOT_FOUND" });
      return descriptor.mount(api(), routeDescriptor, platformContextValue);
    }
    function unmount(owner) { root.STCTPlatformV19?.classicTools?.park(); root.STCTPlatformV19?.mapRuntime?.park();
      if (owner && currentOwner && owner !== currentOwner) return { status: "OWNER_MISMATCH", owner, currentOwner };
      if (context) context.pauseForWorkspaceSwitch();
      clearTimeout(inputRefreshTimer);
      persist();
      if (target) target.classList.remove("command-route-active");
      target = null;
      currentRouteContext = null;
      currentOwner = "";
      unmountCount += 1;
      return { status: "UNMOUNTED", sharedStateDestroyed: false, replayAutoResume: false };
    }
    function sync(snapshotValue) {
      platformSnapshot = snapshotValue;
      if (context && context.workspace.snapshot().locale !== locale()) context.setLocale(locale());
      if (target) render();
    }
    function mapLegacyTarget(targetValue) {
      const map = { serviceView: "/command/overview", carbonView: "/command/carbon", mapView: "/command/dispatch", optimizerView: "/command/dispatch", "experience-replay": "/command/mission-control", "experience-v16": "/command/execution", "experience-v17": "/command/execution", analysisView: "/command/analysis", exceptionsView: "/command/alerts", reportView: "/command/report" };
      return map[String(targetValue || "")] || null;
    }
    function inventoryCapabilities() {
      return ["Canonical Scenario / Identity", "Planning state", "Candidate Pool", "Verifier", "SimulationStore", "Replay Controller", "Scenario Arena", "Timeline / X-Ray", "ExecutionStore", "Derived Telemetry", "Plan-vs-Actual", "Driver Local Projection", "Offline Queue", "AlertStore", "Incident / Recovery Session", "Full Reoptimization boundary", "Shift Review / Flight Recorder", "Routing Provider", "Matrix Provider", "Map Layer Registry", "Capsule / Audit"];
    }
    function diagnostics() {
      return { schemaVersion: SCHEMA_VERSION, mountCount, unmountCount, cleanupCount, currentOwner, currentRoute: state.route, warnings: clone(warnings), sharedAuthority: context?.diagnostics() || null, commandSnapshotSerializable: (() => { try { JSON.stringify(snapshot()); return true; } catch { return false; } })(), routeRegistry: registry.diagnostics(), lastDomainAction: clone(lastDomainAction), handoffHash: lastHandoff?.handoffHash || "", externalRequests: 0 };
    }
    function api() { return { schemaVersion: SCHEMA_VERSION, inventoryCapabilities, registerRoutes: registry.list, mount, mountDescriptor, unmount, snapshot, restore, mapLegacyTarget, createOperationalContext: ensureContext, setDataDraft, diagnostics, bind, sync, overviewProjection: () => overviewProjection(ensureContext()), quickFinderIndex: () => quickFinderIndex(ensureContext(), state.route), render, state, registry }; }
    return Object.freeze(api());
  }

  return Object.freeze({ SCHEMA_VERSION, SNAPSHOT_VERSION, COPY, overviewProjection, quickFinderIndex, createAdapter });
});
