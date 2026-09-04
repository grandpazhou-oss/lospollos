(function (root, factory) {
  "use strict";
  const incidents = root?.STCTV15?.incidents || (typeof require === "function" ? require("./incident-v15.js") : null);
  const impact = root?.STCTV15?.impactAnalysis || (typeof require === "function" ? require("./impact-analysis-v15.js") : null);
  const recovery = root?.STCTV15?.recovery || (typeof require === "function" ? require("./recovery-v15.js") : null);
  const api = factory(root, incidents, impact, recovery);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV15 = root.STCTV15 || { version: "1.5.0" };
    root.STCTV15.incidentUI = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, Incidents, Impact, Recovery) {
  "use strict";

  if (!Incidents || !Impact || !Recovery) throw new Error("Incident UI v1.5 requires Incident, Impact Analysis, and Recovery v1.5.");

  const VERSION = "stct-incident-ui-v1.5";
  const TYPE_LABELS = {
    zh: {
      VEHICLE_BREAKDOWN: "车辆故障", STOP_DELAY: "配送点延误", EMERGENCY_ORDER: "紧急订单", ORDER_CANCELLED: "订单取消",
      TIME_WINDOW_CHANGED: "时间窗变更", DEPOT_DELAY: "仓库延误", ROAD_CLOSURE_SIMULATION: "道路封闭模拟",
    },
    ja: {
      VEHICLE_BREAKDOWN: "車両故障", STOP_DELAY: "配送先遅延", EMERGENCY_ORDER: "緊急注文", ORDER_CANCELLED: "注文キャンセル",
      TIME_WINDOW_CHANGED: "時間枠変更", DEPOT_DELAY: "デポ遅延", ROAD_CLOSURE_SIMULATION: "通行止めシミュレーション",
    },
    en: {
      VEHICLE_BREAKDOWN: "Vehicle breakdown", STOP_DELAY: "Stop delay", EMERGENCY_ORDER: "Emergency order", ORDER_CANCELLED: "Order cancelled",
      TIME_WINDOW_CHANGED: "Time-window change", DEPOT_DELAY: "Depot delay", ROAD_CLOSURE_SIMULATION: "Road-closure simulation",
    },
  };
  const COPY = {
    zh: {
      launcher: "异常恢复", title: "异常恢复工作台 / Incident Recovery Studio", subtitle: "本地规划模拟，不代表实时道路或生产调度。",
      compose: "1 注入异常", impact: "2 影响范围", compare: "3 比较恢复候选", control: "4 应用与撤销",
      incidentType: "异常类型", target: "影响对象", logicalMinute: "异常发生时间", delayMinutes: "延误分钟",
      windowStart: "新时间窗开始", windowEnd: "新时间窗结束", multiplier: "距离倍率", emergencyId: "紧急订单 ID",
      volume: "容积", serviceMinutes: "服务分钟", inject: "注入异常", clear: "清除异常", generate: "生成 5 个恢复候选",
      generating: "正在生成与验证候选...", injected: "异常已注入", ready: "等待注入", applied: "恢复方案已应用",
      undone: "已精确撤销并恢复 Simulation", affectedRoutes: "受影响路线", affectedVehicles: "受影响车辆",
      affectedOrders: "受影响订单", lateRisk: "延误风险", missedWindow: "错过时间窗", repairSet: "待修复订单",
      deterministic: "确定", projected: "预测", heuristic: "启发式", unknown: "未知", pinning: "执行历史锁定",
      completed: "已完成", active: "服务中", locked: "锁定订单", candidate: "恢复候选", reference: "原计划参考",
      service: "服务", delay: "最晚完成", changes: "变更数", cost: "成本", co2: "CO₂", vehicles: "车辆",
      verifier: "Verifier", engine: "引擎", matrix: "矩阵", preview: "预览", apply: "应用", undo: "撤销",
      restore: "恢复 Baseline", export: "导出审计", close: "关闭", selectCandidate: "选择候选后预览和应用。",
      passOnly: "只有 Verifier PASS 的候选可应用。", mustUndo: "请先撤销已应用的恢复方案，再关闭工作台。",
      localBoundary: "Local Regret / Ruin-and-Recreate 使用实际 MatrixContext；Full Reoptimization：ADAPTER_ONLY / NOT_INTEGRATED。",
      noWebgl: "地图不可用时，影响范围表与候选卡仍可完整操作。", simulationOnly: "仅模拟，不是实时封路",
      noCandidate: "当前没有可应用候选。", auditReady: "恢复审计已准备下载。", error: "操作失败",
    },
    ja: {
      launcher: "異常復旧", title: "インシデント復旧スタジオ / Incident Recovery Studio", subtitle: "ローカル計画シミュレーション。リアルタイム道路情報や本番配車ではありません。",
      compose: "1 インシデント注入", impact: "2 影響範囲", compare: "3 復旧候補比較", control: "4 適用と取消",
      incidentType: "インシデント種類", target: "対象", logicalMinute: "発生時刻", delayMinutes: "遅延分",
      windowStart: "新しい開始時刻", windowEnd: "新しい終了時刻", multiplier: "距離倍率", emergencyId: "緊急注文 ID",
      volume: "容積", serviceMinutes: "サービス分", inject: "注入", clear: "クリア", generate: "5件の復旧候補を生成",
      generating: "候補を生成・検証中...", injected: "インシデント注入済み", ready: "注入待ち", applied: "復旧計画を適用済み",
      undone: "Simulation を正確に復元", affectedRoutes: "影響ルート", affectedVehicles: "影響車両", affectedOrders: "影響注文",
      lateRisk: "遅延リスク", missedWindow: "時間枠超過", repairSet: "修復対象", deterministic: "確定", projected: "予測",
      heuristic: "ヒューリスティック", unknown: "不明", pinning: "実行履歴の固定", completed: "完了", active: "サービス中", locked: "固定注文",
      candidate: "復旧候補", reference: "元計画の参照", service: "サービス", delay: "最終終了", changes: "変更数", cost: "コスト",
      co2: "CO₂", vehicles: "車両", verifier: "Verifier", engine: "エンジン", matrix: "マトリクス", preview: "プレビュー",
      apply: "適用", undo: "取消", restore: "Baseline 復元", export: "監査出力", close: "閉じる", selectCandidate: "候補を選択してプレビュー・適用します。",
      passOnly: "Verifier PASS の候補のみ適用できます。", mustUndo: "適用済み復旧計画を取り消してから閉じてください。",
      localBoundary: "Local Regret / Ruin-and-Recreate は実 MatrixContext を使用。Full Reoptimization: ADAPTER_ONLY / NOT_INTEGRATED。",
      noWebgl: "地図なしでも影響表と候補カードは操作できます。", simulationOnly: "シミュレーションのみ。リアルタイム通行止めではありません",
      noCandidate: "適用可能な候補がありません。", auditReady: "復旧監査をダウンロードできます。", error: "操作に失敗しました",
    },
    en: {
      launcher: "Incident recovery", title: "Incident Recovery Studio", subtitle: "Local planning simulation, not real-time roads or production dispatch.",
      compose: "1 Inject incident", impact: "2 Blast radius", compare: "3 Compare recovery candidates", control: "4 Apply and undo",
      incidentType: "Incident type", target: "Affected entity", logicalMinute: "Incident time", delayMinutes: "Delay minutes",
      windowStart: "New window start", windowEnd: "New window end", multiplier: "Distance multiplier", emergencyId: "Emergency order ID",
      volume: "Volume", serviceMinutes: "Service minutes", inject: "Inject incident", clear: "Clear incident", generate: "Generate 5 recovery candidates",
      generating: "Generating and verifying candidates...", injected: "Incident injected", ready: "Ready to inject", applied: "Recovery plan applied",
      undone: "Simulation restored exactly", affectedRoutes: "Affected routes", affectedVehicles: "Affected vehicles", affectedOrders: "Affected orders",
      lateRisk: "Late risk", missedWindow: "Missed windows", repairSet: "Repair set", deterministic: "Deterministic", projected: "Projected",
      heuristic: "Heuristic", unknown: "Unknown", pinning: "Executed-work pinning", completed: "Completed", active: "In service", locked: "Locked orders",
      candidate: "Recovery candidate", reference: "Carry-forward reference", service: "Service", delay: "Latest end", changes: "Changes", cost: "Cost",
      co2: "CO₂", vehicles: "Vehicles", verifier: "Verifier", engine: "Engine", matrix: "Matrix", preview: "Preview",
      apply: "Apply", undo: "Undo", restore: "Restore baseline", export: "Export audit", close: "Close", selectCandidate: "Select a candidate to preview and apply.",
      passOnly: "Only verifier-PASS candidates can be applied.", mustUndo: "Undo the applied recovery plan before closing the studio.",
      localBoundary: "Local Regret / Ruin-and-Recreate uses the actual MatrixContext. Full Reoptimization: ADAPTER_ONLY / NOT_INTEGRATED.",
      noWebgl: "Without WebGL, the blast-radius table and candidate cards remain operable.", simulationOnly: "Simulation only, not a real-time closure",
      noCandidate: "No applicable candidate is available.", auditReady: "Recovery audit is ready to download.", error: "Action failed",
    },
  };

  let activeMount = null;

  function language() {
    const value = root?.STCTCore?.getLanguage?.() || root?.document?.documentElement?.lang || "zh";
    return String(value).startsWith("ja") ? "ja" : String(value).startsWith("en") ? "en" : "zh";
  }

  function copy() { return COPY[language()] || COPY.en; }
  function labels() { return TYPE_LABELS[language()] || TYPE_LABELS.en; }
  function clone(value) { if (value === undefined) return undefined; if (typeof structuredClone === "function") return structuredClone(value); return JSON.parse(JSON.stringify(value)); }
  function text(value) { return String(value ?? "").trim(); }
  function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
  function entityId(value) { return text(value?.id || value?.orderId || value?.vehicleId || value?.routeId || value?.code); }
  function shortHash(value) { const body = text(value).split(":").at(-1); return body.length > 13 ? `${body.slice(0, 7)}...${body.slice(-5)}` : body || "-"; }
  function timeText(minutes) { const value = Math.max(0, Math.round(number(minutes))); return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; }
  function node(tag, className = "", value = "") { const element = root.document.createElement(tag); if (className) element.className = className; if (value !== "") element.textContent = text(value); return element; }
  function append(parent, ...children) { children.filter(Boolean).forEach((child) => parent.appendChild(child)); return parent; }
  function clear(element) { element?.replaceChildren(); }
  function button(label, action, className = "") { const element = node("button", `exp-btn ${className}`.trim(), label); element.type = "button"; element.dataset.incidentAction = action; return element; }
  function option(value, label, selected = false) { const element = node("option", "", label); element.value = text(value); element.selected = selected; return element; }
  function selectField(label, fieldName, values, selected) {
    const wrapper = node("label", "exp-incident-field");
    const select = node("select"); select.dataset.incidentField = fieldName;
    values.forEach((row) => select.appendChild(option(row.value, row.label, text(row.value) === text(selected))));
    return append(wrapper, node("span", "", label), select);
  }
  function inputField(label, fieldName, value, type = "text", attributes = {}) {
    const wrapper = node("label", "exp-incident-field");
    const input = node("input"); input.type = type; input.value = value ?? ""; input.dataset.incidentField = fieldName;
    Object.entries(attributes).forEach(([key, fieldValue]) => input.setAttribute(key, String(fieldValue)));
    return append(wrapper, node("span", "", label), input);
  }
  function metricCard(label, value, confidence = "") {
    const item = node("div", "exp-incident-metric");
    append(item, node("span", "", label), node("b", "", value), confidence ? node("small", `confidence ${confidence.toLowerCase()}`, confidence) : null);
    return item;
  }
  function routeOrderIds(plan) { return (plan?.routes || []).flatMap((route) => route.orderIds || route.stops?.map((stop) => entityId(stop)) || []); }

  function mount(options = {}) {
    if (!options.host || !options.basePlan || !options.baseScenario || !options.experience?.simulationStore || !options.experience?.eventStore) return null;
    activeMount?.cleanup?.();
    const basePlan = clone(options.basePlan);
    const baseScenario = clone(options.baseScenario);
    const launcher = options.launcher || root.document.getElementById("expIncidentOpen");
    const shell = node("section", "exp-incident-shell");
    shell.hidden = true;
    shell.setAttribute("aria-label", copy().title);
    shell.setAttribute("aria-modal", "true");
    shell.setAttribute("role", "dialog");
    const panel = node("div", "exp-incident-sheet");
    const header = node("header", "exp-incident-header");
    const heading = node("div");
    append(heading, node("h3", "", copy().title), node("p", "", copy().subtitle));
    const headerActions = node("div", "exp-incident-header-actions");
    const statusChip = node("span", "exp-incident-status", copy().ready);
    const closeButton = button("×", "close", "icon exp-incident-close"); closeButton.setAttribute("aria-label", copy().close); closeButton.title = copy().close;
    append(headerActions, statusChip, closeButton); append(header, heading, headerActions);
    const steps = node("div", "exp-incident-steps");
    [copy().compose, copy().impact, copy().compare, copy().control].forEach((label, index) => { const item = node("span", index === 0 ? "active" : "", label); item.dataset.incidentStep = String(index + 1); steps.appendChild(item); });
    const body = node("div", "exp-incident-body");
    append(panel, header, steps, body); shell.appendChild(panel); options.host.appendChild(shell);

    const firstOrder = baseScenario.orders?.[0] || {};
    const state = {
      destroyed: false, open: false, phase: "READY", status: copy().ready, error: "", incidentSnapshot: null,
      pinning: null, blastRadius: null, recoveryResult: null, selectedPlanHash: "", applied: false,
      openCount: 0, closeCount: 0, listenerCount: 0,
      form: {
        type: "VEHICLE_BREAKDOWN", targetId: entityId(basePlan.routes?.[0]?.vehicleId ? { id: basePlan.routes[0].vehicleId } : baseScenario.vehicles?.[0]),
        logicalMinute: Math.round(number(options.getLogicalMinute?.(), 480)), delayMinutes: 45, twStart: "10:00", twEnd: "12:00",
        multiplier: 1.3, emergencyId: "EMERGENCY-DEMO-001", volume: 1, serviceMinutes: 10,
        lon: number(firstOrder.lon ?? firstOrder.longitude, 0), lat: number(firstOrder.lat ?? firstOrder.latitude, 0),
      },
    };
    let returnFocus = null;
    const incidentController = Incidents.createIncidentController({ baseScenario, basePlan, eventStore: options.experience.eventStore });
    let recoveryController = null;

    function targetsForType(type) {
      if (type === "VEHICLE_BREAKDOWN") return (baseScenario.vehicles || []).map((row) => ({ value: entityId(row), label: `${entityId(row)}${row.name ? ` · ${row.name}` : ""}` })).filter((row) => row.value);
      if (["STOP_DELAY", "ORDER_CANCELLED", "TIME_WINDOW_CHANGED"].includes(type)) return (baseScenario.orders || []).map((row) => ({ value: entityId(row), label: `${entityId(row)}${row.name ? ` · ${row.name}` : row.code ? ` · ${row.code}` : ""}` })).filter((row) => row.value);
      if (type === "ROAD_CLOSURE_SIMULATION") return (basePlan.routes || []).map((row) => ({ value: text(row.routeId), label: `${text(row.routeId)} · ${text(row.vehicleId)}` })).filter((row) => row.value);
      if (type === "DEPOT_DELAY") return [{ value: entityId(baseScenario.depot) || "DEPOT", label: entityId(baseScenario.depot) || "DEPOT" }];
      return [{ value: state.form.emergencyId, label: state.form.emergencyId }];
    }

    function normalizeTarget() {
      const targets = targetsForType(state.form.type);
      if (!targets.some((row) => row.value === state.form.targetId)) state.form.targetId = targets[0]?.value || "";
    }

    function specification() {
      const common = { type: state.form.type, logicalMinute: number(state.form.logicalMinute), affectedEntityIds: [state.form.targetId], source: "incident-ui-v15" };
      if (state.form.type === "VEHICLE_BREAKDOWN") common.parameters = { vehicleId: state.form.targetId };
      else if (state.form.type === "STOP_DELAY") common.parameters = { orderId: state.form.targetId, delayMinutes: number(state.form.delayMinutes) };
      else if (state.form.type === "ORDER_CANCELLED") common.parameters = { orderId: state.form.targetId };
      else if (state.form.type === "TIME_WINDOW_CHANGED") common.parameters = { orderId: state.form.targetId, twStart: state.form.twStart, twEnd: state.form.twEnd };
      else if (state.form.type === "DEPOT_DELAY") common.parameters = { delayMinutes: number(state.form.delayMinutes) };
      else if (state.form.type === "ROAD_CLOSURE_SIMULATION") common.parameters = { routeId: state.form.targetId, segmentId: `${state.form.targetId}-SIMULATED-SEGMENT`, delayMinutes: number(state.form.delayMinutes), distanceMultiplier: number(state.form.multiplier, 1) };
      else {
        const id = text(state.form.emergencyId);
        common.affectedEntityIds = [id];
        common.parameters = { order: { id, code: id, name: "Synthetic emergency stop", address: "Local simulation", lon: number(state.form.lon), lat: number(state.form.lat), volume: number(state.form.volume), count: 1, serviceMin: number(state.form.serviceMinutes), twStart: state.form.twStart, twEnd: state.form.twEnd, priorityWeight: 4 } };
      }
      return common;
    }

    function setStatus(value, kind = "") {
      state.status = value; statusChip.textContent = value; statusChip.className = `exp-incident-status ${kind}`.trim();
    }

    function setStep(step) {
      shell.querySelectorAll("[data-incident-step]").forEach((element) => element.classList.toggle("active", number(element.dataset.incidentStep) <= step));
    }

    function composer() {
      const section = node("section", "exp-incident-section exp-incident-composer");
      const title = node("div", "exp-incident-section-title"); append(title, node("strong", "", copy().compose), node("small", "", `base ${shortHash(basePlan.planHash)}`));
      const grid = node("div", "exp-incident-form");
      append(grid,
        selectField(copy().incidentType, "type", Incidents.INCIDENT_TYPES.map((type) => ({ value: type, label: labels()[type] || type })), state.form.type),
        selectField(copy().target, "targetId", targetsForType(state.form.type), state.form.targetId),
        inputField(copy().logicalMinute, "logicalMinute", state.form.logicalMinute, "number", { min: 0, step: 1 })
      );
      if (["STOP_DELAY", "DEPOT_DELAY", "ROAD_CLOSURE_SIMULATION"].includes(state.form.type)) grid.appendChild(inputField(copy().delayMinutes, "delayMinutes", state.form.delayMinutes, "number", { min: 1, step: 1 }));
      if (["TIME_WINDOW_CHANGED", "EMERGENCY_ORDER"].includes(state.form.type)) {
        grid.appendChild(inputField(copy().windowStart, "twStart", state.form.twStart, "time"));
        grid.appendChild(inputField(copy().windowEnd, "twEnd", state.form.twEnd, "time"));
      }
      if (state.form.type === "ROAD_CLOSURE_SIMULATION") grid.appendChild(inputField(copy().multiplier, "multiplier", state.form.multiplier, "number", { min: 1, max: 3, step: .1 }));
      if (state.form.type === "EMERGENCY_ORDER") {
        grid.appendChild(inputField(copy().emergencyId, "emergencyId", state.form.emergencyId));
        grid.appendChild(inputField(copy().volume, "volume", state.form.volume, "number", { min: .01, step: .01 }));
        grid.appendChild(inputField(copy().serviceMinutes, "serviceMinutes", state.form.serviceMinutes, "number", { min: 1, step: 1 }));
      }
      const actions = node("div", "exp-incident-actions");
      const inject = button(copy().inject, "inject", "primary"); inject.disabled = Boolean(state.incidentSnapshot);
      const clearIncident = button(copy().clear, "clear"); clearIncident.disabled = !state.incidentSnapshot || state.applied;
      append(actions, inject, clearIncident);
      append(section, title, grid, actions);
      if (state.form.type === "ROAD_CLOSURE_SIMULATION") section.appendChild(node("p", "exp-incident-boundary warn", copy().simulationOnly));
      return section;
    }

    function blastSection() {
      if (!state.blastRadius || !state.pinning) return null;
      const blast = state.blastRadius; const pinning = state.pinning;
      const section = node("section", "exp-incident-section exp-incident-blast");
      const title = node("div", "exp-incident-section-title"); append(title, node("strong", "", copy().impact), node("small", "", shortHash(blast.blastRadiusHash)));
      const metrics = node("div", "exp-incident-metrics");
      append(metrics,
        metricCard(copy().affectedRoutes, blast.affectedRouteIds.length, "DETERMINISTIC"),
        metricCard(copy().affectedVehicles, blast.affectedVehicleIds.length, "DETERMINISTIC"),
        metricCard(copy().affectedOrders, blast.affectedOrderIds.length, "DETERMINISTIC"),
        metricCard(copy().lateRisk, blast.lateRiskOrderIds.length, "PROJECTED"),
        metricCard(copy().missedWindow, blast.missedWindowOrderIds.length, "PROJECTED"),
        metricCard(copy().repairSet, blast.repairSetOrderIds.length + blast.insertionSetOrderIds.length, "HEURISTIC")
      );
      const pin = node("div", "exp-incident-pinning");
      append(pin, node("strong", "", copy().pinning), node("span", "", `${copy().completed} ${pinning.completedStopIds.length}`), node("span", "", `${copy().active} ${pinning.activeServiceStopIds.length}`), node("span", "", `${copy().locked} ${pinning.lockedOrderIds.length}`));
      const actions = node("div", "exp-incident-actions"); const generate = button(copy().generate, "generate", "primary"); generate.disabled = state.phase === "GENERATING" || Boolean(state.recoveryResult); actions.appendChild(generate);
      append(section, title, metrics, pin, node("p", "exp-incident-boundary", copy().noWebgl), actions);
      return section;
    }

    function candidateCard(candidate) {
      const selected = candidate.planHash === state.selectedPlanHash;
      const card = node("button", `exp-incident-candidate ${selected ? "selected" : ""} ${candidate.verification.status === "PASS" ? "pass" : "fail"}`.trim());
      card.type = "button"; card.dataset.incidentCandidate = candidate.planHash; card.dataset.applyAllowed = String(candidate.applyAllowed === true);
      const head = node("div", "exp-incident-candidate-head");
      const title = node("div"); append(title, node("strong", "", candidate.labels?.join(" / ") || candidate.objective), node("small", "", `${candidate.objective} · ${candidate.meta?.method}`));
      append(head, title, node("span", candidate.verification.status === "PASS" ? "pass" : "fail", candidate.verification.status));
      const values = node("div", "exp-incident-candidate-grid"); const metrics = candidate.verification.recomputedMetrics || candidate.metrics || {}; const penalty = candidate.changePenalty || {};
      [
        [copy().service, `${number(metrics.serviceRate).toFixed(1)}%`], [copy().delay, timeText(metrics.latestEndMinutes)],
        [copy().changes, number(penalty.movedOrders) + number(penalty.resequencedStops)], [copy().cost, number(metrics.totalCost).toFixed(0)],
        [copy().co2, number(metrics.totalCO2).toFixed(1)], [copy().vehicles, number(metrics.usedVehicles)],
      ].forEach(([label, value]) => { const item = node("span"); append(item, node("small", "", label), node("b", "", value)); values.appendChild(item); });
      const provenance = node("div", "exp-incident-provenance");
      append(provenance, node("span", "", `${copy().engine}: ${text(candidate.meta?.engine?.id || "LOCAL_RECOVERY_V15")}`), node("span", "", `${copy().matrix}: ${text(candidate.meta?.matrixProvider?.id || "HAVERSINE_FALLBACK")}`));
      append(card, head, values, provenance); return card;
    }

    function recoverySection() {
      if (!state.recoveryResult) return null;
      const section = node("section", "exp-incident-section exp-incident-recovery");
      const title = node("div", "exp-incident-section-title"); append(title, node("strong", "", copy().compare), node("small", "", `${state.recoveryResult.candidates.length} ${copy().candidate}`));
      const cards = node("div", "exp-incident-candidates"); state.recoveryResult.candidates.forEach((candidate) => cards.appendChild(candidateCard(candidate)));
      const reference = state.recoveryResult.references?.[0];
      if (reference) { const item = node("div", "exp-incident-reference"); append(item, node("strong", "", copy().reference), node("span", "", "REFERENCE_NOT_VERIFIED"), node("small", "", shortHash(reference.planHash))); cards.appendChild(item); }
      const selected = state.recoveryResult.candidates.find((candidate) => candidate.planHash === state.selectedPlanHash);
      const controls = node("div", "exp-incident-control");
      const note = node("p", "", selected ? `${copy().preview}: ${selected.objective} · ${shortHash(selected.planHash)}` : copy().selectCandidate);
      const actions = node("div", "exp-incident-actions");
      const apply = button(copy().apply, "apply", "primary"); apply.disabled = !selected?.applyAllowed || state.applied;
      const undo = button(copy().undo, "undo"); undo.disabled = !state.applied;
      const restore = button(copy().restore, "restore");
      const exportButton = button(copy().export, "export");
      append(actions, apply, undo, restore, exportButton); append(controls, note, node("small", "", copy().passOnly), actions);
      append(section, title, cards, node("p", "exp-incident-boundary", copy().localBoundary), controls); return section;
    }

    function render() {
      if (state.destroyed) return;
      clear(body); append(body, composer(), blastSection(), recoverySection());
      if (state.error) body.prepend(node("div", "exp-incident-error", `${copy().error}: ${state.error}`));
      setStep(state.recoveryResult ? 4 : state.blastRadius ? 2 : 1);
      shell.classList.toggle("reduced-motion", Boolean(options.reducedMotion));
      shell.dataset.phase = state.phase; shell.dataset.applied = String(state.applied); shell.dataset.listenerCount = String(state.listenerCount);
    }

    function preview(candidate = null) {
      const incident = state.incidentSnapshot?.incidents?.at(-1) || null;
      options.previewMap?.({ basePlan, recoveryPlan: candidate, blastRadius: state.blastRadius, incident, reducedMotion: Boolean(options.reducedMotion) });
    }

    function open() {
      if (state.destroyed || state.open) return;
      returnFocus = root.document.activeElement;
      state.open = true; state.openCount += 1; state.form.logicalMinute = Math.round(number(options.getLogicalMinute?.(), state.form.logicalMinute));
      shell.hidden = false; options.host.closest(".exp-replay")?.classList.add("incident-open"); options.host.closest(".exp-app")?.classList.add("exp-incident-active");
      options.pauseReplay?.(); launcher?.setAttribute("aria-expanded", "true");
      if (state.blastRadius) preview(state.recoveryResult?.candidates?.find((candidate) => candidate.planHash === state.selectedPlanHash) || null);
      render();
      root.requestAnimationFrame?.(() => closeButton.focus());
    }

    function close() {
      if (!state.open) return;
      if (state.applied) { setStatus(copy().mustUndo, "error"); return; }
      state.open = false; state.closeCount += 1; shell.hidden = true; options.host.closest(".exp-replay")?.classList.remove("incident-open"); options.host.closest(".exp-app")?.classList.remove("exp-incident-active");
      launcher?.setAttribute("aria-expanded", "false"); options.restoreMap?.();
      (returnFocus?.isConnected ? returnFocus : launcher)?.focus?.();
    }

    async function inject() {
      state.error = "";
      try {
        const snapshot = incidentController.inject(specification()); const incident = snapshot.incidents.at(-1);
        const pinning = Impact.createPinningSnapshot(basePlan, incident.logicalMinute);
        const blastRadius = Impact.computeBlastRadius({ basePlan, baseScenario, derivedScenario: snapshot.derivedScenario, incidents: snapshot.incidents, pinning });
        recoveryController?.destroy?.();
        recoveryController = Recovery.createRecoveryController({
          basePlan, baseScenario, derivedScenario: snapshot.derivedScenario, pinning, simulationStore: options.experience.simulationStore, eventStore: options.experience.eventStore,
          getSelection: () => ({ vehicleId: options.experience.state.selectedVehicleId, orderId: options.experience.state.selectedOrderId, planHash: options.experience.state.activePlanHash }),
          setSelection: (selection) => { if (selection.vehicleId) options.experience.selectVehicle?.(selection.vehicleId); if (selection.orderId) options.experience.selectOrder?.(selection.orderId, "incident-recovery"); },
        });
        state.incidentSnapshot = snapshot; state.pinning = pinning; state.blastRadius = blastRadius; state.recoveryResult = null; state.selectedPlanHash = ""; state.phase = "INJECTED";
        setStatus(copy().injected, "warn"); preview(); render();
      } catch (error) { state.error = text(error.code || error.message); setStatus(state.error, "error"); render(); }
    }

    function clearIncident() {
      if (state.applied) { setStatus(copy().mustUndo, "error"); return; }
      try { incidentController.clear(); } catch (error) { state.error = text(error.code || error.message); }
      recoveryController?.destroy?.(); recoveryController = null; state.incidentSnapshot = null; state.pinning = null; state.blastRadius = null; state.recoveryResult = null; state.selectedPlanHash = ""; state.phase = "READY"; state.error = "";
      setStatus(copy().ready); options.restoreMap?.(); render();
    }

    async function generate() {
      if (!recoveryController || !state.incidentSnapshot) return;
      state.phase = "GENERATING"; state.error = ""; setStatus(copy().generating, "busy"); render();
      try {
        const result = await recoveryController.generate({
          derivedScenario: state.incidentSnapshot.derivedScenario, incidents: state.incidentSnapshot.incidents, pinning: state.pinning, blastRadius: state.blastRadius,
          objectives: Recovery.OBJECTIVES, engine: { id: "LOCAL_RECOVERY_V15", version: "1.5", scope: "BLAST_RADIUS" },
          matrixProvider: { id: "HAVERSINE_FALLBACK", version: "1.5", approximation: true, roadNetwork: false }, solveOptions: { fullReoptimization: false, postVerifyPinning: true },
        });
        if (result.status !== "PASS") throw Object.assign(new Error(result.status), { code: result.status });
        state.recoveryResult = result; state.selectedPlanHash = result.candidates.find((candidate) => candidate.applyAllowed)?.planHash || result.candidates[0]?.planHash || ""; state.phase = "COMPARED";
        const selected = result.candidates.find((candidate) => candidate.planHash === state.selectedPlanHash); setStatus(selected ? `${copy().candidate} · ${selected.verification.status}` : copy().noCandidate, selected?.applyAllowed ? "pass" : "error"); preview(selected); render();
      } catch (error) { state.phase = "INJECTED"; state.error = text(error.code || error.message); setStatus(state.error, "error"); render(); }
    }

    async function applySelected() {
      const candidate = state.recoveryResult?.candidates?.find((row) => row.planHash === state.selectedPlanHash);
      if (!candidate?.applyAllowed || !recoveryController) { setStatus(copy().noCandidate, "error"); return; }
      try {
        const result = await recoveryController.apply(candidate, { simulationPolicy: "RESET" }); state.applied = true; state.phase = "APPLIED"; setStatus(copy().applied, "pass"); preview(candidate); options.onApplied?.(result, state.incidentSnapshot.derivedScenario); render();
      } catch (error) { state.error = text(error.code || error.message); setStatus(state.error, "error"); render(); }
    }

    async function undo() {
      if (!state.applied || !recoveryController) return;
      try { const result = await recoveryController.undo(); state.applied = false; state.phase = "UNDONE"; setStatus(copy().undone, "pass"); options.onUndone?.(result, baseScenario); preview(); render(); }
      catch (error) { state.error = text(error.code || error.message); setStatus(state.error, "error"); render(); }
    }

    async function restore() {
      try { if (state.applied) await undo(); await recoveryController?.restoreBaseline?.(); clearIncident(); setStatus(copy().ready, "pass"); }
      catch (error) { state.error = text(error.code || error.message); setStatus(state.error, "error"); render(); }
    }

    function exportAudit() {
      if (!recoveryController) return;
      const audit = recoveryController.exportAudit(); options.download?.("stct-recovery-audit-v1.5.json", `${JSON.stringify(audit, null, 2)}\n`); setStatus(copy().auditReady, "pass");
    }

    async function clickHandler(event) {
      const candidate = event.target.closest("[data-incident-candidate]");
      if (candidate) { state.selectedPlanHash = candidate.dataset.incidentCandidate; const selected = state.recoveryResult?.candidates?.find((row) => row.planHash === state.selectedPlanHash); preview(selected); render(); return; }
      const action = event.target.closest("[data-incident-action]")?.dataset.incidentAction;
      if (!action) return;
      if (action === "close") close(); else if (action === "inject") await inject(); else if (action === "clear") clearIncident(); else if (action === "generate") await generate(); else if (action === "apply") await applySelected(); else if (action === "undo") await undo(); else if (action === "restore") await restore(); else if (action === "export") exportAudit();
    }

    function fieldHandler(event) {
      const field = event.target.dataset.incidentField; if (!field) return;
      state.form[field] = event.target.type === "number" ? number(event.target.value) : event.target.value;
      if (field === "type") { normalizeTarget(); render(); }
      else if (field === "emergencyId" && state.form.type === "EMERGENCY_ORDER") { state.form.targetId = state.form.emergencyId; }
    }

    function keyboardHandler(event) {
      if (!state.open) return;
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (event.key !== "Tab") return;
      const focusable = [...shell.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])")].filter((element) => !element.hidden && element.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && root.document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && root.document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    const launcherHandler = () => open();
    launcher?.addEventListener("click", launcherHandler); shell.addEventListener("click", clickHandler); shell.addEventListener("change", fieldHandler); shell.addEventListener("input", fieldHandler); shell.addEventListener("keydown", keyboardHandler);
    state.listenerCount = 5; launcher?.setAttribute("aria-expanded", "false"); launcher?.setAttribute("aria-controls", "expIncidentStudio"); shell.id = "expIncidentStudio"; render();

    state.cleanup = () => {
      if (state.destroyed) return;
      state.destroyed = true; launcher?.removeEventListener("click", launcherHandler); shell.removeEventListener("click", clickHandler); shell.removeEventListener("change", fieldHandler); shell.removeEventListener("input", fieldHandler); shell.removeEventListener("keydown", keyboardHandler);
      options.host.closest(".exp-replay")?.classList.remove("incident-open"); options.host.closest(".exp-app")?.classList.remove("exp-incident-active");
      const finalize = () => { recoveryController?.destroy?.(); incidentController.destroy(); shell.remove(); };
      if (state.applied) recoveryController?.undo?.().finally(finalize); else finalize();
      if (activeMount === state) activeMount = null;
    };
    state.openStudio = open; state.closeStudio = close; activeMount = state; return state.cleanup;
  }

  return {
    VERSION,
    mount,
    get state() {
      if (!activeMount) return null;
      return {
        open: activeMount.open, phase: activeMount.phase, applied: activeMount.applied, openCount: activeMount.openCount,
        closeCount: activeMount.closeCount, listenerCount: activeMount.listenerCount, selectedPlanHash: activeMount.selectedPlanHash,
        incidentHash: activeMount.incidentSnapshot?.incidents?.at(-1)?.incidentHash || "", blastRadiusHash: activeMount.blastRadius?.blastRadiusHash || "",
      };
    },
  };
});
