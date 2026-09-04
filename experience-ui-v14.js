(function () {
  "use strict";

  const Experience = window.STCTExperience;
  const Factory = window.STCTExperienceFactory;
  const Replay = window.STCTReplay;
  const Arena = window.STCTScenarioArena;
  const Timeline = window.STCTTimeline;
  const Director = window.STCTDemoDirector;
  if (!Experience || !Factory || !Replay || !Arena || !Timeline || !Director) {
    console.error("STCT v1.4 experience modules are incomplete.");
    return;
  }

  const COPY = {
    zh: {
      modes: { replay: "运行回放", arena: "方案对决", timeline: "调度时间轴", director: "演示导演" },
      subtitles: {
        replay: "基于已验证计划的确定性模拟回放",
        arena: "只比较 verifier PASS 的方案与重算指标",
        timeline: "计划时间、约束证据与人工调整共用同一事实",
        director: "七幕可控演示，不自动改变业务状态",
      },
      close: "关闭", back: "返回", verified: "验证通过", synthetic: "合成场景", noPlan: "尚无可进入演练的已验证计划", noPlanBody: "请先在路线或排车页面生成候选方案，并选择 Verifier PASS 的计划。Invalid plan 不会进入 Replay 或 Arena。", openPlanning: "打开排车页",
      boundary: "基于已验证计划的模拟回放", notGps: "非实时 GPS", activeVehicles: "活动车辆", completedStops: "完成停靠", onTimeStops: "准时停靠", atRiskStops: "风险停靠", delayedMinutes: "模拟延误", progress: "运行进度",
      inspector: "任务检查器", simulationTime: "模拟时间", currentDelay: "当前延误", previousStop: "上一站", nextStop: "下一站 / ETA", stopProgress: "完成停靠", slack: "窗口余量", remainingVolume: "剩余容积", onTimeRisk: "窗口状态", injectDelay: "注入模拟延误", delayBoundary: "模拟延误，不代表真实道路交通", undo: "撤销", reset: "重置", eventFeed: "事件流", all: "全部", exception: "异常", selectedVehicle: "当前车辆", speed: "速度", follow: "跟随车辆", pause: "暂停", play: "播放", restart: "重新开始",
      planA: "方案 A", planB: "方案 B", overlay: "叠加", split: "分屏", export: "导出", sameInput: "同一输入", scenarioChanged: "场景已变化", observedChanges: "已观察变化", noChanges: "没有分配变化", constraintEvidence: "约束证据", notProven: "未证明 / Unknown", mobileSide: "移动端显示",
      lenses: { "time-window": "时间窗", capacity: "容积", priority: "优先级", diagnostic: "诊断" }, currentTime: "当前时间", enterEdit: "进入编辑", exitEdit: "退出编辑", selectedRoute: "选中路线", capacityProfile: "容量曲线", preview: "预览", applyVerify: "应用并验证", targetRoute: "目标路线", insertion: "插入方式", anchor: "锚点停靠", lockRoute: "锁定路线", restoreSolver: "恢复求解器计划", manualReady: "选择配送点和目标位置后预览。", editRequired: "请先进入编辑模式。", transactionPass: "事务提交，Verifier PASS。", transactionRollback: "操作已回滚",
      sceneStory: "七幕演示路线", prerequisitesReady: "前置条件已就绪", previous: "上一幕", next: "下一幕", exitRestore: "退出并恢复状态", presentation: "演示模式", missing: "缺少前置条件", scene: "幕", outcome: "结果与边界", noWebgl: "地图不可用，已切换到等价表格/时间轴路径。", mapUnavailable: "地图上下文不可用", capacityNotice: "容量利用率，不代表装箱布局",
      events: { DEPARTED: "车辆出库", ARRIVED: "到达配送点", SERVICE_STARTED: "开始服务", SERVICE_COMPLETED: "服务完成", SIMULATED_DELAY: "模拟延误", COMPLETED: "返回仓库" },
    },
    ja: {
      modes: { replay: "運行リプレイ", arena: "シナリオ比較", timeline: "配車タイムライン", director: "デモディレクター" },
      subtitles: { replay: "検証済み計画に基づく決定論的シミュレーション", arena: "Verifier PASS の計画と再計算指標のみ比較", timeline: "計画時刻・制約根拠・手動変更は同じ事実を使用", director: "業務状態を自動変更しない7シーンのデモ" },
      close: "閉じる", back: "戻る", verified: "検証済み", synthetic: "合成シナリオ", noPlan: "検証済み計画がありません", noPlanBody: "ルートまたは配車画面で候補を生成し、Verifier PASS の計画を選択してください。Invalid plan は Replay / Arena に入りません。", openPlanning: "配車画面を開く",
      boundary: "検証済み計画に基づくシミュレーション", notGps: "リアルタイムGPSではありません", activeVehicles: "稼働車両", completedStops: "完了停車", onTimeStops: "定時停車", atRiskStops: "リスク停車", delayedMinutes: "模擬遅延", progress: "進捗",
      inspector: "ミッションインスペクター", simulationTime: "シミュレーション時刻", currentDelay: "現在の遅延", previousStop: "前の停車", nextStop: "次の停車 / ETA", stopProgress: "停車進捗", slack: "時間枠余裕", remainingVolume: "残容量", onTimeRisk: "時間枠状態", injectDelay: "模擬遅延を追加", delayBoundary: "模擬遅延であり、実道路交通ではありません", undo: "元に戻す", reset: "リセット", eventFeed: "イベントフィード", all: "すべて", exception: "例外", selectedVehicle: "選択車両", speed: "速度", follow: "車両追従", pause: "一時停止", play: "再生", restart: "再開",
      planA: "プラン A", planB: "プラン B", overlay: "オーバーレイ", split: "分割", export: "書き出し", sameInput: "同一入力", scenarioChanged: "シナリオ変更", observedChanges: "観測された変更", noChanges: "割当変更なし", constraintEvidence: "制約根拠", notProven: "未証明 / Unknown", mobileSide: "モバイル表示",
      lenses: { "time-window": "時間枠", capacity: "容量", priority: "優先度", diagnostic: "診断" }, currentTime: "現在時刻", enterEdit: "編集開始", exitEdit: "編集終了", selectedRoute: "選択ルート", capacityProfile: "容量プロファイル", preview: "プレビュー", applyVerify: "適用・検証", targetRoute: "対象ルート", insertion: "挿入方法", anchor: "基準停車", lockRoute: "ルート固定", restoreSolver: "Solver計画へ戻す", manualReady: "停車と挿入位置を選択してプレビューします。", editRequired: "先に編集モードへ入ってください。", transactionPass: "トランザクション確定、Verifier PASS。", transactionRollback: "操作をロールバックしました",
      sceneStory: "7シーンのストーリー", prerequisitesReady: "前提条件準備完了", previous: "前へ", next: "次へ", exitRestore: "終了して状態復元", presentation: "プレゼンテーション", missing: "前提条件不足", scene: "シーン", outcome: "結果と境界", noWebgl: "地図を使用できないため、同等の表/タイムラインを表示します。", mapUnavailable: "地図コンテキストなし", capacityNotice: "容量利用率であり、積付け配置ではありません",
      events: { DEPARTED: "出庫", ARRIVED: "配送先到着", SERVICE_STARTED: "サービス開始", SERVICE_COMPLETED: "サービス完了", SIMULATED_DELAY: "模擬遅延", COMPLETED: "拠点帰着" },
    },
    en: {
      modes: { replay: "Mission Control Replay", arena: "Scenario Arena", timeline: "Dispatch Timeline", director: "Demo Director" },
      subtitles: { replay: "Deterministic simulation based on a verified plan", arena: "Compare verifier-PASS plans and recomputed metrics only", timeline: "Schedule, constraint evidence, and manual edits share one source of truth", director: "A seven-scene guided demo with no automatic business decisions" },
      close: "Close", back: "Back", verified: "Verified", synthetic: "Synthetic scenario", noPlan: "No verified plan is ready for Mission Control", noPlanBody: "Generate candidates in Routes or Planning and select a Verifier-PASS plan. Invalid plans cannot enter Replay or Arena.", openPlanning: "Open Planning",
      boundary: "Simulation based on verified plan", notGps: "Not real-time GPS", activeVehicles: "Active vehicles", completedStops: "Completed stops", onTimeStops: "On-time stops", atRiskStops: "At-risk stops", delayedMinutes: "Simulated delay", progress: "Progress",
      inspector: "Mission Inspector", simulationTime: "Simulation time", currentDelay: "Current delay", previousStop: "Previous stop", nextStop: "Next stop / ETA", stopProgress: "Stop progress", slack: "Window slack", remainingVolume: "Remaining volume", onTimeRisk: "Window status", injectDelay: "Inject Delay", delayBoundary: "Simulated delay, not real road traffic", undo: "Undo", reset: "Reset", eventFeed: "Event Feed", all: "All", exception: "Exceptions", selectedVehicle: "Selected vehicle", speed: "Speed", follow: "Follow vehicle", pause: "Pause", play: "Play", restart: "Restart",
      planA: "Plan A", planB: "Plan B", overlay: "Overlay", split: "Split", export: "Export", sameInput: "Same input", scenarioChanged: "Scenario changed", observedChanges: "Observed changes", noChanges: "No assignment changes", constraintEvidence: "Constraint evidence", notProven: "Not proven / Unknown", mobileSide: "Mobile side",
      lenses: { "time-window": "Time Window", capacity: "Capacity", priority: "Priority", diagnostic: "Diagnostic" }, currentTime: "Current time", enterEdit: "Enter Edit", exitEdit: "Exit Edit", selectedRoute: "Selected route", capacityProfile: "Capacity Profile", preview: "Preview", applyVerify: "Apply + Verify", targetRoute: "Target route", insertion: "Insertion", anchor: "Anchor stop", lockRoute: "Lock route", restoreSolver: "Restore Solver Plan", manualReady: "Select a stop and insertion position, then preview.", editRequired: "Enter Edit Mode first.", transactionPass: "Transaction committed. Verifier PASS.", transactionRollback: "Action rolled back",
      sceneStory: "Seven-scene story", prerequisitesReady: "Prerequisites ready", previous: "Previous", next: "Next", exitRestore: "Exit and restore state", presentation: "Presentation mode", missing: "Missing prerequisite", scene: "Scene", outcome: "Outcome and limits", noWebgl: "Map unavailable. Equivalent table/timeline path is active.", mapUnavailable: "Map context unavailable", capacityNotice: "Capacity utilization, not packing layout",
      events: { DEPARTED: "Vehicle departed", ARRIVED: "Arrived at stop", SERVICE_STARTED: "Service started", SERVICE_COMPLETED: "Service completed", SIMULATED_DELAY: "Simulated delay", COMPLETED: "Returned to depot" },
    },
  };

  const MODE_ENGLISH = { replay: "Mission Control Replay", arena: "Scenario Arena", timeline: "Dispatch Timeline + Constraint X-Ray", director: "Demo Director" };
  const MODE_ICONS = { replay: "▶", arena: "⇄", timeline: "▤", director: "◇" };
  const ui = {
    installed: false,
    mode: "replay",
    previousView: "mapView",
    activePlan: null,
    scenario: null,
    replay: null,
    replayFrameMinute: null,
    arena: null,
    timeline: null,
    director: null,
    directorReturnMode: "replay",
    directorInterval: 0,
    raf: 0,
    lastRaf: 0,
    lastPaint: 0,
    delayRouteId: "",
    delayOrderId: "",
    planningSyncToken: 0,
    performanceCounters: {
      startedAt: performance.now(),
      browserRafCallbacks: 0,
      updateReplayView: 0,
      mapAdapterUpdateReplay: 0,
      geoJsonSetData: 0,
      visibleCursorUpdates: 0,
      eventFeedRender: 0,
      droppedApplicationFrames: 0,
      lastCursorText: "",
    },
  };

  function resetPerformanceCounters() {
    Object.assign(ui.performanceCounters, {
      startedAt: performance.now(),
      browserRafCallbacks: 0,
      updateReplayView: 0,
      mapAdapterUpdateReplay: 0,
      geoJsonSetData: 0,
      visibleCursorUpdates: 0,
      eventFeedRender: 0,
      droppedApplicationFrames: 0,
      lastCursorText: document.getElementById("expReplayTime")?.textContent || "",
    });
    ui.lastPaint = performance.now();
  }

  function performanceSnapshot() {
    const durationMs = Math.max(1, performance.now() - ui.performanceCounters.startedAt);
    const counts = { ...ui.performanceCounters };
    delete counts.startedAt;
    delete counts.lastCursorText;
    return {
      durationMs,
      counts,
      lod: {
        mode: mapAdapter.replayLodMode,
        stopCount: ui.replay?.model?.schedules?.reduce((sum, route) => sum + route.stops.length, 0) || 0,
      },
      rates: Object.fromEntries(Object.entries(counts).map(([key, value]) => [`${key}PerSecond`, Number((value / (durationMs / 1000)).toFixed(3))])),
      semantics: {
        browserRafCallbacks: "Replay scheduler requestAnimationFrame callbacks",
        updateReplayView: "Application Replay render/update calls",
        mapAdapterUpdateReplay: "Map adapter Replay update calls",
        geoJsonSetData: "Successful Replay GeoJSON source setData calls",
        visibleCursorUpdates: "Distinct visible Replay cursor text values",
        eventFeedRender: "Replay event feed render calls",
        droppedApplicationFrames: "Application update slots missed against the active stop-count target",
      },
    };
  }

  function language() {
    const value = window.STCTCore?.getLanguage?.() || document.documentElement.lang || "zh";
    return String(value).startsWith("ja") ? "ja" : String(value).startsWith("en") ? "en" : "zh";
  }

  function c() {
    return COPY[language()] || COPY.en;
  }

  function esc(value) {
    if (window.STCTUtils?.escapeHTML) return window.STCTUtils.escapeHTML(value);
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  }

  function num(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function fmt(value, digits = 0) {
    return num(value).toLocaleString(language() === "zh" ? "zh-CN" : language() === "ja" ? "ja-JP" : "en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function shortHash(value) {
    const source = String(value || "");
    if (!source) return "-";
    const body = source.includes(":") ? source.split(":").at(-1) : source;
    return body.length > 13 ? `${body.slice(0, 7)}…${body.slice(-5)}` : body;
  }

  function activeViewId() {
    return document.querySelector(".view.active")?.id || "mapView";
  }

  function isVerified(plan, scenario) {
    return Factory.verifyPlanShape(plan, scenario).status === "PASS";
  }

  function planningContext() {
    const state = window.STCTPlanning?.state || {};
    const scenario = state.scenario || null;
    const manual = state.manual?.active ? state.manual.plan : null;
    const current = manual || window.STCTPlanning?.currentCandidate?.() || null;
    const plans = [];
    const scenarios = [];
    const add = (plan, planScenario, label) => {
      if (!plan || !planScenario || !isVerified(plan, planScenario) || plans.some((entry) => entry.plan.planHash === plan.planHash)) return;
      plans.push({ plan, scenario: planScenario, label });
      if (!scenarios.some((entry) => entry.inputHash === planScenario.inputHash)) scenarios.push(planScenario);
    };
    add(state.baseline?.plan, state.baseline?.scenario, "Baseline");
    (state.candidates || []).forEach((plan) => add(plan, scenario, (plan.labels || []).join(" · ") || plan.meta?.goalLabel || plan.planId));
    add(manual, scenario, `Manual r${manual?.manualRevision || 0}`);
    (state.whatIfResults || []).forEach((result) => add(result.selectedPlan, result.scenario, `What-if ${result.label || result.id}`));
    if (current && !plans.some((entry) => entry.plan.planHash === current.planHash)) add(current, scenario, "Selected");
    return { state, scenario, plan: current, plans, scenarios, baseline: state.baseline || null, whatIfResults: state.whatIfResults || [], manual };
  }

  function planLabel(entry) {
    return `${entry.label || entry.plan.planId} · ${entry.plan.meta?.engine || entry.plan.meta?.source || "Verified"} · ${shortHash(entry.plan.planHash)}`;
  }

  function notify(message, type = "info") {
    const root = document.getElementById("experienceRoot");
    if (!root) return;
    root.querySelector(".exp-toast")?.remove();
    const toast = document.createElement("div");
    toast.className = `exp-toast ${type === "error" ? "error" : ""}`;
    toast.textContent = message;
    root.appendChild(toast);
    window.setTimeout(() => toast.remove(), 4200);
  }

  function downloadText(filename, content, type = "application/json;charset=utf-8") {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function modeHeader(mode) {
    const copy = c();
    const scenario = ui.scenario || Experience.state?.verifiedPlan && { scenarioId: Experience.state.scenarioId, inputHash: Experience.state.inputHash };
    const plan = ui.activePlan || Experience.state?.verifiedPlan;
    return `<header class="exp-header"><div class="exp-title"><h2>${esc(copy.modes[mode])}${language() === "zh" ? ` <span>/ ${esc(MODE_ENGLISH[mode])}</span>` : ""}</h2><p>${esc(copy.subtitles[mode])}</p></div><div class="exp-trust"><span class="exp-chip ok"><i class="exp-status-dot"></i>${esc(copy.verified)} PASS</span><span class="exp-chip">${esc(plan?.meta?.engine || plan?.meta?.source || "Verifier")}</span><span class="exp-chip">${esc(copy.synthetic)}</span><span class="exp-chip exp-mono">plan ${esc(shortHash(plan?.planHash))}</span><span class="exp-chip exp-mono">input ${esc(shortHash(scenario?.inputHash))}</span></div></header>`;
  }

  function tabs(mode) {
    const copy = c();
    return `<nav class="exp-tabs" aria-label="Mission Control">${Factory.MODES.map((id) => `<button class="exp-tab ${id === mode ? "active" : ""}" data-exp-mode="${id}"><i>${MODE_ICONS[id]}</i>${esc(copy.modes[id])}</button>`).join("")}<span class="exp-tab-spacer"></span><button class="exp-tab exp-close" data-exp-close title="${esc(copy.close)}" aria-label="${esc(copy.close)}">×</button></nav>`;
  }

  function renderShell(mode) {
    const root = document.getElementById("experienceRoot");
    if (!root) return null;
    root.innerHTML = `<div class="exp-app">${modeHeader(mode)}${tabs(mode)}<div class="exp-content" id="expContent"></div></div>`;
    root.querySelectorAll("[data-exp-mode]").forEach((button) => button.addEventListener("click", () => switchMode(button.dataset.expMode)));
    root.querySelector("[data-exp-close]")?.addEventListener("click", closeExperience);
    return root.querySelector("#expContent");
  }

  function renderPrerequisite(error) {
    const content = renderShell(ui.mode);
    const copy = c();
    if (!content) return;
    content.innerHTML = `<div class="exp-empty"><div class="exp-empty-inner"><h3>${esc(copy.noPlan)}</h3><p>${esc(copy.noPlanBody)}</p><p class="exp-mono">${esc(error?.code || error?.message || "MISSING_VERIFIED_PLAN")}</p><button class="exp-btn primary" id="expOpenPlanning">${esc(copy.openPlanning)}</button></div></div>`;
    document.getElementById("expOpenPlanning")?.addEventListener("click", () => {
      closeExperience({ restore: false });
      window.STCTCore?.switchView?.("optimizerView");
    });
  }

  class ExperienceMapAdapter {
    constructor() {
      this.map = null;
      this.container = null;
      this.originalParent = null;
      this.originalNext = null;
      this.legacyVisibility = new Map();
      this.handlers = [];
      this.readyWaiters = [];
      this.splitMap = null;
      this.splitSync = null;
      this.splitHost = null;
      this.replayReady = false;
      this.lastStopMarkersVisible = null;
      this.lastFitKey = "";
      this.fitTimer = 0;
      this.incidentAnimationFrame = 0;
      this.incidentPulseFrames = 0;
      this.layerRegistry = null;
      this.layerRegistryMap = null;
      this.layerCleanupReport = null;
      this.serviceZoneState = null;
      this.replayLodMode = "FULL";
      this.lastReplayLodMinute = null;
      this.replayStaticCache = null;
    }

    available() {
      this.map = window.STCTCore?.getMap?.() || null;
      this.container = document.getElementById("map");
      if (this.map && this.layerRegistryMap !== this.map && window.STCTV15?.mapLayers?.createDefaultRegistry) {
        this.layerRegistry?.unmountAll?.({ reason: "map-instance-changed" });
        this.layerRegistry = window.STCTV15.mapLayers.createDefaultRegistry({ map: this.map });
        this.layerRegistryMap = this.map;
      }
      return Boolean(this.map && this.container);
    }

    attach(host) {
      if (!host || !this.available()) return false;
      if (!this.originalParent) {
        this.originalParent = this.container.parentNode;
        this.originalNext = this.container.nextSibling;
      }
      host.appendChild(this.container);
      this.hideLegacyLayers();
      window.setTimeout(() => {
        this.map?.resize?.();
        this.map?.triggerRepaint?.();
      }, 30);
      return true;
    }

    styleReady(map = this.map) {
      return Boolean(map?.isStyleLoaded?.() || map?.loaded?.());
    }

    whenReady(callback, map = this.map) {
      if (!map) return;
      if (this.styleReady(map)) {
        if (map === this.map) this.hideLegacyLayers();
        callback();
        return;
      }
      const waiter = { map, active: true, timer: 0, check: null };
      const finish = () => {
        if (!waiter.active || !this.styleReady(map)) return;
        waiter.active = false;
        window.clearInterval(waiter.timer);
        map.off?.("styledata", waiter.check);
        map.off?.("load", waiter.check);
        this.readyWaiters = this.readyWaiters.filter((entry) => entry !== waiter);
        if (map === this.map) this.hideLegacyLayers();
        callback();
      };
      waiter.check = finish;
      map.on?.("styledata", finish);
      map.on?.("load", finish);
      waiter.timer = window.setInterval(finish, 50);
      this.readyWaiters.push(waiter);
      finish();
    }

    clearReadyWaiters() {
      this.readyWaiters.forEach((waiter) => {
        waiter.active = false;
        window.clearInterval(waiter.timer);
        waiter.map?.off?.("styledata", waiter.check);
        waiter.map?.off?.("load", waiter.check);
      });
      this.readyWaiters = [];
    }

    hideLegacyLayers() {
      if (!this.map?.getStyle) return;
      const style = this.map.getStyle();
      if (!style?.layers) return;
      const legacyIds = new Set(["route-lines", "route-glow", "route-arrows", "road-route-lines", "road-route-casing", "road-route-arrows", "route-labels", "segment-distance-labels", "stop-points", "stop-labels", "depot-point", "depot-halo", "depot-label", "esg-backdrop", "esg-route-heat", "esg-stop-heat", "clusters", "cluster-count", "order-heat", "warehouse-coverage-fill", "warehouse-coverage-line", "exception-orders"]);
      style.layers.forEach((layer) => {
        if (!legacyIds.has(layer.id) || this.legacyVisibility.has(layer.id)) return;
        const visibility = this.map.getLayoutProperty?.(layer.id, "visibility") || "visible";
        this.legacyVisibility.set(layer.id, visibility);
        try { this.map.setLayoutProperty(layer.id, "visibility", "none"); } catch (error) {}
      });
    }

    restoreLegacyLayers() {
      this.legacyVisibility.forEach((visibility, id) => {
        if (this.map?.getLayer?.(id)) {
          try { this.map.setLayoutProperty(id, "visibility", visibility); } catch (error) {}
        }
      });
      this.legacyVisibility.clear();
    }

    clearHandlers() {
      this.handlers.forEach(({ map, event, layer, handler }) => {
        try { layer ? map.off(event, layer, handler) : map.off(event, handler); } catch (error) {}
      });
      this.handlers = [];
    }

    bind(event, layer, handler, map = this.map) {
      if (!map?.on) return;
      map.on(event, layer, handler);
      this.handlers.push({ map, event, layer, handler });
    }

    destroySplit() {
      this.splitSync?.destroy?.();
      this.splitSync = null;
      if (this.splitMap) {
        try { this.splitMap.remove(); } catch (error) {}
      }
      this.splitMap = null;
      this.splitHost = null;
    }

    clear() {
      this.clearReadyWaiters();
      this.clearHandlers();
      window.clearTimeout(this.fitTimer);
      this.fitTimer = 0;
      window.cancelAnimationFrame(this.incidentAnimationFrame);
      this.incidentAnimationFrame = 0;
      this.incidentPulseFrames = 0;
      this.layerCleanupReport = this.layerRegistry?.unmountAll?.({ reason: "experience-map-clear" }) || null;
      this.destroySplit();
      this.replayReady = false;
      this.lastStopMarkersVisible = null;
      this.replayLodMode = "FULL";
      this.lastReplayLodMinute = null;
      this.lastFitKey = "";
      const style = this.map?.getStyle?.();
      if (!style) return;
      const layers = (style.layers || []).map((layer) => layer.id).filter((id) => id.startsWith("stct-v14-")).reverse();
      layers.forEach((id) => { try { if (this.map.getLayer(id)) this.map.removeLayer(id); } catch (error) {} });
      const sources = Object.keys(style.sources || {}).filter((id) => id.startsWith("stct-v14-"));
      sources.forEach((id) => { try { if (this.map.getSource(id)) this.map.removeSource(id); } catch (error) {} });
    }

    detach() {
      this.clear();
      this.restoreLegacyLayers();
      if (this.container && this.originalParent && this.container.parentNode !== this.originalParent) {
        if (this.originalNext && this.originalNext.parentNode === this.originalParent) this.originalParent.insertBefore(this.container, this.originalNext);
        else this.originalParent.appendChild(this.container);
      }
      window.setTimeout(() => this.map?.resize?.(), 30);
    }

    addSource(id, data, map = this.map) {
      if (map.getSource(id)) map.getSource(id).setData(data);
      else map.addSource(id, { type: "geojson", data });
    }

    addLayer(definition, map = this.map) {
      if (!map.getLayer(definition.id)) map.addLayer(definition);
    }

    fitCoordinates(coordinates, key, map = this.map, options = {}) {
      const rows = (coordinates || []).filter((coordinate) => Array.isArray(coordinate) && Number.isFinite(Number(coordinate[0])) && Number.isFinite(Number(coordinate[1])));
      if (!rows.length || !window.maplibregl?.LngLatBounds || this.lastFitKey === key) return;
      const bounds = rows.slice(1).reduce((result, coordinate) => result.extend(coordinate), new maplibregl.LngLatBounds(rows[0], rows[0]));
      const mobile = window.innerWidth <= 900;
      const padding = options.padding || (mobile ? { top: 76, right: 24, bottom: 80, left: 24 } : { top: 70, right: 70, bottom: 70, left: 70 });
      const fit = (attempt = 0) => {
        if (this.lastFitKey === key || !map?.getContainer?.().isConnected) return;
        map.resize?.();
        const rect = map.getContainer().getBoundingClientRect();
        const canvasRect = map.getCanvas?.().getBoundingClientRect();
        const horizontal = Number(padding.left || padding) + Number(padding.right || padding);
        const vertical = Number(padding.top || padding) + Number(padding.bottom || padding);
        const width = Math.min(rect.width, canvasRect?.width || 0);
        const height = Math.min(rect.height, canvasRect?.height || 0);
        if ((width <= horizontal + 20 || height <= vertical + 20) && attempt < 10) {
          this.fitTimer = window.setTimeout(() => fit(attempt + 1), 50);
          return;
        }
        if (width <= horizontal + 20 || height <= vertical + 20) return;
        map.fitBounds(bounds, { padding, duration: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? 0 : 360, maxZoom: 14 });
        map.triggerRepaint?.();
        this.lastFitKey = key;
        this.fitTimer = 0;
      };
      window.clearTimeout(this.fitTimer);
      this.fitTimer = window.setTimeout(() => fit(), 40);
    }

    planCoordinates(plan) {
      return (plan?.routeGeoJson?.features || []).flatMap((feature) => feature.geometry?.coordinates || []);
    }

    setupPlan(plan, key = "plan") {
      if (!this.map) return;
      this.clear();
      this.whenReady(() => {
        this.addSource("stct-v14-plan-routes", plan.routeGeoJson || { type: "FeatureCollection", features: [] });
        this.addSource("stct-v14-plan-stops", plan.stopGeoJson || { type: "FeatureCollection", features: [] });
        this.addLayer({ id: "stct-v14-plan-casing", type: "line", source: "stct-v14-plan-routes", paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": .9 } });
        this.addLayer({ id: "stct-v14-plan-lines", type: "line", source: "stct-v14-plan-routes", paint: { "line-color": ["coalesce", ["get", "color"], "#003b79"], "line-width": 4, "line-opacity": .9 } });
        this.addLayer({ id: "stct-v14-plan-stops-layer", type: "circle", source: "stct-v14-plan-stops", paint: { "circle-radius": 5, "circle-color": "#ffffff", "circle-stroke-width": 3, "circle-stroke-color": ["coalesce", ["get", "color"], "#003b79"] } });
        this.restoreServiceZones();
        this.fitCoordinates(this.planCoordinates(plan), `${key}:${plan.planHash}`);
      });
    }

    setupIncident(basePlan, recoveryPlan, impact, incident, options = {}) {
      if (!this.map) return;
      this.clear();
      this.whenReady(() => {
        const affectedRoutes = new Set((impact?.affectedRouteIds || []).map(String));
        const affectedVehicles = new Set((impact?.affectedVehicleIds || []).map(String));
        const baseFeatures = (basePlan?.routeGeoJson?.features || []).map((feature) => ({
          ...feature,
          properties: {
            ...(feature.properties || {}),
            affected: affectedRoutes.has(String(feature.properties?.routeId)) || affectedVehicles.has(String(feature.properties?.vehicleId)) ? 1 : 0,
          },
        }));
        const recoveryFeatures = (recoveryPlan?.routeGeoJson?.features || []).map((feature) => ({ ...feature, properties: { ...(feature.properties || {}), recovery: 1 } }));
        const incidentTarget = String(incident?.parameters?.orderId || incident?.parameters?.vehicleId || incident?.parameters?.routeId || incident?.affectedEntityIds?.[0] || "");
        const stopFeature = (basePlan?.stopGeoJson?.features || []).find((feature) => String(feature.properties?.orderId) === incidentTarget);
        const routeFeature = baseFeatures.find((feature) => String(feature.properties?.routeId) === incidentTarget || String(feature.properties?.vehicleId) === incidentTarget || feature.properties?.affected === 1);
        const emergency = incident?.parameters?.order;
        const coordinate = stopFeature?.geometry?.coordinates
          || (Number.isFinite(Number(emergency?.lon)) && Number.isFinite(Number(emergency?.lat)) ? [Number(emergency.lon), Number(emergency.lat)] : null)
          || routeFeature?.geometry?.coordinates?.[0]
          || baseFeatures[0]?.geometry?.coordinates?.[0]
          || null;
        const pointData = { type: "FeatureCollection", features: coordinate ? [{ type: "Feature", properties: { incidentType: incident?.type || "INCIDENT" }, geometry: { type: "Point", coordinates: coordinate } }] : [] };
        if (this.layerRegistry) {
          this.layerRegistry.mount("BLAST_RADIUS", {
            sources: [{ id: "stct-v15-incident-base", data: { type: "FeatureCollection", features: baseFeatures } }],
            layers: [
              { id: "stct-v15-incident-unaffected", type: "line", source: "stct-v15-incident-base", filter: ["==", ["get", "affected"], 0], paint: { "line-color": "#718096", "line-width": 3, "line-opacity": .22 } },
              { id: "stct-v15-incident-affected-casing", type: "line", source: "stct-v15-incident-base", filter: ["==", ["get", "affected"], 1], paint: { "line-color": "#ffffff", "line-width": 10, "line-opacity": .92 } },
              { id: "stct-v15-incident-affected", type: "line", source: "stct-v15-incident-base", filter: ["==", ["get", "affected"], 1], paint: { "line-color": "#e60012", "line-width": 6, "line-opacity": .92 } },
            ],
          });
          this.layerRegistry.mount("RECOVERY_MORPH", {
            sources: [{ id: "stct-v15-incident-recovery", data: { type: "FeatureCollection", features: recoveryFeatures } }],
            layers: [
              { id: "stct-v15-incident-recovery-casing", type: "line", source: "stct-v15-incident-recovery", paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": recoveryPlan ? .9 : 0 } },
              { id: "stct-v15-incident-recovery", type: "line", source: "stct-v15-incident-recovery", paint: { "line-color": "#0076a8", "line-width": 5, "line-opacity": recoveryPlan ? .96 : 0 } },
            ],
          });
          this.layerRegistry.mount("INCIDENT", {
            sources: [{ id: "stct-v15-incident-point", data: pointData }],
            layers: [
              { id: "stct-v15-incident-pulse", type: "circle", source: "stct-v15-incident-point", paint: { "circle-radius": 18, "circle-color": "#e60012", "circle-opacity": .18, "circle-stroke-width": 2, "circle-stroke-color": "#e60012", "circle-stroke-opacity": .88 } },
              { id: "stct-v15-incident-core", type: "circle", source: "stct-v15-incident-point", paint: { "circle-radius": 6, "circle-color": "#e60012", "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" } },
            ],
          });
          this.restoreServiceZones();
        }
        const affectedCoordinates = baseFeatures.filter((feature) => feature.properties?.affected === 1).flatMap((feature) => feature.geometry?.coordinates || []);
        const coordinates = [...affectedCoordinates, ...recoveryFeatures.flatMap((feature) => feature.geometry?.coordinates || []), ...(coordinate ? [coordinate] : [])];
        const mobile = window.innerWidth <= 900;
        const padding = mobile ? { top: 38, right: 26, bottom: 38, left: 26 } : { top: 70, right: Math.min(570, Math.max(360, window.innerWidth * .43)), bottom: 70, left: 70 };
        this.fitCoordinates(coordinates.length ? coordinates : this.planCoordinates(basePlan), `incident:${incident?.incidentHash || "none"}:${recoveryPlan?.planHash || "blast"}`, this.map, { padding });
        this.incidentPulseFrames = 0;
        if (options.reducedMotion || !pointData.features.length) return;
        const startedAt = performance.now();
        const animate = (timestamp) => {
          this.incidentAnimationFrame = 0;
          if (!this.map?.getLayer?.("stct-v15-incident-pulse")) return;
          const elapsed = timestamp - startedAt;
          const phase = elapsed / 420 * Math.PI * 2;
          try {
            this.map.setPaintProperty("stct-v15-incident-pulse", "circle-radius", 17 + (Math.sin(phase) + 1) * 6);
            this.map.setPaintProperty("stct-v15-incident-pulse", "circle-opacity", .1 + (Math.cos(phase) + 1) * .06);
            this.incidentPulseFrames += 1;
          } catch (error) { return; }
          if (elapsed < 1260) this.incidentAnimationFrame = window.requestAnimationFrame(animate);
        };
        this.incidentAnimationFrame = window.requestAnimationFrame(animate);
      });
    }

    mountServiceZones(zones, zoneType = "ALL") {
      if (!this.layerRegistry || !window.STCTV15?.serviceZones) return null;
      this.serviceZoneState = { zones, zoneType };
      return this.layerRegistry.mount("SERVICE_ZONE", window.STCTV15.serviceZones.mapLayerContext(zones, zoneType));
    }

    unmountServiceZones() {
      this.serviceZoneState = null;
      return this.layerRegistry?.unmount?.("SERVICE_ZONE", { reason: "service-zone-hidden" }) || null;
    }

    restoreServiceZones() {
      if (!this.serviceZoneState) return null;
      return this.layerRegistry?.mount?.("SERVICE_ZONE", window.STCTV15.serviceZones.mapLayerContext(this.serviceZoneState.zones, this.serviceZoneState.zoneType)) || null;
    }

    replayStaticData(model) {
      if (this.replayStaticCache?.planHash === model.planHash) return this.replayStaticCache.data;
      const future = [];
      model.schedules.forEach((schedule) => future.push({ type: "Feature", properties: { routeId: schedule.routeId, color: schedule.color }, geometry: { type: "LineString", coordinates: schedule.coordinates } }));
      const stops = {
        type: "FeatureCollection",
        features: model.schedules.flatMap((route) => route.stops.map((stop) => ({
          type: "Feature",
          properties: { routeId: route.routeId, vehicleId: route.vehicleId, orderId: stop.orderId, status: stop.missedWindow ? "MISSED" : stop.atRisk ? "AT_RISK" : "PLANNED" },
          geometry: { type: "Point", coordinates: stop.coordinate },
        }))),
      };
      const data = { future: { type: "FeatureCollection", features: future }, stops };
      this.replayStaticCache = { planHash: model.planHash, data };
      return data;
    }

    replayDynamicData(model, frame) {
      const features = [];
      model.schedules.forEach((schedule, index) => {
        const vehicle = frame.vehicles[index];
        if (!vehicle) return;
          const completedCoordinates = [schedule.depotCoordinate, ...schedule.stops.slice(0, vehicle.completedStops).map((stop) => stop.coordinate)];
          if (![Replay.VEHICLE_STATUS.NOT_STARTED, Replay.VEHICLE_STATUS.COMPLETED].includes(vehicle.status)) completedCoordinates.push(vehicle.coordinate);
          if (vehicle.status === Replay.VEHICLE_STATUS.COMPLETED) completedCoordinates.push(schedule.depotCoordinate);
          if (completedCoordinates.length > 1) features.push({ type: "Feature", properties: { kind: "completed", routeId: schedule.routeId, color: schedule.color }, geometry: { type: "LineString", coordinates: completedCoordinates } });
        if ([Replay.VEHICLE_STATUS.TRAVELING, Replay.VEHICLE_STATUS.SIMULATED_DELAY].includes(vehicle.status)) {
          const next = vehicle.nextStopId === "DEPOT" ? schedule.depotCoordinate : schedule.stops.find((stop) => stop.orderId === vehicle.nextStopId)?.coordinate;
          const from = vehicle.nextStopId === "DEPOT" ? schedule.stops.at(-1)?.coordinate : schedule.stops.find((stop) => stop.orderId === vehicle.nextStopId)?.fromCoordinate;
          if (from && next) features.push({ type: "Feature", properties: { kind: "active", routeId: schedule.routeId, status: vehicle.status }, geometry: { type: "LineString", coordinates: [from, next] } });
        }
        features.push({ type: "Feature", properties: { kind: "vehicle", vehicleId: vehicle.vehicleId, routeId: vehicle.routeId, status: vehicle.status, bearing: vehicle.bearing, selected: frame.selectedVehicle?.vehicleId === vehicle.vehicleId ? 1 : 0 }, geometry: { type: "Point", coordinates: vehicle.coordinate } });
        if (vehicle.status === Replay.VEHICLE_STATUS.SERVICING) features.push({ type: "Feature", properties: { kind: "servicing", vehicleId: vehicle.vehicleId, orderId: vehicle.nextStopId }, geometry: { type: "Point", coordinates: vehicle.coordinate } });
      });
      return { type: "FeatureCollection", features };
    }

    setupReplay(model, frame, onVehicle) {
      if (!this.map) return;
      this.clear();
      this.whenReady(() => {
        const staticData = this.replayStaticData(model);
        this.addSource("stct-v14-replay-future", staticData.future);
        this.addSource("stct-v14-replay-stops", staticData.stops);
        this.addSource("stct-v14-replay-dynamic", this.replayDynamicData(model, frame));
        this.addLayer({ id: "stct-v14-replay-future", type: "line", source: "stct-v14-replay-future", paint: { "line-color": "#687b91", "line-width": 4, "line-opacity": .62, "line-dasharray": [2, 2] } });
        this.addLayer({ id: "stct-v14-replay-completed", type: "line", source: "stct-v14-replay-dynamic", filter: ["==", ["get", "kind"], "completed"], paint: { "line-color": ["coalesce", ["get", "color"], "#003b79"], "line-width": 4, "line-opacity": .62 } });
        this.addLayer({ id: "stct-v14-replay-active", type: "line", source: "stct-v14-replay-dynamic", filter: ["==", ["get", "kind"], "active"], paint: { "line-color": ["case", ["==", ["get", "status"], "SIMULATED_DELAY"], "#e60012", "#00a3e0"], "line-width": 7, "line-opacity": .95 } });
        this.addLayer({ id: "stct-v14-replay-service-pulse", type: "circle", source: "stct-v14-replay-dynamic", filter: ["==", ["get", "kind"], "servicing"], paint: { "circle-radius": 13, "circle-color": "#e60012", "circle-opacity": .16, "circle-stroke-width": 2, "circle-stroke-color": "#e60012" } });
        this.addLayer({ id: "stct-v14-replay-stops", type: "circle", source: "stct-v14-replay-stops", paint: { "circle-radius": 4, "circle-color": ["match", ["get", "status"], "MISSED", "#e60012", "AT_RISK", "#b45309", "#ffffff"], "circle-stroke-width": 2, "circle-stroke-color": "#003b79" } });
        this.addLayer({ id: "stct-v14-replay-vehicles", type: "circle", source: "stct-v14-replay-dynamic", filter: ["==", ["get", "kind"], "vehicle"], paint: { "circle-radius": ["case", ["==", ["get", "selected"], 1], 9, 7], "circle-color": ["case", ["==", ["get", "status"], "SIMULATED_DELAY"], "#e60012", "#001f45"], "circle-stroke-width": 3, "circle-stroke-color": "#ffffff" } });
        this.bind("click", "stct-v14-replay-vehicles", (event) => onVehicle?.(event.features?.[0]?.properties?.vehicleId));
        this.restoreServiceZones();
        const stopCount = model.schedules.reduce((sum, route) => sum + route.stops.length, 0);
        this.replayLodMode = stopCount >= 180 ? "DYNAMIC_240" : stopCount >= 100 ? "DYNAMIC_120" : "FULL";
        this.lastReplayLodMinute = Math.floor(frame.currentMinute);
        this.replayReady = true;
        this.lastStopMarkersVisible = true;
        this.fitCoordinates(model.schedules.flatMap((route) => route.coordinates), `replay:${model.planHash}`);
      });
    }

    updateReplay(model, frame, followVehicle, stopMarkersVisible = true) {
      if (!this.replayReady || !this.map) return;
      ui.performanceCounters.mapAdapterUpdateReplay += 1;
      const source = this.map.getSource("stct-v14-replay-dynamic");
      if (source?.setData) {
        source.setData(this.replayDynamicData(model, frame));
        ui.performanceCounters.geoJsonSetData += 1;
      }
      if (this.lastStopMarkersVisible !== stopMarkersVisible && this.map.getLayer("stct-v14-replay-stops")) {
        this.map.setLayoutProperty("stct-v14-replay-stops", "visibility", stopMarkersVisible ? "visible" : "none");
        this.lastStopMarkersVisible = stopMarkersVisible;
      }
      if (followVehicle && frame.selectedVehicle?.coordinate) this.map.easeTo({ center: frame.selectedVehicle.coordinate, duration: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? 0 : 180 });
    }

    setupArena(planA, planB, comparison, mode, splitHost) {
      if (!this.map) return;
      this.clear();
      const mobileSide = mode === "mobile-A" ? "A" : mode === "mobile-B" ? "B" : "";
      const stage = splitHost?.closest(".exp-arena-map");
      stage?.classList.toggle("split", mode === "split");
      this.whenReady(() => {
        const left = { type: "FeatureCollection", features: (planA.routeGeoJson?.features || []).map((feature) => ({ ...feature, properties: { ...(feature.properties || {}), arenaSide: "A" } })) };
        const right = { type: "FeatureCollection", features: (planB.routeGeoJson?.features || []).map((feature) => ({ ...feature, properties: { ...(feature.properties || {}), arenaSide: "B" } })) };
        this.addSource("stct-v14-arena-a", left);
        this.addSource("stct-v14-arena-b", right);
        this.addLayer({ id: "stct-v14-arena-a", type: "line", source: "stct-v14-arena-a", paint: { "line-color": "#7f90a3", "line-width": 5, "line-opacity": mode === "split" || mobileSide === "A" ? .85 : mobileSide === "B" ? 0 : .42, "line-dasharray": [2, 2] } });
        this.addLayer({ id: "stct-v14-arena-b", type: "line", source: "stct-v14-arena-b", paint: { "line-color": ["coalesce", ["get", "color"], "#003b79"], "line-width": 5, "line-opacity": mode === "split" || mobileSide === "A" ? 0 : .95 } });
        const changedIds = new Set(comparison.changes.filter((change) => change.orderId && change.type !== "UNCHANGED_ASSIGNMENT").map((change) => change.orderId));
        const changedStops = { type: "FeatureCollection", features: (planB.stopGeoJson?.features || []).filter((feature) => changedIds.has(String(feature.properties?.orderId))) };
        this.addSource("stct-v14-arena-changed", changedStops);
        this.addLayer({ id: "stct-v14-arena-changed", type: "circle", source: "stct-v14-arena-changed", paint: { "circle-radius": 9, "circle-color": "#ffffff", "circle-opacity": mobileSide === "A" ? 0 : .35, "circle-stroke-width": 3, "circle-stroke-color": "#e60012" } });
        this.restoreServiceZones();
        const coordinates = mobileSide === "A" ? this.planCoordinates(planA) : mobileSide === "B" ? this.planCoordinates(planB) : [...this.planCoordinates(planA), ...this.planCoordinates(planB)];
        this.fitCoordinates(coordinates, `arena:${planA.planHash}:${planB.planHash}:${mode}`);
        if (mode === "split" && splitHost && window.maplibregl?.Map) this.createSplitMap(splitHost, planB, coordinates);
      });
    }

    createSplitMap(host, planB, coordinates) {
      this.destroySplit();
      host.innerHTML = "";
      this.splitHost = host;
      try {
        this.splitMap = new maplibregl.Map({ container: host, style: window.STCT_CONFIG?.mapStyleUrl || "https://tiles.openfreemap.org/styles/positron", center: this.map.getCenter(), zoom: this.map.getZoom(), bearing: this.map.getBearing(), pitch: this.map.getPitch(), attributionControl: false, localIdeographFontFamily: "sans-serif" });
        this.splitMap.on("load", () => {
          this.splitMap.resize();
          this.addSource("stct-v14-arena-split-b", planB.routeGeoJson || { type: "FeatureCollection", features: [] }, this.splitMap);
          this.addLayer({ id: "stct-v14-arena-split-b", type: "line", source: "stct-v14-arena-split-b", paint: { "line-color": ["coalesce", ["get", "color"], "#003b79"], "line-width": 5, "line-opacity": .95 } }, this.splitMap);
          this.splitSync = Arena.createCameraSynchronizer(this.map, this.splitMap);
          if (coordinates.length && window.maplibregl?.LngLatBounds) {
            const bounds = coordinates.slice(1).reduce((result, coordinate) => result.extend(coordinate), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
            this.splitMap.fitBounds(bounds, { padding: 42, duration: 0, maxZoom: 14 });
          }
        });
      } catch (error) {
        console.warn("Arena Split unavailable", error);
        this.destroySplit();
      }
    }

    setupTimeline(plan, scenario, lens, onStop) {
      if (!this.map) return;
      this.clear();
      this.whenReady(() => {
        const data = Timeline.xrayGeoJson(plan, scenario, lens, { webglAvailable: true });
        this.addSource("stct-v14-xray-routes", data.routes);
        this.addSource("stct-v14-xray-stops", data.stops);
        this.addLayer({ id: "stct-v14-xray-routes", type: "line", source: "stct-v14-xray-routes", paint: { "line-color": lens === "capacity" ? ["match", ["get", "pressure"], "HIGH", "#e60012", "MEDIUM", "#b45309", "#003b79"] : "#003b79", "line-width": 4, "line-opacity": .78 } });
        this.addLayer({ id: "stct-v14-xray-stops", type: "circle", source: "stct-v14-xray-stops", paint: { "circle-radius": 6, "circle-color": lens === "time-window" ? ["match", ["get", "status"], "MISSED_WINDOW", "#e60012", "AT_RISK", "#b45309", "WAITING", "#00a3e0", "#147d64"] : lens === "priority" ? ["match", ["get", "priority"], "high", "#e60012", "medium", "#b45309", "#003b79"] : "#ffffff", "circle-stroke-width": 3, "circle-stroke-color": "#003b79" } });
        this.bind("click", "stct-v14-xray-stops", (event) => onStop?.(event.features?.[0]?.properties?.orderId));
        this.restoreServiceZones();
        this.fitCoordinates(this.planCoordinates(plan), `timeline:${plan.planHash}:${lens}`);
      });
    }

    focusOrder(plan, orderId) {
      const feature = (plan?.stopGeoJson?.features || []).find((candidate) => String(candidate.properties?.orderId) === String(orderId));
      if (feature?.geometry?.coordinates) this.map?.easeTo?.({ center: feature.geometry.coordinates, zoom: Math.max(13, this.map.getZoom?.() || 13), duration: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? 0 : 260 });
    }
  }

  const mapAdapter = new ExperienceMapAdapter();

  function mapBoundaryHtml() {
    const copy = c();
    return `<div class="exp-map-boundary"><b>${esc(copy.boundary)}</b>${esc(copy.notGps)}</div><div class="exp-map-legend"><span class="exp-legend-key"><i class="exp-legend-line"></i>Active</span><span class="exp-legend-key"><i class="exp-legend-line ghost"></i>Completed / A</span><span class="exp-legend-key"><i class="exp-legend-line alert"></i>Risk / Changed</span></div>`;
  }

  function noWebglFleetHtml(frame) {
    const copy = c();
    return `<div class="exp-no-webgl"><div class="exp-fallback-title"><h3>Fleet Timeline</h3><span class="exp-chip warn">${esc(copy.mapUnavailable)}</span></div><p style="font-size:9px;color:var(--exp-muted)">${esc(copy.noWebgl)}</p><table class="exp-table"><thead><tr><th>Vehicle</th><th>Status</th><th>${esc(copy.nextStop)}</th><th>${esc(copy.stopProgress)}</th><th>${esc(copy.currentDelay)}</th></tr></thead><tbody>${frame.vehicles.map((vehicle) => `<tr><td>${esc(vehicle.vehicleId)}</td><td>${esc(vehicle.status)}</td><td>${esc(vehicle.nextStopId || "-")} ${vehicle.nextEtaMinute === null ? "" : Replay.timeText(vehicle.nextEtaMinute)}</td><td>${vehicle.completedStops}/${vehicle.totalStops}</td><td>+${fmt(vehicle.delayedMinutes)} min</td></tr>`).join("")}</tbody></table></div>`;
  }

  function replayInspectorHtml(snapshot) {
    const copy = c();
    const frame = snapshot.frame;
    if (snapshot.vehicleScope === "ALL") {
      const fleet = frame.fleetSummary || {};
      return `<div class="exp-inspector-head"><div><span class="exp-section-label">Fleet Summary</span><h3>${fmt(fleet.vehicles)} vehicles · ${fmt(fleet.totalStops)} stops</h3></div><span class="exp-state">ALL</span></div><div class="exp-stat-grid"><div class="exp-stat"><span>${esc(copy.activeVehicles)}</span><b>${fmt(fleet.activeVehicles)} / ${fmt(fleet.vehicles)}</b></div><div class="exp-stat"><span>${esc(copy.completedStops)}</span><b>${fmt(fleet.completedStops)} / ${fmt(fleet.totalStops)}</b></div><div class="exp-stat"><span>${esc(copy.atRiskStops)}</span><b>${fmt(fleet.atRiskStops)}</b></div><div class="exp-stat"><span>${esc(copy.delayedMinutes)}</span><b>+${fmt(fleet.delayedMinutes)} min</b></div></div><div class="exp-hashes"><span><b>planHash</b> <span class="exp-mono">${esc(shortHash(ui.activePlan?.planHash))}</span></span><span><b>simulationHash</b> <span class="exp-mono">${esc(shortHash(Experience.state.simulationHash))}</span></span><span>Choose one vehicle for route details and Selected Vehicle events.</span></div>`;
    }
    const vehicle = frame.selectedVehicle;
    const route = ui.replay.model.schedules.find((candidate) => candidate.vehicleId === vehicle?.vehicleId) || ui.replay.model.schedules[0];
    const routeOptions = ui.replay.model.schedules.map((candidate) => `<option value="${esc(candidate.routeId)}" ${candidate.routeId === ui.delayRouteId ? "selected" : ""}>${esc(candidate.routeId)} · ${esc(candidate.vehicleId)}</option>`).join("");
    const delayRoute = ui.replay.model.schedules.find((candidate) => candidate.routeId === ui.delayRouteId) || route;
    const stopOptions = (delayRoute?.stops || []).map((stop) => `<option value="${esc(stop.orderId)}" ${stop.orderId === ui.delayOrderId ? "selected" : ""}>${stop.seq}. ${esc(stop.code || stop.orderId)}</option>`).join("");
    const stateClass = [Replay.VEHICLE_STATUS.SIMULATED_DELAY].includes(vehicle?.status) ? "alert" : "";
    const slack = vehicle?.slackMin === null || vehicle?.slackMin === undefined ? "-" : `${fmt(vehicle.slackMin)} min`;
    const volumePercent = route?.maxVolume ? Math.min(100, Math.max(0, vehicle.remainingVolume / route.maxVolume * 100)) : 0;
    return `<div class="exp-inspector-head"><div><span class="exp-section-label">${esc(copy.inspector)}</span><h3>${esc(vehicle?.vehicleId || "-")} · ${esc(vehicle?.routeId || "-")}</h3></div><span class="exp-state ${stateClass}">${esc(vehicle?.status || "IDLE")}</span></div><div class="exp-stat-grid"><div class="exp-stat"><span>${esc(copy.simulationTime)}</span><b>${esc(frame.currentTime)}</b></div><div class="exp-stat"><span>${esc(copy.currentDelay)}</span><b style="color:var(--exp-red)">+${fmt(vehicle?.delayedMinutes)} min</b></div><div class="exp-stat"><span>${esc(copy.previousStop)}</span><b>${esc(vehicle?.previousStopId || "-")}</b></div><div class="exp-stat"><span>${esc(copy.nextStop)}</span><b>${esc(vehicle?.nextStopId || "-")} ${vehicle?.nextEtaMinute === null ? "" : `· ${Replay.timeText(vehicle?.nextEtaMinute)}`}</b></div><div class="exp-stat"><span>${esc(copy.stopProgress)}</span><b>${fmt(vehicle?.completedStops)} / ${fmt(vehicle?.totalStops)}</b></div><div class="exp-stat"><span>${esc(copy.slack)}</span><b style="color:${num(vehicle?.slackMin) <= 15 ? "var(--exp-amber)" : "var(--exp-blue)"}">${esc(slack)}</b></div></div><div class="exp-capacity"><span class="exp-section-label">Route capacity profile</span><div class="exp-capacity-row"><span>${esc(copy.remainingVolume)}</span><div class="exp-bar"><i style="width:${volumePercent}%"></i></div><b>${fmt(volumePercent)}%</b></div><div class="exp-capacity-row"><span>${esc(copy.onTimeRisk)}</span><div class="exp-bar"><i class="${vehicle?.atRisk || vehicle?.missedWindow ? "warn" : ""}" style="width:${vehicle?.missedWindow ? 100 : vehicle?.atRisk ? 72 : 35}%"></i></div><b>${vehicle?.missedWindow ? "Missed" : vehicle?.atRisk ? "At risk" : "On time"}</b></div></div><div class="exp-delay"><strong>${esc(copy.injectDelay)}</strong><div style="display:grid;grid-template-columns:1fr 1fr;gap:5px"><select id="expDelayRoute" style="height:26px;border:1px solid #efbbc0;border-radius:4px;font-size:9px">${routeOptions}</select><select id="expDelayStop" style="height:26px;border:1px solid #efbbc0;border-radius:4px;font-size:9px">${stopOptions}</select></div><div class="exp-delay-actions"><button data-delay-minutes="15">+15 min</button><button data-delay-minutes="30">+30 min</button><button data-delay-minutes="60">+60 min</button><button data-delay-undo>${esc(copy.undo)}</button><button data-delay-reset>${esc(copy.reset)}</button></div><small>${esc(copy.delayBoundary)}</small></div><div class="exp-hashes"><span><b>planHash</b> <span class="exp-mono">${esc(shortHash(ui.activePlan?.planHash))}</span></span><span><b>simulationHash</b> <span class="exp-mono">${esc(shortHash(Experience.state.simulationHash))}</span></span><span><b>Engine</b> ${esc(ui.activePlan?.meta?.engine || ui.activePlan?.meta?.source || "-")} · Verifier PASS</span></div>`;
  }

  function replayEventsHtml(frame) {
    const copy = c();
    const events = frame.events.slice(-8).reverse();
    const state = ui.replay?.state || {};
    const filters = [
      ["ALL", copy.all],
      ["EXCEPTION", copy.exception],
      ["SELECTED_VEHICLE", copy.selectedVehicle],
    ];
    return `<div class="exp-event-head"><span>${esc(copy.eventFeed)}</span><div class="exp-event-filters">${filters.map(([value, label]) => `<button data-event-filter="${value}" class="${state.eventFilter === value ? "active" : ""}" ${value === "SELECTED_VEHICLE" && state.vehicleScope === "ALL" ? "disabled" : ""}>${esc(label)}</button>`).join("")}</div></div>${frame.eventCountBeforeWindow ? `<div class="exp-event-window">+${fmt(frame.eventCountBeforeWindow)} earlier events</div>` : ""}${events.map((event) => `<button class="exp-event ${event.exception ? "alert" : ""} ${state.selectedEventId === event.eventId ? "selected" : ""}" data-event-id="${esc(event.eventId)}" data-event-vehicle="${esc(event.vehicleId)}" data-event-order="${esc(event.orderId)}"><time>${Replay.timeText(event.minute)}</time><span>${esc(copy.events[event.type] || event.type)}${event.orderId ? ` · ${esc(event.orderId)}` : ` · ${esc(event.vehicleId)}`}</span></button>`).join("")}`;
  }

  function pulseHtml() {
    const copy = c();
    return `<section class="exp-pulse"><div class="exp-pulse-item"><span>${esc(copy.activeVehicles)}</span><b id="expPulseActive">-</b></div><div class="exp-pulse-item"><span>${esc(copy.completedStops)}</span><b id="expPulseCompleted">-</b></div><div class="exp-pulse-item"><span>${esc(copy.onTimeStops)}</span><b id="expPulseOnTime">-</b></div><div class="exp-pulse-item"><span>${esc(copy.atRiskStops)}</span><b class="alert" id="expPulseRisk">-</b></div><div class="exp-pulse-item"><span>${esc(copy.delayedMinutes)}</span><b class="alert" id="expPulseDelay">-</b></div><div class="exp-pulse-item"><span>${esc(copy.progress)}</span><b id="expPulseProgress">-</b></div></section>`;
  }

  function replayRouteSummaryHtml(snapshot) {
    if (snapshot.vehicleScope === "ALL") return `<b>ALL</b><span>${fmt(snapshot.frame.fleetSummary?.vehicles)} vehicles · ${fmt(snapshot.frame.fleetSummary?.totalStops)} stops</span>`;
    const summary = snapshot.frame.routeSummary;
    if (!summary) return "";
    return `<b>${esc(summary.routeId)}</b><span>${fmt(summary.distanceKm, 1)} km</span><span>${fmt(summary.plannedDurationMinutes)} min planned</span><span>${fmt(summary.waitingMinutes)} min waiting</span><span>${fmt(summary.serviceMinutes)} min service</span><span>+${fmt(summary.delayedMinutes)} min delay</span>`;
  }

  function renderReplay() {
    const content = document.getElementById("expContent");
    if (!content) return;
    const copy = c();
    const savedReplay = Experience.state.replayState || {};
    ui.replay = Replay.createReplayController(ui.activePlan, ui.scenario, {
      simulationStore: Experience.simulationStore,
      eventStore: Experience.eventStore,
      reducedMotion: Experience.state.reducedMotion,
      webglAvailable: Experience.state.webglAvailable,
      selectedVehicleId: Experience.state.selectedVehicleId || savedReplay.selectedVehicleId,
      selectedOrderId: Experience.state.selectedOrderId || savedReplay.selectedOrderId,
      vehicleScope: savedReplay.vehicleScope,
      eventFilter: savedReplay.eventFilter,
      followVehicle: savedReplay.followVehicle,
      stopMarkersVisible: savedReplay.stopMarkersVisible,
      speed: savedReplay.speed,
    });
    if (Number.isFinite(Number(savedReplay.currentMinute))) ui.replay.setTime(Number(savedReplay.currentMinute));
    ui.delayRouteId = ui.replay.model.schedules.find((route) => route.vehicleId === ui.replay.state.selectedVehicleId)?.routeId || ui.replay.model.schedules[0]?.routeId || "";
    ui.delayOrderId = ui.replay.model.schedules.find((route) => route.routeId === ui.delayRouteId)?.stops[0]?.orderId || "";
    const snapshot = ui.replay.snapshot();
    const vehicleOptions = `<option value="ALL" ${snapshot.vehicleScope === "ALL" ? "selected" : ""}>${esc(copy.all)} vehicles</option>${ui.replay.model.schedules.map((route) => `<option value="${esc(route.vehicleId)}" ${snapshot.vehicleScope === "SINGLE" && route.vehicleId === snapshot.selectedVehicleId ? "selected" : ""}>${esc(route.vehicleId)} · ${esc(route.routeId)}</option>`).join("")}`;
    content.innerHTML = `<section class="exp-mode exp-replay">
      ${pulseHtml()}
      <div class="exp-replay-grid">
        <div class="exp-map-stage"><div class="exp-map-host" id="expMapHost"></div>${mapBoundaryHtml()}<div class="exp-event-feed" id="expEventFeed"></div><div id="expV15EventLane"></div>${Experience.state.webglAvailable ? "" : noWebglFleetHtml(snapshot.frame)}</div>
        <div class="exp-panel exp-inspector" id="expReplayInspector"></div>
      </div>
      <div class="exp-replay-controls">
        <div class="exp-transport"><button class="exp-btn icon" data-replay-restart title="${esc(copy.restart)}">↺</button><button class="exp-btn primary icon" data-replay-toggle title="${esc(copy.play)}">▶</button><button class="exp-btn icon" data-replay-follow title="${esc(copy.follow)}" ${snapshot.vehicleScope === "ALL" ? "disabled" : ""}>⌖</button><button class="exp-btn icon exp-incident-launch" id="expIncidentOpen" type="button" aria-label="Incident Recovery" title="Incident Recovery">!</button></div>
        <div class="exp-scrub"><div class="exp-scrub-meta"><span>${Replay.timeText(snapshot.startMinute)}</span><b id="expReplayTime">${snapshot.frame.currentTime}</b><span>${Replay.timeText(snapshot.endMinute)}</span></div><input id="expReplayScrub" type="range" min="${snapshot.startMinute}" max="${snapshot.endMinute}" step="1" value="${snapshot.currentMinute}"></div>
        <div class="exp-replay-options"><select id="expReplayVehicle">${vehicleOptions}</select><label class="exp-stop-toggle"><input id="expReplayStops" type="checkbox" ${snapshot.stopMarkersVisible ? "checked" : ""}> Stops</label><span class="exp-section-label">${esc(copy.speed)}</span><div class="exp-segmented">${Replay.SPEEDS.map((speed) => `<button data-replay-speed="${speed}" class="${speed === snapshot.speed ? "active" : ""}">${speed}×</button>`).join("")}</div></div>
        <div class="exp-route-summary" id="expRouteSummary">${replayRouteSummaryHtml(snapshot)}</div>
      </div><div class="exp-incident-host" id="expV15IncidentHost"></div><div id="expV15TrustLab"></div>
    </section>`;
    const host = document.getElementById("expMapHost");
    if (Experience.state.webglAvailable && mapAdapter.attach(host)) mapAdapter.setupReplay(ui.replay.model, snapshot.frame, selectReplayVehicle);
    updateReplayView(true);

    content.addEventListener("click", async (event) => {
      const target = event.target.closest("button");
      if (!target) return;
      if (target.matches("[data-replay-toggle]")) {
        if (ui.replay.state.status === "playing") ui.replay.pause();
        else ui.replay.play();
        updateReplayView(true);
        scheduleReplayLoop();
      } else if (target.matches("[data-replay-restart]")) {
        ui.replay.restart();
        updateReplayView(true);
      } else if (target.matches("[data-replay-follow]")) {
        ui.replay.setFollow(!ui.replay.state.followVehicle);
        updateReplayView(true);
      } else if (target.dataset.replaySpeed) {
        ui.replay.setSpeed(Number(target.dataset.replaySpeed));
        content.querySelectorAll("[data-replay-speed]").forEach((button) => button.classList.toggle("active", button === target));
      } else if (target.dataset.eventFilter) {
        try {
          ui.replay.setEventFilter(target.dataset.eventFilter);
          updateReplayView(true);
        } catch (error) { notify(error.message, "error"); }
      } else if (target.dataset.eventId) {
        try {
          const jumped = ui.replay.jumpToEvent(target.dataset.eventId);
          if (jumped.jump?.vehicleId) Experience.selectVehicle(jumped.jump.vehicleId);
          if (jumped.jump?.orderId) Experience.selectOrder(jumped.jump.orderId, "replay-event-seek");
          updateReplayView(true);
          const coordinate = jumped.frame.selectedVehicle?.coordinate;
          if (coordinate) mapAdapter.map?.easeTo?.({ center: coordinate, zoom: Math.max(12, mapAdapter.map.getZoom?.() || 12), duration: Experience.state.reducedMotion ? 0 : 220 });
          document.querySelector(`.exp-event[data-event-id="${CSS.escape(target.dataset.eventId)}"]`)?.scrollIntoView?.({ block: "nearest" });
        } catch (error) { notify(error.message, "error"); }
      } else if (target.dataset.delayMinutes) {
        try {
          await ui.replay.injectDelay({ routeId: ui.delayRouteId, orderId: ui.delayOrderId, minutes: Number(target.dataset.delayMinutes) });
          updateReplayView(true);
        } catch (error) { notify(error.message, "error"); }
      } else if (target.matches("[data-delay-undo]")) {
        await ui.replay.undoDelay();
        updateReplayView(true);
      } else if (target.matches("[data-delay-reset]")) {
        await ui.replay.resetSimulation();
        updateReplayView(true);
      }
    });
    document.getElementById("expReplayScrub")?.addEventListener("input", (event) => {
      ui.replay.setTime(Number(event.target.value));
      updateReplayView(true);
    });
    document.getElementById("expReplayVehicle")?.addEventListener("change", (event) => selectReplayVehicle(event.target.value));
    content.addEventListener("change", (event) => {
      if (event.target.id === "expDelayRoute") {
        ui.delayRouteId = event.target.value;
        ui.delayOrderId = ui.replay.model.schedules.find((route) => route.routeId === ui.delayRouteId)?.stops[0]?.orderId || "";
        updateReplayView(true);
      } else if (event.target.id === "expDelayStop") ui.delayOrderId = event.target.value;
      else if (event.target.id === "expReplayStops") {
        ui.replay.setStopMarkersVisible(event.target.checked);
        updateReplayView(true);
      }
    });
    const visibility = () => {
      ui.replay.handleVisibility(document.hidden);
      updateReplayView(true);
    };
    const keydown = (event) => {
      if (event.key === "Escape" && ui.replay.state.followVehicle) {
        ui.replay.escapeFollow();
        updateReplayView(true);
      }
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("keydown", keydown);
    Experience.registerCleanup("mode", () => document.removeEventListener("visibilitychange", visibility));
    Experience.registerCleanup("mode", () => window.removeEventListener("keydown", keydown));
    const eventLaneCleanup = window.STCTV15?.ui?.mountEventLane?.({
      host: document.getElementById("expV15EventLane"),
      eventStore: Experience.eventStore,
      replay: ui.replay,
    });
    if (typeof eventLaneCleanup === "function") Experience.registerCleanup("mode", eventLaneCleanup);
    const incidentCleanup = window.STCTV15?.incidentUI?.mount?.({
      host: document.getElementById("expV15IncidentHost"),
      launcher: document.getElementById("expIncidentOpen"),
      basePlan: ui.activePlan,
      baseScenario: ui.scenario,
      experience: Experience,
      replay: ui.replay,
      reducedMotion: Experience.state.reducedMotion,
      webglAvailable: Experience.state.webglAvailable,
      getLogicalMinute: () => ui.replay?.state?.currentMinute,
      pauseReplay: () => { ui.replay?.pause?.(); updateReplayView(true); },
      previewMap: ({ basePlan, recoveryPlan, blastRadius, incident, reducedMotion }) => {
        if (Experience.state.webglAvailable) mapAdapter.setupIncident(basePlan, recoveryPlan, blastRadius, incident, { reducedMotion });
      },
      restoreMap: () => {
        if (!Experience.state.webglAvailable || !ui.replay) return;
        mapAdapter.setupReplay(ui.replay.model, ui.replay.snapshot().frame, selectReplayVehicle);
      },
      onApplied: (result, scenario) => { ui.recoveryPreview = { plan: result.plan, scenario }; },
      onUndone: () => { ui.recoveryPreview = null; },
      download: downloadText,
    });
    if (typeof incidentCleanup === "function") Experience.registerCleanup("mode", incidentCleanup);
    const trustContext = planningContext();
    const trustCleanup = window.STCTV15?.trustLab?.mount?.({
      host: document.getElementById("expV15TrustLab"),
      mode: "replay",
      scenario: ui.scenario,
      plan: ui.activePlan,
      entries: trustContext.plans,
      baseline: trustContext.baseline,
      eventStore: Experience.eventStore,
      experience: Experience,
      replay: ui.replay,
      mapAdapter,
      webglAvailable: Experience.state.webglAvailable,
      getIncidentState: () => window.STCTV15?.incidentUI?.state || {},
      download: downloadText,
    });
    if (typeof trustCleanup === "function") Experience.registerCleanup("mode", trustCleanup);
  }

  function selectReplayVehicle(vehicleId) {
    try {
      if (String(vehicleId).toUpperCase() === "ALL") {
        ui.replay.setVehicleScope("ALL");
        const select = document.getElementById("expReplayVehicle");
        if (select) select.value = "ALL";
        updateReplayView(true);
        return;
      }
      ui.replay.selectVehicle(vehicleId);
      Experience.selectVehicle(vehicleId);
      ui.delayRouteId = ui.replay.model.schedules.find((route) => route.vehicleId === vehicleId)?.routeId || ui.delayRouteId;
      ui.delayOrderId = ui.replay.model.schedules.find((route) => route.routeId === ui.delayRouteId)?.stops.find((stop) => stop.orderId === ui.replay.snapshot().frame.selectedVehicle?.nextStopId)?.orderId || ui.delayOrderId;
      const select = document.getElementById("expReplayVehicle");
      if (select) select.value = vehicleId;
      updateReplayView(true);
    } catch (error) { notify(error.message, "error"); }
  }

  function updateReplayView(force = false) {
    if (!ui.replay || ui.mode !== "replay") return;
    ui.performanceCounters.updateReplayView += 1;
    const snapshot = ui.replay.snapshot();
    const frame = snapshot.frame;
    const logicalMinute = Math.floor(snapshot.currentMinute);
    const logicalChanged = force || logicalMinute !== ui.replayFrameMinute;
    const set = (id, value) => {
      const element = document.getElementById(id);
      if (!element) return;
      const next = String(value);
      if (id === "expReplayTime" && ui.performanceCounters.lastCursorText !== next) {
        ui.performanceCounters.visibleCursorUpdates += 1;
        ui.performanceCounters.lastCursorText = next;
      }
      if (element.textContent !== next) element.textContent = next;
    };
    set("expPulseActive", `${frame.fleetPulse.activeVehicles} / ${frame.vehicles.length}`);
    set("expPulseCompleted", `${frame.fleetPulse.completedStops} / ${frame.fleetPulse.totalStops}`);
    set("expPulseOnTime", fmt(frame.fleetPulse.onTimeStops));
    set("expPulseRisk", fmt(frame.fleetPulse.atRiskStops));
    set("expPulseDelay", `+${fmt(frame.fleetPulse.delayedMinutes)} min`);
    set("expPulseProgress", `${fmt(frame.fleetPulse.progress)}%`);
    set("expReplayTime", frame.currentTime);
    const scrub = document.getElementById("expReplayScrub");
    if (scrub) {
      const max = String(snapshot.endMinute);
      const value = String(snapshot.currentMinute);
      if (scrub.max !== max) scrub.max = max;
      if (scrub.value !== value) scrub.value = value;
    }
    const toggle = document.querySelector("[data-replay-toggle]");
    if (toggle) {
      const label = snapshot.status === "playing" ? "Ⅱ" : "▶";
      const title = snapshot.status === "playing" ? c().pause : c().play;
      if (toggle.textContent !== label) toggle.textContent = label;
      if (toggle.title !== title) toggle.title = title;
    }
    const follow = document.querySelector("[data-replay-follow]");
    if (follow) {
      follow.classList.toggle("primary", snapshot.followVehicle);
      follow.disabled = snapshot.vehicleScope === "ALL";
    }
    const vehicleSelect = document.getElementById("expReplayVehicle");
    if (vehicleSelect) vehicleSelect.value = snapshot.vehicleScope === "ALL" ? "ALL" : snapshot.selectedVehicleId;
    const stopToggle = document.getElementById("expReplayStops");
    if (stopToggle) stopToggle.checked = snapshot.stopMarkersVisible;
    const routeSummary = document.getElementById("expRouteSummary");
    if (routeSummary && force) routeSummary.innerHTML = replayRouteSummaryHtml(snapshot);
    const inspector = document.getElementById("expReplayInspector");
    if (inspector && logicalChanged) inspector.innerHTML = replayInspectorHtml(snapshot);
    const feed = document.getElementById("expEventFeed");
    if (feed && logicalChanged) {
      feed.innerHTML = replayEventsHtml(frame);
      ui.performanceCounters.eventFeedRender += 1;
    }
    mapAdapter.updateReplay(ui.replay.model, frame, snapshot.followVehicle, snapshot.stopMarkersVisible);
    if (logicalChanged) {
      ui.replayFrameMinute = logicalMinute;
      Experience.setReplayState({
        status: snapshot.status,
        currentMinute: snapshot.currentMinute,
        startMinute: snapshot.startMinute,
        endMinute: snapshot.endMinute,
        speed: snapshot.speed,
        selectedVehicleId: snapshot.selectedVehicleId,
        selectedOrderId: snapshot.selectedOrderId,
        vehicleScope: snapshot.vehicleScope,
        eventFilter: snapshot.eventFilter,
        followVehicle: snapshot.followVehicle,
        stopMarkersVisible: snapshot.stopMarkersVisible,
        selectedEventId: snapshot.selectedEventId,
      });
    }
  }

  function scheduleReplayLoop() {
    if (ui.raf || ui.replay?.state.status !== "playing") return;
    ui.lastRaf = performance.now();
    const loop = (time) => {
      ui.performanceCounters.browserRafCallbacks += 1;
      ui.raf = 0;
      if (!ui.replay || ui.mode !== "replay" || ui.replay.state.status !== "playing") return;
      const elapsed = Math.max(0, Math.min(250, time - ui.lastRaf));
      ui.lastRaf = time;
      ui.replay.advance(elapsed);
      const reduced = Experience.state.reducedMotion;
      const stopCount = ui.replay.model.schedules.reduce((sum, route) => sum + route.stops.length, 0);
      const updateInterval = stopCount >= 180 ? 48 : stopCount >= 100 ? 28 : 16;
      if (!reduced && time - ui.lastPaint >= updateInterval || reduced && Math.floor(ui.replay.state.currentMinute) !== ui.replayFrameMinute) {
        const elapsedSincePaint = Math.max(0, time - ui.lastPaint);
        ui.performanceCounters.droppedApplicationFrames += Math.max(0, Math.floor(elapsedSincePaint / updateInterval) - 1);
        ui.lastPaint = time;
        updateReplayView();
      }
      if (ui.replay.state.status === "playing") ui.raf = requestAnimationFrame(loop);
      else updateReplayView(true);
    };
    ui.raf = requestAnimationFrame(loop);
  }

  function metricValue(metric, side) {
    const value = side === "A" ? metric.planA : metric.planB;
    if (metric.id === "latestEndMinutes") return Replay.timeText(value);
    const digits = ["estimatedRoadKm", "totalCost", "totalCO2", "utilizationScore", "serviceRate"].includes(metric.id) ? 1 : 0;
    return `${fmt(value, digits)}${metric.unit ? ` ${metric.unit}` : ""}`;
  }

  function arenaDeltaHtml(comparison) {
    return comparison.metrics.map((metric) => {
      const sign = metric.delta > 0 ? "+" : "";
      const delta = `${sign}${fmt(metric.delta, Math.abs(metric.delta) < 10 && metric.delta % 1 ? 1 : 0)}${metric.unit ? ` ${metric.unit}` : ""}`;
      return `<div class="exp-delta-item"><span>${esc(metric.label)}</span><b>${esc(metricValue(metric, "B"))}</b><em>${comparison.sameInputHash ? esc(delta) : esc(c().scenarioChanged)}</em></div>`;
    }).join("");
  }

  function arenaInspectorHtml(comparison) {
    const copy = c();
    const changes = comparison.changes.filter((change) => change.type !== "UNCHANGED_ASSIGNMENT").slice(0, 12);
    return `<div class="exp-inspector-head"><div><span class="exp-section-label">Change Inspector</span><h3>${esc(copy.observedChanges)} · ${changes.length}</h3></div><span class="exp-state ${comparison.sameInputHash ? "" : "alert"}">${esc(comparison.sameInputHash ? copy.sameInput : copy.scenarioChanged)}</span></div><div class="exp-change-list">${changes.length ? changes.map((change) => `<button class="exp-change changed" data-arena-change="${esc(change.orderId || change.routeId)}"><strong>${esc(change.orderId || change.routeId)} · ${esc(change.type)}</strong><span>${change.planA ? `${esc(change.planA.routeId || "-")} / ${esc(change.planA.vehicleId || "-")} / ${change.planA.seq || "-"}` : "UNASSIGNED"} → ${change.planB ? `${esc(change.planB.routeId || "-")} / ${esc(change.planB.vehicleId || "-")} / ${change.planB.seq || "-"}` : "UNASSIGNED"}</span></button>`).join("") : `<div class="exp-evidence">${esc(copy.noChanges)}</div>`}</div><div class="exp-evidence"><b>${esc(copy.constraintEvidence)}</b><br>${comparison.sameInputHash ? "Same inputHash · verifier recomputedMetrics" : `${esc(copy.scenarioChanged)} · ${esc(shortHash(comparison.planA.inputHash))} → ${esc(shortHash(comparison.planB.inputHash))}`}<br><b>${esc(copy.notProven)}:</b> ${esc(comparison.whyChanged[0]?.notProven || "No causal explanation is fabricated.")}</div><div class="exp-hashes"><span><b>A</b> ${esc(shortHash(comparison.planA.planHash))}</span><span><b>B</b> ${esc(shortHash(comparison.planB.planHash))}</span><span>${comparison.improvementClaimAllowed ? "Direct metric comparison allowed" : "Improvement percentage prohibited"}</span></div>`;
  }

  function arenaFallbackHtml(comparison) {
    const copy = c();
    return `<div class="exp-no-webgl"><div class="exp-fallback-title"><h3>Verified Comparison Table</h3><span class="exp-chip warn">${esc(copy.mapUnavailable)}</span></div><table class="exp-table"><thead><tr><th>Metric</th><th>Plan A</th><th>Plan B</th><th>Delta</th><th>Semantic</th></tr></thead><tbody>${Arena.noWebglTable(comparison).map((row) => `<tr><td>${esc(row.metric)}</td><td>${fmt(row.planA, 1)}</td><td>${fmt(row.planB, 1)}</td><td>${fmt(row.delta, 1)}</td><td>${esc(row.semantic)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function renderArena() {
    const content = document.getElementById("expContent");
    if (!content) return;
    const copy = c();
    const context = planningContext();
    const entries = context.plans.length ? context.plans : [{ plan: ui.activePlan, scenario: ui.scenario, label: "Selected" }];
    const left = context.baseline && isVerified(context.baseline.plan, context.baseline.scenario) ? context.baseline.plan : entries[0].plan;
    const right = entries.find((entry) => entry.plan.planHash === ui.activePlan.planHash)?.plan || entries[1]?.plan || entries[0].plan;
    ui.arena = Arena.createArenaController({ plans: entries.map((entry) => entry.plan), scenarios: context.scenarios.length ? context.scenarios : [ui.scenario], leftPlanHash: left.planHash, rightPlanHash: right.planHash, webglAvailable: Experience.state.webglAvailable, reducedMotion: Experience.state.reducedMotion, lowPower: window.innerWidth <= 700 });
    const options = entries.map((entry) => `<option value="${esc(entry.plan.planHash)}">${esc(planLabel(entry))}</option>`).join("");
    content.innerHTML = `<section class="exp-mode exp-arena"><div class="exp-arena-selectors"><label class="exp-plan-select left"><span class="exp-plan-letter">A</span><span><select id="expArenaA">${options}</select><small>Verifier PASS · recomputed metrics</small></span></label><label class="exp-plan-select right"><span class="exp-plan-letter">B</span><span><select id="expArenaB">${options}</select><small>Verifier PASS · recomputed metrics</small></span></label><div class="exp-segmented"><button data-arena-mode="overlay" class="active">${esc(copy.overlay)}</button><button data-arena-mode="split">${esc(copy.split)}</button></div><button class="exp-btn" data-arena-export>⇩ ${esc(copy.export)}</button></div><div class="exp-arena-grid"><div class="exp-map-stage exp-arena-map"><div class="exp-map-host" id="expMapHost"></div><div class="exp-split-map" id="expSplitMap"></div>${mapBoundaryHtml()}<div class="exp-segmented exp-mobile-ab" style="position:absolute;right:8px;top:8px;z-index:9"><button data-arena-side="A" class="active">A</button><button data-arena-side="B">B</button></div><div id="expArenaFallback"></div></div><div class="exp-panel exp-inspector" id="expArenaInspector"></div></div><div class="exp-delta" id="expArenaDelta"></div><div id="expV15Arena"></div><div id="expV15TrustLab"></div></section>`;
    document.getElementById("expArenaA").value = ui.arena.state.leftPlanHash;
    document.getElementById("expArenaB").value = ui.arena.state.rightPlanHash;
    refreshArena();
    document.getElementById("expArenaA")?.addEventListener("change", (event) => { ui.arena.select("A", event.target.value); refreshArena(); });
    document.getElementById("expArenaB")?.addEventListener("change", (event) => { ui.arena.select("B", event.target.value); refreshArena(); });
    content.addEventListener("click", (event) => {
      const target = event.target.closest("button");
      if (!target) return;
      if (target.dataset.arenaMode) {
        ui.arena.setVisualMode(target.dataset.arenaMode);
        content.querySelectorAll("[data-arena-mode]").forEach((button) => button.classList.toggle("active", button.dataset.arenaMode === ui.arena.state.visualMode));
        refreshArena();
      } else if (target.dataset.arenaSide) {
        ui.arena.setMobileSide(target.dataset.arenaSide);
        content.querySelectorAll("[data-arena-side]").forEach((button) => button.classList.toggle("active", button.dataset.arenaSide === ui.arena.state.mobileSide));
        refreshArena();
      } else if (target.matches("[data-arena-export]")) downloadText("stct-arena-comparison-v1.4.json", Arena.exportComparison(ui.arena.snapshot().comparison));
    });
    const arenaCleanup = window.STCTV15?.ui?.mountArena?.({
      host: document.getElementById("expV15Arena"),
      entries,
      baseline: context.baseline,
      selectedPlanHash: right.planHash,
      webglAvailable: Experience.state.webglAvailable,
      onSelect(planHash) {
        try {
          ui.arena.select("B", planHash);
          const selector = document.getElementById("expArenaB");
          if (selector) selector.value = planHash;
          refreshArena();
        } catch (error) { notify(error.message, "error"); }
      },
    });
    if (typeof arenaCleanup === "function") Experience.registerCleanup("mode", arenaCleanup);
    const trustCleanup = window.STCTV15?.trustLab?.mount?.({
      host: document.getElementById("expV15TrustLab"),
      mode: "arena",
      scenario: ui.scenario,
      plan: right,
      entries,
      baseline: context.baseline,
      eventStore: Experience.eventStore,
      experience: Experience,
      mapAdapter,
      webglAvailable: Experience.state.webglAvailable,
      download: downloadText,
    });
    if (typeof trustCleanup === "function") Experience.registerCleanup("mode", trustCleanup);
  }

  function refreshArena() {
    if (!ui.arena) return;
    const state = ui.arena.snapshot();
    const comparison = state.comparison;
    const delta = document.getElementById("expArenaDelta");
    if (delta) delta.innerHTML = arenaDeltaHtml(comparison);
    const inspector = document.getElementById("expArenaInspector");
    if (inspector) inspector.innerHTML = arenaInspectorHtml(comparison);
    Experience.setComparison(state.leftPlanHash, state.rightPlanHash);
    const context = planningContext();
    const planA = context.plans.find((entry) => entry.plan.planHash === state.leftPlanHash)?.plan || ui.activePlan;
    const planB = context.plans.find((entry) => entry.plan.planHash === state.rightPlanHash)?.plan || ui.activePlan;
    const host = document.getElementById("expMapHost");
    const split = document.getElementById("expSplitMap");
    const mapMode = window.innerWidth <= 900 ? `mobile-${state.mobileSide}` : state.visualMode;
    if (Experience.state.webglAvailable && mapAdapter.attach(host)) mapAdapter.setupArena(planA, planB, comparison, mapMode, split);
    else {
      const fallback = document.getElementById("expArenaFallback");
      if (fallback) fallback.innerHTML = arenaFallbackHtml(comparison);
    }
    window.STCTV15?.ui?.refreshArena?.({ planA, planB, comparison, context, arenaState: state });
  }

  function timelineTicks(timeline) {
    const count = 6;
    return Array.from({ length: count }, (_, index) => Math.round(timeline.startMinute + (timeline.endMinute - timeline.startMinute) * index / (count - 1)));
  }

  function pct(minute, timeline) {
    return Math.max(0, Math.min(100, (num(minute) - timeline.startMinute) / Math.max(1, timeline.endMinute - timeline.startMinute) * 100));
  }

  function timelineLanesHtml(snapshot) {
    const timeline = snapshot.timeline;
    const ticks = timelineTicks(timeline);
    const cursorPercent = pct(timeline.replayCursorMinute, timeline);
    return `<div class="exp-time-axis"><span>Vehicle / Route</span>${ticks.map((tick) => `<span>${Replay.timeText(tick)}</span>`).join("")}</div><div style="position:relative;min-height:${timeline.lanes.length * 50}px"><i class="exp-cursor" style="left:calc(108px + ${cursorPercent}% - ${cursorPercent * 1.08}px)"><span>${Replay.timeText(timeline.replayCursorMinute)}</span></i>${timeline.lanes.map((lane) => `<div class="exp-lane ${lane.routeId === snapshot.selectedRouteId ? "active" : ""}"><div class="exp-lane-label"><span class="exp-lock">${lane.locked ? "◆" : ""}</span><button data-timeline-route="${esc(lane.routeId)}"><b>${esc(lane.vehicleId)}</b><span>${esc(lane.routeId)} · ${lane.stops.length} stops</span></button></div><div class="exp-blocks">${lane.timeWindows.map((windowBand) => `<i class="exp-window-band" style="left:${pct(windowBand.startMinute, timeline)}%;width:${Math.max(1, pct(windowBand.endMinute, timeline) - pct(windowBand.startMinute, timeline))}%"></i>`).join("")}${lane.blocks.filter((block) => !["LUNCH_BREAK", "OVERTIME"].includes(block.type) || block.endMinute > timeline.startMinute).map((block) => `<button class="exp-block ${block.type.toLowerCase().replaceAll("_", "-")}" ${block.orderId && block.orderId !== "DEPOT" ? `data-timeline-stop="${esc(block.orderId)}"` : ""} style="left:${pct(block.startMinute, timeline)}%;width:${Math.max(.8, pct(block.endMinute, timeline) - pct(block.startMinute, timeline))}%" title="${esc(block.type)} ${Replay.timeText(block.startMinute)}-${Replay.timeText(block.endMinute)}">${block.type === "SERVICE" ? esc(block.orderId) : esc(block.type.replaceAll("_", " "))}</button>`).join("")}</div></div>`).join("")}</div>`;
  }

  function profileSvg(profile) {
    const points = profile.points;
    const width = 520;
    const height = 80;
    const path = points.map((point, index) => `${index ? "L" : "M"}${points.length === 1 ? 0 : index / (points.length - 1) * width},${height - Math.min(100, point.remainingVolumePercent) / 100 * (height - 8)}`).join(" ");
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-label="Capacity profile"><path d="${path}" fill="none" stroke="#003b79" stroke-width="4" vector-effect="non-scaling-stroke"/>${points.map((point, index) => `<circle cx="${points.length === 1 ? 0 : index / (points.length - 1) * width}" cy="${height - Math.min(100, point.remainingVolumePercent) / 100 * (height - 8)}" r="3" fill="#003b79"/>`).join("")}</svg>`;
  }

  function routeOptions(plan, selected) {
    return (plan.routes || []).map((route) => `<option value="${esc(route.routeId)}" ${route.routeId === selected ? "selected" : ""}>${esc(route.routeId)} · ${esc(route.vehicleId)}</option>`).join("");
  }

  function orderOptions(plan, selected) {
    return (plan.routes || []).flatMap((route) => (route.orderIds || []).map((orderId) => ({ orderId, routeId: route.routeId }))).map((row) => `<option value="${esc(row.orderId)}" ${row.orderId === selected ? "selected" : ""}>${esc(row.orderId)} · ${esc(row.routeId)}</option>`).join("");
  }

  function anchorOptions(plan, routeId, selected) {
    const route = (plan.routes || []).find((candidate) => candidate.routeId === routeId) || plan.routes?.[0];
    return (route?.orderIds || []).map((orderId) => `<option value="${esc(orderId)}" ${orderId === selected ? "selected" : ""}>${esc(orderId)}</option>`).join("");
  }

  function timelineProfileHtml(snapshot) {
    const copy = c();
    const profile = snapshot.capacityProfile;
    const edit = snapshot.editMode;
    const selectedOrder = snapshot.selectedOrderId || ui.activePlan.routes?.[0]?.orderIds?.[0] || "";
    const targetRoute = snapshot.selectedRouteId || ui.activePlan.routes?.[0]?.routeId || "";
    return `<div><span class="exp-section-label">${esc(copy.selectedRoute)}</span><h3>${esc(profile.routeId)} · ${esc(copy.capacityProfile)}</h3><p>${esc(copy.capacityNotice)}<br>Volume conserved: ${profile.volumeConserved ? "PASS" : "FAIL"}</p></div><div class="exp-profile-chart">${profileSvg(profile)}</div><div class="exp-manual"><label>Stop<select id="expManualOrder">${orderOptions(ui.activePlan, selectedOrder)}</select></label><label>${esc(copy.targetRoute)}<select id="expManualRoute">${routeOptions(ui.activePlan, targetRoute)}</select></label><label>${esc(copy.insertion)}<select id="expManualInsert"><option value="APPEND">APPEND</option><option value="AFTER">AFTER</option><option value="BEFORE">BEFORE</option><option value="AUTO_MIN_DELTA">AUTO_MIN_DELTA</option></select></label><label>${esc(copy.anchor)}<select id="expManualAnchor">${anchorOptions(ui.activePlan, targetRoute, "")}</select></label><div class="exp-manual-actions"><button class="exp-btn" data-manual-preview ${edit ? "" : "disabled"}>${esc(copy.preview)}</button><button class="exp-btn primary" data-manual-apply ${edit ? "" : "disabled"}>${esc(copy.applyVerify)}</button><button class="exp-btn" data-manual-lock ${edit ? "" : "disabled"}>${esc(copy.lockRoute)}</button><button class="exp-btn" data-manual-undo ${edit ? "" : "disabled"}>${esc(copy.undo)}</button><button class="exp-btn" data-manual-restore ${edit ? "" : "disabled"}>${esc(copy.restoreSolver)}</button></div><div class="exp-manual-status" id="expManualStatus">${esc(edit ? copy.manualReady : copy.editRequired)}</div></div>`;
  }

  function timelineFallbackHtml(snapshot) {
    const copy = c();
    return `<div class="exp-no-webgl"><div class="exp-fallback-title"><h3>Timeline facts</h3><span class="exp-chip warn">${esc(copy.mapUnavailable)}</span></div><p style="font-size:9px;color:var(--exp-muted)">${esc(copy.noWebgl)}</p><table class="exp-table"><thead><tr><th>Route</th><th>Vehicle</th><th>Stops</th><th>Return</th><th>Locked</th></tr></thead><tbody>${snapshot.timeline.lanes.map((lane) => `<tr><td>${esc(lane.routeId)}</td><td>${esc(lane.vehicleId)}</td><td>${lane.stops.length}</td><td>${Replay.timeText(lane.returnMinute)}</td><td>${lane.locked ? "YES" : "NO"}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function renderTimeline() {
    const content = document.getElementById("expContent");
    if (!content) return;
    const copy = c();
    const manualLocks = window.STCTPlanning?.state?.manual?.lockedRouteIds || [];
    const replayMinute = Experience.state.replayState?.currentMinute || ui.activePlan.routes?.[0]?.startMinutes || 0;
    ui.timeline = Timeline.createTimelineController(ui.activePlan, ui.scenario, { replayCursorMinute: replayMinute, selectedOrderId: Experience.state.selectedOrderId, lockedRouteIds: manualLocks, reducedMotion: Experience.state.reducedMotion, webglAvailable: Experience.state.webglAvailable });
    const snapshot = ui.timeline.snapshot();
    content.innerHTML = `<section class="exp-mode exp-timeline"><div class="exp-timeline-toolbar"><div class="exp-lens-row"><span class="exp-section-label">Constraint Lens</span><div class="exp-segmented">${Timeline.LENSES.map((lens) => `<button data-timeline-lens="${lens}" class="${lens === snapshot.activeLens ? "active" : ""}">${esc(copy.lenses[lens])}</button>`).join("")}</div></div><div class="exp-edit-row"><button class="exp-btn">⌖ ${esc(copy.currentTime)} ${Replay.timeText(snapshot.replayCursorMinute)}</button><button class="exp-btn danger" data-timeline-edit>${esc(copy.enterEdit)}</button></div></div><div class="exp-timeline-grid"><div class="exp-lanes" id="expTimelineLanes">${timelineLanesHtml(snapshot)}</div><div class="exp-map-stage"><div class="exp-map-host" id="expMapHost"></div>${mapBoundaryHtml()}${Experience.state.webglAvailable ? "" : timelineFallbackHtml(snapshot)}</div></div><div class="exp-profile" id="expTimelineProfile">${timelineProfileHtml(snapshot)}</div></section>`;
    const host = document.getElementById("expMapHost");
    const bridge = Timeline.createSelectionBridge({ onMapFocus: (selection) => mapAdapter.focusOrder(ui.activePlan, selection.orderId), onTimelineFocus: (selection) => selectTimelineStop(selection.orderId, false) });
    if (Experience.state.webglAvailable && mapAdapter.attach(host)) mapAdapter.setupTimeline(ui.activePlan, ui.scenario, snapshot.activeLens, (orderId) => bridge.fromMap({ orderId }));
    content.addEventListener("click", async (event) => {
      const target = event.target.closest("button");
      if (!target) return;
      if (target.dataset.timelineLens) {
        ui.timeline.setLens(target.dataset.timelineLens);
        content.querySelectorAll("[data-timeline-lens]").forEach((button) => button.classList.toggle("active", button.dataset.timelineLens === target.dataset.timelineLens));
        mapAdapter.setupTimeline(ui.activePlan, ui.scenario, target.dataset.timelineLens, (orderId) => bridge.fromMap({ orderId }));
      } else if (target.dataset.timelineRoute) {
        ui.timeline.selectRoute(target.dataset.timelineRoute);
        refreshTimelineSelection();
      } else if (target.dataset.timelineStop) {
        selectTimelineStop(target.dataset.timelineStop, true, bridge);
      } else if (target.matches("[data-timeline-edit]")) {
        ui.timeline.setEditMode(!ui.timeline.state.editMode);
        target.textContent = ui.timeline.state.editMode ? copy.exitEdit : copy.enterEdit;
        refreshTimelineSelection();
      } else if (target.matches("[data-manual-preview]")) {
        const command = manualCommandFromControls();
        const status = document.getElementById("expManualStatus");
        if (status) status.textContent = `${command.actionType} · ${command.payload.orderId} → ${command.payload.toRouteId} · ${command.payload.insertMode}`;
      } else if (target.matches("[data-manual-apply]")) {
        await executeManualCommand(manualCommandFromControls());
      } else if (target.matches("[data-manual-lock]")) {
        await executeManualCommand({ actionType: "TOGGLE_ROUTE_LOCK", payload: { routeId: ui.timeline.state.selectedRouteId } });
      } else if (target.matches("[data-manual-undo]")) {
        await executeManualCommand({ actionType: "UNDO", payload: {} });
      } else if (target.matches("[data-manual-restore]")) {
        await executeManualCommand({ actionType: "RESTORE_SOLVER", payload: {} });
      }
    });
    content.addEventListener("change", (event) => {
      if (event.target.id === "expManualRoute") {
        const anchor = document.getElementById("expManualAnchor");
        if (anchor) anchor.innerHTML = anchorOptions(ui.activePlan, event.target.value, "");
      }
    });
  }

  function selectTimelineStop(orderId, focusMap = true, bridge = null) {
    try {
      ui.timeline.selectStop(orderId);
      Experience.selectOrder(orderId, "timeline");
      if (focusMap) (bridge || Timeline.createSelectionBridge({ onMapFocus: (selection) => mapAdapter.focusOrder(ui.activePlan, selection.orderId) })).fromTimeline({ orderId });
      refreshTimelineSelection();
    } catch (error) { notify(error.message, "error"); }
  }

  function refreshTimelineSelection() {
    const lanes = document.getElementById("expTimelineLanes");
    const profile = document.getElementById("expTimelineProfile");
    const snapshot = ui.timeline.snapshot();
    if (lanes) lanes.innerHTML = timelineLanesHtml(snapshot);
    if (profile) profile.innerHTML = timelineProfileHtml(snapshot);
  }

  function manualCommandFromControls() {
    const orderId = document.getElementById("expManualOrder")?.value;
    const targetRouteId = document.getElementById("expManualRoute")?.value;
    const insertMode = document.getElementById("expManualInsert")?.value;
    const anchorOrderId = document.getElementById("expManualAnchor")?.value;
    return Timeline.buildMoveCommand({ orderId, targetRouteId, insertMode, anchorOrderId, source: window.innerWidth <= 900 ? "timeline-mobile" : "timeline-desktop" });
  }

  async function executeManualCommand(command) {
    if (!ui.timeline.state.editMode) return notify(c().editRequired, "error");
    const result = await Timeline.manualTransaction(window.STCTPlanning, command.actionType, command.payload);
    const status = document.getElementById("expManualStatus");
    if (result.status === "ROLLBACK") {
      if (status) status.textContent = `${c().transactionRollback}: ${result.verifierCode}`;
      notify(`${c().transactionRollback}: ${result.verifierCode}`, "error");
      return;
    }
    const planning = window.STCTPlanning.state;
    const plan = planning.manual?.plan || result.plan;
    const lineage = planning.manual?.auditLog || plan?.meta?.manualAdjustmentAudit || [];
    await Experience.updateManualPlan(plan, ui.scenario, lineage, {
      restoreSaved: command.actionType === "UNDO",
      source: `timeline-${String(command.actionType || "manual").toLowerCase()}`,
    });
    ui.activePlan = Experience.state.verifiedPlan;
    notify(c().transactionPass);
    await rerenderMode("timeline");
    ui.timeline.setEditMode(true);
    refreshTimelineSelection();
  }

  function directorPrerequisites() {
    const context = planningContext();
    return {
      canonicalScenario: Boolean(ui.scenario?.inputHash),
      verifiedPlan: isVerified(ui.activePlan, ui.scenario),
      candidatePool: context.plans.length >= 2,
      baselinePlan: Boolean(context.baseline?.plan),
      candidatePlan: context.plans.length >= 1,
      whatIfScenario: context.whatIfResults.some((result) => result.selectedPlan && result.scenario),
      manualCapability: typeof window.STCTPlanning?.manualAction === "function",
      replayPlan: isVerified(ui.activePlan, ui.scenario),
    };
  }

  function sceneConclusion(scene) {
    if (language() === "en") return scene.conclusion;
    const translations = {
      zh: {
        "data-trust": "数据来源、场景身份、引擎与验证状态可追溯。",
        "candidate-intelligence": "候选池使用真实目标标签与 verifier 重算指标。",
        "scenario-arena": "Baseline 与 Candidate 的变化仅展示可证明证据。",
        "what-if": "输入变化与同输入改善语义严格分离。",
        "human-in-loop": "人工方案必须事务验证，并且可以撤销。",
        "mission-replay": "已验证时间表与模拟延误共享确定性状态。",
        outcome: "服务、距离、成本、CO2 与信任边界同时展示。",
      },
      ja: {
        "data-trust": "データ出所、シナリオID、エンジン、検証状態を追跡できます。",
        "candidate-intelligence": "候補プールは実際の目的ラベルと再計算指標を使用します。",
        "scenario-arena": "Baseline と Candidate の差分は証明可能な根拠だけを示します。",
        "what-if": "入力変更と同一入力の改善を厳密に分離します。",
        "human-in-loop": "手動案はトランザクション検証され、Undoできます。",
        "mission-replay": "検証済み時刻表と模擬遅延は決定論的状態を共有します。",
        outcome: "サービス、距離、コスト、CO2、信頼境界を同時に示します。",
      },
    };
    return translations[language()]?.[scene.id] || scene.conclusion;
  }

  function renderDirector() {
    const content = document.getElementById("expContent");
    if (!content) return;
    const copy = c();
    ui.director = Director.createDirectorController({
      prerequisites: directorPrerequisites(),
      reducedMotion: Experience.state.reducedMotion,
      webglAvailable: Experience.state.webglAvailable,
      mobile: window.innerWidth <= 900,
      presentationMode: true,
      captureState: () => ({ mode: ui.directorReturnMode, selectedVehicleId: Experience.state.selectedVehicleId, selectedOrderId: Experience.state.selectedOrderId, replayState: Experience.state.replayState }),
      restoreState: (snapshot) => { ui.pendingDirectorRestore = snapshot; },
      getIdentity: () => Experience.state.identity,
      onScene: () => queueMicrotask(updateDirectorView),
      onTemporarySimulation: async (event) => {
        try {
          ui.directorReplay = Replay.createReplayController(ui.activePlan, ui.scenario, { reducedMotion: Experience.state.reducedMotion, webglAvailable: Experience.state.webglAvailable });
          await ui.directorReplay.injectDelay({ ...event, source: "demo-director" });
        } catch (error) { notify(error.message, "error"); }
      },
      onClearSimulation: () => {
        ui.directorReplay?.destroy?.();
        ui.directorReplay = null;
        void Experience.resetSimulation({ source: "demo-director-clear" });
      },
      temporaryDelayEvent: { routeId: ui.activePlan.routes?.[0]?.routeId, orderId: ui.activePlan.routes?.[0]?.orderIds?.[0], minutes: 15 },
    });
    content.innerHTML = `<section class="exp-mode exp-director"><div class="exp-director-stage ${Experience.state.webglAvailable ? "" : "no-webgl"}"><div class="exp-map-host" id="expMapHost"></div><div id="expDirectorFallback"></div><div class="exp-map-boundary"><b>${esc(copy.presentation)} · 16:9 safe</b><span id="expDirectorBoundary"></span></div><div class="exp-scene-callout" id="expSceneCallout"></div></div><div class="exp-panel exp-scenes"><span class="exp-section-label">${esc(copy.sceneStory)}</span><h3>${esc(copy.sceneStory)}</h3><div class="exp-scene-list" id="expSceneList"></div><div id="expDirectorPrerequisite"></div></div><div class="exp-director-controls"><button class="exp-btn" data-director-exit>${esc(copy.exitRestore)}</button><div class="exp-scene-progress"><div class="exp-scene-progress-meta"><span id="expSceneProgressLabel"></span><span id="expSceneProgressTitle"></span></div><div class="exp-scene-dots" id="expSceneDots"></div></div><div class="exp-director-actions"><button class="exp-btn icon" data-director-previous aria-label="${esc(copy.previous)}">←</button><button class="exp-btn primary" data-director-play>▶</button><button class="exp-btn icon" data-director-next aria-label="${esc(copy.next)}">→</button></div></div></section>`;
    const host = document.getElementById("expMapHost");
    if (Experience.state.webglAvailable) mapAdapter.attach(host);
    ui.director.start(0);
    const uninstallKeyboard = ui.director.installKeyboard(window);
    Experience.registerCleanup("mode", uninstallKeyboard);
    updateDirectorView();
    content.addEventListener("click", (event) => {
      const target = event.target.closest("button");
      if (!target) return;
      if (target.dataset.directorScene) {
        ui.director.jump(Number(target.dataset.directorScene));
        updateDirectorView();
      } else if (target.matches("[data-director-previous]")) {
        ui.director.previous(); updateDirectorView();
      } else if (target.matches("[data-director-next]")) {
        ui.director.next(); updateDirectorView();
      } else if (target.matches("[data-director-play]")) {
        if (ui.director.state.status === "playing") pauseDirector(); else playDirector();
      } else if (target.matches("[data-director-exit]")) exitDirector();
    });
  }

  function directorFallbackHtml(scene) {
    const copy = c();
    return `<div class="exp-no-webgl"><div class="exp-fallback-title"><h3>${esc(scene.evidenceView)}</h3><span class="exp-chip warn">${esc(copy.mapUnavailable)}</span></div><p style="font-size:10px;color:var(--exp-muted)">${esc(copy.noWebgl)}</p><table class="exp-table"><tbody><tr><th>Scene</th><td>${scene.number} · ${esc(scene.title)}</td></tr><tr><th>Evidence</th><td>${esc(scene.evidenceView)}</td></tr><tr><th>planHash</th><td class="exp-mono">${esc(ui.activePlan.planHash)}</td></tr><tr><th>Verifier</th><td>PASS</td></tr></tbody></table></div>`;
  }

  function updateDirectorView() {
    if (!ui.director || ui.mode !== "director" || !ui.director.state.active) return;
    const copy = c();
    const snapshot = ui.director.snapshot();
    const scene = snapshot.scene;
    const boundary = document.getElementById("expDirectorBoundary");
    if (boundary) boundary.textContent = `${copy.scene} ${scene.number} / ${snapshot.sceneCount} · verified plans only`;
    const callout = document.getElementById("expSceneCallout");
    if (callout) callout.innerHTML = `<span class="kicker">${esc(copy.scene.toUpperCase())} ${scene.number} · ${esc(scene.title.toUpperCase())}</span><h3>${esc(sceneConclusion(scene))}</h3><p>${scene.prerequisite.status === "READY" ? esc(scene.conclusion) : esc(scene.prerequisite.message)}</p><div class="exp-annotations">${scene.annotations.slice(0, 3).map((annotation) => `<span>${esc(annotation)}</span>`).join("")}</div>`;
    const list = document.getElementById("expSceneList");
    if (list) list.innerHTML = snapshot.scenes.map((item, index) => `<button class="exp-scene ${item.active ? "active" : ""} ${item.complete ? "complete" : ""}" data-director-scene="${index}"><span class="exp-scene-num">${item.number}</span><span><b>${esc(item.title)}</b><small>${esc(item.prerequisite.status)}</small></span></button>`).join("");
    const prerequisite = document.getElementById("expDirectorPrerequisite");
    if (prerequisite) prerequisite.innerHTML = `<div class="exp-prerequisite ${scene.prerequisite.status === "READY" ? "" : "missing"}"><b>${esc(scene.prerequisite.status === "READY" ? copy.prerequisitesReady : copy.missing)}</b><br>${esc(scene.prerequisite.message)}</div>`;
    const dots = document.getElementById("expSceneDots");
    if (dots) dots.innerHTML = snapshot.scenes.map((item) => `<i class="${item.active ? "active" : item.complete ? "complete" : ""}"></i>`).join("");
    const label = document.getElementById("expSceneProgressLabel");
    if (label) label.textContent = `${copy.scene} ${scene.number} / ${snapshot.sceneCount}`;
    const title = document.getElementById("expSceneProgressTitle");
    if (title) title.textContent = scene.title;
    const play = document.querySelector("[data-director-play]");
    if (play) play.textContent = snapshot.status === "playing" ? "Ⅱ" : "▶";
    const fallback = document.getElementById("expDirectorFallback");
    if (!Experience.state.webglAvailable) {
      if (fallback) fallback.innerHTML = directorFallbackHtml(scene);
      return;
    }
    const context = planningContext();
    if (scene.id === "scenario-arena" || scene.id === "what-if") {
      const planA = context.baseline?.plan && isVerified(context.baseline.plan, context.baseline.scenario) ? context.baseline.plan : context.plans[0]?.plan || ui.activePlan;
      const target = scene.id === "what-if" ? context.whatIfResults.find((result) => result.selectedPlan)?.selectedPlan : context.plans.find((entry) => entry.plan.planHash !== planA.planHash)?.plan;
      const planB = target || ui.activePlan;
      const scenarioA = context.baseline?.scenario || ui.scenario;
      const scenarioB = scene.id === "what-if" ? context.whatIfResults.find((result) => result.selectedPlan === target)?.scenario || ui.scenario : ui.scenario;
      try { mapAdapter.setupArena(planA, planB, Arena.buildComparison(planA, scenarioA, planB, scenarioB), "overlay", null); } catch (error) { mapAdapter.setupPlan(ui.activePlan, `director-${scene.id}`); }
    } else if (scene.id === "mission-replay" && ui.directorReplay) {
      const middle = ui.directorReplay.model.startMinute + (ui.directorReplay.model.endMinute - ui.directorReplay.model.startMinute) * .45;
      const frame = ui.directorReplay.setTime(middle).frame;
      mapAdapter.setupReplay(ui.directorReplay.model, frame);
    } else if (scene.id === "human-in-loop") mapAdapter.setupTimeline(ui.activePlan, ui.scenario, "time-window");
    else mapAdapter.setupPlan(ui.activePlan, `director-${scene.id}`);
  }

  function playDirector() {
    ui.director.play();
    updateDirectorView();
    window.clearInterval(ui.directorInterval);
    ui.directorInterval = window.setInterval(() => {
      const before = ui.director.state.sceneIndex;
      ui.director.advance();
      updateDirectorView();
      if (ui.director.state.sceneIndex === before && before === Director.SCENES.length - 1) pauseDirector();
    }, Experience.state.reducedMotion ? 2200 : 3600);
    Experience.registerCleanup("mode", () => window.clearInterval(ui.directorInterval));
  }

  function pauseDirector() {
    window.clearInterval(ui.directorInterval);
    ui.directorInterval = 0;
    ui.director.pause();
    updateDirectorView();
  }

  async function exitDirector() {
    window.clearInterval(ui.directorInterval);
    ui.directorInterval = 0;
    const restore = ui.director.snapshot().entrySnapshot || ui.pendingDirectorRestore;
    ui.director.exit("user");
    const targetMode = restore?.mode || ui.directorReturnMode || "replay";
    if (restore?.selectedVehicleId) Experience.selectVehicle(restore.selectedVehicleId);
    if (restore?.selectedOrderId) Experience.selectOrder(restore.selectedOrderId, "director-restore");
    await switchMode(targetMode);
  }

  function cleanupMode({ detachMap = true } = {}) {
    if (ui.raf) cancelAnimationFrame(ui.raf);
    ui.raf = 0;
    window.clearInterval(ui.directorInterval);
    ui.directorInterval = 0;
    try { Experience.destroyOwner("mode"); } catch (error) {}
    if (ui.director?.state?.active) {
      try { ui.director.exit("mode-change"); } catch (error) {}
    }
    ui.director?.destroy?.();
    ui.directorReplay?.destroy?.();
    ui.replay?.destroy?.();
    ui.director = null;
    ui.directorReplay = null;
    ui.replay = null;
    ui.arena = null;
    ui.timeline = null;
    if (detachMap) mapAdapter.detach();
  }

  async function rerenderMode(mode) {
    cleanupMode();
    ui.mode = mode;
    renderShell(mode);
    await renderMode(mode);
  }

  async function renderMode(mode) {
    if (mode === "replay") renderReplay();
    else if (mode === "arena") renderArena();
    else if (mode === "timeline") renderTimeline();
    else if (mode === "director") renderDirector();
  }

  async function switchMode(mode) {
    if (!Factory.MODES.includes(mode)) return;
    if (!Experience.state.opened) return openExperience(mode);
    if (ui.mode !== "director" && mode === "director") ui.directorReturnMode = ui.mode;
    cleanupMode();
    ui.mode = mode;
    Experience.setMode(mode);
    renderShell(mode);
    await renderMode(mode);
  }

  async function openExperience(mode = "replay") {
    const context = planningContext();
    ui.mode = Factory.MODES.includes(mode) ? mode : "replay";
    if (activeViewId() !== "experienceView") ui.previousView = activeViewId();
    window.STCTCore?.switchView?.("experienceView");
    document.querySelectorAll(".navbtn").forEach((button) => button.classList.toggle("active", button.hasAttribute("data-experience-open")));
    const reducedMotion = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
    const webglAvailable = Boolean(window.STCTCore?.getMap?.());
    if (!context.plan || !context.scenario || !isVerified(context.plan, context.scenario)) {
      renderPrerequisite(Object.assign(new Error("MISSING_VERIFIED_PLAN"), { code: "MISSING_VERIFIED_PLAN" }));
      return;
    }
    ui.activePlan = context.plan;
    ui.scenario = context.scenario;
    try {
      await Experience.open({
        scenario: context.scenario,
        plan: context.plan,
        mode: ui.mode,
        comparisonLeftPlanHash: context.baseline?.plan?.planHash || context.plans[0]?.plan?.planHash || context.plan.planHash,
        comparisonRightPlanHash: context.plan.planHash,
        whatIfMetadata: context.whatIfResults,
        manualLineage: context.state.manual?.auditLog || context.plan.meta?.manualAdjustmentAudit || [],
        reducedMotion,
        webglAvailable,
      });
      renderShell(ui.mode);
      await renderMode(ui.mode);
    } catch (error) {
      console.warn("Experience open blocked", error);
      renderPrerequisite(error);
    }
  }

  function closeExperience(options = {}) {
    cleanupMode();
    if (Experience.state.opened) Experience.close({ reason: "user" });
    const root = document.getElementById("experienceRoot");
    if (root) root.innerHTML = "";
    document.querySelector("[data-experience-open]")?.classList.remove("active");
    if (options.restore !== false) window.STCTCore?.switchView?.(ui.previousView && ui.previousView !== "experienceView" ? ui.previousView : "mapView");
  }

  function install() {
    if (ui.installed) return;
    ui.installed = true;
    document.querySelector("[data-experience-open]")?.addEventListener("click", () => openExperience("replay"));
    window.addEventListener("stct:planning-state", async () => {
      if (!Experience.state.opened) return;
      const context = planningContext();
      if (!context.plan || !context.scenario || !isVerified(context.plan, context.scenario)) {
        closeExperience();
        return;
      }
      if (context.plan.planHash !== ui.activePlan?.planHash) {
        const token = ++ui.planningSyncToken;
        try {
          await Experience.selectPlan(context.plan, context.scenario, { policy: "RESET", source: "planning-state-change" });
          if (token !== ui.planningSyncToken) return;
          ui.activePlan = context.plan;
          ui.scenario = context.scenario;
          await rerenderMode(ui.mode);
          notify("Planning state changed. Simulation was reset for the new verified plan.");
        } catch (error) { notify(error.message, "error"); }
      }
    });
    window.addEventListener("resize", () => {
      if (Experience.state.opened) window.setTimeout(() => {
        mapAdapter.map?.resize?.();
        mapAdapter.splitMap?.resize?.();
      }, 60);
    });
    window.STCTExperienceUI = {
      open: openExperience,
      close: closeExperience,
      switchMode,
      rerender: () => rerenderMode(ui.mode),
      state: ui,
      mapAdapter,
      resetPerformanceCounters,
      performanceSnapshot,
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
})();
