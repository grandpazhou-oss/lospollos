(function () {
  "use strict";

  const legacyOptimizer = window.STCTOptimizer;
  const legacyPlanning = window.STCTPlanning;
  if (!legacyOptimizer || !legacyPlanning || !window.STCTVerifier) return;
  const legacyAssumptions = legacyOptimizer.assumptions.bind(legacyOptimizer);
  const legacyPlanMetrics = legacyOptimizer.planMetrics.bind(legacyOptimizer);

  const GOALS = [
    { id: "vehicles", label: "当前候选中最少车辆", definition: "最佳服务水平候选中，先最小化实际使用车辆数，再最小化估算道路距离" },
    { id: "distance", label: "当前候选中最短", definition: "最佳服务水平候选中，最小化 estimatedRoadKm" },
    { id: "utilization", label: "装载利用率优先", definition: "最佳服务水平候选中，最大化公开的 utilizationScore" },
    { id: "cost", label: "当前候选中最低成本", definition: "最佳服务水平候选中，最小化车辆级 Demo totalCost" },
    { id: "carbon", label: "当前候选中最低碳排", definition: "最佳服务水平候选中，最小化车辆级 Demo totalCO2" },
    { id: "balanced", requestObjective: "balanced_seed", label: "当前候选中综合平衡", definition: "服务端生成 balanced seed；最终标签由最佳服务层级候选池的 balancedPoolScore 授予" },
  ];
  const LABELS = Object.fromEntries(GOALS.map((goal) => [goal.id, goal.label]));
  const state = legacyPlanning.state;
  const clone = (value) => window.STCTUtils?.clone
    ? window.STCTUtils.clone(value)
    : JSON.parse(JSON.stringify(value));
  const numeric = (value, fallback = 0) => {
    if (value === undefined || value === null || String(value).trim() === "") return fallback;
    const parsed = Number(String(value).replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const text = (value, fallback = "") => String(value ?? fallback).trim();
  const orderId = (row) => text(row?._scenarioOrderKey || row?.id || row?.orderId || row?.code);
  const vehicleId = (row) => text(row?.vehicleId || row?.id || row?.code);

  Object.assign(state, {
    version: "v1.4-trust-closure-mission-control",
    contractVersion: "stct-planning-contract-v1.3.1",
    canonicalVersion: "stct-canonical-json-v2",
    planningMode: "SINGLE_DAY",
    scenario: null,
    sourceCandidates: [],
    goalLinks: {},
    selectedPlanId: null,
    appliedPlanId: null,
    generationToken: 0,
    scenarioSettings: {
      timeLimitSeconds: 8,
      averageSpeedKmh: null,
      defaultServiceMinutes: null,
      roadDistanceFactor: null,
      shiftExtensionMinutes: 0,
      virtualVehicleCount: 0,
      virtualVehicleTemplateId: "",
    },
    baseline: null,
    whatIfResults: [],
    whatIfRunning: false,
    manual: null,
    multiDay: null,
    hashStatus: "pending",
    prioritySummary: null,
    auditEvents: [],
    requestSequence: 0,
    lastPerformance: null,
  });

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === "object") return Object.keys(value).sort(window.STCTCanonical?.canonicalUtf8Compare).reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
    return value;
  }

  function fingerprint(value) {
    const source = JSON.stringify(stableValue(value));
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }

  function emit() {
    window.dispatchEvent(new CustomEvent("stct:planning-state", { detail: snapshot() }));
  }

  function snapshot() {
    return {
      phase: state.phase,
      version: state.version,
      batchId: state.batchId,
      scenario: state.scenario,
      inputFingerprint: state.inputFingerprint,
      candidates: state.candidates,
      sourceCandidates: state.sourceCandidates,
      goalLinks: state.goalLinks,
      selectedPlanId: state.selectedPlanId,
      appliedPlanId: state.appliedPlanId,
      selectedScenarioId: state.selectedPlanId,
      appliedScenarioId: state.appliedPlanId,
      staleReason: state.staleReason,
      generating: state.generating,
      progress: state.progress,
      engineHealth: state.engineHealth,
      scenarioSettings: state.scenarioSettings,
      baseline: state.baseline,
      whatIfResults: state.whatIfResults,
      whatIfRunning: state.whatIfRunning,
      manual: state.manual,
      planningMode: state.planningMode,
      multiDay: state.multiDay,
      lastPerformance: state.lastPerformance,
    };
  }

  function resetPlanning({ keepBaseline = false } = {}) {
    state.scenario = null;
    state.inputFingerprint = "";
    state.candidates = [];
    state.sourceCandidates = [];
    state.goalLinks = {};
    state.selectedPlanId = null;
    state.selectedScenarioId = null;
    state.appliedPlanId = null;
    state.appliedScenarioId = null;
    state.staleReason = "";
    state.manual = null;
    state.whatIfResults = [];
    state.multiDay = null;
    if (!keepBaseline) state.baseline = null;
  }

  const legacySetRawData = legacyPlanning.setRawData.bind(legacyPlanning);
  const legacyMarkPreview = legacyPlanning.markPreview.bind(legacyPlanning);
  function setRawData(raw, batchId) {
    legacySetRawData(raw, batchId);
    resetPlanning();
    state.raw = clone(raw);
    state.batchId = batchId || state.batchId;
    state.phase = "raw-awaiting-plan";
    emit();
  }

  function markPreview(batchId) {
    legacyMarkPreview(batchId);
    state.phase = "preview";
    state.batchId = batchId || state.batchId;
    emit();
  }

  function invalidate(reason) {
    state.generationToken += 1;
    const hadResults = state.candidates.length || state.scenario;
    state.generating = false;
    state.whatIfRunning = false;
    state.progress = "";
    state.scenario = null;
    state.inputFingerprint = "";
    state.candidates = [];
    state.sourceCandidates = [];
    state.goalLinks = {};
    state.selectedPlanId = null;
    state.selectedScenarioId = null;
    state.manual = null;
    state.whatIfResults = [];
    state.phase = state.raw ? "raw-awaiting-plan" : "builtin";
    state.staleReason = hadResults ? (reason || "规划输入已变化，旧候选方案已失效。") : "";
    emit();
  }

  function dateWithMostOrders(raw) {
    const counts = new Map();
    (raw?.orders || []).forEach((order) => {
      const date = window.STCTCanonical.importDate(order.date, "order.date");
      if (date) counts.set(date, (counts.get(date) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || window.STCTCanonical.canonicalUtf8Compare(a[0], b[0]))[0]?.[0] || "ALL";
  }

  function uniqueScenarioOrders(rows) {
    return rows.map((source, index) => {
      const base = text(source.id || source.orderId || source.code, `ROW-${index + 2}`);
      const priority = window.STCTCanonical.priority(source.priority, source.priorityWeight);
      return {
        ...clone(source),
        id: base,
        code: text(source.code || source.orderId || source.id, base),
        name: text(source.name || source.customerName || source.code || base),
        address: text(source.address || source.addr),
        _scenarioOrderKey: base,
        priority: priority.normalized,
        priorityOriginal: priority.original,
        priorityWeight: priority.weight,
        prioritySource: priority.source,
        priorityWarning: priority.warning,
        orderType: text(source.orderType || source.type),
        requiredVehicleType: text(source.requiredVehicleType),
      };
    });
  }

  function virtualVehicles(vehicles, count, templateId) {
    if (!count || !vehicles.length) return [];
    const template = vehicles.find((vehicle) => vehicleId(vehicle) === text(templateId)) || vehicles[0];
    const sourceId = vehicleId(template);
    return Array.from({ length: count }, (_, index) => ({
      ...clone(template),
      id: `VIRTUAL-${sourceId}-${String(index + 1).padStart(2, "0")}`,
      vehicleId: `VIRTUAL-${sourceId}-${String(index + 1).padStart(2, "0")}`,
      name: `${text(template.name || template.vehicleName || sourceId)} +${index + 1}`,
      vehicleName: `${text(template.name || template.vehicleName || sourceId)} +${index + 1}`,
      isVirtual: true,
      virtual: true,
      sourceVehicleId: sourceId,
    }));
  }

  function scenarioSettings(overrides = {}) {
    return { ...state.scenarioSettings, ...overrides };
  }

  function assumptionsFor(raw, settings = state.scenarioSettings) {
    const base = legacyAssumptions(raw);
    const config = window.STCT_CONFIG || {};
    let contract;
    try {
      contract = window.STCTCanonical.getContract();
    } catch (_) {
      return { ...base, canonicalPending: true };
    }
    const weights = contract.balancedPoolWeights;
    return {
      roadDistanceFactor: numeric(settings.roadDistanceFactor, numeric(base.roadDistanceFactor, 1.35)),
      averageSpeedKmh: numeric(settings.averageSpeedKmh, numeric(base.averageSpeedKmh, 28)),
      defaultServiceMin: numeric(settings.defaultServiceMinutes, numeric(base.defaultServiceMinutes, 5)),
      costModelVersion: contract.models.costModelVersion,
      emissionModelVersion: contract.models.emissionModelVersion,
      priorityMappingVersion: contract.priorityMapping.version,
      missingVehicleDatePolicy: "blank-means-daily",
      missingTimeWindowPolicy: contract.time.missingTimeWindowPolicy,
      overnightPolicy: contract.time.overnightPolicy,
      distanceModel: contract.distance.model,
      roadMetersRounding: contract.distance.roadMetersRounding,
      travelMinutesRounding: contract.distance.travelMinutesRounding,
      costMinuteBasis: contract.time.costMinuteBasis,
      defaultEmissionFactor: numeric(base.carbonModel?.defaultVehicleFactor, contract.models.defaultEmissionFactor),
      lowUtilizationThreshold: numeric(config.lowUtilizationThreshold, contract.utilization.lowRouteThresholdPercent),
      balancedWeightUsedVehicles: weights.usedVehicles,
      balancedWeightDistance: weights.estimatedRoadKm,
      balancedWeightCost: weights.totalCost,
      balancedWeightCarbon: weights.totalCO2,
      balancedWeightLatestEnd: weights.latestEnd,
      balancedWeightUtilization: weights.utilizationScore,
    };
  }

  async function buildScenario({ raw = state.raw, date, limit, settings: overrides = {}, sourceBatchId = state.batchId, planningMode = "SINGLE_DAY" } = {}) {
    if (!raw) throw new Error("请先应用原始数据批次。");
    await window.STCTCanonical.ready();
    const contract = window.STCTCanonical.getContract();
    const settings = scenarioSettings(overrides);
    const requestedDate = window.STCTCanonical.importDate(date || document.getElementById("optimizerDate")?.value || dateWithMostOrders(raw), "planningDate");
    const planningDate = requestedDate || dateWithMostOrders(raw);
    if (planningMode !== "SINGLE_DAY") throw new Error("单日候选必须使用 SINGLE_DAY；跨日汇总请使用批次分解入口。");
    if (planningDate === "ALL") {
      const error = new Error("单日规划不能选择 ALL，请选择一个配送日或进入跨日汇总。");
      error.code = "MULTIPLE_ORDER_DATES_IN_SINGLE_DAY_SCENARIO";
      throw error;
    }
    const requestedLimit = text(limit || document.getElementById("optimizerLimit")?.value || "60");
    const allForDate = (raw.orders || [])
      .filter((order) => window.STCTCanonical.importDate(order.date, "order.date") === planningDate)
      .sort((a, b) => window.STCTCanonical.canonicalUtf8Compare(
        window.STCTCanonical.importText(a.id || a.orderId || a.code, { required: true, field: "order.id" }),
        window.STCTCanonical.importText(b.id || b.orderId || b.code, { required: true, field: "order.id" }),
      ));
    const selectedRows = requestedLimit === "ALL"
      ? allForDate
      : allForDate.slice(0, Math.max(1, numeric(requestedLimit, 60)));
    const preparedOrders = uniqueScenarioOrders(selectedRows).map((order) => ({
      id: window.STCTCanonical.importText(order.id, { required: true, field: "order.id" }),
      code: window.STCTCanonical.importText(order.code, { field: "order.code" }),
      name: window.STCTCanonical.importText(order.name, { field: "order.name" }),
      address: window.STCTCanonical.importText(order.address, { field: "order.address" }),
      date: window.STCTCanonical.importDate(order.date, "order.date"),
      lon: order.lon,
      lat: order.lat,
      count: order.count ?? 0,
      volume: order.volume ?? 0,
      weight: order.weight ?? 0,
      serviceMin: order.serviceMin ?? assumptionsFor(raw, settings).defaultServiceMin,
      twStart: window.STCTCanonical.importTime(order.twStart, "order.twStart"),
      twEnd: window.STCTCanonical.importTime(order.twEnd, "order.twEnd"),
      priority: window.STCTCanonical.importText(order.priority, { required: true, field: "order.priority" }),
      priorityWeight: order.priorityWeight,
      prioritySource: window.STCTCanonical.importText(order.prioritySource, { required: true, field: "order.prioritySource" }),
      orderType: window.STCTCanonical.importText(order.orderType, { field: "order.orderType" }),
      requiredVehicleType: window.STCTCanonical.importText(order.requiredVehicleType, { field: "order.requiredVehicleType" }),
    }));
    const defaultModels = contract.models;
    const baseVehicles = (raw.vehicles || [])
      .filter((vehicle) => !vehicle.availableDate || window.STCTCanonical.importDate(vehicle.availableDate, "vehicle.availableDate", true) === planningDate)
      .sort((a, b) => window.STCTCanonical.canonicalUtf8Compare(vehicleId(a), vehicleId(b)))
      .map((vehicle) => ({
        ...clone(vehicle),
        id: vehicleId(vehicle),
        name: text(vehicle.name || vehicle.vehicleName || vehicleId(vehicle)),
        type: text(vehicle.type || vehicle.vehicleType),
        availableDate: window.STCTCanonical.importDate(vehicle.availableDate, "vehicle.availableDate", true),
        maxVolume: vehicle.maxVolume,
        maxWeight: vehicle.maxWeight,
        start: window.STCTCanonical.importTime(vehicle.start || raw.constraints?.workStart || "09:00", "vehicle.start"),
        end: window.STCTCanonical.importTime(vehicle.end || raw.constraints?.workEnd || "17:30", "vehicle.end"),
        fixedCost: numeric(vehicle.fixedCost, defaultModels.defaultFixedCost),
        perKmCost: numeric(vehicle.perKmCost, defaultModels.defaultPerKmCost),
        perMinuteCost: numeric(vehicle.perMinuteCost, defaultModels.defaultPerMinuteCost),
        perStopCost: numeric(vehicle.perStopCost, defaultModels.defaultPerStopCost),
        emissionFactor: numeric(vehicle.emissionFactor, defaultModels.defaultEmissionFactor),
        sourceVehicleId: text(vehicle.sourceVehicleId),
        isVirtual: Boolean(vehicle.isVirtual || vehicle.virtual),
        enabled: vehicle.enabled !== false,
      }));
    const templateId = text(settings.virtualVehicleTemplateId || baseVehicles[0]?.id);
    const vehicleSources = [
      ...baseVehicles,
      ...virtualVehicles(baseVehicles, Math.max(0, Math.min(2, numeric(settings.virtualVehicleCount, 0))), templateId),
    ];
    const preparedVehicles = vehicleSources.map((vehicle) => ({
      id: text(vehicle.id || vehicle.vehicleId),
      name: text(vehicle.name || vehicle.vehicleName),
      type: text(vehicle.type || vehicle.vehicleType),
      availableDate: text(vehicle.availableDate),
      maxVolume: vehicle.maxVolume,
      maxWeight: vehicle.maxWeight,
      start: window.STCTCanonical.importTime(vehicle.start, "vehicle.start"),
      end: window.STCTCanonical.importTime(vehicle.end, "vehicle.end"),
      fixedCost: vehicle.fixedCost,
      perKmCost: vehicle.perKmCost,
      perMinuteCost: vehicle.perMinuteCost,
      perStopCost: vehicle.perStopCost,
      emissionFactor: vehicle.emissionFactor,
      sourceVehicleId: text(vehicle.sourceVehicleId),
      isVirtual: Boolean(vehicle.isVirtual || vehicle.virtual),
      enabled: vehicle.enabled !== false,
    }));
    const assumptions = assumptionsFor(raw, settings);
    const constraints = {
      singleTrip: true,
      maxWaitingMinutes: numeric(raw.constraints?.maxWaitingMinutes, contract.time.maxWaitingMinutes),
      workStart: window.STCTCanonical.importTime(raw.constraints?.workStart || "09:00", "constraints.workStart"),
      workEnd: window.STCTCanonical.importTime(raw.constraints?.workEnd || "17:30", "constraints.workEnd"),
      maxOrders: numeric(window.STCT_CONFIG?.maxOptimizerOrders, 500),
      maxSolveSeconds: numeric(window.STCT_CONFIG?.maxSolveSeconds, 45),
      allowUnassigned: true,
      capacityScale: contract.capacity.volumeScale,
      weightScale: contract.capacity.weightScale,
      maxStops: numeric(raw.constraints?.maxStops, 500),
      maxRouteMinutes: numeric(raw.constraints?.maxRouteMinutes, 48 * 60),
      shiftExtensionMinutes: Math.max(0, numeric(settings.shiftExtensionMinutes, 0)),
    };
    const identity = await window.STCTCanonical.scenarioIdentity({
      planningMode,
      planningDate,
      depot: {
        id: window.STCTCanonical.importText(raw.depot?.id || raw.depot?.code || raw.depot?.name || "DEPOT", { required: true, field: "depot.id" }),
        name: window.STCTCanonical.importText(raw.depot?.name, { field: "depot.name" }),
        address: window.STCTCanonical.importText(raw.depot?.address || raw.depot?.addr, { field: "depot.address" }),
        lon: raw.depot?.lon,
        lat: raw.depot?.lat,
      },
      orders: preparedOrders,
      vehicles: preparedVehicles,
      constraints,
      assumptions,
    });
    const canonicalScenario = identity.scenario;
    const compatibilityAssumptions = {
      ...canonicalScenario.assumptions,
      defaultServiceMinutes: Number(canonicalScenario.assumptions.defaultServiceMin),
      costModel: {
        currency: "CNY",
        fixedVehicleCost: defaultModels.defaultFixedCost,
        perKm: defaultModels.defaultPerKmCost,
        perMinute: defaultModels.defaultPerMinuteCost,
        perStop: defaultModels.defaultPerStopCost,
      },
      carbonModel: { defaultVehicleFactor: Number(canonicalScenario.assumptions.defaultEmissionFactor), unit: "kgCO2/km" },
      balancedWeights: { ...contract.balancedPoolWeights },
    };
    const compatibilityConstraints = {
      ...canonicalScenario.constraints,
      averageSpeedKmh: Number(canonicalScenario.assumptions.averageSpeedKmh),
      roadDistanceFactor: Number(canonicalScenario.assumptions.roadDistanceFactor),
      defaultServiceMinutes: Number(canonicalScenario.assumptions.defaultServiceMin),
      solveTimeSeconds: Math.max(1, numeric(settings.timeLimitSeconds, 8)),
    };
    const scenario = {
      ...canonicalScenario,
      canonicalScenario,
      scenarioId: `SCN-${identity.inputHash.split(":")[1].slice(0, 16).toUpperCase()}`,
      contentHash: identity.contentHash,
      inputHash: identity.inputHash,
      inputFingerprint: identity.inputHash,
      canonicalBytes: identity.inputBytes,
      sourceBatchId,
      warehouseId: canonicalScenario.depot.id,
      orderIds: canonicalScenario.orders.map((order) => order.id),
      vehicleIds: canonicalScenario.vehicles.map((vehicle) => vehicle.id),
      orderSelectionRule: `date=${planningDate} -> stable orderId ascending -> first ${requestedLimit}`,
      constraintsSnapshot: compatibilityConstraints,
      assumptionsSnapshot: compatibilityAssumptions,
      requestedOrderLimit: requestedLimit,
      requestTimeLimitSeconds: Math.max(1, numeric(settings.timeLimitSeconds, 8)),
      availableOrderCount: allForDate.length,
      actualOrderCount: canonicalScenario.orders.length,
      createdAt: new Date().toISOString(),
      prioritySummary: canonicalScenario.orders.reduce((summary, order) => {
        summary.original[order.priority] = (summary.original[order.priority] || 0) + 1;
        summary.weights[order.priorityWeight] = (summary.weights[order.priorityWeight] || 0) + 1;
        summary.sources[order.prioritySource] = (summary.sources[order.prioritySource] || 0) + 1;
        return summary;
      }, { original: {}, weights: {}, sources: {}, unknown: preparedOrders.filter((order) => order.priorityWarning).length }),
    };
    scenario.fleetAdequacy = window.STCTVerifier.fleetAdequacy(scenario);
    return scenario;
  }

  function sourceRowsForBatch(raw, limit) {
    const rows = [...(raw?.orders || [])];
    if (text(limit) === "ALL") return rows;
    return rows.slice(0, Math.max(1, numeric(limit, 60)));
  }

  async function buildMultiDayBatch({ raw = state.raw, limit = "ALL", settings: overrides = {}, sourceBatchId = state.batchId } = {}) {
    if (!raw) throw new Error("请先应用原始数据批次。");
    await window.STCTCanonical.ready();
    const selectedRows = sourceRowsForBatch(raw, limit);
    const groups = new Map();
    selectedRows.forEach((order) => {
      const date = window.STCTCanonical.importDate(order.date, "order.date");
      if (!date) throw new Error("跨日汇总发现缺失配送日期的订单。");
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date).push(order);
    });
    const childScenarios = [];
    for (const [date, orders] of [...groups.entries()].sort(([left], [right]) => window.STCTCanonical.canonicalUtf8Compare(left, right))) {
      const child = await buildScenario({
        raw: { ...raw, orders },
        date,
        limit: "ALL",
        settings: overrides,
        sourceBatchId,
        planningMode: "SINGLE_DAY",
      });
      child.parentBatchScenarioId = "";
      childScenarios.push(child);
    }
    const childInputHashes = childScenarios.map((child) => child.inputHash);
    const batchContentHash = await window.STCTCanonical.sha256(window.STCTCanonical.canonicalString({
      contractVersion: state.contractVersion,
      planningMode: "MULTI_DAY_BATCH",
      childContentHashes: childScenarios.map((child) => child.contentHash).sort(window.STCTCanonical.canonicalUtf8Compare),
    }));
    const aggregateHash = await window.STCTCanonical.sha256(window.STCTCanonical.canonicalString({
      contractVersion: state.contractVersion,
      planningMode: "MULTI_DAY_BATCH",
      childInputHashes: [...childInputHashes].sort(window.STCTCanonical.canonicalUtf8Compare),
    }));
    const parentBatchScenarioId = `BATCH-${aggregateHash.split(":")[1].slice(0, 16).toUpperCase()}`;
    childScenarios.forEach((child) => { child.parentBatchScenarioId = parentBatchScenarioId; });
    const vehicleCounts = childScenarios.map((child) => child.vehicles.length);
    return {
      planningMode: "MULTI_DAY_BATCH",
      parentBatchScenarioId,
      batchContentHash,
      aggregateHash,
      childInputHashes,
      requestedOrderLimit: text(limit),
      totalOrders: childScenarios.reduce((sum, child) => sum + child.orders.length, 0),
      dateCount: childScenarios.length,
      averageOrdersPerDay: childScenarios.length ? selectedRows.length / childScenarios.length : 0,
      peakDayOrders: Math.max(0, ...childScenarios.map((child) => child.orders.length)),
      minAvailableVehicles: vehicleCounts.length ? Math.min(...vehicleCounts) : 0,
      maxAvailableVehicles: vehicleCounts.length ? Math.max(...vehicleCounts) : 0,
      childScenarios: childScenarios.map((scenario) => ({ scenario, status: "READY", candidates: [], selectedPlan: null, error: null })),
      completedDates: 0,
      createdAt: new Date().toISOString(),
      conservation: { input: selectedRows.length, assigned: 0, unassigned: 0, blocked: 0, pending: selectedRows.length, balanced: true },
      aggregate: null,
      cancelled: false,
    };
  }

  function aggregateMultiDay(batch) {
    const completed = batch.childScenarios.filter((child) => child.status === "PASS" && child.selectedPlan);
    const metrics = completed.map((child) => child.selectedPlan.metrics || {});
    const input = batch.totalOrders;
    const assigned = metrics.reduce((sum, row) => sum + numeric(row.assigned), 0);
    const unassigned = metrics.reduce((sum, row) => sum + numeric(row.unassigned), 0);
    const blocked = metrics.reduce((sum, row) => sum + numeric(row.blocked), 0);
    const pending = batch.childScenarios.filter((child) => child.status === "READY" || child.status === "RUNNING").reduce((sum, child) => sum + child.scenario.orders.length, 0);
    const failed = batch.childScenarios.filter((child) => child.status === "FAIL").reduce((sum, child) => sum + child.scenario.orders.length, 0);
    batch.completedDates = completed.length;
    batch.conservation = { input, assigned, unassigned, blocked, pending, failed, balanced: input === assigned + unassigned + blocked + pending + failed };
    batch.aggregate = {
      assigned,
      unassigned,
      blocked,
      serviceRate: input ? assigned / input * 100 : 0,
      datesWithUnassigned: completed.filter((child) => numeric(child.selectedPlan.metrics?.unassigned) > 0).length,
      peakUsedVehicles: Math.max(0, ...metrics.map((row) => numeric(row.usedVehicles)), 0),
      totalUsedVehicleDays: metrics.reduce((sum, row) => sum + numeric(row.usedVehicles), 0),
      estimatedRoadKm: metrics.reduce((sum, row) => sum + numeric(row.estimatedRoadKm), 0),
      totalCost: metrics.reduce((sum, row) => sum + numeric(row.totalCost), 0),
      totalCO2: metrics.reduce((sum, row) => sum + numeric(row.totalCO2), 0),
    };
    return batch.aggregate;
  }

  async function generateMultiDayBatch(options = {}) {
    if (state.generating || state.whatIfRunning) return state.multiDay;
    const token = state.generationToken + 1;
    state.generationToken = token;
    state.generating = true;
    state.planningMode = "MULTI_DAY_BATCH";
    state.phase = "multi-day-building";
    state.multiDay = await buildMultiDayBatch(options);
    state.scenario = null;
    state.candidates = [];
    state.selectedPlanId = null;
    emit();
    try {
      await legacyOptimizer.healthCheck();
      for (let index = 0; index < state.multiDay.childScenarios.length; index += 1) {
        if (token !== state.generationToken || state.multiDay.cancelled) break;
        const child = state.multiDay.childScenarios[index];
        child.status = "RUNNING";
        state.progress = `${index + 1}/${state.multiDay.childScenarios.length} ${child.scenario.planningDate}`;
        emit();
        try {
          const sourcePlans = [
            await fetchPlan(child.scenario, "service", token),
            await fetchPlan(child.scenario, "balanced", token),
          ];
          const ranked = await window.STCTVerifier.rankCandidatePool(sourcePlans, child.scenario);
          child.candidates = ranked.candidates;
          child.goalLinks = ranked.goalLinks;
          child.selectedPlan = ranked.candidates.find((plan) => plan.planId === ranked.goalLinks.balanced) || ranked.servicePeers[0] || null;
          child.status = child.selectedPlan?.verification?.status === "PASS" ? "PASS" : "FAIL";
          if (child.status === "FAIL") child.error = "没有通过 verifier 的候选方案";
        } catch (error) {
          child.status = "FAIL";
          child.error = error.message;
        }
        aggregateMultiDay(state.multiDay);
        emit();
      }
      state.phase = state.multiDay.cancelled ? "multi-day-cancelled" : "multi-day-complete";
      return state.multiDay;
    } finally {
      if (token === state.generationToken) {
        state.generating = false;
        state.progress = "";
        aggregateMultiDay(state.multiDay);
        emit();
      }
    }
  }

  function cancelMultiDayBatch() {
    if (!state.multiDay) return;
    state.multiDay.cancelled = true;
    state.generationToken += 1;
    state.generating = false;
    state.phase = "multi-day-cancelled";
    emit();
  }

  function enterMultiDayChild(planningDate) {
    const child = state.multiDay?.childScenarios?.find((row) => row.scenario.planningDate === planningDate);
    if (!child) throw new Error("未找到该配送日子场景。");
    state.planningMode = "SINGLE_DAY";
    state.scenario = child.scenario;
    state.candidates = child.candidates || [];
    state.sourceCandidates = [];
    state.goalLinks = child.goalLinks || {};
    state.selectedPlanId = child.selectedPlan?.planId || state.candidates[0]?.planId || null;
    state.selectedScenarioId = state.selectedPlanId;
    state.phase = state.candidates.length ? "candidates" : "raw-awaiting-plan";
    const dateControl = document.getElementById("optimizerDate");
    if (dateControl) dateControl.value = planningDate;
    emit();
    return child;
  }

  function setPlanningMode(mode) {
    if (!["SINGLE_DAY", "MULTI_DAY_BATCH"].includes(mode)) throw new Error(`不支持的规划模式：${mode}`);
    state.planningMode = mode;
    if (mode === "MULTI_DAY_BATCH") {
      state.scenario = null;
      state.candidates = [];
      state.selectedPlanId = null;
      state.manual = null;
    }
    emit();
  }

  async function buildRequest({ scenario, goal, requestId, requestSequence = 0 }) {
    const definition = GOALS.find((item) => item.id === goal);
    const objective = definition?.requestObjective || goal;
    const searchConfiguration = {
      firstSolutionStrategy: "parallel-cheapest-insertion",
      localSearchMetaheuristic: "guided-local-search",
      randomSeed: 13,
      logSearch: false,
      servicePolicy: "priority-score-then-assigned-count-then-business-objective",
    };
    const requestIdentity = await window.STCTCanonical.requestIdentity(scenario.inputHash, {
      objective,
      timeLimitSeconds: scenario.requestTimeLimitSeconds,
      engineRequested: window.STCT_CONFIG?.forceHeuristic ? "heuristic" : "ortools",
      searchConfiguration,
    });
    return {
      version: "v1.4-trust-closure-mission-control",
      contractVersion: scenario.contractVersion,
      canonicalVersion: scenario.canonicalVersion,
      requestId,
      requestSequence,
      scenarioId: scenario.scenarioId,
      canonicalScenario: scenario.canonicalScenario,
      claimedContentHash: scenario.contentHash,
      claimedInputHash: scenario.inputHash,
      claimedRequestHash: requestIdentity.requestHash,
      objective,
      requestedObjective: objective,
      requestedGoal: goal,
      timeLimitSeconds: scenario.requestTimeLimitSeconds,
      engineRequested: window.STCT_CONFIG?.forceHeuristic ? "heuristic" : "ortools",
      searchConfiguration,
      batchId: scenario.sourceBatchId,
      clientIdentity: {
        contentHash: scenario.contentHash,
        inputHash: scenario.inputHash,
        requestHash: requestIdentity.requestHash,
        requestBytes: requestIdentity.requestBytes,
      },
      objectiveDefinition: {
        requestedGoal: goal,
        requestedObjective: objective,
        servicePriority: "lexicographic-service-first",
        formula: definition?.definition,
        balancedStrategy: goal === "balanced" ? "balanced-search-seed-plus-pool-score" : "business-objective",
      },
    };
  }

  function reasonCode(row) {
    const source = text(row.reasonCode || row.reasonCategory).toLowerCase();
    if (source.includes("missing_coordinate")) return "MISSING_COORDINATE";
    if (source.includes("invalid_coordinate")) return "INVALID_COORDINATE";
    if (source.includes("invalid_volume") || source.includes("invalid_demand")) return "INVALID_DEMAND";
    if (source.includes("duplicate")) return "INVALID_DEMAND";
    if (source.includes("over_volume")) return "ORDER_EXCEEDS_ALL_VEHICLES_VOLUME";
    if (source.includes("over_weight")) return "ORDER_EXCEEDS_ALL_VEHICLES_WEIGHT";
    if (source.includes("vehicle_date")) return "NO_VEHICLE_AVAILABLE_ON_DATE";
    if (source.includes("total_capacity")) return "TOTAL_CAPACITY_SHORTFALL";
    if (source.includes("time_window")) return "TIME_WINDOW_CONFLICT";
    if (source.includes("shift")) return "SHIFT_LIMIT_CONFLICT";
    if (source.includes("time_limit")) return "SOLVER_TIME_LIMIT";
    if (source.includes("no_solution")) return "SOLVER_NO_FEASIBLE_ASSIGNMENT";
    return "UNKNOWN_CONSTRAINT_CONFLICT";
  }

  function enrichReasonRows(plan, scenario) {
    const adequacy = window.STCTVerifier.fleetAdequacy(scenario);
    ["blockedOrders", "unassignedOrders"].forEach((key) => {
      plan[key] = (plan[key] || []).map((row) => {
        const code = reasonCode(row);
        const deterministic = [
          "MISSING_COORDINATE",
          "INVALID_COORDINATE",
          "INVALID_DEMAND",
          "ORDER_EXCEEDS_ALL_VEHICLES_WEIGHT",
          "ORDER_EXCEEDS_ALL_VEHICLES_VOLUME",
          "NO_VEHICLE_AVAILABLE_ON_DATE",
          "TOTAL_CAPACITY_SHORTFALL",
        ].includes(code);
        const actions = text(row.suggestion).split(/、|，|,|\//).map((item) => item.trim()).filter(Boolean);
        return {
          ...row,
          id: orderId(row),
          reasonCode: code,
          reasonLabel: row.reason || code,
          evidence: {
            totalVolume: adequacy.totalVolume,
            totalVolumeCapacity: adequacy.totalVolumeCapacity,
            totalWeight: adequacy.totalWeight,
            totalWeightCapacity: adequacy.totalWeightCapacity,
            solverStatus: plan.meta?.solveStats?.status || "BEST_FOUND",
          },
          confidence: deterministic ? "deterministic" : code === "UNKNOWN_CONSTRAINT_CONFLICT" ? "unknown" : "probable",
          suggestedActions: actions.length ? actions : ["人工复核约束"],
          assignmentStatus: key === "blockedOrders" ? "BLOCKED_PRECHECK" : "UNASSIGNED_SOLVER",
        };
      });
    });
    plan.missingStops = [...plan.blockedOrders, ...plan.unassignedOrders];
    return plan;
  }

  function planAuthority(plan) {
    const authorityOrderId = (row) => typeof row === "string" ? text(row) : orderId(row);
    const byRoute = new Map();
    (plan?.stopGeoJson?.features || []).forEach((feature) => {
      const props = feature.properties || {};
      const routeId = text(props.routeId);
      if (!byRoute.has(routeId)) byRoute.set(routeId, []);
      byRoute.get(routeId).push({ seq: numeric(props.seq), orderId: text(props.orderId || props.code) });
    });
    return {
      routes: (plan?.routes || []).map((route) => ({
        routeId: text(route.routeId),
        vehicleId: text(route.vehicleId),
        orderIds: route.orderIds?.length
          ? route.orderIds.map(text)
          : (byRoute.get(text(route.routeId)) || []).sort((a, b) => a.seq - b.seq).map((row) => row.orderId),
      })),
      unassignedOrderIds: (plan?.unassignedOrderIds || plan?.unassignedOrders || []).map(authorityOrderId),
      blockedOrderIds: (plan?.blockedOrderIds || plan?.blockedOrders || []).map(authorityOrderId),
      manualRevision: numeric(plan?.manualRevision, 0),
      parentPlanHash: text(plan?.parentPlanHash || plan?.basePlanHash),
    };
  }

  async function preparePlan(plan, scenario, goal, engine, fallbackError, request = null) {
    const result = enrichReasonRows(clone(plan), scenario);
    const computedPlan = await window.STCTCanonical.planIdentity(scenario.inputHash, planAuthority(result));
    result.engine = engine;
    result.scenarioId = scenario.scenarioId;
    result.contractVersion = scenario.contractVersion;
    result.canonicalVersion = scenario.canonicalVersion;
    result.contentHash = scenario.contentHash;
    result.inputHash = scenario.inputHash;
    result.requestHash = request?.claimedRequestHash || result.requestHash || "";
    result.planHash = result.planHash || computedPlan.planHash;
    result.serverHashVerified = engine === "OR-Tools" && result.serverHashVerified === true;
    result.meta = {
      ...(result.meta || {}),
      version: "v1.4-trust-closure-mission-control",
      engine,
      engineVersion: result.meta?.actualEngineVersion || result.meta?.engineVersion || result.meta?.version || (engine === "OR-Tools" ? "unknown" : "demo-v1.3"),
      actualEngineVersion: result.meta?.actualEngineVersion || null,
      contractVersion: scenario.contractVersion,
      canonicalVersion: scenario.canonicalVersion,
      contentHash: scenario.contentHash,
      scenarioId: scenario.scenarioId,
      inputHash: scenario.inputHash,
      requestHash: result.requestHash,
      planHash: result.planHash,
      serverHashVerified: result.serverHashVerified,
      requestedGoal: goal,
      requestedObjective: request?.objective || goal,
      goal,
      requestedGoalLabel: LABELS[goal],
      sourceBatchId: scenario.sourceBatchId,
      orderIds: scenario.orderIds,
      vehicleIds: scenario.vehicleIds,
      constraintsSnapshot: scenario.constraintsSnapshot,
      assumptionsSnapshot: scenario.assumptionsSnapshot,
      engineError: fallbackError || result.meta?.engineError || "",
      planAuthority: computedPlan.envelope,
    };
    result.requestedGoals = [goal];
    return result;
  }

  async function fetchPlan(scenario, goal, generationToken) {
    const requestSequence = state.requestSequence + 1;
    state.requestSequence = requestSequence;
    const requestId = `${scenario.scenarioId}-${goal}-${requestSequence}`;
    const request = await buildRequest({ scenario, goal, requestId, requestSequence });
    const started = performance.now();
    if (state.engineHealth.available) {
      try {
        const response = await fetch(window.STCT_CONFIG.optimizerApiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        const body = await response.json();
        if (!response.ok || !body.ok || !body.plan) {
          const error = new Error(body.error?.message || body.error || `优化服务返回 HTTP ${response.status}`);
          error.code = body.error?.code || `HTTP_${response.status}`;
          error.trustFatal = response.status >= 400 && response.status < 500;
          throw error;
        }
        const stale = generationToken !== state.generationToken
          || body.serverInputHash !== scenario.inputHash
          || body.serverRequestHash !== request.claimedRequestHash
          || body.contractVersion !== scenario.contractVersion
          || body.serverHashVerified !== true;
        if (stale) {
          state.auditEvents.push({ type: "STALE_RESPONSE_REJECTED", requestId, requestSequence, expectedInputHash: scenario.inputHash, actualInputHash: body.serverInputHash, expectedRequestHash: request.claimedRequestHash, actualRequestHash: body.serverRequestHash, timestamp: new Date().toISOString() });
          const error = new Error("STALE_RESPONSE");
          error.code = "STALE_RESPONSE_REJECTED";
          throw error;
        }
        if (text(body.scenarioId || body.plan.scenarioId || body.plan.meta?.scenarioId) !== scenario.scenarioId) throw new Error("优化服务返回了不同 scenarioId");
        const plan = await preparePlan(body.plan, scenario, goal, "OR-Tools", "", request);
        if (plan.planHash !== body.planHash || plan.contentHash !== body.serverContentHash || plan.requestHash !== body.serverRequestHash) {
          const error = new Error("优化服务响应身份不一致。");
          error.code = "SERVER_RESPONSE_IDENTITY_MISMATCH";
          error.trustFatal = true;
          throw error;
        }
        plan.meta.apiVersion = body.version || "v1.4-trust-closure-mission-control";
        plan.meta.requestId = requestId;
        plan.meta.requestSequence = requestSequence;
        plan.meta.requestBytes = request.clientIdentity.requestBytes;
        plan.meta.clientElapsedMs = Math.round(performance.now() - started);
        return plan;
      } catch (error) {
        if (error.message === "STALE_RESPONSE") throw error;
        if (error.trustFatal) throw error;
        const fallback = await legacyOptimizer.buildHeuristicPlanFromCanonical(scenario, request, error.message);
        const prepared = await preparePlan(fallback, scenario, goal, "Demo Heuristic", error.message, request);
        const rebuilt = window.STCTVerifier.recomputePlan(prepared, scenario).plan;
        rebuilt.meta = prepared.meta;
        rebuilt.scenarioId = scenario.scenarioId;
        rebuilt.contractVersion = scenario.contractVersion;
        rebuilt.canonicalVersion = scenario.canonicalVersion;
        rebuilt.contentHash = scenario.contentHash;
        rebuilt.inputHash = scenario.inputHash;
        rebuilt.requestHash = request.claimedRequestHash;
        rebuilt.planHash = prepared.planHash;
        rebuilt.serverHashVerified = false;
        rebuilt.requestedGoals = [goal];
        return rebuilt;
      }
    }
    const fallback = await legacyOptimizer.buildHeuristicPlanFromCanonical(scenario, request, state.engineHealth.error || state.engineHealth.status || "OR-Tools unavailable");
    const prepared = await preparePlan(fallback, scenario, goal, "Demo Heuristic", state.engineHealth.error || state.engineHealth.status, request);
    const rebuilt = window.STCTVerifier.recomputePlan(prepared, scenario).plan;
    rebuilt.meta = prepared.meta;
    rebuilt.scenarioId = scenario.scenarioId;
    rebuilt.contractVersion = scenario.contractVersion;
    rebuilt.canonicalVersion = scenario.canonicalVersion;
    rebuilt.contentHash = scenario.contentHash;
    rebuilt.inputHash = scenario.inputHash;
    rebuilt.requestHash = request.claimedRequestHash;
    rebuilt.planHash = prepared.planHash;
    rebuilt.serverHashVerified = false;
    rebuilt.requestedGoals = [goal];
    return rebuilt;
  }

  async function generateScenarios(options = {}) {
    if (state.generating || state.whatIfRunning) return state.candidates;
    const raw = options.raw || state.raw || window.RAW_DATA;
    const date = options.date || document.getElementById("optimizerDate")?.value || dateWithMostOrders(raw);
    const limit = options.limit || document.getElementById("optimizerLimit")?.value || "60";
    const scenario = await buildScenario({ raw, date, limit, settings: options.settings || {}, planningMode: "SINGLE_DAY" });
    const maxOrders = numeric(window.STCT_CONFIG?.maxOptimizerOrders, 500);
    if (scenario.orders.length > maxOrders) throw new Error(`当前场景 ${scenario.orders.length} 单，超过本地上限 ${maxOrders}。`);
    const token = state.generationToken + 1;
    state.generationToken = token;
    state.generating = true;
    state.phase = "generating";
    state.progress = "0/6";
    state.scenario = scenario;
    state.inputFingerprint = scenario.inputHash;
    state.hashStatus = "client-ready";
    state.prioritySummary = scenario.prioritySummary;
    state.staleReason = "";
    state.manual = null;
    state.whatIfResults = [];
    const started = performance.now();
    emit();
    try {
      await legacyOptimizer.healthCheck();
      const sourcePlans = [];
      for (let index = 0; index < GOALS.length; index += 1) {
        if (token !== state.generationToken) throw new Error("STALE_RESPONSE");
        const goal = GOALS[index];
        state.progress = `${index + 1}/6 ${goal.label}`;
        emit();
        sourcePlans.push(await fetchPlan(scenario, goal.id, token));
      }
      if (token !== state.generationToken) throw new Error("STALE_RESPONSE");
      const ranked = await window.STCTVerifier.rankCandidatePool(sourcePlans, scenario);
      state.sourceCandidates = sourcePlans;
      state.candidates = ranked.candidates;
      state.goalLinks = ranked.goalLinks;
      const preferredGoal = document.getElementById("optimizerGoal")?.value || "balanced";
      state.selectedPlanId = ranked.goalLinks[preferredGoal] || ranked.goalLinks.balanced || ranked.candidates[0]?.planId || null;
      state.selectedScenarioId = state.selectedPlanId;
      state.phase = ranked.invariant.status === "PASS" ? "candidates" : "candidate-warning";
      state.lastPerformance = {
        requestBuildAndSolveMs: Math.round(performance.now() - started),
        sourceCandidateCount: sourcePlans.length,
        dedupedCandidateCount: ranked.candidates.length,
        completedAt: new Date().toISOString(),
      };
      emit();
      return state.candidates;
    } catch (error) {
      if (error.message !== "STALE_RESPONSE") {
        state.phase = "error";
        state.staleReason = error.message;
      }
      throw error;
    } finally {
      if (token === state.generationToken) {
        state.generating = false;
        state.progress = "";
        emit();
      }
    }
  }

  function selectScenario(id) {
    const planId = state.goalLinks[id] || id;
    if (state.candidates.some((plan) => plan.planId === planId)) {
      state.selectedPlanId = planId;
      state.selectedScenarioId = planId;
      state.manual = null;
      emit();
    }
    return currentCandidate();
  }

  function currentCandidate() {
    if (state.manual?.plan) return state.manual.plan;
    return state.candidates.find((plan) => plan.planId === state.selectedPlanId) || state.candidates[0] || null;
  }

  function recommend(candidates = state.candidates) {
    return candidates.find((plan) => plan.planId === state.goalLinks.balanced)
      || candidates.find((plan) => plan.labels?.includes("balanced"))
      || candidates[0]
      || null;
  }

  async function applySelected() {
    const plan = currentCandidate();
    if (!plan) throw new Error("请先生成并选择候选方案。");
    if (!state.scenario) throw new Error("当前场景已失效，请重新生成。");
    if (state.manual?.active && (plan.planHash !== state.manual.plan.planHash || numeric(plan.manualRevision) !== state.manual.revision)) {
      throw new Error("人工方案已过期，请重新进入人工调度。");
    }
    const verification = await window.STCTVerifier.verify(plan, state.scenario);
    if (verification.status === "FAIL") throw new Error(`方案验证失败：${verification.hardViolationCount} 个硬约束，${verification.metricMismatchCount} 个指标差异。`);
    if (!state.beforeApply) state.beforeApply = clone(window.STCTCore?.getData?.() || window.DATA || window.FLOWMAP_DATA);
    const applied = verification.recomputedPlan;
    applied.verification = { ...verification, recomputedPlan: undefined };
    applied.meta = {
      ...(plan.meta || {}),
      selectedAs: plan.labels || [],
      manualAdjusted: Boolean(state.manual?.actions?.length),
      manualAdjustmentAudit: state.manual?.auditLog || state.manual?.actions || [],
      scenarioSnapshot: clone(state.scenario),
    };
    applied.scenarioId = state.scenario.scenarioId;
    applied.inputHash = state.scenario.inputHash;
    (window.STCTCore?.applyPlan || window.applyUploadedData)(applied);
    state.appliedPlanId = plan.planId;
    state.appliedScenarioId = plan.planId;
    state.phase = "applied";
    emit();
    return applied;
  }

  function restore() {
    if (!state.beforeApply) throw new Error("当前没有可恢复的应用前方案。");
    (window.STCTCore?.applyPlan || window.applyUploadedData)(clone(state.beforeApply));
    state.appliedPlanId = null;
    state.appliedScenarioId = null;
    state.phase = state.candidates.length ? "candidates" : state.raw ? "raw-awaiting-plan" : "builtin";
    emit();
  }

  function updateSettings(patch) {
    state.scenarioSettings = { ...state.scenarioSettings, ...patch };
    invalidate("场景参数已变化，旧候选方案已失效。");
    return state.scenarioSettings;
  }

  function saveBaseline() {
    const plan = currentCandidate();
    if (!plan || !state.scenario) throw new Error("请先生成并选择有效方案。");
    state.baseline = {
      savedAt: new Date().toISOString(),
      scenario: clone(state.scenario),
      settings: clone(state.scenarioSettings),
      candidates: clone(state.candidates),
      sourceCandidates: clone(state.sourceCandidates),
      goalLinks: clone(state.goalLinks),
      selectedPlanId: plan.planId,
      plan: clone(plan),
    };
    emit();
    return state.baseline;
  }

  function syncScenarioControls(scenario, settings) {
    const values = {
      optimizerDate: scenario?.planningDate,
      mapOptimizerDate: scenario?.planningDate,
      optimizerLimit: scenario?.requestedOrderLimit,
      mapOptimizerLimit: scenario?.requestedOrderLimit,
      scenarioTimeLimit: settings?.timeLimitSeconds,
      scenarioAverageSpeed: settings?.averageSpeedKmh || scenario?.assumptionsSnapshot?.averageSpeedKmh,
      scenarioServiceMinutes: settings?.defaultServiceMinutes || scenario?.assumptionsSnapshot?.defaultServiceMinutes,
      scenarioRoadFactor: settings?.roadDistanceFactor || scenario?.assumptionsSnapshot?.roadDistanceFactor,
      scenarioShiftExtension: settings?.shiftExtensionMinutes,
      scenarioVirtualVehicles: settings?.virtualVehicleCount,
    };
    Object.entries(values).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element && value !== undefined && value !== null && [...(element.options || [])].some((option) => option.value === String(value))) element.value = String(value);
      else if (element && value !== undefined && value !== null && !("options" in element)) element.value = String(value);
    });
  }

  function restoreBaseline() {
    if (!state.baseline) throw new Error("尚未保存 Baseline。");
    const baseline = clone(state.baseline);
    state.scenarioSettings = baseline.settings;
    state.scenario = baseline.scenario;
    state.inputFingerprint = baseline.scenario.inputHash;
    state.candidates = baseline.candidates;
    state.sourceCandidates = baseline.sourceCandidates;
    state.goalLinks = baseline.goalLinks;
    state.selectedPlanId = baseline.selectedPlanId;
    state.selectedScenarioId = baseline.selectedPlanId;
    state.manual = null;
    state.phase = "baseline-restored";
    syncScenarioControls(baseline.scenario, baseline.settings);
    window.STCTCore?.setOptimizerPlan?.(currentCandidate());
    emit();
    return currentCandidate();
  }

  function metricDelta(plan, baselinePlan) {
    const metric = plan?.metrics || {};
    const baseline = baselinePlan?.metrics || {};
    const result = {};
    ["assigned", "unassigned", "serviceRate", "usedVehicles", "estimatedRoadKm", "latestEndMinutes", "utilizationScore", "totalCost", "totalCO2"].forEach((key) => {
      result[key] = numeric(metric[key]) - numeric(baseline[key]);
    });
    return result;
  }

  async function carryForwardBaseline(plan, scenario) {
    const carried = clone(plan);
    const authority = {
      routes: (carried.routes || []).map((route) => ({ routeId: route.routeId, vehicleId: route.vehicleId, orderIds: window.STCTVerifier.routeOrderIds(route, carried) })),
      unassignedOrderIds: (carried.unassignedOrderIds || carried.unassignedOrders || []).map((row) => typeof row === "string" ? row : orderId(row)),
      blockedOrderIds: (carried.blockedOrderIds || carried.blockedOrders || []).map((row) => typeof row === "string" ? row : orderId(row)),
      manualRevision: numeric(carried.manualRevision, 0),
      parentPlanHash: text(plan.planHash),
    };
    const identity = await window.STCTCanonical.planIdentity(scenario.inputHash, authority);
    carried.scenarioId = scenario.scenarioId;
    carried.contentHash = scenario.contentHash;
    carried.inputHash = scenario.inputHash;
    carried.planHash = identity.planHash;
    carried.parentPlanHash = text(plan.planHash);
    carried.planId = `${plan.planId}-CARRY-${scenario.inputHash.slice(-8).toUpperCase()}`;
    carried.meta = {
      ...(carried.meta || {}),
      scenarioId: scenario.scenarioId,
      inputHash: scenario.inputHash,
      inputFingerprint: scenario.inputHash,
      requestedGoal: "balanced",
      goal: "balanced",
      carryForwardBaseline: true,
      localCarryForwardRehash: true,
      parentPlanHash: text(plan.planHash),
      planHash: identity.planHash,
      carryForwardNote: "原 Baseline 在放宽后的运力场景中作为可行保底候选参与复核。",
    };
    carried.requestedGoals = ["balanced"];
    return carried;
  }

  async function evaluateCapacityOptions() {
    if (state.whatIfRunning || state.generating) return state.whatIfResults;
    if (!state.baseline) saveBaseline();
    const baseline = clone(state.baseline);
    const templateId = text(state.scenarioSettings.virtualVehicleTemplateId || baseline.scenario.vehicles?.[0]?.id);
    const template = baseline.scenario.vehicles?.find((vehicle) => vehicle.id === templateId) || baseline.scenario.vehicles?.[0];
    const templateName = text(template?.name || template?.id, "未选择模板");
    const variations = [
      { id: "current", label: "当前车辆", settings: { virtualVehicleCount: 0, shiftExtensionMinutes: 0, virtualVehicleTemplateId: templateId } },
      { id: "plus-1", label: `+1 ${templateName}`, settings: { virtualVehicleCount: 1, shiftExtensionMinutes: 0, virtualVehicleTemplateId: templateId } },
      { id: "plus-2", label: `+2 ${templateName}`, settings: { virtualVehicleCount: 2, shiftExtensionMinutes: 0, virtualVehicleTemplateId: templateId } },
      { id: "shift-60", label: "班次 +60 分钟", settings: { virtualVehicleCount: 0, shiftExtensionMinutes: 60, virtualVehicleTemplateId: templateId } },
    ];
    const token = state.generationToken + 1;
    state.generationToken = token;
    state.whatIfRunning = true;
    state.whatIfResults = [];
    state.phase = "what-if";
    emit();
    try {
      await legacyOptimizer.healthCheck();
      for (let index = 0; index < variations.length; index += 1) {
        const variation = variations[index];
        if (token !== state.generationToken) throw new Error("STALE_RESPONSE");
        state.progress = `${index + 1}/${variations.length} ${variation.label}`;
        emit();
        const scenario = await buildScenario({
          raw: state.raw,
          date: baseline.scenario.planningDate,
          limit: baseline.scenario.requestedOrderLimit,
          settings: { ...baseline.settings, ...variation.settings },
        });
        const carried = await carryForwardBaseline(baseline.plan, scenario);
        const servicePlan = await fetchPlan(scenario, "service", token);
        const balancedPlan = await fetchPlan(scenario, "balanced", token);
        const sourcePlans = [carried, servicePlan, balancedPlan];
        const ranked = await window.STCTVerifier.rankCandidatePool(sourcePlans, scenario);
        const selected = ranked.candidates.find((plan) => plan.planId === ranked.goalLinks.balanced) || ranked.candidates[0];
        state.whatIfResults.push({
          ...variation,
          scenarioId: scenario.scenarioId,
          inputHash: scenario.inputHash,
          scenario: clone(scenario),
          baselinePlanHash: baseline.plan.planHash,
          template: template ? { id: template.id, name: template.name, maxVolume: template.maxVolume, maxWeight: template.maxWeight, fixedCost: template.fixedCost, emissionFactor: template.emissionFactor } : null,
          serviceFirst: { planHash: servicePlan.planHash, requestHash: servicePlan.requestHash, metrics: servicePlan.metrics, solverStatus: servicePlan.meta?.solveStats?.status },
          balancedSeed: { planHash: balancedPlan.planHash, requestHash: balancedPlan.requestHash, metrics: balancedPlan.metrics, solverStatus: balancedPlan.meta?.solveStats?.status },
          selectedPlanHash: selected.planHash,
          selectedPlan: clone(selected),
          metrics: selected.metrics,
          verification: selected.verification,
          diagnostics: window.STCTVerifier.diagnostics(selected, scenario),
          delta: metricDelta(selected, baseline.plan),
          candidateCount: ranked.candidates.length,
          carriedBaseline: Boolean(selected.meta?.carryForwardBaseline),
        });
      }
      state.phase = "what-if-complete";
      emit();
      return state.whatIfResults;
    } finally {
      if (token === state.generationToken) {
        state.whatIfRunning = false;
        state.progress = "";
        emit();
      }
    }
  }

  async function editorStateHash(planHash, lockedRouteIds, editorRevision) {
    return window.STCTCanonical.sha256(window.STCTCanonical.canonicalString({
      canonicalVersion: state.canonicalVersion,
      planHash,
      lockedRouteIds: [...lockedRouteIds].sort(window.STCTCanonical.canonicalUtf8Compare),
      editorRevision,
    }));
  }

  function manualSnapshot(manual) {
    return clone({
      plan: manual.plan,
      actions: manual.actions,
      lockedRouteIds: manual.lockedRouteIds,
      revision: manual.revision,
      editorRevision: manual.editorRevision,
      editorStateHash: manual.editorStateHash,
    });
  }

  async function startManual() {
    const plan = currentCandidate();
    if (!plan || !state.scenario) throw new Error("请先选择通过验证的方案。");
    if (plan.verification?.status === "FAIL") throw new Error("验证失败的方案不能进入人工调度。");
    state.manual = {
      active: true,
      basePlanId: plan.planId,
      basePlanHash: plan.planHash,
      basePlan: clone(plan),
      plan: clone(plan),
      history: [],
      actions: [],
      auditLog: [],
      lockedRouteIds: [],
      revision: numeric(plan.manualRevision, 0),
      editorRevision: 0,
      editorStateHash: await editorStateHash(plan.planHash, [], 0),
    };
    state.manual.baseEditorStateHash = state.manual.editorStateHash;
    state.phase = "manual-edit";
    emit();
    return state.manual.plan;
  }

  function routeForOrder(plan, id) {
    return (plan.routes || []).find((route) => window.STCTVerifier.routeOrderIds(route, plan).includes(text(id)));
  }

  function syncUnassigned(plan, rows) {
    plan.unassignedOrders = rows;
    plan.unassignedOrderIds = rows.map((row) => orderId(row));
  }

  function insertionChoice(route, orderIdValue, mode, anchorOrderId) {
    const ids = window.STCTVerifier.routeOrderIds(route, state.manual.plan).filter((id) => id !== orderIdValue);
    if (mode === "APPEND") return { index: ids.length, ids };
    if (mode === "AFTER") {
      const anchorIndex = ids.indexOf(text(anchorOrderId));
      if (anchorIndex < 0) throw new Error("指定的停靠点不在目标路线中。");
      return { index: anchorIndex + 1, ids };
    }
    if (mode === "BEFORE") {
      const anchorIndex = ids.indexOf(text(anchorOrderId));
      if (anchorIndex < 0) throw new Error("指定的停靠点不在目标路线中。");
      return { index: anchorIndex, ids };
    }
    if (mode === "AUTO_MIN_DELTA") {
      const current = window.STCTVerifier.recomputeRoute(route, ids, state.scenario);
      let best = null;
      for (let index = 0; index <= ids.length; index += 1) {
        const candidateIds = [...ids];
        candidateIds.splice(index, 0, orderIdValue);
        const candidate = window.STCTVerifier.recomputeRoute(route, candidateIds, state.scenario);
        if (!candidate.violations.length && candidate.route) {
          const incrementalMeters = candidate.route.roadMeters - numeric(current.route?.roadMeters);
          if (!best || incrementalMeters < best.incrementalMeters || (incrementalMeters === best.incrementalMeters && index < best.index)) {
            best = { index, ids, incrementalMeters };
          }
        }
      }
      if (!best) throw new Error("目标路线没有可行插入位置。");
      return best;
    }
    throw new Error("请选择明确的插入方式。");
  }

  async function finalizeManual(action, before, draftPlan) {
    const manual = state.manual;
    const nextRevision = manual.revision + 1;
    draftPlan.routes = (draftPlan.routes || []).filter((route) => window.STCTVerifier.routeOrderIds(route, draftPlan).length);
    const recomputed = window.STCTVerifier.recomputePlan(draftPlan, state.scenario).plan;
    recomputed.planId = `${manual.basePlanId}-M${String(nextRevision).padStart(3, "0")}`;
    recomputed.scenarioId = state.scenario.scenarioId;
    recomputed.contentHash = state.scenario.contentHash;
    recomputed.inputHash = state.scenario.inputHash;
    recomputed.contractVersion = state.scenario.contractVersion;
    recomputed.canonicalVersion = state.scenario.canonicalVersion;
    recomputed.basePlanHash = manual.basePlanHash;
    recomputed.parentPlanHash = manual.plan.planHash;
    recomputed.manualRevision = nextRevision;
    const identity = await window.STCTCanonical.planIdentity(state.scenario.inputHash, {
      routes: recomputed.routes.map((route) => ({ routeId: route.routeId, vehicleId: route.vehicleId, orderIds: route.orderIds })),
      unassignedOrderIds: recomputed.unassignedOrderIds,
      blockedOrderIds: recomputed.blockedOrderIds,
      manualRevision: nextRevision,
      parentPlanHash: manual.plan.planHash,
    });
    recomputed.planHash = identity.planHash;
    recomputed.reportedMetrics = clone(recomputed.metrics);
    recomputed.meta = {
      ...(draftPlan.meta || {}),
      manualAdjusted: true,
      basePlanId: manual.basePlanId,
      basePlanHash: manual.basePlanHash,
      parentPlanHash: manual.plan.planHash,
      manualRevision: nextRevision,
      planHash: identity.planHash,
    };
    const verification = await window.STCTVerifier.verify(recomputed, state.scenario);
    if (verification.status === "FAIL") {
      const violation = verification.hardViolations[0] || verification.metricMismatches[0] || { code: "MANUAL_EDIT_REJECTED" };
      const error = new Error(`操作未应用：${violation.code}`);
      error.code = violation.code;
      error.verification = verification;
      throw error;
    }
    const committed = verification.recomputedPlan;
    const committedAction = {
      actionId: `ACT-${String(manual.auditLog.length + 1).padStart(4, "0")}`,
      timestamp: new Date().toISOString(),
      ...action,
      beforePlanHash: manual.plan.planHash,
      afterPlanHash: committed.planHash,
      beforeRevision: manual.revision,
      afterRevision: nextRevision,
      verifierStatus: verification.status,
      violationCodes: [],
    };
    committed.planId = recomputed.planId;
    committed.basePlanHash = manual.basePlanHash;
    committed.parentPlanHash = manual.plan.planHash;
    committed.manualRevision = nextRevision;
    committed.meta = { ...recomputed.meta, actions: [...manual.actions, committedAction], manualAdjustmentAudit: [...manual.auditLog, committedAction] };
    committed.verification = { ...verification, recomputedPlan: undefined };
    manual.history.push(before);
    manual.actions.push(committedAction);
    manual.auditLog.push(committedAction);
    manual.revision = nextRevision;
    manual.editorRevision += 1;
    manual.plan = committed;
    manual.editorStateHash = await editorStateHash(committed.planHash, manual.lockedRouteIds, manual.editorRevision);
    state.phase = "manual-edit";
    window.STCTCore?.setOptimizerPlan?.(committed);
    emit();
    return committed;
  }

  async function manualAction(type, payload = {}) {
    if (!state.manual?.active) throw new Error("请先进入人工调度模式。");
    const manual = state.manual;
    const before = manualSnapshot(manual);
    if (type === "TOGGLE_ROUTE_LOCK") {
      const routeId = text(payload.routeId);
      if (!(manual.plan.routes || []).some((route) => route.routeId === routeId)) throw new Error("路线不存在。");
      const nextLocks = manual.lockedRouteIds.includes(routeId)
        ? manual.lockedRouteIds.filter((id) => id !== routeId)
        : [...manual.lockedRouteIds, routeId];
      const action = {
        actionId: `ACT-${String(manual.auditLog.length + 1).padStart(4, "0")}`,
        timestamp: new Date().toISOString(), actionType: type, type, routeId,
        locked: nextLocks.includes(routeId), beforePlanHash: manual.plan.planHash,
        afterPlanHash: manual.plan.planHash, beforeRevision: manual.editorRevision,
        afterRevision: manual.editorRevision + 1, verifierStatus: "PASS", violationCodes: [],
      };
      manual.history.push(before);
      manual.lockedRouteIds = nextLocks;
      manual.editorRevision += 1;
      manual.editorStateHash = await editorStateHash(manual.plan.planHash, nextLocks, manual.editorRevision);
      manual.actions.push(action);
      manual.auditLog.push(action);
      emit();
      return manual.plan;
    }

    const draft = clone(manual.plan);
    const selectedOrderId = text(payload.orderId);
    const sourceRoute = routeForOrder(draft, selectedOrderId);
    const fromRoute = text(sourceRoute?.routeId);
    if (!sourceRoute && type !== "ADD_UNASSIGNED") throw new Error("未找到选定订单。");
    if (fromRoute && manual.lockedRouteIds.includes(fromRoute)) throw new Error("来源路线已锁定。");

    if (type === "MOVE_ORDER") {
      const target = draft.routes.find((route) => route.routeId === payload.toRouteId);
      if (!target) throw new Error("目标路线不存在。");
      if (manual.lockedRouteIds.includes(target.routeId)) throw new Error("目标路线已锁定。");
      sourceRoute.orderIds = window.STCTVerifier.routeOrderIds(sourceRoute, draft).filter((id) => id !== selectedOrderId);
      const choice = insertionChoice(target, selectedOrderId, payload.insertMode || "APPEND", payload.anchorOrderId);
      target.orderIds = [...choice.ids];
      target.orderIds.splice(choice.index, 0, selectedOrderId);
      return finalizeManual({ actionType: type, type, orderId: selectedOrderId, sourceRouteId: fromRoute, targetRouteId: target.routeId, fromRoute, toRoute: target.routeId, insertMode: payload.insertMode || "APPEND", insertPosition: choice.index + 1, incrementalMeters: choice.incrementalMeters ?? null }, before, draft);
    }
    if (type === "REORDER_STOP") {
      const sameRoute = window.STCTVerifier.routeOrderIds(sourceRoute, draft);
      const currentIndex = sameRoute.indexOf(selectedOrderId);
      const targetIndex = payload.direction === "up" ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= sameRoute.length) throw new Error("该配送点已经位于路线边界。");
      [sameRoute[currentIndex], sameRoute[targetIndex]] = [sameRoute[targetIndex], sameRoute[currentIndex]];
      sourceRoute.orderIds = sameRoute;
      return finalizeManual({ actionType: type, type, orderId: selectedOrderId, sourceRouteId: fromRoute, targetRouteId: fromRoute, routeId: fromRoute, direction: payload.direction, insertPosition: targetIndex + 1 }, before, draft);
    }
    if (type === "REMOVE_TO_UNASSIGNED") {
      sourceRoute.orderIds = window.STCTVerifier.routeOrderIds(sourceRoute, draft).filter((id) => id !== selectedOrderId);
      const order = state.scenario.orders.find((item) => orderId(item) === selectedOrderId);
      syncUnassigned(draft, [...(draft.unassignedOrders || []).filter((row) => orderId(row) !== selectedOrderId), {
        ...clone(order || {}),
        id: selectedOrderId,
        reasonCode: "MANUALLY_UNASSIGNED",
        reasonLabel: "人工移回未分配池",
        evidence: { manualAction: true, fromRoute },
        confidence: "deterministic",
        suggestedActions: ["重新加入其他路线或撤销操作"],
        assignmentStatus: "UNASSIGNED_MANUAL",
      }]);
      return finalizeManual({ actionType: type, type, orderId: selectedOrderId, sourceRouteId: fromRoute, fromRoute }, before, draft);
    }
    if (type === "ADD_UNASSIGNED") {
      const target = draft.routes.find((route) => route.routeId === payload.toRouteId);
      if (!target) throw new Error("目标路线不存在。");
      if (manual.lockedRouteIds.includes(target.routeId)) throw new Error("目标路线已锁定。");
      const poolIndex = (draft.unassignedOrders || []).findIndex((row) => orderId(row) === selectedOrderId);
      if (poolIndex < 0) throw new Error("未分配池中没有该订单。");
      const choice = insertionChoice(target, selectedOrderId, payload.insertMode, payload.anchorOrderId);
      const pool = [...draft.unassignedOrders];
      pool.splice(poolIndex, 1);
      syncUnassigned(draft, pool);
      target.orderIds = [...choice.ids];
      target.orderIds.splice(choice.index, 0, selectedOrderId);
      return finalizeManual({ actionType: type, type, orderId: selectedOrderId, sourceRouteId: "UNASSIGNED", targetRouteId: target.routeId, fromRoute: "UNASSIGNED", toRoute: target.routeId, insertMode: payload.insertMode, insertPosition: choice.index + 1, incrementalMeters: choice.incrementalMeters ?? null }, before, draft);
    }
    throw new Error(`不支持的人工动作：${type}`);
  }

  async function undoManual() {
    if (!state.manual?.history?.length) throw new Error("没有可撤销的人工操作。");
    const manual = state.manual;
    const reverted = manual.actions.at(-1);
    const previous = manual.history.pop();
    const undo = {
      actionId: `ACT-${String(manual.auditLog.length + 1).padStart(4, "0")}`,
      timestamp: new Date().toISOString(), actionType: "UNDO", type: "UNDO",
      revertedActionId: reverted?.actionId || null, restoredPlanHash: previous.plan.planHash,
      beforePlanHash: manual.plan.planHash, afterPlanHash: previous.plan.planHash,
      beforeRevision: manual.editorRevision, afterRevision: previous.editorRevision,
      verifierStatus: "PASS", violationCodes: [],
    };
    manual.plan = previous.plan;
    manual.actions = previous.actions;
    manual.lockedRouteIds = previous.lockedRouteIds;
    manual.revision = previous.revision;
    manual.editorRevision = previous.editorRevision;
    manual.editorStateHash = previous.editorStateHash;
    manual.auditLog.push(undo);
    state.phase = "manual-edit";
    window.STCTCore?.setOptimizerPlan?.(manual.plan);
    emit();
    return manual.plan;
  }

  function resetManual() {
    if (!state.manual) throw new Error("当前未进入人工调度。");
    state.manual.plan = clone(state.manual.basePlan);
    state.manual.history = [];
    state.manual.actions = [];
    state.manual.lockedRouteIds = [];
    state.manual.revision = numeric(state.manual.basePlan.manualRevision, 0);
    state.manual.editorRevision = 0;
    state.manual.editorStateHash = state.manual.baseEditorStateHash;
    state.phase = "manual-edit";
    window.STCTCore?.setOptimizerPlan?.(state.manual.plan);
    emit();
    return state.manual.plan;
  }

  function stopManual() {
    if (!state.manual) return currentCandidate();
    const baseId = state.manual.basePlanId;
    state.manual = null;
    state.selectedPlanId = baseId;
    state.selectedScenarioId = baseId;
    state.phase = "candidates";
    window.STCTCore?.setOptimizerPlan?.(currentCandidate());
    emit();
    return currentCandidate();
  }

  function exportSnapshot() {
    return {
      exportedAt: new Date().toISOString(),
      scenario: clone(state.scenario),
      candidateComparison: clone(state.candidates.map((plan) => ({
        planId: plan.planId,
        labels: plan.labels,
        requestedGoals: plan.requestedGoals,
        metrics: plan.metrics,
        verification: plan.verification,
        fingerprint: plan.fingerprint,
      }))),
      selectedPlan: clone(currentCandidate()),
      unassignedDiagnostics: state.scenario && currentCandidate() ? window.STCTVerifier.diagnostics(currentCandidate(), state.scenario) : null,
      verificationReport: clone(currentCandidate()?.verification || null),
      manualAdjustmentAudit: clone(state.manual?.auditLog || state.manual?.actions || currentCandidate()?.meta?.manualAdjustmentAudit || []),
      assumptions: clone(state.scenario?.assumptionsSnapshot || {}),
      objectiveDefinitions: clone(GOALS),
      baseline: state.baseline ? {
        savedAt: state.baseline.savedAt,
        scenarioId: state.baseline.scenario?.scenarioId,
        inputHash: state.baseline.scenario?.inputHash,
        planId: state.baseline.plan?.planId,
        metrics: clone(state.baseline.plan?.metrics || {}),
      } : null,
      whatIfDelta: clone(state.whatIfResults),
      scenarioSettings: clone(state.scenarioSettings),
      performance: clone(state.lastPerformance),
    };
  }

  Object.assign(legacyPlanning, {
    state,
    snapshot,
    setRawData,
    markPreview,
    invalidate,
    selectScenario,
    currentCandidate,
    applySelected,
    restore,
    buildScenario,
    buildMultiDayBatch,
    aggregateMultiDay,
    generateMultiDayBatch,
    cancelMultiDayBatch,
    enterMultiDayChild,
    setPlanningMode,
    updateSettings,
    saveBaseline,
    restoreBaseline,
    evaluateCapacityOptions,
    startManual,
    manualAction,
    undoManual,
    resetManual,
    stopManual,
    exportSnapshot,
    inputFingerprint: async (raw, date, limit) => (await buildScenario({ raw, date, limit })).inputHash,
    recommend,
  });
  Object.assign(legacyOptimizer, {
    GOALS,
    buildScenario,
    buildRequest,
    generateScenarios,
    optimizeScenario: fetchPlan,
    recommend,
    fingerprint,
    assumptions: assumptionsFor,
    planMetrics: (plan) => plan?.metrics || legacyPlanMetrics(plan),
  });
  window.STCTPlanning = legacyPlanning;
  window.STCTOptimizer = legacyOptimizer;
})();
