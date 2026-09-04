(function (root, factory) {
  "use strict";
  const pareto = root?.STCTV15?.pareto || (typeof require === "function" ? require("./pareto-v15.js") : null);
  const explain = root?.STCTV15?.explainability || (typeof require === "function" ? require("./explainability-v15.js") : null);
  const diff = root?.STCTV15?.canonicalDiff || (typeof require === "function" ? require("./canonical-diff-v15.js") : null);
  const engines = root?.STCTV15?.engines || (typeof require === "function" ? require("./engine-registry-v15.js") : null);
  const api = factory(root, pareto, explain, diff, engines);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV15 = root.STCTV15 || { version: "1.5.0" };
    root.STCTV15.ui = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, Pareto, Explain, CanonicalDiff, Engines) {
  "use strict";

  const VERSION = "stct-experience-ui-v1.5";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const COPY = {
    zh: {
      observed: "已观察候选前沿 / Observed Candidate Frontier",
      observedNote: "仅展示已观察且 Verifier PASS 的候选；不代表完整理论前沿。",
      scenarioGroups: "可比较组",
      crossGroup: "不同输入或服务层级不会互相计算 dominance。",
      xAxis: "横轴",
      yAxis: "纵轴",
      frontier: "前沿",
      dominated: "被支配",
      candidates: "候选等价列表",
      noWebgl: "no-WebGL 模式：SVG 与列表仍可完整操作。",
      why: "约束解释",
      whyPlan: "为什么选择此方案",
      chooseQuestion: "解释对象",
      planLevel: "方案整体",
      whyAssigned: "为什么被分配",
      whyUnassigned: "为什么未分配",
      evidence: "证据边界",
      score: "评分瀑布 / Score Waterfall",
      balancedBoundary: "Balanced Seed 是求解请求标签，与 Observed Pool Score 分开。",
      fieldDiff: "字段级差异 / Field Diff",
      noFieldChange: "Canonical 场景字段没有变化。",
      scenarioComparison: "场景比较",
      assignmentChanges: "分配变化",
      engineMatrix: "引擎能力矩阵",
      capabilityBoundary: "只显示已注册实现能力；未配置依赖不会被伪装为业务失败。",
      eventLane: "领域事件轨道 / Domain Event Lane",
      eventBoundary: "共享内存事件源；非数据库 event sourcing。",
      collapse: "折叠",
      expand: "展开",
      allTypes: "全部类型",
      allVehicles: "全部车辆",
      allRoutes: "全部路线",
      allOrders: "全部订单",
      noEvents: "当前筛选条件下没有领域事件。",
      source: "来源",
      logicalTime: "逻辑时间",
      selected: "已同步",
      plan: "方案",
      map: "地图",
      timeline: "时间轴",
      whyPanel: "解释",
    },
    ja: {
      observed: "観測候補フロンティア / Observed Candidate Frontier",
      observedNote: "観測済みかつ Verifier PASS の候補のみ。完全な理論フロンティアではありません。",
      scenarioGroups: "比較可能グループ",
      crossGroup: "入力またはサービス層が異なる候補間では dominance を計算しません。",
      xAxis: "X軸", yAxis: "Y軸", frontier: "フロンティア", dominated: "支配される候補", candidates: "候補の同等リスト",
      noWebgl: "no-WebGL モードでも SVG とリストを操作できます。",
      why: "説明パネル", whyPlan: "この計画を選ぶ理由", chooseQuestion: "説明対象", planLevel: "計画全体", whyAssigned: "割当理由", whyUnassigned: "未割当理由", evidence: "根拠の境界",
      score: "スコア・ウォーターフォール / Score Waterfall", balancedBoundary: "Balanced Seed は solver request label であり、Observed Pool Score とは別です。",
      fieldDiff: "フィールド差分 / Field Diff", noFieldChange: "Canonical シナリオのフィールド変更はありません。", scenarioComparison: "シナリオ比較", assignmentChanges: "割当変更",
      engineMatrix: "エンジン能力マトリクス", capabilityBoundary: "登録済みの実装能力のみ表示します。未設定依存関係は業務失敗ではありません。",
      eventLane: "ドメインイベントレーン / Domain Event Lane", eventBoundary: "共有メモリイベントソース。データベース event sourcing ではありません。", collapse: "折りたたむ", expand: "展開",
      allTypes: "全タイプ", allVehicles: "全車両", allRoutes: "全ルート", allOrders: "全注文", noEvents: "該当するドメインイベントはありません。", source: "ソース", logicalTime: "論理時刻",
      selected: "同期済み", plan: "計画", map: "地図", timeline: "タイムライン", whyPanel: "説明",
    },
    en: {
      observed: "Observed Candidate Frontier",
      observedNote: "Observed verifier-PASS candidates only; this is not a complete theoretical frontier.",
      scenarioGroups: "Comparable groups",
      crossGroup: "Candidates with different inputs or service tiers are never compared for dominance.",
      xAxis: "X axis", yAxis: "Y axis", frontier: "Frontier", dominated: "Dominated", candidates: "Equivalent candidate list",
      noWebgl: "No-WebGL mode: the SVG and list remain fully operable.",
      why: "Why Panel", whyPlan: "Why this plan", chooseQuestion: "Explain", planLevel: "Plan level", whyAssigned: "Why assigned", whyUnassigned: "Why unassigned", evidence: "Evidence boundary",
      score: "Score Waterfall", balancedBoundary: "Balanced Seed is a solver request label and remains separate from the Observed Pool Score.",
      fieldDiff: "Field Diff", noFieldChange: "No canonical scenario field changed.", scenarioComparison: "Scenario comparison", assignmentChanges: "Assignment changes",
      engineMatrix: "Engine Capability Matrix", capabilityBoundary: "Only registered implementation capabilities are shown. Missing dependencies are not business failures.",
      eventLane: "Domain Event Lane", eventBoundary: "Shared in-memory event source; not database event sourcing.", collapse: "Collapse", expand: "Expand",
      allTypes: "All types", allVehicles: "All vehicles", allRoutes: "All routes", allOrders: "All orders", noEvents: "No domain events match these filters.", source: "Source", logicalTime: "Logical time",
      selected: "Synced", plan: "Plan", map: "Map", timeline: "Timeline", whyPanel: "Why",
    },
  };

  let arenaMount = null;
  let eventLaneMount = null;

  function language() {
    const value = root?.STCTCore?.getLanguage?.() || root?.document?.documentElement?.lang || "zh";
    return String(value).startsWith("ja") ? "ja" : String(value).startsWith("en") ? "en" : "zh";
  }

  function copy() {
    return COPY[language()] || COPY.en;
  }

  function text(value) {
    return String(value ?? "").trim();
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function format(value, digits = 1) {
    return number(value).toLocaleString(language() === "zh" ? "zh-CN" : language() === "ja" ? "ja-JP" : "en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function shortHash(value) {
    const source = text(value).split(":").at(-1) || "-";
    return source.length > 13 ? `${source.slice(0, 7)}...${source.slice(-5)}` : source;
  }

  function node(tag, className = "", value = "") {
    const element = root.document.createElement(tag);
    if (className) element.className = className;
    if (value !== "") element.textContent = text(value);
    return element;
  }

  function svgNode(tag, attributes = {}) {
    const element = root.document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    return element;
  }

  function clear(element) {
    element?.replaceChildren();
  }

  function append(parent, ...children) {
    children.filter(Boolean).forEach((child) => parent.appendChild(child));
    return parent;
  }

  function option(value, label, selected = false) {
    const item = node("option", "", label);
    item.value = text(value);
    item.selected = selected;
    return item;
  }

  function dataValue(value) {
    if (value === null || value === undefined || value === "") return "-";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  function candidateEntry(entries, planHash) {
    return entries.find((entry) => text(entry?.plan?.planHash) === text(planHash)) || null;
  }

  function comparableGroup(report, planHash) {
    return report.groups.find((group) => group.points.some((point) => point.planHash === planHash)) || report.groups[0] || null;
  }

  function sectionHeader(title, note) {
    const header = node("div", "exp-v15-section-head");
    const titleBlock = node("div");
    append(titleBlock, node("span", "exp-section-label", title), node("p", "", note));
    append(header, titleBlock);
    return header;
  }

  function metricLabel(id) {
    const definition = Pareto.DIMENSIONS[id];
    if (!definition) return id;
    return `${definition.label} ${definition.direction === "min" ? "↓" : "↑"}`;
  }

  function createSyncState() {
    return { plan: "", map: "", timeline: "", whyPanel: "" };
  }

  function mountArena(options = {}) {
    if (!Pareto || !Explain || !CanonicalDiff || !Engines || !options.host) return null;
    if (arenaMount?.cleanup) arenaMount.cleanup();
    const entries = (options.entries || []).filter((entry) => entry?.plan?.verification?.status === "PASS" && entry.plan.verification.recomputedMetrics);
    if (!entries.length) return null;
    const plans = entries.map((entry) => entry.plan);
    const sync = createSyncState();
    const controller = Pareto.createFrontierController({
      candidates: plans,
      selectedPlanHash: options.selectedPlanHash,
      webglAvailable: options.webglAvailable !== false,
      mobile: root.innerWidth <= 900,
      selectPlan: ({ planHash }) => { sync.plan = planHash; },
      syncMap: ({ planHash }) => { sync.map = planHash; },
      syncTimeline: ({ planHash }) => { sync.timeline = planHash; },
      syncWhyPanel: ({ planHash }) => { sync.whyPanel = planHash; },
    });
    const rootElement = node("section", "exp-v15-lab");
    rootElement.dataset.v15Frontier = "observed";
    const controls = node("div", "exp-v15-controls");
    const groupSelect = node("select", "exp-v15-select");
    const xSelect = node("select", "exp-v15-select");
    const ySelect = node("select", "exp-v15-select");
    const chartHost = node("div", "exp-v15-chart-host");
    const listHost = node("div", "exp-v15-candidate-list");
    const whyHost = node("section", "exp-v15-band exp-v15-why");
    const scoreHost = node("section", "exp-v15-band exp-v15-score");
    const diffHost = node("section", "exp-v15-band exp-v15-diff");
    const engineHost = node("section", "exp-v15-band exp-v15-engines");
    const syncHost = node("div", "exp-v15-sync", "");
    const report = controller.report;
    const state = {
      options,
      entries,
      plans,
      controller,
      report,
      sync,
      rootElement,
      groupSelect,
      xSelect,
      ySelect,
      chartHost,
      listHost,
      whyHost,
      scoreHost,
      diffHost,
      engineHost,
      syncHost,
      selectedOrderId: "",
      destroyed: false,
      rendering: false,
      lastComparison: null,
      staticListenerCleanups: [],
      dynamicListenerCleanups: [],
    };

    function listen(target, event, handler, bucket = state.dynamicListenerCleanups) {
      target.addEventListener(event, handler);
      bucket.push(() => target.removeEventListener(event, handler));
    }

    function clearListeners(bucket) {
      bucket.splice(0).reverse().forEach((cleanup) => cleanup());
    }

    const intro = sectionHeader(copy().observed, copy().observedNote);
    intro.appendChild(syncHost);
    append(rootElement, intro);
    report.groups.forEach((group, index) => groupSelect.appendChild(option(group.comparableKey, `${copy().scenarioGroups} ${index + 1} · ${group.points.length}`, false)));
    Object.keys(Pareto.DIMENSIONS).forEach((id) => {
      xSelect.appendChild(option(id, metricLabel(id), id === controller.snapshot().xDimension));
      ySelect.appendChild(option(id, metricLabel(id), id === controller.snapshot().yDimension));
    });
    const groupLabel = append(node("label", "exp-v15-field"), node("span", "", copy().scenarioGroups), groupSelect);
    const xLabel = append(node("label", "exp-v15-field"), node("span", "", copy().xAxis), xSelect);
    const yLabel = append(node("label", "exp-v15-field"), node("span", "", copy().yAxis), ySelect);
    append(controls, groupLabel, xLabel, yLabel);
    const boundary = node("p", "exp-v15-boundary", copy().crossGroup);
    const frontierGrid = append(node("div", "exp-v15-frontier-grid"), chartHost, listHost);
    append(rootElement, controls, boundary, frontierGrid, whyHost, scoreHost, diffHost, engineHost);
    clear(options.host);
    options.host.appendChild(rootElement);

    function updateSync(planHash) {
      ["plan", "map", "timeline", "whyPanel"].forEach((key) => { if (!sync[key]) sync[key] = planHash; });
      syncHost.replaceChildren();
      syncHost.dataset.planHash = sync.plan;
      syncHost.dataset.mapPlanHash = sync.map;
      syncHost.dataset.timelinePlanHash = sync.timeline;
      syncHost.dataset.whyPlanHash = sync.whyPanel;
      const values = [[copy().plan, sync.plan], [copy().map, sync.map], [copy().timeline, sync.timeline], [copy().whyPanel, sync.whyPanel]];
      values.forEach(([label, hash]) => syncHost.appendChild(node("span", "", `${label} ${shortHash(hash)}`)));
    }

    function renderChart(snapshot, group) {
      clear(chartHost);
      const hashes = (group?.points || []).map((point) => point.planHash).sort();
      chartHost.dataset.candidateHashes = hashes.join(",");
      const legend = node("div", "exp-v15-chart-legend");
      append(legend, node("span", "frontier", `● ${copy().frontier}`), node("span", "dominated", `● ${copy().dominated}`));
      chartHost.appendChild(legend);
      const svg = svgNode("svg", { viewBox: "0 0 560 260", role: "group", "aria-label": copy().observed, "data-candidate-hashes": hashes.join(",") });
      svg.appendChild(svgNode("line", { x1: 36, y1: 224, x2: 536, y2: 224, class: "exp-v15-axis" }));
      svg.appendChild(svgNode("line", { x1: 36, y1: 24, x2: 36, y2: 224, class: "exp-v15-axis" }));
      const xTitle = svgNode("text", { x: 286, y: 252, class: "exp-v15-axis-label", "text-anchor": "middle" });
      xTitle.textContent = metricLabel(snapshot.xDimension);
      const yTitle = svgNode("text", { x: 13, y: 124, class: "exp-v15-axis-label", "text-anchor": "middle", transform: "rotate(-90 13 124)" });
      yTitle.textContent = metricLabel(snapshot.yDimension);
      append(svg, xTitle, yTitle);
      Pareto.projectPoints(group, snapshot.xDimension, snapshot.yDimension, 560, 260, 36).forEach((point) => {
        const item = svgNode("g", {
          class: `exp-v15-point ${point.isFrontier ? "frontier" : "dominated"} ${point.planHash === snapshot.selectedPlanHash ? "selected" : ""}`,
          role: "button",
          tabindex: "0",
          "aria-label": `${point.planId || shortHash(point.planHash)}; ${point.isFrontier ? copy().frontier : copy().dominated}`,
          "data-plan-hash": point.planHash,
        });
        item.appendChild(svgNode("circle", { cx: point.x, cy: point.y, r: point.planHash === snapshot.selectedPlanHash ? 9 : 7 }));
        const label = svgNode("text", { x: point.x + 10, y: point.y - 9, class: "exp-v15-point-label" });
        label.textContent = point.planId || shortHash(point.planHash);
        item.appendChild(label);
        listen(item, "click", () => selectPlan(point.planHash, "pointer", true));
        listen(item, "keydown", (event) => handlePointKey(event));
        svg.appendChild(item);
      });
      chartHost.appendChild(svg);
      if (options.webglAvailable === false) chartHost.appendChild(node("p", "exp-v15-no-webgl", copy().noWebgl));
    }

    function renderCandidateList(snapshot, group) {
      clear(listHost);
      const hashes = (group?.points || []).map((point) => point.planHash).sort();
      listHost.dataset.candidateHashes = hashes.join(",");
      listHost.appendChild(node("span", "exp-section-label", copy().candidates));
      const list = node("div", "exp-v15-candidates");
      (group?.points || []).forEach((point) => {
        const button = node("button", `exp-v15-candidate ${point.isFrontier ? "frontier" : "dominated"} ${point.planHash === snapshot.selectedPlanHash ? "selected" : ""}`);
        button.type = "button";
        button.dataset.planHash = point.planHash;
        button.setAttribute("aria-pressed", point.planHash === snapshot.selectedPlanHash ? "true" : "false");
        const entry = candidateEntry(entries, point.planHash);
        append(button,
          node("strong", "", entry?.label || point.planId || shortHash(point.planHash)),
          node("span", "", `${point.isFrontier ? copy().frontier : copy().dominated} · ${metricLabel(snapshot.xDimension)} ${format(point.values[snapshot.xDimension])} · ${metricLabel(snapshot.yDimension)} ${format(point.values[snapshot.yDimension])}`),
          node("small", "", shortHash(point.planHash)),
        );
        listen(button, "click", () => selectPlan(point.planHash, "list", true));
        listen(button, "keydown", (event) => handlePointKey(event));
        list.appendChild(button);
      });
      listHost.appendChild(list);
    }

    function renderPlanWhy(plan, scenario) {
      clear(whyHost);
      whyHost.appendChild(sectionHeader(copy().why, copy().whyPlan));
      const selector = node("select", "exp-v15-select");
      selector.appendChild(option("", copy().planLevel, !state.selectedOrderId));
      const assigned = Explain.assignmentIndex(plan);
      (scenario?.orders || []).slice().sort((a, b) => text(a.id || a.orderId).localeCompare(text(b.id || b.orderId), "en")).forEach((order) => {
        const orderId = text(order.id || order.orderId);
        const label = assigned.has(orderId) ? copy().whyAssigned : copy().whyUnassigned;
        selector.appendChild(option(orderId, `${orderId} · ${label}`, state.selectedOrderId === orderId));
      });
      const field = append(node("label", "exp-v15-field exp-v15-question"), node("span", "", copy().chooseQuestion), selector);
      whyHost.appendChild(field);
      const body = node("div", "exp-v15-why-body");
      whyHost.appendChild(body);
      listen(selector, "change", () => {
        state.selectedOrderId = selector.value;
        renderWhyBody(body, plan, scenario);
      });
      renderWhyBody(body, plan, scenario);
    }

    function renderWhyBody(body, plan, scenario) {
      clear(body);
      if (!state.selectedOrderId) {
        const result = Explain.whyThisPlan(plan, scenario, plans);
        const metrics = node("div", "exp-v15-metrics");
        Object.entries(result.metrics).forEach(([key, value]) => {
          const row = node("div", "exp-v15-metric");
          append(row, node("span", "", key), node("b", "", format(value)));
          metrics.appendChild(row);
        });
        body.appendChild(metrics);
        const labels = node("div", "exp-v15-label-evidence");
        (result.labels || []).forEach((item) => labels.appendChild(node("span", item.provenAgainstObservedPool ? "proven" : "boundary", `${item.label} · ${item.evidence}`)));
        if (!result.labels?.length) labels.appendChild(node("span", "boundary", "No candidate label asserted."));
        append(body, labels, node("p", "exp-v15-claim", `${copy().evidence}: ${result.evidenceAuthority.join(" + ")}`));
        return;
      }
      let result;
      try {
        result = Explain.assignmentIndex(plan).has(state.selectedOrderId)
          ? Explain.whyAssigned(state.selectedOrderId, plan, scenario, plans)
          : Explain.whyUnassigned(state.selectedOrderId, plan, scenario, plans);
      } catch (error) {
        body.appendChild(node("p", "exp-v15-error", `${error.code || "EXPLANATION_ERROR"}: ${error.message}`));
        return;
      }
      const title = node("div", "exp-v15-explanation-title");
      append(title, node("strong", "", `${result.question} · ${state.selectedOrderId}`), node("span", "", result.classification || result.confidence || "UNKNOWN"));
      body.appendChild(title);
      if (result.facts) {
        const facts = node("div", "exp-v15-facts");
        Object.entries(result.facts).forEach(([key, value]) => append(facts, node("span", "", key), node("b", "", dataValue(value))));
        body.appendChild(facts);
      }
      const explanationList = node("div", "exp-v15-explanations");
      (result.explanations || []).forEach((item) => {
        const row = node("div", `exp-v15-explanation ${String(item.severity || "").toLowerCase()}`);
        append(row,
          node("strong", "", `${item.constraintCode} · ${item.status}`),
          node("span", "", `${item.measuredValue ?? "-"} / ${item.limitValue ?? "-"} · Δ ${item.delta ?? "-"} ${item.unit || ""}`),
          node("small", "", `${item.confidence} · ${item.source}`),
        );
        explanationList.appendChild(row);
      });
      body.appendChild(explanationList);
      body.appendChild(node("p", "exp-v15-claim", result.claimBoundary || `${copy().evidence}: ${(result.evidenceAuthority || []).join(" + ")}`));
    }

    function renderScore(plan) {
      clear(scoreHost);
      const waterfall = Explain.scoreWaterfall(plan, plans);
      scoreHost.appendChild(sectionHeader(copy().score, `Observed Pool Score ${format(waterfall.displayedPoolScore, 2)} · ${waterfall.peerCount} peers`));
      const table = node("div", "exp-v15-waterfall");
      waterfall.rows.forEach((row) => {
        const item = node("div", "exp-v15-waterfall-row");
        item.dataset.dimension = row.id;
        const bar = node("i", "");
        bar.style.width = `${Math.max(0, Math.min(100, row.normalizedValue))}%`;
        const barTrack = append(node("span", "exp-v15-waterfall-bar"), bar);
        append(item,
          node("strong", "", row.label),
          node("span", "", `raw ${format(row.rawValue)} · norm ${format(row.normalizedValue)} · weight ${format(row.weight)} · contribution ${format(row.contribution, 2)}`),
          barTrack,
          node("small", "", `${row.direction} · ${row.evidenceSource}`),
        );
        table.appendChild(item);
      });
      append(scoreHost, table, node("p", "exp-v15-claim", copy().balancedBoundary));
    }

    function renderFieldDiff(entry) {
      clear(diffHost);
      const baseline = options.baseline?.scenario ? options.baseline : entries[0];
      const leftScenario = baseline?.scenario || {};
      const rightScenario = entry?.scenario || {};
      const result = CanonicalDiff.scenarioDiff(leftScenario, rightScenario, {
        synthetic: leftScenario?.meta?.synthetic === true && rightScenario?.meta?.synthetic === true,
      });
      diffHost.appendChild(sectionHeader(copy().fieldDiff, `${copy().scenarioComparison} · ${result.status} · ${result.summary.changedFields} fields`));
      const summary = node("div", "exp-v15-diff-summary");
      Object.entries(result.summary).forEach(([key, value]) => summary.appendChild(node("span", "", `${key} ${value}`)));
      diffHost.appendChild(summary);
      if (!result.fieldChanges.length) diffHost.appendChild(node("p", "exp-v15-empty", copy().noFieldChange));
      else {
        const table = node("div", "exp-v15-diff-table");
        result.fieldChanges.slice(0, 60).forEach((change) => {
          const row = node("div", "exp-v15-diff-row");
          append(row,
            node("strong", "", `${change.entityType} ${change.entityId}`),
            node("span", "", change.field),
            node("span", "", `${dataValue(change.displayBefore)} → ${dataValue(change.displayAfter)}`),
            node("small", "", change.classification),
          );
          table.appendChild(row);
        });
        diffHost.appendChild(table);
      }
      if (baseline?.plan?.verification?.status === "PASS" && entry?.plan?.verification?.status === "PASS") {
        const changed = Explain.whyChanged(baseline.plan, entry.plan, leftScenario, rightScenario);
        const assignments = node("div", "exp-v15-assignment-changes");
        assignments.appendChild(node("span", "exp-section-label", `${copy().assignmentChanges} · ${changed.assignmentChanges.length}`));
        changed.assignmentChanges.slice(0, 12).forEach((item) => assignments.appendChild(node("span", "", `${item.orderId} · ${item.type}`)));
        diffHost.appendChild(assignments);
      }
    }

    function renderEngineMatrix() {
      clear(engineHost);
      engineHost.appendChild(sectionHeader(copy().engineMatrix, copy().capabilityBoundary));
      const registry = Engines.createRegistry();
      const matrix = registry.capabilityMatrix();
      const table = node("div", "exp-v15-engine-table");
      matrix.engines.forEach((engine) => {
        const row = node("div", "exp-v15-engine-row");
        append(row,
          node("strong", "", `${engine.displayName} · ${engine.version}`),
          node("span", `status ${engine.availability === "AVAILABLE" ? "ok" : "boundary"}`, engine.availability),
          node("small", "", matrix.columns.map((key) => `${key}:${engine.capabilityMatch[key] ? "YES" : "NO"}`).join(" · ")),
        );
        table.appendChild(row);
      });
      engineHost.appendChild(table);
    }

    function renderDynamic() {
      if (state.destroyed || state.rendering) return;
      state.rendering = true;
      try {
        clearListeners(state.dynamicListenerCleanups);
        const snapshot = controller.snapshot();
        const group = comparableGroup(report, snapshot.selectedPlanHash);
        if (group) groupSelect.value = group.comparableKey;
        xSelect.value = snapshot.xDimension;
        ySelect.value = snapshot.yDimension;
        renderChart(snapshot, group);
        renderCandidateList(snapshot, group);
        const entry = candidateEntry(entries, snapshot.selectedPlanHash) || entries[0];
        if (!(entry?.scenario?.orders || []).some((order) => text(order.id || order.orderId) === state.selectedOrderId)) state.selectedOrderId = "";
        renderPlanWhy(entry.plan, entry.scenario);
        renderScore(entry.plan);
        renderFieldDiff(entry);
        updateSync(snapshot.selectedPlanHash);
      } finally {
        state.rendering = false;
      }
    }

    function selectPlan(planHash, sourceName, notifyHost) {
      const snapshot = controller.select(planHash, sourceName);
      renderDynamic();
      if (notifyHost && typeof options.onSelect === "function") options.onSelect(snapshot.selectedPlanHash, sourceName);
    }

    function handlePointKey(event) {
      if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) return;
      event.preventDefault();
      const before = controller.snapshot().selectedPlanHash;
      const snapshot = controller.handleKey(event.key);
      renderDynamic();
      if (snapshot.selectedPlanHash !== before || ["Enter", " "].includes(event.key)) {
        if (typeof options.onSelect === "function") options.onSelect(snapshot.selectedPlanHash, "keyboard");
        root.requestAnimationFrame?.(() => root.document.querySelector(`[data-v15-frontier] [data-plan-hash="${root.CSS?.escape ? root.CSS.escape(snapshot.selectedPlanHash) : snapshot.selectedPlanHash}"]`)?.focus?.());
      }
    }

    function setAxes() {
      controller.setAxes(xSelect.value, ySelect.value);
      renderDynamic();
    }

    state.renderDynamic = renderDynamic;
    listen(groupSelect, "change", () => {
      const group = report.groups.find((item) => item.comparableKey === groupSelect.value);
      if (group?.points[0]) selectPlan(group.points[0].planHash, "group", true);
    }, state.staticListenerCleanups);
    listen(xSelect, "change", setAxes, state.staticListenerCleanups);
    listen(ySelect, "change", setAxes, state.staticListenerCleanups);
    renderEngineMatrix();
    selectPlan(controller.snapshot().selectedPlanHash, "mount", false);

    state.cleanup = () => {
      if (state.destroyed) return;
      state.destroyed = true;
      clearListeners(state.dynamicListenerCleanups);
      clearListeners(state.staticListenerCleanups);
      if (options.host?.contains(rootElement)) options.host.removeChild(rootElement);
      if (arenaMount === state) arenaMount = null;
    };
    arenaMount = state;
    return state.cleanup;
  }

  function refreshArena(payload = {}) {
    const state = arenaMount;
    if (!state || state.destroyed) return null;
    state.lastComparison = payload.comparison || null;
    const planHash = text(payload.planB?.planHash);
    const current = state.controller.snapshot().selectedPlanHash;
    if (planHash && planHash !== current && candidateEntry(state.entries, planHash)) {
      state.controller.select(planHash, "arena-selector");
      state.selectedOrderId = "";
      state.sync.plan = planHash;
      state.sync.map = planHash;
      state.sync.timeline = planHash;
      state.sync.whyPanel = planHash;
      state.renderDynamic();
      state.options.host?.dispatchEvent?.(new CustomEvent("stct:v15-arena-refreshed", { detail: { planHash }, bubbles: true }));
    } else if (planHash) {
      state.sync.plan = planHash;
      state.sync.map = planHash;
      state.sync.timeline = planHash;
      state.sync.whyPanel = planHash;
      updateArenaSyncHost(state, planHash);
    }
    return { planHash, comparison: state.lastComparison };
  }

  function updateArenaSyncHost(state, planHash) {
    const copyValue = copy();
    state.syncHost.replaceChildren();
    state.syncHost.dataset.planHash = state.sync.plan || planHash;
    state.syncHost.dataset.mapPlanHash = state.sync.map || planHash;
    state.syncHost.dataset.timelinePlanHash = state.sync.timeline || planHash;
    state.syncHost.dataset.whyPlanHash = state.sync.whyPanel || planHash;
    [[copyValue.plan, state.sync.plan], [copyValue.map, state.sync.map], [copyValue.timeline, state.sync.timeline], [copyValue.whyPanel, state.sync.whyPanel]].forEach(([label, hash]) => state.syncHost.appendChild(node("span", "", `${label} ${shortHash(hash)}`)));
  }

  function eventEntity(event, key) {
    const payload = event?.payload || {};
    return text(event?.[key] || payload[key] || payload.target?.[key] || payload.entity?.[key]);
  }

  function uniqueValues(events, key) {
    return [...new Set(events.map((event) => eventEntity(event, key)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "en"));
  }

  function eventSummary(event) {
    const values = [eventEntity(event, "vehicleId"), eventEntity(event, "routeId"), eventEntity(event, "orderId")].filter(Boolean);
    const status = text(event.payload?.status || event.payload?.actionType || event.payload?.reason);
    if (status) values.push(status);
    return values.join(" · ") || `${event.aggregateType} · ${event.aggregateId}`;
  }

  function mountEventLane(options = {}) {
    if (!options.host || !options.eventStore?.filter) return null;
    if (eventLaneMount?.cleanup) eventLaneMount.cleanup();
    const legacy = root.document.getElementById("expEventFeed");
    if (legacy) {
      legacy.classList.add("exp-v15-superseded");
      legacy.dataset.sharedEventLane = "true";
    }
    const lane = node("section", "exp-v15-event-lane");
    lane.dataset.sharedSource = options.replay?.eventStore === options.eventStore ? "true" : "false";
    const header = node("div", "exp-v15-event-head");
    const title = node("div");
    append(title, node("strong", "", copy().eventLane), node("small", "", copy().eventBoundary));
    const toggle = node("button", "exp-v15-event-toggle", copy().collapse);
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "true");
    append(header, title, toggle);
    const body = node("div", "exp-v15-event-body");
    const filters = node("div", "exp-v15-event-filters");
    const typeSelect = node("select");
    const vehicleSelect = node("select");
    const routeSelect = node("select");
    const orderSelect = node("select");
    const list = node("div", "exp-v15-event-list");
    append(filters, typeSelect, vehicleSelect, routeSelect, orderSelect);
    append(body, filters, list);
    append(lane, header, body);
    clear(options.host);
    options.host.appendChild(lane);
    const state = { options, lane, body, filters, list, typeSelect, vehicleSelect, routeSelect, orderSelect, collapsed: false, selectedEventId: "", destroyed: false, unsubscribe: null, filterSourceKey: "" };

    function sourceEvents(filterSpec = {}) {
      return options.replay?.eventLane ? options.replay.eventLane(filterSpec) : options.eventStore.filter(filterSpec);
    }

    function populateFilters(events) {
      const current = { type: typeSelect.value, vehicleId: vehicleSelect.value, routeId: routeSelect.value, orderId: orderSelect.value };
      const populate = (select, allLabel, values, selected) => {
        select.replaceChildren(option("", allLabel, !selected));
        values.forEach((value) => select.appendChild(option(value, value, value === selected)));
        if (selected && !values.includes(selected)) select.value = "";
      };
      populate(typeSelect, copy().allTypes, [...new Set(events.map((event) => event.type))].sort(), current.type);
      populate(vehicleSelect, copy().allVehicles, uniqueValues(events, "vehicleId"), current.vehicleId);
      populate(routeSelect, copy().allRoutes, uniqueValues(events, "routeId"), current.routeId);
      populate(orderSelect, copy().allOrders, uniqueValues(events, "orderId"), current.orderId);
    }

    function render() {
      if (state.destroyed) return;
      const all = sourceEvents();
      const filterSourceKey = `${all.length}:${all.at(-1)?.eventId || ""}`;
      if (filterSourceKey !== state.filterSourceKey) {
        populateFilters(all);
        state.filterSourceKey = filterSourceKey;
      }
      const filterSpec = {
        type: typeSelect.value,
        vehicleId: vehicleSelect.value,
        routeId: routeSelect.value,
        orderId: orderSelect.value,
      };
      const events = sourceEvents(filterSpec);
      clear(list);
      list.dataset.eventCount = String(events.length);
      list.dataset.totalEventCount = String(events.length);
      if (!events.length) {
        list.appendChild(node("p", "exp-v15-empty", copy().noEvents));
        return;
      }
      const visibleEvents = events.slice(-40).reverse();
      list.dataset.renderedEventCount = String(visibleEvents.length);
      visibleEvents.forEach((event) => {
        const button = node("button", `exp-v15-domain-event ${event.eventId === state.selectedEventId ? "selected" : ""}`);
        button.type = "button";
        button.dataset.eventId = event.eventId;
        append(button,
          node("b", "", `${String(event.sequence).padStart(3, "0")} · ${event.type}`),
          node("span", "", eventSummary(event)),
          node("small", "", `${copy().logicalTime}: ${dataValue(event.logicalTime)} · ${copy().source}: ${event.source}`),
        );
        button.addEventListener("click", () => selectEvent(event));
        list.appendChild(button);
      });
    }

    function selectEvent(event) {
      state.selectedEventId = event.eventId;
      const vehicleId = eventEntity(event, "vehicleId");
      const orderId = eventEntity(event, "orderId");
      try {
        if (vehicleId) {
          root.STCTExperience?.selectVehicle?.(vehicleId);
          options.replay?.selectVehicle?.(vehicleId);
        }
        if (orderId) root.STCTExperience?.selectOrder?.(orderId, "domain-event-lane");
        if (Number.isFinite(Number(event.logicalTime))) options.replay?.setTime?.(Number(event.logicalTime));
      } catch (error) {
        console.warn("Domain Event Lane selection was partially applied", error);
      }
      render();
      lane.dispatchEvent(new CustomEvent("stct:v15-domain-event-selected", { detail: { eventId: event.eventId, type: event.type }, bubbles: true }));
      if (/^(CANDIDATE_|PLAN_)/.test(event.type)) root.STCTExperienceUI?.switchMode?.("arena");
      else if (/^(MANUAL_)/.test(event.type)) root.STCTExperienceUI?.switchMode?.("timeline");
    }

    [typeSelect, vehicleSelect, routeSelect, orderSelect].forEach((select) => select.addEventListener("change", render));
    toggle.addEventListener("click", () => {
      state.collapsed = !state.collapsed;
      lane.classList.toggle("collapsed", state.collapsed);
      toggle.textContent = state.collapsed ? copy().expand : copy().collapse;
      toggle.setAttribute("aria-expanded", state.collapsed ? "false" : "true");
    });
    state.unsubscribe = options.eventStore.subscribe(() => render());
    render();
    state.cleanup = () => {
      if (state.destroyed) return;
      state.destroyed = true;
      state.unsubscribe?.();
      if (legacy) {
        legacy.classList.remove("exp-v15-superseded");
        delete legacy.dataset.sharedEventLane;
      }
      if (options.host?.contains(lane)) options.host.removeChild(lane);
      if (eventLaneMount === state) eventLaneMount = null;
    };
    eventLaneMount = state;
    return state.cleanup;
  }

  const api = {
    VERSION,
    mountArena,
    refreshArena,
    mountEventLane,
    get state() {
      return {
        arena: arenaMount ? { selectedPlanHash: arenaMount.controller.snapshot().selectedPlanHash, sync: { ...arenaMount.sync } } : null,
        eventLane: eventLaneMount ? { sharedSource: eventLaneMount.lane.dataset.sharedSource, eventCount: number(eventLaneMount.list.dataset.eventCount) } : null,
      };
    },
  };
  return api;
});
