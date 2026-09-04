(function () {
  "use strict";

  const base = {
    renderOverview: window.renderOverview,
    renderExceptions: window.renderExceptions,
    renderUpload: window.renderUpload,
  };
  const esc = (value) => window.STCTUtils?.escapeHTML ? window.STCTUtils.escapeHTML(value) : String(value ?? "");
  const fmt = (value, digits = 0) => Number(value || 0).toLocaleString("zh-CN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
  const util = (value) => Number(String(value ?? "0").replace("%", "")) || 0;
  const data = () => window.STCTCore?.getData?.() || window.DATA || window.FLOWMAP_DATA || { routes: [], missingStops: [], splitRows: [], stopGeoJson: { features: [] }, daySummaries: [] };
  const planning = () => window.STCTPlanning?.state || { candidates: [] };

  function notify(message, type) {
    if (window.STCTUpload?.notify) window.STCTUpload.notify(message, type);
    else console[type === "error" ? "error" : "log"](message);
  }

  function engineStatusLabel(health, selected) {
    if (health?.forced || health?.status === "forced_heuristic") return "测试模式：已强制使用 Demo Heuristic";
    if (selected?.engine === "OR-Tools") return "OR-Tools 可用";
    if (selected?.engine === "Demo Heuristic" && selected?.meta?.engineError) {
      if (["unreachable", "timeout"].includes(health?.status)) return "优化服务连接失败 · Demo Heuristic";
      if (health?.status === "ortools_unavailable") return "OR-Tools 不可用，当前使用 Demo Heuristic";
      return "OR-Tools 回退 · Demo Heuristic";
    }
    if (health?.available) return "OR-Tools 可用";
    if (["unreachable", "timeout"].includes(health?.status)) return "优化服务连接失败 · Demo Heuristic";
    if (health?.status === "not_checked") return "尚未检测 · Demo Heuristic";
    return "OR-Tools 不可用，当前使用 Demo Heuristic";
  }

  function addPages() {
    const nav = document.querySelector(".navrail");
    if (nav && !document.querySelector('[data-view="costView"]')) {
      document.querySelector('[data-view="carbonView"]')?.insertAdjacentHTML("afterend", '<button class="navbtn" data-view="costView"><span class="ico">¥</span><span>成本</span></button><button class="navbtn" data-view="reportView"><span class="ico">▣</span><span>汇报</span></button>');
    }
    document.querySelectorAll(".navbtn[data-view]").forEach((button) => {
      if (button.dataset.stctBound) return;
      button.dataset.stctBound = "1";
      button.addEventListener("click", () => window.STCTCore?.switchView?.(button.dataset.view));
    });
    const main = document.querySelector("main");
    if (main && !document.getElementById("costView")) main.insertAdjacentHTML("beforeend", '<section id="costView" class="view"><div class="dashboard"><div class="dash-head"><div><h2>成本分析</h2><p>以本地演示成本模型比较当前路线与候选方案。</p></div></div><div id="costContent"></div></div></section>');
    if (main && !document.getElementById("reportView")) main.insertAdjacentHTML("beforeend", '<section id="reportView" class="view"><div class="dashboard"><div class="dash-head"><div><h2>方案汇报</h2><p>汇总当前应用方案、守恒状态、假设与人工复核事项。</p></div></div><div id="reportContent"></div></div></section>');
    ["optimizerGoal", "mapOptimizerGoal"].forEach((id) => {
      const select = document.getElementById(id);
      if (!select) return;
      const current = select.value;
      select.innerHTML = window.STCTOptimizer.GOALS.map((goal) => `<option value="${goal.id}">${goal.label}</option>`).join("");
      select.value = window.STCTOptimizer.GOALS.some((goal) => goal.id === current) ? current : "balanced";
    });
  }

  function sourceSelection() {
    const raw = planning().raw || window.STCTCore?.getRawData?.() || window.RAW_DATA;
    const date = document.getElementById("optimizerDate")?.value || "ALL";
    const limit = document.getElementById("optimizerLimit")?.value || "60";
    if (!raw) return { raw: null, date, limit, orders: [], vehicles: [] };
    let orders = (raw.orders || []).filter((order) => date === "ALL" || String(order.date) === date)
      .sort((a, b) => String(a.id || a.orderId || a.code || "").localeCompare(String(b.id || b.orderId || b.code || "")));
    const vehicles = (raw.vehicles || []).filter((vehicle) => !vehicle.availableDate || date === "ALL" || String(vehicle.availableDate) === date);
    const fullCount = orders.length;
    if (limit !== "ALL") orders = orders.slice(0, Number(limit));
    return { raw, date, limit, orders, vehicles, fullCount };
  }

  function qualityForSelection(selection) {
    if (!selection.raw) return null;
    return window.STCTValidator.validateRaw({ ...selection.raw, orders: selection.orders, vehicles: selection.vehicles });
  }

  function scenarioMetrics(plan) {
    return plan.metrics || window.STCTOptimizer.planMetrics(plan);
  }

  function delta(value, baseline, unit = "") {
    const change = Number(value || 0) - Number(baseline || 0);
    const percent = Number(baseline) ? change / Number(baseline) * 100 : 0;
    if (Math.abs(change) < 0.0001) return '<span class="delta same">0 (0.0%)</span>';
    return `<span class="delta ${change < 0 ? "good" : "bad"}">${change > 0 ? "+" : ""}${fmt(change, 1)}${unit} (${change > 0 ? "+" : ""}${fmt(percent, 1)}%)</span>`;
  }

  const goalName = (id) => window.STCTOptimizer.GOALS.find((goal) => goal.id === id)?.label || id;

  function renderScenarioTable(candidates, selectedId) {
    if (!candidates.length) return '<div class="empty-state">尚未生成候选方案。先确认场景输入和运力预检，再生成候选池。</div>';
    return `<div class="table-wrap"><table class="table scenario-table"><thead><tr><th>选择</th><th>planId / 实际标签</th><th>服务水平</th><th>验证</th><th>车辆</th><th>距离</th><th>完工</th><th>利用率分</th><th>成本</th><th>CO₂</th><th>综合分</th><th>引擎 / 指纹</th></tr></thead><tbody>${candidates.map((plan) => {
      const metric = scenarioMetrics(plan);
      const labels = (plan.labels || []).map((label) => `<span class="objective-label">${esc(goalName(label))}</span>`).join("");
      const requested = (plan.requestedGoals || []).map(goalName).join(" / ");
      const status = plan.verification?.status || "UNKNOWN";
      const comparable = plan.meta?.serviceLevelComparable !== false;
      return `<tr class="${selectedId === plan.planId ? "selected" : ""} ${comparable ? "" : "not-comparable"}"><td><input type="radio" name="scenarioPick" value="${esc(plan.planId)}" ${selectedId === plan.planId ? "checked" : ""}></td><td><b>${esc(plan.planId)}</b><div>${labels || '<span class="muted">未获得目标标签</span>'}</div><small>请求：${esc(requested)}</small></td><td><b>${fmt(metric.assigned)} / ${fmt(metric.assigned + metric.unassigned + metric.blocked)}</b><br>${fmt(metric.serviceRate, 1)}%${comparable ? "" : '<br><span class="warn">不可直接比较</span>'}</td><td><span class="verify-chip ${status.toLowerCase()}">${esc(status)}</span><br><small>${fmt(plan.verification?.hardViolationCount)} hard / ${fmt(plan.verification?.metricMismatchCount)} mismatch</small></td><td>${fmt(metric.usedVehicles ?? metric.vehicles)}</td><td>${fmt(metric.estimatedRoadKm ?? metric.totalDistance, 1)} km</td><td>${esc(metric.latestEnd)}</td><td>${fmt(metric.utilizationScore, 1)}<br><small>最低 ${fmt(metric.minimumRouteUtilization, 1)}%</small></td><td>¥${fmt(metric.totalCost ?? metric.cost, 1)}</td><td>${fmt(metric.totalCO2 ?? metric.co2, 1)} kg</td><td>${fmt(metric.balancedScore, 1)}</td><td>${esc(plan.engine)}<br><code>${esc(String(plan.fingerprint || "").slice(0, 12))}</code></td></tr>`;
    }).join("")}</tbody></table></div>`;
  }

  function renderGoalAudit(state) {
    return `<div class="goal-audit-grid">${window.STCTOptimizer.GOALS.map((goal) => {
      const planId = state.goalLinks?.[goal.id];
      const plan = state.candidates.find((candidate) => candidate.planId === planId);
      const metric = plan?.metrics || {};
      const value = goal.id === "distance" ? `${fmt(metric.estimatedRoadKm, 1)} km`
        : goal.id === "cost" ? `¥${fmt(metric.totalCost, 1)}`
          : goal.id === "carbon" ? `${fmt(metric.totalCO2, 1)} kg`
            : goal.id === "vehicles" ? `${fmt(metric.usedVehicles)} Vehicles`
              : goal.id === "utilization" ? `${fmt(metric.utilizationScore, 1)} 分`
                : `${fmt(metric.balancedScore, 1)} 分`;
      return `<button class="goal-audit-item ${state.selectedPlanId === planId ? "active" : ""}" data-goal-link="${goal.id}" ${planId ? "" : "disabled"}><b>${esc(goal.label)}</b><span>${planId ? esc(planId) : "尚无通过验证的候选"}</span><strong>${planId ? value : "-"}</strong></button>`;
    }).join("")}</div>`;
  }

  function renderUnassigned(plan, diagnostics = null) {
    const sourceRows = [...(plan?.blockedOrders || []), ...(plan?.unassignedOrders || [])];
    const rows = diagnostics?.orderReasons?.length ? diagnostics.orderReasons : sourceRows;
    const scenarioReasons = diagnostics?.scenarioReasons || [];
    if (!rows.length) return '<div class="success-state">订单守恒通过，当前没有未分配或阻断订单。</div>';
    const confidence = (value) => value === "deterministic" ? "确定" : value === "probable" ? "可能" : "未知";
    const scenarioPanel = `<div class="diagnostic-summary"><b>场景级原因</b>${scenarioReasons.length ? scenarioReasons.map((row) => `<span><code>${esc(row.reasonCode)}</code> · ${esc(row.severity)} · ${esc(JSON.stringify(row.evidence || {}))}</span>`).join("") : '<span>当前没有可证明的场景级原因。</span>'}</div>`;
    return `${scenarioPanel}<div class="table-wrap"><table class="table"><thead><tr><th>订单</th><th>Priority</th><th>Reason code</th><th>置信度</th><th>证据</th><th>建议动作</th></tr></thead><tbody>${rows.slice(0, 120).map((order) => `<tr><td>${esc(order.orderId || order.id || order.code)}</td><td>${esc(order.priority || "normal")} · ${fmt(order.priorityWeight || 1)}</td><td><code>${esc(order.reasonCode || "UNASSIGNED_REASON_NOT_PROVEN")}</code><br>${esc(order.reasonLabel || order.reason || "")}</td><td>${esc(confidence(order.confidence))}</td><td>${esc(JSON.stringify(order.evidence || {}))}</td><td>${esc((order.suggestedActions || [order.suggestion || "人工复核"]).join("；"))}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function assumptionsPanel(plan, raw) {
    const values = plan?.meta?.assumptionsSnapshot || planning().scenario?.assumptionsSnapshot || window.STCTOptimizer.assumptions(raw);
    const meta = plan?.meta || {};
    const cost = values.costModel || {};
    const carbon = values.carbonModel || {};
    return `<div class="assumptions-grid">
      <div><b>距离</b><span>Haversine × 道路系数</span><strong>× ${esc(values.roadDistanceFactor ?? 1.35)}</strong></div>
      <div><b>时间</b><span>平均速度 / 默认服务</span><strong>${esc(values.averageSpeedKmh ?? 28)} km/h / ${esc(values.defaultServiceMinutes ?? 5)} min</strong></div>
      <div><b>成本</b><span>固定 / km / 驾驶 min / stop</span><strong>¥${esc(cost.fixedVehicleCost ?? 120)} / ${esc(cost.perKm ?? 4.8)} / ${esc(cost.perMinute ?? 0.35)} / ${esc(cost.perStop ?? 8)}</strong></div>
      <div><b>碳排</b><span>默认车辆排放因子</span><strong>${esc(carbon.defaultVehicleFactor ?? 0.192)} kgCO₂/km</strong></div>
      <div class="span-2"><b>综合权重</b><span>${esc(JSON.stringify(values.balancedWeights || {}))}</span></div>
      <div class="span-2"><b>运行上下文</b><span>${esc(plan?.engine || "尚未求解")} · ${esc(meta.engineVersion || "-")} · ${esc(meta.generatedAt || "-")}</span></div>
    </div><div class="mini-note">估算道路距离，不是正式货车导航距离。求解结果为当前时限内 Best found，不声称全局最优。</div>`;
  }

  function renderFleetAdequacy(scenario) {
    const row = scenario?.fleetAdequacy;
    if (!row) return '<div class="empty-state">选择规划输入后显示运力下界。</div>';
    const bound = Number.isFinite(row.requiredLowerBound) ? row.requiredLowerBound : "超过现有运力";
    return `<div class="adequacy-grid"><div><b>需求</b><strong>${fmt(row.totalOrders)} Orders</strong><span>体积 ${fmt(row.totalVolume, 1)} / 重量 ${fmt(row.totalWeight, 1)}</span></div><div><b>可用运力</b><strong>${fmt(row.availableVehicles)} Vehicles</strong><span>体积 ${fmt(row.totalVolumeCapacity, 1)} / 重量 ${fmt(row.totalWeightCapacity, 1)}</span></div><div><b>车辆下界</b><strong>${esc(bound)}</strong><span>体积 ${esc(row.volumeLowerBound)} / 重量 ${esc(row.weightLowerBound)} / 班次 ${esc(row.timeLowerBound)}</span></div><div><b>100% 服务预判</b><strong>${row.theoreticallyCanServeAll ? "可能" : "当前不可能"}</strong><span>主要限制：${esc(row.primaryCapacityGap)}</span></div></div><div class="mini-note">${esc(row.note)} 阻断预检 ${fmt(row.blockedOrders?.length)} 单。</div>`;
  }

  function renderWhatIf(state) {
    if (!state.whatIfResults?.length) return '<div class="empty-state">保存 Baseline 后，可顺序测试当前车辆、+1、+2 和班次 +60 分钟。</div>';
    return `<div class="table-wrap"><table class="table"><thead><tr><th>场景 / 模板</th><th>Assigned</th><th>服务率</th><th>车辆</th><th>距离</th><th>成本</th><th>CO₂</th><th>求解层级</th><th>验证</th></tr></thead><tbody>${state.whatIfResults.map((row) => `<tr><td><b>${esc(row.label)}</b><br><code>${esc(row.scenarioId)}</code><br><small>${esc(row.template ? `${row.template.id} · 容积 ${row.template.maxVolume} · 成本 ${row.template.fixedCost} · 排放 ${row.template.emissionFactor}` : "不增加车辆")}</small></td><td>${fmt(row.metrics.assigned)} <small>(${row.delta.assigned >= 0 ? "+" : ""}${fmt(row.delta.assigned)})</small></td><td>${fmt(row.metrics.serviceRate, 1)}%</td><td>${fmt(row.metrics.usedVehicles)}</td><td>${fmt(row.metrics.estimatedRoadKm, 1)} km</td><td>¥${fmt(row.metrics.totalCost, 1)}</td><td>${fmt(row.metrics.totalCO2, 1)} kg</td><td><small>Service ${esc(row.serviceFirst?.solverStatus)}<br>Balanced ${esc(row.balancedSeed?.solverStatus)}<br>Baseline ${esc(String(row.baselinePlanHash || "").slice(0, 18))}…</small></td><td>${esc(row.verification.status)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function modeSwitch(state) {
    return `<div class="planning-mode-bar"><label>日期模式<select id="planningModeSelect" class="analysis-select"><option value="SINGLE_DAY" ${state.planningMode === "SINGLE_DAY" ? "selected" : ""}>单日规划</option><option value="MULTI_DAY_BATCH" ${state.planningMode === "MULTI_DAY_BATCH" ? "selected" : ""}>跨日汇总（按配送日独立规划）</option></select></label><span>${state.planningMode === "MULTI_DAY_BATCH" ? "每个配送日独立使用当日可用车队，不把多日需求压缩为一次车队容量。" : "单一配送日可生成六目标候选、What-if 和人工调整。"}</span></div>`;
  }

  function renderMultiDayBatch(state, selection) {
    const batch = state.multiDay;
    const aggregate = batch?.aggregate || {};
    const rows = batch?.childScenarios || [];
    return `${modeSwitch(state)}<div class="card span-12"><div class="card-heading"><div><h3>跨日汇总</h3><p class="mini-note">每个配送日独立构建 Canonical Scenario、重新筛选车辆并求解。父级不生成跨日路线，也不能直接进入人工调度。</p></div><span class="engine-chip ${state.generating ? "fallback" : "online"}">${esc(state.generating ? state.progress : state.phase)}</span></div><div class="scenario-controls"><label>汇总范围<select id="multiDayLimit"><option value="60">前 60 单</option><option value="120">前 120 单</option><option value="240">前 240 单</option><option value="ALL">全部订单</option></select></label></div><div class="optimizer-actions"><button class="primary-btn" id="runMultiDayBtn" ${selection.raw && !state.generating ? "" : "disabled"}>构建并运行跨日汇总</button><button class="ghost-btn" id="cancelMultiDayBtn" ${state.generating ? "" : "disabled"}>取消剩余日期</button></div></div>
    ${batch ? `<div class="optimizer-kpi"><div class="card"><h3>日期数量</h3><div class="big-num">${fmt(batch.dateCount)}</div><div class="muted">完成 ${fmt(batch.completedDates)} / ${fmt(batch.dateCount)}</div></div><div class="card"><h3>总订单</h3><div class="big-num">${fmt(batch.totalOrders)}</div><div class="muted">日均 ${fmt(batch.averageOrdersPerDay, 1)} · 峰值 ${fmt(batch.peakDayOrders)}</div></div><div class="card"><h3>加权服务率</h3><div class="big-num">${fmt(aggregate.serviceRate, 1)}%</div><div class="muted">Assigned ${fmt(aggregate.assigned)} · 未分配 ${fmt(aggregate.unassigned)}</div></div><div class="card"><h3>峰值车辆</h3><div class="big-num">${fmt(aggregate.peakUsedVehicles)}</div><div class="muted">每日可用 ${fmt(batch.minAvailableVehicles)}–${fmt(batch.maxAvailableVehicles)}</div></div></div><div class="card span-12"><div class="trust-list"><div><b>Batch contentHash</b><span>${esc(batch.batchContentHash)}</span></div><div><b>Aggregate hash</b><span>${esc(batch.aggregateHash)}</span></div><div><b>守恒</b><span>${fmt(batch.conservation.input)} = ${fmt(batch.conservation.assigned)} + ${fmt(batch.conservation.unassigned)} + ${fmt(batch.conservation.blocked)} + pending ${fmt(batch.conservation.pending)} + failed ${fmt(batch.conservation.failed)}</span></div></div></div><div class="card span-12"><h3>每日子场景</h3><div class="table-wrap"><table class="table"><thead><tr><th>配送日</th><th>订单</th><th>车辆</th><th>inputHash</th><th>状态</th><th>服务率</th><th>使用车辆</th><th>距离</th><th>进入</th></tr></thead><tbody>${rows.map((child) => `<tr><td>${esc(child.scenario.planningDate)}</td><td>${fmt(child.scenario.orders.length)}</td><td>${fmt(child.scenario.vehicles.length)}</td><td><code>${esc(child.scenario.inputHash.slice(0, 20))}…</code></td><td>${esc(child.status)}${child.error ? `<br><small>${esc(child.error)}</small>` : ""}</td><td>${child.selectedPlan ? `${fmt(child.selectedPlan.metrics.serviceRate, 1)}%` : "-"}</td><td>${child.selectedPlan ? fmt(child.selectedPlan.metrics.usedVehicles) : "-"}</td><td>${child.selectedPlan ? `${fmt(child.selectedPlan.metrics.estimatedRoadKm, 1)} km` : "-"}</td><td><button class="ghost-btn" data-child-date="${esc(child.scenario.planningDate)}">进入单日</button></td></tr>`).join("")}</tbody></table></div></div>` : '<div class="card span-12"><div class="empty-state">选择订单范围后构建跨日汇总。60 / 120 / 240 指原始数据范围，只用于日期拆分，不再冒充同日运力压力测试。</div></div>'}`;
  }

  function renderManual(state, selected) {
    if (!selected) return '<div class="empty-state">选择通过验证的方案后可进入人工调度。</div>';
    if (!state.manual?.active) return `<button class="ghost-btn" id="startManualBtn" ${selected.verification?.status === "FAIL" ? "disabled" : ""}>进入人工调度</button><div class="mini-note">支持路线锁定、订单移线、加入未分配池、顺序调整、撤销和重置。</div>`;
    const plan = state.manual.plan;
    const stops = plan.stopGeoJson?.features || [];
    const routes = plan.routes || [];
    const unassigned = plan.unassignedOrders || [];
    const orderOptions = stops.map((feature) => `<option value="${esc(feature.properties?.orderId)}">${esc(feature.properties?.routeId)} · ${esc(feature.properties?.orderId)} · ${esc(feature.properties?.name || "")}</option>`).join("");
    const unassignedOptions = unassigned.map((order) => `<option value="${esc(order.id)}">${esc(order.id)} · ${esc(order.name || order.code || "")}</option>`).join("");
    const routeOptions = routes.map((route) => `<option value="${esc(route.routeId)}">${esc(route.routeId)} · ${esc(route.vehicleId)}</option>`).join("");
    const anchorOptions = stops.map((feature) => `<option value="${esc(feature.properties?.orderId)}">${esc(feature.properties?.routeId)} · ${esc(feature.properties?.seq)} · ${esc(feature.properties?.orderId)}</option>`).join("");
    const status = plan.verification?.status || "UNKNOWN";
    const lastAction = state.manual.auditLog?.at(-1);
    return `<div class="trust-list manual-trust"><div><b>Base Plan</b><span>${esc(state.manual.basePlanId)} · ${esc(state.manual.basePlanHash)}</span></div><div><b>Revision</b><span>Plan ${fmt(state.manual.revision)} · Editor ${fmt(state.manual.editorRevision)}</span></div><div><b>Plan Hash</b><span>${esc(plan.planHash)}</span></div><div><b>Editor State</b><span>${esc(state.manual.editorStateHash)}</span></div><div><b>Last Action</b><span>${esc(lastAction ? `${lastAction.actionId} · ${lastAction.actionType}` : "无")}</span></div></div><div class="manual-toolbar"><label>路线内订单<select id="manualOrderSelect">${orderOptions}</select></label><label>目标路线<select id="manualTargetRoute">${routeOptions}</select></label><label>插入方式<select id="manualInsertMode"><option value="APPEND">路线末尾</option><option value="AFTER">指定停靠点之后</option><option value="AUTO_MIN_DELTA">自动最小增量位置</option></select></label><label>指定停靠点<select id="manualAnchorOrder">${anchorOptions}</select></label><button class="ghost-btn" id="manualMoveBtn">移至路线</button><button class="icon-btn" id="manualUpBtn" title="上移">↑</button><button class="icon-btn" id="manualDownBtn" title="下移">↓</button><button class="ghost-btn" id="manualRemoveBtn">移回未分配池</button></div><div class="manual-toolbar"><label>未分配订单<select id="manualUnassignedSelect">${unassignedOptions || '<option value="">无</option>'}</select></label><button class="ghost-btn" id="manualAddBtn" ${unassigned.length ? "" : "disabled"}>加入选定路线</button><button class="ghost-btn" id="manualUndoBtn" ${state.manual.history.length ? "" : "disabled"}>撤销</button><button class="ghost-btn" id="manualResetBtn">重置求解器方案</button><button class="ghost-btn" id="manualCloseBtn">退出编辑</button></div><div class="route-locks">${routes.map((route) => `<button class="route-lock ${state.manual.lockedRouteIds.includes(route.routeId) ? "locked" : ""}" data-lock-route="${esc(route.routeId)}">${state.manual.lockedRouteIds.includes(route.routeId) ? "已锁定" : "锁定"} ${esc(route.routeId)}</button>`).join("")}</div><div class="verification-summary ${status.toLowerCase()}"><b>Verifier ${esc(status)}</b><span>${fmt(plan.verification?.hardViolationCount)} hard · ${fmt(plan.verification?.metricMismatchCount)} mismatch · ${fmt(state.manual.actions.length)} active actions · ${fmt(state.manual.lockedRouteIds.length)} locked</span></div>`;
  }

  async function generateAll(button) {
    if (planning().generating) return;
    try {
      button.disabled = true;
      if (planning().planningMode === "MULTI_DAY_BATCH") {
        await window.STCTPlanning.generateMultiDayBatch({ limit: document.getElementById("multiDayLimit")?.value || "ALL" });
        notify("跨日子场景已按配送日独立构建并审计。", "success");
        return;
      }
      await window.STCTOptimizer.generateScenarios();
      window.STCTCore?.setOptimizerPlan?.(window.STCTPlanning.currentCandidate());
      notify("候选池已生成并由独立 verifier 复核。", "success");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      button.disabled = false;
      renderOptimizer();
    }
  }

  function renderOptimizer() {
    const element = document.getElementById("optimizerContent");
    if (!element) return;
    const state = planning();
    const selection = sourceSelection();
    if (state.planningMode === "MULTI_DAY_BATCH") {
      element.innerHTML = renderMultiDayBatch(state, selection);
      const limitControl = document.getElementById("multiDayLimit");
      if (limitControl) limitControl.value = state.multiDay?.requestedOrderLimit || selection.limit || "ALL";
      document.getElementById("planningModeSelect")?.addEventListener("change", (event) => { window.STCTPlanning.setPlanningMode(event.target.value); renderOptimizer(); });
      document.getElementById("runMultiDayBtn")?.addEventListener("click", async (event) => { try { await generateAll(event.currentTarget); } finally { renderOptimizer(); } });
      document.getElementById("cancelMultiDayBtn")?.addEventListener("click", () => { window.STCTPlanning.cancelMultiDayBatch(); renderOptimizer(); });
      document.querySelectorAll("[data-child-date]").forEach((button) => button.addEventListener("click", () => { try { window.STCTPlanning.enterMultiDayChild(button.dataset.childDate); const date = document.getElementById("optimizerDate"); if (date) date.value = button.dataset.childDate; renderOptimizer(); } catch (error) { notify(error.message, "error"); } }));
      if (typeof window.applyLanguage === "function") window.applyLanguage(document.getElementById("loginLang")?.value || "zh");
      return;
    }
    const previewScenario = selection.raw ? {
      actualOrderCount: selection.orders.length,
      availableOrderCount: selection.fullCount,
      planningDate: selection.date,
      orders: selection.orders,
      vehicles: selection.vehicles,
      fleetAdequacy: state.scenario?.planningDate === selection.date ? state.scenario.fleetAdequacy : null,
    } : null;
    const quality = qualityForSelection(selection);
    const selected = window.STCTPlanning?.currentCandidate?.() || null;
    const maxOrders = Number(window.STCT_CONFIG?.maxOptimizerOrders || 500);
    const tooLarge = (previewScenario?.actualOrderCount || 0) > maxOrders;
    const canGenerate = Boolean(selection.raw && selection.date !== "ALL" && previewScenario?.orders?.length && quality?.canApply && !tooLarge && !state.generating && !state.whatIfRunning);
    const conservation = selected?.conservation;
    const engineLabel = engineStatusLabel(state.engineHealth, selected);
    const verificationPass = selected && selected.verification?.status !== "FAIL" && conservation?.balanced;
    const diagnostics = state.scenario && selected ? window.STCTVerifier.diagnostics(selected, state.scenario) : null;
    const settings = state.scenarioSettings || {};
    const templateVehicles = state.scenario?.vehicles?.length ? state.scenario.vehicles : selection.vehicles;
    const templateOptions = (templateVehicles || []).map((vehicle) => {
      const id = vehicle.id || vehicle.vehicleId;
      return `<option value="${esc(id)}">${esc(vehicle.name || vehicle.vehicleName || id)} · ${esc(vehicle.type || vehicle.vehicleType || "-")} · ${fmt(vehicle.maxVolume, 1)} m³</option>`;
    }).join("");
    element.innerHTML = `<div class="optimizer-kpi"><div class="card"><h3>Scenario Orders</h3><div class="big-num">${fmt(previewScenario?.actualOrderCount || 0)}</div><div class="muted">可用 ${fmt(previewScenario?.availableOrderCount || 0)} · ${esc(previewScenario?.planningDate || "-")}</div></div><div class="card"><h3>可规划率</h3><div class="big-num">${fmt(quality?.metrics?.plannableRate || 0, 1)}%</div><div class="muted">阻断 ${fmt(quality?.metrics?.blockedOrderRows || 0)}</div></div><div class="card"><h3>Scenario Vehicles</h3><div class="big-num">${fmt(previewScenario?.vehicles?.length || 0)}</div><div class="muted">虚拟车辆 ${fmt(settings.virtualVehicleCount || 0)}</div></div><div class="card"><h3>规划状态</h3><div class="status-word">${esc(state.generating || state.whatIfRunning ? state.progress : state.phase)}</div><div class="muted">${esc(state.scenario?.scenarioId || state.batchId)}</div></div></div>
    <div class="card span-12"><div class="card-heading"><div><h3>Planning Scenario</h3><p class="mini-note">单一输入快照。六个目标共享完全相同的订单、车辆、约束和假设。</p></div><span class="engine-chip ${selected?.engine === "OR-Tools" || (!selected && state.engineHealth.available) ? "online" : "fallback"}">${esc(engineLabel)}</span></div><div class="scenario-controls"><label>求解时限<select id="scenarioTimeLimit"><option value="4">4 秒</option><option value="8">8 秒</option><option value="12">12 秒</option><option value="20">20 秒</option></select></label><label>平均速度<input id="scenarioAverageSpeed" type="number" min="5" max="120" step="1" value="${esc(settings.averageSpeedKmh || previewScenario?.assumptionsSnapshot?.averageSpeedKmh || 28)}"></label><label>每停靠服务<input id="scenarioServiceMinutes" type="number" min="0" max="120" step="1" value="${esc(settings.defaultServiceMinutes || previewScenario?.assumptionsSnapshot?.defaultServiceMinutes || 5)}"></label><label>道路系数<input id="scenarioRoadFactor" type="number" min="1" max="3" step="0.05" value="${esc(settings.roadDistanceFactor || previewScenario?.assumptionsSnapshot?.roadDistanceFactor || 1.35)}"></label><label>班次延长<select id="scenarioShiftExtension"><option value="0">0 分钟</option><option value="60">+60 分钟</option></select></label><label>虚拟同型车<select id="scenarioVirtualVehicles"><option value="0">0 辆</option><option value="1">+1 辆</option><option value="2">+2 辆</option></select></label><label>新增车辆模板<select id="scenarioVehicleTemplate">${templateOptions || '<option value="">无可用车辆</option>'}</select></label></div>${state.staleReason ? `<div class="warning-state">${esc(state.staleReason)}</div>` : ""}${tooLarge ? `<div class="warning-state">当前场景超过本地上限 ${maxOrders} 单。</div>` : ""}<div class="optimizer-actions"><button class="primary-btn" id="generateScenarioBtn" ${canGenerate ? "" : "disabled"}>${state.generating ? `正在生成 ${esc(state.progress)}` : "生成并审计候选池"}</button><button class="ghost-btn" id="saveBaselineBtn" ${selected ? "" : "disabled"}>保存 Baseline</button><button class="ghost-btn" id="restoreBaselineBtn" ${state.baseline ? "" : "disabled"}>恢复 Baseline</button><button class="ghost-btn" id="runWhatIfBtn" ${selected && !state.whatIfRunning ? "" : "disabled"}>评估增加车辆后的改善</button><button class="ghost-btn" id="applyScenarioBtn" ${verificationPass && !state.generating ? "" : "disabled"}>应用所选方案</button><button class="ghost-btn" id="restoreScenarioBtn" ${state.beforeApply ? "" : "disabled"}>恢复应用前方案</button></div></div>
    <div class="card span-12"><h3>求解前 Fleet Adequacy</h3>${renderFleetAdequacy(previewScenario)}</div>
    <div class="card span-12"><h3>目标审计</h3>${renderGoalAudit(state)}<div class="mini-note">目标标签由通过验证的最佳服务水平候选池按实际指标授予。同一 plan 可以获得多个标签。</div></div>
    <div class="card span-12"><h3>去重候选池</h3>${renderScenarioTable(state.candidates, state.selectedPlanId)}</div>
    <div class="dash-grid" style="margin-top:14px"><div class="card span-7"><h3>所选方案路线</h3><div class="optimizer-route-list">${(selected?.routes || []).map((route) => `<div class="optimizer-route-card"><b>${esc(route.routeId)}</b><div class="mini-note">Vehicle ${esc(route.vehicleId)} · ${fmt(route.orders)} Orders · ${fmt(route.km, 1)} km · ${esc(route.end)}</div><span class="optimizer-badge">有效利用率 ${fmt(Math.max(util(route.volumeUtil), util(route.weightUtil)), 1)}%</span><span class="optimizer-badge">成本 ¥${fmt(route.estimatedCost, 0)}</span><span class="optimizer-badge">CO₂ ${fmt(route.estimatedCo2, 1)} kg</span></div>`).join("") || '<div class="empty-state">尚无规划结果。</div>'}</div></div><div class="card span-5"><h3>Trust / Quality</h3>${selected ? `<div class="trust-list"><div><b>Contract</b><span>${esc(selected.contractVersion)} · ${esc(selected.canonicalVersion)}</span></div><div><b>Content Hash</b><span>${esc(selected.contentHash)}</span></div><div><b>Input Hash</b><span>${esc(selected.inputHash)}</span></div><div><b>Request Hash</b><span>${esc(selected.requestHash)}</span></div><div><b>Plan Hash</b><span>${esc(selected.planHash)}</span></div><div><b>Server Hash</b><span>${selected.serverHashVerified === true ? "PASS · VERIFIED" : "FAIL · NOT VERIFIED"}</span></div><div><b>Mode / Date</b><span>${esc(state.planningMode)} · ${esc(state.scenario?.planningDate)}</span></div><div><b>Engine</b><span>${esc(selected.engine)} · ${esc(selected.meta?.actualEngineVersion || selected.meta?.engineVersion)}</span></div><div><b>Solver</b><span>${esc(selected.meta?.solveStats?.status || "BEST_FOUND")} · ${fmt(selected.meta?.solveStats?.solveMs)} ms</span></div><div><b>Verifier</b><span>${esc(selected.verification?.status)} · ${fmt(selected.verification?.hardViolationCount)} hard</span></div><div><b>守恒</b><span>${conservation?.input} = ${conservation?.assigned} + ${conservation?.unassigned} + ${conservation?.blocked}</span></div></div>` : '<div class="empty-state">尚无规划结果。</div>'}</div></div>
    <div class="card span-12"><h3>未分配诊断</h3>${renderUnassigned(selected, diagnostics)}${diagnostics ? `<div class="diagnostic-summary"><b>主要限制：${esc(diagnostics.primaryConstraint)}</b><span>未分配体积 ${fmt(diagnostics.unassignedVolume, 1)} · 重量 ${fmt(diagnostics.unassignedWeight, 1)}</span><span>${esc(diagnostics.suggestedActions.join("；"))}</span></div>` : ""}</div>
    <div class="card span-12"><h3>What-if 对比</h3>${renderWhatIf(state)}</div>
    <div class="card span-12"><h3>有限人工调度</h3>${renderManual(state, selected)}</div>
    <div class="card span-12"><h3>模型假设与边界</h3>${assumptionsPanel(selected, selection.raw)}</div>`;

    element.insertAdjacentHTML("afterbegin", modeSwitch(state));
    document.getElementById("planningModeSelect")?.addEventListener("change", (event) => { window.STCTPlanning.setPlanningMode(event.target.value); renderOptimizer(); });
    const setControl = (id, value) => { const node = document.getElementById(id); if (node) node.value = String(value); };
    setControl("scenarioTimeLimit", settings.timeLimitSeconds || 8);
    setControl("scenarioShiftExtension", settings.shiftExtensionMinutes || 0);
    setControl("scenarioVirtualVehicles", settings.virtualVehicleCount || 0);
    setControl("scenarioVehicleTemplate", settings.virtualVehicleTemplateId || templateVehicles?.[0]?.id || templateVehicles?.[0]?.vehicleId || "");
    document.getElementById("generateScenarioBtn")?.addEventListener("click", (event) => generateAll(event.currentTarget));
    ["scenarioTimeLimit", "scenarioAverageSpeed", "scenarioServiceMinutes", "scenarioRoadFactor", "scenarioShiftExtension", "scenarioVirtualVehicles", "scenarioVehicleTemplate"].forEach((id) => document.getElementById(id)?.addEventListener("change", (event) => {
      const map = { scenarioTimeLimit: "timeLimitSeconds", scenarioAverageSpeed: "averageSpeedKmh", scenarioServiceMinutes: "defaultServiceMinutes", scenarioRoadFactor: "roadDistanceFactor", scenarioShiftExtension: "shiftExtensionMinutes", scenarioVirtualVehicles: "virtualVehicleCount", scenarioVehicleTemplate: "virtualVehicleTemplateId" };
      window.STCTPlanning.updateSettings({ [map[id]]: id === "scenarioVehicleTemplate" ? event.target.value : Number(event.target.value) });
      renderOptimizer();
    }));
    document.querySelectorAll("[data-goal-link]").forEach((button) => button.addEventListener("click", () => { window.STCTPlanning.selectScenario(button.dataset.goalLink); window.STCTCore?.setOptimizerPlan?.(window.STCTPlanning.currentCandidate()); renderOptimizer(); }));
    document.querySelectorAll('input[name="scenarioPick"]').forEach((radio) => radio.addEventListener("change", (event) => { window.STCTPlanning.selectScenario(event.target.value); window.STCTCore?.setOptimizerPlan?.(window.STCTPlanning.currentCandidate()); renderOptimizer(); }));
    document.getElementById("saveBaselineBtn")?.addEventListener("click", () => { try { window.STCTPlanning.saveBaseline(); notify("Baseline 已保存。", "success"); renderOptimizer(); } catch (error) { notify(error.message, "error"); } });
    document.getElementById("restoreBaselineBtn")?.addEventListener("click", () => { try { window.STCTPlanning.restoreBaseline(); notify("Baseline 参数和方案已恢复。", "success"); renderOptimizer(); } catch (error) { notify(error.message, "error"); } });
    document.getElementById("runWhatIfBtn")?.addEventListener("click", async () => { try { await window.STCTPlanning.evaluateCapacityOptions(); notify("运力 What-if 已完成。", "success"); } catch (error) { notify(error.message, "error"); } finally { renderOptimizer(); } });
    document.getElementById("applyScenarioBtn")?.addEventListener("click", async () => { try { const plan = await window.STCTPlanning.applySelected(); window.STCTCore?.setOptimizerPlan?.(plan); window.STCTCore?.switchView?.("mapView"); notify("验证通过的方案已应用。", "success"); } catch (error) { notify(error.message, "error"); } });
    document.getElementById("restoreScenarioBtn")?.addEventListener("click", () => { try { window.STCTPlanning.restore(); window.STCTCore?.setOptimizerPlan?.(null); notify("已恢复应用前方案。", "success"); renderOptimizer(); } catch (error) { notify(error.message, "error"); } });
    document.getElementById("startManualBtn")?.addEventListener("click", async () => { try { await window.STCTPlanning.startManual(); renderOptimizer(); } catch (error) { notify(error.message, "error"); } });
    const manualOrder = () => document.getElementById("manualOrderSelect")?.value;
    const targetRoute = () => document.getElementById("manualTargetRoute")?.value;
    const manualRun = async (type, payload) => { try { await window.STCTPlanning.manualAction(type, payload); renderOptimizer(); } catch (error) { notify(error.message, "error"); } };
    const insertPayload = () => ({ insertMode: document.getElementById("manualInsertMode")?.value, anchorOrderId: document.getElementById("manualAnchorOrder")?.value });
    document.getElementById("manualMoveBtn")?.addEventListener("click", () => manualRun("MOVE_ORDER", { orderId: manualOrder(), toRouteId: targetRoute(), ...insertPayload() }));
    document.getElementById("manualUpBtn")?.addEventListener("click", () => manualRun("REORDER_STOP", { orderId: manualOrder(), direction: "up" }));
    document.getElementById("manualDownBtn")?.addEventListener("click", () => manualRun("REORDER_STOP", { orderId: manualOrder(), direction: "down" }));
    document.getElementById("manualRemoveBtn")?.addEventListener("click", () => manualRun("REMOVE_TO_UNASSIGNED", { orderId: manualOrder() }));
    document.getElementById("manualAddBtn")?.addEventListener("click", () => manualRun("ADD_UNASSIGNED", { orderId: document.getElementById("manualUnassignedSelect")?.value, toRouteId: targetRoute(), ...insertPayload() }));
    document.querySelectorAll("[data-lock-route]").forEach((button) => button.addEventListener("click", () => manualRun("TOGGLE_ROUTE_LOCK", { routeId: button.dataset.lockRoute }))); 
    document.getElementById("manualUndoBtn")?.addEventListener("click", async () => { try { await window.STCTPlanning.undoManual(); renderOptimizer(); } catch (error) { notify(error.message, "error"); } });
    document.getElementById("manualResetBtn")?.addEventListener("click", () => { try { window.STCTPlanning.resetManual(); renderOptimizer(); } catch (error) { notify(error.message, "error"); } });
    document.getElementById("manualCloseBtn")?.addEventListener("click", () => { window.STCTPlanning.stopManual(); renderOptimizer(); });
    if (typeof window.applyLanguage === "function") window.applyLanguage(document.getElementById("loginLang")?.value || "zh");
  }

  function currentSummary(routes = data().routes || []) {
    const metrics = window.STCTOptimizer.planMetrics({ ...data(), routes });
    return metrics;
  }

  function bucketHtml(routes, field) {
    const buckets = [["<40%", (route) => util(route[field]) < 40], ["40-70%", (route) => util(route[field]) >= 40 && util(route[field]) < 70], ["70-90%", (route) => util(route[field]) >= 70 && util(route[field]) < 90], ["≥90%", (route) => util(route[field]) >= 90]];
    const max = Math.max(1, ...buckets.map((bucket) => routes.filter(bucket[1]).length));
    return `<div class="rank">${buckets.map((bucket) => { const count = routes.filter(bucket[1]).length; return `<div class="rank-row"><b>${bucket[0]}</b><div class="bar"><i style="width:${count / max * 100}%"></i></div><span>${count} Routes</span></div>`; }).join("")}</div>`;
  }

  function topTable(title, rows) {
    return `<div class="card span-4"><h3>${title}</h3><table class="table"><thead><tr><th>Route</th><th>Vehicle</th><th>距离</th><th>容积</th></tr></thead><tbody>${rows.map((route) => `<tr><td>${esc(route.routeId)}</td><td>${esc(route.vehicleId)}</td><td>${fmt(route.km, 1)} km</td><td>${esc(route.volumeUtil)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function renderAnalysis() {
    const element = document.getElementById("analysisContent");
    if (!element) return;
    const routes = (data().routes || []).slice();
    const summary = currentSummary(routes);
    const conservation = data().conservation || { input: summary.assigned + summary.unassigned + summary.blocked, assigned: summary.assigned, unassigned: summary.unassigned, blocked: summary.blocked };
    const assignedRate = conservation.input ? conservation.assigned / conservation.input * 100 : 100;
    const longest = routes.slice().sort((a, b) => Number(b.km) - Number(a.km)).slice(0, 10);
    const low = routes.slice().sort((a, b) => util(a.volumeUtil) - util(b.volumeUtil)).slice(0, 10);
    const risk = routes.slice().sort((a, b) => (Number(b.km) + (100 - util(b.volumeUtil))) - (Number(a.km) + (100 - util(a.volumeUtil)))).slice(0, 10);
    const hasWeight = routes.some((route) => route.weightUtil && route.weightUtil !== "N/A");
    element.innerHTML = `<div class="dash-grid"><div class="card span-3"><h3>Input Orders</h3><div class="big-num">${fmt(conservation.input)}</div><div class="muted">Assigned + Unassigned + Blocked</div></div><div class="card span-3"><h3>已分配率</h3><div class="big-num">${fmt(assignedRate, 1)}%</div><div class="muted">按 Orders 计数</div></div><div class="card span-3"><h3>Routes / Vehicles</h3><div class="big-num">${summary.routes} / ${summary.vehicles}</div></div><div class="card span-3"><h3>总距离</h3><div class="big-num">${fmt(summary.totalDistance, 1)}</div><div class="muted">估算 km</div></div><div class="card span-3"><h3>Stops</h3><div class="big-num">${fmt(summary.stops)}</div></div><div class="card span-3"><h3>Packages</h3><div class="big-num">${fmt(summary.packages)}</div></div><div class="card span-3"><h3>未分配 / 阻断</h3><div class="big-num">${summary.unassigned} / ${summary.blocked}</div></div><div class="card span-3"><h3>订单守恒</h3><div class="big-num">${data().conservation?.balanced === false ? "失败" : "通过"}</div></div><div class="card span-6"><h3>容积利用率分布</h3>${bucketHtml(routes, "volumeUtil")}</div>${hasWeight ? `<div class="card span-6"><h3>重量利用率分布</h3>${bucketHtml(routes, "weightUtil")}</div>` : '<div class="card span-6"><h3>重量利用率</h3><div class="empty-state">源数据没有有效重量容量，显示 N/A，不参与规划。</div></div>'}${topTable("最长路线 Top 10", longest)}${topTable("低利用率路线 Top 10", low)}${topTable("高风险路线 Top 10", risk)}</div>`;
  }

  function renderCost() {
    const element = document.getElementById("costContent");
    if (!element) return;
    const routes = data().routes || [];
    const summary = currentSummary(routes);
    const candidates = planning().candidates || [];
    element.innerHTML = `<div class="dash-grid"><div class="card span-3"><h3>总成本</h3><div class="big-num">¥${fmt(summary.cost, 0)}</div></div><div class="card span-3"><h3>每 Package</h3><div class="big-num">¥${fmt(summary.packages ? summary.cost / summary.packages : 0, 2)}</div></div><div class="card span-3"><h3>每 Order</h3><div class="big-num">¥${fmt(summary.orders ? summary.cost / summary.orders : 0, 2)}</div></div><div class="card span-3"><h3>每公里</h3><div class="big-num">¥${fmt(summary.totalDistance ? summary.cost / summary.totalDistance : 0, 2)}</div></div><div class="card span-12"><h3>候选方案成本</h3><table class="table"><thead><tr><th>方案</th><th>实际标签</th><th>引擎</th><th>Vehicles</th><th>距离</th><th>成本</th><th>每 Order</th></tr></thead><tbody>${candidates.map((plan) => { const metric = scenarioMetrics(plan); return `<tr><td>${esc(plan.planId)}</td><td>${esc((plan.labels || []).map(goalName).join(" / "))}</td><td>${esc(plan.engine)}</td><td>${metric.usedVehicles}</td><td>${fmt(metric.estimatedRoadKm, 1)} km</td><td>¥${fmt(metric.totalCost, 0)}</td><td>¥${fmt(metric.assigned ? metric.totalCost / metric.assigned : 0, 2)}</td></tr>`; }).join("") || '<tr><td colspan="7">请先生成候选方案。</td></tr>'}</tbody></table></div></div>`;
  }

  function groupCarbon(routes, field) {
    const groups = new Map();
    routes.forEach((route) => {
      const key = String(route[field] || "未分类");
      const current = groups.get(key) || { key, routes: 0, km: 0, co2: 0, packages: 0 };
      current.routes += 1;
      current.km += Number(route.km || 0);
      current.co2 += Number(route.estimatedCo2 ?? Number(route.km || 0) * Number(route.emissionFactor || window.STCT_CONFIG?.carbonModel?.defaultVehicleFactor || 0.192));
      current.packages += Number(route.packages || 0);
      groups.set(key, current);
    });
    return [...groups.values()].sort((a, b) => b.co2 - a.co2);
  }

  function carbonRows(rows) {
    return rows.map((row) => `<tr><td>${esc(row.key)}</td><td>${row.routes}</td><td>${fmt(row.km, 1)} km</td><td>${fmt(row.co2, 1)} kg</td><td>${fmt(row.packages ? row.co2 / row.packages * 1000 : 0, 1)} g</td></tr>`).join("");
  }

  function renderCarbon() {
    const element = document.getElementById("carbonContent");
    if (!element) return;
    const routes = data().routes || [];
    const summary = currentSummary(routes);
    const hasRegion = routes.some((route) => String(route.region || "").trim());
    const regionField = hasRegion ? "region" : "date";
    const regionTitle = hasRegion ? "按区域统计碳排" : "按配送日期统计碳排（源数据无 region 字段）";
    element.innerHTML = `<div class="dash-grid"><div class="card co2-card span-3"><h3>总 CO2</h3><div class="big-num">${fmt(summary.co2, 1)} kg</div></div><div class="card span-3"><h3>每 Package</h3><div class="big-num">${fmt(summary.packages ? summary.co2 / summary.packages * 1000 : 0, 1)} g</div></div><div class="card span-3"><h3>每 Order</h3><div class="big-num">${fmt(summary.orders ? summary.co2 / summary.orders * 1000 : 0, 1)} g</div></div><div class="card span-3"><h3>默认因子</h3><div class="big-num">${fmt(window.STCT_CONFIG?.carbonModel?.defaultVehicleFactor || 0.192, 3)}</div><div class="muted">kgCO2/km；车辆字段可覆盖</div></div><div class="card span-6"><h3>按车辆统计碳排</h3><table class="table"><thead><tr><th>Vehicle</th><th>Routes</th><th>距离</th><th>CO2</th><th>每 Package</th></tr></thead><tbody>${carbonRows(groupCarbon(routes, "vehicleId"))}</tbody></table></div><div class="card span-6"><h3>${regionTitle}</h3><table class="table"><thead><tr><th>${hasRegion ? "区域" : "配送日期"}</th><th>Routes</th><th>距离</th><th>CO2</th><th>每 Package</th></tr></thead><tbody>${carbonRows(groupCarbon(routes, regionField))}</tbody></table></div></div>`;
  }

  function renderReport() {
    const element = document.getElementById("reportContent");
    if (!element) return;
    const current = data();
    const summary = currentSummary();
    const conservation = current.conservation || {};
    const state = planning();
    const selected = window.STCTPlanning?.currentCandidate?.();
    const audit = window.STCTPlanning?.exportSnapshot?.() || {};
    const manualAudit = current.meta?.manualAdjustmentAudit || audit.manualAdjustmentAudit || [];
    const trustScope = current.scenarioId ? "当前已应用方案" : selected ? "候选预览（尚未应用）" : "内置方案";
    element.innerHTML = `<div class="report-page"><div class="report-hero card"><h3>当前应用方案汇总</h3><div class="report-kpis"><div><b>${summary.routes}</b><span>Routes</span></div><div><b>${summary.vehicles}</b><span>Vehicles</span></div><div><b>${fmt(summary.totalDistance, 1)} km</b><span>估算距离</span></div><div><b>¥${fmt(summary.cost, 0)}</b><span>估算成本</span></div><div><b>${fmt(summary.co2, 1)} kg</b><span>估算 CO2</span></div></div></div><div class="dash-grid"><div class="card span-6"><h3>订单守恒</h3><div class="conservation ${conservation.balanced === false ? "bad" : "ok"}"><b>Input ${conservation.input ?? "-"}</b><span>= Assigned ${conservation.assigned ?? "-"} + Unassigned ${conservation.unassigned ?? "-"} + Blocked ${conservation.blocked ?? "-"}</span><strong>${conservation.balanced === false ? "失败" : conservation.balanced === true ? "通过" : "内置数据不适用"}</strong></div></div><div class="card span-6"><h3>Trust / Quality</h3><div class="mini-note report-source"><div>范围：${esc(trustScope)}</div><div>Plan：${esc(current.planId || selected?.planId || "-")}</div><div>Scenario：${esc(current.scenarioId || selected?.scenarioId || "-")}</div><div>Input hash：${esc(current.inputHash || selected?.inputHash || "-")}</div><div>引擎：${esc(current.engine || current.meta?.engine || selected?.engine || "Built-in Demo")}</div><div>Verifier：${esc(current.verification?.status || selected?.verification?.status || "未验证")}</div><div>指纹：${esc(current.fingerprint || selected?.fingerprint || "-")}</div></div></div><div class="card span-12"><h3>候选比较</h3>${renderScenarioTable(state.candidates || [], state.selectedPlanId)}</div><div class="card span-12"><h3>What-if 对比</h3>${renderWhatIf(state)}</div><div class="card span-12"><h3>Manual Adjustment Audit</h3>${manualAudit.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>动作</th><th>订单 / 路线</th><th>时间</th></tr></thead><tbody>${manualAudit.map((row, index) => `<tr><td>${index + 1}</td><td>${esc(row.type)}</td><td>${esc(row.orderId || row.routeId || "-")} · ${esc(row.fromRoute || "-")} → ${esc(row.toRoute || "-")}</td><td>${esc(row.timestamp || "-")}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty-state">当前应用方案没有人工调整记录。</div>'}</div><div class="card span-12"><h3>模型假设与边界</h3>${assumptionsPanel(current, planning().raw)}</div><div class="card span-12"><h3>人工复核</h3>${renderUnassigned(current)}</div></div></div>`;
  }

  function renderAllDashboards() {
    base.renderOverview?.();
    renderOptimizer();
    renderAnalysis();
    renderCarbon();
    base.renderExceptions?.();
    base.renderUpload?.();
    renderCost();
    renderReport();
    if (typeof window.applyLanguage === "function") {
      window.applyLanguage(document.getElementById("loginLang")?.value || "zh");
    }
  }

  function bindInputs() {
    ["optimizerDate", "optimizerLimit", "optimizerGoal", "mapOptimizerDate", "mapOptimizerLimit", "mapOptimizerGoal"].forEach((id) => {
      const element = document.getElementById(id);
      if (!element || element.dataset.planningBound) return;
      element.dataset.planningBound = "1";
      element.addEventListener("change", () => {
        if (id.includes("Date") || id.includes("Limit")) window.STCTPlanning?.invalidate("日期、订单规模或规划输入已变化，旧候选方案已失效。");
        renderOptimizer();
      });
    });
  }

  function install() {
    addPages();
    bindInputs();
    const distanceNote = document.getElementById("distanceAssumptionText");
    if (distanceNote) distanceNote.textContent = `MapLibre GL JS。距离为估算行驶距离：Haversine 直线距离 × ${window.STCT_CONFIG?.roadDistanceFactor || 1.35}，非正式导航距离。`;
    const adapters = { renderOptimizer, renderAnalysis, renderCarbon, renderUpload: base.renderUpload, renderCost, renderReport, renderAllDashboards };
    window.STCTCore?.installRenderers?.(adapters);
    window.STCTRender = { install, renderOptimizer, renderAnalysis, renderCarbon, renderCost, renderReport, renderAllDashboards };
    renderAllDashboards();
  }

  window.addEventListener("stct:planning-state", () => {
    if (document.getElementById("optimizerView")?.classList.contains("active")) renderOptimizer();
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
})();
