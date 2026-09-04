(function (root, factory) {
  "use strict";
  const matrix = root?.STCTV15?.matrixProviders || (typeof require === "function" ? require("./matrix-provider-v15.js") : null);
  const capsule = root?.STCTV15?.capsules || (typeof require === "function" ? require("./scenario-capsule-v15.js") : null);
  const zones = root?.STCTV15?.serviceZones || (typeof require === "function" ? require("./service-zone-v15.js") : null);
  const diff = root?.STCTV15?.canonicalDiff || (typeof require === "function" ? require("./canonical-diff-v15.js") : null);
  const explain = root?.STCTV15?.explainability || (typeof require === "function" ? require("./explainability-v15.js") : null);
  const api = factory(root, matrix, capsule, zones, diff, explain);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV15 = root.STCTV15 || { version: "1.5.0" };
    root.STCTV15.trustLab = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, Matrix, Capsule, Zones, CanonicalDiff, Explain) {
  "use strict";

  const VERSION = "stct-planning-trust-lab-v1.5";
  const PANEL_KEYS = Object.freeze([
    "canonicalScenario", "fieldDiff", "constraints", "assumptions", "objective", "engine", "matrixProvider",
    "clientHash", "serverHash", "request", "response", "verifier", "explanation", "eventLog", "capsuleSeal",
  ]);
  const COPY = {
    zh: {
      title: "规划可信实验室 / Planning Trust Lab", subtitle: "规划证据、可重算结果与边界", expand: "展开技术面板", collapse: "折叠技术面板",
      matrix: "矩阵实验室 / Matrix Lab", provider: "矩阵提供者", profile: "车型配置", points: "点位", size: "矩阵规模", build: "构建时间", cache: "缓存", unreachable: "不可达", asymmetry: "非对称", range: "最小 / 最大", consistency: "样例路线一致性", matrixHash: "矩阵哈希",
      roadUnavailable: "Road Matrix unavailable", haversineActive: "Haversine estimate active", localOnly: "本地计算，坐标未发送到外部服务。", disabledExternal: "OSRM / Valhalla 默认禁用。",
      zones: "服务区域诊断 / Service Zone Diagnostics", showZones: "显示区域图层", zoneFilter: "区域筛选", allZones: "全部区域", membership: "订单区域归属", crossings: "路线穿越", diagnostic: "Diagnostic-only zone", notEnforced: "Not solver-enforced", noWebgl: "no-WebGL：区域诊断仍可通过列表查看。",
      capsule: "场景胶囊 / Scenario Capsule", createSeal: "生成 Capsule Seal", exportCapsule: "导出 .stct.json", sealPending: "尚未生成 Capsule。", sealReady: "Capsule 已验证，可导出。", exportBlocked: "Capsule 校验未通过，未导出。",
      statusReady: "证据面板就绪", statusWorking: "正在计算矩阵", statusError: "技术面板出现可诊断错误",
      panels: { canonicalScenario: "Canonical Scenario", fieldDiff: "Field Diff", constraints: "Constraints", assumptions: "Assumptions", objective: "Objective", engine: "Engine", matrixProvider: "Matrix Provider", clientHash: "Client Hash", serverHash: "Server-confirmed Hash", request: "Request", response: "Response", verifier: "Verifier", explanation: "Explanation", eventLog: "Event Log", capsuleSeal: "Capsule Seal" },
    },
    en: {
      title: "Planning Trust Lab", subtitle: "Planning evidence, recomputable results, and boundaries", expand: "Expand technical panel", collapse: "Collapse technical panel",
      matrix: "Matrix Lab", provider: "Provider", profile: "Profile", points: "Points", size: "Matrix size", build: "Build time", cache: "Cache", unreachable: "Unreachable", asymmetry: "Asymmetry", range: "Min / max", consistency: "Sample route consistency", matrixHash: "Matrix hash",
      roadUnavailable: "Road Matrix unavailable", haversineActive: "Haversine estimate active", localOnly: "Computed locally; coordinates were not sent to an external service.", disabledExternal: "OSRM / Valhalla are disabled by default.",
      zones: "Service Zone Diagnostics", showZones: "Show zone overlay", zoneFilter: "Zone filter", allZones: "All zones", membership: "Order memberships", crossings: "Route crossings", diagnostic: "Diagnostic-only zone", notEnforced: "Not solver-enforced", noWebgl: "No-WebGL: zone diagnostics remain available as a list.",
      capsule: "Scenario Capsule", createSeal: "Create Capsule Seal", exportCapsule: "Export .stct.json", sealPending: "No Capsule has been created.", sealReady: "Capsule verified and ready to export.", exportBlocked: "Capsule validation failed; nothing was exported.",
      statusReady: "Evidence panel ready", statusWorking: "Building matrix", statusError: "The technical panel has a diagnosable error",
      panels: { canonicalScenario: "Canonical Scenario", fieldDiff: "Field Diff", constraints: "Constraints", assumptions: "Assumptions", objective: "Objective", engine: "Engine", matrixProvider: "Matrix Provider", clientHash: "Client Hash", serverHash: "Server-confirmed Hash", request: "Request", response: "Response", verifier: "Verifier", explanation: "Explanation", eventLog: "Event Log", capsuleSeal: "Capsule Seal" },
    },
    ja: {
      title: "計画信頼ラボ / Planning Trust Lab", subtitle: "計画根拠、再計算可能な結果、適用範囲", expand: "技術パネルを展開", collapse: "技術パネルを折りたたむ",
      matrix: "マトリクスラボ / Matrix Lab", provider: "プロバイダー", profile: "プロファイル", points: "地点", size: "マトリクスサイズ", build: "構築時間", cache: "キャッシュ", unreachable: "到達不能", asymmetry: "非対称", range: "最小 / 最大", consistency: "サンプル経路整合性", matrixHash: "マトリクスハッシュ",
      roadUnavailable: "Road Matrix unavailable", haversineActive: "Haversine estimate active", localOnly: "ローカル計算。座標は外部サービスへ送信されていません。", disabledExternal: "OSRM / Valhalla は既定で無効です。",
      zones: "サービスゾーン診断 / Service Zone Diagnostics", showZones: "ゾーンレイヤーを表示", zoneFilter: "ゾーンフィルター", allZones: "全ゾーン", membership: "注文のゾーン所属", crossings: "ルート交差", diagnostic: "Diagnostic-only zone", notEnforced: "Not solver-enforced", noWebgl: "no-WebGL：ゾーン診断は一覧で確認できます。",
      capsule: "シナリオカプセル / Scenario Capsule", createSeal: "Capsule Seal を生成", exportCapsule: ".stct.json を書き出す", sealPending: "Capsule は未生成です。", sealReady: "Capsule は検証済みで書き出し可能です。", exportBlocked: "Capsule 検証失敗。書き出しません。",
      statusReady: "根拠パネル準備完了", statusWorking: "マトリクスを構築中", statusError: "技術パネルに診断可能なエラーがあります",
      panels: { canonicalScenario: "Canonical Scenario", fieldDiff: "Field Diff", constraints: "Constraints", assumptions: "Assumptions", objective: "Objective", engine: "Engine", matrixProvider: "Matrix Provider", clientHash: "Client Hash", serverHash: "Server-confirmed Hash", request: "Request", response: "Response", verifier: "Verifier", explanation: "Explanation", eventLog: "Event Log", capsuleSeal: "Capsule Seal" },
    },
  };

  let activeMount = null;
  function text(value) { return String(value ?? "").trim(); }
  function clone(value) { if (value === undefined) return undefined; if (typeof structuredClone === "function") return structuredClone(value); return JSON.parse(JSON.stringify(value)); }
  function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
  function language() { const value = root?.STCTCore?.getLanguage?.() || root?.document?.documentElement?.lang || "zh"; return String(value).startsWith("ja") ? "ja" : String(value).startsWith("en") ? "en" : "zh"; }
  function copy() { return COPY[language()] || COPY.en; }
  function node(tag, className = "", value = "") { const element = root.document.createElement(tag); if (className) element.className = className; if (value !== "") element.textContent = String(value); return element; }
  function append(parent, ...children) { children.filter(Boolean).forEach((child) => parent.appendChild(child)); return parent; }
  function json(value) { try { return JSON.stringify(value, null, 2); } catch (error) { return JSON.stringify({ status: "UNSERIALIZABLE", error: text(error.message) }, null, 2); } }
  function shortHash(value) { const body = text(value).split(":").at(-1) || "-"; return body.length > 18 ? `${body.slice(0, 10)}...${body.slice(-6)}` : body; }

  function coordinate(item) {
    const lon = Number(item?.lon ?? item?.lng ?? item?.longitude ?? item?.coordinate?.[0]);
    const lat = Number(item?.lat ?? item?.latitude ?? item?.coordinate?.[1]);
    return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
  }
  function matrixPoints(scenario = {}) {
    const points = [];
    const add = (item, id) => { const value = coordinate(item); if (value) points.push({ id: text(id), lon: value[0], lat: value[1] }); };
    add(scenario.depot, text(scenario.depot?.id || scenario.depot?.depotId || "DEPOT"));
    (scenario.orders || []).forEach((order, index) => add(order, text(order.id || order.orderId || order.code || `ORDER-${index + 1}`)));
    const unique = new Map(); points.forEach((point) => { if (point.id && !unique.has(point.id)) unique.set(point.id, point); });
    return [...unique.values()];
  }
  function range(matrix) {
    const values = (matrix?.distances || []).flat().filter((value) => Number.isFinite(Number(value)) && Number(value) > 0).map(Number);
    return values.length ? { min: Math.min(...values), max: Math.max(...values), unit: matrix.distanceUnit } : { min: 0, max: 0, unit: matrix?.distanceUnit || "km" };
  }

  function mount(options = {}) {
    if (!options.host || !Matrix || !Capsule || !Zones) return null;
    activeMount?.cleanup?.();
    const c = copy(); const scenario = options.scenario || {}; const plan = options.plan || {};
    const shell = node("section", "exp-v15-trust-lab"); shell.dataset.trustLabVersion = VERSION;
    const header = node("div", "exp-v15-trust-head");
    const title = append(node("div"), node("strong", "", c.title), node("small", "", c.subtitle));
    const status = node("span", "exp-v15-trust-status", c.statusWorking); status.dataset.status = "WORKING";
    const toggle = node("button", "exp-v15-trust-toggle", c.expand); toggle.type = "button"; toggle.setAttribute("aria-expanded", "false");
    append(header, title, status, toggle);
    const body = node("div", "exp-v15-trust-body"); body.hidden = true;
    const matrixSection = node("section", "exp-v15-trust-section exp-v15-matrix-lab");
    const zoneSection = node("section", "exp-v15-trust-section exp-v15-zone-lab");
    const capsuleSection = node("section", "exp-v15-trust-section exp-v15-capsule-lab");
    const panelsSection = node("section", "exp-v15-trust-panels");
    append(body, matrixSection, zoneSection, capsuleSection, panelsSection); append(shell, header, body);
    options.host.replaceChildren(shell);
    const panelPres = new Map();
    PANEL_KEYS.forEach((key) => {
      const details = node("details", "exp-v15-trust-detail");
      const summary = node("summary", "", c.panels[key]);
      const pre = node("pre", "exp-v15-json"); pre.textContent = "{}";
      append(details, summary, pre); panelsSection.appendChild(details); panelPres.set(key, pre);
    });
    const state = { options, shell, body, status, toggle, panelPres, matrix: null, matrixRequest: null, matrixError: null, capsule: null, seal: null, zones: Zones.createSyntheticZones({ scenario }), zoneFilter: "ALL", zoneVisible: options.webglAvailable !== false, destroyed: false, eventUnsubscribe: null, matrixPromise: null };

    function setStatus(label, code) { status.textContent = label; status.dataset.status = code; }
    function setPanel(key, value) { const pre = panelPres.get(key); if (pre) pre.textContent = json(value); }
    function engineProvenance() {
      return [{ id: text(plan.meta?.engineProvenance?.id || plan.meta?.engine || plan.meta?.source || "LOCAL_DEMO_ENGINE"), version: text(plan.meta?.engineProvenance?.version || plan.meta?.engineVersion || "UNSPECIFIED"), availability: "OBSERVED_PLAN_ONLY", planHash: text(plan.planHash) }];
    }
    function simulationState() {
      const snapshot = options.experience?.simulationStore?.snapshot?.() || {};
      return clone(snapshot);
    }
    function eventLog() { return clone(options.eventStore?.snapshot?.() || []); }
    function explanation() {
      if (!Explain?.whyThisPlan || plan.verification?.status !== "PASS") return { status: "UNAVAILABLE", reason: "A verifier-PASS plan is required." };
      try { return Explain.whyThisPlan(plan, scenario, (options.entries || []).map((entry) => entry.plan)); }
      catch (error) { return { status: "ERROR", code: text(error.code || "EXPLANATION_ERROR"), message: text(error.message) }; }
    }
    function fieldDiff() {
      if (!CanonicalDiff?.scenarioDiff || !options.baseline?.scenario) return { status: "NO_BASELINE", fieldChanges: [] };
      try { return CanonicalDiff.scenarioDiff(options.baseline.scenario, scenario, { synthetic: options.baseline.scenario?.meta?.synthetic === true && scenario?.meta?.synthetic === true }); }
      catch (error) { return { status: "ERROR", code: text(error.code || "DIFF_ERROR"), message: text(error.message) }; }
    }
    function updatePanels() {
      setPanel("canonicalScenario", scenario);
      setPanel("fieldDiff", fieldDiff());
      setPanel("constraints", scenario.constraints || { vehicleCapacities: (scenario.vehicles || []).map((vehicle) => ({ vehicleId: vehicle.id || vehicle.vehicleId, maxVolume: vehicle.maxVolume ?? vehicle.capacityVolume })), orderTimeWindows: (scenario.orders || []).map((order) => ({ orderId: order.id || order.orderId, start: order.windowStart ?? order.timeWindowStart, end: order.windowEnd ?? order.timeWindowEnd })) });
      setPanel("assumptions", { roadDistanceModel: "Haversine x factor", defaultProvider: "HAVERSINE_FALLBACK", roadNetwork: false, trafficMode: "NONE", serviceZones: Zones.BOUNDARY, simulation: "Planning simulation; not driver execution", actualGps: false });
      setPanel("objective", { goalLabel: plan.meta?.goalLabel || plan.meta?.objective || "UNSPECIFIED", recomputedMetrics: plan.verification?.recomputedMetrics || plan.metrics || {}, labels: plan.labels || [] });
      setPanel("engine", engineProvenance());
      setPanel("matrixProvider", state.matrix?.provenance || { providerId: "HAVERSINE_FALLBACK", status: state.matrixError ? "ERROR" : "BUILDING", externalProviders: "DISABLED_BY_CONFIGURATION" });
      setPanel("clientHash", { inputHash: scenario.inputHash || "", planHash: plan.planHash || "", simulationHash: simulationState().simulationHash || options.experience?.state?.simulationHash || "" });
      setPanel("serverHash", { status: "NOT_AVAILABLE_LOCAL_DEMO", serverConfirmedHash: null, boundary: "No remote server confirmation is claimed." });
      setPanel("request", state.matrixRequest || {});
      setPanel("response", state.matrix ? { matrixHash: state.matrix.matrixHash, provenance: state.matrix.provenance, dimensions: [state.matrix.sourceIds.length, state.matrix.targetIds.length] } : state.matrixError || {});
      setPanel("verifier", plan.verification || { status: "UNKNOWN" });
      setPanel("explanation", explanation());
      setPanel("eventLog", eventLog());
      setPanel("capsuleSeal", state.seal || { status: "NOT_CREATED" });
    }

    function metric(label, value, statusCode = "") {
      const item = node("div", "exp-v15-trust-metric"); if (statusCode) item.dataset.status = statusCode;
      append(item, node("span", "", label), node("b", "", value)); return item;
    }
    function renderMatrix() {
      matrixSection.replaceChildren();
      const heading = append(node("div", "exp-v15-trust-section-head"), node("strong", "", c.matrix), node("span", "exp-v15-boundary-chip", `${c.roadUnavailable} · ${c.haversineActive}`));
      const metrics = node("div", "exp-v15-trust-metrics");
      if (state.matrix) {
        const provenance = state.matrix.provenance; const values = range(state.matrix);
        [
          [c.provider, `${provenance.providerId} ${provenance.providerVersion}`], [c.profile, provenance.profile], [c.points, provenance.pointCount],
          [c.size, `${provenance.sourceCount} x ${provenance.targetCount}`], [c.build, `${number(provenance.buildTimeMs).toFixed(2)} ms`], [c.cache, provenance.cacheHit ? "HIT" : "MISS"],
          [c.unreachable, provenance.unreachablePairs.length], [c.asymmetry, provenance.asymmetry?.asymmetric ? `YES (${provenance.asymmetry.pairs.length})` : "NO"],
          [c.range, `${values.min.toFixed(2)} / ${values.max.toFixed(2)} ${values.unit}`], [c.consistency, state.matrix.sampleConsistency?.status || "NOT_SAMPLED"],
          [c.matrixHash, shortHash(state.matrix.matrixHash)],
        ].forEach(([label, value]) => metrics.appendChild(metric(label, value)));
      } else metrics.appendChild(metric(c.provider, state.matrixError?.code || c.statusWorking, state.matrixError ? "FAIL" : "WORKING"));
      append(matrixSection, heading, metrics, node("p", "exp-v15-trust-note", `${c.localOnly} ${c.disabledExternal}`));
    }

    function zoneSummary() {
      const memberships = Zones.orderMembership(scenario.orders || [], state.zones);
      const crossings = Zones.routeCrossings(plan, state.zones);
      return { memberships, crossings, zoneCount: state.zones.features.length, enforcement: Zones.ENFORCEMENT, solverEnforced: false, boundary: Zones.BOUNDARY };
    }
    function applyZoneLayer() {
      if (!options.mapAdapter || options.webglAvailable === false) return;
      if (!state.zoneVisible) { options.mapAdapter.unmountServiceZones?.(); return; }
      const mount = () => {
        if (state.destroyed || !state.zoneVisible) return;
        try { options.mapAdapter.mountServiceZones?.(state.zones, state.zoneFilter); }
        catch (error) { state.matrixError = state.matrixError || { code: text(error.code || "ZONE_LAYER_ERROR"), message: text(error.message) }; setStatus(c.statusError, "ERROR"); }
      };
      if (typeof options.mapAdapter.whenReady === "function") options.mapAdapter.whenReady(mount);
      else mount();
    }
    function renderZones() {
      zoneSection.replaceChildren();
      const heading = append(node("div", "exp-v15-trust-section-head"), node("strong", "", c.zones), node("span", "exp-v15-boundary-chip", `${c.diagnostic} · ${c.notEnforced}`));
      const controls = node("div", "exp-v15-zone-controls");
      const checkbox = node("input"); checkbox.type = "checkbox"; checkbox.checked = state.zoneVisible; checkbox.disabled = options.webglAvailable === false;
      const toggleLabel = append(node("label", "exp-v15-zone-toggle"), checkbox, node("span", "", c.showZones));
      const select = node("select", "exp-v15-select");
      [["ALL", c.allZones], ...Zones.ZONE_TYPES.map((id) => [id, id])].forEach(([value, label]) => { const option = node("option", "", label); option.value = value; option.selected = value === state.zoneFilter; select.appendChild(option); });
      const selectLabel = append(node("label", "exp-v15-field"), node("span", "", c.zoneFilter), select);
      append(controls, toggleLabel, selectLabel);
      const summary = zoneSummary();
      const metrics = append(node("div", "exp-v15-trust-metrics"), metric(c.membership, summary.memberships.filter((row) => row.memberships.length).length), metric(c.crossings, summary.crossings.length), metric(c.diagnostic, "YES"), metric(c.notEnforced, "YES"));
      append(zoneSection, heading, controls, metrics);
      if (options.webglAvailable === false) zoneSection.appendChild(node("p", "exp-v15-trust-note", c.noWebgl));
      checkbox.addEventListener("change", () => { state.zoneVisible = checkbox.checked; applyZoneLayer(); });
      select.addEventListener("change", () => { state.zoneFilter = select.value; applyZoneLayer(); });
    }

    function capsuleSource() {
      const eligiblePlans = (options.entries || [{ plan }]).map((entry) => entry.plan).filter((candidate) => candidate?.verification?.status === "PASS" && text(candidate.inputHash) === text(scenario.inputHash));
      if (!eligiblePlans.some((candidate) => text(candidate.planHash) === text(plan.planHash)) && plan.verification?.status === "PASS") eligiblePlans.push(plan);
      const incidentState = options.getIncidentState?.() || {};
      return {
        createdByVersion: VERSION,
        dataClassification: text(options.dataClassification || scenario.meta?.dataClassification || "LOCAL_DEMO_CANONICAL_DATA"),
        canonicalScenario: scenario,
        plans: eligiblePlans,
        selectedPlanHash: plan.planHash,
        verifierResults: eligiblePlans.map((candidate) => ({ planHash: candidate.planHash, verification: candidate.verification })),
        explanations: [explanation()],
        domainEvents: eventLog(),
        simulationState: simulationState(),
        incidents: incidentState.incidentHash ? [{ incidentHash: incidentState.incidentHash, phase: incidentState.phase, planningSimulation: true }] : [],
        recoveryCandidates: [],
        engineProvenance: engineProvenance(),
        matrixProvenance: state.matrix?.provenance ? [state.matrix.provenance] : [],
        viewState: { mode: options.mode || "replay", selectedPlanHash: plan.planHash, selectedVehicleId: options.experience?.state?.selectedVehicleId || "", selectedOrderId: options.experience?.state?.selectedOrderId || "", zoneFilter: state.zoneFilter },
      };
    }
    function createSeal() {
      try {
        state.capsule = Capsule.createCapsule(capsuleSource(), { eventStore: options.eventStore });
        state.seal = Capsule.capsuleSeal(state.capsule);
        setPanel("capsuleSeal", state.seal); renderCapsule(); setStatus(c.statusReady, "PASS");
        shell.dispatchEvent(new CustomEvent("stct:v15-capsule-sealed", { detail: { capsuleHash: state.capsule.capsuleHash }, bubbles: true }));
      } catch (error) {
        state.capsule = null; state.seal = { status: "FAIL", code: text(error.code || "CAPSULE_ERROR"), message: text(error.message) };
        setPanel("capsuleSeal", state.seal); renderCapsule(); setStatus(c.statusError, "ERROR");
      }
    }
    function exportCapsule() {
      if (!state.capsule) { setStatus(c.exportBlocked, "ERROR"); return; }
      try {
        const serialized = Capsule.serializeCapsule(state.capsule);
        options.download?.(`scenario-${shortHash(state.capsule.capsuleHash)}.stct.json`, serialized);
        setStatus(c.sealReady, "PASS");
      } catch (error) { setStatus(`${c.exportBlocked} ${text(error.code || error.message)}`, "ERROR"); }
    }
    function renderCapsule() {
      capsuleSection.replaceChildren();
      const heading = append(node("div", "exp-v15-trust-section-head"), node("strong", "", c.capsule), node("span", "exp-v15-boundary-chip", state.capsule ? "VERIFIED" : "NOT SEALED"));
      const actions = node("div", "exp-v15-capsule-actions");
      const sealButton = node("button", "exp-btn", c.createSeal); sealButton.type = "button";
      const exportButton = node("button", "exp-btn primary", c.exportCapsule); exportButton.type = "button"; exportButton.disabled = !state.capsule;
      append(actions, sealButton, exportButton);
      const summary = node("p", "exp-v15-trust-note", state.capsule ? `${c.sealReady} ${shortHash(state.capsule.capsuleHash)}` : state.seal?.status === "FAIL" ? `${state.seal.code}: ${state.seal.message}` : c.sealPending);
      append(capsuleSection, heading, actions, summary);
      sealButton.addEventListener("click", createSeal); exportButton.addEventListener("click", exportCapsule);
    }

    async function buildMatrix() {
      const points = matrixPoints(scenario);
      if (!points.length) throw Object.assign(new Error("Canonical Scenario has no coordinate points."), { code: "MATRIX_POINTS_REQUIRED" });
      const provider = Matrix.createHaversineProvider({ roadDistanceFactor: number(root?.STCT_CONFIG?.roadDistanceFactor, 1.35), averageSpeedKph: 32 });
      state.matrixRequest = { points, profile: "car", distanceUnit: "km", durationUnit: "minutes", departureTime: null };
      const result = await provider.matrix(state.matrixRequest);
      if (points.length > 1) {
        const route = await provider.route({ source: points[0], target: points[1], profile: "car", distanceUnit: "km", durationUnit: "minutes" });
        result.sampleConsistency = Matrix.sampleRouteConsistency(result, { ...route, sourceId: points[0].id, targetId: points[1].id });
      }
      state.matrix = result; state.matrixError = null; renderMatrix(); updatePanels(); setStatus(c.statusReady, "PASS");
      shell.dispatchEvent(new CustomEvent("stct:v15-matrix-ready", { detail: { matrixHash: result.matrixHash, providerId: result.providerId }, bubbles: true }));
      return result;
    }

    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false"); toggle.textContent = expanded ? c.collapse : c.expand; body.hidden = !expanded; shell.classList.toggle("expanded", expanded);
    });
    state.eventUnsubscribe = options.eventStore?.subscribe?.(() => { if (!state.destroyed) setPanel("eventLog", eventLog()); });
    renderMatrix(); renderZones(); renderCapsule(); updatePanels(); applyZoneLayer();
    state.matrixPromise = buildMatrix().catch((error) => { state.matrixError = { code: text(error.code || "MATRIX_BUILD_FAILED"), message: text(error.message) }; renderMatrix(); updatePanels(); setStatus(c.statusError, "ERROR"); return null; });
    state.cleanup = () => {
      if (state.destroyed) return;
      state.destroyed = true; state.eventUnsubscribe?.(); options.mapAdapter?.unmountServiceZones?.(); shell.remove();
      if (activeMount === state) activeMount = null;
    };
    activeMount = state;
    return state.cleanup;
  }

  return {
    VERSION,
    PANEL_KEYS,
    mount,
    get state() {
      if (!activeMount) return null;
      return { expanded: activeMount.toggle.getAttribute("aria-expanded") === "true", matrixStatus: activeMount.matrix ? "PASS" : activeMount.matrixError ? "FAIL" : "WORKING", matrixHash: activeMount.matrix?.matrixHash || "", capsuleHash: activeMount.capsule?.capsuleHash || "", zoneVisible: activeMount.zoneVisible, zoneFilter: activeMount.zoneFilter, matrixPromise: activeMount.matrixPromise };
    },
  };
});
